// Parity tests for the rest of v1.1 (design.md §10 Part 3: P22 colours, P25 connection sides, P26 notes, P27 title,
// P28 keeping the layout file in step, P29 anywhere) and every bullet of §8.2 "Keeping the layout file in step". Each
// test applies the operation and, separately, the equivalent hand edit, and compares them as the acceptance suite does:
// the `.mmd` bytes after `fmt`, the config as parsed YAML with untouched lines byte-identical, the layout as JSON.
import { SIDES } from '../types';
import { nodeSize } from '../measure';
import {
  addNodeAt, addNote, applySwatch, clearAllPins, connect, deleteItems, deleteLane, deleteNote, dragBend,
  duplicateNodes, hideTitle, moveNodesToLane, moveNote, moveTitle, pinNodes, reconnect, renameLane, renameNode,
  resetBlockColors, resetTitlePosition, setBlockColors, setDirection, setNoteStyle, setNoteText, showTitle,
} from './index';
import { Ctx } from './context';
import { edit, editJson, expectParity, ok, refused } from './testkit';
import { handPoint, layoutJs, layoutOf, SHAPE, SHAPE_CONFIG, SHAPE_LAYOUT, SHAPE_MMD } from './testkit-v11';

const L = layoutOf(SHAPE);
const P = (x: number, y: number) => handPoint(L, x, y);
const withLayout = (change: (js: any) => void) => ({ ...SHAPE, layout: editJson(SHAPE_LAYOUT, change) });

// ---- P22 block colours -------------------------------------------------------------------------------------------

describe('P22 block colours (UI35)', () => {
  test('fill (light and dark) on a block with no entry: a new entry at the end of nodes', () => {
    const r = setBlockColors(SHAPE, ['a'], 'fill', '#FFF2CC', '#4a3f12');
    const after = expectParity(r, SHAPE, {
      config: `${SHAPE_CONFIG}  a:\n    style:\n      fill: {light: "#fff2cc", dark: "#4a3f12"}\n`,
    });
    expect(after.config!.startsWith(SHAPE_CONFIG)).toBe(true);
  });

  test('border and text colour on a block with metadata: its style goes at the end of its entry', () => {
    const border = expectParity(setBlockColors(SHAPE, ['b'], 'border_color', '#333', ''), SHAPE, {
      config: edit(SHAPE_CONFIG, ['    owner: sam     # evidence\n', '    owner: sam     # evidence\n    style:\n      border_color: "#333"\n']),
    });
    // The writer chose a flow map for the new style; the hand edit adds the colour to it.
    expect(border.config).toContain('    style: {border_color: "#333"}\n');
    expectParity(setBlockColors(border, ['b'], 'text_color', '#111111', '#EEEEEE'), border, {
      config: edit(border.config!, ['{border_color: "#333"}', '{border_color: "#333", text_color: {light: "#111111", dark: "#eeeeee"}}']),
    });
  });

  test('several blocks at once, in file declaration order; equal light and dark is one colour', () => {
    const r = setBlockColors(SHAPE, ['d', 'a', 'b'], 'fill', '#abc', '#ABC');
    const after = expectParity(r, SHAPE, {
      config: edit(SHAPE_CONFIG, ['    owner: sam     # evidence\n', '    owner: sam     # evidence\n    style:\n      fill: "#abc"\n'])
        + '  a:\n    style:\n      fill: "#abc"\n  d:\n    style:\n      fill: "#abc"\n',
    });
    expect(after.config!.indexOf('  a:')).toBeLessThan(after.config!.indexOf('  d:'));
  });

  test('a swatch sets only the fill', () => {
    const styled = { ...SHAPE, config: `${SHAPE_CONFIG}  a:\n    style: {border_color: "#123456", fill: "#000"}\n` };
    expectParity(applySwatch(styled, ['a', 'c'], '#dae8fc', '#1e3a5f'), styled, {
      config: edit(styled.config, ['fill: "#000"}', 'fill: {light: "#dae8fc", dark: "#1e3a5f"}}'])
        + '  c:\n    style:\n      fill: {light: "#dae8fc", dark: "#1e3a5f"}\n',
    });
  });

  test('reset removes the three colours, style if emptied, the entry if emptied; other properties stay', () => {
    const styled = {
      ...SHAPE,
      config: `${SHAPE_CONFIG}    style: {fill: "#fff"}\n  a:\n    style:\n      fill: "#fff"\n      border_style: dashed\n  c:\n    style:\n      text_color: "#000"\n`,
    };
    expectParity(resetBlockColors(styled, ['c', 'a', 'b']), styled, {
      config: edit(styled.config!, ['    style: {fill: "#fff"}\n', ''], ['      fill: "#fff"\n      border_style', '      border_style'],
        ['  c:\n    style:\n      text_color: "#000"\n', '']),
    });
  });

  test('no config file: the first colour creates it', () => {
    const none = { ...SHAPE, config: null };
    expectParity(setBlockColors(none, ['a'], 'fill', '#fff', null), none, { config: 'version: 1\nnodes:\n  a:\n    style:\n      fill: "#fff"\n' });
  });

  test('refusals: unknown block, dark without light, bad colour, bad property', () => {
    expect(refused(setBlockColors(SHAPE, ['zz'], 'fill', '#fff', null))).toMatch(/no block/);
    expect(refused(setBlockColors(SHAPE, ['a'], 'fill', '', '#000'))).toMatch(/light/);
    expect(refused(setBlockColors(SHAPE, ['a'], 'fill', 'red', null))).toMatch(/colour/);
    expect(refused(setBlockColors(SHAPE, ['a'], 'badge' as 'fill', '#fff', null))).toMatch(/colour property/);
    expect(refused(applySwatch(SHAPE, ['a'], '', null))).toMatch(/light/);
  });
});

// ---- P25 connection sides ----------------------------------------------------------------------------------------

describe('P25 connect from a side, drop on a connection point, reconnect (UI38)', () => {
  const appended = (line: string) => edit(SHAPE_MMD, ['  a -->|yes| d\n', `  a -->|yes| d\n${line}\n`]);

  test.each(SIDES)('from the %s side of a step: source_side is written', (side) => {
    const r = connect(SHAPE, 'a', 'd', { source_side: side });
    expect(ok(r).edgeId).toBe('a->d#2');
    expectParity(r, SHAPE, { mmd: appended('a-->d'), layout: editJson(SHAPE_LAYOUT, (js) => { js.edges = { 'a->d#2': { source_side: side } }; }) });
  });

  test.each(SIDES)('from the %s vertex of a diamond', (side) => {
    expectParity(connect(SHAPE, 'd', 'a', { source_side: side }), SHAPE, {
      mmd: appended('d --> a'), layout: editJson(SHAPE_LAYOUT, (js) => { js.edges = { 'd->a': { source_side: side } }; }),
    });
  });

  test('dropped on a target\'s connection point: target_side too', () => {
    expectParity(connect(SHAPE, 'c', 'b', { source_side: 'top', target_side: 'bottom' }), SHAPE, {
      mmd: appended('c --> b'), layout: editJson(SHAPE_LAYOUT, (js) => { js.edges = { 'c->b': { source_side: 'top', target_side: 'bottom' } }; }),
    });
  });

  test('the click path writes no sides (the layout file is untouched)', () => {
    expectParity(connect(SHAPE, 'c', 'b'), SHAPE, { mmd: appended('c --> b') });
    expectParity(connect(SHAPE, 'c', 'b', { source_side: null }), SHAPE, { mmd: appended('c --> b') });
  });

  const MANUAL = withLayout((js) => {
    js.edges = { 'c->d': { source_side: 'right', target_side: 'left', points: [P(300, 160)], label_at: 0.4 } };
  });

  test('reconnect an end of a manual line to another block: points and that end\'s side go, the rest stays', () => {
    const r = reconnect(MANUAL, 'c->d', 'target', 'b', 'bottom');
    expect(ok(r).edgeId).toBe('c->b');
    expectParity(r, MANUAL, {
      mmd: edit(SHAPE_MMD, ['  c --> d\n', '  c --> b\n']),
      layout: editJson(MANUAL.layout, (js) => { js.edges = { 'c->b': { source_side: 'right', target_side: 'bottom', label_at: 0.4 } }; }),
    });
    // The moved line now comes first of the a->d pair in the file: it is a->d, and the old a->d (with its entry)
    // becomes a->d#2.
    const pair = { ...MANUAL, layout: editJson(MANUAL.layout, (js) => { js.edges['a->d'] = { label_at: 0.9 }; }) };
    const src = reconnect(pair, 'c->d', 'source', 'a');
    expect(ok(src).edgeId).toBe('a->d');
    expectParity(src, pair, {
      mmd: edit(SHAPE_MMD, ['  c --> d\n', '  a --> d\n']),
      layout: editJson(pair.layout, (js) => { js.edges = { 'a->d': { target_side: 'left', label_at: 0.4 }, 'a->d#2': { label_at: 0.9 } }; }),
    });
  });

  test('onto another connection point of the block it is already on: only that side changes', () => {
    const r = reconnect(MANUAL, 'c->d', 'source', 'c', 'bottom');
    expect(ok(r).edgeId).toBe('c->d');
    expectParity(r, MANUAL, { layout: editJson(MANUAL.layout, (js) => { js.edges['c->d'].source_side = 'bottom'; }) });
    expectParity(reconnect(MANUAL, 'c->d', 'target', 'd', 'top'), MANUAL, {
      layout: editJson(MANUAL.layout, (js) => { js.edges['c->d'].target_side = 'top'; }),
    });
    // Dropped elsewhere on the same block: that side is left to the layout.
    expectParity(reconnect(MANUAL, 'c->d', 'target', 'd'), MANUAL, {
      layout: editJson(MANUAL.layout, (js) => { delete js.edges['c->d'].target_side; }),
    });
  });

  test('refusals: bad sides', () => {
    expect(refused(connect(SHAPE, 'a', 'b', { source_side: 'middle' as 'top' }))).toMatch(/source side/);
    expect(refused(connect(SHAPE, 'a', 'b', { target_side: 'up' as 'top' }))).toMatch(/target side/);
    expect(refused(reconnect(SHAPE, 'a->b', 'target', 'c', 'north' as 'top'))).toMatch(/side/);
  });
});

// ---- P26 notes ---------------------------------------------------------------------------------------------------

describe('P26 notes (UI41)', () => {
  const NOTED = {
    ...SHAPE,
    config: `${SHAPE_CONFIG}notes:\n  note1:\n    text: Freight is the long pole   # from ops\n`,
    layout: editJson(SHAPE_LAYOUT, (js) => { js.notes = { note1: { x: 40, y: -60 } }; }),
  };

  test('add: id, text (trailing line breaks dropped) and position in one step', () => {
    const r = addNote(SHAPE, { text: 'Freight is\nthe long pole\n\n', at: { x: 40.6, y: -60.5 } }, L);
    expect(ok(r).id).toBe('note1');
    expectParity(r, SHAPE, {
      config: `${SHAPE_CONFIG}notes:\n  note1:\n    text: "Freight is\\nthe long pole"\n`,
      layout: editJson(SHAPE_LAYOUT, (js) => { js.notes = { note1: { x: 41, y: -61 } }; }),
    });
  });

  test('add: the first free id skips ids taken anywhere (nodes, notes, config and layout keys)', () => {
    const taken = {
      ...NOTED,
      config: `${NOTED.config}  note3:\n    text: three\n`,
      mmd: edit(SHAPE_MMD, ['    b["Beta"]\n', '    b["Beta"]\n    note2["Two"]\n']),
      layout: editJson(NOTED.layout, (js) => { js.notes.note4 = { x: 1, y: 1 }; }),
    };
    expect(ok(addNote(taken, { text: 'x', at: { x: 0, y: 0 } })).id).toBe('note5');
  });

  test('edit the text; blank text deletes the note (an emptied notes map goes, and its position)', () => {
    expectParity(setNoteText(NOTED, 'note1', 'Freight\ntakes days'), NOTED, {
      config: edit(NOTED.config, ['    text: Freight is the long pole   # from ops\n', '    text: "Freight\\ntakes days"\n']),
    });
    expectParity(setNoteText(NOTED, 'note1', '  \n'), NOTED, {
      config: SHAPE_CONFIG,
      layout: editJson(NOTED.layout, (js) => { delete js.notes; }),
    });
  });

  test('move (rounded; negative allowed)', () => {
    expectParity(moveNote(NOTED, 'note1', { x: -12.5, y: 300.2 }, L), NOTED, {
      layout: editJson(NOTED.layout, (js) => { js.notes.note1 = { x: -13, y: 300 }; }),
    });
  });

  test('restyle: font size, bold, colour; defaults remove their keys', () => {
    const styled = expectParity(setNoteStyle(NOTED, 'note1', { font_size: 20, bold: true, color: { light: '#B85450', dark: '#f08080' } }), NOTED, {
      config: `${NOTED.config}    font_size: 20\n    bold: true\n    color: {light: "#b85450", dark: "#f08080"}\n`,
    });
    expectParity(setNoteStyle(styled, 'note1', { font_size: 14, bold: false, color: null }), styled, { config: NOTED.config });
    expectParity(setNoteStyle(styled, 'note1', { font_size: null }), styled, { config: edit(styled.config!, ['    font_size: 20\n', '']) });
    expect(refused(setNoteStyle(NOTED, 'note1', { font_size: 49 }))).toMatch(/10 to 48/);
  });

  test('delete: the config entry and its position', () => {
    const two = { ...NOTED, config: `${NOTED.config}  note2:\n    text: two\n`, layout: editJson(NOTED.layout, (js) => { js.notes.note2 = { x: 5, y: 5 }; }) };
    expectParity(deleteNote(two, 'note1'), two, {
      config: edit(two.config, ['  note1:\n    text: Freight is the long pole   # from ops\n', '']),
      layout: editJson(two.layout, (js) => { delete js.notes.note1; }),
    });
  });

  test('refusals', () => {
    expect(refused(addNote(SHAPE, { text: '  ', at: { x: 0, y: 0 } }))).toMatch(/text/);
    expect(refused(addNote(SHAPE, { text: 'x', at: { x: NaN, y: 0 } }))).toMatch(/finite/);
    expect(refused(moveNote(NOTED, 'note9', { x: 0, y: 0 }))).toMatch(/no note/);
    expect(refused(deleteNote(NOTED, 'note9'))).toMatch(/no note/);
    expect(refused(setNoteText(NOTED, 'note9', 'x'))).toMatch(/no note/);
  });
});

// ---- P27 title ---------------------------------------------------------------------------------------------------

describe('P27 title (UI42)', () => {
  test('move, hide, show, reset its position', () => {
    const moved = expectParity(moveTitle(SHAPE, { x: 0, y: -48 }, L), SHAPE, { layout: editJson(SHAPE_LAYOUT, (js) => { js.title = { x: 0, y: -48 }; }) });
    const hidden = expectParity(hideTitle(moved), moved, { config: `${SHAPE_CONFIG}show_title: false\n` });
    expectParity(showTitle(hidden), hidden, { config: SHAPE_CONFIG });
    expectParity(resetTitlePosition(moved), moved, { layout: SHAPE_LAYOUT });
  });

  test('hide with no config file creates it; show when shown and reset with no position change nothing', () => {
    const none = { ...SHAPE, config: null, layout: null };
    expectParity(hideTitle(none), none, { config: 'version: 1\nshow_title: false\n' });
    expect(ok(showTitle(none)).files).toEqual({ ...none, mmd: SHAPE_MMD });
    expect(ok(resetTitlePosition(none)).files).toEqual({ ...none, mmd: SHAPE_MMD });
  });
});

// ---- P28 and "Keeping the layout file in step" -------------------------------------------------------------------

describe('P28 keeping the layout file in step (§8.2)', () => {
  const TRIPLE = {
    mmd: edit(SHAPE_MMD, ['  a -->|yes| d\n', '  a -->|yes| d\n  a --> b\n  a -->|again| b\n']),
    config: SHAPE_CONFIG,
    layout: editJson(SHAPE_LAYOUT, (js) => {
      js.edges = { 'a->b': { label_at: 0.1 }, 'a->b#2': { source_side: 'top', label_at: 0.2 }, 'a->b#3': { label_at: 0.3 }, 'c->d': { target_side: 'top' } };
    }),
  };

  test('delete one of three duplicate edges that have entries: the rest are re-keyed by position', () => {
    expectParity(deleteItems(TRIPLE, { edges: ['a->b#2'] }), TRIPLE, {
      mmd: edit(TRIPLE.mmd, ['  a -->|yes| d\n  a --> b\n', '  a -->|yes| d\n']),
      layout: editJson(TRIPLE.layout, (js) => {
        js.edges = { 'a->b': { label_at: 0.1 }, 'a->b#2': { label_at: 0.3 }, 'c->d': { target_side: 'top' } };
      }),
    });
    expectParity(deleteItems(TRIPLE, { edges: ['a->b'] }), TRIPLE, {
      mmd: edit(TRIPLE.mmd, ['  a --> b\n  a --> c\n', '  a --> c\n']),
      layout: editJson(TRIPLE.layout, (js) => {
        js.edges = { 'a->b': { source_side: 'top', label_at: 0.2 }, 'a->b#2': { label_at: 0.3 }, 'c->d': { target_side: 'top' } };
      }),
    });
  });

  const SHAPED = withLayout((js) => {
    js.nodes.a = { lane: 'top', along: 40, across: 30, width: 150, height: 60 };
    js.edges = {
      'a->c': { source_side: 'bottom', target_side: 'top', points: [P(100, 102), P(130, 102)] },
      'c->d': { target_side: 'top' },
      'a->d': { label_at: 0.5 },
      'a->zz': { label_at: 0.7 }, // an orphan: not a line of `a`, left alone
    };
  });

  test('rename a node with a sized, pinned entry and shaped lines: its entry and its lines\' keys, in place', () => {
    const after = expectParity(renameNode(SHAPED, 'a', 'alpha'), SHAPED, {
      mmd: SHAPE_MMD.replace('a["Alpha"]', 'alpha["Alpha"]').replace(/^ {2}a --/gm, '  alpha --'),
      layout: editJson(SHAPED.layout, (js) => {
        js.nodes = { alpha: js.nodes.a, b: js.nodes.b, c: js.nodes.c, d: js.nodes.d };
        js.edges = { 'alpha->c': js.edges['a->c'], 'c->d': js.edges['c->d'], 'alpha->d': js.edges['a->d'], 'a->zz': js.edges['a->zz'] };
      }),
    });
    expect(Object.keys(layoutJs(after).nodes)).toEqual(['alpha', 'b', 'c', 'd']);
    expect(Object.keys(layoutJs(after).edges)).toEqual(['alpha->c', 'c->d', 'alpha->d', 'a->zz']);
  });

  test('delete a lane that holds a bend point (moving its blocks): those lines lose their points, moved blocks their pins', () => {
    const files = withLayout((js) => {
      js.edges = {
        'a->d': { source_side: 'right', target_side: 'left', points: [P(160, 82), P(392, 82), P(392, 158)] },
        'c->d': { points: [P(300, 160)] },
      };
    });
    expectParity(deleteLane(files, 'top', { mode: 'move', target: 'bottom' }), files, {
      mmd: SHAPE_MMD.replace('  subgraph top [Top]\n    a["Alpha"]\n    b["Beta"]\n  end\n\n', '')
        .replace('    d{"Delta?"}\n', '    d{"Delta?"}\n    a["Alpha"]\n    b["Beta"]\n'),
      layout: editJson(files.layout, (js) => {
        delete js.nodes.a; delete js.nodes.b;
        js.edges['a->d'] = { source_side: 'right', target_side: 'left' };
      }),
    });
  });

  test('re-layout all: pins and points go; sizes, sides, label_at, notes, title and hints stay', () => {
    const files = { ...SHAPED, layout: editJson(SHAPED.layout, (js) => { js.notes = { note1: { x: 1, y: 2 } }; js.title = { x: 0, y: -40 }; }) };
    expectParity(clearAllPins(files), files, {
      layout: editJson(files.layout, (js) => {
        js.nodes = { a: { width: 150, height: 60 } };
        js.edges['a->c'] = { source_side: 'bottom', target_side: 'top' };
      }),
    });
  });
});

describe('keeping the layout file in step: the other bullets (§8.2)', () => {
  test('deleting a node deletes its entry and its lines\' entries; other lines are re-keyed', () => {
    const files = withLayout((js) => {
      js.nodes.a.width = 200; js.nodes.a.height = 60;
      js.edges = { 'a->b': { label_at: 0.2 }, 'b->d': { source_side: 'left' }, 'a->d': { points: [P(300, 20)] } };
    });
    expectParity(deleteItems(files, { nodes: ['a'] }), files, {
      mmd: SHAPE_MMD.replace('    a["Alpha"]\n', '').replace(/^ {2}a --.*\n/gm, ''),
      layout: editJson(files.layout, (js) => { delete js.nodes.a; js.edges = { 'b->d': { source_side: 'left' } }; }),
    });
  });

  test('reconnect that creates a duplicate pair, and one that breaks it: entries stay on the right lines', () => {
    const files = withLayout((js) => { js.edges = { 'a->b': { label_at: 0.1 }, 'a->c': { source_side: 'left', label_at: 0.9 } }; });
    const r = reconnect(files, 'a->c', 'target', 'b');
    expect(ok(r).edgeId).toBe('a->b#2');
    const pair = expectParity(r, files, {
      mmd: edit(SHAPE_MMD, ['  a --> c\n', '  a --> b\n']),
      layout: editJson(files.layout, (js) => { js.edges = { 'a->b': { label_at: 0.1 }, 'a->b#2': { source_side: 'left', label_at: 0.9 } }; }),
    });
    // Moving the first of the pair: the second becomes a->b and keeps its entry.
    const back = reconnect(pair, 'a->b', 'target', 'd');
    expect(ok(back).edgeId).toBe('a->d');
    expectParity(back, pair, {
      mmd: edit(pair.mmd, ['  a --> b\n  a --> b\n', '  a --> d\n  a --> b\n']),
      layout: editJson(pair.layout, (js) => { js.edges = { 'a->d': { label_at: 0.1 }, 'a->b': { source_side: 'left', label_at: 0.9 } }; }),
    });
  });

  test('connecting a duplicate renumbers nothing', () => {
    const files = withLayout((js) => { js.edges = { 'a->b': { label_at: 0.1 } }; });
    expectParity(connect(files, 'a', 'b', { source_side: 'bottom' }), files, {
      mmd: edit(SHAPE_MMD, ['  a -->|yes| d\n', '  a -->|yes| d\n  a --> b\n']),
      layout: editJson(files.layout, (js) => { js.edges['a->b#2'] = { source_side: 'bottom' }; }),
    });
  });

  test('renaming a lane renames it in pins and bend points', () => {
    const files = withLayout((js) => { js.edges = { 'c->d': { points: [P(300, 160), P(300, 20)] } }; });
    expectParity(renameLane(files, 'top', 'upper'), files, {
      mmd: edit(SHAPE_MMD, ['subgraph top [Top]', 'subgraph upper [Top]']),
      layout: editJson(files.layout, (js) => {
        js.nodes.a.lane = 'upper'; js.nodes.b.lane = 'upper'; js.edges['c->d'].points[1].lane = 'upper';
      }),
    });
  });

  test('deleting a lane in any way: empty, and with its blocks', () => {
    const withEmpty = {
      ...SHAPE,
      mmd: edit(SHAPE_MMD, ['  a --> b\n', '  subgraph spare [Spare]\n  end\n\n  a --> b\n']),
    };
    const out = layoutOf(withEmpty);
    const spare = out.result.lanes.find((l) => l.id === 'spare')!;
    const files = { ...withEmpty, layout: editJson(SHAPE_LAYOUT, (js) => {
      js.edges = { 'c->d': { points: [handPoint(out, 300, spare.y + 10)] }, 'a->b': { points: [handPoint(out, 300, 20)] } };
    }) };
    expectParity(deleteLane(files, 'spare', { mode: 'empty' }), files, {
      mmd: SHAPE_MMD,
      layout: editJson(files.layout, (js) => { delete js.edges['c->d']; }),
    });
    expectParity(deleteLane(files, 'top', { mode: 'delete' }), files, {
      mmd: withEmpty.mmd.replace('  subgraph top [Top]\n    a["Alpha"]\n    b["Beta"]\n  end\n\n', '').replace(/^ {2}[ab] --.*\n/gm, ''),
      layout: editJson(files.layout, (js) => { delete js.nodes.a; delete js.nodes.b; delete js.edges['a->b']; }),
    });
  });

  // An unlaned block `u` and a line c->u with a bend point in `_unassigned`; c->d has one there too.
  const UNL_MMD = edit(SHAPE_MMD, ['flowchart LR\n', 'flowchart LR\n\n  u["Loose"]\n'], ['  a -->|yes| d\n', '  a -->|yes| d\n  c --> u\n']);
  const unlFiles = () => {
    const base = { mmd: UNL_MMD, config: SHAPE_CONFIG, layout: editJson(SHAPE_LAYOUT, (js) => { js.nodes.u = { lane: '_unassigned', along: 40, across: 30 }; }) };
    const out = layoutOf(base);
    const u = out.result.lanes.find((l) => l.id === '_unassigned')!;
    const files = { ...base, layout: editJson(base.layout, (js) => {
      js.edges = { 'c->d': { points: [handPoint(out, 300, u.y + 70)] }, 'c->u': { source_side: 'bottom', points: [handPoint(out, 100, u.y + 5)] } };
    }) };
    return { files, out: layoutOf(files) };
  };

  test('when Unassigned disappears, its bend points are re-expressed in the last lane at the same on-screen place', () => {
    const { files, out } = unlFiles();
    const bottom = out.result.lanes.find((l) => l.id === 'bottom')!;
    const u = out.result.lanes.find((l) => l.id === '_unassigned')!;
    expect(layoutJs(files).edges['c->d'].points[0]).toEqual({ lane: '_unassigned', along: 300, across: 70 });
    // Moved into a lane from the inspector: its pin goes too.
    expectParity(moveNodesToLane(files, ['u'], 'top'), files, {
      mmd: edit(UNL_MMD, ['\n  u["Loose"]\n', ''], ['    b["Beta"]\n', '    b["Beta"]\n    u["Loose"]\n']),
      layout: editJson(files.layout, (js) => {
        delete js.nodes.u;
        js.edges['c->d'].points[0] = { lane: 'bottom', along: 300, across: 70 + u.y - bottom.y };
        js.edges['c->u'].points[0] = { lane: 'bottom', along: 100, across: 5 + u.y - bottom.y };
      }),
    });
    // Deleted: its line goes, the other line's point is re-expressed.
    expectParity(deleteItems(files, { nodes: ['u'] }), files, {
      mmd: edit(UNL_MMD, ['\n  u["Loose"]\n', ''], ['  c --> u\n', '']),
      layout: editJson(files.layout, (js) => {
        delete js.nodes.u;
        js.edges = { 'c->d': { points: [{ lane: 'bottom', along: 300, across: 70 + u.y - bottom.y }] } };
      }),
    });
    // Same on-screen place: the re-expressed point is drawn where it was.
    const moved = ok(deleteItems(files, { nodes: ['u'] })).files;
    const before = out.result.edges.find((e) => e.id === 'c->d')!.points;
    const after = layoutOf(moved).result.edges.find((e) => e.id === 'c->d')!.points;
    expect(after.some(([x, y]) => x === 300 && y === u.y + 70)).toBe(true);
    expect(before.some(([x, y]) => x === 300 && y === u.y + 70)).toBe(true);
  });

  test('Unassigned staying (another block still in it) changes no bend point', () => {
    const { files } = unlFiles();
    const two = { ...files, mmd: edit(files.mmd, ['  u["Loose"]\n', '  u["Loose"]\n  v["Other"]\n']) };
    expectParity(moveNodesToLane(two, ['u'], 'top'), two, {
      mmd: edit(two.mmd, ['  u["Loose"]\n', ''], ['    b["Beta"]\n', '    b["Beta"]\n    u["Loose"]\n']),
      layout: editJson(two.layout, (js) => { delete js.nodes.u; }),
    });
  });

  test('duplicating a block copies its stored size', () => {
    const files = withLayout((js) => { js.nodes.b.width = 180; js.nodes.b.height = 70; js.nodes.c.width = 140; js.nodes.c.height = 60; });
    const out = layoutOf(files);
    const box = (id: string) => out.result.nodes.find((n) => n.id === id)!;
    expectParity(duplicateNodes(files, ['c', 'b', 'd'], out), files, {
      mmd: edit(SHAPE_MMD, ['    b["Beta"]\n', '    b["Beta"]\n    n1["Beta"]\n'], ['    d{"Delta?"}\n', '    d{"Delta?"}\n    n2["Gamma"]\n    n3{"Delta?"}\n']),
      config: `${SHAPE_CONFIG}  n1:\n    owner: sam\n`,
      layout: editJson(files.layout, (js) => {
        js.nodes.n1 = { lane: 'top', along: box('b').x + 24, across: box('b').y + 24, width: 180, height: 70 };
        const bottom = out.result.lanes.find((l) => l.id === 'bottom')!.y;
        js.nodes.n2 = { lane: 'bottom', along: box('c').x + 24, across: box('c').y - bottom + 24, width: 140, height: 60 };
        js.nodes.n3 = { lane: 'bottom', along: box('d').x + 24, across: box('d').y - bottom + 24 };
      }),
    });
  });

  test('the direction flip rotates sides and swaps note and title x and y; bend points, sizes, label_at stay', () => {
    const files = withLayout((js) => {
      js.nodes.a.width = 150; js.nodes.a.height = 60;
      js.edges = { 'a->b': { source_side: 'right', target_side: 'bottom', label_at: 0.3 }, 'c->d': { source_side: 'left', target_side: 'top', points: [P(300, 160)] } };
      js.notes = { note1: { x: 10, y: -50 } };
      js.title = { x: 0, y: -48 };
    });
    const flipped = expectParity(setDirection(files, 'TB'), files, {
      mmd: edit(SHAPE_MMD, ['flowchart LR', 'flowchart TB']),
      layout: editJson(files.layout, (js) => {
        js.edges['a->b'] = { source_side: 'bottom', target_side: 'right', label_at: 0.3 };
        js.edges['c->d'] = { source_side: 'top', target_side: 'left', points: [P(300, 160)] };
        js.notes = { note1: { x: -50, y: 10 } };
        js.title = { x: -48, y: 0 };
      }),
    });
    // Flipping back gives the same content; the same direction changes nothing.
    expect(JSON.parse(ok(setDirection(flipped, 'LR')).files.layout!)).toEqual(JSON.parse(files.layout!));
    expect(ok(setDirection(files, 'LR')).files.layout).toBe(files.layout);
  });

  test('orphan deletes for line and note entries (UI27)', async () => {
    const { deleteOrphanEdgeEntry, deleteOrphanNoteEntry } = await import('./index');
    const files = withLayout((js) => { js.edges = { 'x->y': { label_at: 0.5 } }; js.notes = { gone: { x: 1, y: 1 }, kept: { x: 2, y: 2 } }; });
    expectParity(deleteOrphanEdgeEntry(files, 'x->y'), files, { layout: editJson(files.layout, (js) => { delete js.edges; }) });
    expectParity(deleteOrphanNoteEntry(files, 'gone'), files, { layout: editJson(files.layout, (js) => { delete js.notes.gone; }) });
  });
});

// ---- P29 anywhere ------------------------------------------------------------------------------------------------

describe('P29 drop left of and above everything (UI43)', () => {
  test('a block: negative along; negative across in the first lane; a later lane\'s across stored as 0', () => {
    expectParity(pinNodes(SHAPE, [{ id: 'a', along: -50.5, across: -20 }, { id: 'c', along: -3, across: -5 }]), SHAPE, {
      layout: editJson(SHAPE_LAYOUT, (js) => { js.nodes.a = { lane: 'top', along: -51, across: -20 }; js.nodes.c = { lane: 'bottom', along: -3, across: 0 }; }),
    });
  });

  test('a bend point and a note', () => {
    expectParity(dragBend(SHAPE, L, 'c->d', 1, { x: -30, y: -40 }), SHAPE, {
      layout: editJson(SHAPE_LAYOUT, (js) => {
        js.edges = { 'c->d': { source_side: 'right', target_side: 'left', points: [P(392, 166), { lane: 'top', along: -30, across: -40 }] } };
      }),
    });
    expectParity(addNote(SHAPE, { text: 'Up here', at: { x: -60, y: -80 } }, L), SHAPE, {
      config: `${SHAPE_CONFIG}notes:\n  note1:\n    text: Up here\n`,
      layout: editJson(SHAPE_LAYOUT, (js) => { js.notes = { note1: { x: -60, y: -80 } }; }),
    });
  });

  test('a block from the canvas menu: pinned at the click, lane by its centre (before the first lane: the first)', () => {
    const r = addNodeAt(SHAPE, 'decision', { x: -100, y: -100 }, L);
    expect(ok(r)).toMatchObject({ id: 'n1', lane: 'top' });
    expectParity(r, SHAPE, {
      mmd: edit(SHAPE_MMD, ['    b["Beta"]\n', '    b["Beta"]\n    n1{"New decision"}\n']),
      layout: editJson(SHAPE_LAYOUT, (js) => { js.nodes.n1 = { lane: 'top', along: -100, across: -100 }; }),
    });
  });

  test('canvas menu: centre in a lane, past the flow\'s end (R9), or after the last lane (Unassigned, A4)', () => {
    const size = nodeSize('New step', 'step');
    // Its top-left is in the top lane but its centre is in the bottom one.
    const y = 100 - Math.floor(size.height / 2) + 1;
    expectParity(addNodeAt(SHAPE, 'step', { x: 900, y }, L), SHAPE, {
      mmd: edit(SHAPE_MMD, ['    d{"Delta?"}\n', '    d{"Delta?"}\n    n1["New step"]\n']),
      layout: editJson(SHAPE_LAYOUT, (js) => { js.nodes.n1 = { lane: 'bottom', along: 900, across: 0 }; }),
    });
    expectParity(addNodeAt(SHAPE, 'io', { x: 100.5, y: 300 }, L), SHAPE, {
      mmd: edit(SHAPE_MMD, ['flowchart LR\n', 'flowchart LR\n\n  n1[/"New input or output"/]\n']),
      layout: editJson(SHAPE_LAYOUT, (js) => { js.nodes.n1 = { lane: '_unassigned', along: 100, across: 300 - 208 }; }),
    });
  });

  test('a lane-free diagram: everything is Unassigned, and above it is a negative across', () => {
    const free = { mmd: 'flowchart LR\n  x["X"]\n', config: null, layout: null };
    const out = layoutOf(free);
    const lane = out.result.lanes[0]!;
    expectParity(addNodeAt(free, 'step', { x: 10, y: -30 }, out), free, {
      mmd: 'flowchart LR\n  x["X"]\n  n1["New step"]\n',
      layout: JSON.stringify({ version: 1, nodes: { n1: { lane: '_unassigned', along: 10, across: -30 - lane.y } } }),
    });
  });

  test('with a frame (existing negative values): drops are stored against it', () => {
    const files = withLayout((js) => { js.nodes.a = { lane: 'top', along: -50, across: -20 }; });
    const out = layoutOf(files);
    expect(out.translation).toEqual({ along: 50, across: 20 });
    expectParity(addNodeAt(files, 'step', { x: 0, y: 0 }, out), files, {
      mmd: edit(SHAPE_MMD, ['    b["Beta"]\n', '    b["Beta"]\n    n1["New step"]\n']),
      layout: editJson(files.layout, (js) => { js.nodes.n1 = { lane: 'top', along: -50, across: -20 }; }),
    });
    expectParity(moveNote(
      { ...files, config: `${SHAPE_CONFIG}notes:\n  n9:\n    text: hi\n` }, 'n9', { x: 10, y: 10 }, out,
    ), { ...files, config: `${SHAPE_CONFIG}notes:\n  n9:\n    text: hi\n` }, {
      layout: editJson(files.layout, (js) => { js.notes = { n9: { x: -40, y: -10 } }; }),
    });
    // A bare LayoutResult: the frame is worked out from the files, the same way.
    expect(ok(moveTitle(files, { x: 10, y: 10 }, out.result)).files).toEqual(ok(moveTitle(files, { x: 10, y: 10 }, out)).files);
    expect(ok(moveTitle(files, { x: 10, y: 10 })).files).toEqual(ok(moveTitle(files, { x: 10, y: 10 }, out)).files);
  });
});

// ---- the frame --------------------------------------------------------------------------------------------------

describe('the frame the ops use is the layout\'s (§6)', () => {
  test.each([
    ['nothing negative', SHAPE_LAYOUT],
    ['a negative pin', editJson(SHAPE_LAYOUT, (js) => { js.nodes.a = { lane: 'top', along: -7, across: -9 }; })],
    ['a negative bend point only', editJson(SHAPE_LAYOUT, (js) => { js.edges = { 'c->d': { points: [{ lane: 'top', along: -80, across: -33 }] } }; })],
    ['an orphan and a stale pin do not count', editJson(SHAPE_LAYOUT, (js) => {
      js.nodes.zz = { lane: 'top', along: -500, across: -500 }; js.nodes.c = { lane: 'top', along: -300, across: -300 };
      js.edges = { 'x->y': { points: [{ lane: 'top', along: -99, across: -99 }] }, 'c->d': { points: [{ lane: 'gone', along: -5, across: 0 }] } };
    })],
  ])('%s', (_name, layout) => {
    const files = { ...SHAPE, layout };
    expect(new Ctx(files).frame()).toEqual(layoutOf(files).translation);
  });

  test('duplicating uses the frame from bend points too (a pins-only frame would be off by T)', () => {
    const files = withLayout((js) => { js.edges = { 'c->d': { points: [{ lane: 'bottom', along: -80, across: 60 }] } }; });
    const out = layoutOf(files);
    expect(out.translation.along).toBe(80);
    const want = editJson(files.layout, (js) => { js.nodes.n1 = { lane: 'top', along: 424, across: 54 }; });
    const mmd = edit(SHAPE_MMD, ['    b["Beta"]\n', '    b["Beta"]\n    n1["Beta"]\n']);
    const config = `${SHAPE_CONFIG}  n1:\n    owner: sam\n`;
    expectParity(duplicateNodes(files, ['b'], out), files, { mmd, config, layout: want });
    expectParity(duplicateNodes(files, ['b'], out.result), files, { mmd, config, layout: want });
  });
});
