// UI24 Inspector: the selected block's id, lane, shape, label and every metadata field (evidence), with the field
// form, quick adds for the usual evidence fields, the rules that style the block, and its whole entry as YAML. With
// several blocks selected it shows only the field form (set or remove a field on all of them). Every edit is one
// core operation through `store.apply`; config edits are off while the config has errors (UI26, UI31).
import { useMemo, useState, type ReactNode } from 'react';
import { BLOCK_STYLE_KEY, ConfigDoc, LINK_KEY, matchFields, ruleMatches, type FlowConfig, type NodeMeta } from '../../core/config';
import { moveNodesToGroup, moveNodesToLane, removeNodeField, replaceNodeEntry } from '../../core/ops';
import { UNASSIGNED, type GraphNode } from '../../core/types';
import { editNodeLabel } from '../actions';
import { editNodeId } from '../commands/blocks';
import { shallow, useStore, useStoreState } from '../store/hooks';
import type { State } from '../store/store';
import { ShapeIcon } from './Palette';
import { sidePanels } from './Panels';
import { BlockColors } from './evidence/BlockColors';
import { AutoTextarea, IconButton, ico, StyleSwatch } from './evidence/controls';
import { FieldForm, type FieldFormInit } from './evidence/FieldForm';
import { Links } from './evidence/Links';
import { COMMON_FIELDS, describeMatch, fieldText, formFor, isPlainMap, isScalar, usualType } from './evidence/format';
import './evidence/evidence.css';

/** Extra sections in the single-block inspector, after the built-in fields (e.g. a shape picker). */
export const inspectorSections: { id: string; Component: (p: { id: string }) => ReactNode }[] = [];

const selectedNodeIds = (s: State): string[] => {
  const nodes = s.shown?.doc.graph.nodes;
  if (!nodes) return [];
  const sel = new Set(s.selection.nodes);
  return nodes.filter((n) => sel.has(n.id)).map((n) => n.id);
};

export const CONFIG_BROKEN_MESSAGE = 'The config file (.flow.yaml) has errors, so evidence and styles can’t be edited until it’s fixed. The diagram itself is still editable.';

/** Why config editing is off, or null (UI26, UI31). */
export function configLock(s: State): string | null {
  if (!s.derived) return 'Loading';
  if (s.derived.readOnly) return 'The .mmd file has errors, so the diagram is read-only until it’s fixed.';
  if (s.derived.configBroken) return CONFIG_BROKEN_MESSAGE;
  return null;
}

export function Inspector() {
  const ids = useStoreState(selectedNodeIds, shallow);
  if (ids.length === 0) return null;
  return (
    <section className="fm-ev-panel fm-inspector" data-testid="inspector" data-count={ids.length > 1 ? ids.length : undefined} aria-label="Inspector">
      {ids.length === 1 ? <SingleBlock key={ids[0]} id={ids[0]!} /> : <ManyBlocks ids={ids} />}
    </section>
  );
}

function Lock({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <div className="fm-ev-lock" data-testid="config-locked" role="note">
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <span>{reason}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// One block

function SingleBlock({ id }: { id: string }) {
  const store = useStore();
  const node = useStoreState((s) => s.shown?.doc.graph.nodes.find((n) => n.id === id) ?? null, shallow);
  const lanes = useStoreState((s) => s.shown?.doc.graph.lanes.filter((l) => l.id !== UNASSIGNED) ?? [], sameLanes);
  // A19: the groups of the block's lane (for the group select), in file order.
  const groups = useStoreState(
    (s) => {
      const lane = s.shown?.doc.graph.nodes.find((n) => n.id === id)?.lane;
      return (s.shown?.doc.graph.groups ?? []).filter((g) => g.lane === lane).map((g) => ({ id: g.id, label: g.label }));
    },
    sameLanes,
  );
  const config = useStoreState((s) => s.derived?.doc.config ?? null);
  const configText = useStoreState((s) => s.files?.config ?? null);
  const lock = useStoreState(configLock);
  const readOnly = useStoreState((s) => !!s.derived?.readOnly);
  const theme = useStoreState((s) => s.theme);
  const [form, setForm] = useState<(FieldFormInit & { focus: 'key' | 'value'; n: number }) | null>(null);

  if (!node) return null;
  const meta: NodeMeta = (config && Object.hasOwn(config.nodes, id) ? config.nodes[id] : undefined) ?? {};
  // §4: a block's own `style` isn't evidence; it shows as the block's colours (UI35), not as a field row.
  // A15: `link` isn't evidence either; it shows as the "Links to" field below.
  const keys = Object.keys(meta).filter((k) => k !== BLOCK_STYLE_KEY && k !== LINK_KEY);
  const configOff = lock !== null;
  let formSeq = form?.n ?? 0;

  const openForm = (init: FieldFormInit, focus: 'key' | 'value') => setForm({ ...init, focus, n: ++formSeq });

  return (
    <>
      <header className="fm-ev-head">
        <span className="fm-ev-kicker">
          <ShapeIcon kind={node.kind} width={22} height={15} />
          Block
        </span>
        <div className="fm-ev-title-row">
          <div className="fm-ev-title" data-field="label" title="Double-click to edit the label" onDoubleClick={() => !readOnly && editNodeLabel(store, id)}>
            {node.label}
          </div>
          <IconButton label="Edit the label" disabled={readOnly} onClick={() => editNodeLabel(store, id)}>
            {ico.edit}
          </IconButton>
        </div>
      </header>

      <div className="fm-ev-props">
        <div className="fm-ev-kv">
          <span className="fm-ev-k">Id</span>
          <span className="fm-ev-v">
            <code className="fm-ev-code" data-field="id">{node.id}</code>
            <IconButton label="Rename the id" data-testid="id-edit" disabled={readOnly} onClick={() => editNodeId(store, id)}>
              {ico.edit}
            </IconButton>
          </span>
        </div>
        <div className="fm-ev-kv">
          <label className="fm-ev-k" htmlFor="fm-lane-select">Lane</label>
          <span className="fm-ev-v">
            <select
              id="fm-lane-select"
              data-testid="lane-select"
              className="fm-ev-select fm-ev-grow"
              value={node.lane}
              disabled={readOnly}
              onChange={(e) => store.apply(moveNodesToLane, [id], e.target.value)}
            >
              {lanes.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
              <option value={UNASSIGNED}>Unassigned</option>
            </select>
            <code className="fm-ev-code fm-ev-code-quiet" data-field="lane" title="Lane id">{node.lane}</code>
          </span>
        </div>
        {groups.length || node.group ? (
          <div className="fm-ev-kv">
            <label className="fm-ev-k" htmlFor="fm-group-select">Group</label>
            <span className="fm-ev-v">
              <select
                id="fm-group-select"
                data-testid="group-select"
                className="fm-ev-select fm-ev-grow"
                value={node.group ?? ''}
                disabled={readOnly}
                onChange={(e) => store.apply(moveNodesToGroup, [id], { lane: node.lane, group: e.target.value || null })}
              >
                <option value="">None</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.label}</option>
                ))}
              </select>
              <code className="fm-ev-code fm-ev-code-quiet" data-field="group" title="Group id">{node.group ?? ''}</code>
            </span>
          </div>
        ) : null}
        <div className="fm-ev-kv">
          <span className="fm-ev-k">Shape</span>
          <span className="fm-ev-v">
            <code className="fm-ev-code fm-ev-code-quiet" data-field="kind">{node.kind}</code>
          </span>
        </div>
        {inspectorSections.map(({ id: sid, Component }) => (
          <Component key={sid} id={id} />
        ))}
      </div>

      <section className="fm-ev-section">
        <div className="fm-ev-section-head">
          <h3>Evidence</h3>
          <button
            type="button"
            data-testid="add-field"
            className="fm-ev-link-btn"
            disabled={configOff}
            onClick={() => openForm({ key: '', type: 'text', text: '' }, 'key')}
          >
            {ico.plus} Add field
          </button>
        </div>
        <Lock reason={lock} />
        {keys.length === 0 && !configOff ? (
          <p className="fm-ev-empty">No evidence yet. Note who said it, how sure we are, and what’s still open.</p>
        ) : null}
        <dl className="fm-ev-fields">
          {keys.map((k) => (
            <MetaField
              key={k}
              name={k}
              value={meta[k]}
              disabled={configOff}
              editing={form?.editing === k}
              onEdit={() => {
                const f = formFor(meta[k]);
                openForm({ key: k, type: f.type, text: f.text, editing: k }, 'value');
              }}
              onDelete={() => {
                if (form?.editing === k) setForm(null);
                store.apply(removeNodeField, id, k);
              }}
            />
          ))}
        </dl>
        {form ? (
          <FieldForm
            key={form.n}
            ids={[id]}
            config={config}
            init={form}
            disabled={configOff}
            autoFocus={form.focus}
            onClose={() => setForm(null)}
          />
        ) : null}
        {!configOff && !form ? (
          <QuickAdds
            have={keys}
            onPick={(key) => {
              const type = COMMON_FIELDS.find((f) => f.key === key)?.type ?? usualType(config, key) ?? 'text';
              openForm({ key, type, text: '' }, 'value');
            }}
          />
        ) : null}
      </section>

      <BlockColors ids={[id]} />

      <Links id={id} />

      <StyledBy config={config} node={node} theme={theme} />

      <NodeYaml id={id} configText={configText} disabled={configOff} />
    </>
  );
}

function sameLanes(a: { id: string; label: string }[], b: { id: string; label: string }[]): boolean {
  return a.length === b.length && a.every((l, i) => l.id === b[i]!.id && l.label === b[i]!.label);
}

function MetaField({ name, value, disabled, editing, onEdit, onDelete }: {
  name: string;
  value: unknown;
  disabled: boolean;
  editing: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`fm-ev-field fm-ev-field-${fieldKind(name)}${editing ? ' fm-ev-field-editing' : ''}`}>
      <dt className="fm-ev-field-key" title={name}>{name.replace(/_/g, ' ')}</dt>
      <dd className="fm-ev-field-val" data-field={`meta.${name}`}>
        <FieldValueView name={name} value={value} />
        <span className="fm-ev-field-actions">
          <IconButton label={`Edit ${name}`} data-testid="field-edit" disabled={disabled} onClick={onEdit}>
            {ico.edit}
          </IconButton>
          <IconButton label={`Delete ${name}`} data-testid="field-delete" className="fm-ev-danger" disabled={disabled} onClick={onDelete}>
            {ico.trash}
          </IconButton>
        </span>
      </dd>
    </div>
  );
}

function fieldKind(name: string): string {
  if (name === 'quote') return 'quote';
  if (name === 'open_question') return 'question';
  if (name === 'confidence') return 'confidence';
  return 'plain';
}

/**
 * A value as the inspector shows it. The element's text is exactly the §8.3 form (a list joined with `, `, a map as
 * compact JSON); lists read as chips (the `, ` separators are hidden) and maps as a small table drawn from attributes.
 */
function FieldValueView({ name, value }: { name: string; value: unknown }) {
  if (Array.isArray(value) && value.length > 0) {
    return (
      <span className="fm-ev-list">
        {value.map((x, i) => (
          <span key={i}>
            {i > 0 ? <span className="fm-ev-sep">, </span> : null}
            <span className="fm-ev-chip">{fieldText(x)}</span>
          </span>
        ))}
      </span>
    );
  }
  if (isPlainMap(value) && Object.values(value).every(isScalar) && Object.keys(value).length > 0) {
    return (
      <span className="fm-ev-map">
        <span className="fm-ev-sr">{fieldText(value)}</span>
        {Object.entries(value).map(([k, v]) => (
          <span key={k} className="fm-ev-map-row" aria-hidden="true">
            <span className="fm-ev-map-k" data-text={k} />
            <span className="fm-ev-map-v" data-text={fieldText(v)} />
          </span>
        ))}
      </span>
    );
  }
  const text = fieldText(value);
  const cls = isScalar(value) ? (typeof value === 'string' ? 'fm-ev-text' : 'fm-ev-text fm-ev-mono') : 'fm-ev-text fm-ev-mono fm-ev-json';
  return <span className={`${cls}${name === 'confidence' ? ` fm-ev-conf fm-ev-conf-${text.replace(/[^a-z-]/gi, '')}` : ''}`}>{text}</span>;
}

function QuickAdds({ have, onPick }: { have: string[]; onPick: (key: string) => void }) {
  const missing = COMMON_FIELDS.filter((f) => !have.includes(f.key));
  if (missing.length === 0) return null;
  return (
    <div className="fm-ev-quick" aria-label="Add a common field">
      {missing.map((f) => (
        <button key={f.key} type="button" className="fm-ev-chip fm-ev-chip-btn fm-ev-chip-add" title={f.hint} onClick={() => onPick(f.key)}>
          + {f.key.replace(/_/g, ' ')}
        </button>
      ))}
    </div>
  );
}

/** The rules that style this block, in order (a later one overrides earlier properties). */
function StyledBy({ config, node, theme }: { config: FlowConfig | null; node: GraphNode; theme: 'light' | 'dark' }) {
  const store = useStore();
  const rules = useMemo(() => {
    if (!config) return [];
    const fields = matchFields(config, node);
    return config.styles.map((r, i) => ({ r, i })).filter(({ r }) => ruleMatches(r, fields));
  }, [config, node]);
  if (rules.length === 0) return null;
  return (
    <section className="fm-ev-section">
      <div className="fm-ev-section-head">
        <h3>Styled by</h3>
        <button type="button" className="fm-ev-link-btn" onClick={() => store.togglePanel('styles', true)}>
          Styles
        </button>
      </div>
      <ul className="fm-ev-styled-by">
        {rules.map(({ r, i }) => (
          <li key={i}>
            <StyleSwatch style={r.style} theme={theme} size="sm" />
            <span className="fm-ev-styled-text">
              <span>{r.legend || `Rule ${i + 1}`}</span>
              <span className="fm-ev-faint">when {describeMatch(r)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** UI24 node YAML: the block's whole metadata entry; empty removes it, anything but a map is refused. */
function NodeYaml({ id, configText, disabled }: { id: string; configText: string | null; disabled: boolean }) {
  const store = useStore();
  const source = useMemo(() => new ConfigDoc(configText).nodeYaml(id), [configText, id]);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const value = draft ?? source;
  const apply = () => {
    if (draft === null || draft === source) {
      setDraft(null);
      setError(null);
      return;
    }
    const r = store.apply(replaceNodeEntry, id, draft);
    if (r.ok) {
      setDraft(null);
      setError(null);
    } else setError(r.error);
  };
  return (
    <section className="fm-ev-section fm-ev-yaml">
      <div className="fm-ev-section-head">
        <h3>As YAML</h3>
        {draft !== null && draft !== source ? (
          <button type="button" className="fm-ev-link-btn" onClick={() => { setDraft(null); setError(null); }}>
            Revert
          </button>
        ) : null}
      </div>
      <AutoTextarea
        data-testid="node-yaml"
        className="fm-ev-input fm-ev-code-area"
        value={value}
        minRows={3}
        placeholder={disabled ? '' : 'No metadata. Type YAML here, e.g.\nconfidence: confirmed'}
        disabled={disabled}
        aria-label="This block’s metadata as YAML"
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            apply();
          }
        }}
      />
      {error ? <div className="fm-ev-form-error" data-testid="yaml-error" role="alert">{error}</div> : null}
      <div className="fm-ev-form-actions">
        <span className="fm-ev-hint">Empty removes the entry</span>
        <button type="button" data-testid="node-yaml-apply" className="fm-btn fm-ev-btn" disabled={disabled} onClick={apply}>
          Apply YAML
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Several blocks

function ManyBlocks({ ids }: { ids: string[] }) {
  const config = useStoreState((s) => s.derived?.doc.config ?? null);
  const lock = useStoreState(configLock);
  const [seed, setSeed] = useState<{ key: string; n: number }>({ key: '', n: 0 });
  // Fields some of the selected blocks have, with how many: a click puts the name in the form.
  const shared = useMemo(() => {
    const count = new Map<string, number>();
    for (const id of ids) for (const k of Object.keys(config?.nodes[id] ?? {})) if (k !== BLOCK_STYLE_KEY && k !== LINK_KEY) count.set(k, (count.get(k) ?? 0) + 1);
    return [...count];
  }, [config, ids]);
  return (
    <>
      <header className="fm-ev-head">
        <span className="fm-ev-kicker">Selection</span>
        <div className="fm-ev-title" data-testid="selection-count">{ids.length} blocks selected</div>
        <div className="fm-ev-ids">
          {ids.map((id) => <code key={id} className="fm-ev-code fm-ev-code-quiet">{id}</code>)}
        </div>
      </header>
      <section className="fm-ev-section">
        <div className="fm-ev-section-head">
          <h3>Set a field on all of them</h3>
        </div>
        <Lock reason={lock} />
        <FieldForm key={`${seed.n}`} ids={ids} config={config} init={{ key: seed.key, type: 'text', text: '' }} disabled={lock !== null} autoFocus={seed.n ? 'value' : undefined} />
        {shared.length > 0 && lock === null ? (
          <div className="fm-ev-quick" aria-label="Fields on the selected blocks">
            <span className="fm-ev-faint">On these blocks:</span>
            {shared.map(([k, n]) => (
              <button key={k} type="button" className="fm-ev-chip fm-ev-chip-btn" title={`${n} of ${ids.length} have ${k}`} onClick={() => setSeed((s) => ({ key: k, n: s.n + 1 }))}>
                {k} <span className="fm-ev-faint">{n}/{ids.length}</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>
      <BlockColors ids={ids} />
    </>
  );
}

sidePanels.push({ id: 'inspector', when: (s) => s.selection.nodes.length > 0 && !!s.shown?.layout, Component: Inspector });
