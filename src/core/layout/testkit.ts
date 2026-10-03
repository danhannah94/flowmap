// Test utilities for the layout: a strict geometric checker for §6 L1–L8 (L10 is checked by running twice), quality
// statistics, a seeded random graph generator and a hand-built copy of fixtures/purchase-request. Pure: no fs.
import type { Graph, GraphEdge, GraphNode, LayoutEdgeEntry, LayoutFile, LayoutResult, NoteInput, Pin, ShapeKind, Side } from '../types';
import { SHAPE_KINDS, SIDES, UNASSIGNED, sizeOf } from '../types';
import { LABEL_FONT, SHAPE_GEOMETRY, labelNeeds, noteSize, textArea, textWidth, titleSize, wrapLabel } from '../measure';

type Box = { x: number; y: number; width: number; height: number };

const interiorHit = (ax: number, ay: number, bx: number, by: number, r: Box): boolean => {
  // Does the segment (axis-aligned) pass through the open interior of r?
  if (ay === by) {
    if (!(ay > r.y && ay < r.y + r.height)) return false;
    return Math.max(ax, bx) > r.x && Math.min(ax, bx) < r.x + r.width;
  }
  if (!(ax > r.x && ax < r.x + r.width)) return false;
  return Math.max(ay, by) > r.y && Math.min(ay, by) < r.y + r.height;
};

/** Distance from a point to the boundary of a box (0 on it). */
export function distToBoundary(px: number, py: number, b: Box): number {
  const dx = Math.max(b.x - px, 0, px - (b.x + b.width));
  const dy = Math.max(b.y - py, 0, py - (b.y + b.height));
  if (dx === 0 && dy === 0) return Math.min(px - b.x, b.x + b.width - px, py - b.y, b.y + b.height - py);
  return Math.hypot(dx, dy);
}

const overlapsWithin = (a: Box, b: Box, gap: number): boolean =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** SCC ids (plain recursive Tarjan: independent of the layout's own implementation). */
export function scc(ids: string[], edges: { source: string; target: string }[]): Map<string, number> {
  const out = new Map<string, string[]>(ids.map((i) => [i, []]));
  for (const e of edges) out.get(e.source)?.push(e.target);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const on = new Set<string>();
  const st: string[] = [];
  const comp = new Map<string, number>();
  let c = 0;
  let k = 0;
  const visit = (v: string) => {
    index.set(v, k);
    low.set(v, k++);
    st.push(v);
    on.add(v);
    for (const w of out.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      let w: string;
      do {
        w = st.pop()!;
        on.delete(w);
        comp.set(w, c);
      } while (w !== v);
      c++;
    }
  };
  for (const v of ids) if (!index.has(v)) visit(v);
  return comp;
}

export interface CheckOptions {
  /** Also flag quality problems that §6 allows: edges through their own source/target, labels over boxes. */
  strict?: boolean;
  /**
   * v1.1: the layout file the result was laid out from, for sizes (L4), set sides (L12), manual lines (L11, and L4 for
   * bend points), `label_at` (L8), and note and title positions. Its pins are ignored: pass them as `pins`.
   */
  file?: LayoutFile | null;
  /** v1.1: the notes and title the result was laid out with (checked only when given). */
  notes?: NoteInput[];
  title?: string | null;
}

/**
 * Where a side's port is expected (§6 L12), written independently of the layout: on the side's midline
 * (`floor(size / 2)`), on the box edge, except where the drawn outline is inside it there: the parallelogram's slanted
 * sides (half the skew) and the document's wavy bottom (the wave's amplitude). Diamonds: the vertices. The check allows
 * 2 px, which also covers round ends narrower than their radius.
 */
export function expectedPort(kind: ShapeKind, b: Box, side: Side): [number, number] {
  let inset = 0;
  if (kind === 'io' && (side === 'left' || side === 'right')) inset = SHAPE_GEOMETRY.ioSkew / 2;
  if (kind === 'document' && side === 'bottom') inset = SHAPE_GEOMETRY.documentWave;
  const cx = b.x + Math.floor(b.width / 2);
  const cy = b.y + Math.floor(b.height / 2);
  if (side === 'top') return [cx, b.y + inset];
  if (side === 'bottom') return [cx, b.y + b.height - inset];
  if (side === 'left') return [b.x + inset, cy];
  return [b.x + b.width - inset, cy];
}

/**
 * A22: whether `p` is at the port at fraction `at` along a side, written independently of the layout: on the line
 * across the side at `floor(at × size)` from its start (exactly, within 2 px), and between the box edge and the
 * deepest the outline can be there (20 px; half the box for a diamond's face). With `at` undefined, the midline port
 * (`expectedPort`, within 2 px).
 */
export function atPortAt(kind: ShapeKind, b: Box, side: Side, p: readonly number[], at: number | undefined): boolean {
  if (at === undefined) return dist(p, expectedPort(kind, b, side)) <= 2;
  const vertical = side === 'top' || side === 'bottom';
  const len = vertical ? b.width : b.height;
  const along = (vertical ? b.x : b.y) + Math.floor((Math.round(at * 100) * len) / 100);
  if (Math.abs((vertical ? p[0]! : p[1]!) - along) > 2) return false;
  const deepest = kind === 'decision' ? (vertical ? b.height : b.width) / 2 : 20;
  const depth = side === 'top' ? p[1]! - b.y : side === 'bottom' ? b.y + b.height - p[1]! : side === 'left' ? p[0]! - b.x : b.x + b.width - p[0]!;
  return depth >= -2 && depth <= deepest + 2;
}

const dist = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!);

/** A polyline without zero-length segments and with straight runs merged (the checker's own, independent version). */
function merged(pts: readonly (readonly number[])[]): string {
  const out: number[][] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    const prev = out[out.length - 2];
    if (prev && last) {
      const sameX = prev[0] === last[0] && last[0] === p[0] && Math.sign(last[1]! - prev[1]!) === Math.sign(p[1]! - last[1]!);
      const sameY = prev[1] === last[1] && last[1] === p[1] && Math.sign(last[0]! - prev[0]!) === Math.sign(p[0]! - last[0]!);
      if (sameX || sameY) {
        out[out.length - 1] = [p[0]!, p[1]!];
        continue;
      }
    }
    out.push([p[0]!, p[1]!]);
  }
  return out.map((p) => p.join(',')).join(' ');
}

/** Is point p on the polyline (on one of its segments)? */
function onPolyline(pts: readonly (readonly number[])[], p: readonly number[]): boolean {
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, ay] = pts[k]!;
    const [bx, by] = pts[k + 1]!;
    if (ax === bx && p[0] === ax && p[1]! >= Math.min(ay!, by!) && p[1]! <= Math.max(ay!, by!)) return true;
    if (ay === by && p[1] === ay && p[0]! >= Math.min(ax!, bx!) && p[0]! <= Math.max(ax!, bx!)) return true;
  }
  return pts.length === 1 && pts[0]![0] === p[0] && pts[0]![1] === p[1];
}

/** The point at a fraction of a polyline's length (independent of the layout's helper). */
function atFraction(pts: readonly (readonly number[])[], f: number): [number, number] {
  let total = 0;
  for (let k = 0; k + 1 < pts.length; k++) total += dist(pts[k]!, pts[k + 1]!);
  let rest = f * total;
  for (let k = 0; k + 1 < pts.length; k++) {
    const len = dist(pts[k]!, pts[k + 1]!);
    if (len > 0 && rest <= len) {
      const t = rest / len;
      return [pts[k]![0]! + (pts[k + 1]![0]! - pts[k]![0]!) * t, pts[k]![1]! + (pts[k + 1]![1]! - pts[k]![1]!) * t];
    }
    rest -= len;
  }
  const last = pts[pts.length - 1]!;
  return [last[0]!, last[1]!];
}

/** Checks L1–L8 (and, given `opts.file`, the v1.1 rules L4 sizes, L11, L12, `label_at`) on a layout result. Returns
 * human-readable violations (empty = all good). */
export function checkLayout(graph: Graph, pins: Record<string, Pin>, res: LayoutResult, opts: CheckOptions = {}): string[] {
  const v: string[] = [];
  const LR = res.direction === 'LR';
  const ints = (what: string, ...ns: number[]) => {
    if (ns.some((x) => !Number.isInteger(x))) v.push(`non-integer ${what}: ${ns.join(',')}`);
  };
  const file = opts.file ?? null;
  const entries: Record<string, LayoutEdgeEntry> = file?.edges ?? {};
  const graphLaneIds = new Set(res.lanes.map((l) => l.id));
  // Point sets that apply (§5): every point's lane is displayed.
  const applied = new Map<string, Pin[]>();
  for (const ge of graph.edges) {
    const pts = Object.hasOwn(entries, ge.id) ? entries[ge.id]!.points : undefined;
    if (pts && pts.length && pts.every((p) => graphLaneIds.has(p.lane))) applied.set(ge.id, pts);
  }
  // The frame (§6), computed here independently: applied pins and bend points.
  const firstLane = res.lanes[0]?.id;
  const nodeLane = new Map(graph.nodes.map((n) => [n.id, n.lane]));
  const appliedPins = Object.entries(pins).filter(([id, p]) => nodeLane.get(id) === p.lane).map(([, p]) => p);
  const all = [...appliedPins, ...[...applied.values()].flat()];
  const T = Math.max(0, ...all.map((p) => -p.along));
  const U = Math.max(0, ...all.filter((p) => p.lane === firstLane).map((p) => -p.across));
  ints('diagram size', res.width, res.height);
  if (res.direction !== graph.direction) v.push(`direction ${res.direction} != ${graph.direction}`);

  // L1: lanes in display order, stacked, full span, >= 100 across.
  const expectLanes = graph.lanes.map((l) => l.id);
  const hasUnassigned = graph.nodes.some((n) => n.lane === UNASSIGNED);
  if (hasUnassigned && !expectLanes.includes(UNASSIGNED)) expectLanes.push(UNASSIGNED);
  const got = res.lanes.map((l) => l.id);
  if (got.join('|') !== expectLanes.join('|')) v.push(`L1 lane order ${got.join(',')} != ${expectLanes.join(',')}`);
  if (got.includes(UNASSIGNED) && got[got.length - 1] !== UNASSIGNED) v.push('L1 _unassigned is not last');
  let pos = 0;
  for (const l of res.lanes) {
    ints(`lane ${l.id}`, l.x, l.y, l.width, l.height);
    const start = LR ? l.y : l.x;
    const thick = LR ? l.height : l.width;
    if (start !== pos) v.push(`L1 lane ${l.id} starts at ${start}, expected ${pos}`);
    pos = start + thick;
    if (thick < 100) v.push(`L1 lane ${l.id} is ${thick} across`);
    if (LR ? l.x !== 0 || l.width !== res.width : l.y !== 0 || l.height !== res.height) v.push(`L1 lane ${l.id} doesn't span the diagram`);
  }
  if (res.lanes.length && pos !== (LR ? res.height : res.width)) v.push(`L1 lanes end at ${pos}, diagram is ${LR ? res.height : res.width}`);

  // Nodes: presence and L2, L4.
  const laneOf = new Map(res.lanes.map((l) => [l.id, l]));
  const byId = new Map(res.nodes.map((n) => [n.id, n]));
  if (res.nodes.length !== graph.nodes.length) v.push(`node count ${res.nodes.length} != ${graph.nodes.length}`);
  for (const gn of graph.nodes) {
    const n = byId.get(gn.id);
    if (!n) {
      v.push(`missing node ${gn.id}`);
      continue;
    }
    ints(`node ${n.id}`, n.x, n.y, n.width, n.height);
    if (n.lane !== gn.lane || n.kind !== gn.kind || n.label !== gn.label) v.push(`node ${n.id} lane/kind/label mismatch`);
    const pin = pins[gn.id];
    const shouldPin = !!pin && pin.lane === gn.lane;
    if (n.pinned !== shouldPin) v.push(`node ${n.id} pinned=${n.pinned}, expected ${shouldPin}`);
    const lane = laneOf.get(n.lane);
    if (!lane) {
      v.push(`node ${n.id} lane ${n.lane} missing`);
      continue;
    }
    const pad = n.pinned ? 0 : 12;
    if (n.x < lane.x + pad || n.y < lane.y + pad || n.x + n.width > lane.x + lane.width - pad || n.y + n.height > lane.y + lane.height - pad) {
      if (!n.pinned || n.x < lane.x || n.y < lane.y || n.x + n.width > lane.x + lane.width || n.y + n.height > lane.y + lane.height)
        v.push(`L2 node ${n.id} (${n.x},${n.y} ${n.width}x${n.height}) not inside lane ${lane.id} with padding ${pad}`);
    }
    if (shouldPin) {
      const along = (LR ? n.x : n.y) - T;
      const across = (LR ? n.y - lane.y : n.x - lane.x) - (lane.id === firstLane ? U : 0);
      if (along !== pin!.along || across !== pin!.across) v.push(`L4 node ${n.id} at along ${along}/across ${across}, pin says ${pin!.along}/${pin!.across}`);
    }
    // L4 sizes (§5): per dimension, the larger of the stored size and what the label needs.
    const stored = sizeOf(file?.nodes[gn.id]);
    if (stored) {
      const w = Math.max(stored.width, labelNeeds(n.label, n.kind, stored.width).minWidth);
      const h = Math.max(stored.height, labelNeeds(n.label, n.kind, w).height);
      if (n.width !== w || n.height !== h) v.push(`L4 node ${n.id} is ${n.width}x${n.height}, its effective size is ${w}x${h}`);
    }
    // L9 (as the layout can check it): the label, wrapped at the text area's width, fits the text area.
    const area = textArea(n.kind, n.width, n.height);
    const lines = wrapLabel(n.label, area.width);
    const words = n.label.split(/\s+/).filter(Boolean);
    if (lines.length * LABEL_FONT.lineHeight > area.height) v.push(`L9 node ${n.id}: ${lines.length} lines don't fit ${area.height} px`);
    if (stored && words.some((w) => textWidth(w) > area.width)) v.push(`L9 node ${n.id}: a word is wider than the text area (${area.width} px)`);
  }

  // L3: no two boxes within 16 px, except two pinned.
  const ns = res.nodes;
  const sorted = [...ns].sort((a, b) => a.x - b.x);
  for (let a = 0; a < sorted.length; a++) {
    const A = sorted[a]!;
    for (let b = a + 1; b < sorted.length; b++) {
      const B = sorted[b]!;
      if (B.x >= A.x + A.width + 16) break;
      if (A.pinned && B.pinned) continue;
      if (overlapsWithin(A, B, 16)) v.push(`L3 ${A.id} and ${B.id} closer than 16 px`);
    }
  }

  // L5: flow direction for unpinned, non-SCC edges.
  const comp = scc(graph.nodes.map((n) => n.id), graph.edges);
  for (const e of graph.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t || s.pinned || t.pinned || comp.get(e.source) === comp.get(e.target)) continue;
    if ((LR ? t.x < s.x : t.y < s.y)) v.push(`L5 edge ${e.id} goes against the flow`);
  }

  // L6, L7, L8 per edge.
  const pinnedOverlap = new Set<string>();
  const pinnedNodes = ns.filter((n) => n.pinned);
  for (let a = 0; a < pinnedNodes.length; a++)
    for (let b = a + 1; b < pinnedNodes.length; b++)
      if (overlaps(pinnedNodes[a]!, pinnedNodes[b]!)) {
        pinnedOverlap.add(pinnedNodes[a]!.id);
        pinnedOverlap.add(pinnedNodes[b]!.id);
      }
  const edgeById = new Map(res.edges.map((e) => [e.id, e]));
  if (res.edges.length !== graph.edges.length) v.push(`edge count ${res.edges.length} != ${graph.edges.length}`);
  for (const ge of graph.edges) {
    const e = edgeById.get(ge.id);
    if (!e) {
      v.push(`missing edge ${ge.id}`);
      continue;
    }
    const s = byId.get(ge.source)!;
    const t = byId.get(ge.target)!;
    const pts = e.points;
    if (pts.length < 2) {
      v.push(`L6 edge ${e.id} has ${pts.length} points`);
      continue;
    }
    for (const [x, y] of pts) ints(`edge ${e.id} point`, x, y);
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, ay] = pts[k]!;
      const [bx, by] = pts[k + 1]!;
      if (ax !== bx && ay !== by) v.push(`L6 edge ${e.id} segment ${k} is diagonal`);
    }
    const last = pts[pts.length - 1]!;
    // A22: an end may also be at its own offset port (`source_at` / `target_at`).
    const atAnyPort = (p: readonly number[], n: typeof s) => SIDES.some((side) => dist(p, expectedPort(n.kind, n, side)) <= 2) ||
      (n.id === s.id && dist(p, pts[0]!) === 0 && atPortAt(n.kind, n, e.source_side, p, e.source_at)) ||
      (n.id === t.id && dist(p, pts[pts.length - 1]!) === 0 && atPortAt(n.kind, n, e.target_side, p, e.target_at));
    if (distToBoundary(pts[0]![0], pts[0]![1], s) > 2 && !atAnyPort(pts[0]!, s)) v.push(`L6 edge ${e.id} doesn't start on ${s.id}'s boundary or a port`);
    if (distToBoundary(last[0], last[1], t) > 2 && !atAnyPort(last, t)) v.push(`L6 edge ${e.id} doesn't end on ${t.id}'s boundary or a port`);
    // v1.1: the reported sides; a set side is used as set, and its end is at that side's port (L12).
    const entry = Object.hasOwn(entries, ge.id) ? entries[ge.id]! : undefined;
    const manual = applied.has(ge.id);
    if (e.manual !== manual) v.push(`edge ${e.id} manual=${e.manual}, expected ${manual}`);
    for (const [end, node, p, side, set, setAt, at] of [
      ['source', s, pts[0]!, e.source_side, entry?.source_side, entry?.source_at, e.source_at],
      ['target', t, last, e.target_side, entry?.target_side, entry?.target_at, e.target_at],
    ] as const) {
      if (!SIDES.includes(side)) {
        v.push(`edge ${e.id} ${end}_side is ${String(side)}`);
        continue;
      }
      if (set && side !== set) v.push(`L12 edge ${e.id} ${end}_side ${side}, the file sets ${set}`);
      // A22: a stored offset is reported as stored; without `spread_ends` nothing else is.
      if (set && setAt !== undefined && at !== setAt) v.push(`A22 edge ${e.id} ${end}_at ${String(at)}, the file sets ${setAt}`);
      if (setAt === undefined && at !== undefined && !opts.file?.spread_ends) v.push(`A22 edge ${e.id} reports ${end}_at ${at} unasked`);
      if (at !== undefined && !(at >= 0 && at <= 1 && Number(at.toFixed(2)) === at)) v.push(`A22 edge ${e.id} ${end}_at ${at} isn't a two-decimal fraction`);
      const port = expectedPort(node.kind, node, side);
      if (set || manual) {
        if (!atPortAt(node.kind, node, side, p, at)) {
          v.push(`L12 edge ${e.id} ${end} at ${p.join(',')}, not at ${node.id}'s ${side} port${at === undefined ? ` ${port.join(',')}` : ` at ${at}`}`);
        }
      } else {
        // The side used: the end is on that side of the box (or at its port).
        const onSide = side === 'top' || side === 'bottom'
          ? Math.abs(p[1] - (side === 'top' ? node.y : node.y + node.height)) <= 2 && p[0] >= node.x - 2 && p[0] <= node.x + node.width + 2
          : Math.abs(p[0] - (side === 'left' ? node.x : node.x + node.width)) <= 2 && p[1] >= node.y - 2 && p[1] <= node.y + node.height + 2;
        if (!onSide && dist(p, port) > 2) v.push(`edge ${e.id} ${end} at ${p.join(',')} is not on ${node.id}'s ${side} side`);
      }
    }
    // L11: a manual line is exactly source port → bend points (with one elbow per step that isn't lined up) → target
    // port; every bend point is exact (L4) and on the line.
    if (manual) {
      const lanes = new Map(res.lanes.map((l, i) => [l.id, { l, i }]));
      const bp = applied.get(ge.id)!.map((p): [number, number] => {
        const { l, i } = lanes.get(p.lane)!;
        const a = p.along + T;
        const c = (LR ? l.y : l.x) + (i === 0 ? U : 0) + p.across;
        return LR ? [a, c] : [c, a];
      });
      // The ends are the ports (checked above, within 2 px); the rest must be exactly as L11 draws it.
      const sp = pts[0]!;
      const tp = last;
      const want: number[][] = [sp];
      const lined = (p: readonly number[], q: readonly number[]) => p[0] === q[0] || p[1] === q[1];
      const vertical = (side: Side) => side === 'top' || side === 'bottom';
      if (!lined(sp, bp[0]!)) want.push(vertical(e.source_side) ? [sp[0]!, bp[0]![1]] : [bp[0]![0], sp[1]!]);
      want.push(bp[0]!);
      for (let k = 1; k < bp.length; k++) {
        const [p, q] = [bp[k - 1]!, bp[k]!];
        if (!lined(p, q)) want.push(LR ? [q[0], p[1]] : [p[0], q[1]]); // along the flow first
        want.push(q);
      }
      const lb = bp[bp.length - 1]!;
      if (!lined(lb, tp)) want.push(vertical(e.target_side) ? [tp[0]!, lb[1]] : [lb[0], tp[1]!]);
      want.push(tp);
      if (merged(pts) !== merged(want)) v.push(`L11 edge ${e.id} is ${merged(pts)}, expected ${merged(want)}`);
      for (const p of bp) if (!onPolyline(pts, p)) v.push(`L4 edge ${e.id} bend point ${p.join(',')} is not on the line`);
    }
    const exempt = pinnedOverlap.has(s.id) || pinnedOverlap.has(t.id) || manual;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, ay] = pts[k]!;
      const [bx, by] = pts[k + 1]!;
      for (const n of ns) {
        const own = n.id === s.id || n.id === t.id;
        if (own && !opts.strict) continue;
        if (!own && exempt) continue;
        if (own && manual) continue;
        // A port inside the box (a slanted or wavy outline): the end stub runs inside its own box up to the port.
        const stub = (k === 0 && n.id === s.id && distToBoundary(ax, ay, n) > 0 && atAnyPort([ax, ay], n)) ||
          (k === pts.length - 2 && n.id === t.id && distToBoundary(bx, by, n) > 0 && atAnyPort([bx, by], n));
        if (own && stub) continue;
        if (interiorHit(ax, ay, bx, by, n)) v.push(`L7 edge ${e.id} crosses ${own ? 'its own endpoint ' : ''}${n.id}`);
      }
    }
    const hasLabel = ge.label !== null && ge.label !== '';
    if (e.label !== ge.label) v.push(`edge ${e.id} label mismatch`);
    if (hasLabel !== (e.label_pos !== null)) v.push(`L8 edge ${e.id} label_pos presence wrong`);
    if (e.label_pos) {
      ints(`edge ${e.id} label_pos`, ...e.label_pos);
      const at = entry?.label_at;
      if (at !== undefined) {
        const want = atFraction(pts, at);
        if (dist(e.label_pos, want) > 2) v.push(`L8 edge ${e.id} label at ${e.label_pos.join(',')}, label_at ${at} says ${want.map((x) => x.toFixed(1)).join(',')}`);
      } else {
        const d = distToBoundary(e.label_pos[0], e.label_pos[1], s);
        if (d > 60) v.push(`L8 edge ${e.id} label ${d.toFixed(1)} px from its source`);
      }
    }
  }

  // Notes and the title (§6): sizes, stored positions plus the frame, defaults.
  const [sx, sy] = LR ? [T, U] : [U, T];
  if (opts.notes !== undefined) {
    const got = res.notes ?? [];
    if (got.map((n) => n.id).join('|') !== opts.notes.map((n) => n.id).join('|')) v.push('notes missing or out of config order');
    const stored = file?.notes ?? {};
    let rowY: number | null = null;
    let rowX = -Infinity;
    opts.notes.forEach((note, k) => {
      const n = got[k];
      if (!n) return;
      ints(`note ${n.id}`, n.x, n.y, n.width, n.height);
      const size = noteSize(note.text, note.font_size, note.bold);
      if (n.width !== size.width || n.height !== size.height || n.text !== note.text) v.push(`note ${n.id} box or text wrong`);
      const at = Object.hasOwn(stored, note.id) ? stored[note.id]! : undefined;
      if (at) {
        if (n.x !== at.x + sx || n.y !== at.y + sy) v.push(`note ${n.id} at ${n.x},${n.y}, stored ${at.x},${at.y} + frame ${sx},${sy}`);
      } else {
        if (n.y < res.height) v.push(`unplaced note ${n.id} is not below the diagram`);
        if (rowY !== null && n.y !== rowY) v.push(`unplaced note ${n.id} is not in the row`);
        if (n.x < rowX) v.push(`unplaced note ${n.id} overlaps the one before it`);
        rowY = n.y;
        rowX = n.x + n.width;
      }
    });
  }
  if (opts.title !== undefined) {
    if (opts.title === null) {
      if (res.title !== null) v.push('hidden title is not null');
    } else if (!res.title) v.push('title missing');
    else {
      const t = res.title;
      ints('title', t.x, t.y, t.width, t.height);
      const size = titleSize(opts.title);
      if (t.text !== opts.title || t.width !== size.width || t.height !== size.height) v.push('title box or text wrong');
      const at = file?.title;
      if (at) {
        if (t.x !== at.x + sx || t.y !== at.y + sy) v.push(`title at ${t.x},${t.y}, stored ${at.x},${at.y} + frame ${sx},${sy}`);
      } else if (t.x !== sx || t.y + t.height > sy) v.push(`default title at ${t.x},${t.y} is not above the diagram's top-left`);
    }
  }
  return v;
}

/** Quality numbers for eyeballing and regression tests (not contract). */
export function qualityStats(res: LayoutResult): { bends: number; crossings: number; sharedTrack: number; ownCross: number } {
  let bends = 0;
  let crossings = 0;
  let sharedTrack = 0;
  let ownCross = 0;
  const segs: { e: number; h: boolean; c: number; lo: number; hi: number }[] = [];
  const byId = new Map(res.nodes.map((n) => [n.id, n]));
  res.edges.forEach((e, ei) => {
    bends += Math.max(0, e.points.length - 2);
    const s = byId.get(e.source)!;
    const t = byId.get(e.target)!;
    for (let k = 0; k + 1 < e.points.length; k++) {
      const [ax, ay] = e.points[k]!;
      const [bx, by] = e.points[k + 1]!;
      const h = ay === by;
      segs.push({ e: ei, h, c: h ? ay : ax, lo: h ? Math.min(ax, bx) : Math.min(ay, by), hi: h ? Math.max(ax, bx) : Math.max(ay, by) });
      if (interiorHit(ax, ay, bx, by, s) || interiorHit(ax, ay, bx, by, t)) ownCross++;
    }
  });
  for (let a = 0; a < segs.length; a++)
    for (let b = a + 1; b < segs.length; b++) {
      const A = segs[a]!;
      const B = segs[b]!;
      if (A.e === B.e) continue;
      if (A.h === B.h) {
        if (A.c === B.c && Math.min(A.hi, B.hi) - Math.max(A.lo, B.lo) > 12) sharedTrack++;
      } else {
        const H = A.h ? A : B;
        const V = A.h ? B : A;
        if (V.c > H.lo && V.c < H.hi && H.c > V.lo && H.c < V.hi) crossings++;
      }
    }
  return { bends, crossings, sharedTrack, ownCross };
}

// ------------------------------------------------------------------------------------------------------------
// Random graphs
// ------------------------------------------------------------------------------------------------------------

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ('check review approve send quote vendor invoice order request budget move ship receive sign match ' +
  'create update wait for the a manager finance purchase form complete missing freight part service defer next ' +
  'quarter ERP spreadsheet email call confirm schedule delivery pick three over $1,000 PO receipt paid closed').split(' ');

export interface RandomGraphOptions {
  nodes: number;
  direction?: 'LR' | 'TB';
  lanes?: number;
}

/** A process-map-shaped random graph: chains with decision branches (2-3 labelled branches), loops back, cross-lane
 * hops, duplicate edges, a self-loop now and then, empty lanes and unlaned nodes. */
export function randomGraph(seed: number, opts: RandomGraphOptions): Graph {
  const r = rng(seed);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const laneCount = opts.lanes ?? 1 + Math.floor(r() * 7);
  const lanes = Array.from({ length: laneCount }, (_, i) => ({ id: `lane${i}`, label: `Lane ${i} ${pick(WORDS)}` }));
  const emptyLane = laneCount > 2 && r() < 0.4 ? Math.floor(r() * laneCount) : -1;
  const unlanedRate = r() < 0.3 ? 0.08 : 0;
  const nodes: GraphNode[] = [];
  for (let i = 0; i < opts.nodes; i++) {
    const kindRoll = r();
    const kind: ShapeKind = kindRoll < 0.45 ? 'step' : kindRoll < 0.65 ? 'decision' : pick(SHAPE_KINDS);
    const words = 1 + Math.floor(r() * (r() < 0.2 ? 14 : 6));
    let label = Array.from({ length: words }, () => pick(WORDS)).join(' ');
    if (r() < 0.03) label = 'Supercalifragilisticexpialidocious-and-then-some-more';
    if (kind === 'decision') label = label.split(' ').slice(0, 4).join(' ') + '?';
    let lane = lanes.length ? pick(lanes).id : UNASSIGNED;
    if (lanes.length && emptyLane >= 0 && lane === lanes[emptyLane]!.id) lane = lanes[(emptyLane + 1) % laneCount]!.id;
    if (r() < unlanedRate) lane = UNASSIGNED;
    nodes.push({ id: `n${i}`, label, kind, lane });
  }
  const edges: GraphEdge[] = [];
  const counts = new Map<string, number>();
  const add = (s: number, t: number, label: string | null) => {
    const base = `n${s}->n${t}`;
    const c = (counts.get(base) ?? 0) + 1;
    counts.set(base, c);
    edges.push({ id: c === 1 ? base : `${base}#${c}`, source: `n${s}`, target: `n${t}`, label });
  };
  // Backbone: each node links forward to one of the next few nodes; decisions branch.
  for (let i = 0; i < opts.nodes - 1; i++) {
    const node = nodes[i]!;
    if (node.kind === 'decision') {
      const branches = r() < 0.3 ? 3 : 2;
      const labels = branches === 3 ? ['yes', 'no', 'maybe later'] : r() < 0.5 ? ['yes', 'no'] : ['approved', 'rejected'];
      for (let b = 0; b < branches; b++) {
        let t = Math.min(opts.nodes - 1, i + 1 + Math.floor(r() * 4));
        if (b > 0 && r() < 0.35) t = Math.max(0, i - 1 - Math.floor(r() * 6)); // loop back
        add(i, t, labels[b]!);
      }
    } else if (r() < 0.93) {
      add(i, Math.min(opts.nodes - 1, i + 1 + Math.floor(r() * (r() < 0.8 ? 2 : 8))), r() < 0.1 ? pick(WORDS) : null);
    }
  }
  const extra = Math.floor(opts.nodes * 0.15);
  for (let k = 0; k < extra; k++) {
    const s = Math.floor(r() * opts.nodes);
    const t = Math.floor(r() * opts.nodes);
    if (s === t && r() > 0.3) continue;
    add(s, t, r() < 0.2 ? pick(WORDS) : null);
  }
  if (edges.length && r() < 0.3) {
    const e = pick(edges);
    add(Number(e.source.slice(1)), Number(e.target.slice(1)), null); // duplicate
  }
  const laneIds = lanes.map((l) => ({ ...l }));
  if (nodes.some((n) => n.lane === UNASSIGNED)) laneIds.push({ id: UNASSIGNED, label: 'Unassigned' });
  return { direction: opts.direction ?? 'LR', lanes: laneIds, nodes, edges };
}

/** Legal random pins (non-negative, across >= 12 as the UI writes them) for a fraction of the nodes. */
export function randomPins(seed: number, graph: Graph, fraction: number, alongMax = 2000): Record<string, Pin> {
  const r = rng(seed ^ 0x9e3779b9);
  const pins: Record<string, Pin> = {};
  for (const n of graph.nodes) {
    if (r() >= fraction) continue;
    pins[n.id] = { lane: n.lane, along: Math.floor(r() * alongMax), across: 12 + Math.floor(r() * 220) };
  }
  // A stale pin (wrong lane) that must be ignored.
  const first = graph.nodes[0];
  if (first && r() < 0.5) pins[first.id] = { lane: 'no-such-lane', along: 10, across: 20 };
  return pins;
}

// ------------------------------------------------------------------------------------------------------------
// fixtures/purchase-request, built by hand (the parser is written elsewhere)
// ------------------------------------------------------------------------------------------------------------

export function purchaseRequest(direction: 'LR' | 'TB' = 'LR'): { graph: Graph; pins: Record<string, Pin> } {
  const lanes = [
    ['requester', 'Requester'], ['manager', 'Manager'], ['purchasing', 'Purchasing'], ['finance', 'Finance'], ['vendor', 'Vendor'],
  ].map(([id, label]) => ({ id: id!, label: label! }));
  const N = (id: string, label: string, kind: ShapeKind, lane: string): GraphNode => ({ id, label, kind, lane });
  const nodes = [
    N('intake', 'Needs a part or service', 'terminal', 'requester'),
    N('r01', 'Fill the purchase request form', 'step', 'requester'),
    N('r02', 'Receive the delivery and sign for it', 'step', 'requester'),
    N('closed', 'Request closed', 'terminal', 'requester'),
    N('m01', 'Review the request', 'step', 'manager'),
    N('m02', 'Approved?', 'decision', 'manager'),
    N('m03', 'Tell the requester why not', 'step', 'manager'),
    N('p01', 'Check the request is complete', 'step', 'purchasing'),
    N('p02', 'Complete?', 'decision', 'purchasing'),
    N('p03', 'Send it back with what is missing', 'step', 'purchasing'),
    N('p04', 'Over $1,000?', 'decision', 'purchasing'),
    N('p05', 'Get three quotes', 'step', 'purchasing'),
    N('p06', 'Pick the vendor', 'step', 'purchasing'),
    N('p07', 'Create the PO in the ERP', 'step', 'purchasing'),
    N('f01', 'Budget available?', 'decision', 'finance'),
    N('f02', 'Move budget or defer to next quarter', 'step', 'finance'),
    N('f03', 'Match the invoice to the PO and the receipt', 'step', 'finance'),
    N('f04', 'Vendor paid', 'terminal', 'finance'),
    N('v01', 'Send a quote', 'document', 'vendor'),
    N('v02', 'Ship the order', 'step', 'vendor'),
  ];
  const E = (s: string, t: string, label: string | null = null): GraphEdge => ({ id: `${s}->${t}`, source: s, target: t, label });
  const edges = [
    E('intake', 'r01'), E('r01', 'p01'), E('p01', 'p02'), E('p02', 'p03', 'no'), E('p03', 'r01'), E('p02', 'p04', 'yes'),
    E('p04', 'm01', 'yes'), E('p04', 'p05', 'no'), E('m01', 'm02'), E('m02', 'm03', 'no'), E('m03', 'closed'),
    E('m02', 'p05', 'yes'), E('p05', 'v01'), E('v01', 'p06'), E('p06', 'f01'), E('f01', 'p07', 'yes'), E('f01', 'f02', 'no'),
    E('f02', 'f01'), E('p07', 'v02'), E('v02', 'r02'), E('r02', 'f03'), E('f03', 'f04'),
  ];
  return {
    graph: { direction, lanes, nodes, edges },
    pins: { closed: { lane: 'requester', along: 1400, across: 40 } },
  };
}

// ------------------------------------------------------------------------------------------------------------
// v1.1 shaping by hand, at random
// ------------------------------------------------------------------------------------------------------------

export interface RandomShaping {
  file: LayoutFile;
  /** The pins in `file`, as `checkLayout` takes them. */
  pins: Record<string, Pin>;
  notes: NoteInput[];
  title: string | null;
}

export interface RandomShapingOptions {
  /** Fraction of nodes pinned (default 0.15), sized (0.25); fraction of edges with sides (0.3), manual (0.15). */
  pinned?: number;
  sized?: number;
  sided?: number;
  manual?: number;
  /** Exactly this many manual lines instead of a fraction. */
  manualCount?: number;
  /** Largest `along` used for pins and bend points. */
  alongMax?: number;
  /**
   * A22: fraction of set sides that also get an offset along the side (default 0: no random draws are spent on them,
   * so seeds without it give the same files as before).
   */
  offsets?: number;
  /** A22: write `spread_ends: true`. */
  spread?: boolean;
}

/**
 * A random v1.1 layout file for a graph: pins (some negative: before the flow's start, and before the first lane),
 * sizes (smaller and larger than the automatic ones), set sides, manual lines (1 to 4 bend points in random lanes,
 * negative `along`, negative `across` in the first lane), `label_at`, a point set with a missing lane (ignored), notes
 * with and without positions, and a shown, moved or hidden title.
 */
export function randomShaping(seed: number, graph: Graph, opts: RandomShapingOptions = {}): RandomShaping {
  const r = rng(seed ^ 0x5bd1e995);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const alongMax = opts.alongMax ?? Math.max(600, graph.nodes.length * 40);
  const laneIds = [...new Set([...graph.lanes.map((l) => l.id), ...graph.nodes.map((n) => n.lane)])];
  // Display order as the layout builds it: graph lanes (not _unassigned), then _unassigned last.
  const display = [...laneIds.filter((l) => l !== UNASSIGNED), ...(laneIds.includes(UNASSIGNED) ? [UNASSIGNED] : [])];
  const first = display[0];
  const nodes: LayoutFile['nodes'] = {};
  const pins: Record<string, Pin> = {};
  for (const n of graph.nodes) {
    const entry: LayoutFile['nodes'][string] = {};
    if (r() < (opts.pinned ?? 0.15)) {
      const negAlong = r() < 0.15;
      const negAcross = n.lane === first && r() < 0.3;
      const pin = { lane: n.lane, along: negAlong ? -int(1, 300) : int(0, alongMax), across: negAcross ? -int(1, 200) : int(0, 260) };
      Object.assign(entry, pin);
      pins[n.id] = pin;
    }
    if (r() < (opts.sized ?? 0.25)) Object.assign(entry, { width: int(40, 320), height: int(40, 220) });
    if (Object.keys(entry).length) nodes[n.id] = entry;
  }
  const edges: Record<string, LayoutEdgeEntry> = {};
  const manualIds = new Set<string>();
  if (opts.manualCount !== undefined) {
    const ids = graph.edges.map((e) => e.id);
    while (manualIds.size < Math.min(opts.manualCount, ids.length)) manualIds.add(pick(ids));
  }
  let stale = false;
  for (const e of graph.edges) {
    const entry: LayoutEdgeEntry = {};
    if (r() < (opts.sided ?? 0.3)) {
      const roll = r();
      if (roll < 0.7) entry.source_side = pick(SIDES);
      if (roll > 0.3) entry.target_side = pick(SIDES);
      if (opts.offsets) {
        if (entry.source_side && r() < opts.offsets) entry.source_at = pick([0, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, int(0, 100) / 100]);
        if (entry.target_side && r() < opts.offsets) entry.target_at = pick([0, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, int(0, 100) / 100]);
      }
    }
    const isManual = opts.manualCount !== undefined ? manualIds.has(e.id) : r() < (opts.manual ?? 0.15);
    if (isManual && display.length) {
      entry.points = Array.from({ length: int(1, 4) }, () => {
        const lane = r() < 0.3 && first ? first : pick(display);
        return {
          lane,
          along: r() < 0.15 ? -int(1, 200) : int(0, alongMax),
          across: lane === first && r() < 0.3 ? -int(1, 120) : int(0, 180),
        };
      });
      if (!stale && r() < 0.2) {
        entry.points.push({ lane: 'gone', along: 10, across: 10 }); // a lane that no longer exists: all ignored
        stale = true;
      }
    }
    if (r() < 0.2) entry.label_at = Math.round(r() * 100) / 100;
    if (Object.keys(entry).length) edges[e.id] = entry;
  }
  const notes: NoteInput[] = [];
  const notePos: Record<string, { x: number; y: number }> = {};
  const count = int(0, 4);
  for (let k = 0; k < count; k++) {
    const lines = Array.from({ length: int(1, 3) }, () => Array.from({ length: int(0, 6) }, () => pick(WORDS)).join(' '));
    if (!lines.join('').trim()) lines[0] = 'note';
    const note: NoteInput = { id: `note${k + 1}`, text: lines.join('\n'), font_size: int(10, 48), bold: r() < 0.3 };
    notes.push(note);
    if (r() < 0.5) notePos[note.id] = { x: int(-300, alongMax), y: int(-200, 800) };
  }
  const titleRoll = r();
  const title = titleRoll < 0.2 ? null : `Process ${pick(WORDS)} ${pick(WORDS)}`;
  const file: LayoutFile = { version: 1, nodes };
  if (opts.spread) file.spread_ends = true;
  if (Object.keys(edges).length) file.edges = edges;
  if (Object.keys(notePos).length) file.notes = notePos;
  if (titleRoll > 0.6) file.title = { x: int(-200, 400), y: int(-150, 40) };
  return { file, pins, notes, title };
}
