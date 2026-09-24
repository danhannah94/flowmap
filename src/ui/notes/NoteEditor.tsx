// The note editor (design.md §8.2 UI41, §8.3 `note-editor`): a textarea over the note, in screen space so it stays
// readable at any zoom (like the other in-place editors), growing with the text. Enter adds a line; Cmd/Ctrl+Enter or
// clicking away commits; Escape cancels. A new note is written only by its first commit with some text (one undo
// step); committing blank text in an existing note deletes it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { noteLineHeight } from '../../core/measure';
import { useCanvasWrap } from '../canvas/connect';
import { useSignal } from '../features/signal';
import { shallow, useStore, useStoreState } from '../store/hooks';
import { commitNote, noteEditor, type NoteDraft } from './actions';

export function NoteEditorHost() {
  const draft = useSignal(noteEditor);
  const wrap = useCanvasWrap();
  // Close the editor when the diagram goes away (another file opened) or its note was deleted from outside.
  const gone = useStoreState((s) =>
    !!draft && (s.status !== 'ready' || (draft.kind === 'edit' && !s.shown?.layout?.notes?.some((n) => n.id === draft.id))),
  );
  useEffect(() => {
    if (gone) noteEditor.set(null);
  }, [gone]);
  if (!draft || !wrap || gone) return null;
  return createPortal(<NoteEditor key={draft.seq} draft={draft} />, wrap);
}

const MIN_FONT = 13;
const MIN_WIDTH = 180;
const MARGIN = 8;

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function NoteEditor({ draft }: { draft: NoteDraft }) {
  const store = useStore();
  const viewport = useStoreState((s) => s.viewport, shallow);
  const size = useStoreState((s) => s.viewportSize, shallow);
  const box = useStoreState((s) => (draft.kind === 'edit' ? s.shown?.layout?.notes?.find((n) => n.id === draft.id) ?? null : null));
  const style = useStoreState((s) => (draft.kind === 'edit' ? s.derived?.doc.notes.find((n) => n.id === draft.id) ?? null : null));
  const [value, setValue] = useState(() => box?.text ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const done = useRef(false);
  const latest = useRef(value);
  latest.current = value;

  const fontSize = style?.font_size ?? 14;
  const bold = style?.bold ?? false;
  const at = draft.kind === 'new' ? draft.at : box ? { x: box.x, y: box.y } : { x: 0, y: 0 };

  // Screen size of the text: the note's own size at this zoom, but never below MIN_FONT (a fitted big diagram) nor
  // above the larger of 20 px and the note's own size (zoomed far in).
  const font = Math.round(Math.min(Math.max(20, fontSize), Math.max(MIN_FONT, fontSize * viewport.zoom)) * 10) / 10;
  const line = Math.round((font * noteLineHeight(fontSize)) / fontSize);
  const padX = Math.round(font * 0.55);
  const padY = Math.round(font * 0.4);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (noteEditor.get() === draft) noteEditor.set(null);
    if (commit) commitNote(store, draft, latest.current);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (draft.kind === 'edit') el.select();
  }, [draft]);

  // Clicking away commits: a press anywhere outside the editor (blur covers most cases; this covers presses that
  // don't move the focus, such as on the canvas under pointer capture).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && wrap.current?.contains(e.target)) return;
      finish(true);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `finish` reads refs only
  }, []);

  // Size and place it after every render: it grows with the text (width by the longest line, height by the lines),
  // starts at the note's top-left, and is kept inside the canvas.
  useLayoutEffect(() => {
    const el = wrap.current;
    const ta = ref.current;
    const m = measure.current;
    if (!el || !ta || !m) return;
    const z = viewport.zoom;
    const maxWidth = Math.max(MIN_WIDTH, size.width - MARGIN * 2);
    const lines = Math.max(1, latest.current.split('\n').length);
    const width = Math.round(Math.min(maxWidth, Math.max(MIN_WIDTH, m.offsetWidth + padX * 2 + font * 1.5 + 4)));
    const height = Math.round(lines * line + padY * 2 + 3);
    ta.style.width = `${width}px`;
    ta.style.height = `${height}px`;
    let left = at.x * z + viewport.x - padX - 1.5;
    let top = at.y * z + viewport.y - padY - 1.5;
    left = Math.min(Math.max(left, MARGIN), Math.max(MARGIN, size.width - width - MARGIN));
    top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, size.height - el.offsetHeight - MARGIN));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  });

  const hint = `${isMac() ? '⌘' : 'Ctrl+'}↵ to save · Esc to cancel${draft.kind === 'edit' ? ' · empty deletes' : ''}`;
  return (
    <div
      ref={wrap}
      className="fm-note-editor"
      data-canvas-control
      style={{
        ['--note-font' as string]: `${font}px`,
        ['--note-line' as string]: `${line}px`,
        ['--note-pad' as string]: `${padY}px ${padX}px`,
        ['--note-weight' as string]: bold ? 700 : 400,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span ref={measure} className="fm-note-editor-measure" aria-hidden="true">
        {longestLine(value) || 'Note'}
      </span>
      <textarea
        ref={ref}
        data-testid="note-editor"
        className="fm-note-editor-input"
        value={value}
        placeholder="Note"
        wrap="off"
        spellCheck
        rows={1}
        aria-label={draft.kind === 'new' ? 'New note' : 'Edit note'}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation(); // no shortcuts while typing
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            finish(true);
          }
        }}
        onBlur={() => finish(true)}
      />
      <div className="fm-note-editor-hint">{hint}</div>
    </div>
  );
}

function longestLine(text: string): string {
  let best = '';
  for (const l of text.split('\n')) if (l.length > best.length) best = l;
  return best;
}
