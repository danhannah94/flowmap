// Geometry helpers on laid-out diagrams (v1.1), shared by the layout, the UI and the edit operations so that all of
// them measure lines, ports and lanes the same way. Pure; coordinates are diagram coordinates (the layout JSON's).
import type { LayoutResult, Pin, Side } from '../types';
import { SIDES } from '../types';
import { portPoint } from '../shapes';

export type Point = [number, number];

/** Total length of a polyline. */
export function polylineLength(points: readonly Point[]): number {
  let len = 0;
  for (let k = 0; k + 1 < points.length; k++) len += Math.hypot(points[k + 1]![0] - points[k]![0], points[k + 1]![1] - points[k]![1]);
  return len;
}

/**
 * The point at fraction `f` (0 to 1) of a polyline's length from its first point (§5 `label_at`, §6 L8). Not rounded.
 * An empty polyline gives [0, 0]; a zero-length one its first point.
 */
export function pointAtFraction(points: readonly Point[], f: number): Point {
  if (points.length === 0) return [0, 0];
  const total = polylineLength(points);
  let rest = Math.min(1, Math.max(0, f)) * total;
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, ay] = points[k]!;
    const [bx, by] = points[k + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    if (len > 0 && rest <= len) return [ax + ((bx - ax) * rest) / len, ay + ((by - ay) * rest) / len];
    rest -= len;
  }
  const last = points[points.length - 1]!;
  return [last[0], last[1]];
}

/**
 * Projects a point onto the nearest point of a polyline and returns where that is as a fraction of the line's length
 * from its first point, rounded to two decimals (UI37: dragging a label writes this as `label_at`). Ties go to the
 * earlier segment. A zero-length line gives 0.
 */
export function projectOntoPolyline(points: readonly Point[], p: Point): number {
  const total = polylineLength(points);
  if (total === 0) return 0;
  let best = Infinity;
  let at = 0;
  let before = 0;
  for (let k = 0; k + 1 < points.length; k++) {
    const [ax, ay] = points[k]!;
    const [bx, by] = points[k + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
    const d = Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1]);
    if (d < best - 1e-9) {
      best = d;
      at = before + t * Math.sqrt(len2);
    }
    before += Math.sqrt(len2);
  }
  return Math.round((at / total) * 100) / 100 + 0;
}

/**
 * The merged drawn line (UI36): zero-length segments dropped, and runs of segments in a straight row (same line, same
 * direction) merged into one. Its segments are what `data-segment` counts. A line turning back on itself keeps the
 * turning point. A line of one point (or none) is returned as is.
 */
export function mergePolyline(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue; // zero-length segment
    if (out.length >= 2) {
      const a = out[out.length - 2]!;
      const b = last!;
      const d1x = Math.sign(b[0] - a[0]);
      const d1y = Math.sign(b[1] - a[1]);
      const d2x = Math.sign(p[0] - b[0]);
      const d2y = Math.sign(p[1] - b[1]);
      // Collinear (cross product 0) and pointing the same way: one straight run.
      const cross = (b[0] - a[0]) * (p[1] - b[1]) - (b[1] - a[1]) * (p[0] - b[0]);
      if (cross === 0 && d1x === d2x && d1y === d2y) {
        out[out.length - 1] = [p[0], p[1]];
        continue;
      }
    }
    out.push([p[0], p[1]]);
  }
  return out;
}

/**
 * The lane a point belongs to (§5, bend points): the lane whose band contains its across coordinate (y for `LR`, x
 * for `TB`), each band including its start edge and excluding its end edge; before the first lane, the first lane;
 * at or after the last lane's end, the last displayed lane. Null only when the layout has no lanes.
 */
export function laneAt(layout: Pick<LayoutResult, 'direction' | 'lanes'>, x: number, y: number): string | null {
  const lanes = layout.lanes;
  if (lanes.length === 0) return null;
  const LR = layout.direction !== 'TB';
  const c = LR ? y : x;
  for (const l of lanes) {
    const start = LR ? l.y : l.x;
    const end = start + (LR ? l.height : l.width);
    if (c < end) return l.id; // bands are stacked from 0: the first band whose end is past c holds it (or c < 0)
  }
  return lanes[lanes.length - 1]!.id;
}

type NodeBox = Pick<LayoutResult['nodes'][number], 'kind' | 'x' | 'y' | 'width' | 'height'>;

/** The port of one side of a laid-out block (§6 L12), in diagram coordinates. */
export function nodePort(node: NodeBox, side: Side): Point {
  return portPoint(node.kind, node, side);
}

/** All four ports of a laid-out block, in the order top, right, bottom, left (UI38's handle order). */
export function nodePorts(node: NodeBox): { side: Side; point: Point }[] {
  return SIDES.map((side) => ({ side, point: nodePort(node, side) }));
}

/**
 * Whether one end of a laid-out edge is at the port of the side it uses (within 2 px, as §6 L12 allows). UI36's
 * "becoming manual" stores an end that isn't as a bend point too. False for an edge or node not in the layout.
 */
export function endAtPort(layout: Pick<LayoutResult, 'nodes' | 'edges'>, edgeId: string, end: 'source' | 'target'): boolean {
  const e = layout.edges.find((x) => x.id === edgeId);
  if (!e || e.points.length === 0) return false;
  const node = layout.nodes.find((n) => n.id === (end === 'source' ? e.source : e.target));
  if (!node) return false;
  const p = end === 'source' ? e.points[0]! : e.points[e.points.length - 1]!;
  const q = nodePort(node, end === 'source' ? e.source_side : e.target_side);
  return Math.hypot(p[0] - q[0], p[1] - q[1]) <= 2;
}

/** The frame of a layout (§6): T along the flow, U across (in the first lane). See `LayoutOutput.translation`. */
export interface Frame {
  along: number;
  across: number;
}

/**
 * Where a stored bend point (or pin corner) `{lane, along, across}` is drawn, in diagram coordinates: `along` + T on
 * the flow axis; across from the lane's zero line (its start edge, plus U in the first lane). Null for a lane that
 * isn't in the layout.
 */
export function pointFromStored(layout: Pick<LayoutResult, 'direction' | 'lanes'>, frame: Frame, p: Pin): Point | null {
  const li = layout.lanes.findIndex((l) => l.id === p.lane);
  if (li < 0) return null;
  const lane = layout.lanes[li]!;
  const LR = layout.direction !== 'TB';
  const a = p.along + frame.along;
  const c = (LR ? lane.y : lane.x) + (li === 0 ? frame.across : 0) + p.across;
  return LR ? [a, c] : [c, a];
}

/**
 * The stored form of a point drawn at diagram coordinates (x, y) (§5, UI36, UI43): its lane by `laneAt`, `along`
 * minus T, `across` from the lane's zero line. `across` may be negative only in the first lane; elsewhere a point
 * before the zero line is stored at 0. Coordinates are rounded to whole pixels. Null when the layout has no lanes.
 */
export function storedFromPoint(layout: Pick<LayoutResult, 'direction' | 'lanes'>, frame: Frame, x: number, y: number): Pin | null {
  const id = laneAt(layout, x, y);
  if (id === null) return null;
  const li = layout.lanes.findIndex((l) => l.id === id);
  const lane = layout.lanes[li]!;
  const LR = layout.direction !== 'TB';
  const along = Math.round((LR ? x : y) - frame.along) + 0;
  const across = Math.round((LR ? y : x) - (LR ? lane.y : lane.x) - (li === 0 ? frame.across : 0)) + 0;
  return { lane: id, along, across: li === 0 ? across : Math.max(0, across) };
}
