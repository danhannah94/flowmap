// Notes and the title on the canvas (design.md §8.2 UI41, UI42; §8.3 "Notes", "Title"). Drawn in the world, on top of
// the diagram (they take no part in the layout rules and may sit over anything, §6), at the layout's boxes:
// `data-x` / `data-y` are the layout's integer diagram coordinates, as in `flowmap layout`.
//
// Each one handles its own pointer: a press selects it (on its own, UI10), a drag moves it (snapping to the blocks,
// and for a note to the other notes too, UI39; Alt turns snapping off), and the drop writes its position (one undo
// step). A note opens its editor on double-click; the title's double-click is UI22's (features/index.tsx).
import { memo, useEffect, useRef, useState } from 'react';
import { noteLineHeight, TITLE_FONT } from '../../core/measure';
import { resolveStyle, type Theme } from '../../core/theme';
import type { LayoutResult, LayoutTextBox } from '../../core/types';
import type { DocumentNote } from '../../core/document';
import { snapSession, type SnapSession } from '../snap/session';
import type { SnapBox } from '../snap/snap';
import { useSignal } from '../features/signal';
import { shallow, useStore, useStoreState } from '../store/hooks';
import type { Annotation, Store } from '../store/store';
import {
  annotationDrag, editNote, layoutBlocked, moveNoteTo, moveTitleTo, noteEditor, sameAnnotation, selectAnnotation,
} from './actions';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const DRAG_THRESHOLD = 3;

export function NotesLayer({ layout, notes, theme }: { layout: LayoutResult; notes: readonly DocumentNote[]; theme: Theme }) {
  const selected = useStoreState((s) => s.selection.annotation ?? null, shallow);
  const drag = useSignal(annotationDrag);
  const editor = useSignal(noteEditor);
  const titleEditing = useStoreState((s) => s.editing?.target.kind === 'title');
  const styles = new Map(notes.map((n) => [n.id, n]));
  const offset = (t: Annotation) => (drag && sameAnnotation(drag.target, t) ? drag : null);
  return (
    <div className="fm-annotations">
      {(layout.notes ?? []).map((box) => {
        const target: Annotation = { kind: 'note', id: box.id };
        const d = offset(target);
        return (
          <NoteView
            key={box.id}
            id={box.id}
            box={box}
            note={styles.get(box.id)}
            theme={theme}
            selected={sameAnnotation(selected, target)}
            dx={d?.dx ?? 0}
            dy={d?.dy ?? 0}
            editing={editor?.kind === 'edit' && editor.id === box.id}
          />
        );
      })}
      {layout.title ? (
        <TitleView
          box={layout.title}
          selected={selected?.kind === 'title'}
          dx={offset({ kind: 'title' })?.dx ?? 0}
          dy={offset({ kind: 'title' })?.dy ?? 0}
          editing={titleEditing}
        />
      ) : null}
    </div>
  );
}

const NoteView = memo(function NoteView({ id, box, note, theme, selected, dx, dy, editing }: {
  id: string;
  box: { id: string } & LayoutTextBox;
  note: DocumentNote | undefined;
  theme: Theme;
  selected: boolean;
  dx: number;
  dy: number;
  editing: boolean;
}) {
  const store = useStore();
  const size = note?.font_size ?? 14;
  const bold = note?.bold ?? false;
  const color = resolveStyle({ text_color: note?.color }, theme).textColor;
  const lineHeight = noteLineHeight(size);
  const handlers = useAnnotationPointer(store, { kind: 'note', id });
  return (
    <div
      className="fm-note"
      data-note-id={id}
      data-x={box.x}
      data-y={box.y}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dx !== 0 || dy !== 0 ? 'true' : undefined}
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        transform: dx || dy ? `translate(${dx}px, ${dy}px)` : undefined,
        fontSize: size,
        lineHeight: `${lineHeight}px`,
        fontWeight: bold ? 700 : 400,
        color,
      }}
      {...handlers}
      onDoubleClick={(e) => {
        e.stopPropagation();
        editNote(store, id);
      }}
    >
      {/* The note's text as is (white-space: pre keeps its line breaks), so the element's text is the note's. */}
      <span className="fm-note-text" style={{ visibility: editing ? 'hidden' : undefined }}>{box.text}</span>
    </div>
  );
});

const TitleView = memo(function TitleView({ box, selected, dx, dy, editing }: {
  box: LayoutTextBox;
  selected: boolean;
  dx: number;
  dy: number;
  editing: boolean;
}) {
  const store = useStore();
  const handlers = useAnnotationPointer(store, { kind: 'title' });
  return (
    <div
      data-testid="title"
      className="fm-title fm-title-movable"
      data-x={box.x}
      data-y={box.y}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dx !== 0 || dy !== 0 ? 'true' : undefined}
      style={{
        left: box.x,
        top: box.y,
        minWidth: box.width,
        height: TITLE_FONT.lineHeight,
        transform: dx || dy ? `translate(${dx}px, ${dy}px)` : undefined,
        visibility: editing ? 'hidden' : undefined,
      }}
      {...handlers}
    >
      {box.text}
    </div>
  );
});

/**
 * Press, drag and drop for a note or the title. Returns the element's pointer handlers. A press selects it; past a
 * few pixels it is a drag (unless the layout file has errors, UI31), previewed through `annotationDrag`, snapped
 * (UI39), and written on release. Escape or a lost pointer cancels.
 */
function useAnnotationPointer(store: Store, target: Annotation) {
  const session = useRef<{
    pointerId: number;
    start: { x: number; y: number };
    zoom: number;
    box: SnapBox;
    dragging: boolean;
    blocked: string | null;
    snapper: SnapSession | null;
  } | null>(null);
  const [active, setActive] = useState(false);

  const end = () => {
    session.current?.snapper?.end();
    session.current = null;
    setActive(false);
    annotationDrag.set((d) => (d && sameAnnotation(d.target, target) ? null : d));
  };

  // Escape cancels a drag in progress.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !session.current?.dragging) return;
      e.preventDefault();
      e.stopPropagation();
      end();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `end` only touches refs and the signal
  }, [active]);

  const offset = (e: React.PointerEvent) => {
    const s = session.current!;
    return { dx: (e.clientX - s.start.x) / s.zoom, dy: (e.clientY - s.start.y) / s.zoom };
  };

  return {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      // Right-click (and Ctrl+click on a Mac) is the context menu's (UI40); the middle button pans (the canvas's).
      if (e.button !== 0 || (IS_MAC && e.ctrlKey)) return;
      e.stopPropagation(); // not a pan or a selection box
      // Leaving an open editor commits it (as a press anywhere on the canvas does).
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && active.closest('[data-canvas-control]')) active.blur();
      selectAnnotation(store, target);
      const box = boxOf(store, target);
      if (!box) return;
      session.current = {
        pointerId: e.pointerId,
        start: { x: e.clientX, y: e.clientY },
        zoom: store.getState().viewport.zoom,
        box,
        dragging: false,
        blocked: layoutBlocked(store),
        snapper: null,
      };
      setActive(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointers can't be captured */
      }
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      const s = session.current;
      if (!s || s.pointerId !== e.pointerId) return;
      if (!s.dragging) {
        if (Math.abs(e.clientX - s.start.x) <= DRAG_THRESHOLD && Math.abs(e.clientY - s.start.y) <= DRAG_THRESHOLD) return;
        if (s.blocked) return;
        s.dragging = true;
        s.snapper = snapSession(store, s.box, snapTargets(store, target));
      }
      const raw = offset(e);
      const d = s.snapper!.offset(raw.dx, raw.dy, e.altKey);
      annotationDrag.set({ target, dx: d.dx, dy: d.dy });
    },
    onPointerUp(e: React.PointerEvent<HTMLElement>) {
      const s = session.current;
      if (!s || s.pointerId !== e.pointerId) return;
      if (!s.dragging) {
        const moved = Math.abs(e.clientX - s.start.x) > DRAG_THRESHOLD || Math.abs(e.clientY - s.start.y) > DRAG_THRESHOLD;
        if (s.blocked && moved) store.toast(s.blocked, 'info');
        end();
        return;
      }
      const raw = offset(e);
      const d = s.snapper!.offset(raw.dx, raw.dy, e.altKey);
      const at = { x: s.box.x + d.dx, y: s.box.y + d.dy };
      end();
      if (target.kind === 'title') moveTitleTo(store, at);
      else moveNoteTo(store, target.id, at);
    },
    onPointerCancel(e: React.PointerEvent<HTMLElement>) {
      if (session.current?.pointerId === e.pointerId) end();
    },
    // A right-click selects it too, as it does a block (its menu then opens on it, UI40).
    onContextMenu() {
      selectAnnotation(store, target);
    },
  };
}

function boxOf(store: Store, target: Annotation): SnapBox | null {
  const layout = store.layout;
  const b = target.kind === 'title' ? layout?.title : layout?.notes?.find((n) => n.id === target.id);
  return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null;
}

/** UI39: a note snaps to the blocks and the other notes; the title to the blocks. */
function snapTargets(store: Store, target: Annotation): SnapBox[] {
  const layout = store.layout;
  if (!layout) return [];
  const box = (b: SnapBox): SnapBox => ({ x: b.x, y: b.y, width: b.width, height: b.height });
  const out = layout.nodes.map(box);
  if (target.kind === 'note') for (const n of layout.notes ?? []) if (n.id !== target.id) out.push(box(n));
  return out;
}
