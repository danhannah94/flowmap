// Block and line commands (UI12–UI15). Placeholders until the blocks/lines feature lands: replace each entry with
// a real command (same id). Keys to add then: Delete/Backspace (delete), mod+d (duplicate).
import { icons } from '../chrome/icons';
import { placeholder, type Command } from './types';

export const blockCommands: Command[] = [
  placeholder('connect', 'Connect: select a block, press connect, click the target', icons.connect),
  placeholder('duplicate', 'Duplicate', icons.duplicate),
  placeholder('delete', 'Delete', icons.delete),
  placeholder('unpin', 'Unpin (back to automatic placement)', icons.unpin),
  placeholder('relayout-all', 'Re-layout all (clear every pin)', icons.relayout),
];
