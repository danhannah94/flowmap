// Line shaping geometry for the canvas (design.md §8.2 UI36–UI38, §6 L11/L12), in diagram (world) coordinates. Pure:
// no DOM, no store. The edit itself is always a core operation (src/core/ops/lines.ts, edges.ts); this module only
// works out what to draw while a drag is in progress, and where the handles go, numbered exactly as the operations
// number them:
// - `data-segment="<i>"`: segment i of the merged drawn line (`mergePolyline` / `segmentRuns` of the layout's points).
// - `data-bend="<i>"`: stored bend point i after becoming manual. For an automatic line those are the corners of its
//   drawn line except the two ends, plus an end that isn't at its side's port (the op's "manual form").
// Previews follow the same rules the layout will apply after the drop (L11 for manual lines), so what is drawn during
// the drag is what the line becomes.
import { endAtPort, mergePolyline, nodePort, pointFromStored, type LayoutOutput } from '../../core/layout';
import { roundPx } from '../../core/layoutfile';
import { STUB, segmentRuns } from '../../core/ops/lines';
import type { Direction, LayoutEdgeEntry, LayoutResult, Side } from '../../core/types';

export type XY = [number, number];
type NodeBox = LayoutResult['nodes'][number];
type Edge = LayoutResult['edges'][number];

/** The unit vector pointing out of a side. */
export const OUT: Record<Side, XY> = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };

const horizontal = (s: Side) => s === 'left' || s === 'right';
const same = (a: XY, b: XY) => a[0] === b[0] && a[1] === b[1];
const lined = (a: XY, b: XY) => a[0] === b[0] || a[1] === b[1];

/**
 * §6 L11 in real coordinates: port `a` (side `sa`) → each bend point → port `b` (side `sb`). A step between points that
 * aren't lined up gets one elbow: out of a port, perpendicular to its side first; into a port, arriving perpendicular
 * to its side; between bend points, along the flow first (x for LR, y for TB). Consecutive repeats are dropped.
 */
export function manualPath(a: XY, sa: Side, pts: readonly XY[], b: XY, sb: Side, dir: Direction): XY[] {
  const out: XY[] = [];
  const push = (p: XY) => {
    const last = out[out.length - 1];
    if (!last || !same(last, p)) out.push([p[0], p[1]]);
  };
  push(a);
  if (pts.length === 0) {
    if (!lined(a, b)) push(horizontal(sa) ? [b[0], a[1]] : [a[0], b[1]]);
    push(b);
    return out;
  }
  const first = pts[0]!;
  if (!lined(a, first)) push(horizontal(sa) ? [first[0], a[1]] : [a[0], first[1]]);
  push(first);
  for (let k = 1; k < pts.length; k++) {
    const p = pts[k - 1]!;
    const q = pts[k]!;
    if (!lined(p, q)) push(dir === 'TB' ? [p[0], q[1]] : [q[0], p[1]]);
    push(q);
  }
  const last = pts[pts.length - 1]!;
  if (!lined(last, b)) push(horizontal(sb) ? [last[0], b[1]] : [b[0], last[1]]);
  push(b);
  return out;
}

/**
 * The side of a box that faces a point most (R11.7: a manual line's end with no stored side faces its nearest bend
 * point). Mirrors the layout's rule: the largest overshoot past a side wins; ties go +along, +across, −across, −along.
 */
export function facingSide(dir: Direction, box: Pick<NodeBox, 'x' | 'y' | 'width' | 'height'>, p: XY): Side {
  const LR = dir !== 'TB';
  // Abstract: x along the flow, y across it.
  const bx = LR ? box.x : box.y;
  const by = LR ? box.y : box.x;
  const bw = LR ? box.width : box.height;
  const bh = LR ? box.height : box.width;
  const px = LR ? p[0] : p[1];
  const py = LR ? p[1] : p[0];
  const real: Side[] = LR ? ['right', 'bottom', 'top', 'left'] : ['bottom', 'right', 'left', 'top'];
  const over = [px - (bx + bw), py - (by + bh), by - py, bx - px];
  let best = 0;
  for (let k = 1; k < 4; k++) if (over[k]! > over[best]!) best = k;
  return real[best]!;
}

/** Everything the handles and previews need about one line, read from the current layout and the layout file. */
export interface LineModel {
  id: string;
  edge: Edge;
  source: NodeBox;
  target: NodeBox;
  direction: Direction;
  /** Its stored points apply (§5). */
  manual: boolean;
  /** The drawn line (the layout's `points`, `data-points`). */
  drawn: XY[];
  /** The line in the operations' manual form: the source port, the drawn line, the target port (§6 L11). */
  v: XY[];
  /** How many vertices were put in front of the drawn line (1 when the source end isn't at its port). */
  lead: number;
  /** Bend point i (`data-bend`) as drawn. */
  bends: XY[];
  /** Merged segment i (`data-segment`) of the drawn line: its end points, its middle and its orientation. */
  segments: { a: XY; b: XY; mid: XY; horizontal: boolean }[];
  /** The sides stored in the layout file, if any (the layout chooses the others). */
  stored: { source?: Side; target?: Side };
}

/**
 * Read a line the way the shaping operations do (`readLine` in ops/lines.ts): for a manual line, its stored points; for
 * an automatic one, the corners it would store on becoming manual. Null when the layout has no drawn line for it.
 */
export function lineModel(output: LayoutOutput, entry: LayoutEdgeEntry | undefined, edgeId: string): LineModel | null {
  const result = output.result;
  const edge = result.edges.find((e) => e.id === edgeId);
  if (!edge || edge.points.length < 2) return null;
  const source = result.nodes.find((n) => n.id === edge.source);
  const target = result.nodes.find((n) => n.id === edge.target);
  if (!source || !target) return null;
  const drawn = edge.points.map((p): XY => [p[0], p[1]]);
  const merged = mergePolyline(drawn);
  const segments = [];
  for (let k = 0; k + 1 < merged.length; k++) {
    const a = merged[k]! as XY;
    const b = merged[k + 1]! as XY;
    segments.push({ a, b, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as XY, horizontal: a[1] === b[1] });
  }
  const stored: LineModel['stored'] = {};
  if (entry?.source_side) stored.source = entry.source_side;
  if (entry?.target_side) stored.target = entry.target_side;
  const base = { id: edgeId, edge, source, target, direction: result.direction, drawn, segments, stored };
  if (edge.manual && entry?.points) {
    const bends: XY[] = [];
    for (const p of entry.points) {
      const xy = pointFromStored(result, output.translation, p);
      if (xy) bends.push([xy[0], xy[1]]);
    }
    return { ...base, manual: true, v: drawn, lead: 0, bends };
  }
  const srcOff = !endAtPort(result, edgeId, 'source');
  const tgtOff = !endAtPort(result, edgeId, 'target');
  const v: XY[] = [
    ...(srcOff ? [nodePort(source, edge.source_side) as XY] : []),
    ...drawn,
    ...(tgtOff ? [nodePort(target, edge.target_side) as XY] : []),
  ];
  return { ...base, manual: false, v, lead: srcOff ? 1 : 0, bends: v.slice(1, -1) };
}

/** The sides the line will use once `bends` are its points (§6 L12, R11.7), and so its two ports. */
function ends(m: LineModel, bends: readonly XY[]): { sa: Side; sb: Side; a: XY; b: XY } {
  let sa: Side;
  let sb: Side;
  if (!m.manual) {
    // Becoming manual stores the sides the line uses now.
    sa = m.edge.source_side;
    sb = m.edge.target_side;
  } else {
    sa = m.stored.source ?? (bends.length ? facingSide(m.direction, m.source, bends[0]!) : m.edge.source_side);
    sb = m.stored.target ?? (bends.length ? facingSide(m.direction, m.target, bends[bends.length - 1]!) : m.edge.target_side);
  }
  return { sa, sb, a: nodePort(m.source, sa) as XY, b: nodePort(m.target, sb) as XY };
}

/** The line redrawn through `bends` by L11, with the sides it will have (the bend-drag preview). */
export function pathThrough(m: LineModel, bends: readonly XY[]): XY[] {
  if (bends.length === 0) return m.drawn; // no points left: automatic again, routed by the layout
  const { sa, sb, a, b } = ends(m, bends);
  return manualPath(a, sa, bends, b, sb, m.direction);
}

/** UI36 bend drag: bend point `index` moved to `to` (rounded as the op rounds). */
export function bendDragPreview(m: LineModel, index: number, to: { x: number; y: number }): XY[] {
  const bends = m.bends.map((p, k): XY => (k === index ? [roundPx(to.x), roundPx(to.y)] : p));
  return pathThrough(m, bends);
}

/**
 * UI36 segment drag, as `dragSegment` does it: merged segment `segment` slides perpendicular to itself by the matching
 * part of `delta` (rounded); an end of it at a port first gets a stub 20 px out. Returns the line the layout will draw
 * through the resulting corners (L11), ports included; tidy's removals don't change that drawing. Null for a segment
 * that isn't horizontal or vertical.
 */
export function segmentDragPreview(m: LineModel, segment: number, delta: { dx: number; dy: number }): XY[] | null {
  const runs = segmentRuns(m.v.slice(m.lead, m.lead + m.drawn.length));
  const seg = runs[segment];
  if (!seg) return null;
  const v = m.v;
  const a = seg.a + m.lead;
  const b = seg.b + m.lead;
  const last = v.length - 1;
  const isH = v[a]![1] === v[b]![1];
  if (!isH && v[a]![0] !== v[b]![0]) return null;
  const d = roundPx(isH ? delta.dy : delta.dx);
  const move = (p: XY): XY => (isH ? [p[0], p[1] + d] : [p[0] + d, p[1]]);
  const ux = Math.sign(v[b]![0] - v[a]![0]);
  const uy = Math.sign(v[b]![1] - v[a]![1]);
  const out: XY[] = [];
  for (let j = 0; j < a; j++) out.push(v[j]!);
  if (a === 0) {
    const stub: XY = [v[0]![0] + ux * STUB, v[0]![1] + uy * STUB];
    out.push(v[0]!, stub, move(stub));
  } else out.push(move(v[a]!));
  for (let j = a + 1; j < b; j++) out.push(move(v[j]!));
  if (b === last) {
    const stub: XY = [v[last]![0] - ux * STUB, v[last]![1] - uy * STUB];
    out.push(move(stub), stub, v[last]!);
  } else out.push(move(v[b]!));
  for (let j = b + 1; j <= last; j++) out.push(v[j]!);
  // The op stores every corner but the two ends; the layout then draws them by L11 (which adds an elbow where a port
  // inside a slanted or curved outline isn't lined up with its neighbour).
  return pathThrough(m, out.slice(1, -1));
}

/** Drop consecutive repeats and points in a straight row (for drawing; the handles use the model). */
export function dedupe(pts: readonly XY[]): XY[] {
  const out: XY[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && same(last, p)) continue;
    if (out.length >= 2) {
      const q = out[out.length - 2]!;
      if ((q[0] === last![0] && last![0] === p[0]) || (q[1] === last![1] && last![1] === p[1])) {
        // In a straight row: keep the turning point only if the line doubles back.
        const back = (last![0] - q[0]) * (p[0] - last![0]) < 0 || (last![1] - q[1]) * (p[1] - last![1]) < 0;
        if (!back) {
          out[out.length - 1] = [p[0], p[1]];
          continue;
        }
      }
    }
    out.push([p[0], p[1]]);
  }
  return out;
}

/**
 * An orthogonal connector for the connect and reconnect previews (UI38: "drawn orthogonally, bending the way the final
 * line will"): out of port `a` perpendicular to side `sa`, into `b` perpendicular to side `sb` (or, with `sb` null, the
 * pointer, reached with at most one more bend). The layout's router makes the final choice for an automatic line; this
 * follows the same conventions (leave and arrive square to the side, a stub where the line has to turn back).
 */
export function connectorPath(a: XY, sa: Side, b: XY, sb: Side | null): XY[] {
  const [ox, oy] = OUT[sa];
  const a1: XY = [a[0] + ox * STUB, a[1] + oy * STUB];
  const ahead = (p: XY) => (p[0] - a[0]) * ox + (p[1] - a[1]) * oy;
  if (sb === null) {
    if (horizontal(sa)) return dedupe(ahead(b) >= STUB ? [a, [b[0], a[1]], b] : [a, a1, [a1[0], b[1]], b]);
    return dedupe(ahead(b) >= STUB ? [a, [a[0], b[1]], b] : [a, a1, [b[0], a1[1]], b]);
  }
  const [ix, iy] = OUT[sb];
  const b1: XY = [b[0] + ix * STUB, b[1] + iy * STUB];
  // How far `b` is beyond `p`, seen from the side `b` is entered from (positive: `p` is outside, in front of b's side).
  const before = (p: XY) => (p[0] - b[0]) * ix + (p[1] - b[1]) * iy;
  const ha = horizontal(sa);
  const hb = horizontal(sb);
  if (ha && hb) {
    if (ox === -ix && ahead(b) >= 2 * STUB) {
      const mx = Math.round((a[0] + b[0]) / 2); // facing each other with room: a Z
      return dedupe([a, [mx, a[1]], [mx, b[1]], b]);
    }
    if (ox === ix) {
      const x = ox > 0 ? Math.max(a1[0], b1[0]) : Math.min(a1[0], b1[0]); // both out the same way: a U
      return dedupe([a, [x, a[1]], [x, b[1]], b]);
    }
    const my = Math.round((a[1] + b[1]) / 2); // turning back: around, between them
    return dedupe([a, a1, [a1[0], my], [b1[0], my], b1, b]);
  }
  if (!ha && !hb) {
    if (oy === -iy && ahead(b) >= 2 * STUB) {
      const my = Math.round((a[1] + b[1]) / 2);
      return dedupe([a, [a[0], my], [b[0], my], b]);
    }
    if (oy === iy) {
      const y = oy > 0 ? Math.max(a1[1], b1[1]) : Math.min(a1[1], b1[1]);
      return dedupe([a, [a[0], y], [b[0], y], b]);
    }
    const mx = Math.round((a[0] + b[0]) / 2);
    return dedupe([a, a1, [mx, a1[1]], [mx, b1[1]], b1, b]);
  }
  // One horizontal side, one vertical: a single elbow when it lies ahead of both.
  const c: XY = ha ? [b[0], a[1]] : [a[0], b[1]];
  if (ahead(c) > 0 && before(c) > 0) return dedupe([a, c, b]);
  return dedupe(ha ? [a, a1, [a1[0], b1[1]], b1, b] : [a, a1, [b1[0], a1[1]], b1, b]);
}

/** The screen-space distance within which a pointer is "on" a connection point (UI38). */
export const PORT_SNAP_PX = 12;

/**
 * How close (world px) the pointer must be to one of `node`'s connection points to be on it: PORT_SNAP_PX on screen,
 * but never more than 30% of the block's smaller side, so the middle of even a small block is "elsewhere on the block"
 * (a drop there leaves the side to the layout).
 */
export function portSnapRadius(node: Pick<NodeBox, 'width' | 'height'>, zoom: number): number {
  return Math.min(PORT_SNAP_PX / zoom, 0.3 * Math.min(node.width, node.height));
}

/**
 * The connection point of `node` nearest to `p`, and whether `p` is on it (within `snapWorld`). Ports are the four
 * L12 ports (diamonds at their vertices), in the order top, right, bottom, left.
 */
export function nearestPort(node: NodeBox, p: { x: number; y: number }, snapWorld: number): { side: Side; at: XY; on: boolean } {
  const sides: Side[] = ['top', 'right', 'bottom', 'left'];
  let best: { side: Side; at: XY; d: number } | null = null;
  for (const side of sides) {
    const at = nodePort(node, side) as XY;
    const d = Math.hypot(at[0] - p.x, at[1] - p.y);
    if (!best || d < best.d) best = { side, at, d };
  }
  return { side: best!.side, at: best!.at, on: best!.d <= snapWorld };
}
