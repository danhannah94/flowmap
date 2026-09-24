// Foundation commands: undo/redo (UI28), view (fit, theme, zoom), selection (UI10, UI33), label editing (UI8).
import { editNodeLabel, nudgeSelection } from '../actions';
import { icons } from '../chrome/icons';
import { editable, type Command } from './types';

const nudge = (id: string, key: string, dx: number, dy: number): Command => ({
  id,
  title: `Nudge ${key.replace('Arrow', '').toLowerCase()} 10 px`,
  keys: [key],
  enabled: (s) => editable(s) && s.selection.nodes.length > 0,
  run: (store) => nudgeSelection(store, dx, dy),
});

export const coreCommands: Command[] = [
  {
    id: 'undo',
    title: 'Undo',
    icon: icons.undo,
    keys: ['mod+z'],
    enabled: (_s, store) => store.canUndo,
    run: (store) => store.undo(),
  },
  {
    id: 'redo',
    title: 'Redo',
    icon: icons.redo,
    keys: ['shift+mod+z', 'mod+y'],
    enabled: (_s, store) => store.canRedo,
    run: (store) => store.redo(),
  },
  {
    id: 'fit',
    title: 'Fit to screen',
    icon: icons.fit,
    keys: ['shift+1'],
    enabled: (s) => !!s.shown?.layout,
    run: (store) => store.fit(),
  },
  {
    id: 'zoom-in',
    title: 'Zoom in',
    icon: icons.zoomIn,
    keys: ['mod+=', 'mod++'],
    enabled: (s) => !!s.shown?.layout,
    run: (store) => store.zoomBy(1.2),
  },
  {
    id: 'zoom-out',
    title: 'Zoom out',
    icon: icons.zoomOut,
    keys: ['mod+-'],
    enabled: (s) => !!s.shown?.layout,
    run: (store) => store.zoomBy(1 / 1.2),
  },
  {
    id: 'theme-toggle',
    title: 'Switch light / dark',
    enabled: () => true,
    run: (store) => store.toggleTheme(),
  },
  {
    id: 'select-all',
    title: 'Select everything',
    keys: ['mod+a'],
    enabled: (s) => !!s.shown?.layout,
    run: (store) => store.selectAll(),
  },
  {
    id: 'escape',
    title: 'Cancel / clear the selection',
    keys: ['Escape'],
    enabled: () => true,
    run: (store) => {
      const s = store.getState();
      if (s.tool.kind !== 'select') store.setTool({ kind: 'select' });
      else store.clearSelection();
    },
  },
  {
    id: 'edit-label',
    title: 'Edit the selected block’s label',
    keys: ['Enter'],
    enabled: (s) => editable(s) && s.selection.nodes.length === 1,
    run: (store) => editNodeLabel(store, store.getState().selection.nodes[0]!),
  },
  nudge('nudge-left', 'ArrowLeft', -10, 0),
  nudge('nudge-right', 'ArrowRight', 10, 0),
  nudge('nudge-up', 'ArrowUp', 0, -10),
  nudge('nudge-down', 'ArrowDown', 0, 10),
];
