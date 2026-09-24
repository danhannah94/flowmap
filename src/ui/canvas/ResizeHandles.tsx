// UI34 Resize: the eight handles on the one selected block (§8.3 `data-resize`), the drag that resizes it with a live
// preview, and "Reset size" in the block's context menu (UI40). (The inspector's size row is chrome/evidence/BlockSize.)
//
// - Handles sit on the block's box: corners on the corners, sides on the side midpoints, above the connection handles
//   so a press on the box edge resizes. Their hit areas keep a constant size on screen (like the connection handles,
//   from the canvas's `--zoom`), capped in world px so they never swallow a small block zoomed far out.
// - The drag is the handle's own: it takes the pointer (the canvas never sees the press), draws the block at
//   `resizeBox` while you drag (exactly what will land), and on release writes it with `resizeNode`, one undo step.
//   Escape cancels. Wheel zoom and pan keep working mid-drag: the pointer is converted with the current viewport.
// - While resizing, `<html data-fm-resizing="<handle>">` keeps the handle's cursor everywhere and hides the
//   connection handles.
import { useEffect, useRef } from 'react';
import { resetSize, resizeNode } from '../../core/ops';
import { pinningBlocked } from '../actions';
import { registerMenuHandler } from '../contextmenu/registry';
import { signal, useSignal } from '../features/signal';
import { useStore } from '../store/hooks';
import type { Store } from '../store/store';
import type { LayoutNode } from './geometry';
import { RESIZE_CURSOR, RESIZE_HANDLES, resizeBox, resizeFloor, type ResizeHandle } from './resize';
import type { Rect } from './viewport';
import './resize.css';

/** The block being resized and the box it is drawn at (world px), or null. */
export interface ResizePreview {
  id: string;
  handle: ResizeHandle;
  box: Rect;
}

export const resizePreview = signal<ResizePreview | null>(null);

/** The preview box for a block, if it is the one being resized (NodesLayer draws it there). */
export function useResizePreview(): ResizePreview | null {
  return useSignal(resizePreview);
}

/** Screen px the pointer must move before a press on a handle becomes a resize. */
const THRESHOLD = 2;

/** The eight handles, inside the node element (§8.3). `node` is the box as drawn (the preview while resizing). */
export function ResizeHandles({ node }: { node: LayoutNode }) {
  const store = useStore();
  const active = useSignal(resizePreview);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  return (
    <div className="fm-resize" data-resizing={active?.id === node.id ? active.handle : undefined} aria-hidden="true">
      {RESIZE_HANDLES.map((h) => (
        <div
          key={h}
          className={`fm-resize-h fm-resize-${h.length === 2 ? 'corner' : 'side'} fm-resize-${h}`}
          data-resize={h}
          data-active={active?.id === node.id && active.handle === h ? 'true' : undefined}
          style={{ cursor: RESIZE_CURSOR[h] }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation(); // the canvas would start a block drag
            e.preventDefault();
            cleanup.current?.();
            cleanup.current = startResize(store, node.id, h, e.nativeEvent, e.currentTarget);
          }}
          onDoubleClick={(e) => {
            // A double-click on a handle isn't a double-click on the block (no label editor).
            e.stopPropagation();
            e.preventDefault();
          }}
        />
      ))}
      {active?.id === node.id ? <SizeReadout width={active.box.width} height={active.box.height} /> : null}
    </div>
  );
}

/** "220 × 90" under the block while resizing, at a constant size on screen. */
function SizeReadout({ width, height }: { width: number; height: number }) {
  return (
    <div className="fm-resize-readout">
      {width} × {height}
    </div>
  );
}

/**
 * Run one resize drag from a press on `handle` of block `id`. Returns a function that ends it (without writing), for
 * when the handles go away mid-drag.
 */
function startResize(store: Store, id: string, handle: ResizeHandle, down: PointerEvent, el: HTMLElement): () => void {
  const layout = store.layout;
  const node = layout?.nodes.find((n) => n.id === id);
  const canvas = el.closest<HTMLElement>('[data-testid="canvas"]');
  if (!layout || !node || !canvas) return () => {};
  const blocked = pinningBlocked(store);
  const LR = layout.direction !== 'TB';
  const floor = resizeFloor(layout, node.lane);
  const rect = canvas.getBoundingClientRect();
  const world = (e: { clientX: number; clientY: number }) => {
    const v = store.getState().viewport;
    return { x: (e.clientX - rect.left - v.x) / v.zoom, y: (e.clientY - rect.top - v.y) / v.zoom };
  };
  const start = world(down);
  let resizing = false;
  let done = false;

  try {
    el.setPointerCapture(down.pointerId);
  } catch {
    /* a synthetic pointer can't be captured; moves still reach the window listener */
  }

  const deltaOf = (e: { clientX: number; clientY: number }) => {
    const p = world(e);
    return { dx: p.x - start.x, dy: p.y - start.y };
  };
  const show = (e: PointerEvent) => {
    const { dx, dy } = deltaOf(e);
    resizePreview.set({ id, handle, box: resizeBox(node, handle, dx, dy, LR, floor) });
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    if (!resizing) {
      if (Math.abs(e.clientX - down.clientX) <= THRESHOLD && Math.abs(e.clientY - down.clientY) <= THRESHOLD) return;
      if (blocked) return;
      resizing = true;
      document.documentElement.dataset.fmResizing = handle;
    }
    show(e);
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    if (!resizing) {
      end();
      const moved = Math.abs(e.clientX - down.clientX) > THRESHOLD || Math.abs(e.clientY - down.clientY) > THRESHOLD;
      if (blocked && moved) store.toast(blocked, 'info');
      return;
    }
    // Write first, then drop the preview, so the block never flashes back to its old box for a frame.
    const current = store.getState().derived?.doc.layout ?? store.layout;
    if (current) store.apply(resizeNode, current, id, handle, deltaOf(e));
    end();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    end();
  };
  function end() {
    if (done) return;
    done = true;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
    delete document.documentElement.dataset.fmResizing;
    resizePreview.set(null);
    try {
      el.releasePointerCapture(down.pointerId);
    } catch {
      /* already released */
    }
  }
  const onCancel = (e: PointerEvent) => {
    if (e.pointerId === down.pointerId) end();
  };
  // On the window (capture): the handle may re-render or leave the DOM mid-drag, and moves must never reach the canvas.
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('keydown', onKey, true);
  return end;
}

// ---- "Reset size" (UI34, UI40: on every selected block that has a stored size) -----------------------------------

registerMenuHandler('block', 'reset-size', {
  run: ({ store, target }) => {
    const sizes = store.getState().derived?.doc.sizes ?? {};
    const ids = target.ids.filter((id) => sizes[id]);
    if (ids.length) store.apply(resetSize, ids);
  },
  disabled: ({ store }) => pinningBlocked(store),
});
