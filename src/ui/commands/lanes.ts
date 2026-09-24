// Lane commands (UI18–UI21). Placeholder until the lanes feature lands: replace with the real command (same id).
// The lane header menu hooks in through `setLaneHeaderExtras` (canvas/LanesLayer.tsx).
import { icons } from '../chrome/icons';
import { placeholder, type Command } from './types';

export const laneCommands: Command[] = [placeholder('add-lane', 'Add a lane', icons.addLane)];
