// Every command, and the toolbar's layout. Feature modules own their command files; this file only lists them.
import { blockCommands } from './blocks';
import { coreCommands } from './core';
import { diagramCommands } from './diagram';
import { laneCommands } from './lanes';
import { noteCommands } from '../notes/commands';
import type { Command } from './types';

export type { Command } from './types';

export const COMMANDS: readonly Command[] = [
  ...coreCommands, ...blockCommands, ...laneCommands, ...diagramCommands, ...noteCommands,
];

const byId = new Map(COMMANDS.map((c) => [c.id, c]));

export function command(id: string): Command | undefined {
  return byId.get(id);
}

/** Toolbar groups, left to right (§8.3 toolbar test ids). `theme-toggle` sits at the far right of the top bar. */
export const TOOLBAR: readonly (readonly string[])[] = [
  ['undo', 'redo'],
  ['connect', 'duplicate', 'delete', 'unpin', 'relayout-all'],
  ['add-lane', 'add-note', 'direction-toggle', 'styles-toggle'],
  ['fit'],
  ['export-svg', 'export-png'],
];
