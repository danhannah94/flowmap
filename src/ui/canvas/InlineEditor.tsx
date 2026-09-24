// The in-place text editor (`label-editor`, `title-editor`, `id-editor`, §8.3). Enter commits, Escape cancels, and
// leaving the field commits. Anchored editors sit over their target in world coordinates; unanchored ones are a
// centred prompt (the add-lane prompt).
import { useEffect, useRef, useState } from 'react';
import type { EditRequest } from '../store/store';
import { useStore } from '../store/hooks';

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
    <div className={req.testid === 'id-editor' ? 'fm-editor-error' : 'fm-editor-error'} data-testid={req.testid === 'id-editor' ? 'id-error' : 'editor-error'}>
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
  const a = req.anchor;
  return (
    <div
      className={`fm-editor fm-editor-wrap-${req.variant ?? 'plain'}`}
      data-canvas-control
      style={{ left: a.x, top: a.y, width: a.width, height: a.height }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {input}
      {errorEl}
    </div>
  );
}
