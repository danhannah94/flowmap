// Lane resizing, drawn into the lanes layer through `setLaneLayerExtras` (so it sits above the lane bands and below
// lines and blocks; a lane-free diagram, A4, has no bands and gets none of it):
// - A8 lane size: a drag handle on each lane's far edge across the flow (the bottom of its band for LR, the right for
//   TB), Unassigned's included. Dragging it sets how thick the lane is; it stops at what the lane's content needs (the
//   layout's `laneNeeds`), and dragging it back to there removes the stored size. A double-click on the handle (or
//   "Reset size" in the lane menu) removes it too.
// - A13 lane length: one drag handle on the lanes' far end along the flow (the right edge of the pool for LR, the
//   bottom for TB), spanning every lane, since all lanes share one length. Dragging it sets that length; it stops at
//   what the content needs (`laneLengthNeed`), and dragging it back to there removes the stored length. A double-click
//   on it (or "Reset length" in any lane's menu) removes it too.
//
// Like a block's resize handles (UI34), each drag is the handle's own: it takes the pointer (the canvas never sees the
// press), shows the new edge and the value while dragging, and on release writes it with one operation (`resizeLane`,
// `resizeLaneLength`), one undo step. Escape cancels. `<html data-fm-lane-resizing>` keeps the resize cursor
// everywhere meanwhile.
import { useEffect, useRef } from 'react';
import { LANE_HEADER } from '../../core/layout';
import { resizeLane, resizeLaneLength } from '../../core/ops';
import type { Direction, LayoutResult } from '../../core/types';
import { pinningBlocked } from '../actions';
import type { LayoutLane } from '../canvas/geometry';
import { useStore } from '../store/hooks';
import type { Store } from '../store/store';
import { laneMenu, resetLaneLengthOf, resetLaneSizeOf } from './laneActions';
import { signal, useSignal } from './signal';

/** The lane being resized and its thickness across the flow as it would land (world px), or null. */
export const laneResize = signal<{ id: string; size: number } | null>(null);
/** A13: while the lanes' far end is dragged, their length along the flow as it would land (world px), or null. */
export const laneLengthResize = signal<number | null>(null);

/** Screen px the pointer must move before a press on a handle becomes a resize. */
const THRESHOLD = 2;

/** The handles, and while dragging the new edge with the value. */
export function LaneResizeLayer({ layout }: { layout: LayoutResult }) {
  const active = useSignal(laneResize);
  const length = useSignal(laneLengthResize);
  const lane = active ? layout.lanes.find((l) => l.id === active.id) : undefined;
  return (
    <>
      <LaneLengthHandle layout={layout} />
      {layout.lanes.map((l) => <LaneResizeHandle key={l.id} lane={l} direction={layout.direction} />)}
      {active && lane ? <ResizePreview lane={lane} size={active.size} layout={layout} /> : null}
      {length !== null ? <LengthPreview length={length} layout={layout} /> : null}
    </>
  );
}

/** A handle's pointer wiring: a press starts `start`'s drag; a double-click runs `reset`. */
function useHandle(start: (down: PointerEvent, el: HTMLElement) => () => void, reset: () => void) {
  const store = useStore();
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  return {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // the canvas would pan
      e.preventDefault();
      laneMenu.set(null);
      cleanup.current?.();
      cleanup.current = start(e.nativeEvent, e.currentTarget);
    },
    onDoubleClick: (e: React.MouseEvent<HTMLDivElement>) => {
      // Not a double-click on the lane's header or band (no label editor): fit to the content.
      e.stopPropagation();
      e.preventDefault();
      if (!pinningBlocked(store)) reset();
    },
  };
}

function LaneResizeHandle({ lane, direction }: { lane: LayoutLane; direction: Direction }) {
  const store = useStore();
  const handlers = useHandle(
    (down, el) => startLaneResize(store, lane.id, down, el),
    () => resetLaneSizeOf(store, lane.id),
  );
  const tb = direction === 'TB';
  // Along the flow it starts after the header strip, which keeps the header's own controls (the lane menu sits at
  // the far end of a TB header, right on this edge).
  const style = tb
    ? { left: lane.x + lane.width, top: lane.y + LANE_HEADER, height: lane.height - LANE_HEADER }
    : { left: lane.x + LANE_HEADER, top: lane.y + lane.height, width: lane.width - LANE_HEADER };
  return (
    <div
      className={`fm-lane-resize fm-${direction}`}
      data-lane-resize={lane.id}
      title="Drag to resize the lane; double-click to fit it to its blocks"
      style={style}
      {...handlers}
    />
  );
}

/** A13: the handle on the lanes' far end along the flow, across every lane (the pool's right edge for LR, bottom for TB). */
function LaneLengthHandle({ layout }: { layout: LayoutResult }) {
  const store = useStore();
  const handlers = useHandle((down, el) => startLengthResize(store, down, el), () => resetLaneLengthOf(store));
  const tb = layout.direction === 'TB';
  const first = layout.lanes[0];
  const last = layout.lanes[layout.lanes.length - 1];
  if (!first || !last) return null;
  const style = tb
    ? { left: first.x, top: layout.height, width: last.x + last.width - first.x }
    : { left: layout.width, top: first.y, height: last.y + last.height - first.y };
  return (
    <div
      className={`fm-lane-length-resize fm-${layout.direction}`}
      data-lane-length-resize=""
      title="Drag to lengthen the lanes; double-click to fit them to their blocks"
      style={style}
      {...handlers}
    />
  );
}

/** The lane's new extent, its far edge across the whole diagram, and the size, while dragging. */
function ResizePreview({ lane, size, layout }: { lane: LayoutLane; size: number; layout: LayoutResult }) {
  const tb = layout.direction === 'TB';
  const band = tb
    ? { left: lane.x, top: 0, width: size, height: layout.height }
    : { left: 0, top: lane.y, width: layout.width, height: size };
  return (
    <div className={`fm-lane-resize-preview fm-${layout.direction}`} data-lane-resize-preview={lane.id} style={band}>
      <span className="fm-lane-resize-readout">{size}</span>
    </div>
  );
}

/** A13: the lanes' new far end along the flow, across every lane, and the length, while dragging. */
function LengthPreview({ length, layout }: { length: number; layout: LayoutResult }) {
  const tb = layout.direction === 'TB';
  const pool = tb
    ? { left: 0, top: 0, width: layout.width, height: length }
    : { left: 0, top: 0, width: length, height: layout.height };
  return (
    <div className={`fm-lane-length-preview fm-${layout.direction}`} data-lane-length-preview="" style={pool}>
      <span className="fm-lane-resize-readout">{length}</span>
    </div>
  );
}

/**
 * Run one lane-resize drag from a press on lane `id`'s handle. Returns a function that ends it (without writing), for
 * when the handle goes away mid-drag.
 */
function startLaneResize(store: Store, id: string, down: PointerEvent, el: HTMLElement): () => void {
  const layout = store.layout;
  const lane = layout?.lanes.find((l) => l.id === id);
  if (!layout || !lane) return () => {};
  const tb = layout.direction === 'TB';
  const start = tb ? lane.width : lane.height;
  return startEdgeDrag(store, down, el, {
    axis: tb ? 'x' : 'y',
    start,
    floor: store.getState().derived?.doc.layout?.laneNeeds[id] ?? start,
    preview: (size) => laneResize.set(size === null ? null : { id, size }),
    commit: (size) => store.apply(resizeLane, id, size),
  });
}

/** A13: run one drag of the lanes' far end along the flow. Returns a function that ends it (without writing). */
function startLengthResize(store: Store, down: PointerEvent, el: HTMLElement): () => void {
  const layout = store.layout;
  if (!layout) return () => {};
  const tb = layout.direction === 'TB';
  const start = tb ? layout.height : layout.width;
  return startEdgeDrag(store, down, el, {
    axis: tb ? 'y' : 'x',
    start,
    floor: store.getState().derived?.doc.layout?.laneLengthNeed ?? start,
    preview: (length) => laneLengthResize.set(length),
    commit: (length) => store.apply(resizeLaneLength, length),
  });
}

interface EdgeDrag {
  /** The screen axis the edge moves along. */
  axis: 'x' | 'y';
  /** The value (world px) before the drag. */
  start: number;
  /** The smallest value the drag can reach: what the content needs. */
  floor: number;
  /** Show the value as it would land (null: the drag is over). */
  preview: (value: number | null) => void;
  /** Write the value (called on release when it changed). */
  commit: (value: number) => void;
}

/** One drag of an edge handle: world px moved along `axis` change `start`, never below `floor`. */
function startEdgeDrag(store: Store, down: PointerEvent, el: HTMLElement, drag: EdgeDrag): () => void {
  const canvas = el.closest<HTMLElement>('[data-testid="canvas"]');
  if (!canvas) return () => {};
  const blocked = pinningBlocked(store);
  const rect = canvas.getBoundingClientRect();
  const at = (e: { clientX: number; clientY: number }) => {
    const v = store.getState().viewport;
    return drag.axis === 'x' ? (e.clientX - rect.left - v.x) / v.zoom : (e.clientY - rect.top - v.y) / v.zoom;
  };
  const from = at(down);
  const valueAt = (e: { clientX: number; clientY: number }) => Math.max(drag.floor, Math.round(drag.start + at(e) - from));
  let resizing = false;
  let done = false;

  try {
    el.setPointerCapture(down.pointerId);
  } catch {
    /* a synthetic pointer can't be captured; moves still reach the window listener */
  }

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    if (!resizing) {
      if (Math.abs(e.clientX - down.clientX) <= THRESHOLD && Math.abs(e.clientY - down.clientY) <= THRESHOLD) return;
      if (blocked) return;
      resizing = true;
      document.documentElement.dataset.fmLaneResizing = drag.axis === 'x' ? 'ew' : 'ns';
    }
    drag.preview(valueAt(e));
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    if (!resizing) {
      end();
      const moved = Math.abs(e.clientX - down.clientX) > THRESHOLD || Math.abs(e.clientY - down.clientY) > THRESHOLD;
      if (blocked && moved) store.toast(blocked, 'info');
      return;
    }
    // Write first, then drop the preview, so the edge never flashes back to where it was for a frame.
    const value = valueAt(e);
    if (value !== drag.start) drag.commit(value);
    end();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    end();
  };
  const onCancel = (e: PointerEvent) => {
    if (e.pointerId === down.pointerId) end();
  };
  function end() {
    if (done) return;
    done = true;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
    delete document.documentElement.dataset.fmLaneResizing;
    drag.preview(null);
    try {
      el.releasePointerCapture(down.pointerId);
    } catch {
      /* already released */
    }
  }
  // On the window (capture): the handle may re-render mid-drag, and moves must never reach the canvas.
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('keydown', onKey, true);
  return end;
}
