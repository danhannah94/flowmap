// The built-in context-menu handlers (UI40): the items whose operations and commands already exist. The slots (names,
// labels, "shows when") are in items.tsx; registry.ts explains how the two halves fit.
import { deleteItems, unpinNodes } from '../../core/ops';
import { SHAPE_KINDS } from '../../core/types';
import { addBlockAtCorner, editNodeLabel, pinningBlocked } from '../actions';
import { editEdgeLabel } from '../canvas/connect';
import { duplicateBlocks } from '../clipboard';
import { changeBlockShape, editNodeId } from '../commands/blocks';
import { editTitle } from '../features/diagramActions';
import { editLaneId, editLaneLabel, moveLaneBy, requestDeleteLane } from '../features/laneActions';
import { useStoreState } from '../store/hooks';
import { MenuShapeOptions } from './controls';
import { registerMenuHandler, type MenuContext } from './registry';
import { isPinned } from './state';

// Block (UI8, UI9, UI7, UI13, UI12, UI14)
registerMenuHandler('block', 'edit-label', { run: ({ store, target }) => editNodeLabel(store, target.clicked) });
registerMenuHandler('block', 'rename-id', { run: ({ store, target }) => editNodeId(store, target.clicked) });
registerMenuHandler('block', 'shape', { Control: BlockShapeControl });
registerMenuHandler('block', 'duplicate', { run: ({ store, target }) => duplicateBlocks(store, target.ids) });
registerMenuHandler('block', 'unpin', {
  run: ({ store, target }) => {
    const s = store.getState();
    const ids = target.ids.filter((id) => isPinned(s, id));
    if (ids.length) store.apply(unpinNodes, ids);
  },
});
registerMenuHandler('block', 'delete', {
  run: ({ store, target }) => {
    const r = store.apply(deleteItems, { nodes: target.ids, edges: [] });
    if (r.ok) store.clearSelection();
  },
});

function BlockShapeControl({ ctx }: { ctx: MenuContext<'block'> }) {
  const id = ctx.target.clicked;
  const current = useStoreState((s) => s.shown?.layout?.nodes.find((n) => n.id === id)?.kind ?? null);
  return (
    <MenuShapeOptions
      current={current}
      onPick={(shape) => {
        ctx.close();
        changeBlockShape(ctx.store, id, shape);
      }}
    />
  );
}

// Line (UI17, UI14)
registerMenuHandler('line', 'edit-label', { run: ({ store, target }) => editEdgeLabel(store, target.id) });
registerMenuHandler('line', 'delete', {
  run: ({ store, target }) => {
    const r = store.apply(deleteItems, { nodes: [], edges: [target.id] });
    if (r.ok) store.clearSelection();
  },
});

// Title (UI22)
registerMenuHandler('title', 'edit-title', { run: ({ store }) => editTitle(store) });

// Canvas: add a block with its top-left at the click, pinned there, in the lane its centre falls in (UI40, UI43)
for (const kind of SHAPE_KINDS) {
  registerMenuHandler('canvas', `add-${kind}`, {
    run: ({ store, world }) => void addBlockAtCorner(store, kind, world),
    disabled: ({ store }) => pinningBlocked(store),
  });
}

// Lane header (UI19–UI21)
registerMenuHandler('lane', 'edit-label', { run: ({ store, target }) => void editLaneLabel(store, target.id) });
registerMenuHandler('lane', 'rename-id', { run: ({ store, target }) => editLaneId(store, target.id) });
registerMenuHandler('lane', 'move-up', { run: ({ store, target }) => moveLaneBy(store, target.id, 'up') });
registerMenuHandler('lane', 'move-down', { run: ({ store, target }) => moveLaneBy(store, target.id, 'down') });
registerMenuHandler('lane', 'delete', { run: ({ store, target }) => requestDeleteLane(store, target.id) });
