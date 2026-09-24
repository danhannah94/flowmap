// Error banner (UI31), notices and toasts (UI28, UI30), the confirmation dialog, and the side-panel slot.
import type { ComponentType } from 'react';
import type { Problem } from '../../core/types';
import type { State } from '../store/store';
import { useStore, useStoreState } from '../store/hooks';

/**
 * Extra content inside a problem row, by code (UI27 adds `orphan-delete` buttons for the W-…-unknown-… warnings).
 * Features register renderers here instead of editing the banner.
 */
export const problemExtras = new Map<string, ComponentType<{ problem: Problem }>>();

export function ErrorBanner() {
  const problems = useStoreState((s) => s.derived?.doc.problems ?? null);
  const readOnly = useStoreState((s) => s.derived?.readOnly ?? false);
  const configBroken = useStoreState((s) => s.derived?.configBroken ?? false);
  const layoutBroken = useStoreState((s) => s.derived?.layoutBroken ?? false);
  if (!problems) return null;
  const all = [...problems.errors.map((p) => ({ p, level: 'error' as const })), ...problems.warnings.map((p) => ({ p, level: 'warning' as const }))];
  if (all.length === 0) return null;
  const nErr = problems.errors.length;
  const nWarn = problems.warnings.length;
  let summary = [nErr ? `${nErr} error${nErr > 1 ? 's' : ''}` : '', nWarn ? `${nWarn} warning${nWarn > 1 ? 's' : ''}` : '']
    .filter(Boolean)
    .join(', ');
  if (readOnly) summary += ': the .mmd file has errors, so the diagram is read-only until it is fixed';
  else if (configBroken && layoutBroken) summary += ': default styles, no pins, dragging and config editing are off';
  else if (configBroken) summary += ': drawn with default styles; config editing is off';
  else if (layoutBroken) summary += ': drawn without pins; dragging and pinning are off';
  return (
    <section className={`fm-problems${nErr ? ' fm-has-errors' : ''}`} aria-label="Problems">
      <div className="fm-problems-summary">{summary}</div>
      <ul data-testid="errors" className="fm-problems-list">
        {all.map(({ p, level }, i) => {
          const Extra = problemExtras.get(p.code);
          return (
            <li key={i} data-code={p.code} className={`fm-problem fm-${level}`}>
              <span className="fm-problem-code">{p.code}</span>
              <span className="fm-problem-where">{p.line !== null ? `line ${p.line}` : fileOf(p.code)}</span>
              <span className="fm-problem-msg">{p.message}</span>
              {Extra ? <Extra problem={p} /> : null}
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

export function SidePanels() {
  const visible = useStoreState((s) => sidePanels.filter((p) => p.when(s)).map((p) => p.id).join(' '));
  if (!visible) return null;
  const ids = visible.split(' ');
  return (
    <aside className="fm-side">
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
