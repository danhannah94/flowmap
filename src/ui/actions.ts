// UI-level actions shared by the canvas gestures, the palette, the toolbar and the keyboard. Each one turns a person's
// intent into one core operation through `store.apply` (one undo step), using the layout on screen for positions.
import { nodeSize } from '../core/measure';
import {
  addNode, addNodeAt, moveNodesToLane, NEW_BLOCK_LABELS, pinNodes, setNodeLabel,
  type DropPosition, type Files, type OpResult,
} from '../core/ops';
import { roundPx } from '../core/layoutfile';
import { isLaneFree, UNASSIGNED, type ShapeKind } from '../core/types';
import { centre, dropBand, dropLaneAt, dropPosition, laneAt } from './canvas/geometry';
import type { Point, Rect } from './canvas/viewport';
import { derive, originMove, translationOf, withHints } from './store/derive';
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
 * drop), the block is centred there and pinned (a drop before or above everything gives a negative pin; the layout
 * translates and the view pans with it, so it stays where it was dropped).
 */
export function addBlock(store: Store, shape: ShapeKind, lane: string, dropAt?: Point): boolean {
  const layout = store.layout;
  let pin: DropPosition | undefined;
  if (dropAt && layout) {
    const size = nodeSize(NEW_BLOCK_LABELS[shape], shape);
    const topLeft = { x: dropAt.x - size.width / 2, y: dropAt.y - size.height / 2 };
    pin = dropPosition(layout, dropBand(layout, lane), topLeft, translationOf(store.getState().derived));
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
 * UI40 canvas menu `add-<shape kind>`: add a block with its top-left corner at a world point, pinned there, in the lane
 * its centre falls in by UI43's rules (`addNodeAt`), and open it in label editing (UI6). One undo step; `settlePlaced`
 * makes it exact on screen when the drop changes the lanes (the Unassigned lane appearing with it).
 */
export function addBlockAtCorner(store: Store, shape: ShapeKind, corner: Point): boolean {
  const output = store.getState().derived?.doc.layout;
  if (!output) return false;
  const size = nodeSize(NEW_BLOCK_LABELS[shape], shape);
  const box = { x: roundPx(corner.x), y: roundPx(corner.y), width: size.width, height: size.height };
  let id = '';
  const r = store.apply(function addBlockHere(f: Files) {
    const added = addNodeAt(f, shape, corner, output);
    if (!added.ok) return added;
    id = added.id;
    return settlePlaced(store, f, added.files, [{ id, from: added.lane, lane: added.lane, box }]);
  });
  if (!r.ok || !id) return false;
  store.set({ tool: { kind: 'select' } });
  editNodeLabel(store, id);
  return true;
}

export type Placed = { id: string; from: string; lane: string; box: Rect };

/**
 * UI10/UI11: pin blocks at world boxes (each `lane`: the lane it ends in), as one undo step. Blocks that stay in their
 * lane are pinned there (`pinNodes`); a block whose lane changes moves (`moveNodesToLane`, pinned at the drop). Pins
 * are exactly where the blocks were dropped, negative ones included (before or above everything); then
 * `settlePlaced` makes that exact on screen, whatever the drop does to the lanes and the layout's translation.
 */
function placeBlocks(store: Store, placed: readonly Placed[]): void {
  const layout = store.layout;
  if (!layout || placed.length === 0) return;
  const shift = translationOf(store.getState().derived);
  const stay: ({ id: string } & DropPosition)[] = [];
  const moves = new Map<string, ({ id: string } & DropPosition)[]>();
  for (const p of placed) {
    const pos = { id: p.id, ...dropPosition(layout, dropBand(layout, p.lane), p.box, shift) };
    if (p.lane === p.from) stay.push(pos);
    else moves.set(p.lane, [...(moves.get(p.lane) ?? []), pos]);
  }
  const steps: ((f: Files) => OpResult)[] = [];
  if (stay.length) steps.push((f) => pinNodes(f, stay));
  for (const [lane, pins] of moves) steps.push((f) => moveNodesToLane(f, pins.map((p) => p.id), lane, { pins }));
  store.apply(function moveBlocks(f: Files) {
    const r = chain(f, steps);
    return r.ok ? settlePlaced(store, f, r.files, placed) : r;
  });
}

/**
 * UI10/UI11: drop dragged blocks moved by (dx, dy) world px. Each block whose centre lands in another lane moves
 * there, pinned at the drop; one whose centre lands below every lane moves to Unassigned, pinned at the drop
 * (amendment A4); one above every lane joins the first lane; the rest are pinned in their own lane, including before
 * or after the diagram along the flow (`dropLaneAt`). One undo step.
 */
export function dropNodes(store: Store, ids: readonly string[], dx: number, dy: number): void {
  const layout = store.layout;
  if (!layout || ids.length === 0) return;
  const placed: Placed[] = [];
  for (const id of ids) {
    const n = layout.nodes.find((x) => x.id === id);
    if (!n) continue;
    const box = { x: roundPx(n.x + dx), y: roundPx(n.y + dy), width: n.width, height: n.height };
    placed.push({ id, from: n.lane, lane: dropLaneAt(layout, centre(box)), box });
  }
  placeBlocks(store, placed);
}

/**
 * Where each dropped block must be pinned to show exactly at its drop box is only known once the drop is laid out:
 * a block that changed lanes is measured from its new lane, whose start moves when the lane it left shrinks (and the
 * Unassigned lane may be appearing now); a negative pin changes the layout's translation, which the store pans away
 * (`originMove`). Lay out the result, then pin each block at its drop box as it will be on screen after that pan,
 * against its lane as it really is. A settled pin can grow its lane and move later lanes, so repeat until it holds
 * (it does after one or two passes). Also used when nothing changed lanes: then the first pass confirms the pins.
 */
export function settlePlaced(store: Store, before: Files, after: Files, placed: readonly Placed[]): OpResult {
  const s = store.getState();
  let files = after;
  for (let pass = 0; pass < 4; pass++) {
    const probe = derive(withHints(before, files, s.derived), s.file);
    const result = probe.layout;
    if (!result) break;
    const pan = originMove(s.derived, probe);
    const shift = translationOf(probe);
    const pins: ({ id: string } & DropPosition)[] = [];
    for (const { id, lane, box } of placed) {
      const band = result.lanes.find((l) => l.id === lane);
      if (band) pins.push({ id, ...dropPosition(result, band, { x: box.x + pan.x, y: box.y + pan.y }, shift) });
    }
    const settled = pinNodes(files, pins);
    if (!settled.ok || settled.files.layout === files.layout) break;
    files = settled.files;
  }
  return { ok: true, files };
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
  const placed: Placed[] = [];
  for (const id of ids) {
    const n = layout.nodes.find((x) => x.id === id);
    if (!n || !layout.lanes.some((l) => l.id === n.lane)) continue;
    // A nudge keeps the block in its lane (a drag is how it changes lanes).
    placed.push({ id, from: n.lane, lane: n.lane, box: { x: n.x + dx, y: n.y + dy, width: n.width, height: n.height } });
  }
  placeBlocks(store, placed);
}
