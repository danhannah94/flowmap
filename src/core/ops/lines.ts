// Shaping lines by hand (design.md §8.2 UI36, UI37). Every operation here reads the line as it is drawn now (the
// current layout's `points`, in diagram coordinates) and writes the line's entry in the layout file (§5):
//
// - Becoming manual: the first shaping edit on an automatic line stores, as its `points`, every corner of its drawn line
//   except the two ends, plus any end that isn't at its side's port, and stores the sides the line uses (§6 L11, L12),
//   with (A22) the offsets along them the layout reports (`source_at` / `target_at`: an end at an offset is at its
//   port, so it doesn't become a bend point).
// - A line is handled in its "manual form": the drawn polyline from the source port to the target port. For a manual
//   line that is the drawn line itself (L11 starts and ends it at the ports); for an automatic line whose end isn't at
//   its port, the port is put in front of (or after) the drawn line, which is how L11 will draw the stored end.
// - Bend points are stored lane-relative, like pins (§5): a point keeps its stored value unless it moves; a new or
//   moved point is stored in the lane whose band contains it (`storedFromPoint`), against the layout's frame (§6).
// - Tidy (after every drag): the moved points and their neighbours (a port counts as a neighbour, and is never removed)
//   are checked; a point in a straight row with both neighbours, or on top of one, is removed. No points left: `points`
//   is removed and the line is automatic again, keeping its sides.
import { edgeEndPort, endAtPort, pointFromStored, projectOntoPolyline, storedFromPoint, type Point } from '../layout';
import { resetEdge, roundPx, updateEdge, type EdgePatch } from '../layoutfile';
import type { LayoutResultEdge, Pin, XY } from '../types';
import { refuse, run, type Ctx, type Files, type OpResult } from './context';
import { checkXY, viewOf, type LayoutArg, type View } from './frame';

/** How far out from a port a segment drag puts its stub corner (UI36). */
export const STUB = 20;

/** A line as the shaping operations see it. */
interface Line {
  id: string;
  edge: LayoutResultEdge;
  /** Already manual (its stored points apply)? Otherwise the edit first makes it manual. */
  manual: boolean;
  /** The drawn line in manual form, from the source port to the target port. */
  v: Point[];
  /** How many vertices were put in front of the drawn line (1 when the source end isn't at its port). */
  lead: number;
  /** The stored bend point each vertex of `v` is, when it is one (for a manual line). */
  storedAt: (Pin | null)[];
  /** The line's bend points after becoming manual, and the vertex of `v` each one is. */
  points: Pin[];
  pointAt: number[];
}

const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];

function toStored(view: View, p: Point): Pin {
  const pin = storedFromPoint(view.result, view.frame, p[0], p[1]);
  if (!pin) return refuse('The diagram has no lanes to hold a bend point');
  return pin;
}

/** Read an edge's line from the current layout (and, for a manual line, its stored points from the file). */
function readLine(ctx: Ctx, view: View, edgeId: string): Line {
  ctx.requireLayout(); // every shaping edit writes the layout file
  ctx.edgeIndex(edgeId); // refuses an unknown line
  const edge = view.result.edges.find((e) => e.id === edgeId);
  if (!edge || edge.points.length < 2) return refuse(`The layout has no drawn line for "${edgeId}"; try again`);
  const drawn = edge.points.map((p): Point => [p[0], p[1]]);
  const stored = ctx.layoutIn?.edges?.[edgeId]?.points;
  if (edge.manual) {
    if (!stored) return refuse(`The layout is out of date for "${edgeId}"; try again`);
    const storedAt: (Pin | null)[] = drawn.map(() => null);
    const pointAt: number[] = [];
    let j = 0;
    for (const p of stored) {
      const xy = pointFromStored(view.result, view.frame, p);
      while (xy && j < drawn.length && !same(drawn[j]!, xy)) j++;
      if (!xy || j >= drawn.length) return refuse(`The layout is out of date for "${edgeId}"; try again`);
      storedAt[j] ??= p;
      pointAt.push(j);
    }
    return { id: edgeId, edge, manual: true, v: drawn, lead: 0, storedAt, points: stored.map((p) => ({ ...p })), pointAt };
  }
  // Points that apply make the line manual (§5): a layout that says otherwise is out of date.
  if (stored && stored.every((p) => view.result.lanes.some((l) => l.id === p.lane))) {
    return refuse(`The layout is out of date for "${edgeId}"; try again`);
  }
  // Automatic: an end that isn't at its side's port becomes a bend point, and the line starts (or ends) at the port.
  const node = (id: string) => {
    const n = view.result.nodes.find((x) => x.id === id);
    if (!n) return refuse(`The layout has no block "${id}"; try again`);
    return n;
  };
  const srcOff = !endAtPort(view.result, edgeId, 'source');
  const tgtOff = !endAtPort(view.result, edgeId, 'target');
  const v: Point[] = [
    ...(srcOff ? [edgeEndPort(node(edge.source), edge, 'source')] : []),
    ...drawn,
    ...(tgtOff ? [edgeEndPort(node(edge.target), edge, 'target')] : []),
  ];
  const pointAt = v.slice(1, -1).map((_p, k) => k + 1);
  return {
    id: edgeId, edge, manual: false, v, lead: srcOff ? 1 : 0, storedAt: v.map(() => null),
    points: pointAt.map((k) => toStored(view, v[k]!)), pointAt,
  };
}

/**
 * The patch that writes a line's new points (null: none left), plus its sides when it is becoming manual, and (A22)
 * the offsets along them that the layout reports (a stored one, or a spread position), so the line keeps its ends.
 */
function pointsPatch(line: Line, points: Pin[]): EdgePatch {
  const patch: EdgePatch = { points: points.length ? points : null };
  if (!line.manual) {
    patch.source_side = line.edge.source_side;
    patch.target_side = line.edge.target_side;
    if (line.edge.source_at !== undefined && line.edge.source_at !== 0.5) patch.source_at = line.edge.source_at;
    if (line.edge.target_at !== undefined && line.edge.target_at !== 0.5) patch.target_at = line.edge.target_at;
  }
  return patch;
}

function write(ctx: Ctx, line: Line, points: Pin[]): void {
  ctx.editLayout('always', (file) => updateEdge(file, line.id, pointsPatch(line, points)));
}

/**
 * Tidy (UI36). `xy` is the whole sequence, ports included (index 0 and the last); `check` holds the indices of the
 * moved points and their neighbours. Returns which indices are kept. A point is removed when it is on top of a
 * neighbour or in a straight row with both (all three on one horizontal or vertical line); the check repeats until
 * nothing changes, each time against the neighbours that are left. Ports are never removed.
 */
export function tidy(xy: readonly Point[], check: Iterable<number>): boolean[] {
  const alive = xy.map(() => true);
  const last = xy.length - 1;
  const todo = [...new Set(check)].filter((k) => k > 0 && k < last).sort((a, b) => a - b);
  for (let changed = true; changed;) {
    changed = false;
    for (const k of todo) {
      if (!alive[k]) continue;
      let a = k - 1;
      while (!alive[a]) a--;
      let b = k + 1;
      while (!alive[b]) b++;
      const p = xy[a]!;
      const q = xy[k]!;
      const r = xy[b]!;
      const row = (p[0] === q[0] && q[0] === r[0]) || (p[1] === q[1] && q[1] === r[1]);
      if (same(p, q) || same(q, r) || row) {
        alive[k] = false;
        changed = true;
      }
    }
  }
  return alive;
}

/** The merged segments of a polyline (UI36: `data-segment`), each as the range of vertices it spans. */
export function segmentRuns(v: readonly Point[]): { a: number; b: number }[] {
  const idx: number[] = [];
  for (let j = 0; j < v.length; j++) if (idx.length === 0 || !same(v[idx[idx.length - 1]!]!, v[j]!)) idx.push(j);
  const runs: { a: number; b: number }[] = [];
  const dir = (s: number, t: number) => [Math.sign(v[t]![0] - v[s]![0]), Math.sign(v[t]![1] - v[s]![1])];
  for (let t = 1; t < idx.length; t++) {
    const s = idx[t - 1]!;
    const e = idx[t]!;
    const prev = runs[runs.length - 1];
    if (prev) {
      const [ax, ay] = dir(prev.a, prev.b);
      const [bx, by] = dir(s, e);
      const cross = (v[prev.b]![0] - v[prev.a]![0]) * (v[e]![1] - v[s]![1]) - (v[prev.b]![1] - v[prev.a]![1]) * (v[e]![0] - v[s]![0]);
      if (cross === 0 && ax === bx && ay === by) {
        prev.b = e;
        continue;
      }
    }
    runs.push({ a: s, b: e });
  }
  return runs;
}

// ---- operations ------------------------------------------------------------------------------------------------

/**
 * UI36 "becoming manual", on its own: store an automatic line's corners (and any end not at its port) as its `points`,
 * and the sides it uses. A line that is already manual is left as it is.
 */
export function makeManual(files: Files, layout: LayoutArg, edgeId: string): OpResult {
  return run(files, (ctx) => {
    const line = readLine(ctx, viewOf(ctx, layout), edgeId);
    if (!line.manual) write(ctx, line, line.points);
    return {};
  });
}

/**
 * UI36 segment drag: slide merged segment `segment` of the drawn line (0-based from the source, as `data-segment`)
 * sideways by `delta` (only the part perpendicular to the segment counts; rounded to whole pixels, halves toward −∞).
 * An end of the segment at a port gets a stub first: a corner 20 px out from the port along the segment. Writes every
 * corner of the resulting line except its two ends, then tidies around the moved corners.
 */
export function dragSegment(
  files: Files, layout: LayoutArg, edgeId: string, segment: number, delta: { dx: number; dy: number },
): OpResult {
  return run(files, (ctx) => {
    const view = viewOf(ctx, layout);
    const line = readLine(ctx, view, edgeId);
    if (!delta || !Number.isFinite(delta.dx) || !Number.isFinite(delta.dy)) refuse('A drag needs a finite dx and dy');
    const runs = segmentRuns(line.v.slice(line.lead, line.lead + line.edge.points.length));
    const seg = runs[segment];
    if (!Number.isInteger(segment) || !seg) return refuse(`Line "${edgeId}" has no segment ${segment}`);
    const a = seg.a + line.lead;
    const b = seg.b + line.lead;
    const v = line.v;
    const last = v.length - 1;
    const horizontal = v[a]![1] === v[b]![1];
    if (!horizontal && v[a]![0] !== v[b]![0]) refuse('Only horizontal and vertical segments can be dragged');
    const d = roundPx(horizontal ? delta.dy : delta.dx);
    const move = (p: Point): Point => (horizontal ? [p[0], p[1] + d] : [p[0] + d, p[1]]);
    const ux = Math.sign(v[b]![0] - v[a]![0]);
    const uy = Math.sign(v[b]![1] - v[a]![1]);

    // The resulting line: each vertex with the stored point it keeps (unmoved) and whether it moved.
    const out: { xy: Point; pin: Pin | null; moved: boolean }[] = [];
    const keep = (j: number) => out.push({ xy: v[j]!, pin: line.storedAt[j] ?? null, moved: false });
    for (let j = 0; j < a; j++) keep(j);
    if (a === 0) {
      const stub: Point = [v[0]![0] + ux * STUB, v[0]![1] + uy * STUB];
      keep(0);
      out.push({ xy: stub, pin: null, moved: false }, { xy: move(stub), pin: null, moved: true });
    } else out.push({ xy: move(v[a]!), pin: null, moved: true });
    for (let j = a + 1; j < b; j++) out.push({ xy: move(v[j]!), pin: null, moved: true });
    if (b === last) {
      const stub: Point = [v[last]![0] - ux * STUB, v[last]![1] - uy * STUB];
      out.push({ xy: move(stub), pin: null, moved: true }, { xy: stub, pin: null, moved: false });
      keep(last);
    } else out.push({ xy: move(v[b]!), pin: null, moved: true });
    for (let j = b + 1; j <= last; j++) keep(j);

    const check = new Set<number>();
    out.forEach((o, k) => { if (o.moved) [k - 1, k, k + 1].forEach((x) => check.add(x)); });
    const alive = tidy(out.map((o) => o.xy), check);
    const points = out.slice(1, -1)
      .filter((_o, k) => alive[k + 1])
      .map((o) => (o.pin && !o.moved ? { ...o.pin } : toStored(view, o.xy)));
    write(ctx, line, points);
    return {};
  });
}

/**
 * UI36 bend drag: move bend point `index` (0-based from the source, as `data-bend`; on an automatic line, its corners
 * after becoming manual) to `to`, rounded to whole pixels (halves toward −∞; the UI snaps first, UI39). Then tidy.
 */
export function dragBend(files: Files, layout: LayoutArg, edgeId: string, index: number, to: XY): OpResult {
  return run(files, (ctx) => {
    const view = viewOf(ctx, layout);
    const line = readLine(ctx, view, edgeId);
    checkXY(to);
    if (!Number.isInteger(index) || index < 0 || index >= line.points.length) refuse(`Line "${edgeId}" has no bend point ${index}`);
    const at: Point = [roundPx(to.x), roundPx(to.y)];
    const xy: Point[] = [line.v[0]!, ...line.pointAt.map((j) => line.v[j]!), line.v[line.v.length - 1]!];
    xy[index + 1] = at;
    const points = line.points.map((p, k) => (k === index ? toStored(view, at) : p));
    const alive = tidy(xy, [index, index + 1, index + 2]);
    write(ctx, line, points.filter((_p, k) => alive[k + 1]));
    return {};
  });
}

/**
 * UI36 "Add bend point": insert a point at the spot on the drawn line nearest `at` (rounded to whole pixels), in path
 * order. It is kept even if it lies in a straight row (no tidy).
 */
export function addBend(files: Files, layout: LayoutArg, edgeId: string, at: XY): OpResult<{ index: number }> {
  return run(files, (ctx) => {
    const view = viewOf(ctx, layout);
    const line = readLine(ctx, view, edgeId);
    checkXY(at);
    const v = line.v;
    let best = Infinity;
    let seg = 0;
    let spot: Point = v[0]!;
    for (let j = 0; j + 1 < v.length; j++) {
      const [ax, ay] = v[j]!;
      const [bx, by] = v[j + 1]!;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((at.x - ax) * dx + (at.y - ay) * dy) / len2));
      const q: Point = [ax + t * dx, ay + t * dy];
      const dist = Math.hypot(q[0] - at.x, q[1] - at.y);
      if (dist < best - 1e-9) {
        best = dist;
        seg = j;
        spot = q;
      }
    }
    const [ax, ay] = v[seg]!;
    const [bx, by] = v[seg + 1]!;
    const clamp = (x: number, p: number, q: number) => Math.min(Math.max(p, q), Math.max(Math.min(p, q), x));
    const q: Point = [clamp(roundPx(spot[0]), ax, bx), clamp(roundPx(spot[1]), ay, by)];
    const index = line.pointAt.filter((j) => j <= seg).length;
    const points = [...line.points];
    points.splice(index, 0, toStored(view, q));
    write(ctx, line, points);
    return { index };
  });
}

/** UI36 "Remove bend point": remove bend point `index`. With none left, `points` is removed (its sides stay). */
export function removeBend(files: Files, layout: LayoutArg, edgeId: string, index: number): OpResult {
  return run(files, (ctx) => {
    const line = readLine(ctx, viewOf(ctx, layout), edgeId);
    if (!Number.isInteger(index) || index < 0 || index >= line.points.length) refuse(`Line "${edgeId}" has no bend point ${index}`);
    write(ctx, line, line.points.filter((_p, k) => k !== index));
    return {};
  });
}

/** UI36 "Reset line": remove the line's `points` and both sides; `label_at` stays. */
export function resetLine(files: Files, edgeId: string): OpResult {
  return run(files, (ctx) => {
    ctx.edgeIndex(edgeId);
    ctx.editLayout([edgeId], (file) => resetEdge(file, edgeId));
    return {};
  });
}

/**
 * UI37: the label's centre, dropped at `at`, is projected onto the nearest point of the drawn line and written as
 * `label_at`: that point's distance from the line's first point as a fraction of its length, rounded to two decimals.
 */
export function setLabelAt(files: Files, layout: LayoutArg, edgeId: string, at: XY): OpResult<{ labelAt: number }> {
  return run(files, (ctx) => {
    ctx.requireLayout();
    const view = viewOf(ctx, layout);
    ctx.edgeIndex(edgeId);
    checkXY(at);
    const edge = view.result.edges.find((e) => e.id === edgeId);
    if (!edge || edge.points.length < 2) refuse(`The layout has no drawn line for "${edgeId}"; try again`);
    const labelAt = projectOntoPolyline(edge.points, [at.x, at.y]);
    ctx.editLayout('always', (file) => updateEdge(file, edgeId, { label_at: labelAt }));
    return { labelAt };
  });
}

/** UI37 "Reset label position": remove `label_at`. */
export function resetLabelAt(files: Files, edgeId: string): OpResult {
  return run(files, (ctx) => {
    ctx.edgeIndex(edgeId);
    ctx.editLayout([edgeId], (file) => updateEdge(file, edgeId, { label_at: null }));
    return {};
  });
}

