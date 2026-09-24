// UI34 resize: the live preview's geometry. While a handle is dragged the canvas draws the block at the box this
// returns (and shows it pinned, A6), and on release `resizeNode` (src/core/ops) writes it. Both use the core's
// `resizedBox`, so what you see while dragging is exactly what lands: the opposite edge or corner stays put, only the
// moved edge is rounded to a whole pixel (halves toward −∞), the width stops at the label's narrowest width and the
// height at what the label needs at that width (§6 L9 "needs"), never below 40, and across the flow a top (LR) or
// left (TB) edge stops at a later lane's start edge. `resize.test.ts` checks this against the operation and the
// layout that follows it.
import { resizedBox, type ResizableBlock, type ResizeHandle } from '../../core/ops';
import type { LayoutResult } from '../../core/types';
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

export type ResizableNode = ResizableBlock;

/**
 * The box a block would have after dragging `handle` by (dx, dy) diagram px: `resizedBox`, the very function
 * `resizeNode` sizes and places the block with. `floor` is where the block's lane starts across the flow when that lane
 * isn't the first (a top edge in LR, a left edge in TB can't go before it), else −Infinity (`resizeFloor`).
 */
export function resizeBox(
  node: ResizableNode, handle: ResizeHandle, dx: number, dy: number, LR: boolean, floor: number,
): Rect {
  return resizedBox(node, handle, { dx, dy }, LR, floor);
}

/** The across-the-flow start of a block's lane when it isn't the first lane (else −Infinity), for `resizeBox`. */
export function resizeFloor(layout: LayoutResult, laneId: string): number {
  const i = layout.lanes.findIndex((l) => l.id === laneId);
  if (i <= 0) return -Infinity;
  const lane = layout.lanes[i]!;
  return layout.direction === 'TB' ? lane.x : lane.y;
}
