// Lines on the canvas (design.md §8.2 UI15–UI17, UI38):
// - UI15 / UI38 Connect: every block has four connection handles, `data-handle="source"` with `data-port` (ports.tsx).
//   Dragging one starts a line that leaves the block from that side (`source_side` is written). Over another block, its
//   four connection points (`data-port-target`) show and the nearest is highlighted; dropping on one writes
//   `target_side`, dropping elsewhere on the block leaves that side to the layout. Or the click path: select the
//   source, press connect, click the target (no sides).
// - UI16 / UI38 Reconnect: with an edge selected, drag its `data-edge-end="source|target"` onto a block. On a connection
//   point that end's side is written; on another point of the block it is already attached to, only the side changes.
// - UI17 Edge label: double-click an edge (or press Enter with one selected) to edit its label in `label-editor`.
//
// The preview is drawn orthogonally, bending the way the final line will (lineGeometry.ts): exactly L11 when a manual
// line keeps its bend points, else the router's conventions (leave and arrive square to the sides). It is drawn in an
// overlay above the canvas in screen space, so its stroke stays crisp at any zoom; it never takes pointer events.
// Every edit is one core operation through `store.apply` (one undo step).
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { nodePort } from '../../core/layout';
import { edgeLabelSize } from '../../core/measure';
import { connect, reconnect, setEdgeLabel } from '../../core/ops';
import type { LayoutResult, Side } from '../../core/types';
import { overlays } from '../chrome/Panels';
import { editable } from '../commands/types';
import { shallow, useStore, useStoreState } from '../store/hooks';
import type { State, Store } from '../store/store';
import { edgePoints, roundedPath, type LayoutNode } from './geometry';
import {
  extendsSelection, hitTest, registerDoubleClick, registerGesture, type Gesture, type GestureContext, type GestureFactory,
} from './gestures';
import { connectorPath, facingSide, lineModel, manualPath, nearestPort, PORT_SNAP_PX, portSnapRadius, type XY } from './lineGeometry';
import { connectTarget } from './ports';
import { toScreen, toWorld, type Point } from './viewport';
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
  /** The line as it would be drawn, from its source end to its target end (world coordinates). */
  points: XY[];
  /** The end that stays put (drawn as a dot). */
  anchor: XY;
  /** The moving end is on a block (drawn solid) rather than following the pointer (dashed). */
  snapped: boolean;
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
  if (!p) connectTarget.set(null);
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

/**
 * Where a dragged line end would land (UI38): the block under the pointer (a connection point just outside its box
 * counts), its connection point nearest the pointer, and whether the pointer is on it (within PORT_SNAP_PX on screen).
 */
function dropAt(layout: LayoutResult, p: Point, zoom: number, exclude: string | null) {
  const over = nodeAt(layout, p, Math.max(DROP_TOLERANCE, PORT_SNAP_PX / zoom));
  if (!over || over.id === exclude) return null;
  const port = nearestPort(over, p, portSnapRadius(over, zoom));
  return { node: over, port };
}

const xy = (p: Point): XY => [p.x, p.y];

// ---------------------------------------------------------------------------------------------------------------
// UI15 / UI38: connect

function finishConnect(store: Store, source: string, target: string, sides?: { source_side?: Side; target_side?: Side }): void {
  disarmConnect(store);
  const r = store.apply(connect, source, target, sides ?? {});
  if (r.ok) store.select({ edges: [r.edgeId] });
}

/** A gesture that does nothing (so the canvas doesn't fall back to another gesture for this press). */
const inert: Gesture = { move() {}, up() {}, cancel() {} };

/** Drag from a block's connection handle on `side` to another block: this block → the drop target (UI38). */
function handleDrag(store: Store, ctx: GestureContext, e: PointerEvent, id: string, side: Side): Gesture | null {
  const layout = store.layout;
  const node = layout?.nodes.find((n) => n.id === id);
  if (!layout || !node) return null;
  const a = nodePort(node, side) as XY;
  const startLocal = ctx.local(e);
  let active = false;
  const zoom = () => store.getState().viewport.zoom;
  return {
    move(ev) {
      if (!active && !moved(startLocal, ctx.local(ev))) return;
      active = true;
      const p = ctx.world(ev);
      const drop = dropAt(layout, p, zoom(), id);
      if (!drop) {
        connectTarget.set(null);
        setPreview({ points: connectorPath(a, side, xy(p), null), anchor: a, snapped: false, target: null, edgeId: null });
        return;
      }
      const { node: over, port } = drop;
      // On a connection point: that side. Elsewhere on the block the layout chooses; show the side facing the line.
      const sb = port.on ? port.side : facingSide(layout.direction, over, a);
      const b = nodePort(over, sb) as XY;
      connectTarget.set({ node: over.id, nearest: port.side, active: port.on });
      setPreview({ points: connectorPath(a, side, b, sb), anchor: a, snapped: true, target: over.id, edgeId: null });
    },
    up(ev) {
      setPreview(null);
      if (!active) {
        // A click on a handle is a click on its block.
        store.select({ nodes: [id] }, extendsSelection(ev) ? 'toggle' : 'replace');
        return;
      }
      const drop = dropAt(store.layout ?? layout, ctx.world(ev), zoom(), id);
      if (!drop) return; // dropped on nothing, or back on its own block: cancelled
      finishConnect(store, id, drop.node.id, drop.port.on ? { source_side: side, target_side: drop.port.side } : { source_side: side });
    },
    cancel() {
      setPreview(null);
    },
  };
}

const SIDE_NAMES: readonly string[] = ['top', 'right', 'bottom', 'left'];

registerGesture('handle', (hit, e, ctx) => {
  const { store } = ctx;
  const s = store.getState();
  // Placing a shape, a read-only diagram, or Shift/Cmd (selection): the handle is just part of its block.
  if (s.tool.kind === 'place' || store.readOnlyReason() || extendsSelection(e)) return null;
  if (connectArmed(s)) return clickPathGesture(ctx, e, hit.id);
  const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-port]') : null;
  const side = el?.dataset.port;
  if (!side || !SIDE_NAMES.includes(side)) return null;
  return handleDrag(store, ctx, e, hit.id, side as Side);
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
      finishConnect(store, source, id); // UI15: the click path writes no sides
    },
  };
}

const nodeGesture: GestureFactory<'node'> | undefined = registerGesture('node', (hit, e, ctx): Gesture | null => {
  const s = ctx.store.getState();
  if (connectArmed(s) && s.tool.kind === 'select' && !extendsSelection(e) && e.button === 0) return clickPathGesture(ctx, e, hit.id);
  return nodeGesture ? nodeGesture(hit, e, ctx) : null;
});

// ---------------------------------------------------------------------------------------------------------------
// UI16 / UI38: reconnect

registerGesture('edge-end', (hit, e, ctx) => {
  const { store } = ctx;
  const doc = store.getState().shown?.doc;
  const output = doc?.layout;
  const layout = output?.result;
  const edge = layout?.edges.find((x) => x.id === hit.id);
  if (!doc || !output || !layout || !edge || edge.points.length < 2) return null;
  const model = lineModel(output, doc.edgeEntries[edge.id], edge.id);
  const byId = (id: string) => layout.nodes.find((n) => n.id === id);
  const end = hit.end;
  const other = end === 'target' ? 'source' : 'target';
  const fixedNode = byId(edge[other]);
  if (!fixedNode) return null;
  // The end that stays put, at the port of the side it uses.
  const fixedSide: Side = other === 'source' ? edge.source_side : edge.target_side;
  const fixed = nodePort(fixedNode, fixedSide) as XY;
  const startLocal = ctx.local(e);
  const blocked = store.readOnlyReason();
  const zoom = () => store.getState().viewport.zoom;
  let active = false;

  /** The line as it would be with the moving end on `over`, at side `side` (null: elsewhere on the block). */
  const pathTo = (over: LayoutNode, side: Side | null): XY[] => {
    if (model?.manual && over.id === edge[end]) {
      // Same block, a manual line: only this end's side changes and the bend points stay, so this is exactly L11.
      const bends = model.bends;
      const near = end === 'source' ? bends[0]! : bends[bends.length - 1]!;
      const s = side ?? facingSide(layout.direction, over, near);
      const p = nodePort(over, s) as XY;
      return end === 'source'
        ? manualPath(p, s, bends, fixed, fixedSide, layout.direction)
        : manualPath(fixed, fixedSide, bends, p, s, layout.direction);
    }
    // Otherwise the points go (another block) or the line is automatic: routed by the layout.
    const s = side ?? facingSide(layout.direction, over, fixed);
    const p = nodePort(over, s) as XY;
    return end === 'target' ? connectorPath(fixed, fixedSide, p, s) : connectorPath(p, s, fixed, fixedSide);
  };

  return {
    move(ev) {
      if (blocked || (!active && !moved(startLocal, ctx.local(ev)))) return;
      active = true;
      const p = ctx.world(ev);
      const drop = dropAt(layout, p, zoom(), null);
      if (!drop) {
        connectTarget.set(null);
        const free = connectorPath(fixed, fixedSide, xy(p), null);
        setPreview({ points: end === 'target' ? free : [...free].reverse(), anchor: fixed, snapped: false, target: null, edgeId: edge.id });
        return;
      }
      connectTarget.set({ node: drop.node.id, nearest: drop.port.side, active: drop.port.on });
      setPreview({
        points: pathTo(drop.node, drop.port.on ? drop.port.side : null),
        anchor: fixed, snapped: true, target: drop.node.id, edgeId: edge.id,
      });
    },
    up(ev) {
      setPreview(null);
      if (!active) {
        store.select({ edges: [hit.id] }, extendsSelection(ev) ? 'toggle' : 'replace');
        return;
      }
      const drop = dropAt(store.layout ?? layout, ctx.world(ev), zoom(), null);
      if (!drop) return; // nowhere: snaps back
      const side = drop.port.on ? drop.port.side : null;
      const r = store.apply(reconnect, edge.id, end, drop.node.id, side);
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
      // The click path writes no sides: preview from the side facing the pointer (or the block under it).
      const over = nodeAt(layout, pointer);
      const target = over && over.id !== src.id ? over : null;
      const toward: XY = target ? [target.x + target.width / 2, target.y + target.height / 2] : [pointer.x, pointer.y];
      const sa = facingSide(layout.direction, src, toward);
      const a = nodePort(src, sa) as XY;
      let points: XY[];
      if (target) {
        const sb = facingSide(layout.direction, target, a);
        points = connectorPath(a, sa, nodePort(target, sb) as XY, sb);
      } else points = connectorPath(a, sa, [pointer.x, pointer.y], null);
      shown = { points, anchor: a, snapped: !!target, target: target?.id ?? null, edgeId: null };
      hover = target?.id ?? null;
    } else {
      hover = nodeAt(layout, pointer)?.id ?? null; // picking the source
    }
  }
  const hoverNode = hover && layout ? layout.nodes.find((n) => n.id === hover) : undefined;

  const styles: string[] = [];
  if (drag || armed) styles.push('.fm-canvas, .fm-canvas * { cursor: crosshair !important; }');
  if (drag?.edgeId) styles.push(`.fm-edge[data-edge-id=${cssString(drag.edgeId)}] { opacity: 0.18; }`);
  // While a line is dragged the connection handles step aside for the target's connection points (ports.tsx).
  if (drag) styles.push('.fm-port { visibility: hidden !important; opacity: 0 !important; transition: none !important; }');

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

/** The preview line: orthogonal, with rounded corners like the drawn lines, dashed until it is on a block. */
function PreviewLine({ p, viewport }: { p: Preview; viewport: { x: number; y: number; zoom: number } }) {
  const pts = p.points.map((q) => toScreen(viewport, { x: q[0], y: q[1] }));
  if (pts.length < 2) return null;
  const anchor = toScreen(viewport, { x: p.anchor[0], y: p.anchor[1] });
  const tip = pts[pts.length - 1]!;
  const from = pts[pts.length - 2]!;
  const dist = Math.hypot(tip.x - from.x, tip.y - from.y);
  return (
    <g className={`fm-connect-preview${p.snapped ? ' fm-snapped' : ''}`}>
      <path className="fm-connect-line" d={roundedPath(pts, 8)} />
      <circle className="fm-connect-anchor" cx={anchor.x} cy={anchor.y} r={4} />
      {dist > 6 ? <path className="fm-connect-arrow" d={arrow(from, tip)} /> : null}
    </g>
  );
}

function arrow(from: Point, tip: Point): string {
  const len0 = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const u = { x: (tip.x - from.x) / len0, y: (tip.y - from.y) / len0 };
  const len = 10;
  const w = 5;
  const bx = tip.x - u.x * len;
  const by = tip.y - u.y * len;
  const f = (n: number) => Math.round(n * 10) / 10;
  return `M${f(tip.x)},${f(tip.y)}L${f(bx - u.y * w)},${f(by + u.x * w)}L${f(bx + u.y * w)},${f(by - u.x * w)}Z`;
}
