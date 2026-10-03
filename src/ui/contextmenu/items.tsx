// The context menus' item slots (design.md §8.2 UI40): every item in UI40's table, with its `data-menu-item` name,
// label, place and "shows when" rule. Behaviour comes separately, from `registerMenuHandler` (registry.ts): the
// built-in handlers are in builtin.tsx; items owned by other features (block colours and reset size, bend points and
// reset line, label position, notes, the title's position and visibility) get theirs from those features, and don't
// show until then.
import type { ReactNode } from 'react';
import { SHAPE_KINDS } from '../../core/types';
import { ShapeIcon } from '../chrome/Palette';
import { movableLanes } from '../features/laneActions';
import { SHAPE_NAMES } from './controls';
import { defineMenuItem, type MenuContext } from './registry';
import {
  edgeEntry, edgeLabel, hasBlockColours, hasStoredSize, isPinned, titleHasPosition, titleHidden,
} from './state';

const icon = (...d: string[]): ReactNode => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.map((p, i) => <path key={i} d={p} />)}
  </svg>
);

export const ICONS = {
  text: icon('M5 6h14', 'M12 6v13', 'M9 19h6'),
  pencil: icon('M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'),
  hash: icon('M5 9h14', 'M5 15h14', 'M10 4 8 20', 'M16 4l-2 16'),
  shape: icon('M4 5h7v7H4z', 'M17.5 4.5l3.5 3.5-3.5 3.5L14 8z', 'M8 15a3.5 3.5 0 1 0 0 .01', 'M14 15h7v5h-7z'),
  palette: icon('M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.9-.7-1.3-.7-2.2 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z', 'M7.5 11.5h.01', 'M10 7.5h.01', 'M14.5 7.5h.01'),
  duplicate: icon('M9 9h11v11H9z', 'M5 15H4V4h11v1'),
  unpin: icon('M9 4h6l-1 6 3 3H7l3-3z', 'M12 16v5', 'M4 4l16 16'),
  resize: icon('M4 14v6h6', 'M20 10V4h-6', 'M4 20l7-7', 'M20 4l-7 7'),
  reset: icon('M4 12a8 8 0 1 0 2.3-5.6', 'M4 4v4h4'),
  trash: icon('M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12', 'M9 7V4h6v3'),
  bendAdd: icon('M3 18h6V8h12', 'M9 8h.01', 'M17 15v6', 'M14 18h6'),
  bendRemove: icon('M3 18h6V8h12', 'M14 18h6'),
  line: icon('M3 17h6V7h12', 'M18 4l3 3-3 3'),
  spread: icon('M4 4v16', 'M4 7h9l4 -3', 'M4 12h16', 'M4 17h9l4 3'),
  label: icon('M3 12h4', 'M17 12h4', 'M7 8h10v8H7z'),
  note: icon('M5 4h14v11l-5 5H5z', 'M14 20v-5h5', 'M8 9h8', 'M8 12.5h5'),
  size: icon('M4 7V5h9v2', 'M8.5 5v14', 'M7 19h3', 'M14 12v-1h6v1', 'M17 11v8', 'M16 19h2'),
  bold: icon('M7 5h6a3.5 3.5 0 0 1 0 7H7z', 'M7 12h7a3.5 3.5 0 0 1 0 7H7z'),
  colour: icon('M12 3.5 6.5 11a6 6 0 1 0 11 0z'),
  title: icon('M4 6h16', 'M4 11h10', 'M4 16h7'),
  hide: icon('M3 3l18 18', 'M10.6 6.1A10 10 0 0 1 12 6c5.5 0 9 6 9 6a15 15 0 0 1-2.6 3.2', 'M6.6 6.7C4.3 8.1 3 12 3 12s3.5 6 9 6a9 9 0 0 0 4.2-1', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'),
  show: icon('M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'),
  position: icon('M12 3v18', 'M3 12h18', 'M12 3l-2 2', 'M12 3l2 2', 'M21 12l-2-2', 'M21 12l-2 2'),
  up: icon('M12 19V5', 'M6 11l6-6 6 6'),
  down: icon('M12 5v14', 'M6 13l6 6 6-6'),
  left: icon('M19 12H5', 'M11 6l-6 6 6 6'),
  right: icon('M5 12h14', 'M13 6l6 6-6 6'),
};

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const mod = (key: string) => (isMac() ? `⌘${key}` : `Ctrl+${key}`);

const any = (ctx: MenuContext<'block'>, fact: (s: ReturnType<MenuContext['store']['getState']>, id: string) => boolean) => {
  const s = ctx.store.getState();
  return ctx.target.ids.some((id) => fact(s, id));
};

// ---- Slots: UI40's table, in menu order ------------------------------------------------------------------------

// Block
defineMenuItem({ on: 'block', name: 'edit-label', label: 'Edit label', icon: ICONS.text, section: 1, order: 1, hint: '↵' });
defineMenuItem({ on: 'block', name: 'rename-id', label: 'Rename id…', icon: ICONS.hash, section: 1, order: 2, hint: 'F2' });
defineMenuItem({ on: 'block', name: 'shape', label: 'Shape', icon: ICONS.shape, section: 1, order: 3 });
defineMenuItem({ on: 'block', name: 'colors', label: 'Colours', icon: ICONS.palette, section: 1, order: 4, multi: true });
defineMenuItem({ on: 'block', name: 'duplicate', label: 'Duplicate', icon: ICONS.duplicate, section: 2, order: 1, multi: true, hint: mod('D') });
defineMenuItem({
  on: 'block', name: 'unpin', label: 'Unpin', icon: ICONS.unpin, section: 2, order: 2, multi: true,
  when: (ctx) => any(ctx, isPinned),
});
defineMenuItem({
  on: 'block', name: 'reset-size', label: 'Reset size', icon: ICONS.resize, section: 2, order: 3, multi: true,
  when: (ctx) => any(ctx, hasStoredSize),
});
defineMenuItem({
  on: 'block', name: 'reset-colors', label: 'Reset colours', icon: ICONS.reset, section: 2, order: 4, multi: true,
  when: (ctx) => any(ctx, hasBlockColours),
});
defineMenuItem({ on: 'block', name: 'delete', label: 'Delete', icon: ICONS.trash, section: 3, order: 1, multi: true, danger: true, hint: isMac() ? '⌫' : 'Del' });

// Line
defineMenuItem({
  on: 'line', name: 'edit-label', icon: ICONS.label, section: 1, order: 1, hint: '↵',
  label: (ctx) => (edgeLabel(ctx.store.getState(), ctx.target.id) === null ? 'Add label' : 'Edit label'),
});
defineMenuItem({ on: 'line', name: 'add-bend', label: 'Add bend point', icon: ICONS.bendAdd, section: 2, order: 1, when: (ctx) => ctx.target.bend === null });
defineMenuItem({ on: 'line', name: 'remove-bend', label: 'Remove bend point', icon: ICONS.bendRemove, section: 2, order: 2, when: (ctx) => ctx.target.bend !== null });
defineMenuItem({
  on: 'line', name: 'reset-line', label: 'Reset line', icon: ICONS.line, section: 2, order: 3,
  when: (ctx) => {
    const e = edgeEntry(ctx.store.getState(), ctx.target.id);
    return !!e && (e.points !== undefined || e.source_side !== undefined || e.target_side !== undefined);
  },
});
defineMenuItem({
  on: 'line', name: 'reset-label', label: 'Reset label position', icon: ICONS.reset, section: 2, order: 4,
  when: (ctx) => edgeEntry(ctx.store.getState(), ctx.target.id)?.label_at !== undefined,
});
defineMenuItem({ on: 'line', name: 'delete', label: 'Delete', icon: ICONS.trash, section: 3, order: 1, danger: true, hint: isMac() ? '⌫' : 'Del' });

// Note
defineMenuItem({ on: 'note', name: 'edit-note', label: 'Edit text', icon: ICONS.pencil, section: 1, order: 1 });
defineMenuItem({ on: 'note', name: 'font-size', label: 'Font size', icon: ICONS.size, section: 2, order: 1 });
defineMenuItem({ on: 'note', name: 'bold', label: 'Bold', icon: ICONS.bold, section: 2, order: 2 });
defineMenuItem({ on: 'note', name: 'color', label: 'Colour', icon: ICONS.colour, section: 2, order: 3 });
defineMenuItem({ on: 'note', name: 'delete', label: 'Delete', icon: ICONS.trash, section: 3, order: 1, danger: true });

// Title
defineMenuItem({ on: 'title', name: 'edit-title', label: 'Edit title', icon: ICONS.pencil, section: 1, order: 1 });
defineMenuItem({
  on: 'title', name: 'reset-position', label: 'Reset position', icon: ICONS.position, section: 2, order: 1,
  when: (ctx) => titleHasPosition(ctx.store.getState()),
});
defineMenuItem({ on: 'title', name: 'hide-title', label: 'Hide title', icon: ICONS.hide, section: 2, order: 2 });

// Canvas
defineMenuItem({ on: 'canvas', name: 'add-note', label: 'Add note', icon: ICONS.note, section: 1, order: 1 });
defineMenuItem({
  on: 'canvas', name: 'show-title', label: 'Show title', icon: ICONS.show, section: 1, order: 2,
  when: (ctx) => titleHidden(ctx.store.getState()),
});
// A22: spread the line ends that share a side along it (a tick while on).
defineMenuItem({ on: 'canvas', name: 'spread-ends', label: 'Spread line ends', icon: ICONS.spread, section: 1, order: 3 });
SHAPE_KINDS.forEach((kind, i) => {
  defineMenuItem({
    on: 'canvas', name: `add-${kind}`, label: SHAPE_NAMES[kind], icon: <ShapeIcon kind={kind} width={30} height={20} />,
    section: 2, order: i, tile: true, sectionTitle: 'Add block here',
  });
});

// Lane header (not in UI40's table: the lane menu's actions, where a right-click naturally looks for them)
const laneIndex = (ctx: MenuContext<'lane'>) => movableLanes(ctx.store).findIndex((l) => l.id === ctx.target.id);
const tb = (ctx: MenuContext<'lane'>) => ctx.store.getState().shown?.layout?.direction === 'TB';
defineMenuItem({ on: 'lane', name: 'edit-label', label: 'Rename', icon: ICONS.pencil, section: 1, order: 1 });
defineMenuItem({ on: 'lane', name: 'rename-id', label: 'Change id…', icon: ICONS.hash, section: 1, order: 2 });
defineMenuItem({
  on: 'lane', name: 'move-up', section: 2, order: 1, icon: ICONS.up,
  label: (ctx) => (tb(ctx) ? 'Move left' : 'Move up'),
  when: (ctx) => laneIndex(ctx) > 0,
});
defineMenuItem({
  on: 'lane', name: 'move-down', section: 2, order: 2, icon: ICONS.down,
  label: (ctx) => (tb(ctx) ? 'Move right' : 'Move down'),
  when: (ctx) => {
    const i = laneIndex(ctx);
    return i >= 0 && i < movableLanes(ctx.store).length - 1;
  },
});
defineMenuItem({ on: 'lane', name: 'delete', label: 'Delete lane', icon: ICONS.trash, section: 3, order: 1, danger: true });
