// Amendment A13: the lanes' shared length along the flow in the layout file (`"lane_length": <n>`, right after
// `lanes`): reading, the writers, and the stable text. Measured from the flow axis's zero line (§6 Frame), an integer
// of at least 100.
import {
  clearPinsAndPoints, flipDirection, keepLaneEntries, parseLayoutFile, reexpressOldFirstLane, removeLaneEntries,
  renameLane, serializeLayoutFile, setLaneLength, setLaneSize, setPin, setSize, setTitlePosition,
} from './index';
import type { LayoutFile } from '../types';

const doc = (body: object) => JSON.stringify({ version: 1, nodes: {}, ...body });
const errors = (text: string) => parseLayoutFile(text).problems.errors.map((p) => [p.code, p.line, p.message]);

describe('parse (A13)', () => {
  test('one integer; beside lane sizes or on its own', () => {
    const r = parseLayoutFile(doc({ lanes: { a: { size: 240 } }, lane_length: 1800 }));
    expect(r.problems).toEqual({ errors: [], warnings: [] });
    expect(r.file!.lane_length).toBe(1800);
    expect(parseLayoutFile(doc({ lane_length: 100 })).file).toEqual({ version: 1, nodes: {}, lane_length: 100 });
  });

  test('absent: no key in the parsed file', () => {
    expect('lane_length' in parseLayoutFile(doc({})).file!).toBe(false);
  });

  test.each([
    [{ lane_length: 99 }],
    [{ lane_length: 0 }],
    [{ lane_length: -400 }],
    [{ lane_length: 1200.5 }],
    [{ lane_length: '1200' }],
    [{ lane_length: null }],
    [{ lane_length: { size: 1200 } }],
  ])('E-layout (line null, no placements): %j', (body) => {
    const r = parseLayoutFile(doc({ nodes: { x: { lane: 'a', along: 1, across: 2 } }, ...body }));
    expect(r.file).toBeNull();
    expect(errors(doc(body))).toEqual([['E-layout', null, 'Layout file "lane_length" must be an integer of at least 100']]);
  });

  test('a near miss of the key is an unknown key', () => {
    expect(errors(doc({ laneLength: 1200 }))).toEqual([['E-layout', null, 'Layout file has an unknown key "laneLength"']]);
  });
});

describe('writers (A13)', () => {
  const base: LayoutFile = { version: 1, nodes: { n1: { lane: 'a', along: 1, across: 2 } }, hints: { h: 1 } };

  test('set, change and remove; everything else kept', () => {
    const one = setLaneLength(base, 1500)!;
    expect(one).toEqual({ ...base, lane_length: 1500 });
    expect(setLaneLength(one, 1700)!.lane_length).toBe(1700);
    const gone = setLaneLength(one, null)!;
    expect(gone).toEqual(base);
    expect('lane_length' in gone).toBe(false);
  });

  test('removing from no file stays no file; setting creates one', () => {
    expect(setLaneLength(null, null)).toBeNull();
    expect(setLaneLength(null, 900)).toEqual({ version: 1, nodes: {}, lane_length: 900 });
  });

  test('a bad length is a programming error', () => {
    expect(() => setLaneLength(base, 99)).toThrow(/at least 100/);
    expect(() => setLaneLength(base, 1200.5)).toThrow(/at least 100/);
  });

  test('every other writer keeps it: direction flips, re-layout all, pins, sizes, lane sizes, renames, R12, the title', () => {
    const f = setLaneLength(setLaneSize(base, 'a', 200), 1500)!;
    for (const g of [
      flipDirection(f), clearPinsAndPoints(f), setPin(f, 'n2', { lane: 'a', along: 3, across: 4 }),
      setSize(f, 'n1', { width: 50, height: 50 }), setLaneSize(f, 'a', null), keepLaneEntries(f, []),
      removeLaneEntries(f, ['a']), renameLane(f, 'a', 'z'), reexpressOldFirstLane(f, 'a', 45, 'LR'),
      setTitlePosition(f, { x: 3, y: 4 }),
    ]) {
      expect(g!.lane_length).toBe(1500);
    }
  });
});

describe('text (A13): `lane_length` right after `lanes`', () => {
  test('stable form, and it reads back', () => {
    const f: LayoutFile = {
      version: 1, nodes: { n1: { lane: 'a', along: 1, across: 2 } }, lanes: { a: { size: 240 } }, lane_length: 1640,
      edges: { 'n1->n2': { label_at: 0.5 } },
    };
    const text = serializeLayoutFile(f);
    expect(text).toBe(`{
  "version": 1,
  "nodes": {
    "n1": { "lane": "a", "along": 1, "across": 2 }
  },
  "lanes": {
    "a": { "size": 240 }
  },
  "lane_length": 1640,
  "edges": {
    "n1->n2": { "label_at": 0.5 }
  }
}
`);
    expect(parseLayoutFile(text).file).toEqual(f);
    expect(serializeLayoutFile({ version: 1, nodes: {}, lane_length: 300 })).toBe('{\n  "version": 1,\n  "nodes": {},\n  "lane_length": 300\n}\n');
  });

  test('no lane length: the text is exactly as before A13', () => {
    expect(serializeLayoutFile({ version: 1, nodes: {} })).toBe('{\n  "version": 1,\n  "nodes": {}\n}\n');
  });
});
