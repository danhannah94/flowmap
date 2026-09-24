import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkLayoutRefs, clearPins, effectivePins, parseLayoutFile, pinFromDrop, removePin, removePins, renameLaneInPins,
  renamePinNode, serializeLayoutFile, setHints, setPin, setPins,
} from './index';
import type { LayoutFile } from '../types';

const FIXTURE = readFileSync(join(__dirname, '../../../fixtures/purchase-request/purchase-request.layout.json'), 'utf8');
const file = (nodes: LayoutFile['nodes'], hints?: unknown): LayoutFile => (hints === undefined ? { version: 1, nodes } : { version: 1, nodes, hints });
const P = (lane: string, along: number, across: number) => ({ lane, along, across });

describe('parseLayoutFile', () => {
  test('no file: null, no problems', () => {
    expect(parseLayoutFile(null)).toEqual({ file: null, problems: { errors: [], warnings: [] } });
  });
  test('the fixture parses and round-trips byte for byte', () => {
    const r = parseLayoutFile(FIXTURE);
    expect(r.problems.errors).toEqual([]);
    expect(r.file).toEqual(file({ closed: P('requester', 1400, 40) }));
    expect(serializeLayoutFile(r.file!)).toBe(FIXTURE);
  });
  test('hints are passed through opaquely', () => {
    const r = parseLayoutFile('{"version": 1, "nodes": {}, "hints": {"order": ["a", "b"], "x": [1, {"y": null}]}}');
    expect(r.file!.hints).toEqual({ order: ['a', 'b'], x: [1, { y: null }] });
    expect(parseLayoutFile('{"version":1,"nodes":{},"hints":[1,2]}').file!.hints).toEqual([1, 2]);
  });
  test.each([
    ['invalid JSON', '{"version": 1, "nodes": {'],
    ['empty text', ''],
    ['not an object', '[1]'],
    ['null', 'null'],
    ['missing version', '{"nodes": {}}'],
    ['version 2', '{"version": 2, "nodes": {}}'],
    ['version as string', '{"version": "1", "nodes": {}}'],
    ['missing nodes', '{"version": 1}'],
    ['nodes a list', '{"version": 1, "nodes": []}'],
    ['pin not an object', '{"version": 1, "nodes": {"a": [1, 2]}}'],
    ['negative along', '{"version": 1, "nodes": {"a": {"lane": "l", "along": -1, "across": 0}}}'],
    ['negative across', '{"version": 1, "nodes": {"a": {"lane": "l", "along": 0, "across": -5}}}'],
    ['non-integer', '{"version": 1, "nodes": {"a": {"lane": "l", "along": 1.5, "across": 0}}}'],
    ['string coordinate', '{"version": 1, "nodes": {"a": {"lane": "l", "along": "1", "across": 0}}}'],
    ['missing lane', '{"version": 1, "nodes": {"a": {"along": 1, "across": 0}}}'],
    ['lane not a string', '{"version": 1, "nodes": {"a": {"lane": 3, "along": 1, "across": 0}}}'],
    ['missing across', '{"version": 1, "nodes": {"a": {"lane": "l", "along": 1}}}'],
    ['extra pin key', '{"version": 1, "nodes": {"a": {"lane": "l", "along": 1, "across": 0, "x": 1}}}'],
    ['unknown top-level key', '{"version": 1, "nodes": {}, "extra": 1}'],
  ])('E-layout: %s (line null, no pins)', (_n, text) => {
    const r = parseLayoutFile(text);
    expect(r.file).toBeNull();
    expect(r.problems.errors.length).toBeGreaterThan(0);
    expect(r.problems.errors.every((p) => p.code === 'E-layout' && p.line === null)).toBe(true);
  });
  test('every bad pin is reported', () => {
    const r = parseLayoutFile('{"version": 1, "nodes": {"a": {"lane": "l", "along": -1, "across": 0}, "b": 3, "c": {"lane": "l", "along": 0, "across": 0}}}');
    expect(r.problems.errors).toHaveLength(2);
  });
  test('zero coordinates and a big integer written as 840.0 are fine', () => {
    expect(parseLayoutFile('{"version": 1, "nodes": {"a": {"lane": "l", "along": 0, "across": 0}, "b": {"lane": "_unassigned", "along": 840.0, "across": 3}}}').file)
      .toEqual(file({ a: P('l', 0, 0), b: P('_unassigned', 840, 3) }));
  });
});

describe('checking against the diagram', () => {
  const f = file({ a: P('l1', 10, 20), b: P('l1', 0, 12), gone: P('l1', 5, 5), u: P('_unassigned', 1, 1) });
  const nodes = [{ id: 'a', lane: 'l1' }, { id: 'b', lane: 'l2' }, { id: 'u', lane: '_unassigned' }, { id: 'c', lane: 'l1' }];
  test('W-layout-unknown-node for pins of ids not in the .mmd', () => {
    const w = checkLayoutRefs(f, nodes);
    expect(w).toEqual([{ code: 'W-layout-unknown-node', line: null, message: expect.stringContaining('gone') }]);
    expect(checkLayoutRefs(null, nodes)).toEqual([]);
  });
  test('effective pins: lane must still match (a moved node is placed automatically)', () => {
    expect([...effectivePins(f, nodes)]).toEqual([['a', P('l1', 10, 20)], ['u', P('_unassigned', 1, 1)]]);
    expect(effectivePins(null, nodes).size).toBe(0);
  });
});

describe('writes', () => {
  const base = file({ a: P('l1', 10, 20), b: P('l2', 30, 40) }, { keep: true });
  test('set a pin: new pins go last, existing ones change in place; creates a file', () => {
    expect(Object.keys(setPin(base, 'c', P('l1', 1, 2)).nodes)).toEqual(['a', 'b', 'c']);
    const moved = setPin(base, 'a', P('l3', 5, 6));
    expect(moved).toEqual(file({ a: P('l3', 5, 6), b: P('l2', 30, 40) }, { keep: true }));
    expect(base.nodes.a).toEqual(P('l1', 10, 20)); // inputs are not mutated
    expect(setPin(null, 'n1', P('l', 0, 12))).toEqual(file({ n1: P('l', 0, 12) }));
    expect(setPins(base, [['b', P('l2', 1, 1)], ['z', P('l2', 2, 2)]]).nodes).toEqual({ a: P('l1', 10, 20), b: P('l2', 1, 1), z: P('l2', 2, 2) });
    expect(() => setPin(base, 'x', P('l', -1, 0))).toThrow();
    expect(() => setPin(base, 'x', P('l', 1.5, 0))).toThrow();
  });
  test('drop positions are rounded, along >= 0, across >= 12', () => {
    expect(pinFromDrop('l', 10.6, 3.2)).toEqual(P('l', 11, 12));
    expect(pinFromDrop('l', -4, 40.4)).toEqual(P('l', 0, 40));
  });
  test('remove pins; no file stays no file', () => {
    expect(removePin(base, 'a')).toEqual(file({ b: P('l2', 30, 40) }, { keep: true }));
    expect(removePins(base, ['a', 'b', 'x'])).toEqual(file({}, { keep: true }));
    expect(removePin(null, 'a')).toBeNull();
  });
  test('clear all pins keeps hints', () => {
    expect(clearPins(base)).toEqual(file({}, { keep: true }));
    expect(serializeLayoutFile(clearPins(file({ a: P('l', 1, 1) }))!)).toBe('{\n  "version": 1,\n  "nodes": {}\n}\n');
    expect(clearPins(null)).toBeNull();
  });
  test('rename a node key in place', () => {
    const r = renamePinNode(file({ a: P('l', 1, 1), b: P('l', 2, 2), c: P('l', 3, 3) }), 'b', 'bb')!;
    expect(Object.keys(r.nodes)).toEqual(['a', 'bb', 'c']);
    expect(r.nodes.bb).toEqual(P('l', 2, 2));
    expect(renamePinNode(base, 'zz', 'y')).toBe(base);
    expect(renamePinNode(null, 'a', 'b')).toBeNull();
  });
  test('rename a lane in every pin', () => {
    const r = renameLaneInPins(file({ a: P('l1', 1, 1), b: P('l2', 2, 2), c: P('l1', 3, 3) }, 'h'), 'l1', 'x')!;
    expect(r).toEqual(file({ a: P('x', 1, 1), b: P('l2', 2, 2), c: P('x', 3, 3) }, 'h'));
    expect(renameLaneInPins(null, 'a', 'b')).toBeNull();
  });
  test('set hints (and remove them)', () => {
    expect(setHints(base, { v: 2 })).toEqual(file(base.nodes, { v: 2 }));
    expect(setHints(base, undefined)).toEqual(file(base.nodes));
    expect(setHints(null, [1])).toEqual(file({}, [1]));
  });
});

describe('serializeLayoutFile', () => {
  test('stable key order, 2-space JSON, parses back to the same file', () => {
    const f = file({ z: P('b', 1, 2), 'a"q': P('x y', 3, 4) }, { order: ['z'], deep: { k: [1, 2] } });
    const text = serializeLayoutFile(f);
    expect(text).toBe(`{
  "version": 1,
  "nodes": {
    "z": { "lane": "b", "along": 1, "across": 2 },
    "a\\"q": { "lane": "x y", "along": 3, "across": 4 }
  },
  "hints": {
    "order": [
      "z"
    ],
    "deep": {
      "k": [
        1,
        2
      ]
    }
  }
}
`);
    expect(parseLayoutFile(text).file).toEqual(f);
  });
  test('pin keys are written in order even if built out of order', () => {
    const f = { version: 1 as const, nodes: { a: { across: 2, along: 1, lane: 'l' } } };
    expect(serializeLayoutFile(f)).toContain('"a": { "lane": "l", "along": 1, "across": 2 }');
  });
});
