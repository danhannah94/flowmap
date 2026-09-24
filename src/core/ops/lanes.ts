// Lane operations (design.md §8.2 UI18–UI21).
import { laneOrder } from '../config';
import { dropPointsInLanes, removePins, renameLane as renameLaneInLayout } from '../layoutfile';
import { isReservedId, type Lane } from '../mmd';
import { UNASSIGNED } from '../types';
import { checkBlockLabel, refuse, run, type Ctx, type Files, type OpResult } from './context';
import { deleteBlocksAndEdges } from './nodes';

/**
 * UI18 (with ruling R3): the label lowercased, each run of characters other than `a-z` and `0-9` turned into one
 * `-`, leading and trailing `-` removed. Empty: `lane`. Starting with a digit, or reserved: `lane-` in front.
 */
export function laneSlug(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug === '') return 'lane';
  return /^[0-9]/.test(slug) || isReservedId(slug) ? `lane-${slug}` : slug;
}

function laneOf(ctx: Ctx, id: string): Lane {
  if (id === UNASSIGNED) refuse('Unassigned is not a lane that can be changed');
  const lane = ctx.d.lanes.find((l) => l.id === id);
  if (!lane) refuse(`There is no lane "${id}"`);
  return lane;
}

// ---- UI18 Add lane

/**
 * UI18: add a lane with this label. Its id is the label's slug, with `-2`, `-3`… added until it isn't taken. The
 * subgraph is appended after the last one, and the lane to the config `lanes` list if the config has one (a stale
 * entry with the same id is replaced by the appended one, as ruling R5.13 does for a rename).
 */
export function addLane(files: Files, label: string): OpResult<{ id: string }> {
  return run(files, (ctx) => {
    checkBlockLabel(label, 'A lane label');
    const base = laneSlug(label);
    let id = base;
    for (let k = 2; ctx.isTaken(id); k++) id = `${base}-${k}`;
    ctx.d.lanes.push({ id, label, comments: [], nodes: [], endComments: [] });
    if (ctx.config?.lanes) {
      ctx.editConfig('always', (doc) => doc.deleteLaneEntry(id));
      ctx.editConfig('always', (doc) => doc.appendLane(id));
    } else {
      ctx.editConfig(['lanes'], (doc) => doc.appendLane(id));
    }
    return { id };
  });
}

// ---- UI19 Rename lane

/** UI19: set a lane's label (rewrites the subgraph label). An empty label is refused. */
export function setLaneLabel(files: Files, id: string, label: string): OpResult {
  return run(files, (ctx) => {
    checkBlockLabel(label, 'A lane label');
    laneOf(ctx, id).label = label;
    return {};
  });
}

/**
 * UI19: rename a lane's id everywhere: the subgraph, the config `lanes` entry (in place; a stale entry for the new id
 * is removed, R5.13), style rules matching `lane` with the old value, and the `lane` of every pin and (v1.1) bend
 * point.
 */
export function renameLane(files: Files, oldId: string, newId: string): OpResult {
  return run(files, (ctx) => {
    const lane = laneOf(ctx, oldId);
    if (newId === oldId) return {};
    ctx.checkNewId(newId, 'lane');
    lane.id = newId;
    ctx.editConfig([oldId, newId], (doc) => doc.deleteLaneEntry(newId));
    ctx.editConfig([oldId], (doc) => doc.renameLane(oldId, newId));
    ctx.editLayout([oldId], (file) => renameLaneInLayout(file, oldId, newId));
    return {};
  });
}

// ---- UI20 Reorder lanes

/**
 * UI20: write the config `lanes` list as every lane in the `.mmd`, in this order (creating the config file or the
 * list if needed). Existing entries keep their extra keys; entries for lanes that don't exist are dropped;
 * `_unassigned` is never listed. The order of subgraphs in the `.mmd` doesn't change.
 */
export function reorderLanes(files: Files, orderedIds: readonly string[]): OpResult {
  return run(files, (ctx) => {
    const ids = orderedIds.filter((id) => id !== UNASSIGNED);
    const real = ctx.d.lanes.map((l) => l.id);
    const same = ids.length === real.length && new Set(ids).size === ids.length && ids.every((id) => real.includes(id));
    if (!same) refuse(`The new order must list every lane exactly once (${real.join(', ')})`);
    ctx.editConfig('always', (doc) => doc.setLaneOrder(ids));
    return {};
  });
}

/** The lanes in display order (config `lanes` first, then file order; §4), without `_unassigned`. */
export function displayLaneOrder(files: Files): string[] | null {
  const r = run(files, (ctx) => ({ order: laneOrder(ctx.config, ctx.d.lanes.map((l) => l.id)) }));
  return r.ok ? r.order : null;
}

/** UI20 Move up / Move down in the lane menu: swap the lane with its neighbour in display order. */
export function moveLane(files: Files, id: string, dir: 'up' | 'down'): OpResult {
  const order = displayLaneOrder(files);
  if (order === null) return run(files, () => ({})); // reports the .mmd's errors
  const i = order.indexOf(id);
  if (i < 0) return { ok: false, error: `There is no lane "${id}"` };
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= order.length) return run(files, () => ({})); // already first or last: no change
  [order[i], order[j]] = [order[j]!, order[i]!];
  return reorderLanes(files, order);
}

// ---- UI21 Delete lane

export type DeleteLaneMode =
  | { mode: 'empty' }
  | { mode: 'move'; target: string }
  | { mode: 'delete' };

/**
 * UI21: delete a lane: its subgraph (with the comments above its `subgraph` line and above its `end`) and its
 * config `lanes` entry. `empty` refuses a lane that still has blocks; `move` appends each block, with its attached
 * comments, to `target` (a lane or `_unassigned`) in order, dropping its pin; `delete` deletes the blocks as UI14
 * does (their edges, comments and layout entries; never their config metadata). In every mode (v1.1 §8.2) the
 * `points` of every (live) line with a bend point in the lane are removed; orphaned entries' points are left for R12.
 */
export function deleteLane(files: Files, id: string, how: DeleteLaneMode): OpResult {
  return run(files, (ctx) => {
    const lane = laneOf(ctx, id);
    const blocks = lane.nodes.map((n) => n.id);
    if (how.mode === 'empty') {
      if (blocks.length) refuse(`Lane "${id}" still has blocks; move them or delete them with the lane`);
    } else if (how.mode === 'move') {
      if (how.target === id) refuse('Move the blocks to a different lane');
      ctx.requireLane(how.target, { unassigned: true });
      ctx.declsOf(how.target).push(...lane.nodes);
      lane.nodes = [];
      if (blocks.length) ctx.editLayout(blocks, (file) => removePins(file, blocks));
    } else if (how.mode === 'delete') {
      deleteBlocksAndEdges(ctx, blocks, []);
    } else {
      refuse('Choose how to delete the lane: empty, move or delete');
    }
    ctx.d.lanes = ctx.d.lanes.filter((l) => l !== lane);
    ctx.editConfig([id], (doc) => doc.deleteLaneEntry(id));
    // Live lines only: an orphaned entry's bend points in the lane are leftovers (R14.3, R15), which the first-lane
    // re-expression in `commit` gives U (or removes if still negative); in a later lane they are simply stale.
    const live = ctx.edgeIds();
    ctx.editLayout([id], (file) => dropPointsInLanes(file, id, live));
    return {};
  });
}
