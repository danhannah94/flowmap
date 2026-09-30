// Block operations (design.md §8.2 UI6–UI14, and v1.1 UI34 resize and UI40's "add a block here").
import {
  clearPinsAndPoints, MIN_SIZE, pinFromDrop, removeNodeEntries, removePins, renameNodeEntry, roundPx,
  setPins, setSizes,
} from '../layoutfile';
import type { Translation } from '../layout';
import { labelNeeds, nodeSize } from '../measure';
import { findNode, type NodeDecl } from '../mmd';
import { SHAPE_KINDS, type LayoutResult, type Pin, type ShapeKind, type Size, type XY } from '../types';
import { checkBlockLabel, refuse, run, type Ctx, type Files, type OpResult } from './context';
import { bandStart, blockLaneAt, checkXY, storedCorner, viewOf, type LayoutArg } from './frame';

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
      const pin = pinFromDrop(args.lane, args.pin.along, args.pin.across, ctx.firstLane());
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
    // §8.2: the node entry (in place), and the keys of its lines' entries by re-keying by position. Only live lines are
    // re-keyed: an orphaned entry that merely names the node keeps its key, and one sitting on a line's new key is
    // replaced by that line's entry (R11.4), wherever the two are in the file.
    ctx.editLayout([oldId], (file) => renameNodeEntry(file, oldId, newId));
    ctx.rekeyEdgeEntries();
    return {};
  });
}

// ---- UI10 Move and pin

/**
 * UI10: pin blocks at their drop positions (a drag, or an arrow-key nudge), recording each block's current lane.
 * Positions are rounded to whole pixels (halves toward −∞) and otherwise kept exactly, negative ones included where §5
 * allows them (`pinFromDrop`: `across` below 0 only in the first lane). New pins are added in file declaration order.
 */
export function pinNodes(files: Files, pins: readonly ({ id: string } & DropPosition)[]): OpResult {
  return run(files, (ctx) => {
    const byId = new Map(pins.map((p) => [p.id, p]));
    const ordered = ctx.sortByDeclaration([...byId.keys()]);
    const out: [string, Pin][] = ordered.map((id) => {
      const p = byId.get(id)!;
      return [id, pinFromDrop(ctx.laneOf(id), p.along, p.across, ctx.firstLane())];
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
      .map((id) => [id, pinFromDrop(lane, dropAt.get(id)!.along, dropAt.get(id)!.across, ctx.firstLane())]);
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

/**
 * UI12 "Re-layout all": every pin and every line's `points` cleared; sizes, sides, `label_at`, notes, the title
 * position and `hints` stay (v1.1). Emptied entries go.
 */
export function clearAllPins(files: Files): OpResult {
  return run(files, (ctx) => {
    ctx.editLayout('always', (file) => clearPinsAndPoints(file));
    return {};
  });
}

// ---- UI13 Duplicate (see fragment.ts)

/**
 * Where a node is now, as a pin would record it (§5): `along` is its box's start on the flow axis less the frame's
 * T, `across` its offset from its lane's zero line (the start edge; for the first lane, U after it). `shift` is the
 * layout's frame (`pinTranslation`); `layout` is the current layout (`flowmap layout` output, or the UI's).
 */
export function positionInLane(
  layout: Pick<LayoutResult, 'direction' | 'lanes' | 'nodes'>, id: string, shift: Translation = { along: 0, across: 0 },
): DropPosition | undefined {
  const node = layout.nodes.find((n) => n.id === id);
  if (!node) return undefined;
  const lane = layout.lanes.find((l) => l.id === node.lane);
  if (!lane) return undefined;
  const u = lane.id === layout.lanes[0]?.id ? shift.across : 0;
  return layout.direction === 'TB'
    ? { along: node.y - shift.along, across: node.x - lane.x - u }
    : { along: node.x - shift.along, across: node.y - lane.y - u };
}

// ---- UI14 Delete

/**
 * UI14: delete blocks and lines. A deleted block takes its declaration, every edge touching it, its layout entry (pin
 * and size) and the comments attached to those statements with it; its config metadata is never touched (UI27). A
 * deleted line takes its layout entry, and the other lines' entries are re-keyed by position (§8.2). `edges` are edge
 * ids (§3.4) of the files as given.
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
  ctx.rekeyEdgeEntries();
  if (nodes.length) ctx.editLayout(nodes, (file) => removeNodeEntries(file, nodes));
}

// ---- UI40 Add a block at a spot (the canvas context menu)

/**
 * UI40 `add-<shape kind>`: add a block with its top-left corner at `at` (diagram coordinates), pinned there, in the
 * lane its centre falls in by UI43's rules (before the first lane: the first lane; after the last: Unassigned; along
 * the flow nothing decides the lane). Declared as the last declaration of that lane, with the first free id and the
 * shape's starting label. Returns the id and the lane.
 */
export function addNodeAt(
  files: Files, shape: ShapeKind, at: XY, layout: LayoutArg,
): OpResult<{ id: string; lane: string }> {
  return run(files, (ctx) => {
    checkShape(shape);
    checkXY(at);
    ctx.requireLayout();
    const view = viewOf(ctx, layout);
    const size = nodeSize(NEW_BLOCK_LABELS[shape], shape);
    const lane = blockLaneAt(view.result, at.x + size.width / 2, at.y + size.height / 2);
    const id = ctx.nextNodeId();
    ctx.declsOf(lane).push({ id, shape, label: NEW_BLOCK_LABELS[shape], className: null, comments: [] });
    const corner = storedCorner(view, lane, at.x, at.y);
    const pin = pinFromDrop(lane, corner.along, corner.across, ctx.firstLane());
    ctx.editLayout('always', (file) => setPins(file, [[id, pin]]));
    return { id, lane };
  });
}

// ---- UI34 Resize

/** A resize handle (§8.3 `data-resize`): the side or corner being dragged. */
export type ResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
const HANDLES: readonly ResizeHandle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

/** A block as `resizedBox` needs it: its box as drawn, and its label and shape (for what the label needs, §6 L9). */
export interface ResizableBlock {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  kind: ShapeKind;
}

/**
 * UI34: the box a block has after dragging `handle` by (dx, dy) diagram px. Shared by `resizeNode` and the UI's live
 * preview, so what is drawn while dragging is exactly what lands.
 * - The opposite edge or corner stays; only the moved edge is rounded to a whole pixel (halves toward −∞).
 * - The width stops at the label's narrowest width, the height at what the label needs at the new width (never below
 *   40), and a width-only drag keeps the height at least that need too (the far edge moves down or right).
 * - `floor` is where the block's lane starts across the flow when that lane isn't the first (else −Infinity): a top
 *   edge (LR) or left edge (TB) can't go before it (a pin's `across` is at least 0 there, §5). Narrowing from a top
 *   handle raises the height the label needs; the width stops narrowing where that need no longer fits between the
 *   lane's start edge and the fixed bottom edge, so the bottom edge still stays.
 */
export function resizedBox(
  node: ResizableBlock, handle: ResizeHandle, delta: { dx: number; dy: number }, LR: boolean, floor: number,
): { x: number; y: number; width: number; height: number } {
  const [n, s, e, w] = ['n', 's', 'e', 'w'].map((c) => handle.includes(c));
  const right = node.x + node.width;
  const bottom = node.y + node.height;
  const needAt = (width: number) => Math.max(labelNeeds(node.label, node.kind, width).height, MIN_SIZE);

  let left = node.x;
  let width = node.width;
  if (e) width = roundPx(right + delta.dx) - node.x;
  if (w) {
    left = Math.min(roundPx(node.x + delta.dx), right - 1);
    if (!LR) left = Math.max(left, floor);
    width = right - left;
  }
  width = Math.max(width, labelNeeds(node.label, node.kind, Math.max(1, width)).minWidth, MIN_SIZE);
  if (LR && n && floor > -Infinity) {
    // The block's current box fits (its top is at or after the lane's start edge), so this stops by `node.width`.
    const room = bottom - floor;
    while (width < node.width && needAt(width) > room) width++;
  }
  if (w) left = right - width;

  let top = node.y;
  let height = node.height;
  if (s) height = roundPx(bottom + delta.dy) - node.y;
  if (n) {
    top = Math.min(roundPx(node.y + delta.dy), bottom - 1);
    if (LR) top = Math.max(top, floor);
    height = bottom - top;
  }
  height = Math.max(height, needAt(width));
  if (n) top = bottom - height;
  return { x: left, y: top, width, height };
}

/**
 * UI34: drag a resize handle of block `id` by `delta` (diagram pixels). Writes the block's `width` and `height` (both,
 * even if only one changed), sized and placed by `resizedBox` from the block's box in `layout`. Every resize also
 * writes the pin (amendment A6), at the block's top-left after the resize: where it was drawn before for a right or
 * bottom handle, moved by the handle for a top or left one. So an automatically placed block is pinned where it is
 * and doesn't jump when the layout runs again; the pin is in the block's lane, with `across` at least 0 outside the
 * first lane (§5).
 */
export function resizeNode(
  files: Files, layout: LayoutArg, id: string, handle: ResizeHandle, delta: { dx: number; dy: number },
): OpResult<{ size: Size }> {
  return run(files, (ctx) => {
    ctx.requireNode(id);
    if (!HANDLES.includes(handle)) refuse(`Unknown resize handle "${String(handle)}"`);
    ctx.requireLayout();
    if (!delta || !Number.isFinite(delta.dx) || !Number.isFinite(delta.dy)) refuse('A drag needs a finite dx and dy');
    const view = viewOf(ctx, layout);
    const node = view.result.nodes.find((n) => n.id === id);
    if (!node) return refuse(`The layout has no block "${id}"; try again`);
    const lane = ctx.laneOf(id);
    const LR = view.result.direction !== 'TB';
    const li = view.result.lanes.findIndex((l) => l.id === lane);
    const floor = li > 0 ? bandStart(view.result, view.result.lanes[li]!) : -Infinity;
    const box = resizedBox(node, handle, delta, LR, floor);
    const size = { width: box.width, height: box.height };
    const corner = storedCorner(view, lane, box.x, box.y);
    const pin = pinFromDrop(lane, corner.along, corner.across, ctx.firstLane());
    ctx.editLayout('always', (file) => setPins(setSizes(file, [[id, size]]), [[id, pin]]));
    return { size };
  });
}

/** UI34 "Reset size" (UI40: on every selected block): remove the stored sizes; pins stay. */
export function resetSize(files: Files, ids: readonly string[]): OpResult {
  return run(files, (ctx) => {
    const ordered = ctx.sortByDeclaration(ids);
    ctx.editLayout(ordered, (file) => setSizes(file, ordered.map((id) => [id, null])));
    return {};
  });
}
