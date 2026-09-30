// Error banner (UI31), notices and toasts (UI28, UI30), the confirmation dialog, and the side-panel slot.
import { useEffect, useLayoutEffect, useMemo, useState, type ComponentType } from 'react';
import { isLaneFree, type Problem } from '../../core/types';
import type { State } from '../store/store';
import { useStore, useStoreState } from '../store/hooks';
import { loadDismissed, pruneDismissed, saveDismissed, warningKey } from './dismissedWarnings';

/**
 * Extra content inside a problem row, by code (UI27 adds `orphan-delete` buttons for the W-…-unknown-… warnings).
 * Features register renderers here instead of editing the banner.
 */
export const problemExtras = new Map<string, ComponentType<{ problem: Problem }>>();

export function ErrorBanner() {
  const file = useStoreState((s) => s.file);
  const problems = useStoreState((s) => s.derived?.doc.problems ?? null);
  const readOnly = useStoreState((s) => s.derived?.readOnly ?? false);
  const configBroken = useStoreState((s) => s.derived?.configBroken ?? false);
  const layoutBroken = useStoreState((s) => s.derived?.layoutBroken ?? false);
  const laneFree = useStoreState((s) => !!s.derived && isLaneFree(s.derived.doc.graph.lanes));
  // Amendment A9: warnings (never errors) can be dismissed, per diagram, keyed by code+message so a dismissal
  // survives the line moving as the person edits. `dismissed` is loaded from localStorage for the current file and
  // pruned whenever the active warnings change, so fixing a warning's cause forgets its dismissal (§ dismissedWarnings.ts).
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => loadDismissed(file));
  useEffect(() => setDismissed(loadDismissed(file)), [file]);

  // Amendment A4: in a diagram without subgraphs every block is meant to be unlaned, so "not in any subgraph"
  // (W-no-lane, which `flowmap validate` still reports, §3.2) is no news here and isn't listed.
  const warnings = useMemo(
    () => (laneFree ? (problems?.warnings ?? []).filter((p) => p.code !== 'W-no-lane') : problems?.warnings ?? []),
    [laneFree, problems],
  );
  const activeWarningKeys = useMemo(() => new Set(warnings.map(warningKey)), [warnings]);

  useEffect(() => {
    const pruned = pruneDismissed(dismissed, activeWarningKeys);
    if (pruned.size !== dismissed.size) {
      setDismissed(pruned);
      saveDismissed(file, pruned);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-check when the active warnings (or file)
    // change; `dismissed` also changes when we prune it ourselves, which would otherwise loop.
  }, [activeWarningKeys, file]);

  const dismiss = (keys: readonly string[]) => {
    const next = new Set(dismissed);
    for (const k of keys) next.add(k);
    setDismissed(next);
    saveDismissed(file, next);
  };

  if (!problems) return null;
  const visibleWarnings = warnings.filter((p) => !dismissed.has(warningKey(p)));
  const all = [
    ...problems.errors.map((p) => ({ p, level: 'error' as const })),
    ...visibleWarnings.map((p) => ({ p, level: 'warning' as const })),
  ];
  if (all.length === 0) return null;
  const nErr = problems.errors.length;
  const nWarn = visibleWarnings.length;
  let summary = [nErr ? `${nErr} error${nErr > 1 ? 's' : ''}` : '', nWarn ? `${nWarn} warning${nWarn > 1 ? 's' : ''}` : '']
    .filter(Boolean)
    .join(', ');
  if (readOnly) summary += ': the .mmd file has errors, so the diagram is read-only until it is fixed';
  else if (configBroken && layoutBroken) summary += ': default styles, no pins, dragging and config editing are off';
  else if (configBroken) summary += ': drawn with default styles; config editing is off';
  else if (layoutBroken) summary += ': drawn without pins; dragging and pinning are off';
  return (
    <section className={`fm-problems${nErr ? ' fm-has-errors' : ''}`} aria-label="Problems">
      <div className="fm-problems-summary">
        <span>{summary}</span>
        {nWarn > 0 ? (
          <button
            type="button"
            data-testid="dismiss-all-warnings"
            className="fm-dismiss-all"
            onClick={() => dismiss(visibleWarnings.map(warningKey))}
          >
            Dismiss all warnings
          </button>
        ) : null}
      </div>
      <ul data-testid="errors" className="fm-problems-list">
        {all.map(({ p, level }, i) => {
          const Extra = problemExtras.get(p.code);
          return (
            <li key={i} data-code={p.code} className={`fm-problem fm-${level}`}>
              <span className="fm-problem-code">{p.code}</span>
              <span className="fm-problem-where">{p.line !== null ? `line ${p.line}` : fileOf(p.code)}</span>
              <span className="fm-problem-msg">{p.message}</span>
              {Extra ? <Extra problem={p} /> : null}
              {level === 'warning' ? (
                <button
                  type="button"
                  data-testid="dismiss-warning"
                  className="fm-problem-dismiss"
                  aria-label={`Dismiss warning: ${p.message}`}
                  title="Dismiss this warning"
                  onClick={() => dismiss([warningKey(p)])}
                >
                  ×
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function fileOf(code: string): string {
  if (code === 'E-layout' || code === 'W-layout-unknown-node') return '.layout.json';
  if (code.startsWith('E-config') || code.startsWith('W-config') || code === 'W-style') return '.flow.yaml';
  return '.mmd';
}

export function Notices() {
  const store = useStore();
  const notices = useStoreState((s) => s.notices);
  if (notices.length === 0) return null;
  return (
    <div className="fm-notices" aria-live="polite">
      {notices.map((n) => (
        <div
          key={n.id}
          className={`fm-notice fm-${n.tone}`}
          data-testid={n.kind === 'toast' ? 'toast' : n.kind}
          role={n.tone === 'error' ? 'alert' : 'status'}
        >
          <span>{n.text}</span>
          <button type="button" className="fm-notice-close" aria-label="Dismiss" onClick={() => store.dismiss(n.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function ConfirmDialog() {
  const req = useStoreState((s) => s.confirm);
  if (!req) return null;
  return (
    <div className="fm-modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && req.resolve(false)}>
      <div
        className="fm-modal"
        data-testid="confirm"
        role="alertdialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === 'Escape') req.resolve(false);
        }}
      >
        <div className="fm-modal-message">{req.message}</div>
        {req.detail ? <div className="fm-modal-detail">{req.detail}</div> : null}
        <div className="fm-modal-actions">
          <button type="button" className="fm-btn" data-testid="confirm-no" onClick={() => req.resolve(false)}>
            {req.no}
          </button>
          <button
            type="button"
            className={`fm-btn ${req.danger ? 'fm-btn-danger' : 'fm-btn-primary'}`}
            data-testid="confirm-yes"
            autoFocus
            onClick={() => req.resolve(true)}
          >
            {req.yes}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The right-hand side-panel slot (inspector UI24, styles UI25). Features register a panel with a `when` test; every
 * panel whose test passes is stacked in the column, in registration order.
 */
export interface SidePanel {
  id: string;
  when: (s: State) => boolean;
  Component: ComponentType;
}

export const sidePanels: SidePanel[] = [];

/** The column's width: the styles panel needs a little more room for its colour rows. */
export function sideColumnWidth(ids: readonly string[]): number {
  return ids.includes('styles') ? 392 : 340;
}

/**
 * How long the column waits to open after a press on the canvas where it would appear. Opening it at once would put
 * it under the pointer, so the second click of a double-click (UI8 on a block near the right edge) would land on the
 * panel instead of the block.
 */
const HOLD_MS = 350;

/** The last primary-button press anywhere on the page (window capture, so canvas pointer capture doesn't hide it). */
const press = { x: 0, y: 0, down: false, at: -Infinity, upAt: -Infinity };
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      Object.assign(press, { x: e.clientX, y: e.clientY, down: true, at: performance.now() });
    },
    true,
  );
  const up = () => {
    if (!press.down) return;
    press.down = false;
    press.upAt = performance.now();
  };
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
}

/** Is a recent press on the canvas inside the strip a column of `width` would cover? */
function pressUnderColumn(width: number): boolean {
  const recent = press.down || performance.now() - press.upAt < HOLD_MS;
  if (!recent || performance.now() - press.at > 2000) return false;
  const canvas = document.querySelector('[data-testid="canvas"]')?.getBoundingClientRect();
  if (!canvas) return false;
  return press.x >= canvas.right - width && press.x <= canvas.right && press.y >= canvas.top && press.y <= canvas.bottom;
}

export function SidePanels() {
  const wanted = useStoreState((s) => sidePanels.filter((p) => p.when(s)).map((p) => p.id).join(' '));
  const [visible, setVisible] = useState(wanted);
  // Opening waits while the press that caused it (or a double-click's second press) could still land under the
  // column; closing and switching panels are immediate. Once the column opens, the canvas narrows and keeps the
  // selected block in view (Store.setViewportSize).
  useLayoutEffect(() => {
    if (wanted === visible) return;
    if (visible === '' && wanted !== '' && pressUnderColumn(sideColumnWidth(wanted.split(' ')))) {
      let timer = 0;
      const tick = () => {
        if (!press.down && performance.now() - press.upAt >= HOLD_MS) setVisible(wanted);
        else timer = window.setTimeout(tick, 40);
      };
      timer = window.setTimeout(tick, 40);
      return () => clearTimeout(timer);
    }
    setVisible(wanted);
  }, [wanted, visible]);
  if (!visible) return null;
  const ids = visible.split(' ');
  return (
    <aside className="fm-side" style={{ width: sideColumnWidth(ids) }}>
      {sidePanels
        .filter((p) => ids.includes(p.id))
        .map((p) => (
          <p.Component key={p.id} />
        ))}
    </aside>
  );
}

/**
 * Editor-wide overlays that features mount once (dialogs, popovers, floating cards, document-level listeners), in
 * registration order, after the confirmation dialog. Each component decides for itself when to render anything.
 */
export const overlays: { id: string; Component: ComponentType }[] = [];

export function Overlays() {
  return (
    <>
      {overlays.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </>
  );
}
