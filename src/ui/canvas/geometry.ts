// Canvas geometry in layout (world) coordinates: lanes under a point, drop positions as pins (§5), edge paths.
import { outlineInset } from '../../core/measure';
import { MIN_LANE } from '../../core/layout';
import { UNASSIGNED, type LayoutResult, type ShapeKind } from '../../core/types';
import type { DropPosition } from '../../core/ops';
import type { Point, Rect } from './viewport';

export type LayoutLane = LayoutResult['lanes'][number];
export type LayoutNode = LayoutResult['nodes'][number];
export type LayoutEdge = LayoutResult['edges'][number];

/** The lane whose band contains `p` (§6 L1: horizontal bands for LR, vertical for TB), or null outside every lane. */
export function laneAt(layout: LayoutResult, p: Point): LayoutLane | null {
  for (const lane of layout.lanes) {
    if (p.x >= lane.x && p.x < lane.x + lane.width && p.y >= lane.y && p.y < lane.y + lane.height) return lane;
  }
  return null;
}

/**
 * The lane a block whose centre is at `p` is dropped into (UI11, amendment A4): the lane under it, or Unassigned when
 * it is outside every lane (beyond the last lane, or outside the lanes' extent along the flow). In a lane-free
 * diagram every block is unlaned, so a drop anywhere keeps it there.
 */
export function dropLaneAt(layout: LayoutResult, p: Point): string {
  return laneAt(layout, p)?.id ?? UNASSIGNED;
}

/**
 * The band of `lane` for drop positions: its band in the layout, or, for an Unassigned lane that isn't showing yet
 * (no block is unlaned), where it will appear: after the last lane (a first estimate: the drop action corrects it
 * against the layout that results).
 */
export function dropBand(layout: LayoutResult, lane: string): LayoutLane {
  const found = layout.lanes.find((l) => l.id === lane);
  if (found) return found;
  return layout.direction === 'TB'
    ? { id: lane, label: 'Unassigned', x: layout.width, y: 0, width: MIN_LANE, height: layout.height }
    : { id: lane, label: 'Unassigned', x: 0, y: layout.height, width: layout.width, height: MIN_LANE };
}

/**
 * Where a box whose top-left is at `topLeft` would be pinned in `lane` (§5): `along` the flow from the diagram's
 * origin, `across` from the lane's start edge. Unrounded; the ops round and clamp (UI10).
 */
export function dropPosition(layout: LayoutResult, lane: LayoutLane, topLeft: Point): DropPosition {
  return layout.direction === 'TB'
    ? { along: topLeft.y, across: topLeft.x - lane.x }
    : { along: topLeft.x, across: topLeft.y - lane.y };
}

export function centre(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * Split a label into what each wrapped line shows, keeping the label's own characters: each piece is the original
 * substring for that line, and `sep` the original whitespace before it. Joined, they give back the label exactly, so
 * the label element's text is the label (the whitespace between lines is invisible in a block layout).
 */
export function labelPieces(label: string, lines: readonly string[]): { sep: string; text: string }[] {
  const out: { sep: string; text: string }[] = [];
  let pos = 0;
  for (const line of lines) {
    const words = line.split(' ').filter((w) => w.length > 0);
    const wsStart = pos;
    while (pos < label.length && /\s/.test(label[pos]!)) pos++;
    const sep = label.slice(wsStart, pos);
    const start = pos;
    for (let i = 0; i < words.length; i++) {
      if (i > 0) while (pos < label.length && /\s/.test(label[pos]!)) pos++;
      const w = words[i]!;
      if (label.startsWith(w, pos)) pos += w.length;
      else return [{ sep: '', text: label }]; // unexpected: fall back to one piece
    }
    out.push({ sep, text: label.slice(start, pos) });
  }
  if (pos < label.length && out.length) out[out.length - 1]!.text += label.slice(pos);
  return out.length ? out : [{ sep: '', text: label }];
}

type Side = 'top' | 'right' | 'bottom' | 'left';

/** Which side of `box` the boundary point `p` lies on (the nearest one). */
function sideOf(box: Rect, p: Point): { side: Side; t: number; dist: number } {
  const cands: { side: Side; t: number; dist: number }[] = [
    { side: 'top', t: p.x - box.x, dist: Math.abs(p.y - box.y) },
    { side: 'bottom', t: p.x - box.x, dist: Math.abs(p.y - (box.y + box.height)) },
    { side: 'left', t: p.y - box.y, dist: Math.abs(p.x - box.x) },
    { side: 'right', t: p.y - box.y, dist: Math.abs(p.x - (box.x + box.width)) },
  ];
  cands.sort((a, b) => a.dist - b.dist);
  return cands[0]!;
}

/**
 * Pull an edge end that lies on a node's box boundary inward, onto the drawn outline (diamond faces, round ends,
 * slanted sides), so arrowheads touch the shape. `inward` is the unit direction from the end into the box.
 */
function snapToOutline(p: Point, inward: Point, node: { kind: ShapeKind } & Rect): Point {
  const { side, t, dist } = sideOf(node, p);
  if (dist > 3) return p;
  const inset = outlineInset(node.kind, node.width, node.height, side, t);
  if (!(inset > 0.25)) return p;
  // Only straight-in approaches are extended (the router's segments are orthogonal to the side they meet).
  const perpendicular = side === 'top' || side === 'bottom' ? Math.abs(inward.y) > 0.9 : Math.abs(inward.x) > 0.9;
  if (!perpendicular) return p;
  return { x: p.x + inward.x * inset, y: p.y + inward.y * inset };
}

function unit(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** The drawn polyline of an edge: the layout's points, with both ends snapped onto their shapes' outlines. */
export function edgePoints(
  edge: LayoutEdge,
  source: ({ kind: ShapeKind } & Rect) | undefined,
  target: ({ kind: ShapeKind } & Rect) | undefined,
): Point[] {
  const pts = edge.points.map(([x, y]) => ({ x, y }));
  if (pts.length < 2) return pts;
  if (source) pts[0] = snapToOutline(pts[0]!, unit(pts[1]!, pts[0]!), source);
  if (target) {
    const n = pts.length;
    pts[n - 1] = snapToOutline(pts[n - 1]!, unit(pts[n - 2]!, pts[n - 1]!), target);
  }
  return pts;
}

/** An SVG path through orthogonal points with softly rounded corners. */
export function roundedPath(pts: readonly Point[], radius = 8): string {
  if (pts.length === 0) return '';
  const f = (n: number) => Math.round(n * 100) / 100;
  let d = `M${f(pts[0]!.x)},${f(pts[0]!.y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const lin = Math.hypot(b.x - a.x, b.y - a.y);
    const lout = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(radius, lin / 2, lout / 2);
    if (r < 0.5) {
      d += `L${f(b.x)},${f(b.y)}`;
      continue;
    }
    const p1 = { x: b.x + ((a.x - b.x) / lin) * r, y: b.y + ((a.y - b.y) / lin) * r };
    const p2 = { x: b.x + ((c.x - b.x) / lout) * r, y: b.y + ((c.y - b.y) / lout) * r };
    d += `L${f(p1.x)},${f(p1.y)}Q${f(b.x)},${f(b.y)} ${f(p2.x)},${f(p2.y)}`;
  }
  const last = pts[pts.length - 1]!;
  d += `L${f(last.x)},${f(last.y)}`;
  return d;
}
