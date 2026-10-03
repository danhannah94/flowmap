// Lane operations (design.md §8.2 UI18–UI21), promoting Unassigned to a real lane (A7), lane sizes (A8) and the lanes'
// length along the flow (A13).
import { laneOrder } from '../config';
import {
  dropPointsInLanes, removeLaneEntries, removePins, renameLane as renameLaneInLayout, roundPx, setLaneLength, setLaneSize,
} from '../layoutfile';
import { declaredNodes, isReservedId, undeclaredNodes, type Lane, type NodeDecl } from '../mmd';
import { isLaneFree, UNASSIGNED } from '../types';
import { checkBlockLabel, loadLayout, refuse, run, type Ctx, type Files, type OpResult } from './context';
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

/** UI18: the id for a new lane with this label: its slug, with `-2`, `-3`… added until it isn't taken. */
function freshLaneId(ctx: Ctx, label: string): string {
  const base = laneSlug(label);
  let id = base;
  for (let k = 2; ctx.isTaken(id); k++) id = `${base}-${k}`;
  return id;
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
    const id = freshLaneId(ctx, label);
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
 * is removed, R5.13), style rules matching `lane` with the old value, the `lane` of every pin and (v1.1) bend
 * point, and (A8) the key of its size entry. It is the same lane: if it was displayed first, it still is.
 */
export function renameLane(files: Files, oldId: string, newId: string): OpResult {
  return run(files, (ctx) => {
    const lane = laneOf(ctx, oldId);
    if (newId === oldId) return {};
    ctx.checkNewId(newId, 'lane');
    lane.id = newId;
    ctx.noteLaneRename(oldId, newId);
    ctx.editConfig([oldId, newId], (doc) => doc.deleteLaneEntry(newId));
    ctx.editConfig([oldId], (doc) => doc.renameLane(oldId, newId));
    ctx.editLayout([oldId], (file) => renameLaneInLayout(file, oldId, newId));
    return {};
  });
}

// ---- A7 Rename Unassigned: it becomes a real lane

/**
 * A7: rename the Unassigned lane, which promotes it to a real lane: a subgraph with this label and the id UI18 would
 * give it, appended after the last subgraph, holding every unlaned block in file declaration order, with its attached
 * comments (a node that exists only in edges is declared there, as R6.5 does when it moves). It shows where Unassigned
 * did, last: it is appended to the config `lanes` list if the config has one that lists every lane (as UI18 does);
 * a list that leaves some lanes out is left alone, since appending would show the new lane before those. Everything
 * stays where it is on screen: every pin and bend point in `_unassigned` (applied or not), the lane's size (A8) and
 * every style rule matching `lane: _unassigned` take the new id. The Unassigned lane then no longer shows. Refused
 * when no block is unlaned (the lane isn't showing).
 */
export function promoteUnassigned(files: Files, label: string): OpResult<{ id: string }> {
  return run(files, (ctx) => {
    checkBlockLabel(label, 'A lane label');
    const undeclared = undeclaredNodes(ctx.d);
    if (ctx.d.unlaned.length === 0 && undeclared.length === 0) refuse('No block is in Unassigned, so there is no lane to rename');
    const id = freshLaneId(ctx, label);
    const listed = ctx.config?.lanes?.map((l) => l.id);
    const complete = !listed || ctx.d.lanes.every((l) => listed.includes(l.id));
    const declared: NodeDecl[] = undeclared.map((n) => ({ id: n.id, shape: 'step', label: n.id, className: null, comments: [] }));
    ctx.d.lanes.push({ id, label, comments: [], nodes: [...ctx.d.unlaned, ...declared], endComments: [] });
    ctx.d.unlaned = [];
    ctx.noteLaneRename(UNASSIGNED, id);
    ctx.editConfig([id], (doc) => doc.deleteLaneEntry(id));
    ctx.editConfig([UNASSIGNED], (doc) => doc.renameLaneMatches(UNASSIGNED, id));
    if (complete) ctx.editConfig(ctx.config?.lanes ? 'always' : ['lanes'], (doc) => doc.appendLane(id));
    ctx.editLayout([UNASSIGNED], (file) => renameLaneInLayout(file, UNASSIGNED, id));
    return { id };
  });
}

// ---- A8 Lane size

/**
 * A8: set a lane's size across the flow, by dragging its far edge (the bottom of its band for `LR`, the right for
 * `TB`). `size` is the band's thickness as drawn (layout px; rounded to a whole pixel as UI10 rounds). The lane can't
 * be thinner than its content needs (`LayoutOutput.laneNeeds`): at or below that, the stored size is removed and the
 * lane fits its content again. The layout file stores it from the lane's zero line, so the first lane's growth U (§6
 * Frame) is left out. Reports the size stored (null: none).
 */
export function resizeLane(files: Files, laneId: string, size: number): OpResult<{ size: number | null }> {
  return run(files, (ctx) => {
    ctx.requireLayout();
    if (typeof size !== 'number' || !Number.isFinite(size)) refuse('A lane size must be a finite number');
    const out = loadLayout(ctx.input);
    const i = out ? out.result.lanes.findIndex((l) => l.id === laneId) : -1;
    if (!out || i < 0) return refuse(`There is no lane "${laneId}" showing`);
    const need = out.laneNeeds[laneId]!;
    const want = roundPx(size);
    const stored = want <= need ? null : want - (i === 0 ? out.translation.across : 0);
    ctx.editLayout('always', (file) => setLaneSize(file, laneId, stored));
    return { size: stored };
  });
}

/** A8 "Reset size": remove a lane's stored size, so it fits its content again. */
export function resetLaneSize(files: Files, laneId: string): OpResult {
  return run(files, (ctx) => {
    ctx.requireLane(laneId, { unassigned: true });
    ctx.editLayout([laneId], (file) => setLaneSize(file, laneId, null));
    return {};
  });
}

// ---- A13 Lane length along the flow

/**
 * A13: set the lanes' shared length along the flow, by dragging the pool's far edge (the right edge of the lanes for
 * `LR`, the bottom for `TB`). `length` is the lanes' length as drawn (layout px from the start of the flow, header
 * strip included; rounded to a whole pixel as UI10 rounds). The lanes can't be shorter than their content needs
 * (`LayoutOutput.laneLengthNeed`): at or below that, the stored length is removed and the lanes fit their content
 * again. The layout file stores it from the flow axis's zero line, so the frame's T (§6 Frame: room made for
 * something dropped before the flow start) is left out, and the far edge stays where it is when T changes later.
 * Refused for a diagram without lanes (A4: there is no band to lengthen). Reports the length stored (null: none).
 */
export function resizeLaneLength(files: Files, length: number): OpResult<{ length: number | null }> {
  return run(files, (ctx) => {
    ctx.requireLayout();
    if (typeof length !== 'number' || !Number.isFinite(length)) refuse('A lane length must be a finite number');
    const out = loadLayout(ctx.input);
    if (!out || isLaneFree(out.result.lanes)) return refuse('This diagram has no lanes to lengthen');
    const want = roundPx(length);
    const stored = want <= out.laneLengthNeed ? null : want - out.translation.along;
    ctx.editLayout('always', (file) => setLaneLength(file, stored));
    return { length: stored };
  });
}

/** A13 "Reset length": remove the lanes' stored length, so they fit their content again. */
export function resetLaneLength(files: Files): OpResult {
  return run(files, (ctx) => {
    ctx.editLayout(['lane_length'], (file) => setLaneLength(file, null));
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
 * (A8) The lane's size entry goes too.
 */
export function deleteLane(files: Files, id: string, how: DeleteLaneMode): OpResult {
  return run(files, (ctx) => {
    const lane = laneOf(ctx, id);
    // A19: the lane's blocks include those in its groups (file declaration order); its groups go with it.
    const decls = declaredNodes({ ...ctx.d, unlaned: [], lanes: [lane] }).map((e) => e.node);
    const blocks = decls.map((n) => n.id);
    if (how.mode === 'empty') {
      if (blocks.length) refuse(`Lane "${id}" still has blocks; move them or delete them with the lane`);
    } else if (how.mode === 'move') {
      if (how.target === id) refuse('Move the blocks to a different lane');
      ctx.requireLane(how.target, { unassigned: true });
      ctx.declsOf(how.target).push(...decls);
      lane.nodes = [];
      lane.groups = [];
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
    ctx.editLayout([id], (file) => removeLaneEntries(dropPointsInLanes(file, id, live), [id]));
    return {};
  });
}
