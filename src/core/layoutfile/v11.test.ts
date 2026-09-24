// v1.1 layout file (§5): every key and value rule, the checks against the diagram, effective placements, the writers
// (§8.2 "Keeping the layout file in step") and the stable text.
import {
  checkLayoutRefs, checkRanges, clearPins, clearPinsAndPoints, dropPointsInLanes, effectivePlacements, flipDirection,
  movePointsToLane, parseLayoutFile, rekeyEdges, rekeyEdgesByPosition, removeEdgeEntries, removeNodeEntries,
  removeNoteEntries, removePins, renameLane, renameLaneInPins, renameNode, renamePinNode, resetEdge,
  serializeLayoutFile, setEdgePoints, setEdgeSide, setHints, setLabelAt, setNotePosition, setPin, setPins, setSize,
  setSizes, setTitlePosition, splitEdgeId, updateEdge, updateEdges,
} from './index';
import type { LayoutFile } from '../types';

const P = (lane: string, along: number, across: number) => ({ lane, along, across });
const S = (width: number, height: number) => ({ width, height });

/** The §5 example, as written there. */
const EXAMPLE = `{
  "version": 1,
  "nodes": {
    "n07": { "lane": "finance", "along": 840, "across": 30, "width": 220, "height": 90 },
    "n08": { "width": 200, "height": 80 }
  },
  "edges": {
    "n07->n08": {
      "source_side": "bottom", "target_side": "left",
      "points": [{ "lane": "finance", "along": 900, "across": 140 }],
      "label_at": 0.3
    }
  },
  "notes": { "note1": { "x": 40, "y": -60 } },
  "title": { "x": 0, "y": -48 }
}`;

const layoutErrors = (text: string) => {
  const r = parseLayoutFile(text);
  return { file: r.file, codes: r.problems.errors.map((p) => [p.code, p.line]), messages: r.problems.errors.map((p) => p.message) };
};
const doc = (body: object) => JSON.stringify({ version: 1, nodes: {}, ...body });

describe('parse: every v1.1 key (§5)', () => {
  test('the §5 example parses to exactly its content', () => {
    const r = parseLayoutFile(EXAMPLE);
    expect(r.problems).toEqual({ errors: [], warnings: [] });
    expect(r.file).toEqual({
      version: 1,
      nodes: { n07: { ...P('finance', 840, 30), ...S(220, 90) }, n08: S(200, 80) },
      edges: { 'n07->n08': { source_side: 'bottom', target_side: 'left', points: [P('finance', 900, 140)], label_at: 0.3 } },
      notes: { note1: { x: 40, y: -60 } },
      title: { x: 0, y: -48 },
    });
  });
  test('a node entry holds a pin, a size, or both', () => {
    const f = parseLayoutFile(doc({ nodes: { a: P('l', 1, 2), b: S(40, 40), c: { ...S(300, 41), ...P('l', -3, 0) } } })).file!;
    expect(f.nodes).toEqual({ a: P('l', 1, 2), b: S(40, 40), c: { ...P('l', -3, 0), ...S(300, 41) } });
  });
  test('each edge field on its own', () => {
    const f = parseLayoutFile(doc({ edges: {
      'a->b': { source_side: 'top' }, 'b->c': { target_side: 'right' }, 'c->d': { label_at: 0 }, 'd->e': { label_at: 1 },
      'e->f': { points: [P('_unassigned', -10, -20), P('l2', 5, 0)] }, 'a->b#2': { label_at: 0.05 },
    } })).file!;
    expect(Object.keys(f.edges!)).toEqual(['a->b', 'b->c', 'c->d', 'd->e', 'e->f', 'a->b#2']);
    expect(f.edges!['e->f']!.points).toEqual([P('_unassigned', -10, -20), P('l2', 5, 0)]);
  });
  test('every side value', () => {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(parseLayoutFile(doc({ edges: { 'a->b': { source_side: side, target_side: side } } })).problems.errors).toEqual([]);
    }
  });
  test('label_at: 0 to 1 with at most two decimals', () => {
    for (const v of [0, 1, 0.5, 0.3, 0.29, 0.01, 0.99, 0.07, 1.0]) {
      expect(parseLayoutFile(doc({ edges: { 'a->b': { label_at: v } } })).file!.edges!['a->b']!.label_at).toBe(v);
    }
  });
  test('negative values where §5 allows them: along, note and title positions (and across, checked per lane later)', () => {
    const f = parseLayoutFile(doc({
      nodes: { a: P('l', -500, -7) }, edges: { 'a->b': { points: [P('l', -1, -1)] } },
      notes: { n: { x: -40, y: -60 } }, title: { x: -1, y: -2 },
    })).file!;
    expect(f.nodes.a).toEqual(P('l', -500, -7));
    expect(f.notes!.n).toEqual({ x: -40, y: -60 });
    expect(f.title).toEqual({ x: -1, y: -2 });
  });
  test('-0 reads as 0 and 840.0 as an integer', () => {
    const f = parseLayoutFile('{"version": 1, "nodes": {"a": {"lane": "l", "along": -0, "across": 840.0}}, "title": {"x": -0, "y": 0}}').file!;
    expect(Object.is(f.nodes.a!.along, 0)).toBe(true);
    expect(f.nodes.a!.across).toBe(840);
    expect(Object.is(f.title!.x, 0)).toBe(true);
  });
  test('empty edges and notes maps are accepted and dropped', () => {
    const r = parseLayoutFile(doc({ edges: {}, notes: {} }));
    expect(r.problems.errors).toEqual([]);
    expect(r.file).toEqual({ version: 1, nodes: {} });
  });
  test('hints may be anything and pass through untouched', () => {
    expect(parseLayoutFile(doc({ hints: [1, { a: null }] })).file!.hints).toEqual([1, { a: null }]);
    expect(parseLayoutFile(doc({ hints: null })).file!.hints).toBeNull();
  });
});

describe('parse: E-layout (line null, no placements) for anything else (§5 Problems)', () => {
  test.each([
    // empty entries
    ['an empty node entry', doc({ nodes: { a: {} } })],
    ['an empty edge entry', doc({ edges: { 'a->b': {} } })],
    ['an empty note entry', doc({ notes: { n: {} } })],
    ['an empty title', doc({ title: {} })],
    // node entries
    ['a partial pin (lane only)', doc({ nodes: { a: { lane: 'l' } } })],
    ['a partial pin (along, across)', doc({ nodes: { a: { along: 1, across: 1 } } })],
    ['a partial size (width only)', doc({ nodes: { a: { width: 100 } } })],
    ['a partial size beside a pin', doc({ nodes: { a: { ...P('l', 1, 1), height: 100 } } })],
    ['width below 40', doc({ nodes: { a: S(39, 40) } })],
    ['height below 40', doc({ nodes: { a: S(40, 39) } })],
    ['a negative size', doc({ nodes: { a: S(-100, 100) } })],
    ['a fractional size', doc({ nodes: { a: S(100.5, 100) } })],
    ['a string size', doc({ nodes: { a: { width: '100', height: 100 } } })],
    ['a null size', doc({ nodes: { a: { width: null, height: 100 } } })],
    ['an unknown node key', doc({ nodes: { a: { ...S(40, 40), depth: 3 } } })],
    ['a node entry that is a list', doc({ nodes: { a: [] } })],
    // edge entries
    ['a bad side', doc({ edges: { 'a->b': { source_side: 'middle' } } })],
    ['a side in capitals', doc({ edges: { 'a->b': { target_side: 'Left' } } })],
    ['a null side', doc({ edges: { 'a->b': { source_side: null } } })],
    ['points not a list', doc({ edges: { 'a->b': { points: P('l', 1, 1) } } })],
    ['points empty', doc({ edges: { 'a->b': { points: [] } } })],
    ['a point missing across', doc({ edges: { 'a->b': { points: [{ lane: 'l', along: 1 }] } } })],
    ['a point with a fractional along', doc({ edges: { 'a->b': { points: [P('l', 1.5, 1)] } } })],
    ['a point with an extra key', doc({ edges: { 'a->b': { points: [{ ...P('l', 1, 1), x: 1 }] } } })],
    ['a point with a numeric lane', doc({ edges: { 'a->b': { points: [{ lane: 2, along: 1, across: 1 }] } } })],
    ['a point that is a pair', doc({ edges: { 'a->b': { points: [[1, 2]] } } })],
    ['label_at below 0', doc({ edges: { 'a->b': { label_at: -0.01 } } })],
    ['label_at above 1', doc({ edges: { 'a->b': { label_at: 1.01 } } })],
    ['label_at with three decimals', doc({ edges: { 'a->b': { label_at: 0.333 } } })],
    ['label_at as a string', doc({ edges: { 'a->b': { label_at: '0.5' } } })],
    ['an unknown edge key', doc({ edges: { 'a->b': { label_at: 0.5, color: 'red' } } })],
    ['edges a list', doc({ edges: [] })],
    ['edges null', doc({ edges: null })],
    // notes and title
    ['a note missing y', doc({ notes: { n: { x: 1 } } })],
    ['a note with a fractional x', doc({ notes: { n: { x: 1.5, y: 1 } } })],
    ['a note with an extra key', doc({ notes: { n: { x: 1, y: 1, text: 'hi' } } })],
    ['a note position that is a number', doc({ notes: { n: 5 } })],
    ['notes a list', doc({ notes: [] })],
    ['a title missing x', doc({ title: { y: 1 } })],
    ['a title with a string y', doc({ title: { x: 1, y: '2' } })],
    ['a title with an extra key', doc({ title: { x: 1, y: 2, hidden: true } })],
    ['a null title', doc({ title: null })],
    // top level (v1.0 rules still apply)
    ['an unknown top-level key', doc({ labels: {} })],
    ['missing nodes', JSON.stringify({ version: 1, edges: {} })],
  ])('%s', (_name, text) => {
    const r = layoutErrors(text);
    expect(r.file).toBeNull();
    expect(r.codes.length).toBeGreaterThan(0);
    expect(r.codes.every(([code, line]) => code === 'E-layout' && line === null)).toBe(true);
  });
  test('every bad entry is reported, across sections', () => {
    const r = layoutErrors(doc({
      nodes: { a: {}, b: S(10, 10), ok: P('l', 1, 1) }, edges: { 'a->b': { label_at: 2 } }, notes: { n: {} }, title: {},
    }));
    expect(r.codes).toHaveLength(5);
    expect(r.messages.join('\n')).toMatch(/"a"[\s\S]*"b"[\s\S]*"a->b"[\s\S]*"n"[\s\S]*title/);
  });
});

describe('ranges that need the lane order: negative across only in the first lane (§5 Values)', () => {
  const f = (body: object) => parseLayoutFile(doc(body)).file!;
  test('pins and bend points in the first lane may be negative; elsewhere E-layout', () => {
    expect(checkRanges(f({ nodes: { a: P('first', -5, -5) }, edges: { 'a->b': { points: [P('first', -1, -30)] } } }), 'first')).toEqual([]);
    const bad = checkRanges(f({
      nodes: { a: P('second', 0, -1), s: S(40, 40) }, edges: { 'a->b': { points: [P('first', 0, -3), P('second', -9, -1)] }, 'b->c': { points: [P('x', 1, 0)] } },
    }), 'first');
    expect(bad.map((p) => [p.code, p.line])).toEqual([['E-layout', null], ['E-layout', null]]);
    expect(bad[0]!.message).toContain('"a"');
    expect(bad[1]!.message).toContain('"a->b" point 2');
  });
  test('a lane-free diagram: the first lane is _unassigned', () => {
    expect(checkRanges(f({ edges: { 'a->b': { points: [P('_unassigned', -4, -4)] } } }), '_unassigned')).toEqual([]);
  });
  test('negative along is fine in any lane', () => {
    expect(checkRanges(f({ nodes: { a: P('second', -100, 0) }, edges: { 'a->b': { points: [P('second', -100, 0)] } } }), 'first')).toEqual([]);
  });
  test('checked whether or not the entry applies (a stale lane is still out of range)', () => {
    expect(checkRanges(f({ nodes: { gone: P('nope', 0, -1) } }), 'first')).toHaveLength(1);
  });
});

describe('references: W-layout-unknown-node, -edge, -note', () => {
  const file = parseLayoutFile(doc({
    nodes: { a: P('l', 1, 1), ghost: P('l', 1, 1), sized: S(50, 50) },
    edges: { 'a->b': { label_at: 0.5 }, 'x->y': { source_side: 'top' } },
    notes: { note1: { x: 0, y: 0 }, stray: { x: 1, y: 1 } },
  })).file!;
  const nodes = [{ id: 'a', lane: 'l' }, { id: 'b', lane: 'l' }];
  test('each kind, in order node, edge, note', () => {
    const w = checkLayoutRefs(file, nodes, ['a->b'], ['note1']);
    expect(w.map((p) => [p.code, p.line])).toEqual([
      ['W-layout-unknown-node', null], ['W-layout-unknown-node', null], ['W-layout-unknown-edge', null], ['W-layout-unknown-note', null],
    ]);
    expect(w.map((p) => p.message.match(/"([^"]+)"/)![1])).toEqual(['ghost', 'sized', 'x->y', 'stray']);
  });
  test('W-layout-unknown-note is not reported while the config can\'t be read (noteIds null, UI31)', () => {
    expect(checkLayoutRefs(file, nodes, ['a->b'], null).map((p) => p.code)).not.toContain('W-layout-unknown-note');
  });
  test('an empty config: every placed note is unknown', () => {
    expect(checkLayoutRefs(file, nodes, ['a->b'], []).filter((p) => p.code === 'W-layout-unknown-note')).toHaveLength(2);
  });
});

describe('effective placements (§5)', () => {
  const file = parseLayoutFile(doc({
    nodes: { a: { ...P('l1', 10, 10), ...S(100, 60) }, b: { ...P('l1', 0, 0), ...S(80, 80) }, c: S(50, 50), gone: S(60, 60) },
    edges: {
      'a->b': { points: [P('l1', 5, 5), P('l2', 6, 6)], source_side: 'right', label_at: 0.25 },
      'b->c': { points: [P('l1', 5, 5), P('removed', 6, 6)], target_side: 'left' },
      'c->a': { points: [P('removed', 1, 1)] },
      'x->y': { label_at: 0.5 },
    },
    notes: { note1: { x: 1, y: 2 }, stray: { x: 3, y: 4 } },
    title: { x: -5, y: -6 },
  })).file!;
  const targets = {
    nodes: [{ id: 'a', lane: 'l1' }, { id: 'b', lane: 'l2' }, { id: 'c', lane: 'l2' }],
    edges: [{ id: 'a->b' }, { id: 'b->c' }, { id: 'c->a' }],
    lanes: [{ id: 'l1' }, { id: 'l2' }],
    noteIds: ['note1', 'note2'],
  };
  const eff = effectivePlacements(file, targets);
  test('a pin whose lane mismatches is ignored, its size still applies', () => {
    expect([...eff.pins]).toEqual([['a', P('l1', 10, 10)]]);
    expect([...eff.sizes]).toEqual([['a', S(100, 60)], ['b', S(80, 80)], ['c', S(50, 50)]]);
  });
  test('a point set with a missing lane is ignored; sides and label_at stay; emptied entries go', () => {
    expect([...eff.edges]).toEqual([
      ['a->b', { points: [P('l1', 5, 5), P('l2', 6, 6)], source_side: 'right', label_at: 0.25 }],
      ['b->c', { target_side: 'left' }],
    ]);
  });
  test('notes that exist, and the title', () => {
    expect([...eff.notes]).toEqual([['note1', { x: 1, y: 2 }]]);
    expect(eff.title).toEqual({ x: -5, y: -6 });
  });
  test('no file: nothing applies', () => {
    expect(effectivePlacements(null, targets)).toEqual({ pins: new Map(), sizes: new Map(), edges: new Map(), notes: new Map(), title: null });
  });
  test('the input is not mutated', () => {
    expect(file.edges!['b->c']!.points).toHaveLength(2);
  });
});

describe('writers: sizes and pins keep each other', () => {
  const base: LayoutFile = { version: 1, nodes: { a: P('l', 1, 2), b: S(100, 50) }, hints: { h: 1 } };
  test('set a size on a pinned node, a new node, and re-size', () => {
    const f = setSize(base, 'a', S(120, 80))!;
    expect(f.nodes.a).toEqual({ ...P('l', 1, 2), ...S(120, 80) });
    expect(Object.keys(f.nodes.a!)).toEqual(['lane', 'along', 'across', 'width', 'height']);
    expect(Object.keys(setSize(base, 'z', S(40, 40))!.nodes)).toEqual(['a', 'b', 'z']);
    expect(setSize(base, 'b', S(41, 42))!.nodes.b).toEqual(S(41, 42));
    expect(setSize(null, 'n1', S(40, 40))).toEqual({ version: 1, nodes: { n1: S(40, 40) } });
    expect(base.nodes.a).toEqual(P('l', 1, 2));
  });
  test('remove a size: the pin stays; a size-only entry goes; no file stays no file', () => {
    const f = setSize(base, 'a', S(120, 80))!;
    expect(setSize(f, 'a', null)!.nodes.a).toEqual(P('l', 1, 2));
    expect(setSize(base, 'b', null)!.nodes).toEqual({ a: P('l', 1, 2) });
    expect(setSize(null, 'a', null)).toBeNull();
    expect(setSizes(base, [['a', S(50, 50)], ['b', null], ['c', S(60, 60)]])!.nodes).toEqual({ a: { ...P('l', 1, 2), ...S(50, 50) }, c: S(60, 60) });
  });
  test('bad sizes throw', () => {
    expect(() => setSize(base, 'a', S(39, 40))).toThrow();
    expect(() => setSize(base, 'a', S(40.5, 40))).toThrow();
  });
  test('pinning keeps a size in place; unpinning keeps a size, drops an emptied entry', () => {
    const f = setPin(base, 'b', P('l', 9, 9));
    expect(f.nodes.b).toEqual({ ...P('l', 9, 9), ...S(100, 50) });
    expect(Object.keys(f.nodes)).toEqual(['a', 'b']);
    expect(removePins(f, ['a', 'b'])!.nodes).toEqual({ b: S(100, 50) });
    expect(setPins(null, [['x', P('l', 0, 0)]]).nodes).toEqual({ x: P('l', 0, 0) });
  });
  test('delete whole node entries (block delete, orphan delete)', () => {
    expect(removeNodeEntries(setSize(base, 'a', S(50, 50)), ['a'])!.nodes).toEqual({ b: S(100, 50) });
    expect(removeNodeEntries(null, ['a'])).toBeNull();
  });
});

describe('writers: edge entries', () => {
  const base: LayoutFile = { version: 1, nodes: {}, edges: { 'a->b': { source_side: 'top', label_at: 0.5 } } };
  test('set each field; key order is fixed; new entries go last', () => {
    let f = setEdgeSide(base, 'a->b', 'target', 'left')!;
    f = setEdgePoints(f, 'a->b', [P('l', 1, 2)])!;
    expect(Object.keys(f.edges!['a->b']!)).toEqual(['source_side', 'target_side', 'points', 'label_at']);
    f = setLabelAt(f, 'b->c', 0.07)!;
    expect(Object.keys(f.edges!)).toEqual(['a->b', 'b->c']);
    expect(f.edges!['b->c']).toEqual({ label_at: 0.07 });
  });
  test('remove each field; an emptied entry is removed; an emptied map is left out', () => {
    let f = setEdgeSide(base, 'a->b', 'source', null)!;
    expect(f.edges).toEqual({ 'a->b': { label_at: 0.5 } });
    f = setLabelAt(f, 'a->b', null)!;
    expect(f).toEqual({ version: 1, nodes: {} });
    expect('edges' in f).toBe(false);
  });
  test('removing from nothing writes nothing; setting creates the file', () => {
    expect(setLabelAt(null, 'a->b', null)).toBeNull();
    expect(updateEdge(null, 'a->b', { points: null, source_side: null })).toBeNull();
    expect(setEdgeSide(null, 'a->b', 'source', 'bottom')).toEqual({ version: 1, nodes: {}, edges: { 'a->b': { source_side: 'bottom' } } });
  });
  test('reset line removes points and both sides, keeps label_at', () => {
    const f = updateEdge(base, 'a->b', { target_side: 'right', points: [P('l', 0, 0)] });
    expect(resetEdge(f, 'a->b')!.edges).toEqual({ 'a->b': { label_at: 0.5 } });
  });
  test('several patches in one write; a missing key leaves the field alone', () => {
    const f = updateEdges(base, [['a->b', { label_at: 0.25 }], ['c->d', { source_side: 'left', target_side: 'top' }]])!;
    expect(f.edges).toEqual({ 'a->b': { source_side: 'top', label_at: 0.25 }, 'c->d': { source_side: 'left', target_side: 'top' } });
  });
  test('bad values throw', () => {
    expect(() => setLabelAt(base, 'a->b', 0.123)).toThrow();
    expect(() => setLabelAt(base, 'a->b', 1.5)).toThrow();
    expect(() => setEdgeSide(base, 'a->b', 'source', 'up' as never)).toThrow();
    expect(() => setEdgePoints(base, 'a->b', [])).toThrow();
    expect(() => setEdgePoints(base, 'a->b', [P('l', 0.5, 0)])).toThrow();
  });
  test('remove entries', () => {
    expect(removeEdgeEntries(base, ['a->b'])).toEqual({ version: 1, nodes: {} });
    expect(removeEdgeEntries(null, ['a->b'])).toBeNull();
  });
});

describe('writers: re-keying edges (§8.2)', () => {
  const edges = { 'a->b': { label_at: 0.1 }, 'a->b#2': { label_at: 0.2 }, 'a->b#3': { label_at: 0.3 }, 'q->r': { label_at: 0.9 } };
  const base: LayoutFile = { version: 1, nodes: {}, edges };
  test('delete one of three duplicates: the later ones shift down, keeping their places', () => {
    const f = rekeyEdgesByPosition(base, ['a->b', 'a->b#2', 'a->b#3'], ['a->b', null, 'a->b#2'])!;
    expect(f.edges).toEqual({ 'a->b': { label_at: 0.1 }, 'a->b#2': { label_at: 0.3 }, 'q->r': { label_at: 0.9 } });
    expect(Object.keys(f.edges!)).toEqual(['a->b', 'a->b#2', 'q->r']);
  });
  test('a mapping as a record; orphans (not in the mapping) keep their key', () => {
    expect(rekeyEdges(base, { 'a->b#3': 'x->b' })!.edges).toEqual({ ...edges, 'a->b#3': undefined, 'x->b': { label_at: 0.3 } } as never);
    expect(Object.keys(rekeyEdges(base, { 'a->b#3': 'x->b' })!.edges!)).toEqual(['a->b', 'a->b#2', 'x->b', 'q->r']);
  });
  test('a live entry landing on an orphan\'s key replaces it', () => {
    const f = rekeyEdges(base, new Map([['a->b', 'q->r']]))!;
    expect(f.edges).toEqual({ 'q->r': { label_at: 0.1 }, 'a->b#2': { label_at: 0.2 }, 'a->b#3': { label_at: 0.3 } });
  });
  test('swapping ids moves entries with their lines', () => {
    const f = rekeyEdges(base, new Map([['a->b', 'a->b#2'], ['a->b#2', 'a->b']]))!;
    expect(f.edges!['a->b#2']).toEqual({ label_at: 0.1 });
    expect(f.edges!['a->b']).toEqual({ label_at: 0.2 });
  });
  test('everything deleted leaves no edges map; no file or no edges is unchanged', () => {
    expect(rekeyEdges({ version: 1, nodes: {}, edges: { 'a->b': { label_at: 0 } } }, { 'a->b': null })).toEqual({ version: 1, nodes: {} });
    expect(rekeyEdges(null, {})).toBeNull();
    const plain: LayoutFile = { version: 1, nodes: {} };
    expect(rekeyEdges(plain, { 'a->b': 'c->d' })).toBe(plain);
    expect(() => rekeyEdgesByPosition(base, ['a'], [])).toThrow();
  });
  test('edge ids split into source, target and repeat', () => {
    expect(splitEdgeId('a-1->b_2#3')).toEqual({ source: 'a-1', target: 'b_2', suffix: '#3' });
    expect(splitEdgeId('a->b')).toEqual({ source: 'a', target: 'b', suffix: '' });
    expect(splitEdgeId('nope')).toBeNull();
  });
});

describe('writers: renaming a node or a lane', () => {
  const base: LayoutFile = {
    version: 1,
    nodes: { a: { ...P('l1', 1, 1), ...S(50, 50) }, r01: { ...P('l1', 2, 2), ...S(90, 60) }, c: P('l2', 3, 3) },
    edges: {
      'r01->c': { points: [P('l1', 5, 5), P('l2', 6, 6)] }, 'a->r01': { label_at: 0.5 }, 'a->r01#2': { source_side: 'top' },
      'r01->r01': { label_at: 0.2 }, 'r010->c': { label_at: 0.3 },
    },
    notes: { n: { x: 0, y: 0 } },
  };
  test('a node: its entry in place, and the keys of its lines (not of lines of similar ids)', () => {
    const f = renameNode(base, 'r01', 'intake')!;
    expect(Object.keys(f.nodes)).toEqual(['a', 'intake', 'c']);
    expect(f.nodes.intake).toEqual({ ...P('l1', 2, 2), ...S(90, 60) });
    expect(Object.keys(f.edges!)).toEqual(['intake->c', 'a->intake', 'a->intake#2', 'intake->intake', 'r010->c']);
    expect(f.notes).toEqual(base.notes);
    expect(renamePinNode(base, 'zz', 'y')).toBe(base);
    expect(renameNode(null, 'a', 'b')).toBeNull();
  });
  test('a node with no entry but with line entries', () => {
    const f = renameNode({ version: 1, nodes: {}, edges: { 'x->y': { label_at: 0 } } }, 'y', 'z')!;
    expect(Object.keys(f.edges!)).toEqual(['x->z']);
  });
  test('a lane: pins and bend points', () => {
    const f = renameLane(base, 'l1', 'intake-lane')!;
    expect(f.nodes.a).toEqual({ ...P('intake-lane', 1, 1), ...S(50, 50) });
    expect(f.nodes.c).toEqual(P('l2', 3, 3));
    expect(f.edges!['r01->c']!.points).toEqual([P('intake-lane', 5, 5), P('l2', 6, 6)]);
    expect(renameLaneInPins).toBe(renameLane);
    expect(renameLane(null, 'a', 'b')).toBeNull();
  });
});

describe('writers: lanes going away, re-layout all, direction', () => {
  const base: LayoutFile = {
    version: 1,
    nodes: { a: { ...P('l1', 1, 1), ...S(50, 50) }, b: P('l2', 2, 2) },
    edges: {
      'a->b': { points: [P('l1', 5, 5), P('l2', 6, 6)], source_side: 'right', label_at: 0.4 },
      'b->a': { points: [P('l2', 1, 1)] },
      'a->a': { points: [P('l1', 1, 1)], target_side: 'bottom' },
    },
    notes: { n: { x: 10, y: -20 } },
    title: { x: 3, y: -48 },
    hints: { keep: true },
  };
  test('dropping the points of lines through a lane', () => {
    const f = dropPointsInLanes(base, 'l2')!;
    expect(f.edges).toEqual({ 'a->b': { source_side: 'right', label_at: 0.4 }, 'a->a': base.edges!['a->a'] });
    expect(dropPointsInLanes(base, ['l1', 'l2'])!.edges).toEqual({ 'a->b': { source_side: 'right', label_at: 0.4 }, 'a->a': { target_side: 'bottom' } });
    expect(dropPointsInLanes(null, 'x')).toBeNull();
  });
  test('re-expressing points of a lane that disappears in another lane', () => {
    const f = movePointsToLane(base, 'l2', 'l1', { across: 140 })!;
    expect(f.edges!['a->b']!.points).toEqual([P('l1', 5, 5), P('l1', 6, 146)]);
    expect(f.edges!['b->a']!.points).toEqual([P('l1', 1, 141)]);
  });
  test('clear all pins and points, keeping sizes, sides, label_at, notes, title and hints', () => {
    const f = clearPinsAndPoints(base)!;
    expect(f).toEqual({
      version: 1, nodes: { a: S(50, 50) },
      edges: { 'a->b': { source_side: 'right', label_at: 0.4 }, 'a->a': { target_side: 'bottom' } },
      notes: { n: { x: 10, y: -20 } }, title: { x: 3, y: -48 }, hints: { keep: true },
    });
    expect(clearPins).toBe(clearPinsAndPoints);
    expect(clearPins(null)).toBeNull();
  });
  test('flipping the direction rotates sides and swaps note and title x and y; the rest stays', () => {
    const f = flipDirection(base)!;
    expect(f.nodes).toEqual(base.nodes);
    expect(f.edges!['a->b']).toEqual({ points: base.edges!['a->b']!.points, source_side: 'bottom', label_at: 0.4 });
    expect(f.edges!['a->a']!.target_side).toBe('right');
    expect(f.notes).toEqual({ n: { x: -20, y: 10 } });
    expect(f.title).toEqual({ x: -48, y: 3 });
    expect(flipDirection(flipDirection(base))).toEqual(base);
  });
  test('setting hints keeps every other part', () => {
    expect(setHints(base, { v: 2 })).toEqual({ ...base, hints: { v: 2 } });
    const noHints = setHints(base, undefined);
    expect('hints' in noHints).toBe(false);
  });
});

describe('writers: notes and title', () => {
  test('set, move and remove a note position; emptied notes left out', () => {
    let f = setNotePosition(null, 'note1', { x: 40, y: -60 })!;
    expect(f).toEqual({ version: 1, nodes: {}, notes: { note1: { x: 40, y: -60 } } });
    f = setNotePosition(f, 'note2', { x: 0, y: 0 })!;
    f = setNotePosition(f, 'note1', { x: 1, y: 1 })!;
    expect(Object.keys(f.notes!)).toEqual(['note1', 'note2']);
    expect(removeNoteEntries(f, ['note1', 'note2'])).toEqual({ version: 1, nodes: {} });
    expect(setNotePosition(f, 'note2', null)!.notes).toEqual({ note1: { x: 1, y: 1 } });
    expect(setNotePosition(null, 'x', null)).toBeNull();
    expect(() => setNotePosition(f, 'x', { x: 0.5, y: 0 })).toThrow();
  });
  test('set and reset the title position', () => {
    const f = setTitlePosition({ version: 1, nodes: { a: S(40, 40) } }, { x: -10, y: -48 })!;
    expect(f.title).toEqual({ x: -10, y: -48 });
    expect(setTitlePosition(f, null)).toEqual({ version: 1, nodes: { a: S(40, 40) } });
    expect(setTitlePosition(null, null)).toBeNull();
  });
});

describe('serialization (stable: key order version, nodes, edges, notes, title, hints)', () => {
  test('every part, one line per entry, parses back to the same file', () => {
    const f: LayoutFile = {
      version: 1,
      nodes: { n08: S(200, 80), n07: { ...P('finance', 840, 30), ...S(220, 90) } },
      edges: { 'n07->n08': { label_at: 0.3, points: [P('finance', 900, 140), P('_unassigned', -1, -2)], target_side: 'left', source_side: 'bottom' } },
      notes: { note1: { x: 40, y: -60 } },
      title: { x: 0, y: -48 },
      hints: { a: [1] },
    };
    const text = serializeLayoutFile(f);
    expect(text).toBe(`{
  "version": 1,
  "nodes": {
    "n08": { "width": 200, "height": 80 },
    "n07": { "lane": "finance", "along": 840, "across": 30, "width": 220, "height": 90 }
  },
  "edges": {
    "n07->n08": { "source_side": "bottom", "target_side": "left", "points": [{ "lane": "finance", "along": 900, "across": 140 }, { "lane": "_unassigned", "along": -1, "across": -2 }], "label_at": 0.3 }
  },
  "notes": {
    "note1": { "x": 40, "y": -60 }
  },
  "title": { "x": 0, "y": -48 },
  "hints": {
    "a": [
      1
    ]
  }
}
`);
    expect(parseLayoutFile(text).file).toEqual(f);
    expect(serializeLayoutFile(parseLayoutFile(text).file!)).toBe(text);
  });
  test('nothing placed: {"version": 1, "nodes": {}}', () => {
    expect(serializeLayoutFile({ version: 1, nodes: {}, edges: {}, notes: {} })).toBe('{\n  "version": 1,\n  "nodes": {}\n}\n');
  });
  test('the §5 example round-trips to its parsed content', () => {
    const f = parseLayoutFile(EXAMPLE).file!;
    expect(parseLayoutFile(serializeLayoutFile(f)).file).toEqual(f);
  });
  test('a key such as __proto__ is kept as data', () => {
    const f = parseLayoutFile('{"version": 1, "nodes": {"__proto__": {"width": 40, "height": 40}}}').file!;
    expect(Object.keys(f.nodes)).toEqual(['__proto__']);
    const g = setSize(f, 'z', S(50, 50))!;
    expect(Object.keys(g.nodes)).toEqual(['__proto__', 'z']);
    expect(serializeLayoutFile(g)).toContain('"__proto__": { "width": 40, "height": 40 }');
  });
});
