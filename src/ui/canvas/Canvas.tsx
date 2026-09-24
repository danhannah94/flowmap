// The diagram canvas: one transformed "world" (layout coordinates, §7) holding the title, lanes, edges, nodes and
// legend, plus pan (drag the background), zoom (wheel, or pinch = Ctrl+wheel) and the pointer gestures (gestures.ts).
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { getTheme, type Theme } from '../../core/theme';
import { useStore, useStoreState } from '../store/hooks';
import { Legend } from './Decorations';
import { EdgesLayer } from './EdgesLayer';
import { gestureFor, hitTest, onDoubleClick, type Gesture, type GestureContext, type Hit } from './gestures';
import { InlineEditor } from './InlineEditor';
import { LanesLayer } from './LanesLayer';
import { NodesLayer } from './NodesLayer';
import { toWorld } from './viewport';
import { NotesLayer } from '../notes';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function Canvas() {
  const store = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const shown = useStoreState((s) => s.shown);
  const themeName = useStoreState((s) => s.theme);
  const viewport = useStoreState((s) => s.viewport);
  const editing = useStoreState((s) => s.editing);
  const marquee = useStoreState((s) => s.marquee);
  const readOnly = useStoreState((s) => s.derived?.readOnly ?? false);
  const placing = useStoreState((s) => s.tool.kind === 'place');
  const dragging = useStoreState((s) => s.drag !== null);
  const direction = useStoreState((s) => s.derived?.doc.graph.direction ?? s.shown?.layout?.direction ?? 'LR');
  const theme = getTheme(themeName);
  const layout = shown?.layout ?? null;

  // Track the canvas size (for fit and zoom-to-centre).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => store.setViewportSize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    store.setViewportSize(el.clientWidth, el.clientHeight);
    return () => ro.disconnect();
  }, [store]);

  const ctx = useMemo<GestureContext>(() => {
    const local = (e: { clientX: number; clientY: number }) => {
      const r = ref.current!.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    return { store, local, world: (e) => toWorld(store.getState().viewport, local(e)) };
  }, [store]);

  // Wheel zoom (non-passive so the page itself never scrolls or zooms).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element | null)?.closest?.('[data-canvas-control]')) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dy = e.deltaY * unit;
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
      store.zoomBy(factor, ctx.local(e));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [store, ctx]);

  // One gesture at a time; moves and the release are routed to it through pointer capture.
  const gesture = useRef<{ g: Gesture; pointerId: number } | null>(null);

  // Whether a press is down (the store never moves the view under one) and where the last right-click was (the side
  // column opening from its menu keeps the diagram in view around it). A press ends after its gesture's handlers ran.
  useEffect(() => {
    let timer = 0;
    const end = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => store.endPress(), 0);
    };
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    window.addEventListener('blur', end);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      window.removeEventListener('blur', end);
    };
  }, [store]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    store.notePress(ctx.local(e), e.button);
    if (gesture.current) return;
    const native = e.nativeEvent;
    const hit: Hit = hitTest(e.target);
    if (hit.kind === 'control') return;
    // Close any open editor first (leaving it commits).
    const active = document.activeElement as HTMLElement | null;
    if (store.getState().editing && active && active !== document.body) active.blur();
    // macOS: Ctrl+click is a right-click (it opens the context menu, UI40), not a press on what is under it.
    if (e.button === 0 && native.ctrlKey && IS_MAC) return;
    let g: Gesture | null = null;
    // The middle button always pans. (v1.1: Alt+drag on a block moves it without snapping, UI39, so Alt no longer
    // pans from anywhere; Alt+drag on the background still pans, like any background drag.)
    if (e.button === 1) {
      g = gestureFor({ kind: 'background' }, native, ctx);
    } else if (e.button === 0) {
      g = gestureFor(hit, native, ctx);
      // Until a feature registers them, handles and edge ends act like their block or edge.
      if (!g && hit.kind === 'handle') g = gestureFor({ kind: 'node', id: hit.id }, native, ctx);
      if (!g && hit.kind === 'edge-end') g = gestureFor({ kind: 'edge', id: hit.id }, native, ctx);
    }
    if (!g) return;
    gesture.current = { g, pointerId: e.pointerId };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers can't be captured; moves still bubble here */
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const cur = gesture.current;
    if (cur && cur.pointerId === e.pointerId) cur.g.move(e.nativeEvent);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const cur = gesture.current;
    if (!cur || cur.pointerId !== e.pointerId) return;
    gesture.current = null;
    cur.g.up(e.nativeEvent);
  };
  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    const cur = gesture.current;
    if (!cur || cur.pointerId !== e.pointerId) return;
    gesture.current = null;
    cur.g.cancel();
  };

  // Escape cancels a drag in progress.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && gesture.current) {
        gesture.current.g.cancel();
        gesture.current = null;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const onDoubleClickCapture = (e: React.MouseEvent) => {
    // Pointer capture retargets click/dblclick to the canvas itself, so hit-test what is under the pointer.
    const hit = hitTest(document.elementFromPoint(e.clientX, e.clientY));
    if (hit.kind === 'control') return;
    if (onDoubleClick(store, hit)) e.preventDefault();
  };

  const world = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
  const grid = 24 * viewport.zoom;
  return (
    <div
      ref={ref}
      className="fm-canvas"
      data-testid="canvas"
      data-theme={themeName}
      data-direction={direction}
      data-readonly={readOnly ? 'true' : 'false'}
      data-placing={placing ? 'true' : undefined}
      data-dragging={dragging ? 'true' : undefined}
      style={{
        ...themeVars(theme),
        // Handles and grips keep a usable on-screen size at low zoom (lines.css `.fm-port`, resize.css, EdgesLayer grips).
        ['--zoom' as string]: viewport.zoom,
        backgroundSize: `${grid}px ${grid}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClickCapture}
      onContextMenu={(e) => {
        e.preventDefault();
        store.noteContextMenu(ctx.local(e));
      }}
    >
      <div className="fm-world" style={{ transform: world }}>
        {layout && shown ? (
          <>
            <LanesLayer layout={layout} theme={theme} />
            <EdgesLayer layout={layout} theme={theme} />
            <NodesLayer layout={layout} styles={shown.doc.styles} theme={theme} />
            {/* Notes and the title (UI41, UI42): on top, since they may sit over anything (§6). */}
            <NotesLayer layout={layout} notes={shown.doc.notes} theme={theme} />
            <Legend items={shown.doc.legend} layout={layout} theme={theme} />
          </>
        ) : null}
        {marquee ? (
          <div className="fm-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />
        ) : null}
      </div>
      {editing ? <InlineEditor key={editingKey(editing)} req={editing} /> : null}
      {!layout ? <EmptyCanvas /> : null}
    </div>
  );
}

/** The export palette (src/core/theme.ts) as CSS variables, so the canvas matches the SVG export. */
function themeVars(t: Theme): React.CSSProperties {
  return {
    '--canvas-bg': t.canvasBackground,
    '--lane-border': t.laneBorder,
    '--lane-label': t.laneLabel,
    '--title': t.titleColor,
    '--edge': t.edgeColor,
    '--edge-label-text': t.edgeLabelText,
    '--edge-label-bg': t.edgeLabelBackground,
    '--badge-fill': t.badgeFill,
    '--badge-text': t.badgeText,
    '--legend-text': t.legendText,
    '--node-fill': t.nodeFill,
  } as React.CSSProperties;
}

let editSeq = 0;
const editKeys = new WeakMap<object, number>();
function editingKey(req: object): number {
  let k = editKeys.get(req);
  if (k === undefined) editKeys.set(req, (k = ++editSeq));
  return k;
}

function EmptyCanvas() {
  const status = useStoreState((s) => s.status);
  const readOnly = useStoreState((s) => s.derived?.readOnly ?? false);
  if (status !== 'ready') return null;
  return (
    <div className="fm-empty">
      {readOnly ? 'This diagram can’t be drawn until the errors in its .mmd file are fixed.' : 'Nothing to show yet.'}
    </div>
  );
}
