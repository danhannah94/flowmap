// Snapping during a drag (UI39): a small session object that a drag gesture creates when it starts, asks for the
// snapped offset on every move and on release, and ends. It shows the `snap-guide` overlay while snapped.
//
//   const snapper = snapSession(store, subjectBoxAtStart, targets);   // or blockSnapSession(store, ids, lead)
//   move(ev):  const { dx, dy } = snapper.offset(rawDx, rawDy, ev.altKey);   // preview at (dx, dy)
//   up(ev):    const { dx, dy } = snapper.offset(rawDx, rawDy, ev.altKey); snapper.end(); drop at (dx, dy)
//   cancel():  snapper.end();
//
// Raw offsets are world px from where the drag started. Nudges (arrow keys) don't snap: they don't use this.
// Only type imports from the store, so drag code anywhere (canvas/gestures.ts included) can import it freely.
import type { Store } from '../store/store';
import { clearSnapGuides, showSnapGuides } from './guides';
import { snap, type SnapBox, type SnapSubject, type SnapTarget } from './snap';

export interface SnapSession {
  /** The snapped offset for a raw drag offset (world px); updates the guides. With `altKey`, the raw offset. */
  offset(dx: number, dy: number, altKey: boolean): { dx: number; dy: number };
  /** The drag is over (dropped or cancelled): hide the guides. */
  end(): void;
}

/**
 * A snap session for any dragged item: `subject` is where it was when the drag started (a box, or a point for a bend
 * point), `targets` what it may snap to (never the items being dragged).
 */
export function snapSession(store: Store, subject: SnapSubject, targets: readonly SnapTarget[]): SnapSession {
  return {
    offset(dx, dy, altKey) {
      const moved: SnapSubject = { ...subject, x: subject.x + dx, y: subject.y + dy };
      const r = snap(moved, targets, store.getState().viewport.zoom, altKey);
      showSnapGuides(r.guides);
      return { dx: dx + r.dx, dy: dy + r.dy };
    },
    end() {
      clearSnapGuides();
    },
  };
}

/**
 * UI10 + UI39: snapping for a drag of blocks. The block under the pointer (`lead`) decides the snap and every dragged
 * block moves with it; the targets are the other blocks.
 */
export function blockSnapSession(store: Store, ids: readonly string[], lead: string): SnapSession {
  const nodes = store.layout?.nodes ?? [];
  const dragged = new Set(ids);
  const leadNode = nodes.find((n) => n.id === lead);
  if (!leadNode) return snapSession(store, { x: 0, y: 0 }, []);
  const box = (n: SnapBox): SnapBox => ({ x: n.x, y: n.y, width: n.width, height: n.height });
  return snapSession(store, box(leadNode), nodes.filter((n) => !dragged.has(n.id)).map(box));
}
