// Lane commands (UI18–UI21). The toolbar's add-lane button; the rest of the lane features (header menu, drag to
// reorder, double-click to rename, delete dialog) are wired in by `installFeatures` (features/index.tsx).
import { icons } from '../chrome/icons';
import { installFeatures } from '../features';
import { promptAddLane } from '../features/laneActions';
import { editable, type Command } from './types';

installFeatures();

export const laneCommands: Command[] = [
  {
    id: 'add-lane',
    title: 'Add a lane',
    icon: icons.addLane,
    enabled: editable,
    run: (store) => promptAddLane(store),
  },
];
