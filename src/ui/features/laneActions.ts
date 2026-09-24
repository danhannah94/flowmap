// Lane actions (design.md §8.2 UI18–UI21): each turns a person's intent into one core operation through
// `store.apply` (one undo step). Transient UI state (the open lane menu, the delete dialog) lives in signals here.
import { LANE_HEADER } from '../../core/layout';
import {
  addLane, deleteLane, moveLane, renameLane, reorderLanes, setLaneLabel, type Files, type OpResult,
} from '../../core/ops';
import { UNASSIGNED } from '../../core/types';
import type { LayoutLane } from '../canvas/geometry';
import type { Rect } from '../canvas/viewport';
import type { Store } from '../store/store';
import { signal } from './signal';

/** The open lane menu: which lane, and the screen rect of its opener (the popover is placed against it). */
export const laneMenu = signal<{ lane: string; anchor: DOMRect } | null>(null);

/** The lane whose delete dialog is showing (UI21: a lane with blocks asks first). */
export const laneDeleteDialog = signal<string | null>(null);

/**
 * Check an operation against the current files first, so a refusal can be shown where the person is typing (the
 * `id-error` under the id editor) instead of as a toast. Returns the refusal, or applies the op and returns nothing.
 */
export function applyOrExplain<A extends unknown[]>(
  store: Store,
  op: (files: Files, ...args: A) => OpResult,
  ...args: A
): string | undefined {
  const reason = store.readOnlyReason();
  if (reason) return reason;
  const files = store.getState().files;
  if (!files) return 'The diagram is still loading';
  const r = op(files, ...args);
  if (!r.ok) return r.error;
  store.apply(op, ...args);
  return undefined;
}

function laneById(store: Store, id: string): LayoutLane | undefined {
  return store.layout?.lanes.find((l) => l.id === id);
}

/** Where an editor over a lane's header goes, in world coordinates (the header is a vertical strip for LR). */
function headerEditorAnchor(lane: LayoutLane, direction: 'LR' | 'TB'): Rect {
  if (direction === 'TB') {
    return { x: lane.x + 12, y: lane.y + 3, width: Math.max(lane.width - 24, 160), height: LANE_HEADER - 6 };
  }
  return { x: 12, y: Math.round(lane.y + lane.height / 2 - 17), width: 220, height: 34 };
}

/** Pan (never zoom) the least amount that brings a lane's band into view across the flow, if it isn't already. */
export function revealLane(store: Store, id: string): void {
  const lane = laneById(store, id);
  const layout = store.layout;
  const { viewport: v, viewportSize: size } = store.getState();
  if (!lane || !layout || size.width === 0) return;
  const margin = 40;
  const tb = layout.direction === 'TB';
  const s0 = tb ? lane.x * v.zoom + v.x : lane.y * v.zoom + v.y;
  const s1 = s0 + (tb ? lane.width : lane.height) * v.zoom;
  const hi = (tb ? size.width : size.height) - margin;
  let d = 0;
  if (s0 < margin || s1 - s0 > hi - margin) d = margin - s0; // off the start, or too big: align its start
  else if (s1 > hi) d = hi - s1;
  if (d) store.setViewport({ ...v, x: v.x + (tb ? d : 0), y: v.y + (tb ? 0 : d) });
}

/** UI18: the add-lane prompt (the centred `label-editor`). An empty label just closes it. */
export function promptAddLane(store: Store): void {
  if (store.readOnlyReason()) return;
  laneMenu.set(null);
  store.beginEdit({
    testid: 'label-editor',
    target: { kind: 'new-lane' },
    initial: '',
    anchor: null,
    placeholder: 'Name the new lane',
    variant: 'plain',
    commit: (text) => {
      if (text.trim() === '') return;
      const r = store.apply(addLane, text);
      if (!r.ok) return;
      store.select({ lane: r.id });
      revealLane(store, r.id);
    },
  });
}

/** UI19: edit a lane's label in place (double-click its header). */
export function editLaneLabel(store: Store, id: string): boolean {
  if (store.readOnlyReason()) return false;
  if (id === UNASSIGNED) {
    store.toast('Unassigned isn’t a lane in the file, so it can’t be renamed', 'info');
    return true;
  }
  const lane = laneById(store, id);
  const layout = store.layout;
  if (!lane || !layout) return false;
  laneMenu.set(null);
  store.beginEdit({
    testid: 'label-editor',
    target: { kind: 'lane', id },
    initial: lane.label,
    anchor: headerEditorAnchor(lane, layout.direction),
    variant: 'label',
    align: 'start',
    commit: (text) => {
      if (text === lane.label) return;
      store.apply(setLaneLabel, id, text);
    },
  });
  return true;
}

/** UI19: rename a lane's id (lane menu). A refusal keeps the editor open with the reason (`id-error`). */
export function editLaneId(store: Store, id: string): void {
  if (store.readOnlyReason()) return;
  const lane = laneById(store, id);
  const layout = store.layout;
  if (!lane || !layout || id === UNASSIGNED) return;
  laneMenu.set(null);
  store.beginEdit({
    testid: 'id-editor',
    target: { kind: 'lane', id },
    initial: id,
    anchor: headerEditorAnchor(lane, layout.direction),
    align: 'start',
    placeholder: `Id of the lane “${lane.label}”`,
    variant: 'plain',
    commit: (text) => {
      const next = text.trim();
      if (next === id) return;
      const wasSelected = store.getState().selection.lane === id;
      const err = applyOrExplain(store, renameLane, id, next);
      if (err) return err;
      if (wasSelected) store.select({ lane: next });
    },
  });
}

/** UI20: Move up / Move down (left / right for TB). The first lane up, or the last down, changes nothing. */
export function moveLaneBy(store: Store, id: string, dir: 'up' | 'down'): void {
  laneMenu.set(null);
  store.apply(moveLane, id, dir);
}

/** The lanes that can be reordered, in display order (Unassigned always shows last and is never listed, UI20). */
export function movableLanes(store: Store): LayoutLane[] {
  return (store.layout?.lanes ?? []).filter((l) => l.id !== UNASSIGNED);
}

/** The display order after moving lane `id` to slot `slot` (0 = first, n = last), or null if nothing changes. */
export function orderAfterMove(ids: readonly string[], id: string, slot: number): string[] | null {
  const from = ids.indexOf(id);
  if (from < 0) return null;
  const to = slot > from ? slot - 1 : slot;
  if (to === from) return null;
  const next = ids.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
}

/** UI20: drop a dragged lane header at `slot`: writes the config `lanes` list in the new order. */
export function dropLaneAt(store: Store, id: string, slot: number): void {
  const order = orderAfterMove(movableLanes(store).map((l) => l.id), id, slot);
  if (order) store.apply(reorderLanes, order);
}

/** The blocks declared in a lane (as laid out). */
export function blocksIn(store: Store, id: string): string[] {
  return (store.layout?.nodes ?? []).filter((n) => n.lane === id).map((n) => n.id);
}

/** UI21: an empty lane is deleted at once; a lane with blocks asks first (`lane-delete-dialog`). */
export function requestDeleteLane(store: Store, id: string): void {
  laneMenu.set(null);
  if (store.readOnlyReason() || id === UNASSIGNED) return;
  if (blocksIn(store, id).length === 0) {
    store.apply(deleteLane, id, { mode: 'empty' });
    return;
  }
  laneDeleteDialog.set(id);
}

export function deleteLaneMovingBlocks(store: Store, id: string, target: string): void {
  const r = store.apply(deleteLane, id, { mode: 'move', target });
  if (r.ok) laneDeleteDialog.set(null);
}

export function deleteLaneWithBlocks(store: Store, id: string): void {
  const r = store.apply(deleteLane, id, { mode: 'delete' });
  if (r.ok) laneDeleteDialog.set(null);
}
