// Parity tests for block operations (design.md §10 Part 3: P1–P4, P8–P11). Each test applies the operation and,
// separately, the equivalent hand edit written as a text transformation, and compares them the way the acceptance
// suite does (testkit `expectParity`).
import {
  addNode, changeShape, clearAllPins, deleteItems, duplicateNodes, moveNodesToLane, pinNodes, positionInLane,
  renameNode, setNodeLabel, unpinNodes,
} from './index';
import { edit, editJson, expectParity, ok, PR, refused, RICH, RICH_MMD } from './testkit';
import { SHAPE_KINDS, type LayoutResult, type ShapeKind } from '../types';

/** A declaration as a person might type it (not necessarily canonical). */
const HAND: Record<ShapeKind, (id: string, label: string) => string> = {
  step: (i, l) => `${i}["${l}"]`,
  decision: (i, l) => `${i}{"${l}"}`,
  terminal: (i, l) => `${i}([${l}])`,
  subprocess: (i, l) => `${i}[["${l}"]]`,
  database: (i, l) => `${i}[( "${l}" )]`,
  io: (i, l) => `${i}[/"${l}"/]`,
  document: (i, l) => `${i}@{ label: "${l}", shape: doc }`,
  delay: (i, l) => `${i}@{shape: delay,label: "${l}"}`,
};
const LABEL: Record<ShapeKind, string> = {
  step: 'New step', decision: 'New decision', terminal: 'New start or end', subprocess: 'New subprocess',
  database: 'New system', io: 'New input or output', document: 'New document', delay: 'New wait',
};

const pin = (lane: string, along: number, across: number) => ({ lane, along, across });

/** A stand-in for the layout function's output: lanes as horizontal bands, nodes where the test says. */
function fakeLayout(nodes: { id: string; lane: string; x: number; y: number }[], lanes: Record<string, number>,
  direction: 'LR' | 'TB' = 'LR'): LayoutResult {
  return {
    direction, width: 2000, height: 1000,
    lanes: Object.entries(lanes).map(([id, at]) => (direction === 'LR'
      ? { id, label: id, x: 0, y: at, width: 2000, height: 150 }
      : { id, label: id, x: at, y: 0, width: 150, height: 2000 })),
    nodes: nodes.map((n) => ({ ...n, kind: 'step', label: n.id, width: 160, height: 60, pinned: false })),
    edges: [],
  };
}

describe('P1 add a block (UI6)', () => {
  test.each(SHAPE_KINDS)('%s in a lane: first free id, starting label, last declaration of the lane', (shape) => {
    const r = addNode(PR, { shape, lane: 'finance' });
    expect(ok(r).id).toBe('n1');
    expectParity(r, PR, {
      mmd: edit(PR.mmd, ['    f04(["Vendor paid"])\n', `    f04(["Vendor paid"])\n    ${HAND[shape]('n1', LABEL[shape])}\n`]),
    });
  });

  test.each(SHAPE_KINDS)('%s in Unassigned', (shape) => {
    const r = addNode(PR, { shape, lane: '_unassigned' });
    expectParity(r, PR, { mmd: edit(PR.mmd, ['  f03 --> f04\n', `  f03 --> f04\n${HAND[shape]('n1', LABEL[shape])}\n`]) });
  });

  test.each(SHAPE_KINDS)('%s in the rich files: skips ids taken in the config and layout, goes before an end comment', (shape) => {
    const r = addNode(RICH, { shape, lane: 'requester' });
    expect(ok(r).id).toBe('n3'); // n1 is a config key, n2 a pin
    expectParity(r, RICH, {
      mmd: edit(RICH_MMD, ['  r01["Fill the form"];\n', `  r01["Fill the form"];\n  ${HAND[shape]('n3', LABEL[shape])}\n`]),
    });
  });

  test('into an empty lane that holds only an end comment', () => {
    const r = addNode(RICH, { shape: 'io', lane: 'empty' });
    expectParity(r, RICH, {
      mmd: edit(RICH_MMD, ['subgraph empty [Empty lane]\n', `subgraph empty [Empty lane]\n  n3[/"New input or output"/]\n`]),
    });
  });

  test('into Unassigned in the rich files: after the last unlaned declaration', () => {
    const r = addNode(RICH, { shape: 'terminal', lane: '_unassigned' });
    expectParity(r, RICH, {
      mmd: edit(RICH_MMD, ['stray{"Stray question?"}:::hot\n', 'stray{"Stray question?"}:::hot\nn3(["New start or end"])\n']),
    });
  });

  test('dragged from the palette: pinned where dropped, rounded (negative kept, v1.1)', () => {
    const r = addNode(PR, { shape: 'decision', lane: 'manager', pin: { along: 812.5, across: 4.2 } });
    expectParity(r, PR, {
      mmd: edit(PR.mmd, ['    m03["Tell the requester why not"]\n', '    m03["Tell the requester why not"]\n    n1{"New decision"}\n']),
      layout: editJson(PR.layout, (js) => { js.nodes.n1 = pin('manager', 812, 4); }),
    });
    // Dropped into Unassigned, with the rich files' pins (new pin last, hints kept).
    const u = addNode(RICH, { shape: 'step', lane: '_unassigned', pin: { along: -3, across: 40.4 } });
    const after = expectParity(u, RICH, {
      mmd: edit(RICH_MMD, ['stray{"Stray question?"}:::hot\n', 'stray{"Stray question?"}:::hot\nn3["New step"]\n']),
      layout: editJson(RICH.layout, (js) => { js.nodes.n3 = pin('_unassigned', -3, 40); }),
    });
    expect(Object.keys(JSON.parse(after.layout!).nodes)).toEqual(['r01', 'stray', 'n2', 'f02', 'n3']);
  });

  test('pinned with no layout file: the file is created; unpinned: none is', () => {
    const noLayout = { ...PR, layout: null };
    const r = ok(addNode(noLayout, { shape: 'step', lane: 'vendor', pin: { along: 10, across: 20 } }));
    expect(JSON.parse(r.files.layout!)).toEqual({ version: 1, nodes: { n1: pin('vendor', 10, 20) } });
    expect(ok(addNode(noLayout, { shape: 'step', lane: 'vendor' })).files.layout).toBeNull();
    expect(ok(addNode({ ...PR, config: null, layout: null }, { shape: 'step', lane: 'vendor' })).files.config).toBeNull();
  });

  test('refusals: unknown lane or shape', () => {
    expect(refused(addNode(PR, { shape: 'step', lane: 'nowhere' }))).toMatch(/no lane/);
    expect(refused(addNode(PR, { shape: 'hexagon' as ShapeKind, lane: 'vendor' }))).toMatch(/shape/);
  });
});

describe('P2 change shape (UI7)', () => {
  const R01 = '    r01["Fill the purchase request form"]';
  const label = 'Fill the purchase request form';
  const pairs = SHAPE_KINDS.flatMap((a) => SHAPE_KINDS.map((b) => [a, b] as const));

  test.each(pairs)('%s -> %s: rewritten in place, same id, label, lane and position', (from, to) => {
    const before = { ...PR, mmd: edit(PR.mmd, [R01, `    ${HAND[from]('r01', label)}`]) };
    expectParity(changeShape(before, 'r01', to), before, {
      mmd: edit(before.mmd, [`    ${HAND[from]('r01', label)}`, `    ${HAND[to]('r01', label)}`]),
    });
  });

  test('keeps the comment; keeps the class suffix except for document and delay', () => {
    expectParity(changeShape(RICH, 'r01', 'database'), RICH, {
      mmd: edit(RICH_MMD, ['  r01["Fill the form"];\n', '  r01[("Fill the form")]\n']),
    });
    expectParity(changeShape(RICH, 'stray', 'subprocess'), RICH, {
      mmd: edit(RICH_MMD, ['stray{"Stray question?"}:::hot', 'stray[["Stray question?"]]:::hot']),
    });
    expectParity(changeShape(RICH, 'stray', 'document'), RICH, {
      mmd: edit(RICH_MMD, ['stray{"Stray question?"}:::hot', 'stray@{ shape: doc, label: "Stray question?" }']),
    });
  });

  test('a never-declared node is declared in the unlaned section', () => {
    expectParity(changeShape(RICH, 'ghost', 'delay'), RICH, {
      mmd: edit(RICH_MMD, ['stray{"Stray question?"}:::hot\n', 'stray{"Stray question?"}:::hot\nghost@{ shape: delay, label: "ghost" }\n']),
    });
  });

  test('refusals', () => {
    expect(refused(changeShape(PR, 'nope', 'step'))).toMatch(/no block/);
    expect(refused(changeShape(PR, 'r01', 'blob' as ShapeKind))).toMatch(/shape/);
  });
});

describe('P3 edit a label (UI8)', () => {
  test('with " and # in it, including text that looks like an escape', () => {
    const r = setNodeLabel(PR, 'p04', 'Over "$1,000" #1 or #quot;x#quot;?');
    expectParity(r, PR, {
      mmd: edit(PR.mmd, ['p04{"Over $1,000?"}', 'p04{"Over #quot;$1,000#quot; #1 or #35;quot;x#35;quot;?"}']),
    });
  });

  test('in an @{…} node, a backslash is written #92;', () => {
    expectParity(setNodeLabel(RICH, 'f01', 'Wait \\ "see"'), RICH, {
      mmd: edit(RICH_MMD, ['label: "Wait for budget"', 'label: "Wait #92; #quot;see#quot;"']),
    });
  });

  test('keeps the class suffix and comment; exact text kept (no trimming inside)', () => {
    expectParity(setNodeLabel(RICH, 'stray', '  Still  open?'), RICH, {
      mmd: edit(RICH_MMD, ['stray{"Stray question?"}', 'stray{"  Still  open?"}']),
    });
    expectParity(setNodeLabel(RICH, 'r01', 'Fill it in'), RICH, {
      mmd: edit(RICH_MMD, ['r01["Fill the form"];', 'r01[Fill it in]']),
    });
  });

  test('a never-declared node is declared in the unlaned section', () => {
    expectParity(setNodeLabel(RICH, 'ghost', 'A ghost step'), RICH, {
      mmd: edit(RICH_MMD, ['stray{"Stray question?"}:::hot\n', 'stray{"Stray question?"}:::hot\nghost["A ghost step"]\n']),
    });
  });

  test('refusals: empty, blank, several lines, unknown block', () => {
    expect(refused(setNodeLabel(PR, 'p04', ''))).toMatch(/empty/);
    expect(refused(setNodeLabel(PR, 'p04', '   '))).toMatch(/empty/);
    expect(refused(setNodeLabel(PR, 'p04', 'a\nb'))).toMatch(/single line/);
    expect(refused(setNodeLabel(PR, 'nope', 'x'))).toMatch(/no block/);
  });
});

describe('P4 rename an id (UI9)', () => {
  test('with edges, metadata, a pin and a style rule that matches it', () => {
    const r = renameNode(RICH, 'r01', 'form');
    const after = expectParity(r, RICH, {
      mmd: edit(RICH_MMD,
        ['  r01["Fill the form"];', '  form["Fill the form"];'],
        ['intake --> r01\n', 'intake --> form\n'],
        ['%% hand-off to the manager\nr01 --> m01', '%% hand-off to the manager\nform --> m01'],
        ['m02 -- no --> r01', 'm02 -- no --> form'],
        ['r01 --> m01\nloose', 'form --> m01\nloose']),
      config: edit(RICH.config!, ['  r01:\n', '  form:\n'], ['match: { id: r01 }', 'match: { id: form }']),
      layout: editJson(RICH.layout, (js) => {
        js.nodes = Object.fromEntries(Object.entries(js.nodes).map(([k, v]) => [k === 'r01' ? 'form' : k, v]));
      }),
    });
    // Renamed keys keep their place (§4, R5.10); pass-through lines are text-only and kept as they are (§8.1).
    expect(Object.keys(JSON.parse(after.layout!).nodes)).toEqual(['form', 'stray', 'n2', 'f02']);
    expect(after.config).toContain('  form:\n    system: excel     # the famous spreadsheet\n');
    expect(after.mmd).toContain('  class r01 hot\n');
  });

  test('in the purchase-request files: a pinned node, and one with metadata', () => {
    expectParity(renameNode(PR, 'closed', 'done'), PR, {
      mmd: edit(PR.mmd, ['closed(["Request closed"])', 'done(["Request closed"])'], ['m03 --> closed', 'm03 --> done']),
      layout: edit(PR.layout!, ['"closed"', '"done"']),
    });
    expectParity(renameNode(PR, 'p05', 'quotes'), PR, {
      mmd: edit(PR.mmd, ['p05["Get three quotes"]', 'quotes["Get three quotes"]'], ['p04 -->|no| p05', 'p04 -->|no| quotes'],
        ['m02 -->|yes| p05', 'm02 -->|yes| quotes'], ['p05 --> v01', 'quotes --> v01']),
      config: edit(PR.config!, ['  p05:\n', '  quotes:\n']),
    });
  });

  test('a never-declared node: only its edges', () => {
    expectParity(renameNode(RICH, 'ghost', 'spirit'), RICH, { mmd: edit(RICH_MMD, ['& ghost', '& spirit']) });
  });

  test('no config or layout file: none is created', () => {
    const r = ok(renameNode({ ...PR, config: null, layout: null }, 'r01', 'form'));
    expect(r.files.config).toBeNull();
    expect(r.files.layout).toBeNull();
  });

  test.each([
    ['a--b', /not a valid id/], ['9x', /not a valid id/], ['x-', /not a valid id/], ['has space', /not a valid id/],
    ['', /not a valid id/], ['end', /reserved/], ['end-x', /reserved/], ['end_x', /reserved/], ['_unassigned', /reserved/],
    ['default', /reserved/], ['classDef', /reserved/], ['m01', /already used/], ['ghost', /already used/],
    ['requester', /already used/], ['n1', /already used/], ['n2', /already used/],
  ])('refuses "%s"', (id, why) => {
    expect(refused(renameNode(RICH, 'r01', id))).toMatch(why);
  });

  test('renaming to the same id changes nothing; an unknown block is refused', () => {
    expect(ok(renameNode(PR, 'r01', 'r01')).files).toEqual(PR);
    expect(refused(renameNode(PR, 'nope', 'x'))).toMatch(/no block/);
  });
});

describe('P8 delete a block (UI14)', () => {
  test('with its edges, the comments attached to them, and its pin; never its config metadata', () => {
    expectParity(deleteItems(RICH, { nodes: ['r01'] }), RICH, {
      mmd: edit(RICH_MMD,
        ['  %% the form is a spreadsheet\n  r01["Fill the form"];\n', ''],
        ['intake --> r01\n', ''],
        ['%% hand-off to the manager\nr01 --> m01\n', ''],
        ['m02 -- no --> r01\n', ''],
        ['r01 --> m01\nloose', 'loose']),
      layout: editJson(RICH.layout, (js) => { delete js.nodes.r01; }),
    });
  });

  test('an edge written inside a subgraph goes with its comment', () => {
    expectParity(deleteItems(RICH, { nodes: ['m02'] }), RICH, {
      mmd: edit(RICH_MMD,
        ['  m02{"Approved?"}\n', ''], ['  %% the manager decides\n  m01 --> m02\n', ''],
        ['m02 -->|yes| f01\n', ''], ['m02 -- no --> r01\n', '']),
    });
  });

  test('purchase-request: a pinned block', () => {
    expectParity(deleteItems(PR, { nodes: ['closed'] }), PR, {
      mmd: edit(PR.mmd, ['    closed(["Request closed"])\n', ''], ['  m03 --> closed\n', '']),
      layout: editJson(PR.layout, (js) => { delete js.nodes.closed; }),
    });
  });

  test('part of an & group; a never-declared node', () => {
    expectParity(deleteItems(RICH, { nodes: ['ghost'] }), RICH, { mmd: edit(RICH_MMD, [' & ghost', '']) });
    expectParity(deleteItems(RICH, { nodes: ['f02'] }), RICH, {
      mmd: edit(RICH_MMD, ['  %% the invoice\n  f02[/"Invoice #35;quot; copy"/]\n', ''], ['f01 --> f02 & ghost', 'f01 --> ghost']),
      layout: editJson(RICH.layout, (js) => { delete js.nodes.f02; }),
    });
  });

  test('several blocks and edges at once', () => {
    expectParity(deleteItems(RICH, { nodes: ['stray', 'loose'], edges: ['m01->m02', 'r01->m01#2'] }), RICH, {
      mmd: edit(RICH_MMD,
        ['%% an unlaned note\nloose["Loose end"]\nstray{"Stray question?"}:::hot\n', ''],
        ['  %% the manager decides\n  m01 --> m02\n', ''],
        ['r01 --> m01\nloose --> stray\n', '']),
      layout: editJson(RICH.layout, (js) => { delete js.nodes.stray; }),
    });
  });

  test('refusals: unknown block or edge', () => {
    expect(refused(deleteItems(PR, { nodes: ['nope'] }))).toMatch(/no block/);
    expect(refused(deleteItems(PR, { edges: ['a->b'] }))).toMatch(/no line/);
  });
});

describe('P9 move a block to another lane (UI11)', () => {
  test('by the lane select: appended with its comment, pin dropped', () => {
    expectParity(moveNodesToLane(RICH, ['r01'], 'manager'), RICH, {
      mmd: edit(RICH_MMD,
        ['  %% the form is a spreadsheet\n  r01["Fill the form"];\n', ''],
        ['  m02{"Approved?"}\n', '  m02{"Approved?"}\n  %% the form is a spreadsheet\n  r01["Fill the form"]\n']),
      layout: editJson(RICH.layout, (js) => { delete js.nodes.r01; }),
    });
  });

  test('by dragging: the pin records the new lane and the drop position', () => {
    const r = moveNodesToLane(RICH, ['r01'], 'finance', { pins: [{ id: 'r01', along: 410.6, across: 2 }] });
    const after = expectParity(r, RICH, {
      mmd: edit(RICH_MMD,
        ['  %% the form is a spreadsheet\n  r01["Fill the form"];\n', ''],
        ['  f02[/"Invoice #35;quot; copy"/]\n', '  f02[/"Invoice #35;quot; copy"/]\n  %% the form is a spreadsheet\n  r01["Fill the form"]\n']),
      layout: editJson(RICH.layout, (js) => { js.nodes.r01 = pin('finance', 411, 2); }),
    });
    expect(Object.keys(JSON.parse(after.layout!).nodes)[0]).toBe('r01');
  });

  test('to Unassigned, and into a lane with an end comment', () => {
    expectParity(moveNodesToLane(PR, ['p03'], '_unassigned'), PR, {
      mmd: edit(PR.mmd, ['    p03["Send it back with what is missing"]\n', ''],
        ['  f03 --> f04\n', '  f03 --> f04\n  p03["Send it back with what is missing"]\n']),
    });
    expectParity(moveNodesToLane(RICH, ['f02'], 'empty'), RICH, {
      mmd: edit(RICH_MMD, ['  %% the invoice\n  f02[/"Invoice #35;quot; copy"/]\n', ''],
        ['subgraph empty [Empty lane]\n', 'subgraph empty [Empty lane]\n  %% the invoice\n  f02[/"Invoice #35;quot; copy"/]\n']),
      layout: editJson(RICH.layout, (js) => { delete js.nodes.f02; }),
    });
  });

  test('from Unassigned; a never-declared node is declared in its new lane', () => {
    expectParity(moveNodesToLane(RICH, ['loose', 'ghost'], 'requester'), RICH, {
      mmd: edit(RICH_MMD, ['%% an unlaned note\nloose["Loose end"]\n', ''],
        ['  r01["Fill the form"];\n', '  r01["Fill the form"];\n  %% an unlaned note\n  loose["Loose end"]\n  ghost["ghost"]\n']),
    });
  });

  test('several blocks go in file declaration order; one already there stays put', () => {
    expectParity(moveNodesToLane(RICH, ['f02', 'm01', 'intake', 'stray'], 'manager'), RICH, {
      mmd: edit(RICH_MMD,
        ['stray{"Stray question?"}:::hot\n', ''],
        ['  intake(["Needs a part"])\n', ''],
        ['  %% the invoice\n  f02[/"Invoice #35;quot; copy"/]\n', ''],
        ['  m02{"Approved?"}\n', '  m02{"Approved?"}\n  stray{"Stray question?"}:::hot\n  intake(["Needs a part"])\n  %% the invoice\n  f02[/"Invoice #35;quot; copy"/]\n']),
      layout: editJson(RICH.layout, (js) => { delete js.nodes.stray; delete js.nodes.f02; }),
    });
  });

  test('refusals', () => {
    expect(refused(moveNodesToLane(PR, ['r01'], 'nowhere'))).toMatch(/no lane/);
    expect(refused(moveNodesToLane(PR, ['nope'], 'manager'))).toMatch(/no block/);
    expect(refused(moveNodesToLane(PR, ['r01'], 'manager', { pins: [{ id: 'p01', along: 0, across: 0 }] }))).toMatch(/isn't moved/);
  });
});

describe('P10 pin, nudge, unpin, re-layout all (UI10, UI12)', () => {
  test('pin by drag: rounded and otherwise exact (negative too, v1.1), the node\'s lane recorded; new pins last', () => {
    expectParity(pinNodes(RICH, [{ id: 'm02', along: 123.5, across: 11.4 }, { id: 'loose', along: -8, across: 60.49 }]), RICH, {
      layout: editJson(RICH.layout, (js) => { js.nodes.loose = pin('_unassigned', -8, 60); js.nodes.m02 = pin('manager', 123, 11); }),
    });
  });

  test('pin by nudge: an existing pin moves in place', () => {
    const after = expectParity(pinNodes(RICH, [{ id: 'r01', along: 310, across: 40 }]), RICH, {
      layout: edit(RICH.layout!, ['"along": 300', '"along": 310']),
    });
    expect(Object.keys(JSON.parse(after.layout!).nodes)).toEqual(['r01', 'stray', 'n2', 'f02']);
    expectParity(pinNodes(PR, [{ id: 'closed', along: 1400, across: 50 }]), PR, { layout: edit(PR.layout!, ['"across": 40', '"across": 50']) });
  });

  test('a pin whose lane is stale is rewritten with the current lane', () => {
    const stale = { ...PR, layout: edit(PR.layout!, ['"lane": "requester"', '"lane": "vendor"']) };
    expectParity(pinNodes(stale, [{ id: 'closed', along: 5, across: 30 }]), stale, { layout: PR.layout!.replace('1400', '5').replace('40', '30') });
  });

  test('no layout file: created', () => {
    const none = { ...PR, layout: null };
    expectParity(pinNodes(none, [{ id: 'p01', along: 1, across: 20 }]), none, {
      layout: '{"version": 1, "nodes": {"p01": {"lane": "purchasing", "along": 1, "across": 20}}}',
    });
  });

  test('unpin', () => {
    expectParity(unpinNodes(RICH, ['f02', 'r01', 'm01']), RICH, {
      layout: editJson(RICH.layout, (js) => { delete js.nodes.r01; delete js.nodes.f02; }),
    });
    expectParity(unpinNodes(PR, ['closed']), PR, { layout: '{"version": 1, "nodes": {}}' });
    expect(ok(unpinNodes({ ...PR, layout: null }, ['closed'])).files.layout).toBeNull();
    expect(ok(unpinNodes(PR, ['r01'])).files.layout).toBe(PR.layout);
  });

  test('re-layout all: no pins, hints kept; no file stays no file', () => {
    expectParity(clearAllPins(RICH), RICH, { layout: editJson(RICH.layout, (js) => { js.nodes = {}; }) });
    expectParity(clearAllPins(PR), PR, { layout: '{"version": 1, "nodes": {}}' });
    expect(ok(clearAllPins({ ...PR, layout: null })).files.layout).toBeNull();
  });

  test('refusals', () => {
    expect(refused(pinNodes(PR, [{ id: 'nope', along: 0, across: 0 }]))).toMatch(/no block/);
  });
});

describe('P11 duplicate (UI13, as amended by A12)', () => {
  const layout = fakeLayout([
    { id: 'r01', lane: 'requester', x: 300, y: 140 }, { id: 'loose', lane: '_unassigned', x: 50, y: 700 },
    { id: 'f02', lane: 'finance', x: 700, y: 430 }, { id: 'stray', lane: '_unassigned', x: 90, y: 790 },
    { id: 'ghost', lane: '_unassigned', x: 200, y: 700 },
  ], { requester: 100, manager: 250, finance: 400, empty: 550, _unassigned: 680 });

  test('a block with metadata: id derived from the original, same shape, label, class and lane, metadata copied, pinned +40/+40', () => {
    const r = duplicateNodes(RICH, ['r01'], layout);
    expect(ok(r).ids).toEqual(['r01-2']);
    expectParity(r, RICH, {
      mmd: edit(RICH_MMD, ['  r01["Fill the form"];\n', '  r01["Fill the form"];\n  r01-2["Fill the form"]\n']),
      config: edit(RICH.config!, ['    note: gone from the diagram\n', '    note: gone from the diagram\n  r01-2:\n    system: excel\n    confidence: confirmed\n']),
      layout: editJson(RICH.layout, (js) => { js.nodes['r01-2'] = pin('requester', 340, 80); }),
    });
  });

  test('purchase-request: a block with a list and a map in its metadata', () => {
    const lay = fakeLayout([{ id: 'p05', lane: 'purchasing', x: 900, y: 420 }], { purchasing: 380 });
    const r = duplicateNodes(PR, ['p05'], lay);
    expectParity(r, PR, {
      mmd: edit(PR.mmd, ['    p07["Create the PO in the ERP"]\n', '    p07["Create the PO in the ERP"]\n    p05-2["Get three quotes"]\n']),
      config: `${PR.config}  p05-2:
    kind: wait
    confidence: single-source
    source: [pat-09-04]
    open_question: Are three quotes required, or just the habit?
    variants:
      main plant: three quotes over $1,000
      warehouse: one quote is fine under $5,000
`,
      layout: editJson(PR.layout, (js) => { js.nodes['p05-2'] = pin('purchasing', 940, 80); }),
    });
  });

  test('several blocks: ids, declarations, config entries and pins in file declaration order; class kept; lines between them copied', () => {
    const r = duplicateNodes(RICH, ['f02', 'stray', 'r01', 'loose'], layout);
    expect(ok(r).ids).toEqual(['loose-2', 'stray-2', 'r01-2', 'f02-2']);
    expect(ok(r).from).toEqual(['loose', 'stray', 'r01', 'f02']);
    const after = expectParity(r, RICH, {
      mmd: edit(RICH_MMD,
        ['stray{"Stray question?"}:::hot\n', 'stray{"Stray question?"}:::hot\nloose-2["Loose end"]\nstray-2{"Stray question?"}:::hot\n'],
        ['  r01["Fill the form"];\n', '  r01["Fill the form"];\n  r01-2["Fill the form"]\n'],
        ['  f02[/"Invoice #35;quot; copy"/]\n', '  f02[/"Invoice #35;quot; copy"/]\n  f02-2[/"Invoice #35;quot; copy"/]\n'],
        // loose --> stray is the only line with both ends duplicated; its copy goes at the end of the edge section.
        ['loose --> stray\n', 'loose --> stray\nloose-2 --> stray-2\n']),
      config: edit(RICH.config!, ['    note: gone from the diagram\n', '    note: gone from the diagram\n  r01-2:\n    system: excel\n    confidence: confirmed\n']),
      layout: editJson(RICH.layout, (js) => {
        js.nodes['loose-2'] = pin('_unassigned', 90, 60);
        js.nodes['stray-2'] = pin('_unassigned', 130, 150);
        js.nodes['r01-2'] = pin('requester', 340, 80);
        js.nodes['f02-2'] = pin('finance', 740, 70);
      }),
    });
    expect(Object.keys(JSON.parse(after.layout!).nodes)).toEqual(['r01', 'stray', 'n2', 'f02', 'loose-2', 'stray-2', 'r01-2', 'f02-2']);
  });

  test('a never-declared node is copied as a declared step in Unassigned', () => {
    expectParity(duplicateNodes(RICH, ['ghost'], layout), RICH, {
      mmd: edit(RICH_MMD, ['stray{"Stray question?"}:::hot\n', 'stray{"Stray question?"}:::hot\nghost-2["ghost"]\n']),
      layout: editJson(RICH.layout, (js) => { js.nodes['ghost-2'] = pin('_unassigned', 240, 60); }),
    });
  });

  test('top-to-bottom: along is y, across is x from the lane\'s left edge', () => {
    const tb = fakeLayout([{ id: 'r01', lane: 'requester', x: 130, y: 500 }], { requester: 100 }, 'TB');
    expect(positionInLane(tb, 'r01')).toEqual({ along: 500, across: 30 });
    expect(JSON.parse(ok(duplicateNodes(RICH, ['r01'], tb)).files.layout!).nodes['r01-2']).toEqual(pin('requester', 540, 70));
  });

  test('refusals: unknown block, no position', () => {
    expect(refused(duplicateNodes(RICH, ['nope'], layout))).toMatch(/no block/);
    expect(refused(duplicateNodes(RICH, ['m01'], layout))).toMatch(/no position/);
  });
});
