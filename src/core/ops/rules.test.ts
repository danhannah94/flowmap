// The three rules that apply to every operation (design.md §8.2): Order, files with errors, and undo of created
// files (UI28, P20: undo restores all three files byte for byte).
import { parseLayoutFile, serializeLayoutFile } from '../layoutfile';
import type { LayoutResult } from '../types';
import * as ops from './index';
import type { Files, OpResult } from './index';
import { canon, ok, PR, refused, RICH, RICH_MMD } from './testkit';

const LAYOUT: LayoutResult = {
  direction: 'LR', width: 1000, height: 1000,
  lanes: [{ id: 'requester', label: 'R', x: 0, y: 0, width: 1000, height: 100 }, { id: '_unassigned', label: 'U', x: 0, y: 500, width: 1000, height: 100 }],
  nodes: [
    { id: 'r01', lane: 'requester', kind: 'step', label: 'x', x: 10, y: 20, width: 10, height: 10, pinned: false },
    { id: 'loose', lane: '_unassigned', kind: 'step', label: 'x', x: 10, y: 520, width: 10, height: 10, pinned: false },
  ],
  edges: [],
};

/** One call of every operation, on the rich files' ids. */
const EVERY_OP: [string, (f: Files) => OpResult<object>][] = [
  ['addNode', (f) => ops.addNode(f, { shape: 'step', lane: 'requester' })],
  ['addNode pinned', (f) => ops.addNode(f, { shape: 'step', lane: 'requester', pin: { along: 1, across: 20 } })],
  ['changeShape', (f) => ops.changeShape(f, 'r01', 'decision')],
  ['setNodeLabel', (f) => ops.setNodeLabel(f, 'r01', 'X')],
  ['renameNode', (f) => ops.renameNode(f, 'r01', 'form01')],
  ['pinNodes', (f) => ops.pinNodes(f, [{ id: 'r01', along: 5, across: 20 }])],
  ['moveNodesToLane', (f) => ops.moveNodesToLane(f, ['r01'], 'manager')],
  ['moveNodesToLane dragged', (f) => ops.moveNodesToLane(f, ['r01'], 'manager', { pins: [{ id: 'r01', along: 5, across: 20 }] })],
  ['unpinNodes', (f) => ops.unpinNodes(f, ['r01'])],
  ['clearAllPins', (f) => ops.clearAllPins(f)],
  ['duplicateNodes', (f) => ops.duplicateNodes(f, ['r01'], LAYOUT)],
  ['deleteItems', (f) => ops.deleteItems(f, { nodes: ['r01'], edges: ['m01->m02'] })],
  ['connect', (f) => ops.connect(f, 'loose', 'r01')],
  ['reconnect', (f) => ops.reconnect(f, 'intake->r01', 'target', 'm01')],
  ['setEdgeLabel', (f) => ops.setEdgeLabel(f, 'intake->r01', 'go')],
  ['addLane', (f) => ops.addLane(f, 'QA')],
  ['setLaneLabel', (f) => ops.setLaneLabel(f, 'finance', 'Money')],
  ['renameLane', (f) => ops.renameLane(f, 'requester', 'req')],
  ['reorderLanes', (f) => ops.reorderLanes(f, ['empty', 'finance', 'manager', 'requester'])],
  ['moveLane', (f) => ops.moveLane(f, 'empty', 'up')],
  ['deleteLane empty', (f) => ops.deleteLane(f, 'empty', { mode: 'empty' })],
  ['deleteLane move', (f) => ops.deleteLane(f, 'finance', { mode: 'move', target: '_unassigned' })],
  ['deleteLane delete', (f) => ops.deleteLane(f, 'finance', { mode: 'delete' })],
  ['setTitle', (f) => ops.setTitle(f, 'T')],
  ['setDirection', (f) => ops.setDirection(f, 'TB')],
  ['setNodeField', (f) => ops.setNodeField(f, 'r01', 'k', { type: 'text', value: 'v' })],
  ['setFieldOnNodes', (f) => ops.setFieldOnNodes(f, ['r01', 'm02'], 'k', { type: 'list', items: ['v'] })],
  ['removeNodeField', (f) => ops.removeNodeField(f, 'r01', 'system')],
  ['removeFieldFromNodes', (f) => ops.removeFieldFromNodes(f, ['r01', 'm01'], 'kind')],
  ['replaceNodeEntry', (f) => ops.replaceNodeEntry(f, 'r01', 'a: b')],
  ['addRule', (f) => ops.addRule(f)],
  ['deleteRule', (f) => ops.deleteRule(f, 0)],
  ['moveRule', (f) => ops.moveRule(f, 0, 'down')],
  ['setRuleLegend', (f) => ops.setRuleLegend(f, 0, 'L')],
  ['setMatchCondition', (f) => ops.setMatchCondition(f, 0, 'k', { op: 'present' })],
  ['editMatchCondition', (f) => ops.editMatchCondition(f, 0, 'id', 'k', { op: 'absent' })],
  ['removeMatchCondition', (f) => ops.removeMatchCondition(f, 0, 'id')],
  ['setStyleProp', (f) => ops.setStyleProp(f, 0, 'badge', 'b')],
  ['setStyleColor', (f) => ops.setStyleColor(f, 0, 'fill', '#fff', '#000')],
  ['replaceStyles', (f) => ops.replaceStyles(f, '[]')],
  ['deleteOrphanNodeEntry', (f) => ops.deleteOrphanNodeEntry(f, 'n1')],
  ['deleteOrphanLaneEntry', (f) => ops.deleteOrphanLaneEntry(f, 'archive')],
  ['deleteOrphanPin', (f) => ops.deleteOrphanPin(f, 'n2')],
];

describe('files with errors (§8.2, UI31)', () => {
  const BAD_MMD = { ...RICH, mmd: `${RICH_MMD}a -- b\n` };

  test.each(EVERY_OP)('an .mmd with errors refuses %s', (_name, op) => {
    expect(refused(op(BAD_MMD))).toMatch(/\.mmd file has errors \(E-syntax at line \d+\)/);
  });

  // version 2 is E-config; the text still mentions r01, m01, n1, lanes, requester, manager, finance…
  const BAD_CONFIG = { ...RICH, config: RICH.config!.replace('version: 1', 'version: 2') };
  const CONFIG_WRITERS = new Set([
    'renameNode', 'duplicateNodes', 'addLane', 'renameLane', 'reorderLanes', 'moveLane', 'deleteLane move',
    'deleteLane delete', 'setTitle', 'setNodeField', 'setFieldOnNodes', 'removeNodeField', 'removeFieldFromNodes',
    'replaceNodeEntry', 'addRule', 'deleteRule', 'moveRule', 'setRuleLegend', 'setMatchCondition', 'editMatchCondition',
    'removeMatchCondition', 'setStyleProp', 'setStyleColor', 'replaceStyles', 'deleteOrphanNodeEntry',
    'deleteOrphanLaneEntry',
  ]);

  test.each(EVERY_OP)('a config with errors: %s is refused if it could edit the config, else never touches it', (name, op) => {
    const r = op(BAD_CONFIG);
    if (CONFIG_WRITERS.has(name)) expect(refused(r)).toMatch(/config file has errors/);
    else expect(ok(r).files.config).toBe(BAD_CONFIG.config);
  });

  test('a config with errors: an operation on ids the config never mentions goes ahead without touching it', () => {
    const r = ok(ops.renameNode(BAD_CONFIG, 'm02', 'ok2'));
    expect(r.files.config).toBe(BAD_CONFIG.config);
    expect(r.files.mmd).toContain('ok2{"Approved?"}');
    expect(ok(ops.duplicateNodes(BAD_CONFIG, ['loose'], LAYOUT)).files.config).toBe(BAD_CONFIG.config);
    expect(ok(ops.deleteLane(BAD_CONFIG, 'empty', { mode: 'empty' })).files.config).toBe(BAD_CONFIG.config);
    // Ids mentioned in the broken file count as taken: n1 is skipped.
    expect(ok(ops.addNode(BAD_CONFIG, { shape: 'step', lane: 'requester' })).id).toBe('n3');
    const noLanes = { ...RICH, config: 'version: 2\n' };
    expect(ok(ops.addLane(noLanes, 'QA')).files.config).toBe('version: 2\n');
  });

  // A negative coordinate is E-layout; the text still mentions r01, stray, n2, f02 and the lanes.
  // A non-integer coordinate is malformed (negative ones are allowed since v1.1).
  const BAD_LAYOUT = { ...RICH, layout: RICH.layout!.replace('"along": 700', '"along": 700.5') };
  const LAYOUT_WRITERS = new Set([
    'addNode pinned', 'renameNode', 'pinNodes', 'moveNodesToLane', 'moveNodesToLane dragged', 'unpinNodes',
    'clearAllPins', 'duplicateNodes', 'deleteItems', 'renameLane', 'deleteLane move', 'deleteLane delete',
    'deleteOrphanPin',
  ]);

  test.each(EVERY_OP)('a layout file with errors: %s is refused if it could edit the pins, else never touches it', (name, op) => {
    const r = op(BAD_LAYOUT);
    if (LAYOUT_WRITERS.has(name)) expect(refused(r)).toMatch(/layout file has errors/);
    else expect(ok(r).files.layout).toBe(BAD_LAYOUT.layout);
  });

  test('a layout file with errors: blocks it doesn\'t mention can still be deleted, moved and renamed', () => {
    for (const r of [
      ops.deleteItems(BAD_LAYOUT, { nodes: ['loose'] }), ops.moveNodesToLane(BAD_LAYOUT, ['loose'], 'finance'),
      ops.renameNode(BAD_LAYOUT, 'm02', 'ok2'), ops.unpinNodes(BAD_LAYOUT, ['loose']),
      ops.deleteLane(BAD_LAYOUT, 'empty', { mode: 'delete' }),
    ]) expect(ok(r).files.layout).toBe(BAD_LAYOUT.layout);
  });
});

describe('files that don\'t exist stay absent unless the operation creates them (UI28)', () => {
  const NONE = { ...RICH, config: null, layout: null };
  const CREATES_CONFIG = new Set(['reorderLanes', 'moveLane', 'setTitle', 'setNodeField', 'setFieldOnNodes', 'replaceNodeEntry', 'addRule', 'replaceStyles']);
  const CREATES_LAYOUT = new Set(['addNode pinned', 'pinNodes', 'moveNodesToLane dragged', 'duplicateNodes']);

  test.each(EVERY_OP)('%s', (name, op) => {
    const r = op(NONE);
    if (!r.ok) {
      // Only rule and field operations that need something in the config can fail on an empty one.
      expect(name).toMatch(/Rule|Match|Style|Orphan|removeNode|removeField/);
      return;
    }
    if (CREATES_CONFIG.has(name)) expect(r.files.config).toMatch(/^version: 1\n/);
    else expect(r.files.config).toBeNull();
    if (CREATES_LAYOUT.has(name)) expect(JSON.parse(r.files.layout!).version).toBe(1);
    else expect(r.files.layout).toBeNull();
  });

  test('restoring the snapshot restores "no file"', () => {
    const snapshot: Files = { ...NONE };
    const r = ok(ops.setTitle(NONE, 'T'));
    expect(r.files.config).not.toBeNull();
    expect(snapshot).toEqual(NONE);
    expect(ok(ops.setDirection(snapshot, 'LR')).files).toEqual({ ...NONE, mmd: canon(RICH_MMD) });
  });
});

describe('undo by snapshot and by the reverse operation (UI28, P20)', () => {
  test.each(EVERY_OP)('%s is deterministic and leaves its input alone (so the snapshot is the input)', (_name, op) => {
    const input = Object.freeze({ ...RICH });
    const a = op(input);
    const b = op(input);
    expect(a).toEqual(b);
    expect(input).toEqual(RICH);
  });

  // With every file already in the form the writers produce, a reverse operation gives back the original bytes.
  const BASE: Files = {
    mmd: canon(RICH_MMD),
    config: RICH.config,
    layout: serializeLayoutFile(parseLayoutFile(RICH.layout).file!),
  };
  const pairs: [string, (f: Files) => OpResult<object>, (f: Files) => OpResult<object>][] = [
    ['rename a block and back', (f) => ops.renameNode(f, 'r01', 'form'), (f) => ops.renameNode(f, 'form', 'r01')],
    ['rename a lane and back', (f) => ops.renameLane(f, 'requester', 'req'), (f) => ops.renameLane(f, 'req', 'requester')],
    ['flip the direction twice', (f) => ops.setDirection(f, 'TB'), (f) => ops.setDirection(f, 'LR')],
    ['change a shape and back', (f) => ops.changeShape(f, 'm02', 'io'), (f) => ops.changeShape(f, 'm02', 'decision')],
    ['edit a label and back', (f) => ops.setNodeLabel(f, 'f01', 'x'), (f) => ops.setNodeLabel(f, 'f01', 'Wait for budget')],
    ['label an edge and clear it', (f) => ops.setEdgeLabel(f, 'intake->r01', 'go'), (f) => ops.setEdgeLabel(f, 'intake->r01', '')],
    ['connect and delete the edge', (f) => ops.connect(f, 'loose', 'm02'), (f) => ops.deleteItems(f, { edges: ['loose->m02'] })],
    ['reconnect and back', (f) => ops.reconnect(f, 'r01->m01', 'source', 'loose'), (f) => ops.reconnect(f, 'loose->m01', 'source', 'r01')],
    ['move the last block of a lane away and back', (f) => ops.moveNodesToLane(f, ['m02'], 'finance'), (f) => ops.moveNodesToLane(f, ['m02'], 'manager')],
    ['add a lane and delete it', (f) => ops.addLane(f, 'QA'), (f) => ops.deleteLane(f, 'qa', { mode: 'empty' })],
    ['pin and unpin', (f) => ops.pinNodes(f, [{ id: 'm01', along: 1, across: 20 }]), (f) => ops.unpinNodes(f, ['m01'])],
    ['add a block and delete it', (f) => ops.addNode(f, { shape: 'delay', lane: 'finance' }), (f) => ops.deleteItems(f, { nodes: ['n3'] })],
    ['set a new field and delete it', (f) => ops.setNodeField(f, 'm02', 'k', { type: 'text', value: 'v' }), (f) => ops.removeNodeField(f, 'm02', 'k')],
    ['add a field to an entry and delete it', (f) => ops.setNodeField(f, 'r01', 'k', { type: 'text', value: 'v' }), (f) => ops.removeNodeField(f, 'r01', 'k')],
    ['add a rule and delete it', (f) => ops.addRule(f), (f) => ops.deleteRule(f, 3)],
    ['move a rule down and up', (f) => ops.moveRule(f, 1, 'down'), (f) => ops.moveRule(f, 2, 'up')],
    ['set a title and set it back', (f) => ops.setTitle(f, 'Other'), (f) => ops.setTitle(f, 'Rich purchase map')],
    ['add a condition and remove it', (f) => ops.setMatchCondition(f, 1, 'k', { op: 'present' }), (f) => ops.removeMatchCondition(f, 1, 'k')],
  ];

  test.each(pairs)('%s gives back the original bytes', (_name, forward, back) => {
    const mid = ok(forward(BASE)).files;
    expect(mid).not.toEqual(BASE);
    expect(ok(back(mid)).files).toEqual(BASE);
  });

  test('the purchase-request files are already in written form: a no-op writes the same bytes', () => {
    expect(ok(ops.setDirection(PR, 'LR')).files).toEqual(PR);
    expect(ok(ops.unpinNodes(PR, ['r01'])).files).toEqual(PR);
  });
});

describe('Order (§8.2): several blocks are handled in file declaration order', () => {
  test('unlaned first, then lanes in file order, then never-declared nodes', () => {
    const r = ok(ops.duplicateNodes(RICH, ['r01', 'loose'], LAYOUT));
    expect(r.from).toEqual(['loose', 'r01']);
    expect(r.ids).toEqual(['n3', 'n4']);
    const pins = ok(ops.pinNodes(RICH, [{ id: 'ghost', along: 1, across: 20 }, { id: 'f01', along: 1, across: 20 }, { id: 'intake', along: 1, across: 20 }]));
    expect(Object.keys(JSON.parse(pins.files.layout!).nodes)).toEqual(['r01', 'stray', 'n2', 'f02', 'intake', 'f01', 'ghost']);
  });
});
