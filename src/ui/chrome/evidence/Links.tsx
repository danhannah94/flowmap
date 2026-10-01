// A15: a block's link to another diagram (design.md §4 "A block can link to another diagram"). Stored as the
// reserved `link` metadata key (model.ts's LINK_KEY); this feature owns its own inspector section (the "Links to"
// field, a picker of the diagrams the server already lists for the home page) and its own context-menu item
// ("Link to diagram…", UI40's pattern for a feature-owned control). Following a link, the badge drawn on a linked
// block and Cmd/Ctrl+click live in ui/links.ts and canvas/NodeView.tsx and gestures.ts.
//
// Why lock logic is duplicated here instead of imported from Inspector.tsx: same reason as BlockColors.tsx (avoids
// an import cycle, since Inspector.tsx pushes this component into its own tree at module load).
import { useEffect, useMemo, useState } from 'react';
import { linkOf } from '../../../core/config';
import { clearNodeLink, setNodeLink } from '../../../core/ops';
import { listDiagrams } from '../../api';
import { defineMenuItem, registerMenuHandler, type MenuContext } from '../../contextmenu/registry';
import { linkHref } from '../../links';
import { useStore, useStoreState } from '../../store/hooks';
import type { State, Store } from '../../store/store';
import { CommitInput } from './controls';

/** Why config editing is off (UI26, UI31), or null. (Inspector's `configLock`, kept here to avoid an import cycle.) */
function lockOf(s: State): string | null {
  if (!s.derived) return 'Loading';
  if (s.derived.readOnly) return 'The .mmd file has errors, so the diagram is read-only until it’s fixed.';
  if (s.derived.configBroken) return 'The config file (.flow.yaml) has errors, so the link can’t be set until it’s fixed.';
  return null;
}

/** The diagrams the server lists (§8.2, reused from the home page's `GET /api/diagrams`), as link targets (their
 *  `.mmd` name without the extension). Fetched once per module load and cached briefly: the inspector opens and
 *  closes far more often than diagrams are added, so a short cache avoids re-fetching on every selection change
 *  while still picking up a newly added diagram within a few seconds. */
let cache: { at: number; targets: string[] } | null = null;
const CACHE_MS = 15000;

async function diagramTargets(): Promise<string[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.targets;
  const files = await listDiagrams();
  const targets = files.map((f) => f.replace(/\.mmd$/i, '')).sort();
  cache = { at: Date.now(), targets };
  return targets;
}

function useDiagramTargets(): string[] | null {
  const [targets, setTargets] = useState<string[] | null>(cache?.targets ?? null);
  useEffect(() => {
    let alive = true;
    diagramTargets().then((t) => {
      if (alive) setTargets(t);
    }, () => {});
    return () => {
      alive = false;
    };
  }, []);
  return targets;
}

/** Set (or clear, for blank text) a block's link, showing a refusal message if the target isn't well-formed. */
function commitLink(store: Store, id: string, raw: string, setError: (e: string | null) => void): void {
  setError(null);
  const r = raw.trim() === '' ? store.apply(clearNodeLink, id) : store.apply(setNodeLink, id, raw);
  if (!r.ok) setError(r.error);
}

// ---------------------------------------------------------------------------------------------------------------
// The inspector section

export function Links({ id }: { id: string }) {
  const store = useStore();
  const link = useStoreState((s) => linkOf(s.derived?.doc.config?.nodes[id]));
  const currentFile = useStoreState((s) => s.file.replace(/\.mmd$/i, ''));
  const lock = useStoreState(lockOf);
  const off = lock !== null;
  const targets = useDiagramTargets();
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => (targets ?? []).filter((t) => t !== currentFile && t !== link), [targets, currentFile, link]);
  const href = link ? linkHref(link) : null;

  return (
    <section className="fm-ev-section fm-links" data-testid="link-field" aria-label="Links to">
      <div className="fm-ev-section-head">
        <h3>Links to</h3>
        {href ? (
          <a
            data-testid="link-open"
            className="fm-ev-link-btn"
            href={href}
            onClick={(e) => {
              e.preventDefault();
              location.href = href;
            }}
          >
            Open →
          </a>
        ) : null}
      </div>
      {lock && lock !== 'Loading' ? <p className="fm-ev-empty">{lock}</p> : null}
      <div className="fm-links-row">
        <CommitInput
          data-testid="link-input"
          className="fm-ev-input fm-ev-grow"
          value={link ?? ''}
          placeholder="e.g. sales/stage-2"
          disabled={off}
          aria-label="Links to another diagram"
          onCommit={(text) => commitLink(store, id, text, setError)}
        />
        <button
          type="button"
          data-testid="link-clear"
          className="fm-ev-link-btn"
          disabled={off || !link}
          onClick={() => store.apply(clearNodeLink, id)}
        >
          Clear
        </button>
      </div>
      {error ? <div className="fm-ev-form-error" data-testid="link-error" role="alert">{error}</div> : null}
      {!off && options.length > 0 ? (
        <div className="fm-ev-quick" aria-label="Diagrams">
          {options.map((t) => (
            <button
              key={t}
              type="button"
              data-testid="link-suggestion"
              className="fm-ev-chip fm-ev-chip-btn"
              onClick={() => commitLink(store, id, t, setError)}
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The context menu (UI40 pattern): "Link to diagram…" opens the same input and suggestions inside the menu.

const LINK_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </svg>
);

defineMenuItem({ on: 'block', name: 'link', label: 'Link to diagram…', icon: LINK_ICON, section: 1, order: 5 });

function LinkMenuControl({ ctx }: { ctx: MenuContext<'block'> }) {
  const id = ctx.target.clicked;
  const link = useStoreState((s) => linkOf(s.derived?.doc.config?.nodes[id]));
  const currentFile = useStoreState((s) => s.file.replace(/\.mmd$/i, ''));
  const targets = useDiagramTargets();
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => (targets ?? []).filter((t) => t !== currentFile && t !== link), [targets, currentFile, link]);
  return (
    <div className="fm-links-menu">
      <div className="fm-links-row">
        <CommitInput
          data-testid="link-input"
          className="fm-ev-input fm-ev-grow"
          value={link ?? ''}
          placeholder="e.g. sales/stage-2"
          autoFocus
          aria-label="Links to another diagram"
          onCommit={(text) => commitLink(ctx.store, id, text, setError)}
        />
        <button type="button" data-testid="link-clear" className="fm-ev-link-btn" disabled={!link} onClick={() => ctx.store.apply(clearNodeLink, id)}>
          Clear
        </button>
      </div>
      {error ? <div className="fm-ev-form-error" data-testid="link-error" role="alert">{error}</div> : null}
      {options.length > 0 ? (
        <div className="fm-ev-quick" aria-label="Diagrams">
          {options.map((t) => (
            <button key={t} type="button" data-testid="link-suggestion" className="fm-ev-chip fm-ev-chip-btn" onClick={() => commitLink(ctx.store, id, t, setError)}>
              {t}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

registerMenuHandler('block', 'link', {
  Control: LinkMenuControl,
  disabled: ({ store }) => lockOf(store.getState()),
});
