// Block operations (design.md §8.2 UI6–UI14).
import { clearPins, pinFromDrop, removePins, renamePinNode, setPins } from '../layoutfile';
import { findNode, type NodeDecl } from '../mmd';
import { SHAPE_KINDS, UNASSIGNED, type LayoutResult, type Pin, type ShapeKind } from '../types';
import { checkBlockLabel, refuse, run, type Ctx, type Files, type OpResult } from './context';

/** UI6: the starting label of a new block, per shape. */
export const NEW_BLOCK_LABELS: Record<ShapeKind, string> = {
  step: 'New step',
  decision: 'New decision',
  terminal: 'New start or end',
  subprocess: 'New subprocess',
  database: 'New system',
  io: 'New input or output',
  document: 'New document',
  delay: 'New wait',
};

/** A drop position: the node's top-left `along` the flow and `across` from its lane's start edge (§5). */
export interface DropPosition {
  along: number;
  across: number;
}

function checkShape(shape: ShapeKind): void {
  if (!(SHAPE_KINDS as readonly string[]).includes(shape)) refuse(`Unknown shape "${shape}"`);
}

/** The node's declaration, declaring a never-declared node in the unlaned section first (§8.1, UI8). */
function declarationOf(ctx: Ctx, id: string): NodeDecl {
  ctx.requireNode(id);
  const found = findNode(ctx.d, id);
  if (found) return found.node;
  const decl: NodeDecl = { id, shape: 'step', label: id, className: null, comments: [] };
  ctx.d.unlaned.push(decl);
  return decl;
}

// ---- UI6 Add

/**
 * UI6: add a block of `shape` as the last declaration of `lane` (`_unassigned`: the unlaned section), with the
 * first free id `n1`, `n2`… and the shape's starting label. With `pin` (added by dragging from the palette), it is
 * pinned where it was dropped (rounded and clamped as in UI10).
 */
export function addNode(
  files: Files,
  args: { shape: ShapeKind; lane: string; pin?: DropPosition },
): OpResult<{ id: string }> {
  return run(files, (ctx) => {
    checkShape(args.shape);
    ctx.requireLane(args.lane, { unassigned: true });
    const id = ctx.nextNodeId();
    ctx.declsOf(args.lane).push({ id, shape: args.shape, label: NEW_BLOCK_LABELS[args.shape], className: null, comments: [] });
    if (args.pin) {
      const pin = pinFromDrop(args.lane, args.pin.along, args.pin.across);
      ctx.editLayout('always', (file) => setPins(file, [[id, pin]]));
    }
    return { id };
  });
}

// ---- UI7 Change shape

/**
 * UI7: rewrite the declaration in place with another shape (same position, id, label, lane and comment). A class
 * suffix is dropped for `document` and `delay`.
 */
export function changeShape(files: Files, id: string, shape: ShapeKind): OpResult {
  return run(files, (ctx) => {
    checkShape(shape);
    const decl = declarationOf(ctx, id);
    decl.shape = shape;
    if (shape === 'document' || shape === 'delay') decl.className = null;
    return {};
  });
}

// ---- UI8 Edit label

/** UI8: set a block's label. An empty label is refused. A never-declared node is declared in the unlaned section. */
export function setNodeLabel(files: Files, id: string, label: string): OpResult {
  return run(files, (ctx) => {
    checkBlockLabel(label);
    declarationOf(ctx, id).label = label;
    return {};
  });
}

// ---- UI9 Rename id

/**
 * UI9: rename a block's id. The new id must follow the id rules and be neither reserved nor taken. Changes the
 * declaration, the edges, the config `nodes` key, rules that match `id` with the old value, and the pin key (each
 * renamed key keeps its place).
 */
export function renameNode(files: Files, oldId: string, newId: string): OpResult {
  return run(files, (ctx) => {
    ctx.requireNode(oldId);
    if (newId === oldId) return {};
    ctx.checkNewId(newId, 'block');
    const found = findNode(ctx.d, oldId);
    if (found) found.node.id = newId;
    for (const edge of ctx.d.edges) {
      if (edge.source === oldId) edge.source = newId;
      if (edge.target === oldId) edge.target = newId;
    }
    ctx.editConfig([oldId], (doc) => doc.renameNode(oldId, newId));
    ctx.editLayout([oldId], (file) => renamePinNode(file, oldId, newId));
    return {};
  });
}

// ---- UI10 Move and pin

/**
 * UI10: pin blocks at their drop positions (a drag, or an arrow-key nudge), recording each block's current lane.
 * Positions are rounded to whole pixels, `along` at least 0 and `across` at least 12. New pins are added in file
 * declaration order.
 */
export function pinNodes(files: Files, pins: readonly ({ id: string } & DropPosition)[]): OpResult {
  return run(files, (ctx) => {
    const byId = new Map(pins.map((p) => [p.id, p]));
    const ordered = ctx.sortByDeclaration([...byId.keys()]);
    const out: [string, Pin][] = ordered.map((id) => {
      const p = byId.get(id)!;
      return [id, pinFromDrop(ctx.laneOf(id), p.along, p.across)];
    });
    if (out.length) ctx.editLayout('always', (file) => setPins(file, out));
    return {};
  });
}

// ---- UI11 Move across lanes

/**
 * UI11: move blocks to `lane` (a lane id or `_unassigned`). Each declaration, with its attached comments, is appended
 * as the last declaration of that lane, in file declaration order; a never-declared node is declared there. Blocks
 * already in `lane` stay where they are.
 *
 * Pins: dropped (the inspector's lane select), except for blocks listed in `opts.pins` (a drag across lanes), which
 * are pinned at their drop position in the new lane.
 */
export function moveNodesToLane(
  files: Files,
  ids: readonly string[],
  lane: string,
  opts: { pins?: readonly ({ id: string } & DropPosition)[] } = {},
): OpResult {
  return run(files, (ctx) => {
    ctx.requireLane(lane, { unassigned: true });
    const ordered = ctx.sortByDeclaration(ids);
    const dropAt = new Map((opts.pins ?? []).map((p) => [p.id, p]));
    for (const id of dropAt.keys()) if (!ordered.includes(id)) refuse(`"${id}" has a drop position but isn't moved`);
    const moved: string[] = [];
    for (const id of ordered) {
      if (ctx.laneOf(id) === lane) continue;
      const decl = ctx.removeDecl(id) ?? { id, shape: 'step' as const, label: id, className: null, comments: [] };
      ctx.declsOf(lane).push(decl);
      moved.push(id);
    }
    const drop = moved.filter((id) => !dropAt.has(id));
    const pins: [string, Pin][] = ordered
      .filter((id) => dropAt.has(id))
      .map((id) => [id, pinFromDrop(lane, dropAt.get(id)!.along, dropAt.get(id)!.across)]);
    if (drop.length) ctx.editLayout(drop, (file) => removePins(file, drop));
    if (pins.length) ctx.editLayout('always', (file) => setPins(file, pins));
    return {};
  });
}

// ---- UI12 Unpin

/** UI12: unpin blocks (back to automatic placement). */
export function unpinNodes(files: Files, ids: readonly string[]): OpResult {
  return run(files, (ctx) => {
    const ordered = ctx.sortByDeclaration(ids);
    ctx.editLayout(ordered, (file) => removePins(file, ordered));
    return {};
  });
}

/** UI12 "Re-layout all": every pin cleared; the file becomes `{"version": 1, "nodes": {}}`, keeping `hints`. */
export function clearAllPins(files: Files): OpResult {
  return run(files, (ctx) => {
    ctx.editLayout('always', (file) => clearPins(file));
    return {};
  });
}

// ---- UI13 Duplicate

/**
 * Where a node is now, as a pin would record it (§5): `along` is its box's start on the flow axis, `across` its
 * offset from its lane's start edge. `layout` is the current layout (`flowmap layout` output, or the UI's).
 */
export function positionInLane(layout: Pick<LayoutResult, 'direction' | 'lanes' | 'nodes'>, id: string): DropPosition | undefined {
  const node = layout.nodes.find((n) => n.id === id);
  if (!node) return undefined;
  const lane = layout.lanes.find((l) => l.id === node.lane);
  if (!lane) return undefined;
  return layout.direction === 'TB'
    ? { along: node.y, across: node.x - lane.x }
    : { along: node.x, across: node.y - lane.y };
}

/**
 * UI13: copy each block (same shape, label, class and lane; comments and edges aren't copied) under a new id, as the
 * last declaration of its lane, in file declaration order; copy its config metadata under the new id; pin each copy
 * 24 px along and 24 px across from its original's current position in `layout`. Returns the new ids, index-aligned
 * with the originals in declaration order (`from`).
 */
export function duplicateNodes(
  files: Files,
  ids: readonly string[],
  layout: Pick<LayoutResult, 'direction' | 'lanes' | 'nodes'>,
): OpResult<{ ids: string[]; from: string[] }> {
  return run(files, (ctx) => {
    const ordered = ctx.sortByDeclaration(ids);
    const newIds: string[] = [];
    const pins: [string, Pin][] = [];
    for (const id of ordered) {
      const found = findNode(ctx.d, id);
      const lane = found?.lane ?? UNASSIGNED;
      const src = found?.node ?? { shape: 'step' as const, label: id, className: null };
      const pos = positionInLane(layout, id);
      if (!pos) refuse(`The layout has no position for "${id}"`);
      const copy = ctx.nextNodeId();
      ctx.declsOf(lane).push({ id: copy, shape: src.shape, label: src.label, className: src.className, comments: [] });
      pins.push([copy, pinFromDrop(lane, pos.along + 24, pos.across + 24)]);
      newIds.push(copy);
    }
    ordered.forEach((id, k) => ctx.editConfig([id], (doc) => doc.copyNode(id, newIds[k]!)));
    if (pins.length) ctx.editLayout('always', (file) => setPins(file, pins));
    return { ids: newIds, from: ordered };
  });
}

// ---- UI14 Delete

/**
 * UI14: delete blocks and lines. A deleted block takes its declaration, every edge touching it, its pin and the
 * comments attached to those statements with it; its config metadata is never touched (UI27). `edges` are edge ids
 * (§3.4) of the files as given.
 */
export function deleteItems(
  files: Files,
  items: { nodes?: readonly string[]; edges?: readonly string[] },
): OpResult {
  return run(files, (ctx) => {
    deleteBlocksAndEdges(ctx, items.nodes ?? [], items.edges ?? []);
    return {};
  });
}

/** Shared with UI21's "delete the blocks with the lane". */
export function deleteBlocksAndEdges(ctx: Ctx, nodeIds: readonly string[], edgeIdList: readonly string[]): void {
  const nodes = ctx.sortByDeclaration(nodeIds);
  const edgeIdsNow = ctx.edgeIds();
  for (const e of edgeIdList) if (!edgeIdsNow.includes(e)) refuse(`There is no line "${e}"`);
  const dropEdges = new Set(edgeIdList);
  const dropNodes = new Set(nodes);
  ctx.d.edges = ctx.d.edges.filter((edge, k) => (
    !dropEdges.has(edgeIdsNow[k]!) && !dropNodes.has(edge.source) && !dropNodes.has(edge.target)
  ));
  for (const id of nodes) ctx.removeDecl(id);
  if (nodes.length) ctx.editLayout(nodes, (file) => removePins(file, nodes));
}
