// Snapping (design.md §8.2 UI39): pure geometry, no DOM and no store, so every drag (blocks, bend points, notes, the
// title) can share it with its own target set.
//
// A dragged item snaps when one of its lines comes within SNAP_DISTANCE screen px of the *same kind* of line on a
// target: centre to centre, start (left or top) to start, end (right or bottom) to end, on each axis on its own.
//
//   snap(subject, targets, zoom, altKey) -> { dx, dy, guides }
//
// - `subject`: where the dragged item is now (unsnapped, world px). A box (`{x, y, width, height}`) has a start, centre
//   and end line on each axis; a point (`{x, y}`, e.g. a bend point) has only a centre line on each axis.
// - `targets`: boxes (other blocks, notes, the title), points (other bend points, ports) and bare lines
//   (`{axis, at, role?}`, role defaulting to `centre`). A line only snaps lines of its own axis and role.
// - `zoom`: the canvas zoom; the threshold is in screen px, so it is SNAP_DISTANCE / zoom in world px.
// - `altKey`: held (Alt / Option), snapping is off: `{dx: 0, dy: 0, guides: []}`.
// - Result: add `dx`, `dy` to the subject's position (and to every other item dragged with it: with several items
//   dragged, the one under the pointer is the subject). `guides` holds one line per snapped axis, for the
//   `snap-guide` overlay (`showSnapGuides`, guides.ts).
//
// A centre line is `x + floor(width / 2)` (and likewise for y; ruling R11.6), so a snapped box lands on whole pixels
// whenever its target does. Ties (two lines exactly as close): centre lines win over edges, then the start edge over
// the end edge, then the smaller coordinate.

export type SnapAxis = 'x' | 'y';
export type SnapRole = 'centre' | 'start' | 'end';

export interface SnapBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapPoint {
  x: number;
  y: number;
}

/** One line on one axis: `axis: 'x'` is a vertical line at x = `at`. */
export interface SnapLine {
  axis: SnapAxis;
  at: number;
  /** Which kind of line it is (default `centre`); it only snaps lines of the same kind. */
  role?: SnapRole;
}

export type SnapTarget = SnapBox | SnapPoint | SnapLine;
export type SnapSubject = SnapBox | SnapPoint;

export interface SnapGuide {
  /** `x`: a vertical guide at x = `at`; `y`: a horizontal one at y = `at` (world px). */
  axis: SnapAxis;
  at: number;
  role: SnapRole;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

/** The snap distance, in screen px (UI39). */
export const SNAP_DISTANCE = 6;

const NO_SNAP: SnapResult = Object.freeze({ dx: 0, dy: 0, guides: [] }) as unknown as SnapResult;

/** Equal distances within this are ties (distances come from fractional drag positions). */
const EPS = 1e-6;

const ROLE_RANK: Record<SnapRole, number> = { centre: 0, start: 1, end: 2 };

function isLine(t: SnapTarget): t is SnapLine {
  return 'axis' in t;
}

function isBox(t: SnapTarget): t is SnapBox {
  return 'width' in t && 'height' in t;
}

/** The lines of a box or point on one axis. */
export function linesOf(item: SnapSubject, axis: SnapAxis): { role: SnapRole; at: number }[] {
  const pos = axis === 'x' ? item.x : item.y;
  if (!isBox(item)) return [{ role: 'centre', at: pos }];
  const size = axis === 'x' ? item.width : item.height;
  return [
    { role: 'start', at: pos },
    { role: 'centre', at: pos + Math.floor(size / 2) },
    { role: 'end', at: pos + size },
  ];
}

interface Candidate {
  d: number;
  role: SnapRole;
  at: number;
}

/** Is `a` a better snap than `b`? Closer first, then centre > start > end, then the smaller coordinate. */
function better(a: Candidate, b: Candidate): boolean {
  const da = Math.abs(a.d);
  const db = Math.abs(b.d);
  if (Math.abs(da - db) > EPS) return da < db;
  if (a.role !== b.role) return ROLE_RANK[a.role] < ROLE_RANK[b.role];
  return a.at < b.at;
}

function snapAxis(subject: SnapSubject, targets: readonly SnapTarget[], axis: SnapAxis, limit: number): Candidate | null {
  const mine = new Map(linesOf(subject, axis).map((l) => [l.role, l.at]));
  let best: Candidate | null = null;
  for (const t of targets) {
    const lines = isLine(t) ? (t.axis === axis ? [{ role: t.role ?? 'centre', at: t.at }] : []) : linesOf(t, axis);
    for (const { role, at } of lines) {
      const own = mine.get(role);
      if (own === undefined) continue;
      const d = at - own;
      if (Math.abs(d) > limit + EPS) continue;
      const c: Candidate = { d, role, at };
      if (!best || better(c, best)) best = c;
    }
  }
  return best;
}

/** UI39: how far to move `subject` so it snaps to `targets`, and the guides to show. See the comment at the top. */
export function snap(subject: SnapSubject, targets: readonly SnapTarget[], zoom: number, altKey: boolean): SnapResult {
  if (altKey || targets.length === 0 || !(zoom > 0)) return NO_SNAP;
  const limit = SNAP_DISTANCE / zoom;
  const x = snapAxis(subject, targets, 'x', limit);
  const y = snapAxis(subject, targets, 'y', limit);
  if (!x && !y) return NO_SNAP;
  const guides: SnapGuide[] = [];
  if (x) guides.push({ axis: 'x', at: x.at, role: x.role });
  if (y) guides.push({ axis: 'y', at: y.at, role: y.role });
  return { dx: x?.d ?? 0, dy: y?.d ?? 0, guides };
}
