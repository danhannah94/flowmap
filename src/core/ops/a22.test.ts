// Amendment A22 in the operations: connecting to, and moving a line end along, a side writes that end's offset
// (`source_at` / `target_at`); every write keeps an offset with its side; shaping a line by hand keeps its ends where
// they are (an end at an offset is at its port, so it isn't turned into a bend point); copy and paste carry offsets;
// and `spread_ends` is turned on and off. Each change is checked against the same change made by hand (§8.1).
import { edgeEndPort, endAtPort } from '../layout';
import {
  connect, copyFragment, dragSegment, duplicateNodes, makeManual, pasteFragment, reconnect, resetLine, setDirection,
  setSpreadEnds,
} from './index';
import { edit, editJson, expectParity, ok, refused } from './testkit';
import { drawn, layoutJs, layoutOf, SHAPE, SHAPE_LAYOUT, SHAPE_MMD } from './testkit-v11';

const withLayout = (change: (js: any) => void) => ({ ...SHAPE, layout: editJson(SHAPE_LAYOUT, change) });
const appended = (line: string) => edit(SHAPE_MMD, ['  a -->|yes| d\n', `  a -->|yes| d\n${line}\n`]);

describe('connect and reconnect at a point along a side (UI38, A22)', () => {
  test('dropped along the target\'s side: target_side and target_at', () => {
    const r = connect(SHAPE, 'c', 'b', { source_side: 'top', target_side: 'bottom', target_at: 0.25 });
    expectParity(r, SHAPE, {
      mmd: appended('c --> b'),
      layout: editJson(SHAPE_LAYOUT, (js) => { js.edges = { 'c->b': { source_side: 'top', target_side: 'bottom', target_at: 0.25 } }; }),
    });
    const line = layoutOf(ok(r).files).result.edges.find((e) => e.id === 'c->b')!;
    const b = layoutOf(ok(r).files).result.nodes.find((n) => n.id === 'b')!;
    expect(line.points[line.points.length - 1]).toEqual([b.x + 30, b.y + b.height]); // a quarter of 120 px along
  });

  test('0.5 is the midline port: no offset is written', () => {
    expectParity(connect(SHAPE, 'c', 'b', { source_side: 'top', target_side: 'bottom', target_at: 0.5 }), SHAPE, {
      mmd: appended('c --> b'),
      layout: editJson(SHAPE_LAYOUT, (js) => { js.edges = { 'c->b': { source_side: 'top', target_side: 'bottom' } }; }),
    });
  });

  test('refusals: an offset out of range, with too many decimals, or without its side', () => {
    expect(refused(connect(SHAPE, 'c', 'b', { target_side: 'top', target_at: 1.2 }))).toMatch(/0 to 1/);
    expect(refused(connect(SHAPE, 'c', 'b', { target_side: 'top', target_at: 0.125 }))).toMatch(/two decimals/);
    expect(refused(connect(SHAPE, 'c', 'b', { target_at: 0.25 }))).toMatch(/needs its side/);
    expect(refused(reconnect(SHAPE, 'a->b', 'target', 'b', 'left', -0.1))).toMatch(/0 to 1/);
    expect(refused(reconnect(SHAPE, 'a->b', 'target', 'b', null, 0.3))).toMatch(/needs its side/);
  });

  const SIDED = withLayout((js) => {
    js.edges = { 'a->b': { source_side: 'right', target_side: 'left', target_at: 0.75, label_at: 0.4 } };
  });

  test('dragging an end along the side it is on: only that end\'s offset (and side) change; the id stays', () => {
    const r = reconnect(SIDED, 'a->b', 'target', 'b', 'left', 0.25);
    expect(ok(r).edgeId).toBe('a->b');
    expectParity(r, SIDED, { layout: editJson(SIDED.layout, (js) => { js.edges['a->b'].target_at = 0.25; }) });
    // Onto another side of the same block, at an offset.
    expectParity(reconnect(SIDED, 'a->b', 'target', 'b', 'top', 0.1), SIDED, {
      layout: editJson(SIDED.layout, (js) => { js.edges['a->b'].target_side = 'top'; js.edges['a->b'].target_at = 0.1; }),
    });
    // Back to the midline (0.5), or to another side's connection point: the offset goes.
    expectParity(reconnect(SIDED, 'a->b', 'target', 'b', 'left', 0.5), SIDED, {
      layout: editJson(SIDED.layout, (js) => { delete js.edges['a->b'].target_at; }),
    });
    expectParity(reconnect(SIDED, 'a->b', 'target', 'b', 'bottom'), SIDED, {
      layout: editJson(SIDED.layout, (js) => { js.edges['a->b'].target_side = 'bottom'; delete js.edges['a->b'].target_at; }),
    });
    // Dropped elsewhere on the block: the side and its offset are left to the layout.
    expectParity(reconnect(SIDED, 'a->b', 'target', 'b'), SIDED, {
      layout: editJson(SIDED.layout, (js) => { delete js.edges['a->b'].target_side; delete js.edges['a->b'].target_at; }),
    });
  });

  test('reconnecting an end to another block: its side and offset go (§8.2), the other end\'s stay', () => {
    const r = reconnect(SIDED, 'a->b', 'target', 'c');
    expect(ok(r).edgeId).toBe('a->c'); // first of the a->c pair in the file now
    expectParity(r, SIDED, {
      mmd: edit(SHAPE_MMD, ['  a --> b\n', '  a --> c\n']),
      layout: editJson(SIDED.layout, (js) => { js.edges = { 'a->c': { source_side: 'right', label_at: 0.4 } }; }),
    });
  });

  test('reset line removes both sides and their offsets', () => {
    const files = withLayout((js) => { js.edges = { 'a->b': { source_side: 'right', source_at: 0.2, target_side: 'left', target_at: 0.75, label_at: 0.4 } }; });
    expectParity(resetLine(files, 'a->b'), files, { layout: editJson(files.layout, (js) => { js.edges['a->b'] = { label_at: 0.4 }; }) });
  });
});

describe('shaping a line by hand keeps its ends (UI36, A22)', () => {
  // a's right side to b's left side, both at offsets that need the line to step down on the way.
  const OFFSET = withLayout((js) => { js.edges = { 'a->b': { source_side: 'right', source_at: 0.25, target_side: 'left', target_at: 0.75 } }; });

  test('an end at its offset is at its port: becoming manual stores the corners only, and the line doesn\'t move', () => {
    const before = layoutOf(OFFSET).result;
    const line = before.edges.find((e) => e.id === 'a->b')!;
    expect([line.source_at, line.target_at]).toEqual([0.25, 0.75]);
    expect(endAtPort(before, 'a->b', 'source')).toBe(true);
    expect(endAtPort(before, 'a->b', 'target')).toBe(true);
    const corners = line.points.slice(1, -1);
    expect(corners.length).toBeGreaterThan(0);
    const r = makeManual(OFFSET, before, 'a->b');
    const entry = layoutJs(ok(r).files).edges['a->b'];
    expect(entry).toEqual({
      source_side: 'right', source_at: 0.25, target_side: 'left', target_at: 0.75,
      points: corners.map(([x, y]) => ({ lane: 'top', along: x, across: y })),
    });
    expect(drawn(ok(r).files, 'a->b')).toEqual(line.points);
  });

  test('a segment drag next to an offset end puts its stub at the offset port', () => {
    const before = layoutOf(OFFSET);
    const r = dragSegment(OFFSET, before, 'a->b', 0, { dx: 0, dy: -10 });
    const after = layoutOf(ok(r).files).result;
    const line = after.edges.find((e) => e.id === 'a->b')!;
    const a = after.nodes.find((n) => n.id === 'a')!;
    expect(line.points[0]).toEqual(edgeEndPort(a, line, 'source'));
    expect(line.source_at).toBe(0.25);
  });

  test('with spread_ends a line that becomes manual keeps its spread ends, stored as offsets', () => {
    const files = withLayout((js) => {
      js.spread_ends = true;
      js.edges = { 'a->b': { source_side: 'right' }, 'a->d': { source_side: 'right' } };
    });
    const before = layoutOf(files).result;
    const line = before.edges.find((e) => e.id === 'a->d')!;
    expect(line.source_at).toBe(0.67);
    const r = makeManual(files, before, 'a->d');
    const entry = layoutJs(ok(r).files).edges['a->d'];
    expect(entry.source_at).toBe(0.67);
    expect(drawn(ok(r).files, 'a->d')).toEqual(line.points);
  });
});

describe('copy, paste and duplicate carry offsets (A12, A22)', () => {
  test('a duplicated pair keeps its line\'s sides and offsets', () => {
    const files = withLayout((js) => { js.edges = { 'a->b': { source_side: 'right', source_at: 0.25, target_side: 'left', target_at: 0.75 } }; });
    const r = duplicateNodes(files, ['a', 'b'], layoutOf(files));
    const edges = layoutJs(ok(r).files).edges;
    const copy = Object.keys(edges).find((id) => id !== 'a->b')!;
    expect(edges[copy]).toEqual({ source_side: 'right', source_at: 0.25, target_side: 'left', target_at: 0.75 });
  });

  test('the fragment holds the offsets, and a fragment with a bad one is refused', () => {
    const files = withLayout((js) => { js.edges = { 'a->b': { target_side: 'left', target_at: 0.1 } }; });
    const copied = copyFragment(files, ['a', 'b'], layoutOf(files));
    if (!copied.ok) throw new Error(copied.error);
    expect(copied.fragment.edges).toEqual([{ source: 'a', target: 'b', label: null, target_side: 'left', target_at: 0.1 }]);
    const bad = { ...copied.fragment, edges: [{ ...copied.fragment.edges[0]!, target_at: 1.5 }] };
    expect(refused(pasteFragment(files, bad, layoutOf(files), { step: 40 }))).toMatch(/nothing to paste/i);
  });
});

describe('spread_ends on and off (A22)', () => {
  test('on writes "spread_ends": true; off removes it; each is one write the hand edit matches', () => {
    const on = setSpreadEnds(SHAPE, true);
    expectParity(on, SHAPE, { layout: editJson(SHAPE_LAYOUT, (js) => { js.spread_ends = true; }) });
    expectParity(setSpreadEnds(ok(on).files, false), ok(on).files, { layout: SHAPE_LAYOUT });
    // Turning it off when it is off changes nothing; with no layout file, nothing is created.
    expect(ok(setSpreadEnds(SHAPE, false)).files).toEqual(SHAPE);
    expect(ok(setSpreadEnds({ ...SHAPE, layout: null }, false)).files.layout).toBeNull();
  });

  test('on with a broken layout file is refused', () => {
    expect(refused(setSpreadEnds({ ...SHAPE, layout: '{ nope' }, true))).toMatch(/layout file has errors/);
  });

  test('flipping the direction keeps offsets and spread_ends (sides rotate, offsets stay)', () => {
    const files = withLayout((js) => { js.spread_ends = true; js.edges = { 'a->b': { source_side: 'right', source_at: 0.25 } }; });
    expectParity(setDirection(files, 'TB'), files, {
      mmd: SHAPE_MMD.replace('flowchart LR', 'flowchart TB'),
      layout: editJson(files.layout, (js) => { js.edges['a->b'].source_side = 'bottom'; }),
    });
  });
});
