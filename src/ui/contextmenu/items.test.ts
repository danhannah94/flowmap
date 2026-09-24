// UI40: every item slot's name and "shows when" rule, read from real files through the same `derive` the UI uses.
// Items owned by features that may not have registered yet get stub handlers here, so every rule in UI40's table is
// checked whatever has landed. (The built-in handlers' behaviour is checked end to end in tests/ui/contextmenu.spec.ts.)
import { beforeAll, describe, expect, it } from 'vitest';
import { derive } from '../store/derive';
import { EMPTY_SELECTION, type State, type Store } from '../store/store';
import './items';
import { menuItemsFor, registerMenuHandler, type MenuOn, type MenuTarget } from './registry';

const UI40: Record<MenuOn, string[]> = {
  block: ['edit-label', 'rename-id', 'shape', 'colors', 'duplicate', 'unpin', 'reset-size', 'reset-colors', 'delete'],
  line: ['edit-label', 'add-bend', 'remove-bend', 'reset-line', 'reset-label', 'delete'],
  note: ['edit-note', 'font-size', 'bold', 'color', 'delete'],
  title: ['edit-title', 'reset-position', 'hide-title'],
  canvas: ['add-note', 'show-title', ...['step', 'decision', 'terminal', 'subprocess', 'database', 'io', 'document', 'delay'].map((k) => `add-${k}`)],
  lane: ['edit-label', 'rename-id', 'move-up', 'move-down', 'delete'],
};

beforeAll(() => {
  for (const [on, names] of Object.entries(UI40) as [MenuOn, string[]][]) {
    for (const name of names) registerMenuHandler(on, name, { run: () => {} });
  }
});

const MMD = `flowchart LR

  subgraph alpha [Alpha]
    a1["First"]
    a2["Second"]
  end

  subgraph beta [Beta]
    b1{"Check?"}
  end

  a1 --> a2
  a2 -->|yes| b1
  a1 --> b1
`;

const CONFIG = `version: 1
title: Menus
nodes:
  a1:
    owner: Sam
    style: {fill: "#ffeeaa"}
  b1:
    style: {border_style: dashed}
notes:
  note1:
    text: A note
`;

const LAYOUT = JSON.stringify({
  version: 1,
  nodes: { a2: { lane: 'alpha', along: 300, across: 30 }, b1: { width: 200, height: 90 } },
  edges: {
    'a1->a2': { points: [{ lane: 'alpha', along: 240, across: 80 }] },
    'a2->b1': { label_at: 0.4 },
    'a1->b1': { source_side: 'bottom' },
  },
  title: { x: 10, y: -50 },
});

function storeFor(files: { mmd: string; config: string | null; layout: string | null }, selection = EMPTY_SELECTION): Store {
  const d = derive(files, 'menus.mmd');
  expect(d.doc.problems.errors).toEqual([]);
  const state = { shown: d, derived: d, selection, viewport: { x: 0, y: 0, zoom: 1 } } as unknown as State;
  return { getState: () => state, get layout() { return d.layout; } } as unknown as Store;
}

const names = (store: Store, target: MenuTarget) =>
  menuItemsFor({ store, target, world: { x: 0, y: 0 }, close: () => {} }).map((i) => i.def.name);

const FILES = { mmd: MMD, config: CONFIG, layout: LAYOUT };

describe('context menu items (UI40)', () => {
  it('block: edit-label, rename-id, shape, colors, duplicate, delete always; unpin / reset-size / reset-colors when they apply', () => {
    const s = storeFor(FILES);
    const block = (id: string): MenuTarget => ({ kind: 'block', ids: [id], clicked: id });
    // a1: colours in its style, not pinned, no size.
    expect(names(s, block('a1'))).toEqual(['edit-label', 'rename-id', 'shape', 'colors', 'duplicate', 'reset-colors', 'delete']);
    // a2: pinned only.
    expect(names(s, block('a2'))).toEqual(['edit-label', 'rename-id', 'shape', 'colors', 'duplicate', 'unpin', 'delete']);
    // b1: a stored size; a style without colours doesn't count.
    expect(names(s, block('b1'))).toEqual(['edit-label', 'rename-id', 'shape', 'colors', 'duplicate', 'reset-size', 'delete']);
  });

  it('several blocks: only the items that apply to all of them, shown when any of them needs it', () => {
    const s = storeFor(FILES);
    expect(names(s, { kind: 'block', ids: ['a1', 'a2', 'b1'], clicked: 'a2' }))
      .toEqual(['colors', 'duplicate', 'unpin', 'reset-size', 'reset-colors', 'delete']);
    expect(names(s, { kind: 'block', ids: ['a1', 'b1'], clicked: 'a1' }))
      .toEqual(['colors', 'duplicate', 'reset-size', 'reset-colors', 'delete']);
  });

  it('line: edit-label reads "Add label" when there is none; add-bend or remove-bend; reset-line and reset-label when they apply', () => {
    const s = storeFor(FILES);
    const menu = (id: string, bend: number | null = null) => menuItemsFor({ store: s, target: { kind: 'line', id, bend }, world: { x: 0, y: 0 }, close: () => {} });
    const manual = menu('a1->a2');
    expect(manual.map((i) => i.def.name)).toEqual(['edit-label', 'add-bend', 'reset-line', 'delete']);
    expect(manual[0]!.label).toBe('Add label');
    expect(menu('a1->a2', 0).map((i) => i.def.name)).toEqual(['edit-label', 'remove-bend', 'reset-line', 'delete']);
    const labelled = menu('a2->b1');
    expect(labelled.map((i) => i.def.name)).toEqual(['edit-label', 'add-bend', 'reset-label', 'delete']);
    expect(labelled[0]!.label).toBe('Edit label');
    // A stored side alone also offers reset-line.
    expect(menu('a1->b1').map((i) => i.def.name)).toEqual(['edit-label', 'add-bend', 'reset-line', 'delete']);
  });

  it('note: edit-note, font-size, bold, color, delete', () => {
    expect(names(storeFor(FILES), { kind: 'note', id: 'note1' })).toEqual(['edit-note', 'font-size', 'bold', 'color', 'delete']);
  });

  it('title: edit-title and hide-title; reset-position when it has a stored position', () => {
    expect(names(storeFor(FILES), { kind: 'title' })).toEqual(['edit-title', 'reset-position', 'hide-title']);
    const layout = JSON.parse(LAYOUT) as Record<string, unknown>;
    delete layout.title;
    expect(names(storeFor({ ...FILES, layout: JSON.stringify(layout) }), { kind: 'title' })).toEqual(['edit-title', 'hide-title']);
  });

  it('canvas: add-note and a block of each shape; show-title only while the title is hidden', () => {
    const shapes = UI40.canvas.filter((n) => n.startsWith('add-') && n !== 'add-note');
    expect(names(storeFor(FILES), { kind: 'canvas' })).toEqual(['add-note', ...shapes]);
    const hidden = storeFor({ ...FILES, config: CONFIG.replace('title: Menus\n', 'title: Menus\nshow_title: false\n') });
    expect(names(hidden, { kind: 'canvas' })).toEqual(['add-note', 'show-title', ...shapes]);
  });

  it('lane header: rename, id, move up or down where possible, delete', () => {
    const s = storeFor(FILES);
    expect(names(s, { kind: 'lane', id: 'alpha' })).toEqual(['edit-label', 'rename-id', 'move-down', 'delete']);
    expect(names(s, { kind: 'lane', id: 'beta' })).toEqual(['edit-label', 'rename-id', 'move-up', 'delete']);
  });

  it('an item with no handler registered does not show', () => {
    const s = storeFor(FILES);
    const off = registerMenuHandler('block', 'reset-colors', { run: () => {} });
    off();
    expect(names(s, { kind: 'block', ids: ['a1'], clicked: 'a1' })).not.toContain('reset-colors');
  });
});
