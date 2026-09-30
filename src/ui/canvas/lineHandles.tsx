// Shaping a line by hand on the canvas (design.md §8.2 UI36, UI37; §8.3 "Edge (v1.1)").
//
// A selected line shows, in this order (later ones on top where they meet):
// - a handle at the middle of each segment of its merged drawn line, `data-segment="<i>"`: drag it to slide that segment
//   sideways, square to itself (a segment attached to a port gets a 20 px stub first), like draw.io;
// - a handle on each bend point, `data-bend="<i>"` (an automatic line's corners, which it stores on becoming manual):
//   drag it to move the point, snapping to the blocks, the line's other bend points and its two ports (UI39; Alt off);
// - its two ends, `data-edge-end="source|target"`, which reconnect (UI16, UI38; connect.tsx).
// The label (`data-role="edge-label"`) can be dragged along its line (UI37). While any of these is dragged the line is
// drawn live in its new shape, orthogonal and exactly as the layout will draw it after the drop (lineGeometry.ts), with
// the old line as a faint dashed ghost. Each drop is one core operation through `store.apply` (one undo step).
import { projectOntoPolyline, pointAtFraction, type LayoutOutput } from '../../core/layout';
import { roundPx } from '../../core/layoutfile';
import { dragBend, dragSegment, setLabelAt } from '../../core/ops';
import { signal } from '../features/signal';
import { snapSession } from '../snap/session';
import type { SnapTarget } from '../snap/snap';
import type { Store } from '../store/store';
import { extendsSelection, registerGesture, type Gesture, type GestureContext, type GestureFactory } from './gestures';
import { bendDragPreview, lineModel, segmentDragPreview, type LineModel, type XY } from './lineGeometry';
import type { Point } from './viewport';
import './lineMenu';
import './lines.css';

// ---------------------------------------------------------------------------------------------------------------
// The live preview of a drag on a line (module state: it changes on every pointer move).

export interface Shaping {
  edgeId: string;
  /** The line as it will be drawn after the drop. */
  points?: XY[];
  /** The label's centre as it will be after the drop. */
  label?: XY;
  /** The line before the drag (drawn faint and dashed). */
  ghost?: XY[];
  /** Which handle is being dragged (drawn highlighted). */
  active?: { kind: 'segment' | 'bend'; index: number };
}

export const shaping = signal<Shaping | null>(null);

// ---------------------------------------------------------------------------------------------------------------
// Handles

/**
 * Handle sizes: [screen px, cap in diagram px]. Divided by the zoom, so they look the same at any zoom, but capped, so
 * that zoomed far out a handle doesn't swallow its neighbours (the old end grips' caps).
 */
const SEG_LEN = [16, 36] as const;
const SEG_THICK = [6, 14] as const;
const SEG_HIT = [18, 24] as const;
const BEND_R = [4.5, 10] as const;
const BEND_HIT = [8, 16] as const;
const GRIP_R = [5.5, 14] as const;
const GRIP_HIT = [9, 20] as const;
const STROKE = [1.5, 3.5] as const;

/** A handle size in diagram px at zoom `zoom`. */
const sized = ([px, cap]: readonly [number, number], zoom: number) => Math.round(Math.min(px / zoom, cap) * 100) / 100;

/** The handles of one selected line (not while it is being shaped: the preview shows the new corners instead). */
export function LineHandles({ model, zoom, shape }: { model: LineModel; zoom: number; shape: Shaping | null }) {
  const f = (n: number) => Math.round(n * 100) / 100;
  const z = (size: readonly [number, number]) => sized(size, zoom);
  if (shape?.points) {
    // Dragging: the new line's corners, where the bend points will be.
    return (
      <g className="fm-line-handles" pointerEvents="none">
        {shape.points.slice(1, -1).map((p, i) => (
          <circle key={i} className="fm-bend-dot" cx={p[0]} cy={p[1]} r={z(BEND_R)} style={{ strokeWidth: z(STROKE) }} />
        ))}
      </g>
    );
  }
  const drawn = model.drawn;
  const start = drawn[0]!;
  const end = drawn[drawn.length - 1]!;
  return (
    <g className="fm-line-handles">
      {model.segments.map((s, i) => {
        const len = z(s.horizontal ? SEG_LEN : SEG_THICK);
        const thick = z(s.horizontal ? SEG_THICK : SEG_LEN);
        const hit = z(SEG_HIT);
        return (
          <g key={`s${i}`} className="fm-seg" data-segment={i} data-orient={s.horizontal ? 'h' : 'v'}>
            <rect className="fm-seg-hit" x={f(s.mid[0] - hit / 2)} y={f(s.mid[1] - hit / 2)} width={hit} height={hit} />
            <rect
              className="fm-seg-bar"
              x={f(s.mid[0] - len / 2)}
              y={f(s.mid[1] - thick / 2)}
              width={len}
              height={thick}
              rx={f(Math.min(len, thick) / 2)}
              style={{ strokeWidth: z(STROKE) }}
            />
          </g>
        );
      })}
      {model.bends.map((p, i) => (
        <g key={`b${i}`} className="fm-bend" data-bend={i}>
          <circle className="fm-bend-hit" cx={p[0]} cy={p[1]} r={z(BEND_HIT)} />
          <circle className="fm-bend-dot" cx={p[0]} cy={p[1]} r={z(BEND_R)} style={{ strokeWidth: z(STROKE) }} />
        </g>
      ))}
      <EndGrip at={start} end="source" zoom={zoom} />
      <EndGrip at={end} end="target" zoom={zoom} />
    </g>
  );
}

/**
 * A selected line's draggable end (UI16, UI38), on the end itself, as in draw.io. The selected line is drawn above
 * the blocks (EdgesLayer), so the grip wins over the block and its connection handles where they meet.
 */
function EndGrip({ at, end, zoom }: { at: XY; end: 'source' | 'target'; zoom: number }) {
  return (
    <g className="fm-edge-end" data-edge-end={end}>
      <circle className="fm-edge-end-hit" cx={at[0]} cy={at[1]} r={sized(GRIP_HIT, zoom)} />
      <circle className="fm-edge-end-dot" cx={at[0]} cy={at[1]} r={sized(GRIP_R, zoom)} style={{ strokeWidth: sized([2, 4], zoom) }} />
    </g>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Gestures: a press on a segment handle, a bend handle or a label (all inside the edge element, so the canvas hit-tests
// them as the edge; this wraps the edge's own gesture and looks at what exactly was pressed).

const DRAG_THRESHOLD = 3;
const moved = (a: Point, b: Point) => Math.abs(a.x - b.x) > DRAG_THRESHOLD || Math.abs(a.y - b.y) > DRAG_THRESHOLD;

/** The current layout with its frame (the ops' `LayoutArg`), and the line's model. */
function current(store: Store, edgeId: string): { out: LayoutOutput; model: LineModel } | null {
  const doc = store.getState().shown?.doc;
  const out = doc?.layout;
  if (!doc || !out) return null;
  const model = lineModel(out, doc.edgeEntries[edgeId], edgeId);
  return model ? { out, model } : null;
}

function segmentGesture(ctx: GestureContext, e: PointerEvent, edgeId: string, index: number): Gesture | null {
  const { store } = ctx;
  const cur = current(store, edgeId);
  if (!cur) return null;
  const { out, model } = cur;
  const start = ctx.world(e);
  const startLocal = ctx.local(e);
  const blocked = store.readOnlyReason();
  let active = false;
  const delta = (ev: PointerEvent) => {
    const p = ctx.world(ev);
    return { dx: p.x - start.x, dy: p.y - start.y };
  };
  return {
    move(ev) {
      if (blocked || (!active && !moved(startLocal, ctx.local(ev)))) return;
      active = true;
      const points = segmentDragPreview(model, index, delta(ev));
      if (points) shaping.set({ edgeId, points, ghost: model.drawn, active: { kind: 'segment', index } });
    },
    up(ev) {
      shaping.set(null);
      if (!active) return;
      const d = delta(ev);
      const seg = model.segments[index];
      if (!seg || roundPx(seg.horizontal ? d.dy : d.dx) === 0) return; // not moved square to the segment
      store.apply(dragSegment, out, edgeId, index, d);
    },
    cancel() {
      shaping.set(null);
    },
  };
}

function bendGesture(ctx: GestureContext, e: PointerEvent, edgeId: string, index: number): Gesture | null {
  const { store } = ctx;
  const cur = current(store, edgeId);
  if (!cur) return null;
  const { out, model } = cur;
  const at = model.bends[index];
  if (!at) return null;
  const start = ctx.world(e);
  const startLocal = ctx.local(e);
  const blocked = store.readOnlyReason();
  // UI39: a bend point snaps to the blocks, the line's other bend points and its two ports.
  const targets: SnapTarget[] = [
    ...out.result.nodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })),
    ...model.bends.filter((_p, k) => k !== index).map((p) => ({ x: p[0], y: p[1] })),
    { x: model.v[0]![0], y: model.v[0]![1] },
    { x: model.v[model.v.length - 1]![0], y: model.v[model.v.length - 1]![1] },
  ];
  const snapper = snapSession(store, { x: at[0], y: at[1] }, targets);
  let active = false;
  const target = (ev: PointerEvent) => {
    const p = ctx.world(ev);
    const d = snapper.offset(p.x - start.x, p.y - start.y, ev.altKey);
    return { x: at[0] + d.dx, y: at[1] + d.dy };
  };
  return {
    move(ev) {
      if (blocked || (!active && !moved(startLocal, ctx.local(ev)))) return;
      active = true;
      shaping.set({ edgeId, points: bendDragPreview(model, index, target(ev)), ghost: model.drawn, active: { kind: 'bend', index } });
    },
    up(ev) {
      shaping.set(null);
      if (!active) {
        snapper.end();
        return;
      }
      const to = target(ev);
      snapper.end();
      if (roundPx(to.x) === at[0] && roundPx(to.y) === at[1]) return; // back where it was
      store.apply(dragBend, out, edgeId, index, to);
    },
    cancel() {
      snapper.end();
      shaping.set(null);
    },
  };
}

/** UI37: drag the label along its line; on release its centre is projected onto the line and written as `label_at`. */
function labelGesture(ctx: GestureContext, e: PointerEvent, edgeId: string): Gesture | null {
  const { store } = ctx;
  const doc = store.getState().shown?.doc;
  const out = doc?.layout;
  const edge = out?.result.edges.find((x) => x.id === edgeId);
  if (!out || !edge?.label_pos || edge.points.length < 2) return null;
  const pts = edge.points.map((p): XY => [p[0], p[1]]);
  const c0 = edge.label_pos;
  const start = ctx.world(e);
  const startLocal = ctx.local(e);
  const blocked = store.readOnlyReason();
  let active = false;
  const centre = (ev: PointerEvent) => {
    const p = ctx.world(ev);
    return { x: c0[0] + p.x - start.x, y: c0[1] + p.y - start.y };
  };
  return {
    move(ev) {
      if (blocked || (!active && !moved(startLocal, ctx.local(ev)))) return;
      active = true;
      const c = centre(ev);
      const at = pointAtFraction(pts, projectOntoPolyline(pts, [c.x, c.y]));
      shaping.set({ edgeId, label: [at[0], at[1]] });
    },
    up(ev) {
      shaping.set(null);
      if (!active) return;
      store.apply(setLabelAt, out, edgeId, centre(ev));
    },
    cancel() {
      shaping.set(null);
    },
  };
}

const edgeGesture: GestureFactory<'edge'> | undefined = registerGesture('edge', (hit, e, ctx): Gesture | null => {
  const el = e.target instanceof Element ? e.target : null;
  if (el && !extendsSelection(e) && e.button === 0) {
    const seg = el.closest<SVGElement>('[data-segment]');
    const bend = el.closest<SVGElement>('[data-bend]');
    const label = el.closest<SVGElement>('[data-role="edge-label"]');
    const g = seg
      ? segmentGesture(ctx, e, hit.id, Number(seg.dataset.segment))
      : bend
        ? bendGesture(ctx, e, hit.id, Number(bend.dataset.bend))
        : label
          ? labelGesture(ctx, e, hit.id)
          : null;
    if (g) {
      // Like a click on the line, a press on its handles or label selects it (and only it).
      const sel = ctx.store.getState().selection;
      if (!(sel.edges.length === 1 && sel.edges[0] === hit.id && sel.nodes.length === 0)) ctx.store.select({ edges: [hit.id] });
      return g;
    }
  }
  return edgeGesture ? edgeGesture(hit, e, ctx) : null;
});
