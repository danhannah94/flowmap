// Pointer gestures on the canvas. `Canvas` hit-tests each pointerdown (what's under the pointer, by DOM attribute)
// and asks the handler registered for that kind of target for a `Gesture`, which then receives the moves and the
// release. Features add gestures with `registerGesture` (for example `handle` for connect, UI15, and `edge-end` for
// reconnect, UI16) without touching the canvas.
import { addBlock, dropNodes, editNodeLabel, pinningBlocked } from '../actions';
import { linkOf } from '../../core/config';
import { followLink } from '../links';
import { blockSnapSession } from '../snap/session';
import type { Store } from '../store/store';
import { containsRect, rectFromPoints, type Point } from './viewport';

export type Hit =
  | { kind: 'node'; id: string }
  | { kind: 'handle'; id: string; handle: 'source' | 'target' }
  | { kind: 'edge'; id: string }
  | { kind: 'edge-end'; id: string; end: 'source' | 'target' }
  | { kind: 'lane'; id: string; header: boolean }
  | { kind: 'background' }
  /** A control drawn on the canvas (an editor, a menu): the canvas leaves the event alone. */
  | { kind: 'control' };

export interface GestureContext {
  store: Store;
  /** The pointer position relative to the canvas element (screen px). */
  local(e: { clientX: number; clientY: number }): Point;
  /** The pointer position in world (layout) coordinates. */
  world(e: { clientX: number; clientY: number }): Point;
}

export interface Gesture {
  move(e: PointerEvent): void;
  up(e: PointerEvent): void;
  cancel(): void;
}

export type GestureFactory<K extends Hit['kind'] = Hit['kind']> = (
  hit: Extract<Hit, { kind: K }>,
  e: PointerEvent,
  ctx: GestureContext,
) => Gesture | null;

const factories = new Map<Hit['kind'], GestureFactory>();

/**
 * Register (or replace) the gesture that starts on a kind of target. Returns the factory it replaces, so a feature
 * can wrap an existing gesture (e.g. connect's click path intercepts clicks on blocks, UI15).
 */
export function registerGesture<K extends Hit['kind']>(kind: K, factory: GestureFactory<K>): GestureFactory<K> | undefined {
  const previous = factories.get(kind) as unknown as GestureFactory<K> | undefined;
  factories.set(kind, factory as unknown as GestureFactory);
  return previous;
}

export function gestureFor(hit: Hit, e: PointerEvent, ctx: GestureContext): Gesture | null {
  const f = factories.get(hit.kind);
  return f ? f(hit as never, e, ctx) : null;
}

/** What is under the pointer, by the §8.3 attributes. */
export function hitTest(target: EventTarget | null): Hit {
  const el = target instanceof Element ? target : null;
  if (!el) return { kind: 'background' };
  const control = el.closest('[data-canvas-control], input, textarea, select, button');
  if (control) return { kind: 'control' };
  const end = el.closest<HTMLElement | SVGElement>('[data-edge-end]');
  const edge = el.closest<HTMLElement | SVGElement>('[data-edge-id]');
  if (end && edge) return { kind: 'edge-end', id: edge.dataset.edgeId!, end: end.dataset.edgeEnd as 'source' | 'target' };
  const handle = el.closest<HTMLElement>('[data-handle]');
  const node = el.closest<HTMLElement>('[data-node-id]');
  if (handle && node) return { kind: 'handle', id: node.dataset.nodeId!, handle: handle.dataset.handle as 'source' | 'target' };
  if (node) return { kind: 'node', id: node.dataset.nodeId! };
  if (edge) return { kind: 'edge', id: edge.dataset.edgeId! };
  const lane = el.closest<HTMLElement>('[data-lane-id]');
  if (lane) return { kind: 'lane', id: lane.dataset.laneId!, header: !!el.closest('[data-lane-header]') };
  return { kind: 'background' };
}

const DRAG_THRESHOLD = 3;

const moved = (a: Point, b: Point) => Math.abs(a.x - b.x) > DRAG_THRESHOLD || Math.abs(a.y - b.y) > DRAG_THRESHOLD;

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * Does this press add to (or toggle within) the selection rather than replace it (A11)? Shift, or Cmd (Ctrl on other
 * systems; on a Mac, Ctrl+click is a right-click and never reaches a gesture).
 */
export function extendsSelection(e: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.shiftKey || e.metaKey || (!IS_MAC && e.ctrlKey);
}

/**
 * A15: Cmd+click (Mac) / Ctrl+click (elsewhere) on a linked block follows its link instead of selecting (design.md
 * §4 "Following a link"). Same modifier as `extendsSelection` without Shift: on a block with no link this never
 * fires, so Cmd/Ctrl+click keeps extending the selection as A11 says.
 */
function isLinkModifier(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.metaKey || (!IS_MAC && e.ctrlKey);
}

// ---- Pan: Space+drag anywhere, or the middle button (A11: a plain drag on the background draws a selection box) --

export function panGesture(ctx: GestureContext, e: PointerEvent): Gesture {
  const { store } = ctx;
  const start = ctx.local(e);
  const v0 = store.getState().viewport;
  return {
    move(ev) {
      const p = ctx.local(ev);
      store.setViewport({ ...v0, x: v0.x + p.x - start.x, y: v0.y + p.y - start.y });
    },
    up() {},
    cancel() {},
  };
}

// ---- Drag on the background: selection box (A11) ---------------------------------------------------------------

/**
 * A drag draws a selection box; on release the blocks wholly inside it are selected (lines and notes aren't: UI10).
 * With Shift or Cmd/Ctrl held at the press, the boxed blocks are added to the selection; otherwise they replace it.
 * A press that doesn't move is a click (`onClick`).
 */
function marquee(ctx: GestureContext, e: PointerEvent, onClick: (e: PointerEvent) => void = () => {}): Gesture {
  const { store } = ctx;
  const start = ctx.world(e);
  const startLocal = ctx.local(e);
  const additive = extendsSelection(e);
  let active = false;
  return {
    move(ev) {
      if (!active && !moved(startLocal, ctx.local(ev))) return;
      active = true;
      store.set({ marquee: rectFromPoints(start, ctx.world(ev)) });
    },
    up(ev) {
      if (!active) {
        onClick(ev);
        return;
      }
      const box = rectFromPoints(start, ctx.world(ev));
      const boxed = (store.layout?.nodes ?? []).filter((n) => containsRect(box, n)).map((n) => n.id);
      store.set({ marquee: null });
      if (!additive) {
        store.select({ nodes: boxed });
        return;
      }
      const cur = store.getState().selection;
      store.select({ nodes: [...new Set([...cur.nodes, ...boxed])], edges: cur.edges });
    },
    cancel() {
      store.set({ marquee: null });
    },
  };
}

/**
 * The background and a lane's empty area: a drag draws a selection box; a click selects the lane, clears the
 * selection, or places an armed shape. (Exported so a wrapping gesture, e.g. lane-header reorder, can fall back to it.)
 */
export function backgroundGesture(hit: Hit, e: PointerEvent, ctx: GestureContext): Gesture | null {
  const { store } = ctx;
  return marquee(ctx, e, (ev) => {
    const s = store.getState();
    if (hit.kind === 'lane' && s.tool.kind === 'place') {
      addBlock(store, s.tool.shape, hit.id);
      return;
    }
    // A Shift- or Cmd-click that misses every block keeps the selection (it was meant to extend it).
    if (extendsSelection(ev) && s.tool.kind === 'select') return;
    if (hit.kind === 'lane') {
      store.select({ lane: hit.id });
      return;
    }
    if (s.tool.kind === 'place') store.setTool({ kind: 'select' });
    store.clearSelection();
  });
}

registerGesture('background', backgroundGesture);
registerGesture('lane', backgroundGesture);

// ---- Nodes: click / Shift- or Cmd-click to select, drag to move and pin (UI10, UI11) ----------------------------

registerGesture('node', (hit, e, ctx) => {
  const { store } = ctx;
  const s = store.getState();
  if (s.tool.kind === 'place') {
    // Placing onto a block adds to that block's lane.
    const lane = store.layout?.nodes.find((n) => n.id === hit.id)?.lane;
    if (lane) addBlock(store, s.tool.shape, lane);
    return null;
  }
  // A15: Cmd/Ctrl+click on a linked block follows the link; a plain click still selects (editing must not change).
  const link = linkOf(s.derived?.doc.config?.nodes[hit.id]);
  if (link && isLinkModifier(e)) {
    followLink(store, link);
    return null;
  }
  const wasSelected = s.selection.nodes.includes(hit.id);
  if (extendsSelection(e)) {
    store.select({ nodes: [hit.id] }, 'toggle');
    if (wasSelected) return null; // Shift-click removed it: nothing to drag
  } else if (!wasSelected) {
    store.select({ nodes: [hit.id] });
  }
  const ids = store.getState().selection.nodes;
  const start = ctx.world(e);
  const startLocal = ctx.local(e);
  let dragging = false;
  const blocked = pinningBlocked(store);
  // UI39: the block under the pointer snaps to the other blocks (Alt turns it off); the rest move with it.
  const snapper = blockSnapSession(store, ids, hit.id);
  return {
    move(ev) {
      if (!dragging && !moved(startLocal, ctx.local(ev))) return;
      if (blocked) return;
      dragging = true;
      const p = ctx.world(ev);
      const d = snapper.offset(p.x - start.x, p.y - start.y, ev.altKey);
      store.set({ drag: { ids, lead: hit.id, dx: d.dx, dy: d.dy } });
    },
    up(ev) {
      if (!dragging) {
        if (blocked && moved(startLocal, ctx.local(ev))) store.toast(blocked, 'info');
        // A plain click inside a multi-selection narrows it to this block.
        if (!extendsSelection(ev) && wasSelected && ids.length > 1) store.select({ nodes: [hit.id] });
        return;
      }
      const p = ctx.world(ev);
      const d = snapper.offset(p.x - start.x, p.y - start.y, ev.altKey);
      snapper.end();
      dropNodes(store, ids, d.dx, d.dy);
      store.set({ drag: null });
    },
    cancel() {
      snapper.end();
      store.set({ drag: null });
    },
  };
});

// ---- Edges: click / Shift- or Cmd-click to select ------------------------------------------------------------

registerGesture('edge', (hit, e, ctx) => {
  const { store } = ctx;
  if (!extendsSelection(e)) {
    store.select({ edges: [hit.id] });
    return null;
  }
  // Shift or Cmd: a click toggles the edge; a drag adds a selection box (edges are thin, easy to start on by accident).
  const box = marquee(ctx, e);
  const start = ctx.local(e);
  let dragged = false;
  return {
    move(ev) {
      if (moved(start, ctx.local(ev))) dragged = true;
      box.move(ev);
    },
    up(ev) {
      if (dragged) box.up(ev);
      else store.select({ edges: [hit.id] }, 'toggle');
    },
    cancel: () => box.cancel(),
  };
});

/** Double-click on a block opens its label editor (UI8). Features can add double-click targets here. */
export function onDoubleClick(store: Store, hit: Hit): boolean {
  if (hit.kind === 'node') {
    editNodeLabel(store, hit.id);
    return true;
  }
  const extra = doubleClickHandlers.get(hit.kind);
  return extra ? extra(store, hit) : false;
}

const doubleClickHandlers = new Map<Hit['kind'], (store: Store, hit: Hit) => boolean>();

/** Register a double-click action for a kind of target (edge label UI17, lane label UI19, …). */
export function registerDoubleClick(kind: Hit['kind'], fn: (store: Store, hit: Hit) => boolean): void {
  doubleClickHandlers.set(kind, fn);
}
