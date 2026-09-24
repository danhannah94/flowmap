// Context-menu behaviour for notes, the title and the canvas's note and title items (design.md §8.2 UI40–UI42). The
// slots (names, labels, "shows when") are the menu framework's (contextmenu/items.tsx); this module attaches what
// they do. `font-size` and `color` are sub-controls inside the menu element (§8.3).
import { NOTE_FONT_MAX, NOTE_FONT_MIN, NOTE_FONT_SIZE } from '../../core/config';
import { getTheme } from '../../core/theme';
import type { ThemedColor } from '../../core/types';
import { MenuColorFields, MenuNumberField, registerMenuHandler, type MenuContext } from '../contextmenu';
import { useStoreState } from '../store/hooks';
import type { State } from '../store/store';
import {
  addBlocked, beginNewNote, configBlocked, editNote, hideTheTitle, layoutBlocked, removeNote, resetTitle,
  selectAnnotation, showTheTitle, styleNote,
} from './actions';

/** The note's own entry in the config, as written (null while the config has errors). */
function noteEntry(s: State, id: string) {
  return s.derived?.doc.config?.notes[id] ?? null;
}

const noteRun = (fn: (ctx: MenuContext<'note'>) => void) => (ctx: MenuContext<'note'>) => {
  selectAnnotation(ctx.store, { kind: 'note', id: ctx.target.id });
  fn(ctx);
};

// ---- Note (UI41) -----------------------------------------------------------------------------------------------

registerMenuHandler('note', 'edit-note', {
  run: noteRun(({ store, target }) => editNote(store, target.id)),
  disabled: ({ store }) => configBlocked(store),
});

registerMenuHandler('note', 'font-size', {
  Control: NoteFontSize,
  disabled: ({ store }) => configBlocked(store),
});

registerMenuHandler('note', 'bold', {
  run: noteRun(({ store, target }) => {
    const bold = noteEntry(store.getState(), target.id)?.bold === true;
    styleNote(store, target.id, { bold: !bold });
  }),
  checked: ({ store, target }) => noteEntry(store.getState(), target.id)?.bold === true,
  disabled: ({ store }) => configBlocked(store),
});

registerMenuHandler('note', 'color', {
  Control: NoteColour,
  disabled: ({ store }) => configBlocked(store),
});

registerMenuHandler('note', 'delete', {
  run: ({ store, target }) => removeNote(store, target.id),
  disabled: ({ store }) => configBlocked(store),
});

function NoteFontSize({ ctx }: { ctx: MenuContext<'note'> }) {
  const id = ctx.target.id;
  const size = useStoreState((s) => noteEntry(s, id)?.font_size ?? null);
  return (
    <MenuNumberField
      prop="font_size"
      label="Font size"
      value={size ?? null}
      min={NOTE_FONT_MIN}
      max={NOTE_FONT_MAX}
      placeholder={String(NOTE_FONT_SIZE)}
      // The default (14), or emptied, removes the key (§4); out of range is refused with the op's message.
      onCommit={(value) => styleNote(ctx.store, id, { font_size: value })}
    />
  );
}

function NoteColour({ ctx }: { ctx: MenuContext<'note'> }) {
  const id = ctx.target.id;
  const color = useStoreState((s) => noteEntry(s, id)?.color);
  const { light, dark } = splitColor(color);
  const light0 = getTheme('light').nodeText;
  const dark0 = getTheme('dark').nodeText;
  return (
    <MenuColorFields
      fields={[{ prop: 'color', label: 'Text colour', light, dark, defaults: { light: light0, dark: dark0 } }]}
      onCommit={(_prop, l, d) => {
        // As the styles panel (R5.11): emptying the light value clears the colour; an empty dark value means one colour
        // for both themes. A dark value with no light one is refused by the op, with its message.
        if (l.trim() === '') styleNote(ctx.store, id, { color: light === '' && d.trim() !== '' ? { light: null, dark: d } : null });
        else styleNote(ctx.store, id, { color: { light: l, dark: d.trim() === '' ? null : d } });
      }}
    />
  );
}

function splitColor(c: ThemedColor | undefined): { light: string; dark: string } {
  if (c === undefined) return { light: '', dark: '' };
  if (typeof c === 'string') return { light: c, dark: '' };
  return { light: c.light ?? '', dark: c.dark ?? '' };
}

// ---- Title (UI42; `edit-title` is UI22's, already wired) --------------------------------------------------------

registerMenuHandler('title', 'hide-title', {
  run: ({ store }) => hideTheTitle(store),
  disabled: ({ store }) => configBlocked(store),
});

registerMenuHandler('title', 'reset-position', {
  run: ({ store }) => resetTitle(store),
  disabled: ({ store }) => layoutBlocked(store),
});

// ---- Canvas ------------------------------------------------------------------------------------------------------

registerMenuHandler('canvas', 'add-note', {
  run: ({ store, world }) => beginNewNote(store, world),
  disabled: ({ store }) => addBlocked(store),
});

registerMenuHandler('canvas', 'show-title', {
  run: ({ store }) => showTheTitle(store),
  disabled: ({ store }) => configBlocked(store),
});
