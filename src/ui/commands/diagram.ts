// Diagram-level commands (UI22–UI25, UI32, UI33). Placeholders until those features land: replace each entry with
// the real command (same id). Keys to add then: `?` (shortcut list, `data-testid="shortcuts"`).
import { icons } from '../chrome/icons';
import { placeholder, type Command } from './types';

export const diagramCommands: Command[] = [
  placeholder('direction-toggle', 'Switch left-to-right / top-to-bottom', icons.direction),
  placeholder('styles-toggle', 'Styles', icons.styles),
  placeholder('export-svg', 'Export SVG', icons.exportSvg),
  placeholder('export-png', 'Export PNG', icons.exportPng),
];
