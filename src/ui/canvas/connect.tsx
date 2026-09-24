// Lines on the canvas (design.md §8.2 UI15–UI17):
// - UI15 Connect: drag from a block's `data-handle="source"` onto another block (dropping anywhere on it), or the
//   click path: select the source, press `connect`, click the target. Dragging from a `data-handle="target"` works the
//   other way round (the block you drop on becomes the source). A live preview line follows the pointer.
// - UI16 Reconnect: with an edge selected, drag its `data-edge-end="source|target"` onto another block.
// - UI17 Edge label: double-click an edge (or press Enter with one selected) to edit its label in `label-editor`.
//
// Every edit is one core operation through `store.apply` (one undo step). The preview is drawn in an overlay above the
// canvas in screen space, so its stroke stays crisp at any zoom; it never takes pointer events.
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { edgeLabelSize } from '../../core/measure';
import { connect, reconnect, setEdgeLabel } from '../../core/ops';
import type { LayoutResult } from '../../core/types';
import { overlays } from '../chrome/Panels';
import { editable } from '../commands/types';
import { shallow, useStore, useStoreState } from '../store/hooks';
import type { State, Store } from '../store/store';
import { edgePoints, type LayoutNode } from './geometry';
import {
  hitTest, registerDoubleClick, registerGesture, type Gesture, type GestureContext, type GestureFactory,
} from './gestures';
import { toScreen, toWorld, type Point, type Rect } from './viewport';
import '../blocks.css';

const DRAG_THRESHOLD = 3;
/** How far outside a block's box a drop still counts as "on" it (the handles sit on the border). */
const DROP_TOLERANCE = 6;

// ---------------------------------------------------------------------------------------------------------------
// The click path's armed state lives in `panels.connect` (so the toolbar button's pressed state follows it). The
// source is the one selected block; with nothing selected, the next block clicked becomes the source.

const ARMED = 'connect';

export const connectArmed = (s: State): boolean => !!s.panels[ARMED];

export function armConnect(store: Store): void {
  store.togglePanel(ARMED, true);
}

export function disarmConnect(store: Store): void {
  if (connectArmed(store.getState())) store.togglePanel(ARMED, false);
}

function armedSource(s: State): string | null {
  return s.selection.nodes.length === 1 ? s.selection.nodes[0]! : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Live preview (module state: it changes on every pointer move and nothing else needs it).

interface Preview {
  /** The fixed end, in world coordinates. */
  from: Point;
  /** Which way the line leaves `from` (unit vector). */
  fromDir: Point;
  /** The moving end (the pointer, or snapped onto a target block), in world coordinates. */
  to: Point;
  /** Which end gets the arrowhead: the moving one (a new edge's target) or the fixed one. */
  arrow: 'to' | 'from';
  /** The block that would be connected on release (highlighted). */
  target: string | null;
  /** Reconnect: the edge being moved, drawn faded until the drop. */
  edgeId: string | null;
}

let preview: Preview | null = null;
const previewListeners = new Set<() => void>();

function setPreview(p: Preview | null): void {
  preview = p;
  for (const fn of previewListeners) fn();
}

function subscribePreview(fn: () => void): () => void {
  previewListeners.add(fn);
  return () => previewListeners.delete(fn);
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry helpers (world coordinates)

const moved = (a: Point, b: Point) => Math.abs(a.x - b.x) > DRAG_THRESHOLD || Math.abs(a.y - b.y) > DRAG_THRESHOLD;

/** The block under a world point (the topmost, i.e. last drawn), with a small tolerance around each box. */
export function nodeAt(layout: LayoutResult, p: Point, tolerance = DROP_TOLERANCE): LayoutNode | null {
  for (let i = layout.nodes.length - 1; i >= 0; i--) {
    const n = layout.nodes[i]!;
    if (p.x >= n.x - tolerance && p.x <= n.x + n.width + tolerance && p.y >= n.y - tolerance && p.y <= n.y + n.height + tolerance) {
      return n;
    }
  }
  return null;
}

/** Where the line from `from` towards the box's centre meets the box's border. */
function boxEntry(box: Rect, from: Point): Point {
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const dx = from.x - c.x;
  const dy = from.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const t = Math.min(dx === 0 ? Infinity : box.width / 2 / Math.abs(dx), dy === 0 ? Infinity : box.height / 2 / Math.abs(dy));
  if (t >= 1) return c; // `from` is inside the box
  return { x: c.x + dx * t, y: c.y + dy * t };
}

function unit(dx: number, dy: number): Point {
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** A handle's position on its block, and the direction a line leaves it (§8.3 handles: flow-axis sides). */
function handleAnchor(node: LayoutNode, handle: 'source' | 'target', direction: LayoutResult['direction']): { at: Point; dir: Point } {
  if (direction === 'TB') {
    return handle === 'source'
      ? { at: { x: node.x + node.width / 2, y: node.y + node.height }, dir: { x: 0, y: 1 } }
      : { at: { x: node.x + node.width / 2, y: node.y }, dir: { x: 0, y: -1 } };
  }
  return handle === 'source'
    ? { at: { x: node.x + node.width, y: node.y + node.height / 2 }, dir: { x: 1, y: 0 } }
    : { at: { x: node.x, y: node.y + node.height / 2 }, dir: { x: -1, y: 0 } };
}

/** The moving end: snapped onto a valid target block, else the pointer. */
function movingEnd(layout: LayoutResult, from: Point, pointer: Point, exclude: string | null): { to: Point; target: string | null } {
  const over = nodeAt(layout, pointer);
  if (!over || over.id === exclude) return { to: pointer, target: null };
  return { to: boxEntry(over, from), target: over.id };
}

// ---------------------------------------------------------------------------------------------------------------
// UI15: connect

function finishConnect(store: Store, source: string, target: string): void {
  disarmConnect(store);
  const r = store.apply(connect, source, target);
  if (r.ok) store.select({ edges: [r.edgeId] });
}

/** A gesture that does nothing (so the canvas doesn't fall back to another gesture for this press). */
const inert: Gesture = { move() {}, up() {}, cancel() {} };

/** Drag from a handle to a block. From `source`: this block → the drop target. From `target`: the drop target → this. */
function handleDrag(store: Store, ctx: GestureContext, e: PointerEvent, id: string, handle: 'source' | 'target'): Gesture | null {
  const layout = store.layout;
  const node = layout?.nodes.find((n) => n.id === id);
  if (!layout || !node) return null;
  const anchor = handleAnchor(node, handle, layout.direction);
  const startLocal = ctx.local(e);
  let active = false;
  return {
    move(ev) {
      if (!active && !moved(startLocal, ctx.local(ev))) return;
      active = true;
      const { to, target } = movingEnd(layout, anchor.at, ctx.world(ev), id);
      setPreview({ from: anchor.at, fromDir: anchor.dir, to, arrow: handle === 'source' ? 'to' : 'from', target, edgeId: null });
    },
    up(ev) {
      setPreview(null);
      if (!active) {
        // A click on a handle is a click on its block.
        store.select({ nodes: [id] }, ev.shiftKey ? 'toggle' : 'replace');
        return;
      }
      const over = nodeAt(store.layout ?? layout, ctx.world(ev));
      if (!over || over.id === id) return; // dropped on nothing, or back on itself: cancelled
      if (handle === 'source') finishConnect(store, id, over.id);
      else finishConnect(store, over.id, id);
    },
    cancel() {
      setPreview(null);
    },
  };
}

registerGesture('handle', (hit, e, ctx) => {
  const { store } = ctx;
  const s = store.getState();
  // Placing a shape, a read-only diagram, or Shift (selection): the handle is just part of its block.
  if (s.tool.kind === 'place' || store.readOnlyReason() || e.shiftKey) return null;
  if (connectArmed(s)) return clickPathGesture(ctx, e, hit.id);
  return handleDrag(store, ctx, e, hit.id, hit.handle);
});

/** The click path: with connect armed, a click on a block picks the source (if none) or connects to it. */
function clickPathGesture(ctx: GestureContext, e: PointerEvent, id: string): Gesture {
  const { store } = ctx;
  const start = ctx.local(e);
  return {
    ...inert,
    up(ev) {
      if (moved(start, ctx.local(ev))) return;
      const s = store.getState();
      if (!connectArmed(s)) return;
      const source = armedSource(s);
      if (source === null) {
        store.select({ nodes: [id] });
        return;
      }
      if (source === id) {
        disarmConnect(store); // clicking the source again cancels
        return;
      }
      finishConnect(store, source, id);
    },
  };
}

const nodeGesture: GestureFactory<'node'> | undefined = registerGesture('node', (hit, e, ctx): Gesture | null => {
  const s = ctx.store.getState();
  if (connectArmed(s) && s.tool.kind === 'select' && !e.shiftKey && e.button === 0) return clickPathGesture(ctx, e, hit.id);
  return nodeGesture ? nodeGesture(hit, e, ctx) : null;
});

// ---------------------------------------------------------------------------------------------------------------
// UI16: reconnect

registerGesture('edge-end', (hit, e, ctx) => {
  const { store } = ctx;
  const layout = store.layout;
  const edge = layout?.edges.find((x) => x.id === hit.id);
  if (!layout || !edge) return null;
  const byId = (id: string) => layout.nodes.find((n) => n.id === id);
  const pts = edgePoints(edge, byId(edge.source), byId(edge.target));
  if (pts.length < 2) return null;
  const n = pts.length;
  // The end that stays put, and the direction the line leaves it (along its first segment).
  const fixed = hit.end === 'target' ? pts[0]! : pts[n - 1]!;
  const next = hit.end === 'target' ? pts[1]! : pts[n - 2]!;
  const fromDir = unit(next.x - fixed.x, next.y - fixed.y);
  const startLocal = ctx.local(e);
  const blocked = store.readOnlyReason();
  let active = false;
  return {
    move(ev) {
      if (blocked || (!active && !moved(startLocal, ctx.local(ev)))) return;
      active = true;
      const { to, target } = movingEnd(layout, fixed, ctx.world(ev), null);
      setPreview({ from: fixed, fromDir, to, arrow: hit.end === 'target' ? 'to' : 'from', target, edgeId: edge.id });
    },
    up(ev) {
      setPreview(null);
      if (!active) {
        store.select({ edges: [hit.id] }, ev.shiftKey ? 'toggle' : 'replace');
        return;
      }
      const over = nodeAt(store.layout ?? layout, ctx.world(ev));
      if (!over || over.id === edge[hit.end]) return; // nowhere, or where it already was: snaps back
      const r = store.apply(reconnect, edge.id, hit.end, over.id);
      if (r.ok) store.select({ edges: [r.edgeId] });
    },
    cancel() {
      setPreview(null);
    },
  };
});

// ---------------------------------------------------------------------------------------------------------------
// UI17: edge label

/** A point `dist` px along a polyline. */
function pointAlong(pts: readonly Point[], dist: number): Point {
  let left = dist;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len >= left && len > 0) return { x: a.x + ((b.x - a.x) * left) / len, y: a.y + ((b.y - a.y) * left) / len };
    left -= len;
  }
  return pts[pts.length - 1] ?? { x: 0, y: 0 };
}

function pathLength(pts: readonly Point[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return sum;
}

/** UI17: open the label editor on an edge. Enter commits, Escape cancels; an empty label removes it. */
export function editEdgeLabel(store: Store, edgeId: string): void {
  if (store.readOnlyReason()) return;
  const layout = store.layout;
  const edge = layout?.edges.find((x) => x.id === edgeId);
  if (!layout || !edge) return;
  store.select({ edges: [edgeId] });
  const byId = (id: string) => layout.nodes.find((n) => n.id === id);
  const pts = edgePoints(edge, byId(edge.source), byId(edge.target));
  // Over the label if there is one; otherwise near the source, where the label will go (§6 L8).
  const centre = edge.label_pos
    ? { x: edge.label_pos[0], y: edge.label_pos[1] }
    : pointAlong(pts, Math.min(pathLength(pts) / 2, 48));
  const width = Math.max(124, edge.label ? edgeLabelSize(edge.label).width : 0);
  const height = 30;
  const current = edge.label ?? '';
  store.beginEdit({
    testid: 'label-editor',
    target: { kind: 'edge', id: edgeId },
    initial: current,
    anchor: { x: centre.x - width / 2, y: centre.y - height / 2, width, height },
    variant: 'label',
    placeholder: 'Line label',
    commit: (text) => {
      const next = text.trim() === '' ? null : text;
      if (next === edge.label) return;
      store.apply(setEdgeLabel, edgeId, next);
    },
  });
}

registerDoubleClick('edge', (store, hit) => {
  if (hit.kind !== 'edge') return false;
  editEdgeLabel(store, hit.id);
  return true;
});
registerDoubleClick('edge-end', (store, hit) => {
  if (hit.kind !== 'edge-end') return false;
  editEdgeLabel(store, hit.id);
  return true;
});

// ---------------------------------------------------------------------------------------------------------------
// The overlay: the preview line, the target highlight, and the click path's hint. Mounted over the canvas.

function canvasEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="canvas"]');
}

/**
 * The element around the canvas (`.fm-canvas-wrap`), for overlays mounted through the `overlays` registry that draw
 * over the canvas in its own coordinates (the connect preview, the shape picker). Null until it exists.
 */
export function useCanvasWrap(): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const find = () => {
      const found = document.querySelector<HTMLElement>('.fm-canvas-wrap');
      setEl((cur) => (cur === found ? cur : found));
      return !!found;
    };
    if (find()) return;
    const id = requestAnimationFrame(find);
    return () => cancelAnimationFrame(id);
  }, []);
  return el;
}

const cssString = (s: string) => `"${s.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ')}"`;

export function ConnectOverlay() {
  const store = useStore();
  const drag = useSyncExternalStore(subscribePreview, () => preview, () => preview);
  const armed = useStoreState(connectArmed);
  const source = useStoreState((s) => (connectArmed(s) ? armedSource(s) : null));
  const viewport = useStoreState((s) => s.viewport, shallow);
  const layout = useStoreState((s) => s.shown?.layout ?? null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const wrap = useCanvasWrap();

  // The armed click path ends when the selection stops being "one block (or none yet)", or editing turns off.
  useEffect(() => {
    const check = () => {
      const s = store.getState();
      if (!connectArmed(s)) return;
      const sel = s.selection;
      if (!editable(s) || sel.nodes.length > 1 || sel.edges.length > 0 || sel.lane !== null) disarmConnect(store);
    };
    check();
    return store.subscribe(check);
  }, [store]);

  // While armed: Escape cancels (and only that: the selection stays); a press on empty canvas, a lane or a line
  // cancels too; the rubber band follows the pointer.
  useEffect(() => {
    if (!armed) {
      setPointer(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || store.getState().editing) return;
      e.preventDefault();
      disarmConnect(store);
    };
    const onDown = (e: PointerEvent) => {
      const canvas = canvasEl();
      if (!canvas || !(e.target instanceof Node) || !canvas.contains(e.target)) return;
      const hit = hitTest(e.target);
      if (hit.kind === 'background' || hit.kind === 'lane' || hit.kind === 'edge' || hit.kind === 'edge-end') disarmConnect(store);
    };
    const onMove = (e: PointerEvent) => {
      const canvas = canvasEl();
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      setPointer(toWorld(store.getState().viewport, { x: e.clientX - r.left, y: e.clientY - r.top }));
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
    };
  }, [armed, store]);

  // What to draw: a drag in progress, or the armed click path's rubber band from the source.
  let shown: Preview | null = drag;
  let hover: string | null = drag?.target ?? null;
  if (!shown && armed && layout && pointer) {
    const src = source ? layout.nodes.find((n) => n.id === source) : undefined;
    if (src) {
      const a = handleAnchor(src, 'source', layout.direction);
      const { to, target } = movingEnd(layout, a.at, pointer, src.id);
      shown = { from: a.at, fromDir: a.dir, to, arrow: 'to', target, edgeId: null };
      hover = target;
    } else {
      hover = nodeAt(layout, pointer)?.id ?? null; // picking the source
    }
  }
  const hoverNode = hover && layout ? layout.nodes.find((n) => n.id === hover) : undefined;

  const styles: string[] = [];
  if (drag || armed) styles.push('.fm-canvas, .fm-canvas * { cursor: crosshair !important; }');
  if (drag?.edgeId) styles.push(`.fm-edge[data-edge-id=${cssString(drag.edgeId)}] { opacity: 0.18; }`);
  if (armed && source) styles.push(`.fm-node[data-node-id=${cssString(source)}] .fm-handle-source { opacity: 1; }`);

  if (!wrap) return null;
  return createPortal(
    <>
      {styles.length ? <style>{styles.join('\n')}</style> : null}
      {shown || hoverNode ? (
        <svg className="fm-connect-overlay" aria-hidden="true">
          {hoverNode ? <TargetHalo node={hoverNode} viewport={viewport} /> : null}
          {shown ? <PreviewLine p={shown} viewport={viewport} /> : null}
        </svg>
      ) : null}
      {armed ? (
        <div className="fm-connect-hint" role="status">
          <span className="fm-connect-hint-dot" />
          {source ? 'Click the block to connect to' : 'Click the block to connect from'}
          <kbd>Esc</kbd>
        </div>
      ) : null}
    </>,
    wrap,
  );
}

overlays.push({ id: 'connect', Component: ConnectOverlay });

function TargetHalo({ node, viewport }: { node: LayoutNode; viewport: { x: number; y: number; zoom: number } }) {
  const tl = toScreen(viewport, { x: node.x, y: node.y });
  const pad = 5;
  return (
    <rect
      className="fm-connect-target"
      x={tl.x - pad}
      y={tl.y - pad}
      width={node.width * viewport.zoom + pad * 2}
      height={node.height * viewport.zoom + pad * 2}
      rx={9}
    />
  );
}

function PreviewLine({ p, viewport }: { p: Preview; viewport: { x: number; y: number; zoom: number } }) {
  const a = toScreen(viewport, p.from);
  const b = toScreen(viewport, p.to);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  // Leave the anchor along its direction in proportion to how far ahead the pointer is, so a target behind the
  // anchor gets a gentle curve instead of a hook.
  const ahead = (b.x - a.x) * p.fromDir.x + (b.y - a.y) * p.fromDir.y;
  const k = Math.max(14, Math.min(90, ahead * 0.5, dist * 0.45));
  const c1 = { x: a.x + p.fromDir.x * k, y: a.y + p.fromDir.y * k };
  const c2 = { x: b.x + (c1.x - b.x) * 0.3, y: b.y + (c1.y - b.y) * 0.3 };
  const f = (n: number) => Math.round(n * 10) / 10;
  const d = `M${f(a.x)},${f(a.y)} C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(b.x)},${f(b.y)}`;
  const head = p.arrow === 'to' ? arrow(c2, b) : arrow(c1, a);
  return (
    <g className={`fm-connect-preview${p.target ? ' fm-snapped' : ''}`}>
      <path className="fm-connect-line" d={d} />
      <circle className="fm-connect-anchor" cx={p.arrow === 'to' ? a.x : b.x} cy={p.arrow === 'to' ? a.y : b.y} r={4} />
      {dist > 6 ? <path className="fm-connect-arrow" d={head} /> : null}
    </g>
  );
}

function arrow(from: Point, tip: Point): string {
  const u = unit(tip.x - from.x, tip.y - from.y);
  const len = 10;
  const w = 5;
  const bx = tip.x - u.x * len;
  const by = tip.y - u.y * len;
  const f = (n: number) => Math.round(n * 10) / 10;
  return `M${f(tip.x)},${f(tip.y)}L${f(bx - u.y * w)},${f(by + u.x * w)}L${f(bx + u.y * w)},${f(by - u.x * w)}Z`;
}
