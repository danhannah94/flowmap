// The three rules that apply to every operation (design.md §8.2), for the v1.1 operations and the in-step changes to
// the v1.0 ones: files with errors (UI31, including a config whose note ids clash, §4), undo by snapshot (UI28, P30:
// undo restores all three files byte for byte), and undo of created files.
import { loadDocument } from '../document';
import type { LayoutOutput } from '../layout';
import { parseLayoutFile, serializeLayoutFile } from '../layoutfile';
import * as ops from './index';
import type { Files, OpResult } from './index';
import { ok, refused } from './testkit';
import { handPoint, layoutOf, SHAPE, SHAPE_CONFIG, SHAPE_LAYOUT, SHAPE_MMD } from './testkit-v11';

const P0 = (x: number, y: number) => handPoint(layoutOf(SHAPE), x, y);

/** SHAPE plus a note, a manual line with sides and a label position, and a placed title. */
const BASE: Files = {
  mmd: SHAPE_MMD,
  config: `${SHAPE_CONFIG}notes:\n  note1:\n    text: A remark\n`,
  layout: serializeLayoutFile(parseLayoutFile(JSON.stringify({
    ...JSON.parse(SHAPE_LAYOUT),
    edges: { 'c->d': { source_side: 'right', target_side: 'left', points: [P0(300, 160)], label_at: 0.4 } },
    notes: { note1: { x: 10, y: -40 } },
    title: { x: 0, y: -48 },
  })).file!),
};

/** The current layout of `f`, as the UI would pass it (the good files' when the `.mmd` has errors: none is drawn). */
function L(f: Files): LayoutOutput {
  return loadDocument(f.mmd, f.config, f.layout, 'x.mmd').layout ?? layoutOf(BASE);
}
type Op = (f: Files) => OpResult<object>;

/** One call of every v1.1 operation, and of every v1.0 operation v1.1 keeps in step, on BASE's ids. */
const EVERY_OP: [string, Op][] = [
  ['resizeNode se', (f) => ops.resizeNode(f, L(f), 'a', 'se', { dx: 10, dy: 10 })],
  ['resizeNode nw', (f) => ops.resizeNode(f, L(f), 'a', 'nw', { dx: -10, dy: -10 })],
  ['resetSize', (f) => ops.resetSize(f, ['a'])],
  ['setBlockColors', (f) => ops.setBlockColors(f, ['a'], 'fill', '#fff', '#000')],
  ['applySwatch', (f) => ops.applySwatch(f, ['a'], '#fff', null)],
  ['resetBlockColors', (f) => ops.resetBlockColors(f, ['a'])],
  ['makeManual', (f) => ops.makeManual(f, L(f), 'a->d')],
  ['dragSegment', (f) => ops.dragSegment(f, L(f), 'a->c', 0, { dx: 20, dy: 0 })],
  ['dragBend', (f) => ops.dragBend(f, L(f), 'c->d', 0, { x: 250, y: 150 })],
  ['addBend', (f) => ops.addBend(f, L(f), 'a->b', { x: 250, y: 50 })],
  ['removeBend', (f) => ops.removeBend(f, L(f), 'c->d', 0)],
  ['resetLine', (f) => ops.resetLine(f, 'c->d')],
  ['setLabelAt', (f) => ops.setLabelAt(f, L(f), 'a->d', { x: 300, y: 72 })],
  ['resetLabelAt', (f) => ops.resetLabelAt(f, 'c->d')],
  ['connect with a side', (f) => ops.connect(f, 'a', 'd', { source_side: 'top' })],
  ['connect by clicking', (f) => ops.connect(f, 'b', 'c')],
  ['reconnect to another block', (f) => ops.reconnect(f, 'c->d', 'target', 'b', 'bottom')],
  ['reconnect to another port', (f) => ops.reconnect(f, 'c->d', 'source', 'c', 'bottom')],
  ['addNote', (f) => ops.addNote(f, { text: 'New', at: { x: 5, y: 5 } }, L(f))],
  ['setNoteText', (f) => ops.setNoteText(f, 'note1', 'Changed')],
  ['setNoteText blank', (f) => ops.setNoteText(f, 'note1', ' ')],
  ['moveNote', (f) => ops.moveNote(f, 'note1', { x: 1, y: 2 }, L(f))],
  ['setNoteStyle', (f) => ops.setNoteStyle(f, 'note1', { bold: true })],
  ['deleteNote', (f) => ops.deleteNote(f, 'note1')],
  ['moveTitle', (f) => ops.moveTitle(f, { x: 3, y: -30 }, L(f))],
  ['resetTitlePosition', (f) => ops.resetTitlePosition(f)],
  ['hideTitle', (f) => ops.hideTitle(f)],
  ['showTitle', (f) => ops.showTitle(f)],
  ['addNodeAt', (f) => ops.addNodeAt(f, 'step', { x: 700, y: 20 }, L(f))],
  ['deleteOrphanEdgeEntry', (f) => ops.deleteOrphanEdgeEntry(f, 'x->y')],
  ['deleteOrphanNoteEntry', (f) => ops.deleteOrphanNoteEntry(f, 'gone')],
  ['deleteItems edge', (f) => ops.deleteItems(f, { edges: ['a->c'] })],
  ['deleteItems node', (f) => ops.deleteItems(f, { nodes: ['c'] })],
  ['renameNode', (f) => ops.renameNode(f, 'c', 'gamma')],
  ['renameLane', (f) => ops.renameLane(f, 'bottom', 'lower')],
  ['deleteLane', (f) => ops.deleteLane(f, 'bottom', { mode: 'move', target: 'top' })],
  ['setDirection', (f) => ops.setDirection(f, 'TB')],
  ['clearAllPins', (f) => ops.clearAllPins(f)],
  ['duplicateNodes', (f) => ops.duplicateNodes(f, ['a'], L(f))],
];

describe('files with errors (§8.2, UI31)', () => {
  const BAD_MMD = { ...BASE, mmd: `${SHAPE_MMD}  a -- b\n` };

  test.each(EVERY_OP)('an .mmd with errors refuses %s', (_name, op) => {
    expect(refused(op(BAD_MMD))).toMatch(/\.mmd file has errors \(E-syntax at line \d+\)/);
  });

  // Always refused with a config that has errors: they always write it (or, for notes, can't read it).
  const CONFIG_WRITERS = new Set([
    'setBlockColors', 'applySwatch', 'resetBlockColors', 'addNote', 'setNoteText', 'setNoteText blank', 'moveNote',
    'setNoteStyle', 'deleteNote', 'hideTitle', 'showTitle',
  ]);
  // v1.0's rule (R6.2): refused only when the broken text mentions an id they would change there.
  const CONFIG_IF_MENTIONED: Record<string, string[]> = {
    renameNode: ['c'], renameLane: ['bottom'], deleteLane: ['bottom'], duplicateNodes: ['a'],
  };

  // version 2 is E-config (its text mentions a lot of the ids).
  const BAD_CONFIG = { ...BASE, config: BASE.config!.replace('version: 1', 'version: 2') };
  // A note id equal to a block id is E-config too (§4), as the UI treats it (UI31).
  const CLASH = { ...BASE, config: `${BASE.config}  c:\n    text: clashes with block c\n` };

  test('the clash is E-config for the document too', () => {
    expect(loadDocument(CLASH.mmd, CLASH.config, CLASH.layout, 'x.mmd').problems.errors.map((e) => e.code)).toEqual(['E-config']);
  });

  test.each(EVERY_OP)('a config with errors: %s is refused if it could edit the config, else never touches it', (name, op) => {
    for (const files of [BAD_CONFIG, CLASH]) {
      const r = op(files);
      const deps = CONFIG_IF_MENTIONED[name];
      if (CONFIG_WRITERS.has(name) || deps?.some((id) => ops.mentions(files.config!, id))) {
        expect(refused(r)).toMatch(/config file has errors/);
      } else expect(ok(r).files.config).toBe(files.config);
    }
  });

  test('which of those the two broken configs refuse', () => {
    expect(refused(ops.renameNode(CLASH, 'c', 'gamma'))).toMatch(/config file has errors/); // mentions c
    expect(ok(ops.renameNode(BAD_CONFIG, 'c', 'gamma')).files.config).toBe(BAD_CONFIG.config);
  });

  test('a clashing config: ids it mentions count as taken', () => {
    expect(ok(ops.addNode(CLASH, { shape: 'step', lane: 'top' })).id).toBe('n1');
    const withN1 = { ...CLASH, config: `${CLASH.config}  n1:\n    text: one\n` };
    expect(ok(ops.addNode(withN1, { shape: 'step', lane: 'top' })).id).toBe('n2');
  });

  // A non-integer coordinate is E-layout; the text mentions every id, the lanes, note1, title and the sides.
  const BAD_LAYOUT = { ...BASE, layout: BASE.layout!.replace('"along": 40, "across": 40', '"along": 40.5, "across": 40') };
  const LAYOUT_WRITERS = new Set([
    'resizeNode se', 'resizeNode nw', 'resetSize', 'makeManual', 'dragSegment', 'dragBend', 'addBend', 'removeBend',
    'resetLine', 'setLabelAt', 'resetLabelAt', 'connect with a side', 'reconnect to another block',
    'reconnect to another port', 'addNote', 'setNoteText blank', 'moveNote', 'deleteNote', 'moveTitle',
    'resetTitlePosition', 'addNodeAt', 'deleteOrphanEdgeEntry', 'deleteOrphanNoteEntry', 'deleteItems node',
    'renameNode', 'renameLane', 'deleteLane', 'setDirection', 'clearAllPins', 'duplicateNodes',
  ]);

  test.each(EVERY_OP)('a layout file with errors: %s is refused if it could edit it, else never touches it', (name, op) => {
    const r = op(BAD_LAYOUT);
    if (LAYOUT_WRITERS.has(name)) expect(refused(r)).toMatch(/layout file has errors/);
    else expect(ok(r).files.layout).toBe(BAD_LAYOUT.layout);
  });

  test('a layout file with errors: edits whose lines it doesn\'t mention go ahead without touching it', () => {
    const plain = { ...SHAPE, layout: '{"version": 1, "nodes": {"zz": {"lane": "top", "along": 1.5, "across": 0}}}' };
    for (const r of [
      ops.deleteItems(plain, { edges: ['a->c'] }), ops.reconnect(plain, 'a->c', 'target', 'b'),
      ops.deleteLane(plain, 'bottom', { mode: 'move', target: 'top' }), ops.setDirection(plain, 'TB'),
      ops.connect(plain, 'b', 'a'), ops.resetLabelAt(plain, 'a->d'), ops.resetLine(plain, 'a->d'),
    ]) expect(ok(r).files.layout).toBe(plain.layout);
  });
});

describe('refusals of the v1.1 operations', () => {
  test('unknown ids', () => {
    const out = layoutOf(BASE);
    expect(refused(ops.resizeNode(BASE, out, 'zz', 'e', { dx: 1, dy: 0 }))).toMatch(/no block/);
    expect(refused(ops.makeManual(BASE, out, 'x->y'))).toMatch(/no line/);
    expect(refused(ops.resetLine(BASE, 'x->y'))).toMatch(/no line/);
    expect(refused(ops.connect(BASE, 'a', 'zz', { source_side: 'top' }))).toMatch(/no block/);
    expect(refused(ops.reconnect(BASE, 'c->d', 'target', 'zz', 'top'))).toMatch(/no block/);
    expect(refused(ops.setNoteStyle(BASE, 'zz', { bold: true }))).toMatch(/no note/);
    expect(refused(ops.setBlockColors(BASE, ['a', 'zz'], 'fill', '#fff', null))).toMatch(/no block/);
    expect(refused(ops.resetBlockColors(BASE, ['zz']))).toMatch(/no block/);
    expect(refused(ops.addNodeAt(BASE, 'hexagon' as 'step', { x: 0, y: 0 }, out))).toMatch(/shape/);
  });

  test('a layout argument is required where the drawn diagram is read', () => {
    expect(refused(ops.dragBend(BASE, undefined as never, 'c->d', 0, { x: 0, y: 0 }))).toMatch(/current layout/);
  });
});

describe('undo (UI28, P30): by snapshot, and by the reverse operation', () => {
  test.each(EVERY_OP)('%s is deterministic and leaves its input alone (so the snapshot is the input)', (_name, op) => {
    const input = Object.freeze({ ...BASE });
    const a = op(input);
    const b = op(input);
    expect(a).toEqual(b);
    expect(input).toEqual(BASE);
    // Restoring the snapshot restores every byte; nothing an operation returns aliases its input.
    expect(ok(a).files).not.toBe(input);
  });

  // BASE is in written form (canonical .mmd, the serializer's layout file), so a reverse gives back its bytes.
  const NO_TITLE = { ...BASE, layout: serializeLayoutFile({ ...parseLayoutFile(BASE.layout).file!, title: undefined }) };
  const pairs: [string, Files, Op, Op][] = [
    ['add a note and delete it', BASE, (f) => ops.addNote(f, { text: 'x', at: { x: 1, y: 1 } }), (f) => ops.deleteNote(f, 'note2')],
    ['hide the title and show it', BASE, (f) => ops.hideTitle(f), (f) => ops.showTitle(f)],
    ['move the title and reset it', NO_TITLE, (f) => ops.moveTitle(f, { x: 4, y: -20 }), (f) => ops.resetTitlePosition(f)],
    ['place a label and reset it', BASE, (f) => ops.setLabelAt(f, L(f), 'a->d', { x: 300, y: 72 }), (f) => ops.resetLabelAt(f, 'a->d')],
    ['connect from a side and delete the line', BASE, (f) => ops.connect(f, 'b', 'c', { source_side: 'left' }), (f) => ops.deleteItems(f, { edges: ['b->c'] })],
    ['colour a block and reset it', BASE, (f) => ops.setBlockColors(f, ['a'], 'border_color', '#123', null), (f) => ops.resetBlockColors(f, ['a'])],
    ['resize a block and reset its size', BASE, (f) => ops.resizeNode(f, L(f), 'a', 'se', { dx: 30, dy: 30 }), (f) => ops.resetSize(f, ['a'])],
    ['bend a line and reset it', BASE, (f) => ops.addBend(f, L(f), 'a->b', { x: 250, y: 50 }), (f) => ops.resetLine(f, 'a->b')],
    ['bold a note and unbold it', BASE, (f) => ops.setNoteStyle(f, 'note1', { bold: true }), (f) => ops.setNoteStyle(f, 'note1', { bold: false })],
    ['flip the direction twice (sides, notes, title)', BASE, (f) => ops.setDirection(f, 'TB'), (f) => ops.setDirection(f, 'LR')],
    ['rename a block with line entries and back', BASE, (f) => ops.renameNode(f, 'c', 'gamma'), (f) => ops.renameNode(f, 'gamma', 'c')],
    ['rename a lane with bend points and back', BASE, (f) => ops.renameLane(f, 'bottom', 'lower'), (f) => ops.renameLane(f, 'lower', 'bottom')],
    ['move a side to another port and back', BASE, (f) => ops.reconnect(f, 'c->d', 'source', 'c', 'top'), (f) => ops.reconnect(f, 'c->d', 'source', 'c', 'right')],
  ];

  test.each(pairs)('%s gives back the original bytes', (_name, start, forward, back) => {
    const mid = ok(forward(start)).files;
    expect(mid).not.toEqual(start);
    expect(ok(back(mid)).files).toEqual(start);
  });
});

describe('files that don\'t exist stay absent unless the operation creates them (UI28)', () => {
  const NONE: Files = { mmd: SHAPE_MMD, config: null, layout: null };
  const CREATES_CONFIG = new Set(['setBlockColors', 'applySwatch', 'addNote', 'hideTitle']);
  const CREATES_LAYOUT = new Set([
    'resizeNode se', 'resizeNode nw', 'makeManual', 'dragSegment', 'dragBend', 'addBend', 'removeBend', 'setLabelAt',
    'connect with a side', 'reconnect to another block', 'reconnect to another port', 'addNote', 'moveTitle',
    'addNodeAt', 'duplicateNodes',
  ]);

  test.each(EVERY_OP)('%s', (name, op) => {
    const r = op(NONE);
    if (!r.ok) {
      // Only the note operations need something that isn't there, and bend points that the unpinned layout's
      // straighter c->d doesn't have.
      expect(r.error).toMatch(name.includes('Bend') ? /no bend point/ : /no note/);
      return;
    }
    if (CREATES_CONFIG.has(name)) expect(r.files.config).toMatch(/^version: 1\n/);
    else expect(r.files.config).toBeNull();
    if (CREATES_LAYOUT.has(name)) expect(JSON.parse(r.files.layout!).version).toBe(1);
    else expect(r.files.layout).toBeNull();
  });
});
