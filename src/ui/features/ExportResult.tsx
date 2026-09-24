// UI32: the export result, a small card under the export buttons: progress while the server renders, then the path
// it wrote (`data-testid="export-path"`, the path as text) with a copy button. Click elsewhere or × to dismiss.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, useStoreState } from '../store/hooks';

export function ExportResult() {
  const store = useStore();
  const path = useStoreState((s) => s.exportPath);
  const busy = useStoreState((s) => (s.panels['exporting-png'] ? 'PNG' : s.panels['exporting-svg'] ? 'SVG' : null));
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState<{ right: number; top: number }>({ right: 16, top: 62 });
  const ref = useRef<HTMLDivElement>(null);
  const visible = !!path || !!busy;

  // Sit under the export buttons.
  useLayoutEffect(() => {
    if (!visible) return;
    const btn = document.querySelector<HTMLElement>('[data-testid="export-png"]');
    const r = btn?.getBoundingClientRect();
    if (r) setPos({ right: Math.max(12, window.innerWidth - r.right - 8), top: r.bottom + 12 });
  }, [visible]);

  useEffect(() => setCopied(false), [path]);

  // Clicking anywhere else dismisses the result (not while an export is running).
  useEffect(() => {
    if (!path || busy) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('.fm-export-card')) return;
      store.set({ exportPath: null });
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [path, busy, store]);

  if (!visible) return null;
  const format = busy ?? (path!.toLowerCase().endsWith('.png') ? 'PNG' : 'SVG');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path!);
      setCopied(true);
    } catch {
      // No clipboard permission: select the text so Cmd/Ctrl+C works.
      const el = ref.current?.querySelector('[data-testid="export-path"]');
      if (el) window.getSelection()?.selectAllChildren(el);
    }
  };

  return (
    <div ref={ref} className="fm-export-card" role="status" aria-live="polite" style={{ right: pos.right, top: pos.top }}>
      <div className="fm-export-head">
        {busy ? <span className="fm-spinner" aria-hidden="true" /> : <span className="fm-export-ok" aria-hidden="true">✓</span>}
        <span className="fm-export-title">{busy ? `Exporting ${format}…` : `${format} exported`}</span>
        {busy ? null : <span className="fm-export-theme">light theme</span>}
        {busy ? null : (
          <button type="button" className="fm-notice-close" aria-label="Dismiss" onClick={() => store.set({ exportPath: null })}>
            ×
          </button>
        )}
      </div>
      {path && !busy ? (
        <div className="fm-export-body">
          <div className="fm-export-path" data-testid="export-path" title={path}>
            <span dir="ltr">{path}</span>
          </div>
          <button type="button" className="fm-btn fm-btn-small" data-testid="export-copy" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy path'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
