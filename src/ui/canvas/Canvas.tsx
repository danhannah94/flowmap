// The diagram canvas: one transformed "world" (layout coordinates, §7) holding the title, lanes, edges, nodes and
// legend, plus pan (a trackpad's two-finger scroll, Space+drag or the middle button; A11: a plain drag on the
// background draws a selection box), zoom (a trackpad pinch, a mouse's scroll wheel, or Cmd/Ctrl+wheel, around the
// cursor; A14) and the pointer gestures (gestures.ts). A14: which way a wheel event goes is decided by
// `classifyWheel` (wheel-intent.ts); Safari reports a trackpad pinch as gesturestart/gesturechange/gestureend instead
// of Ctrl+wheel, handled separately below.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getTheme, type Theme } from '../../core/theme';
import { useStore, useStoreState } from '../store/hooks';
import { Legend } from './Decorations';
import { EdgesLayer } from './EdgesLayer';
import { gestureFor, hitTest, onDoubleClick, panGesture, type Gesture, type GestureContext, type Hit } from './gestures';
import { InlineEditor } from './InlineEditor';
import { LanesLayer } from './LanesLayer';
import { NodesLayer } from './NodesLayer';
import { getScrollPreference } from './scrollPreference';
import { toWorld } from './viewport';
import { classifyWheel, type StickyWheelState, type WheelSample } from './wheel-intent';
import { NotesLayer } from '../notes';
import { isTyping } from '../keyboard';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Safari's non-standard pinch-gesture event (no `lib.dom.d.ts` type for it): `scale` is relative to the gesture's
 *  start, 1 at `gesturestart`. Chromium and Firefox report the same gesture as Ctrl+wheel instead (handled by the
 *  wheel listener below), so this only ever fires in Safari. */
interface SafariGestureEvent extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}

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

  // Trackpad pinch is active (Safari's gesturestart..gestureend, below): the wheel listener leaves zooming to it,
  // since Safari can otherwise also deliver wheel events for the same physical gesture.
  const gestureActive = useRef(false);
  // The wheel classifier's sticky state (wheel-intent.ts): which way the current, still-continuing gesture goes.
  const stickyWheel = useRef<StickyWheelState | null>(null);

  // Wheel navigation (non-passive so the page itself never scrolls or zooms): pan or zoom, by `classifyWheel`.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element | null)?.closest?.('[data-canvas-control]')) return;
      e.preventDefault();
      if (gestureActive.current) return;
      const sample: WheelSample = {
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        wheelDeltaY: (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY,
      };
      const sticky = classifyWheel(sample, stickyWheel.current, e.timeStamp, getScrollPreference());
      stickyWheel.current = sticky;
      if (sticky.intent === 'zoom') {
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        const dy = e.deltaY * unit;
        const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
        store.zoomBy(factor, ctx.local(e));
      } else {
        // Pan: a trackpad's two-finger scroll moves both axes; a mouse's Shift+wheel (no deltaX) pans horizontally.
        const v = store.getState().viewport;
        const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        store.setViewport({ ...v, x: v.x - dx, y: v.y - dy });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [store, ctx]);

  // Safari's trackpad pinch: gesturestart/gesturechange/gestureend with `scale` (Chromium/Firefox report the same
  // gesture as Ctrl+wheel, above). Feature-detected, so this is a no-op everywhere else.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined' || !('GestureEvent' in window)) return;
    let last = 1;
    const start = (e: Event) => {
      e.preventDefault();
      gestureActive.current = true;
      last = 1;
    };
    const change = (e: Event) => {
      e.preventDefault();
      const ge = e as SafariGestureEvent;
      const factor = ge.scale / last;
      last = ge.scale;
      store.zoomBy(factor, ctx.local(ge));
    };
    const end = (e: Event) => {
      e.preventDefault();
      gestureActive.current = false;
    };
    el.addEventListener('gesturestart', start);
    el.addEventListener('gesturechange', change);
    el.addEventListener('gestureend', end);
    return () => {
      el.removeEventListener('gesturestart', start);
      el.removeEventListener('gesturechange', change);
      el.removeEventListener('gestureend', end);
    };
  }, [store, ctx]);

  // One gesture at a time; moves and the release are routed to it through pointer capture.
  const gesture = useRef<{ g: Gesture; pointerId: number } | null>(null);

  // Space held: a drag anywhere pans (A11). Not while typing, and not on a focused button (Space presses it).
  const [spaceHeld, setSpaceHeld] = useState(false);
  const space = useRef(false);
  useEffect(() => {
    const set = (on: boolean) => {
      if (space.current === on) return;
      space.current = on;
      setSpaceHeld(on);
    };
    const down = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (isTyping(e.target) || store.getState().editing) return;
      if (e.target instanceof HTMLElement && e.target.closest('button, a, [role="button"], [role="menuitem"]')) return;
      e.preventDefault(); // the page never scrolls
      set(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') set(false);
    };
    const off = () => set(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', off);
    };
  }, [store]);

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
    // A press on the canvas drops any text selected in a panel, so Cmd/Ctrl+C copies blocks again (A12).
    const textSel = window.getSelection();
    if (e.button === 0 && textSel && !textSel.isCollapsed) textSel.removeAllRanges();
    let g: Gesture | null = null;
    // The middle button, and a drag with Space held, pan from anywhere (A11). (v1.1: Alt+drag on a block moves it
    // without snapping, UI39; A11: a plain or Alt drag on the background draws a selection box.)
    if (e.button === 1 || (e.button === 0 && space.current)) {
      g = panGesture(ctx, native);
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
  // A11: Space+drag (and the middle button) pan from anywhere, including the handles that take their own press (a
  // lane's size or length handle, a block's resize handles, a note): the canvas claims such a press in the capture
  // phase, before any of them sees it. Controls (an open editor, a button) keep theirs.
  const onPointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!(e.button === 1 || (e.button === 0 && space.current))) return;
    if (hitTest(e.target).kind === 'control') return;
    onPointerDown(e);
    e.stopPropagation();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    store.notePointer(ctx.local(e));
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
      data-space-pan={spaceHeld ? 'true' : undefined}
      style={{
        ...themeVars(theme),
        // Handles and grips keep a usable on-screen size at low zoom (lines.css `.fm-port`, resize.css, EdgesLayer grips).
        ['--zoom' as string]: viewport.zoom,
        backgroundSize: `${grid}px ${grid}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => store.notePointer(null)}
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
    '--group-fill': t.groupFill,
    '--group-border': t.groupBorder,
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
