// Diagram-level commands: direction (UI23), the styles panel (UI25, defined with the panel in chrome/Styles.tsx),
// export (UI32), the shortcut list (UI33). The title (UI22) is edited by double-clicking it (features/index.tsx).
import { icons } from '../chrome/icons';
import { stylesToggleCommand } from '../chrome/Styles';
import { exportDiagram, toggleDirection } from '../features/diagramActions';
import { SHORTCUTS_PANEL } from '../features/ShortcutList';
import { editable, type Command } from './types';

const exportCommand = (format: 'svg' | 'png'): Command => ({
  id: `export-${format}`,
  title: `Export ${format.toUpperCase()} (light theme) to exports/`,
  icon: format === 'svg' ? icons.exportSvg : icons.exportPng,
  // Exports read the files on disk; the server refuses a .mmd with errors, so this needs an editable diagram.
  enabled: (s) => editable(s) && !s.panels.exporting,
  active: (s) => !!s.panels[`exporting-${format}`],
  run: (store) => void exportDiagram(store, format),
});

export const diagramCommands: Command[] = [
  {
    id: 'direction-toggle',
    title: 'Switch left-to-right / top-to-bottom',
    icon: icons.direction,
    enabled: editable,
    run: (store) => toggleDirection(store),
  },
  stylesToggleCommand,
  exportCommand('svg'),
  exportCommand('png'),
  {
    id: 'shortcuts-toggle',
    title: 'Keyboard shortcuts',
    help: 'Show or hide this list',
    icon: icons.keyboard,
    keys: ['?'],
    enabled: () => true,
    active: (s) => !!s.panels[SHORTCUTS_PANEL],
    run: (store) => store.togglePanel(SHORTCUTS_PANEL),
  },
];
