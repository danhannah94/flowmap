// The line items of the context menu (design.md §8.2 UI40, UI36, UI37). Their slots, labels and "shows when" rules are
// in contextmenu/items.tsx (`add-bend` off a bend point, `remove-bend` on one, `reset-line` when the line is manual or
// has a side, `reset-label` when it has `label_at`); this module gives them their behaviour. The menu knows which bend
// point was right-clicked from `data-bend` (lineHandles.tsx).
import { addBend, removeBend, resetLabelAt, resetLine } from '../../core/ops';
import { registerMenuHandler, type MenuContext } from '../contextmenu/registry';
import type { Store } from '../store/store';

/** The current layout with its frame, as the shaping ops take it. */
const layoutOf = (store: Store) => store.getState().shown?.doc.layout ?? null;

/** Shaping edits write the layout file: refused while it has errors (UI31), like any other drag. */
const disabled = ({ store }: MenuContext<'line'>): string | null =>
  store.readOnlyReason() ?? (store.getState().derived?.layoutBroken ? 'The layout file has errors; fix it first' : null);

/** Register the line items' handlers (done on import; exported so a test or a later refactor can call it again). */
export function registerLineMenuItems(): void {
  // UI36: a point on the line nearest the right-click, in path order; kept even in a straight row.
  registerMenuHandler('line', 'add-bend', {
    disabled,
    run: ({ store, target, world }) => {
      const out = layoutOf(store);
      if (out) store.apply(addBend, out, target.id, { x: world.x, y: world.y });
    },
  });
  // UI36: on a bend point (`data-bend`): remove it; with none left the line is automatic again (its sides stay).
  registerMenuHandler('line', 'remove-bend', {
    disabled,
    run: ({ store, target }) => {
      const out = layoutOf(store);
      if (out && target.bend !== null) store.apply(removeBend, out, target.id, target.bend);
    },
  });
  // UI36: remove the line's `points` and both sides (routed automatically again); `label_at` stays.
  registerMenuHandler('line', 'reset-line', {
    disabled,
    run: ({ store, target }) => void store.apply(resetLine, target.id),
  });
  // UI37: remove `label_at`.
  registerMenuHandler('line', 'reset-label', {
    disabled,
    run: ({ store, target }) => void store.apply(resetLabelAt, target.id),
  });
}

registerLineMenuItems();
