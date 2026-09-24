// The in-place text editor (`label-editor`, `title-editor`, `id-editor`, §8.3). Enter commits, Escape cancels, and
// leaving the field commits. Anchored editors (blocks, lines, lanes, the title) sit over their target at a readable
// size whatever the zoom; unanchored ones are a centred prompt (the add-lane prompt).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { EditRequest } from '../store/store';
import { shallow, useStore, useStoreState } from '../store/hooks';
import type { Rect } from './viewport';

export function InlineEditor({ req }: { req: EditRequest }) {
  const store = useStore();
  const [value, setValue] = useState(req.initial);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, []);

  const commit = () => {
    if (done.current) return;
    const err = req.commit(value);
    if (typeof err === 'string' && err) {
      setError(err);
      return;
    }
    done.current = true;
    if (store.getState().editing === req) store.endEdit();
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    req.cancel?.();
    if (store.getState().editing === req) store.endEdit();
  };

  const input = (
    <input
      ref={ref}
      data-testid={req.testid}
      className={`fm-editor-input fm-editor-${req.variant ?? 'plain'}`}
      value={value}
      placeholder={req.placeholder}
      spellCheck={false}
      onChange={(e) => {
        setValue(e.target.value);
        setError(null);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={() => {
        // Leaving the field commits, unless an error is showing (the person must fix or cancel it).
        if (!error) commit();
      }}
    />
  );
  const errorEl = error ? (
    <div className="fm-editor-error" data-testid={req.testid === 'id-editor' ? 'id-error' : 'editor-error'}>
      {error}
    </div>
  ) : null;

  if (!req.anchor) {
    return (
      <div className="fm-prompt-backdrop" data-canvas-control>
        <div className="fm-prompt">
          {req.placeholder ? <div className="fm-prompt-title">{req.placeholder}</div> : null}
          {input}
          {errorEl}
          <div className="fm-prompt-hint">Enter to confirm, Esc to cancel</div>
        </div>
      </div>
    );
  }
  return (
    <AnchoredEditor
      anchor={req.anchor}
      variant={req.variant ?? 'plain'}
      align={req.align ?? (req.variant === 'title' ? 'start' : 'center')}
      text={value || req.placeholder || ''}
    >
      {input}
      {errorEl}
    </AnchoredEditor>
  );
}

/**
 * Text sizes for the in-place editors, in screen px: the text they edit, scaled with the zoom, but never smaller than
 * `min` (readable when a big diagram is fitted at ~35%) nor larger than `max` (zoomed far in).
 */
const FONT = {
  label: { base: 13, line: 18, min: 13, max: 20, minWidth: 150 },
  plain: { base: 13, line: 18, min: 13, max: 20, minWidth: 150 },
  title: { base: 20, line: 28, min: 16, max: 28, minWidth: 320 },
} as const;

/**
 * An in-place editor, drawn in screen space over its target (`anchor`, world coordinates) so it stays readable at any
 * zoom: centred on the target or from its start edge (`align`), at least as wide as the target, growing with the
 * text, and kept inside the canvas. It follows the view if it pans or zooms while open.
 */
function AnchoredEditor({ anchor, variant, align, text, children }: {
  anchor: Rect;
  variant: 'label' | 'title' | 'plain';
  align: 'center' | 'start';
  text: string;
  children: ReactNode;
}) {
  const viewport = useStoreState((s) => s.viewport, shallow);
  const size = useStoreState((s) => s.viewportSize, shallow);
  const wrap = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const f = FONT[variant];
  const font = Math.round(Math.min(f.max, Math.max(f.min, f.base * viewport.zoom)) * 10) / 10;
  const line = Math.round((font * f.line) / f.base);
  const padX = Math.round(font * 0.62);
  const padY = Math.round(font * 0.42);

  // Size and place it after each render (the text, the view or the canvas changed): the input grows with the text,
  // and the whole editor is nudged back inside the canvas if the target is near an edge.
  useLayoutEffect(() => {
    const el = wrap.current;
    const input = el?.querySelector<HTMLInputElement>('input');
    if (!el || !input || !measure.current) return;
    const z = viewport.zoom;
    const target = { x: anchor.x * z + viewport.x, y: anchor.y * z + viewport.y, width: anchor.width * z, height: anchor.height * z };
    const margin = 8;
    const maxWidth = Math.max(f.minWidth, size.width - margin * 2);
    const textWidth = measure.current.offsetWidth + padX * 2 + font * 1.5 + 3; // room for the caret and a next letter
    const width = Math.round(Math.min(maxWidth, Math.max(f.minWidth, target.width + (variant === 'title' ? 0 : 16), textWidth)));
    input.style.width = `${width}px`;
    const h = input.offsetHeight;
    let left = align === 'start' ? target.x : target.x + target.width / 2 - width / 2;
    let top = target.y + target.height / 2 - h / 2;
    left = Math.min(Math.max(left, margin), Math.max(margin, size.width - width - margin));
    top = Math.min(Math.max(top, margin), Math.max(margin, size.height - el.offsetHeight - margin));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.width = `${width}px`;
  });

  return (
    <div
      ref={wrap}
      className={`fm-editor fm-editor-wrap-${variant}`}
      data-canvas-control
      style={{ ['--editor-font' as string]: `${font}px`, ['--editor-line' as string]: `${line}px`, ['--editor-pad' as string]: `${padY}px ${padX}px` }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span ref={measure} className={`fm-editor-measure${variant === 'title' ? ' fm-measure-title' : ''}`} aria-hidden="true">
        {text}
      </span>
      {children}
    </div>
  );
}
