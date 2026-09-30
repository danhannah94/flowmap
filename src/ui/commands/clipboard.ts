// Copy, cut, paste and duplicate (amendment A12; UI13 duplicate). The work is in ../clipboard.ts and the core's
// fragment operations. Copy, cut and paste are `native`: when they can't run (nothing selected, an empty clipboard, text
// selected on the page), the browser's own copy and paste go ahead, so text in a panel can still be copied.
import { icons } from '../chrome/icons';
import { copySelection, cutSelection, duplicateBlocks, pageTextSelected, pasteClipboard, readClip } from '../clipboard';
import type { State } from '../store/store';
import { editable, type Command } from './types';

const hasNodes = (s: State) => s.selection.nodes.length > 0;
const canCopy = (s: State) => editable(s) && hasNodes(s) && !!s.shown?.layout && !pageTextSelected();

export const clipboardCommands: Command[] = [
  {
    id: 'copy',
    title: 'Copy',
    keys: ['mod+c'],
    help: 'Copy the selected blocks and the lines between them (also as Mermaid text)',
    native: true,
    enabled: canCopy,
    run: (store) => void copySelection(store),
  },
  {
    id: 'cut',
    title: 'Cut',
    keys: ['mod+x'],
    help: 'Cut the selected blocks (copy, then delete)',
    native: true,
    enabled: canCopy,
    run: cutSelection,
  },
  {
    id: 'paste',
    title: 'Paste',
    keys: ['mod+v'],
    help: 'Paste at the pointer (or next to the originals), in this or another diagram',
    native: true,
    enabled: (s) => editable(s) && !!s.shown?.layout && readClip() !== null,
    run: pasteClipboard,
  },
  {
    id: 'duplicate',
    title: 'Duplicate',
    icon: icons.duplicate,
    keys: ['mod+d'],
    help: 'Duplicate the selected blocks and the lines between them',
    enabled: (s) => editable(s) && hasNodes(s) && !!s.shown?.layout,
    run: (store) => duplicateBlocks(store, store.getState().selection.nodes),
  },
];
