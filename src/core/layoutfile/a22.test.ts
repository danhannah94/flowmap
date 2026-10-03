// Amendment A22 in the layout file (§5): an edge entry's `source_at` / `target_at` (an end's offset along its side) and
// the top-level `spread_ends`. Reading (every value rule is `E-layout`), the stable text, the round trip, and the
// writers that keep offsets with their sides.
import {
  clearPinsAndPoints, flipDirection, parseLayoutFile, rekeyEdges, resetEdge, serializeLayoutFile, setEdgeSide,
  setSpreadEnds, updateEdge,
} from './index';
import { loadDocument } from '../document';
import type { LayoutFile } from '../types';

const doc = (body: object) => JSON.stringify({ version: 1, nodes: {}, ...body });
const errors = (text: string) => {
  const r = parseLayoutFile(text);
  return { file: r.file, codes: r.problems.errors.map((p) => [p.code, p.line]), messages: r.problems.errors.map((p) => p.message) };
};

const WITH_OFFSETS = `{
  "version": 1,
  "nodes": {},
  "spread_ends": true,
  "edges": {
    "a->b": { "source_side": "right", "source_at": 0.25, "target_side": "left", "target_at": 0.75 },
    "b->a": { "source_side": "left", "target_side": "right", "target_at": 0, "points": [{ "lane": "l", "along": 10, "across": 5 }], "label_at": 0.4 },
    "a->c": { "target_side": "top", "target_at": 1 }
  }
}
`;

describe('parse (§5, A22)', () => {
  test('offsets and spread_ends read as written', () => {
    const r = errors(WITH_OFFSETS);
    expect(r.codes).toEqual([]);
    expect(r.file!.spread_ends).toBe(true);
    expect(r.file!.edges).toEqual({
      'a->b': { source_side: 'right', source_at: 0.25, target_side: 'left', target_at: 0.75 },
      'b->a': { source_side: 'left', target_side: 'right', target_at: 0, points: [{ lane: 'l', along: 10, across: 5 }], label_at: 0.4 },
      'a->c': { target_side: 'top', target_at: 1 },
    });
  });

  test('round trip: the writer gives back the same text, keys in their fixed order', () => {
    expect(serializeLayoutFile(parseLayoutFile(WITH_OFFSETS).file!)).toBe(WITH_OFFSETS);
    // Keys out of order are put in order: source_side, source_at, target_side, target_at, points, label_at.
    const shuffled = doc({ edges: { 'a->b': { label_at: 0.5, target_at: 0.1, target_side: 'top', source_at: 0.9, source_side: 'bottom' } }, spread_ends: true });
    expect(serializeLayoutFile(parseLayoutFile(shuffled).file!)).toBe(`{
  "version": 1,
  "nodes": {},
  "spread_ends": true,
  "edges": {
    "a->b": { "source_side": "bottom", "source_at": 0.9, "target_side": "top", "target_at": 0.1, "label_at": 0.5 }
  }
}
`);
  });

  test('a file without the new keys reads and writes exactly as before', () => {
    const v11 = doc({ edges: { 'a->b': { source_side: 'right', target_side: 'left' } } });
    const f = parseLayoutFile(v11).file!;
    expect('spread_ends' in f).toBe(false);
    expect(f.edges!['a->b']).toEqual({ source_side: 'right', target_side: 'left' });
    expect(serializeLayoutFile(f)).toBe(`{
  "version": 1,
  "nodes": {},
  "edges": {
    "a->b": { "source_side": "right", "target_side": "left" }
  }
}
`);
  });

  test.each([
    ['above 1', { source_side: 'top', source_at: 1.5 }, 'must be a number from 0 to 1'],
    ['below 0', { target_side: 'top', target_at: -0.1 }, 'must be a number from 0 to 1'],
    ['three decimals', { source_side: 'top', source_at: 0.125 }, 'at most two decimals'],
    ['a string', { source_side: 'top', source_at: '0.5' }, 'must be a number'],
    ['null', { source_side: 'top', source_at: null }, 'must be a number'],
    ['without its side', { source_at: 0.25 }, 'needs "source_side"'],
    ['without its side (target)', { source_side: 'left', target_at: 0.25 }, 'needs "target_side"'],
  ])('an offset %s is E-layout (line null), and the file is dropped', (_what, entry, message) => {
    const r = errors(doc({ edges: { 'a->b': entry } }));
    expect(r.codes).toEqual([['E-layout', null]]);
    expect(r.messages[0]).toContain(message);
    expect(r.file).toBeNull();
  });

  test.each([['a string', '"yes"'], ['a number', '1'], ['null', 'null']])('spread_ends as %s is E-layout', (_what, value) => {
    const r = errors(`{ "version": 1, "nodes": {}, "spread_ends": ${value} }`);
    expect(r.codes).toEqual([['E-layout', null]]);
    expect(r.file).toBeNull();
  });

  test('spread_ends: false is accepted (the UI never writes it)', () => {
    const r = errors(doc({ spread_ends: false }));
    expect(r.codes).toEqual([]);
    expect(r.file!.spread_ends).toBe(false);
  });

  test('validate reports an out-of-range offset as E-layout (line null), and the diagram still lays out', () => {
    const mmd = 'flowchart LR\n  a["A"]\n  b["B"]\n  a --> b\n';
    const bad = doc({ edges: { 'a->b': { source_side: 'right', source_at: 2 } } });
    const d = loadDocument(mmd, null, bad, 'x.mmd');
    expect(d.problems.errors.map((p) => [p.code, p.line])).toEqual([['E-layout', null]]);
    expect(d.layout!.result.edges[0]!.points.length).toBeGreaterThan(1);
    expect('source_at' in d.layout!.result.edges[0]!).toBe(false); // none of the file's placements apply
  });
});

describe('writers keep an offset with its side', () => {
  const base: LayoutFile = parseLayoutFile(WITH_OFFSETS).file!;

  test('setEdgeSide sets a side with an offset, or with no offset removes it', () => {
    const a = setEdgeSide(null, 'x->y', 'target', 'bottom', 0.3)!;
    expect(a.edges).toEqual({ 'x->y': { target_side: 'bottom', target_at: 0.3 } });
    const b = setEdgeSide(base, 'a->b', 'source', 'right')!;
    expect(b.edges!['a->b']).toEqual({ source_side: 'right', target_side: 'left', target_at: 0.75 });
  });

  test('removing a side removes its offset (reconnecting to another block, UI16; reset line, UI36)', () => {
    expect(updateEdge(base, 'a->b', { source_side: null })!.edges!['a->b']).toEqual({ target_side: 'left', target_at: 0.75 });
    expect(updateEdge(base, 'a->c', { target_side: null })!.edges).not.toHaveProperty('a->c');
    expect(resetEdge(base, 'b->a')!.edges!['b->a']).toEqual({ label_at: 0.4 });
  });

  test('a bad offset is a programming error', () => {
    expect(() => updateEdge(base, 'a->b', { source_at: 1.01 })).toThrow(/source_at/);
    expect(() => updateEdge(base, 'a->b', { target_at: 0.333 })).toThrow(/target_at/);
  });

  test('re-layout all, re-keying and flipping the direction keep offsets (they are along the side, which rotates with the diagram)', () => {
    expect(clearPinsAndPoints(base)!.edges!['b->a']).toEqual({ source_side: 'left', target_side: 'right', target_at: 0, label_at: 0.4 });
    expect(rekeyEdges(base, { 'a->b': 'a->d' })!.edges!['a->d']).toEqual(base.edges!['a->b']);
    const flipped = flipDirection(base)!;
    expect(flipped.edges!['a->b']).toEqual({ source_side: 'bottom', source_at: 0.25, target_side: 'top', target_at: 0.75 });
    expect(flipped.spread_ends).toBe(true);
  });

  test('setSpreadEnds writes true, or removes the key; turning it off with no file creates none', () => {
    expect(setSpreadEnds(null, false)).toBeNull();
    const on = setSpreadEnds(null, true)!;
    expect(serializeLayoutFile(on)).toBe('{\n  "version": 1,\n  "nodes": {},\n  "spread_ends": true\n}\n');
    const off = setSpreadEnds(base, false)!;
    expect('spread_ends' in off).toBe(false);
    expect(off.edges).toEqual(base.edges);
  });
});

describe('A22 with A19: offsets and grouped pins in one file', () => {
  const BOTH = `{
  "version": 1,
  "nodes": {
    "app": { "lane": "acct", "group": "sub-a", "along": 300, "across": 140, "width": 160, "height": 60 },
    "gw": { "lane": "acct", "along": 40, "across": 20 }
  },
  "spread_ends": true,
  "edges": {
    "gw->app": { "source_side": "right", "source_at": 0.25, "target_side": "left", "target_at": 0.75 }
  }
}
`;

  test('reads both, and writes them back byte for byte in their key orders', () => {
    const r = parseLayoutFile(BOTH);
    expect(r.problems.errors).toEqual([]);
    expect(r.file!.nodes.app).toEqual({ lane: 'acct', group: 'sub-a', along: 300, across: 140, width: 160, height: 60 });
    expect(r.file!.edges!['gw->app']).toEqual({ source_side: 'right', source_at: 0.25, target_side: 'left', target_at: 0.75 });
    expect(serializeLayoutFile(r.file!)).toBe(BOTH);
  });

  test('a document with groups applies the grouped pin and the offsets together', () => {
    const mmd = [
      'flowchart LR', '', '  subgraph acct [Account]', '    gw["Gateway"]', '    subgraph sub-a [Subnet A]', '      app["App"]',
      '    end', '  end', '', '  gw --> app', '',
    ].join('\n');
    const d = loadDocument(mmd, null, BOTH, 'x.mmd');
    expect(d.problems.errors).toEqual([]);
    const res = d.layout!.result;
    expect(res.nodes.find((n) => n.id === 'app')).toMatchObject({ group: 'sub-a', pinned: true });
    expect(res.edges[0]).toMatchObject({ source_at: 0.25, target_at: 0.75 });
  });
});
