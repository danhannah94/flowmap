// Turning what the person sees (diagram coordinates, as in `flowmap layout` and the UI canvas at zoom 1) into what the
// layout file stores (§5), and back. Operations that take a position or read the drawn diagram take the current
// layout as a `LayoutArg`: the layout function's output (`LayoutOutput`, whose `translation` is the frame, §6), or a
// bare `LayoutResult`, in which case the frame is worked out from the files exactly as the layout function does
// (`Ctx.frame`: the pins and bend points that apply).
import type { LayoutOutput, Translation } from '../layout';
import { roundPx } from '../layoutfile';
import type { LayoutResult, Pin, XY } from '../types';
import { UNASSIGNED } from '../types';
import { refuse, type Ctx } from './context';

/** The current layout: `loadDocument(...).layout` (preferred: it carries the frame) or its `result`. */
export type LayoutArg = LayoutResult | LayoutOutput;

export interface View {
  result: LayoutResult;
  frame: Translation;
}

/** The layout and its frame (§6). */
export function viewOf(ctx: Ctx, layout: LayoutArg): View {
  if (!layout || typeof layout !== 'object') return refuse('This change needs the current layout');
  if ('result' in layout) return { result: layout.result, frame: layout.translation };
  return { result: layout, frame: ctx.frame() };
}

export type LaneBox = LayoutResult['lanes'][number];

/** Where a lane's band starts across the flow (y for `LR`, x for `TB`). */
export function bandStart(result: Pick<LayoutResult, 'direction'>, lane: Pick<LaneBox, 'x' | 'y'>): number {
  return result.direction === 'TB' ? lane.x : lane.y;
}

/** Where a lane's band ends across the flow (exclusive). */
export function bandEnd(result: Pick<LayoutResult, 'direction'>, lane: LaneBox): number {
  return result.direction === 'TB' ? lane.x + lane.width : lane.y + lane.height;
}

/**
 * The stored form of a block's top-left corner at diagram coordinates `x, y` in `lane` (§5): `along` less T, `across`
 * from the lane's zero line (its start edge; for the first lane, U after it). Unrounded; `pinFromDrop` rounds and keeps
 * `across` ≥ 0 outside the first lane. A lane that isn't showing (Unassigned, about to appear) starts after the last
 * lane.
 */
export function storedCorner(view: View, lane: string, x: number, y: number): { along: number; across: number } {
  const { result, frame } = view;
  const i = result.lanes.findIndex((l) => l.id === lane);
  const LR = result.direction !== 'TB';
  let start: number;
  if (i >= 0) start = bandStart(result, result.lanes[i]!) + (i === 0 ? frame.across : 0);
  else if (result.lanes.length === 0) start = frame.across; // lane-free and empty: Unassigned is the first lane
  else start = LR ? result.height : result.width;
  return LR ? { along: x - frame.along, across: y - start } : { along: y - frame.along, across: x - start };
}

/**
 * UI43 / UI11 / A4: the lane a block whose centre is at `cx, cy` is dropped into. The band containing the centre across
 * the flow (each band includes its start edge and excludes its end edge); before the first lane, the first lane; after
 * the last lane, Unassigned (A4c; a lane-free diagram has only Unassigned). Along the flow nothing decides the lane
 * (R9).
 */
export function blockLaneAt(result: Pick<LayoutResult, 'direction' | 'lanes'>, cx: number, cy: number): string {
  const lanes = result.lanes;
  if (lanes.length === 0) return UNASSIGNED;
  const c = result.direction === 'TB' ? cx : cy;
  if (c < bandStart(result, lanes[0]!)) return lanes[0]!.id;
  for (const l of lanes) if (c < bandEnd(result, l)) return l.id;
  return UNASSIGNED;
}

/**
 * A19 (UI11 with groups): the group a block whose centre is at `cx, cy` joins in `lane`: the innermost group of that
 * lane whose box (as drawn in `result`) contains the centre (each box includes its start edges and excludes its end
 * edges), or null for the lane itself. Where boxes of the same depth overlap (pinned members), the later one in file
 * order wins.
 */
export function blockGroupAt(result: Pick<LayoutResult, 'groups'>, lane: string, cx: number, cy: number): string | null {
  const groups = result.groups ?? [];
  const depth = new Map<string, number>();
  for (const g of groups) depth.set(g.id, g.parent === null ? 1 : (depth.get(g.parent) ?? 0) + 1);
  let best: string | null = null;
  let bestDepth = 0;
  for (const g of groups) {
    if (g.lane !== lane) continue;
    if (cx < g.x || cx >= g.x + g.width || cy < g.y || cy >= g.y + g.height) continue;
    const d = depth.get(g.id)!;
    if (d >= bestDepth) {
      best = g.id;
      bestDepth = d;
    }
  }
  return best;
}

/**
 * A note's or the title's stored position from where it is drawn (§5): x and y less the frame on their axis (T on the
 * flow axis, U across), rounded to whole pixels (halves toward −∞, as UI10).
 */
export function storedXY(ctx: Ctx, view: View | Translation, at: XY): XY {
  checkXY(at);
  const frame = 'frame' in view ? view.frame : view;
  const LR = ctx.original.direction !== 'TB';
  const tx = LR ? frame.along : frame.across;
  const ty = LR ? frame.across : frame.along;
  return { x: roundPx(at.x - tx), y: roundPx(at.y - ty) };
}

export function checkXY(at: XY): void {
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) refuse('A position needs a finite x and y');
}

export function samePin(a: Pin, b: Pin): boolean {
  return a.lane === b.lane && a.along === b.along && a.across === b.across;
}
