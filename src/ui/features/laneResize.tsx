// A8 lane size: a drag handle on each lane's far edge across the flow (the bottom of its band for LR, the right for
// TB), Unassigned's included. Dragging it sets how thick the lane is; it stops at what the lane's content needs (the
// layout's `laneNeeds`), and dragging it back to there removes the stored size. A double-click on the handle (or
// "Reset size" in the lane menu) removes it too. Rendered into the lanes layer through `setLaneLayerExtras`, so it
// sits above the lane bands and below lines and blocks.
//
// Like a block's resize handles (UI34), the drag is the handle's own: it takes the pointer (the canvas never sees the
// press), shows the new edge and the size while dragging, and on release writes it with `resizeLane`, one undo step.
// Escape cancels. `<html data-fm-lane-resizing>` keeps the resize cursor everywhere meanwhile.
import { useEffect, useRef } from 'react';
import { LANE_HEADER } from '../../core/layout';
import { resizeLane } from '../../core/ops';
import type { Direction, LayoutResult } from '../../core/types';
import { pinningBlocked } from '../actions';
import type { LayoutLane } from '../canvas/geometry';
import { useStore } from '../store/hooks';
import type { Store } from '../store/store';
import { laneMenu, resetLaneSizeOf } from './laneActions';
import { signal, useSignal } from './signal';

/** The lane being resized and its thickness across the flow as it would land (world px), or null. */
export const laneResize = signal<{ id: string; size: number } | null>(null);

/** Screen px the pointer must move before a press on the handle becomes a resize. */
const THRESHOLD = 2;

/** The handles, and while dragging the new far edge with the size. */
export function LaneResizeLayer({ layout }: { layout: LayoutResult }) {
  const active = useSignal(laneResize);
  const lane = active ? layout.lanes.find((l) => l.id === active.id) : undefined;
  return (
    <>
      {layout.lanes.map((l) => <LaneResizeHandle key={l.id} lane={l} direction={layout.direction} />)}
      {active && lane ? <ResizePreview lane={lane} size={active.size} layout={layout} /> : null}
    </>
  );
}

function LaneResizeHandle({ lane, direction }: { lane: LayoutLane; direction: Direction }) {
  const store = useStore();
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
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
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation(); // the canvas would pan
        e.preventDefault();
        laneMenu.set(null);
        cleanup.current?.();
        cleanup.current = startLaneResize(store, lane.id, e.nativeEvent, e.currentTarget);
      }}
      onDoubleClick={(e) => {
        // Not a double-click on the lane's header or band (no label editor): fit the lane to its blocks.
        e.stopPropagation();
        e.preventDefault();
        if (!pinningBlocked(store)) resetLaneSizeOf(store, lane.id);
      }}
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

/**
 * Run one lane-resize drag from a press on lane `id`'s handle. Returns a function that ends it (without writing), for
 * when the handle goes away mid-drag.
 */
function startLaneResize(store: Store, id: string, down: PointerEvent, el: HTMLElement): () => void {
  const layout = store.layout;
  const lane = layout?.lanes.find((l) => l.id === id);
  const canvas = el.closest<HTMLElement>('[data-testid="canvas"]');
  if (!layout || !lane || !canvas) return () => {};
  const blocked = pinningBlocked(store);
  const tb = layout.direction === 'TB';
  const start = tb ? lane.width : lane.height;
  const floor = store.getState().derived?.doc.layout?.laneNeeds[id] ?? start;
  const rect = canvas.getBoundingClientRect();
  const across = (e: { clientX: number; clientY: number }) => {
    const v = store.getState().viewport;
    return tb ? (e.clientX - rect.left - v.x) / v.zoom : (e.clientY - rect.top - v.y) / v.zoom;
  };
  const from = across(down);
  const sizeAt = (e: { clientX: number; clientY: number }) => Math.max(floor, Math.round(start + across(e) - from));
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
      document.documentElement.dataset.fmLaneResizing = tb ? 'TB' : 'LR';
    }
    laneResize.set({ id, size: sizeAt(e) });
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    if (!resizing) {
      end();
      const moved = Math.abs(e.clientX - down.clientX) > THRESHOLD || Math.abs(e.clientY - down.clientY) > THRESHOLD;
      if (blocked && moved) store.toast(blocked, 'info');
      return;
    }
    // Write first, then drop the preview, so the lane never flashes back to its old size for a frame.
    const size = sizeAt(e);
    if (size !== start) store.apply(resizeLane, id, size);
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
    laneResize.set(null);
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
