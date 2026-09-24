// Toolbar and keyboard commands for notes and the title (design.md §8.2 UI41, UI42, UI33; §8.3 toolbar `add-note`).
// The keyed ones apply while a note or the title is selected, which leaves no block or line selected (UI10), so they
// never compete with the block commands for the same key. Deleting a selected note is the toolbar's and the keys'
// one `delete` command (commands/blocks.ts); the title has no delete (hide it from its menu instead).
import type { Command } from '../commands/types';
import { editable } from '../commands/types';
import type { State } from '../store/store';
import {
  addNoteAtViewCentre, editAnnotation, nudgeAnnotation, selectedAnnotation,
} from './actions';

const NOTE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 4h14v11l-5 5H5z" />
    <path d="M14 20v-5h5" />
    <path d="M8.5 9h7" />
    <path d="M8.5 12.5h4" />
  </svg>
);

const annotation = (s: State) => s.selection.annotation ?? null;
const anySelected = (s: State) => editable(s) && !!annotation(s);

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10],
};

export const noteCommands: Command[] = [
  {
    id: 'add-note',
    title: 'Add a note',
    help: 'Add a note at the centre of the view',
    icon: NOTE_ICON,
    // Writes both the config and the layout file (UI31: off while either has errors).
    enabled: (s) => editable(s) && !!s.shown?.layout && !s.derived?.configBroken && !s.derived?.layoutBroken,
    run: (store) => addNoteAtViewCentre(store),
  },
  {
    id: 'edit-annotation',
    title: 'Edit the selected note or title',
    help: 'Edit the selected note or the title',
    keys: ['Enter'],
    enabled: anySelected,
    run: (store) => {
      const a = selectedAnnotation(store);
      if (a) editAnnotation(store, a);
    },
  },
  {
    // One command for the four arrows, so the shortcut list shows one row.
    id: 'move-annotation',
    title: 'Move the selected note or title 10 px',
    help: 'Move the selected note or the title 10 px',
    keys: Object.keys(ARROWS),
    enabled: anySelected,
    run: (store, e) => {
      const d = e ? ARROWS[e.key] : undefined;
      if (d) nudgeAnnotation(store, d[0], d[1]);
    },
  },
];
