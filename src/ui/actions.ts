// UI-level actions shared by the canvas gestures, the palette, the toolbar and the keyboard. Each one turns a person's
// intent into one core operation through `store.apply` (one undo step), using the layout on screen for positions.
import { nodeSize } from '../core/measure';
import {
  addNode, moveNodesToLane, NEW_BLOCK_LABELS, pinNodes, positionInLane, setNodeLabel,
  type DropPosition, type Files, type OpResult,
} from '../core/ops';
import { loadDocument } from '../core/document';
import { isLaneFree, UNASSIGNED, type ShapeKind } from '../core/types';
import { centre, dropBand, dropLaneAt, dropPosition, laneAt } from './canvas/geometry';
import type { Point, Rect } from './canvas/viewport';
import { withHints } from './store/derive';
import type { Store } from './store/store';

/** Run several operations as one: each step gets the previous step's files. Stops at the first refusal. */
export function chain(files: Files, steps: readonly ((f: Files) => OpResult)[]): OpResult {
  let cur = files;
  for (const step of steps) {
    const r = step(cur);
    if (!r.ok) return r;
    cur = r.files;
  }
  return { ok: true, files: cur };
}

/** Why dragging/pinning is off (UI31), or null. */
export function pinningBlocked(store: Store): string | null {
  const ro = store.readOnlyReason();
  if (ro) return ro;
  if (store.getState().derived?.layoutBroken) {
    return 'The layout file has errors, so dragging and pinning are off until it is fixed';
  }
  return null;
}

/** UI8: open the in-place label editor on a block. */
export function editNodeLabel(store: Store, id: string): void {
  if (store.readOnlyReason()) return;
  const node = store.layout?.nodes.find((n) => n.id === id);
  if (!node) return;
  store.select({ nodes: [id] });
  // A block added below the fold of a growing lane, or Enter on one scrolled away: bring it into view first.
  store.reveal(node, { onlyIfOffscreen: true });
  store.beginEdit({
    testid: 'label-editor',
    target: { kind: 'node', id },
    initial: node.label,
    anchor: { x: node.x, y: node.y, width: node.width, height: node.height },
    variant: 'label',
    commit: (text) => {
      if (text === node.label) return;
      store.apply(setNodeLabel, id, text);
    },
  });
}

/**
 * UI6: add a block of `shape` to `lane` and open it in label editing. With `dropAt` (a world point: the palette drag's
 * drop), the block is centred there and pinned.
 */
export function addBlock(store: Store, shape: ShapeKind, lane: string, dropAt?: Point): boolean {
  const layout = store.layout;
  let pin: DropPosition | undefined;
  if (dropAt && layout) {
    const size = nodeSize(NEW_BLOCK_LABELS[shape], shape);
    pin = dropPosition(layout, dropBand(layout, lane), { x: dropAt.x - size.width / 2, y: dropAt.y - size.height / 2 });
  }
  const r = store.apply(addNode, { shape, lane, ...(pin ? { pin } : {}) });
  if (!r.ok) return false;
  store.set({ tool: { kind: 'select' } });
  // Bring the whole new block into view (a click-added block is placed by the layout, possibly off screen).
  const added = store.layout?.nodes.find((n) => n.id === r.id);
  if (added) store.reveal(added);
  editNodeLabel(store, r.id);
  return true;
}

/** Amendment A4: the diagram has no lanes (its `.mmd` has no subgraphs), so it is a plain flowchart. */
export function laneFreeNow(store: Store): boolean {
  const layout = store.layout;
  return !!layout && isLaneFree(layout.lanes);
}

/**
 * UI6 drop from the palette: the lane under the world point, or a message. In a lane-free diagram (A4) a drop
 * anywhere on the canvas adds an unlaned block, pinned there.
 */
export function addBlockAt(store: Store, shape: ShapeKind, world: Point): boolean {
  const layout = store.layout;
  if (layout && isLaneFree(layout.lanes)) return addBlock(store, shape, UNASSIGNED, world);
  const lane = layout ? laneAt(layout, world) : null;
  if (!lane) {
    store.toast('Drop the shape inside a lane', 'info');
    return false;
  }
  return addBlock(store, shape, lane.id, world);
}

/**
 * UI10/UI11: drop dragged blocks moved by (dx, dy) world px. Each block whose centre lands in another lane moves
 * there (`moveNodesToLane`, pinned at the drop); a block whose centre lands outside every lane moves to Unassigned,
 * pinned at the drop (amendment A4); the rest are pinned in their own lane (`pinNodes`). One undo step.
 */
export function dropNodes(store: Store, ids: readonly string[], dx: number, dy: number): void {
  const layout = store.layout;
  if (!layout || ids.length === 0) return;
  const stay: ({ id: string } & DropPosition)[] = [];
  const moves = new Map<string, ({ id: string } & DropPosition)[]>();
  const toUnassigned: { id: string; box: Rect }[] = [];
  for (const id of ids) {
    const n = layout.nodes.find((x) => x.id === id);
    if (!n) continue;
    const box = { x: Math.round(n.x + dx), y: Math.round(n.y + dy), width: n.width, height: n.height };
    const target = dropLaneAt(layout, centre(box));
    const pos = { id, ...dropPosition(layout, dropBand(layout, target), box) };
    if (target === n.lane) stay.push(pos);
    else {
      moves.set(target, [...(moves.get(target) ?? []), pos]);
      if (target === UNASSIGNED) toUnassigned.push({ id, box });
    }
  }
  if (moves.size === 0) {
    if (stay.length) store.apply(pinNodes, stay);
    return;
  }
  const steps: ((f: Files) => OpResult)[] = [];
  if (stay.length) steps.push((f) => pinNodes(f, stay));
  for (const [lane, pins] of moves) steps.push((f) => moveNodesToLane(f, pins.map((p) => p.id), lane, { pins }));
  store.apply(function moveBlocks(f: Files) {
    const r = chain(f, steps);
    return r.ok && toUnassigned.length ? settleUnassigned(store, f, r.files, toUnassigned) : r;
  });
}

/**
 * Blocks dropped outside every lane are pinned relative to the Unassigned lane, which is last: where it starts is only
 * known once they have moved (it may be appearing now, and the lanes they left may have shrunk). Lay out the result
 * once, then pin each block at its drop point against the Unassigned lane as it really is.
 */
function settleUnassigned(store: Store, before: Files, after: Files, dropped: readonly { id: string; box: Rect }[]): OpResult {
  const s = store.getState();
  const probe = withHints(before, after, s.derived);
  const result = loadDocument(probe.mmd, probe.config, probe.layout, s.file).layout?.result;
  const lane = result?.lanes.find((l) => l.id === UNASSIGNED);
  if (!result || !lane) return { ok: true, files: after };
  const settled = pinNodes(after, dropped.map(({ id, box }) => ({ id, ...dropPosition(result, lane, box) })));
  return settled.ok ? settled : { ok: true, files: after };
}

/** UI10: nudge the selected blocks by (dx, dy) screen-axis px, pinning them in their lanes. */
export function nudgeSelection(store: Store, dx: number, dy: number): void {
  const blocked = pinningBlocked(store);
  if (blocked) {
    store.toast(blocked, 'info');
    return;
  }
  const layout = store.layout;
  const ids = store.getState().selection.nodes;
  if (!layout || ids.length === 0) return;
  const tb = layout.direction === 'TB';
  const pins: ({ id: string } & DropPosition)[] = [];
  for (const id of ids) {
    const pos = positionInLane(layout, id);
    if (!pos) continue;
    pins.push({ id, along: pos.along + (tb ? dy : dx), across: pos.across + (tb ? dx : dy) });
  }
  if (pins.length) store.apply(pinNodes, pins);
}
