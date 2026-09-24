// UI-level actions shared by the canvas gestures, the palette, the toolbar and the keyboard. Each one turns a person's
// intent into one core operation through `store.apply` (one undo step), using the layout on screen for positions.
import { nodeSize } from '../core/measure';
import {
  addNode, moveNodesToLane, NEW_BLOCK_LABELS, pinNodes, positionInLane, setNodeLabel,
  type DropPosition, type Files, type OpResult,
} from '../core/ops';
import type { ShapeKind } from '../core/types';
import { centre, dropPosition, laneAt } from './canvas/geometry';
import type { Point } from './canvas/viewport';
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
    const laneBox = layout.lanes.find((l) => l.id === lane);
    if (laneBox) {
      const size = nodeSize(NEW_BLOCK_LABELS[shape], shape);
      pin = dropPosition(layout, laneBox, { x: dropAt.x - size.width / 2, y: dropAt.y - size.height / 2 });
    }
  }
  const r = store.apply(addNode, { shape, lane, ...(pin ? { pin } : {}) });
  if (!r.ok) return false;
  store.set({ tool: { kind: 'select' } });
  editNodeLabel(store, r.id);
  return true;
}

/** UI6 drop from the palette: the lane under the world point, or a message. */
export function addBlockAt(store: Store, shape: ShapeKind, world: Point): boolean {
  const layout = store.layout;
  const lane = layout ? laneAt(layout, world) : null;
  if (!lane) {
    store.toast('Drop the shape inside a lane', 'info');
    return false;
  }
  return addBlock(store, shape, lane.id, world);
}

/**
 * UI10/UI11: drop dragged blocks moved by (dx, dy) world px. Each block whose centre lands in another lane moves
 * there (`moveNodesToLane`, pinned at the drop); the rest are pinned in their own lane (`pinNodes`). One undo step.
 */
export function dropNodes(store: Store, ids: readonly string[], dx: number, dy: number): void {
  const layout = store.layout;
  if (!layout || ids.length === 0) return;
  const stay: ({ id: string } & DropPosition)[] = [];
  const moves = new Map<string, ({ id: string } & DropPosition)[]>();
  for (const id of ids) {
    const n = layout.nodes.find((x) => x.id === id);
    if (!n) continue;
    const box = { x: Math.round(n.x + dx), y: Math.round(n.y + dy), width: n.width, height: n.height };
    const own = layout.lanes.find((l) => l.id === n.lane);
    const target = laneAt(layout, centre(box)) ?? own;
    if (!target) continue;
    const pos = { id, ...dropPosition(layout, target, box) };
    if (target.id === n.lane) stay.push(pos);
    else moves.set(target.id, [...(moves.get(target.id) ?? []), pos]);
  }
  if (moves.size === 0) {
    if (stay.length) store.apply(pinNodes, stay);
    return;
  }
  const steps: ((f: Files) => OpResult)[] = [];
  if (stay.length) steps.push((f) => pinNodes(f, stay));
  for (const [lane, pins] of moves) steps.push((f) => moveNodesToLane(f, pins.map((p) => p.id), lane, { pins }));
  store.apply(function moveBlocks(f: Files) {
    return chain(f, steps);
  });
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
