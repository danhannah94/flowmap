// UI34 resize: the live preview's geometry. While a handle is dragged the canvas draws the block at the box this
// returns, and on release `resizeNode` (src/core/ops) writes it. Both follow the same rules, so what you see while
// dragging is exactly what lands: the opposite edge or corner stays put, only the moved edge is rounded to a whole
// pixel (halves toward −∞), the width stops at the label's narrowest width and the height at what the label needs at
// that width (§6 L9 "needs"), never below 40, and across the flow a top (LR) or left (TB) edge stops at a later
// lane's start edge. `resize.test.ts` checks this against the operation and the layout that follows it.
import type { ResizeHandle } from '../../core/ops';
import { labelNeeds } from '../../core/measure';
import { roundPx } from '../../core/layoutfile';
import type { LayoutResult, ShapeKind } from '../../core/types';
import type { Rect } from './viewport';

export type { ResizeHandle };

/** The eight handles in the §8.3 order: sides and corners clockwise from the top. */
export const RESIZE_HANDLES: readonly ResizeHandle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

/** The cursor that says which way each handle moves. */
export const RESIZE_CURSOR: Record<ResizeHandle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

/** Sizes are integers of at least 40 (§5). */
const MIN = 40;

export interface ResizableNode {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  kind: ShapeKind;
}

/**
 * The box a block would have after dragging `handle` by (dx, dy) diagram px. `floor` is where the block's lane starts
 * across the flow when that lane isn't the first (a top edge in LR, a left edge in TB can't go before it), else
 * −Infinity (`resizeFloor`).
 */
export function resizeBox(
  node: ResizableNode, handle: ResizeHandle, dx: number, dy: number, LR: boolean, floor: number,
): Rect {
  const n = handle.includes('n');
  const s = handle.includes('s');
  const e = handle.includes('e');
  const w = handle.includes('w');
  const right = node.x + node.width;
  const bottom = node.y + node.height;

  let left = node.x;
  let width = node.width;
  if (e) width = roundPx(right + dx) - node.x;
  if (w) {
    left = Math.min(roundPx(node.x + dx), right - 1);
    if (!LR) left = Math.max(left, floor);
    width = right - left;
  }
  width = Math.max(width, labelNeeds(node.label, node.kind, Math.max(1, width)).minWidth, MIN);
  if (w) left = right - width;

  const need = Math.max(labelNeeds(node.label, node.kind, width).height, MIN);
  let top = node.y;
  let height = node.height;
  if (s) height = roundPx(bottom + dy) - node.y;
  if (n) {
    top = Math.min(roundPx(node.y + dy), bottom - 1);
    if (LR) top = Math.max(top, floor);
    height = bottom - top;
  }
  height = Math.max(height, need);
  if (n) top = bottom - height;

  // Narrowing can raise the height need past a later lane's start edge. The pin can't go before it (`across` ≥ 0,
  // §5), so the block lands on that edge and its far edge moves instead: show where it will actually be.
  if (LR && n) top = Math.max(top, floor);
  if (!LR && w) left = Math.max(left, floor);

  return { x: left, y: top, width, height };
}

/** The across-the-flow start of a block's lane when it isn't the first lane (else −Infinity), for `resizeBox`. */
export function resizeFloor(layout: LayoutResult, laneId: string): number {
  const i = layout.lanes.findIndex((l) => l.id === laneId);
  if (i <= 0) return -Infinity;
  const lane = layout.lanes[i]!;
  return layout.direction === 'TB' ? lane.x : lane.y;
}
