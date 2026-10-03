// Line operations (design.md §8.2 UI15–UI17, v1.1 UI38). Edge ids are derived (§3.4), so an operation that changes an
// edge's endpoints reports its new id, and every operation that changes the edge list re-keys the layout file's edge
// entries by position (§8.2 "Keeping the layout file in step").
import { isSideAt, updateEdge, type EdgePatch } from '../layoutfile';
import { SIDES, type Side } from '../types';
import { refuse, run, type Files, type OpResult } from './context';

/** The sides a connection writes (UI38). Omitted or null: the layout chooses (the click path, UI15, sets none). */
export interface ConnectSides {
  source_side?: Side | null;
  /** A22: where along `source_side` the line leaves (0 to 1, two decimals). Omitted, null or 0.5: the midline port. */
  source_at?: number | null;
  target_side?: Side | null;
  /** A22: where along `target_side` the line arrives, as `source_at`. */
  target_at?: number | null;
}

function checkSide(side: unknown, what: string): void {
  if (side !== undefined && side !== null && !(SIDES as readonly unknown[]).includes(side)) refuse(`A ${what} is top, right, bottom or left, not "${String(side)}"`);
}

/**
 * A22: an offset along a side, as written: null for none (the midline port, 0.5, is the default and is never written),
 * else a number from 0 to 1 with at most two decimals. Refused without its side.
 */
function offsetOf(at: unknown, side: Side | null | undefined, what: string): number | null {
  if (at === undefined || at === null || at === 0.5) return null;
  if (!isSideAt(at)) return refuse(`A ${what} is a number from 0 to 1 with at most two decimals, not "${String(at)}"`);
  if (!side) return refuse(`A ${what} needs its side`);
  return at + 0;
}

/**
 * UI15 / UI38: connect `source` to `target`; the new edge is appended at the end of the edge section. Returns its id.
 * Connecting by a handle writes `source_side` (the handle's side) and, when dropped on one of the target's connection
 * points, `target_side` (A22: and `target_at` when the drop was along the side, off its midline); the click path
 * writes no sides.
 */
export function connect(files: Files, source: string, target: string, sides: ConnectSides = {}): OpResult<{ edgeId: string }> {
  return run(files, (ctx) => {
    ctx.requireNode(source);
    ctx.requireNode(target);
    checkSide(sides.source_side, 'source side');
    checkSide(sides.target_side, 'target side');
    const sourceAt = offsetOf(sides.source_at, sides.source_side, 'source offset');
    const targetAt = offsetOf(sides.target_at, sides.target_side, 'target offset');
    ctx.d.edges.push({ source, target, label: null, comments: [] });
    ctx.rekeyEdgeEntries(); // appending renumbers nothing, but keep the rule in one place
    const edgeId = ctx.edgeIds().at(-1)!;
    const patch: EdgePatch = {};
    if (sides.source_side) patch.source_side = sides.source_side;
    if (sourceAt !== null) patch.source_at = sourceAt;
    if (sides.target_side) patch.target_side = sides.target_side;
    if (targetAt !== null) patch.target_at = targetAt;
    if (Object.keys(patch).length) ctx.editLayout('always', (file) => updateEdge(file, edgeId, patch));
    return { edgeId };
  });
}

/**
 * UI16 / UI38: move one end of an edge to `node`. The edge keeps its place in the file, its label and its comment; its
 * id follows its new endpoints (returned), and every edge entry is re-keyed by position (§8.2).
 * - To another block: the entry's `points` and the moved end's side are removed (the other side and `label_at` stay);
 *   with `side` (dropped on a connection point) that end's side is written.
 * - To the block it is already attached to (UI38): only that end's side changes, to `side`, or with no side (dropped
 *   elsewhere on the block) it is left to the layout; the id, `points` and `label_at` stay.
 * - (A22) `at` is where along `side` the end attaches (dragging an end along a side): written as that end's
 *   `source_at` / `target_at`, and removed when it is left out, null or 0.5 (the midline port). Moving an end always
 *   replaces its offset, like its side.
 */
export function reconnect(
  files: Files,
  edgeId: string,
  end: 'source' | 'target',
  node: string,
  side?: Side | null,
  at?: number | null,
): OpResult<{ edgeId: string }> {
  return run(files, (ctx) => {
    if (end !== 'source' && end !== 'target') refuse(`An edge end is "source" or "target", not "${String(end)}"`);
    const i = ctx.edgeIndex(edgeId);
    ctx.requireNode(node);
    checkSide(side, 'side');
    const offset = offsetOf(at, side, 'side offset');
    const key = end === 'source' ? 'source_side' : 'target_side';
    const atKey = end === 'source' ? 'source_at' : 'target_at';
    const edge = ctx.d.edges[i]!;
    if (edge[end] === node) {
      ctx.editLayout(side ? 'always' : [edgeId], (file) => updateEdge(file, edgeId, { [key]: side ?? null, [atKey]: offset }));
      return { edgeId };
    }
    edge[end] = node;
    ctx.rekeyEdgeEntries();
    const newId = ctx.edgeIds()[i]!;
    const patch: EdgePatch = { points: null, [key]: side ?? null, [atKey]: offset };
    ctx.editLayout(side ? 'always' : [newId, edgeId], (file) => updateEdge(file, newId, patch));
    return { edgeId: newId };
  });
}

/** UI17: set an edge's label; an empty label (or null) removes it. Labels are one line (§3.1). */
export function setEdgeLabel(files: Files, edgeId: string, label: string | null): OpResult {
  return run(files, (ctx) => {
    const i = ctx.edgeIndex(edgeId);
    if (label !== null && /[\r\n]/.test(label)) refuse('An edge label must be a single line');
    ctx.d.edges[i]!.label = label === null || label.trim() === '' ? null : label;
    return {};
  });
}
