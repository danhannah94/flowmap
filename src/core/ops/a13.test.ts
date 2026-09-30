// Amendment A13: the lanes' length along the flow (the pool's far edge: right for `LR`, bottom for `TB`). Parity as in
// the other ops tests: the operation's files equal the same change made by hand; plus the promise on screen: nothing
// the person didn't touch moves, and the far edge stays put relative to the content when the frame's T changes.
import { loadDocument } from '../document';
import type { LayoutOutput } from '../layout';
import {
  clearAllPins, deleteLane, pinNodes, promoteUnassigned, renameLane, reorderLanes, resetLaneLength, resizeLane,
  resizeLaneLength, setDirection, setLaneLabel, type Files,
} from './index';
import { editJson, expectParity, ok, refused, RICH } from './testkit';
import { layoutOf, SHAPE, SHAPE_CONFIG, SHAPE_LAYOUT } from './testkit-v11';

function expectValid(files: Files): LayoutOutput {
  const doc = loadDocument(files.mmd, files.config, files.layout, 'x.mmd');
  expect(doc.problems.errors).toEqual([]);
  return doc.layout!;
}

/** The lanes' length along the flow (every lane spans it, L1). */
const lengthOf = (out: LayoutOutput) => {
  const r = out.result;
  const total = r.direction === 'TB' ? r.height : r.width;
  for (const l of r.lanes) expect(r.direction === 'TB' ? l.height : l.width).toBe(total);
  return total;
};
const stored = (files: Files): unknown => (files.layout === null ? undefined : JSON.parse(files.layout).lane_length);

const LANE_FREE: Files = { mmd: 'flowchart LR\n  a["Alpha"]\n  b["Beta"]\n  a --> b\n', config: null, layout: null };

describe('A13: the lanes\' length along the flow', () => {
  const out0 = layoutOf(SHAPE);
  const need = out0.laneLengthNeed;

  test('dragging the far edge stores the length; the lanes span it; no block, lane band or line moves', () => {
    expect(lengthOf(out0)).toBe(need);
    const r = resizeLaneLength(SHAPE, need + 300.4);
    expect(ok(r).length).toBe(need + 300);
    const after = expectParity(r, SHAPE, { layout: editJson(SHAPE_LAYOUT, (js) => { js.lane_length = need + 300; }) });
    const out = expectValid(after);
    expect(lengthOf(out)).toBe(need + 300);
    expect(out.result.nodes).toEqual(out0.result.nodes);
    expect(out.result.edges.map((e) => e.points)).toEqual(out0.result.edges.map((e) => e.points));
    expect(out.result.height).toBe(out0.result.height);
    // Again: the value changes in place; back to what the content needs (or less) removes it.
    expect(stored(ok(resizeLaneLength(after, need + 20)).files)).toBe(need + 20);
    for (const length of [need, need - 50, 0]) {
      const back = ok(resizeLaneLength(after, length));
      expect(back.length).toBeNull();
      expect(JSON.parse(back.files.layout!)).toEqual(JSON.parse(SHAPE_LAYOUT));
    }
    expect(ok(resizeLaneLength(SHAPE, need)).files).toEqual(SHAPE);
  });

  test('with a block before the flow start (T), the stored length leaves T out, so the lanes are exactly as long as dragged', () => {
    const files = { ...SHAPE, layout: editJson(SHAPE_LAYOUT, (js) => { js.nodes.a.along = -90; }) };
    const out = layoutOf(files);
    expect(out.translation.along).toBe(90);
    const r = resizeLaneLength(files, out.laneLengthNeed + 200);
    expect(ok(r).length).toBe(out.laneLengthNeed + 200 - 90);
    expect(lengthOf(expectValid(ok(r).files))).toBe(out.laneLengthNeed + 200);
  });

  test('a drop before the flow start after the length was set keeps the far edge where it was relative to the content', () => {
    const long = ok(resizeLaneLength(SHAPE, need + 300)).files;
    const before = layoutOf(long);
    const bAt = (o: LayoutOutput) => o.result.nodes.find((n) => n.id === 'b')!.x;
    // Drop `a` 150 px before the flow start: everything moves by T = 150 in the output, the far edge too.
    const dropped = ok(pinNodes(long, [{ id: 'a', along: -150, across: 30 }])).files;
    const out = expectValid(dropped);
    expect(out.translation.along).toBe(150);
    expect(stored(dropped)).toBe(need + 300);
    expect(lengthOf(out) - bAt(out)).toBe(lengthOf(before) - bAt(before));
  });

  test('top-to-bottom: the length is the lanes\' height, and the direction toggle keeps it byte for byte', () => {
    const long = ok(resizeLaneLength(SHAPE, need + 150)).files;
    const tb = ok(setDirection(long, 'TB')).files;
    expect(stored(tb)).toBe(need + 150);
    const out = expectValid(tb);
    expect(out.result.direction).toBe('TB');
    expect(lengthOf(out)).toBe(Math.max(need + 150, out.laneLengthNeed));
    expect(ok(setDirection(tb, 'LR')).files).toEqual(long);
    // Resized in TB, flipped back to LR: the same value, now the width.
    const t = layoutOf(tb);
    const tall = ok(resizeLaneLength(tb, t.laneLengthNeed + 400)).files;
    expect(lengthOf(expectValid(tall))).toBe(t.laneLengthNeed + 400);
    const lr = ok(setDirection(tall, 'LR')).files;
    expect(stored(lr)).toBe(t.laneLengthNeed + 400);
    expect(expectValid(lr).result.width).toBe(Math.max(t.laneLengthNeed + 400, layoutOf(lr).laneLengthNeed));
  });

  test('Reset length removes it; with none, nothing changes', () => {
    const long = ok(resizeLaneLength(SHAPE, need + 300)).files;
    expectParity(resetLaneLength(long), long, { layout: SHAPE_LAYOUT });
    expect(ok(resetLaneLength(SHAPE)).files).toEqual(SHAPE);
    const none: Files = { ...SHAPE, layout: null };
    expect(ok(resetLaneLength(none)).files).toEqual(none);
  });

  test('lane renames, relabels, reorders, A7 promotion, lane sizes, re-layout all and deleting lanes keep it', () => {
    const long = ok(resizeLaneLength(SHAPE, need + 300)).files;
    const kept = [
      renameLane(long, 'top', 'upper'), setLaneLabel(long, 'top', 'Upper'), reorderLanes(long, ['bottom', 'top']),
      resizeLane(long, 'top', out0.laneNeeds.top! + 50), clearAllPins(long),
      deleteLane(long, 'bottom', { mode: 'delete' }), deleteLane(long, 'bottom', { mode: 'move', target: '_unassigned' }),
    ];
    for (const r of kept) expect(stored(ok(r).files)).toBe(need + 300);
    const rich = ok(resizeLaneLength(RICH, layoutOf(RICH).laneLengthNeed + 100)).files;
    expect(stored(ok(promoteUnassigned(rich, 'Loose ends')).files)).toBe(layoutOf(RICH).laneLengthNeed + 100);
  });

  test('deleting every lane keeps it in the file, where it doesn\'t apply (no bands, A4); a lane added back brings it back', () => {
    const long = ok(resizeLaneLength(SHAPE, need + 300)).files;
    let files = ok(deleteLane(long, 'top', { mode: 'move', target: '_unassigned' })).files;
    files = ok(deleteLane(files, 'bottom', { mode: 'move', target: '_unassigned' })).files;
    expect(stored(files)).toBe(need + 300);
    const free = expectValid(files);
    expect(free.result.lanes.map((l) => l.id)).toEqual(['_unassigned']);
    expect(lengthOf(free)).toBe(free.laneLengthNeed);
    expect(refused(resizeLaneLength(files, 5000))).toMatch(/no lanes/);
  });

  test('refusals: a diagram without lanes, a bad number, a layout file with errors', () => {
    expect(refused(resizeLaneLength(LANE_FREE, 2000))).toMatch(/no lanes to lengthen/);
    expect(refused(resizeLaneLength(SHAPE, Number.NaN))).toMatch(/finite/);
    expect(refused(resizeLaneLength(SHAPE, Number.POSITIVE_INFINITY))).toMatch(/finite/);
    expect(refused(resizeLaneLength({ ...SHAPE, layout: '{' }, 2000))).toMatch(/layout file has errors/);
    // Reset with a broken file: refused only if the file could hold a length (R6.2).
    expect(refused(resetLaneLength({ ...SHAPE, layout: '{"lane_length": 900' }))).toMatch(/layout file has errors/);
    expect(ok(resetLaneLength({ ...SHAPE, layout: '{' })).files.layout).toBe('{');
  });

  test('R12: the first lane changing re-expresses across values only; the length (along the flow) is untouched', () => {
    const files = { ...SHAPE, layout: editJson(SHAPE_LAYOUT, (js) => { js.nodes.a.across = -20; js.lane_length = need + 100; }) };
    const after = expectParity(reorderLanes(files, ['bottom', 'top']), files, {
      config: `${SHAPE_CONFIG}lanes:\n  - id: bottom\n  - id: top\n`,
      layout: editJson(files.layout, (js) => {
        js.nodes.a.across += 20;
        js.nodes.b.across += 20;
      }),
    });
    expect(lengthOf(expectValid(after))).toBe(need + 100);
  });
});
