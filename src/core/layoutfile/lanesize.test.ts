// Amendment A8: stored lane sizes in the layout file (`"lanes": {"<lane id>": {"size": <n>}}`): reading, the writers,
// and the stable text. The size is measured from the lane's zero line (§6 Frame), an integer of at least 100 (L1).
import {
  clearPinsAndPoints, flipDirection, keepLaneEntries, parseLayoutFile, reexpressOldFirstLane, removeLaneEntries,
  renameLane, serializeLayoutFile, setLaneSize, setPin, setSize,
} from './index';
import type { LayoutFile } from '../types';

const doc = (body: object) => JSON.stringify({ version: 1, nodes: {}, ...body });
const errors = (text: string) => parseLayoutFile(text).problems.errors.map((p) => [p.code, p.line, p.message]);

describe('parse (A8)', () => {
  test('a lanes map of {size}, `_unassigned` included; entries keep their order', () => {
    const r = parseLayoutFile(doc({ lanes: { finance: { size: 240 }, _unassigned: { size: 100 }, a: { size: 1000 } } }));
    expect(r.problems).toEqual({ errors: [], warnings: [] });
    expect(r.file!.lanes).toEqual({ finance: { size: 240 }, _unassigned: { size: 100 }, a: { size: 1000 } });
    expect(Object.keys(r.file!.lanes!)).toEqual(['finance', '_unassigned', 'a']);
  });

  test('an entry for a lane that does not exist is not a problem (the next write drops it)', () => {
    expect(parseLayoutFile(doc({ lanes: { gone: { size: 300 } } })).problems).toEqual({ errors: [], warnings: [] });
  });

  test('an empty lanes map is accepted and left out', () => {
    const r = parseLayoutFile(doc({ lanes: {} }));
    expect(r.problems.errors).toEqual([]);
    expect('lanes' in r.file!).toBe(false);
  });

  test.each([
    [{ lanes: [] }, /"lanes" must be an object of lane sizes/],
    [{ lanes: { a: 240 } }, /Lane entry "a" must be an object \{size\}/],
    [{ lanes: { a: {} } }, /Lane entry "a": is empty/],
    [{ lanes: { a: { size: 99 } } }, /"size" must be an integer of at least 100/],
    [{ lanes: { a: { size: 240.5 } } }, /"size" must be an integer of at least 100/],
    [{ lanes: { a: { size: '240' } } }, /"size" must be an integer of at least 100/],
    [{ lanes: { a: { size: 240, width: 3 } } }, /unknown key "width"/],
    [{ lanes: { a: { height: 240 } } }, /unknown key "height"; "size" must be/],
  ])('E-layout (line null, no placements): %j', (body, why) => {
    const r = parseLayoutFile(doc({ nodes: { x: { lane: 'a', along: 1, across: 2 } }, ...body }));
    expect(r.file).toBeNull();
    expect(errors(doc(body))).toEqual([['E-layout', null, expect.stringMatching(why)]]);
  });
});

describe('writers (A8)', () => {
  const base: LayoutFile = { version: 1, nodes: { n1: { lane: 'a', along: 1, across: 2 } }, hints: { h: 1 } };

  test('set, change in place, and remove a lane size; everything else kept', () => {
    const one = setLaneSize(base, 'a', 240)!;
    expect(one).toEqual({ ...base, lanes: { a: { size: 240 } } });
    const two = setLaneSize(setLaneSize(one, 'b', 300), 'a', 260)!;
    expect(Object.entries(two.lanes!)).toEqual([['a', { size: 260 }], ['b', { size: 300 }]]);
    const gone = setLaneSize(setLaneSize(two, 'a', null), 'b', null)!;
    expect(gone).toEqual(base);
    expect('lanes' in gone).toBe(false);
  });

  test('removing from no file stays no file; setting creates one', () => {
    expect(setLaneSize(null, 'a', null)).toBeNull();
    expect(setLaneSize(null, 'a', 150)).toEqual({ version: 1, nodes: {}, lanes: { a: { size: 150 } } });
  });

  test('a bad size is a programming error', () => {
    expect(() => setLaneSize(base, 'a', 99)).toThrow(/at least 100/);
    expect(() => setLaneSize(base, 'a', 120.5)).toThrow(/at least 100/);
  });

  test('keep only the lanes that show; remove named entries', () => {
    const f = setLaneSize(setLaneSize(setLaneSize(base, 'a', 200), 'gone', 300), '_unassigned', 400)!;
    expect(keepLaneEntries(f, ['a', '_unassigned'])!.lanes).toEqual({ a: { size: 200 }, _unassigned: { size: 400 } });
    expect(keepLaneEntries(f, [])).toEqual(base);
    expect(removeLaneEntries(f, ['a', 'gone'])!.lanes).toEqual({ _unassigned: { size: 400 } });
    expect(keepLaneEntries(base, [])).toBe(base);
    expect(keepLaneEntries(null, [])).toBeNull();
  });

  test('renaming a lane (UI19, A7) re-keys its entry in place, replacing one the new id had', () => {
    const f = setLaneSize(setLaneSize(setLaneSize(base, 'x', 111), 'a', 200), 'b', 300)!;
    const r = renameLane(f, 'a', 'z')!;
    expect(Object.entries(r.lanes!)).toEqual([['x', { size: 111 }], ['z', { size: 200 }], ['b', { size: 300 }]]);
    expect(r.nodes.n1!.lane).toBe('z');
    expect(Object.entries(renameLane(f, 'a', 'b')!.lanes!)).toEqual([['x', { size: 111 }], ['b', { size: 200 }]]);
    expect(renameLane(f, 'nope', 'q')!.lanes).toEqual(f.lanes);
  });

  test('R12: the old first lane\'s size gets U, like its pins; other lanes keep theirs', () => {
    const f = setLaneSize(setLaneSize(base, 'a', 200), 'b', 300)!;
    expect(reexpressOldFirstLane(f, 'a', 45, 'LR')!.lanes).toEqual({ a: { size: 245 }, b: { size: 300 } });
    expect(reexpressOldFirstLane(f, 'a', 0, 'TB')!.lanes).toEqual(f.lanes);
  });

  test('direction flips, re-layout all, pins and block sizes keep lane sizes', () => {
    const f = setLaneSize(base, 'a', 200)!;
    for (const g of [flipDirection(f), clearPinsAndPoints(f), setPin(f, 'n2', { lane: 'a', along: 3, across: 4 }), setSize(f, 'n1', { width: 50, height: 50 })]) {
      expect(g!.lanes).toEqual({ a: { size: 200 } });
    }
  });
});

describe('text (A8): `lanes` right after `nodes`, one line per lane', () => {
  test('stable form, and it reads back', () => {
    const f: LayoutFile = {
      version: 1, nodes: { n1: { lane: 'a', along: 1, across: 2 } }, lanes: { a: { size: 240 }, _unassigned: { size: 180 } },
      edges: { 'n1->n2': { label_at: 0.5 } }, title: { x: 0, y: -40 },
    };
    const text = serializeLayoutFile(f);
    expect(text).toBe(`{
  "version": 1,
  "nodes": {
    "n1": { "lane": "a", "along": 1, "across": 2 }
  },
  "lanes": {
    "a": { "size": 240 },
    "_unassigned": { "size": 180 }
  },
  "edges": {
    "n1->n2": { "label_at": 0.5 }
  },
  "title": { "x": 0, "y": -40 }
}
`);
    expect(parseLayoutFile(text).file).toEqual(f);
  });

  test('no lanes: the text is exactly as before A8', () => {
    expect(serializeLayoutFile({ version: 1, nodes: {} })).toBe('{\n  "version": 1,\n  "nodes": {}\n}\n');
  });
});
