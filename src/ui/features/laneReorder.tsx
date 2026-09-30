// UI20: drag a lane header to reorder the lanes. A press on a header that moves past a few pixels starts a reorder
// (instead of panning, which the rest of the canvas still does); a plain click still selects the lane. While
// dragging, the lane being moved is outlined, a chip with its label follows the pointer, and a line shows where it
// will land. Unassigned can't be dragged, and nothing can be dropped after it (it always shows last).
import { UNASSIGNED } from '../../core/types';
import { editable } from '../commands/types';
import { backgroundGesture, extendsSelection, registerGesture, type Gesture } from '../canvas/gestures';
import type { Point } from '../canvas/viewport';
import { useStoreState } from '../store/hooks';
import type { Store } from '../store/store';
import { dropLaneAt, laneMenu, movableLanes, orderAfterMove } from './laneActions';
import { signal, useSignal } from './signal';

interface LaneDrag {
  id: string;
  label: string;
  /** Slot the lane would drop into (0 = before the first lane, n = after the last). */
  slot: number;
  /** Would dropping here change the order? */
  changes: boolean;
  /** Pointer, in px relative to the canvas element. */
  pointer: Point;
  /** The canvas element's screen rect when the drag started (the overlay is clipped to it). */
  canvas: { left: number; top: number; width: number; height: number };
}

export const laneDrag = signal<LaneDrag | null>(null);

const THRESHOLD = 4;

/** The slot for a world point: before the first lane whose middle is past the point, on the across axis. */
function slotAt(store: Store, world: Point): number {
  const lanes = movableLanes(store);
  const tb = store.layout?.direction === 'TB';
  const c = tb ? world.x : world.y;
  let slot = 0;
  for (const l of lanes) {
    const mid = tb ? l.x + l.width / 2 : l.y + l.height / 2;
    if (c > mid) slot++;
  }
  return slot;
}

export function registerLaneReorder(): void {
  registerGesture('lane', (hit, e, ctx) => {
    const fallback = backgroundGesture(hit, e, ctx);
    const { store } = ctx;
    const s = store.getState();
    if (!hit.header || hit.id === UNASSIGNED || extendsSelection(e) || s.tool.kind !== 'select' || !editable(s)) return fallback;
    const lane = store.layout?.lanes.find((l) => l.id === hit.id);
    const canvasEl = document.querySelector<HTMLElement>('[data-testid="canvas"]');
    if (!lane || !canvasEl) return fallback;
    const start = ctx.local(e);
    let dragging = false;
    const g: Gesture = {
      move(ev) {
        const p = ctx.local(ev);
        if (!dragging && Math.abs(p.x - start.x) <= THRESHOLD && Math.abs(p.y - start.y) <= THRESHOLD) return;
        if (!dragging) {
          dragging = true;
          laneMenu.set(null);
        }
        const slot = slotAt(store, ctx.world(ev));
        const ids = movableLanes(store).map((l) => l.id);
        const r = canvasEl.getBoundingClientRect();
        laneDrag.set({
          id: lane.id,
          label: lane.label,
          slot,
          changes: orderAfterMove(ids, lane.id, slot) !== null,
          pointer: p,
          canvas: { left: r.left, top: r.top, width: r.width, height: r.height },
        });
      },
      up(ev) {
        if (!dragging) {
          fallback?.up(ev); // a plain click: select the lane (or place an armed shape)
          return;
        }
        const d = laneDrag.get();
        laneDrag.set(null);
        if (d?.changes) dropLaneAt(store, d.id, d.slot);
      },
      cancel() {
        laneDrag.set(null);
        fallback?.cancel();
      },
    };
    return g;
  });
}

/** The drop indicator, the outline of the lane being moved, and the label chip under the pointer. */
export function LaneDragOverlay() {
  const drag = useSignal(laneDrag);
  const layout = useStoreState((s) => s.shown?.layout ?? null);
  const v = useStoreState((s) => s.viewport);
  if (!drag || !layout) return null;
  const tb = layout.direction === 'TB';
  const lanes = layout.lanes.filter((l) => l.id !== UNASSIGNED);
  const moving = lanes.find((l) => l.id === drag.id);
  const toScreen = (x: number, y: number) => ({ x: x * v.zoom + v.x, y: y * v.zoom + v.y });

  // The gap the lane would land in, in canvas px.
  let line: React.CSSProperties | null = null;
  if (drag.changes && lanes.length) {
    const k = drag.slot;
    const at = k < lanes.length ? (tb ? lanes[k]!.x : lanes[k]!.y) : tb ? lanes[k - 1]!.x + lanes[k - 1]!.width : lanes[k - 1]!.y + lanes[k - 1]!.height;
    const a = toScreen(tb ? at : 0, tb ? 0 : at);
    const b = toScreen(tb ? at : layout.width, tb ? layout.height : at);
    line = tb
      ? { left: a.x - 2, top: a.y, width: 4, height: b.y - a.y }
      : { left: a.x, top: a.y - 2, width: b.x - a.x, height: 4 };
  }
  let outline: React.CSSProperties | null = null;
  if (moving) {
    const a = toScreen(moving.x, moving.y);
    outline = { left: a.x, top: a.y, width: moving.width * v.zoom, height: moving.height * v.zoom };
  }
  return (
    <div
      className="fm-lane-drag-layer"
      style={{ left: drag.canvas.left, top: drag.canvas.top, width: drag.canvas.width, height: drag.canvas.height }}
      aria-hidden="true"
    >
      <style>{'body, body * { cursor: grabbing !important; }'}</style>
      {outline ? <div className="fm-lane-drag-source" style={outline} /> : null}
      {line ? <div className={`fm-lane-drop-line fm-${tb ? 'TB' : 'LR'}`} data-testid="lane-drop-indicator" style={line} /> : null}
      <div className="fm-lane-drag-chip" style={{ left: drag.pointer.x + 14, top: drag.pointer.y + 12 }}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          {[2.5, 6, 9.5].map((y) => (
            <g key={y}>
              <circle cx="4" cy={y} r="1.1" fill="currentColor" />
              <circle cx="8" cy={y} r="1.1" fill="currentColor" />
            </g>
          ))}
        </svg>
        {drag.label}
      </div>
    </div>
  );
}
