// UI25 Styles panel: the style rules in order, each with a live swatch, its legend text, its conditions and its
// properties, plus the whole `styles` list as YAML. Every edit is one core operation through `store.apply`; config
// edits are off while the config has errors (UI26). Opened by the `styles-toggle` toolbar button.
import { useMemo, useRef, useState } from 'react';
import {
  BORDER_STYLES, COLOR_PROPS, ConfigDoc, FONT_STYLES, fieldSuggestions, matchFields, ruleMatches, STYLE_PROPS,
  type ColorProp, type FlowConfig, type MatchCondition, type MatchInput, type MatchOp, type StyleProp, type StyleRule,
} from '../../core/config';
import {
  addRule, deleteRule, editMatchCondition, moveRule, removeMatchCondition, replaceStyles, setMatchCondition,
  setRuleLegend, setStyleColor, setStyleProp,
} from '../../core/ops';
import { getTheme } from '../../core/theme';
import { SHAPE_KINDS, UNASSIGNED } from '../../core/types';
import type { Command } from '../commands/types';
import { shallow, useStore, useStoreState } from '../store/hooks';
import type { Store } from '../store/store';
import { icons } from './icons';
import { configLock } from './Inspector';
import { sidePanels } from './Panels';
import { AutoTextarea, ColorField, CommitInput, IconButton, ico, StyleSwatch } from './evidence/controls';
import { BUILTIN_FIELDS, knownKeys } from './evidence/format';
import './evidence/evidence.css';

const PROP_LABEL: Record<StyleProp, string> = {
  fill: 'Fill',
  border_color: 'Border',
  text_color: 'Text',
  border_style: 'Border style',
  border_width: 'Border width',
  font_style: 'Font',
  badge: 'Badge',
};

export function StylesPanel() {
  const store = useStore();
  const config = useStoreState((s) => s.derived?.doc.config ?? null);
  const configText = useStoreState((s) => s.files?.config ?? null);
  const lock = useStoreState(configLock);
  const theme = useStoreState((s) => s.theme);
  const nodes = useStoreState((s) => s.derived?.doc.graph.nodes ?? [], shallow);
  const rulesRef = useRef<HTMLOListElement>(null);
  const disabled = lock !== null;
  const rules = config?.styles ?? [];

  const counts = useMemo(() => {
    if (!config) return [];
    const fields = nodes.map((n) => matchFields(config, n));
    return config.styles.map((r) => fields.filter((f) => ruleMatches(r, f)).length);
  }, [config, nodes]);

  const add = () => {
    const r = store.apply(addRule);
    if (!r.ok) return;
    // Bring the new rule into view and start on its legend.
    requestAnimationFrame(() => {
      const last = rulesRef.current?.querySelector<HTMLElement>('[data-testid="style-rule"]:last-child');
      last?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      last?.querySelector<HTMLInputElement>('[data-testid="rule-legend"]')?.focus();
    });
  };

  return (
    <section className="fm-ev-panel fm-styles" data-testid="styles" aria-label="Styles">
      <header className="fm-ev-head fm-ev-head-row">
        <div>
          <span className="fm-ev-kicker">Styles</span>
          <div className="fm-ev-title">How evidence looks</div>
        </div>
        <IconButton label="Close styles" onClick={() => store.togglePanel('styles', false)}>
          {ico.close}
        </IconButton>
      </header>
      <p className="fm-ev-intro">
        Rules apply top to bottom; a later rule overrides earlier properties. Rules with legend text appear in the legend.
      </p>
      {lock ? <div className="fm-ev-pad"><Lock reason={lock} /></div> : null}
      {!disabled && rules.length === 0 ? (
        <div className="fm-ev-empty-card">
          <strong>No rules yet.</strong> Add one to turn evidence into looks, for example a dashed border when
          <code className="fm-ev-code">confidence</code> is <code className="fm-ev-code">single-source</code>.
        </div>
      ) : null}
      <ol className="fm-ev-rules" ref={rulesRef}>
        {rules.map((rule, i) => (
          <RuleCard
            key={i}
            index={i}
            count={rules.length}
            rule={rule}
            config={config!}
            applies={counts[i] ?? 0}
            theme={theme}
            disabled={disabled}
          />
        ))}
      </ol>
      <div className="fm-ev-pad">
        <button type="button" data-testid="rule-add" className="fm-btn fm-ev-btn fm-ev-add-rule" disabled={disabled} onClick={add}>
          {ico.plus} Add rule
        </button>
      </div>
      <StylesYaml configText={configText} disabled={disabled} />
    </section>
  );
}

function Lock({ reason }: { reason: string }) {
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
// One rule

function RuleCard({ index: i, count, rule, config, applies, theme, disabled }: {
  index: number;
  count: number;
  rule: StyleRule;
  config: FlowConfig;
  applies: number;
  theme: 'light' | 'dark';
  disabled: boolean;
}) {
  const store = useStore();
  const [draft, setDraft] = useState<{ n: number; focus: boolean } | null>(null);
  const known = Object.keys(rule.rawStyle).filter((k) => !(STYLE_PROPS as readonly string[]).includes(k));
  const listId = `fm-ev-fields-${i}`;

  const addCondition = () => {
    if (draft) {
      document.querySelector<HTMLInputElement>(`[data-rule-index="${i}"] [data-draft] [data-testid="match-field"]`)?.focus();
      return;
    }
    setDraft({ n: Date.now(), focus: true });
  };

  return (
    <li className="fm-ev-rule" data-testid="style-rule" data-rule-index={i}>
      <div className="fm-ev-rule-head">
        <StyleSwatch style={rule.style} theme={theme} />
        <div className="fm-ev-rule-title">
          <CommitInput
            data-testid="rule-legend"
            className="fm-ev-input fm-ev-legend"
            value={rule.legend ?? ''}
            placeholder="Legend text (optional)"
            aria-label={`Rule ${i + 1} legend`}
            disabled={disabled}
            onCommit={(t) => store.apply(setRuleLegend, i, t)}
          />
          <div className="fm-ev-rule-sub">
            <span className="fm-ev-faint">
              {applies === 0 ? 'Matches no blocks' : `Matches ${applies} block${applies === 1 ? '' : 's'}`}
              {rule.legend ? '' : ' · not in the legend'}
            </span>
            <span className="fm-ev-rule-tools">
              <IconButton label="Move up" data-testid="rule-up" disabled={disabled} onClick={() => store.apply(moveRule, i, 'up')}>
                {ico.up}
              </IconButton>
              <IconButton label="Move down" data-testid="rule-down" disabled={disabled} onClick={() => store.apply(moveRule, i, 'down')}>
                {ico.down}
              </IconButton>
              <IconButton label="Delete rule" data-testid="rule-delete" className="fm-ev-danger" disabled={disabled} onClick={() => store.apply(deleteRule, i)}>
                {ico.trash}
              </IconButton>
            </span>
          </div>
        </div>
      </div>

      <div className="fm-ev-rule-block">
        <div className="fm-ev-rule-label">
          <span>When</span>
          <span className="fm-ev-faint">{rule.match.length ? '' : 'every block'}</span>
        </div>
        <div className="fm-ev-matches">
          {rule.match.map((c) => (
            <MatchRow key={c.field} index={i} cond={c} config={config} listId={listId} disabled={disabled} />
          ))}
          {draft ? (
            <DraftMatchRow key={draft.n} index={i} config={config} listId={listId} disabled={disabled} onDone={() => setDraft(null)} />
          ) : null}
        </div>
        <button type="button" data-testid="match-add" className="fm-ev-link-btn" disabled={disabled} onClick={addCondition}>
          {ico.plus} Condition
        </button>
        <datalist id={listId}>
          {[...BUILTIN_FIELDS, ...knownKeys(config).filter((k) => !(BUILTIN_FIELDS as readonly string[]).includes(k))].map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </div>

      <div className="fm-ev-rule-block">
        <div className="fm-ev-rule-label"><span>Style</span></div>
        <div className="fm-ev-props-grid">
          {COLOR_PROPS.map((p) => (
            <ColorProperty key={p} index={i} prop={p} raw={rule.rawStyle[p]} disabled={disabled} />
          ))}
          <div className="fm-ev-prop">
            <span className="fm-ev-prop-name">Line</span>
            <div className="fm-ev-pair">
              <SelectProperty index={i} prop="border_style" raw={rule.rawStyle.border_style} options={BORDER_STYLES} disabled={disabled} />
              <NumberProperty index={i} raw={rule.rawStyle.border_width} disabled={disabled} />
            </div>
          </div>
          <div className="fm-ev-prop">
            <span className="fm-ev-prop-name">Font</span>
            <div className="fm-ev-pair">
              <SelectProperty index={i} prop="font_style" raw={rule.rawStyle.font_style} options={FONT_STYLES} disabled={disabled} />
              <span className="fm-ev-labelled" data-label="badge">
                <CommitInput
                  data-prop="badge"
                  className="fm-ev-input"
                  value={rawText(rule.rawStyle.badge)}
                  placeholder="no badge"
                  aria-label="Badge text"
                  title="Badge: short text shown as a tag on the block"
                  disabled={disabled}
                  onCommit={(t) => store.apply(setStyleProp, i, 'badge', t)}
                />
              </span>
            </div>
          </div>
        </div>
        {known.length ? (
          <div className="fm-ev-unknown">
            Also kept (edit in YAML):{' '}
            {known.map((k) => (
              <code key={k} className="fm-ev-code fm-ev-code-quiet">{k}: {JSON.stringify(rule.rawStyle[k])}</code>
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

const rawText = (v: unknown): string => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function ColorProperty({ index: i, prop, raw, disabled }: { index: number; prop: ColorProp; raw: unknown; disabled: boolean }) {
  const store = useStore();
  let light = '';
  let dark = '';
  if (typeof raw === 'string') light = raw;
  else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    light = rawText(o.light);
    dark = rawText(o.dark);
  } else light = rawText(raw);
  const defaults = {
    light: prop === 'fill' ? getTheme('light').nodeFill : prop === 'text_color' ? getTheme('light').nodeText : getTheme('light').nodeBorder,
    dark: prop === 'fill' ? getTheme('dark').nodeFill : prop === 'text_color' ? getTheme('dark').nodeText : getTheme('dark').nodeBorder,
  };
  return (
    <ColorField
      prop={prop}
      label={PROP_LABEL[prop]}
      light={light}
      dark={dark}
      defaults={defaults}
      disabled={disabled}
      onCommit={(l, d) => {
        // R5.11: emptying the light value clears the whole property; an empty dark value writes a single colour.
        // A dark value typed with no light one is refused by the operation (with its message).
        if (l.trim() === '') store.apply(setStyleColor, i, prop, null, light === '' && d.trim() !== '' ? d : null);
        else store.apply(setStyleColor, i, prop, l, d.trim() === '' ? null : d);
      }}
    />
  );
}

function SelectProperty({ index: i, prop, raw, options, disabled }: {
  index: number;
  prop: 'border_style' | 'font_style';
  raw: unknown;
  options: readonly string[];
  disabled: boolean;
}) {
  const store = useStore();
  const value = rawText(raw);
  const all = value && !options.includes(value) ? [...options, value] : options;
  return (
    <span className="fm-ev-labelled" data-label={prop === 'border_style' ? 'style' : 'font'}>
      <select
        data-prop={prop}
        className="fm-ev-select"
        aria-label={PROP_LABEL[prop]}
        title={PROP_LABEL[prop]}
        value={value}
        disabled={disabled}
        onChange={(e) => store.apply(setStyleProp, i, prop, e.target.value || null)}
      >
        <option value="">default</option>
        {all.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </span>
  );
}

function NumberProperty({ index: i, raw, disabled }: { index: number; raw: unknown; disabled: boolean }) {
  const store = useStore();
  return (
    <span className="fm-ev-labelled" data-label="width">
      <CommitInput
        data-prop="border_width"
        type="number"
        min={1}
        max={4}
        step={1}
        className="fm-ev-input fm-ev-number"
        value={rawText(raw)}
        placeholder="–"
        aria-label={PROP_LABEL.border_width}
        title="Border width (1 to 4)"
        disabled={disabled}
        onCommit={(t) => {
          const s = t.trim();
          if (s === '') {
            store.apply(setStyleProp, i, 'border_width', null);
            return;
          }
          const n = Number(s);
          if (!Number.isInteger(n) || n < 1 || n > 4) {
            store.toast('Border width must be a whole number from 1 to 4');
            return;
          }
          store.apply(setStyleProp, i, 'border_width', n);
        }}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Conditions

const OPS: MatchOp[] = ['equals', 'present', 'absent'];
const OP_LABEL: Record<MatchOp, string> = { equals: 'equals', present: 'present', absent: 'absent' };

function valueOptions(config: FlowConfig, field: string, store: Store): string[] {
  const f = field.trim();
  if (!f) return [];
  const doc = store.getState().derived?.doc;
  if (f === 'lane') return (doc?.graph.lanes ?? []).map((l) => l.id).filter((id) => id !== UNASSIGNED);
  if (f === 'id') return (doc?.graph.nodes ?? []).map((n) => n.id);
  const out = fieldSuggestions(config, f);
  if (f === 'kind') for (const k of [...SHAPE_KINDS, 'wait']) if (!out.includes(k)) out.push(k);
  return out;
}

function toInput(op: MatchOp, value: string): MatchInput {
  return op === 'equals' ? { op, value } : { op };
}

/** An existing condition: each change is one edit (`editMatchCondition`), keeping its place in `match`. */
function MatchRow({ index: i, cond, config, listId, disabled }: {
  index: number;
  cond: MatchCondition;
  config: FlowConfig;
  listId: string;
  disabled: boolean;
}) {
  const store = useStore();
  // Switching to `equals` waits for a value before writing (one edit, not two).
  const [pendingEquals, setPendingEquals] = useState(false);
  const op: MatchOp = pendingEquals ? 'equals' : cond.op;
  const valuesId = `${listId}-v-${cond.field}`;
  const [fieldDraft, setFieldDraft] = useState(cond.field);
  const options = useMemo(() => valueOptions(config, fieldDraft, store), [config, fieldDraft, store]);
  return (
    <div className="fm-ev-match" data-testid="match-row">
      <CommitInput
        data-testid="match-field"
        className="fm-ev-input fm-ev-mono fm-ev-match-field"
        value={cond.field}
        list={listId}
        aria-label="Field"
        disabled={disabled}
        onDraft={setFieldDraft}
        onCommit={(f) => {
          const r = store.apply(editMatchCondition, i, cond.field, f.trim(), toInput(cond.op, cond.value));
          if (!r.ok) setFieldDraft(cond.field);
        }}
      />
      <select
        data-testid="match-op"
        className="fm-ev-select fm-ev-match-op"
        value={op}
        aria-label="Test"
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value as MatchOp;
          if (next === 'equals' && cond.op !== 'equals') {
            setPendingEquals(true);
            requestAnimationFrame(() => (e.target.parentElement?.querySelector('[data-testid="match-value"]') as HTMLInputElement | null)?.focus());
            return;
          }
          setPendingEquals(false);
          if (next !== cond.op) store.apply(editMatchCondition, i, cond.field, cond.field, toInput(next, cond.value));
        }}
      >
        {OPS.map((o) => (
          <option key={o} value={o}>{OP_LABEL[o]}</option>
        ))}
      </select>
      <CommitInput
        data-testid="match-value"
        className="fm-ev-input fm-ev-match-value"
        value={op === 'equals' && !pendingEquals ? cond.value : ''}
        list={valuesId}
        placeholder={op === 'equals' ? 'value' : '—'}
        aria-label="Value"
        disabled={disabled || op !== 'equals'}
        onCommit={(v) => {
          const r = store.apply(editMatchCondition, i, cond.field, cond.field, { op: 'equals', value: v });
          if (r.ok) setPendingEquals(false);
        }}
      />
      <datalist id={valuesId}>{options.map((o) => <option key={o} value={o} />)}</datalist>
      <IconButton label="Delete condition" data-testid="match-delete" className="fm-ev-danger" disabled={disabled} onClick={() => store.apply(removeMatchCondition, i, cond.field)}>
        {ico.x}
      </IconButton>
    </div>
  );
}

/**
 * A new condition (`match-add`): nothing is written until it is complete (a field, and a value for `equals`), so
 * adding a condition is one edit.
 */
function DraftMatchRow({ index: i, config, listId, disabled, onDone }: {
  index: number;
  config: FlowConfig;
  listId: string;
  disabled: boolean;
  onDone: () => void;
}) {
  const store = useStore();
  const [field, setField] = useState('');
  const [op, setOp] = useState<MatchOp>('equals');
  const [value, setValue] = useState('');
  const options = useMemo(() => valueOptions(config, field, store), [config, field, store]);
  const valuesId = `${listId}-draft`;

  const tryCommit = (next: { field?: string; op?: MatchOp; value?: string } = {}) => {
    const f = (next.field ?? field).trim();
    const o = next.op ?? op;
    const v = next.value ?? value;
    if (!f || (o === 'equals' && v === '')) return;
    const r = store.apply(setMatchCondition, i, f, toInput(o, v));
    if (r.ok) onDone();
  };
  const enter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      tryCommit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onDone();
    }
  };

  return (
    <div className="fm-ev-match fm-ev-match-draft" data-testid="match-row" data-draft>
      <input
        data-testid="match-field"
        className="fm-ev-input fm-ev-mono fm-ev-match-field"
        value={field}
        list={listId}
        placeholder="field"
        aria-label="Field"
        autoFocus
        spellCheck={false}
        disabled={disabled}
        onChange={(e) => setField(e.target.value)}
        onKeyDown={enter}
        onBlur={() => tryCommit()}
      />
      <select
        data-testid="match-op"
        className="fm-ev-select fm-ev-match-op"
        value={op}
        aria-label="Test"
        disabled={disabled}
        onChange={(e) => {
          const o = e.target.value as MatchOp;
          setOp(o);
          tryCommit({ op: o });
        }}
      >
        {OPS.map((o) => (
          <option key={o} value={o}>{OP_LABEL[o]}</option>
        ))}
      </select>
      <input
        data-testid="match-value"
        className="fm-ev-input fm-ev-match-value"
        value={op === 'equals' ? value : ''}
        list={valuesId}
        placeholder={op === 'equals' ? 'value' : '—'}
        aria-label="Value"
        spellCheck={false}
        disabled={disabled || op !== 'equals'}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={enter}
        onBlur={() => tryCommit()}
      />
      <datalist id={valuesId}>{options.map((o) => <option key={o} value={o} />)}</datalist>
      <IconButton label="Discard this condition" data-testid="match-delete" className="fm-ev-danger" onClick={onDone}>
        {ico.x}
      </IconButton>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Styles YAML

function StylesYaml({ configText, disabled }: { configText: string | null; disabled: boolean }) {
  const store = useStore();
  const source = useMemo(() => new ConfigDoc(configText).stylesYaml(), [configText]);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    if (draft === null || draft === source) {
      setDraft(null);
      setError(null);
      return;
    }
    const r = store.apply(replaceStyles, draft);
    if (r.ok) {
      setDraft(null);
      setError(null);
    } else setError(r.error);
  };
  return (
    <section className="fm-ev-section fm-ev-yaml">
      <div className="fm-ev-section-head">
        <h3>All rules as YAML</h3>
        {draft !== null && draft !== source ? (
          <button type="button" className="fm-ev-link-btn" onClick={() => { setDraft(null); setError(null); }}>
            Revert
          </button>
        ) : null}
      </div>
      <AutoTextarea
        data-testid="styles-yaml"
        className="fm-ev-input fm-ev-code-area"
        value={draft ?? source}
        minRows={4}
        maxRows={16}
        placeholder={disabled ? '' : '- legend: One source only\n  match: {confidence: single-source}\n  style: {border_style: dashed}'}
        disabled={disabled}
        aria-label="The styles list as YAML"
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
        <span className="fm-ev-hint">Replaces every rule</span>
        <button type="button" data-testid="styles-yaml-apply" className="fm-btn fm-ev-btn" disabled={disabled} onClick={apply}>
          Apply YAML
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Registration

/** The `styles-toggle` toolbar command (§8.3), listed by `commands/diagram.ts`. */
export const stylesToggleCommand: Command = {
  id: 'styles-toggle',
  title: 'Styles: how evidence looks',
  icon: icons.styles,
  enabled: (s) => s.status === 'ready',
  active: (s) => !!s.panels.styles,
  run: (store) => store.togglePanel('styles'),
};

sidePanels.push({ id: 'styles', when: (s) => !!s.panels.styles && s.status === 'ready', Component: StylesPanel });

