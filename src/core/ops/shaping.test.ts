// Parity tests for shaping by hand (design.md §10 Part 3: P21 resize, P23 line shapes, P24 line labels). Each test
// applies the operation and, separately, the equivalent hand edit (positions read off the layout JSON and stored in the
// layout file's frame, §5), and compares them as the acceptance suite does.
import { mergePolyline } from '../layout';
import { labelNeeds } from '../measure';
import {
  addBend, dragBend, dragSegment, makeManual, removeBend, resetLabelAt, resetLine, resetSize, resizeNode, setLabelAt,
} from './index';
import { segmentRuns, tidy } from './lines';
import { editJson, expectParity, ok, refused } from './testkit';
import { drawn, handPoint, layoutJs, layoutOf, SHAPE } from './testkit-v11';

const L = layoutOf(SHAPE);
const P = (x: number, y: number) => handPoint(L, x, y);

describe('the fixture is what the tests assume', () => {
  test('boxes, lanes and drawn lines', () => {
    const box = (id: string) => L.result.nodes.find((n) => n.id === id)!;
    expect([box('a').x, box('a').y, box('a').width, box('a').height]).toEqual([40, 30, 120, 52]);
    expect([box('c').x, box('c').y, box('c').width, box('c').height]).toEqual([40, 140, 120, 52]);
    expect(L.result.lanes.map((l) => [l.id, l.y, l.height])).toEqual([['top', 0, 100], ['bottom', 100, 108]]);
    expect(drawn(SHAPE, 'a->b')).toEqual([[160, 56], [400, 56]]);
    expect(drawn(SHAPE, 'a->c')).toEqual([[100, 82], [100, 140]]);
    expect(drawn(SHAPE, 'c->d')).toEqual([[160, 166], [392, 166], [392, 158], [400, 158]]);
    expect(drawn(SHAPE, 'a->d')).toEqual([[160, 72], [392, 72], [392, 158], [400, 158]]);
    expect(L.translation).toEqual({ along: 0, across: 0 });
  });
});

// ---- P21 resize --------------------------------------------------------------------------------------------------

describe('P21 resize (UI34)', () => {
  test('from a corner (se): both dimensions written, the top-left stays, the moved edges rounded (halves toward −∞)', () => {
    const r = resizeNode(SHAPE, L, 'a', 'se', { dx: 30.5, dy: 20.5 });
    expect(ok(r).size).toEqual({ width: 150, height: 72 });
    expectParity(r, SHAPE, { layout: editJson(SHAPE.layout, (js) => { js.nodes.a.width = 150; js.nodes.a.height = 72; }) });
  });

  test('from its top-left (nw): the bottom-right stays, the pin moves', () => {
    const r = resizeNode(SHAPE, L, 'a', 'nw', { dx: -10, dy: -5 });
    expectParity(r, SHAPE, {
      layout: editJson(SHAPE.layout, (js) => { js.nodes.a = { lane: 'top', along: 30, across: 25, width: 130, height: 57 }; }),
    });
  });

  test('one side: both dimensions written even though only one changed', () => {
    expectParity(resizeNode(SHAPE, L, 'b', 's', { dx: 99, dy: 8 }), SHAPE, {
      layout: editJson(SHAPE.layout, (js) => { js.nodes.b.width = 120; js.nodes.b.height = 60; }),
    });
    expectParity(resizeNode(SHAPE, L, 'b', 'e', { dx: 12, dy: 99 }), SHAPE, {
      layout: editJson(SHAPE.layout, (js) => { js.nodes.b.width = 132; js.nodes.b.height = 52; }),
    });
  });

  test('a top handle pins a block that wasn\'t pinned (at its current position)', () => {
    const files = { ...SHAPE, layout: editJson(SHAPE.layout, (js) => { delete js.nodes.b; }) };
    const out = layoutOf(files);
    const b = out.result.nodes.find((n) => n.id === 'b')!;
    const r = resizeNode(files, out, 'b', 'n', { dx: 0, dy: -4 });
    expectParity(r, files, {
      layout: editJson(files.layout, (js) => {
        js.nodes.b = { lane: 'top', along: b.x, across: b.y - 4, width: b.width, height: b.height + 4 };
      }),
    });
  });

  test('the handle stops at the narrowest width and the height the label needs at that width', () => {
    const needs = labelNeeds('Alpha', 'step', 1);
    const r = resizeNode(SHAPE, L, 'a', 'se', { dx: -1000, dy: -1000 });
    const height = Math.max(40, labelNeeds('Alpha', 'step', needs.minWidth).height);
    expect(ok(r).size).toEqual({ width: needs.minWidth, height });
    expectParity(r, SHAPE, { layout: editJson(SHAPE.layout, (js) => { js.nodes.a.width = needs.minWidth; js.nodes.a.height = height; }) });
    // From the left: the right edge stays, so the pin moves to where the stopped left edge is.
    const w = resizeNode(SHAPE, L, 'a', 'w', { dx: 1000, dy: 0 });
    expectParity(w, SHAPE, {
      layout: editJson(SHAPE.layout, (js) => {
        js.nodes.a = { lane: 'top', along: 160 - needs.minWidth, across: 30, width: needs.minWidth, height: Math.max(52, height) };
      }),
    });
  });

  test('a long label: narrowing keeps the stored height at least what the label then needs', () => {
    const files = { ...SHAPE, mmd: SHAPE.mmd.replace('a["Alpha"]', 'a["Alpha and a much longer label than before"]') };
    const out = layoutOf(files);
    const a = out.result.nodes.find((n) => n.id === 'a')!;
    const width = Math.max(a.width - 60, labelNeeds('Alpha and a much longer label than before', 'step', 1).minWidth);
    const need = labelNeeds('Alpha and a much longer label than before', 'step', width).height;
    const r = ok(resizeNode(files, out, 'a', 'e', { dx: -60, dy: 0 }));
    expect(r.size).toEqual({ width, height: Math.max(a.height, need) });
  });

  test('outside the first lane the top handle stops at the lane\'s start edge (across 0)', () => {
    expectParity(resizeNode(SHAPE, L, 'c', 'n', { dx: 0, dy: -100 }), SHAPE, {
      layout: editJson(SHAPE.layout, (js) => { js.nodes.c = { lane: 'bottom', along: 40, across: 0, width: 120, height: 92 }; }),
    });
  });

  test('in the first lane the top handle may go above everything (negative across, v1.1 §5)', () => {
    expectParity(resizeNode(SHAPE, L, 'a', 'n', { dx: 0, dy: -50 }), SHAPE, {
      layout: editJson(SHAPE.layout, (js) => { js.nodes.a = { lane: 'top', along: 40, across: -20, width: 120, height: 102 }; }),
    });
  });

  test('TB: the top handle moves the pin along the flow, the left handle across', () => {
    const files = { ...SHAPE, mmd: SHAPE.mmd.replace('flowchart LR', 'flowchart TB') };
    const out = layoutOf(files);
    const a = out.result.nodes.find((n) => n.id === 'a')!;
    const lane = out.result.lanes.find((l) => l.id === 'top')!;
    expectParity(resizeNode(files, out, 'a', 'nw', { dx: -6, dy: -8 }), files, {
      layout: editJson(files.layout, (js) => {
        js.nodes.a = { lane: 'top', along: a.y - 8, across: a.x - 6 - lane.x, width: a.width + 6, height: a.height + 8 };
      }),
    });
  });

  test('reset size: the size goes, the pin stays; an entry with only a size goes; several blocks at once', () => {
    const sized = { ...SHAPE, layout: editJson(SHAPE.layout, (js) => {
      js.nodes.a.width = 200; js.nodes.a.height = 90; js.nodes.z = { width: 50, height: 50 };
      js.nodes.b = { width: 300, height: 60 };
    }) };
    expectParity(resetSize(sized, ['b', 'a']), sized, {
      layout: editJson(sized.layout, (js) => { delete js.nodes.a.width; delete js.nodes.a.height; delete js.nodes.b; }),
    });
  });

  test('refusals', () => {
    expect(refused(resizeNode(SHAPE, L, 'nope', 'se', { dx: 1, dy: 1 }))).toMatch(/no block/);
    expect(refused(resizeNode(SHAPE, L, 'a', 'up' as 'n', { dx: 1, dy: 1 }))).toMatch(/handle/);
    expect(refused(resizeNode(SHAPE, L, 'a', 'se', { dx: NaN, dy: 1 }))).toMatch(/finite/);
    expect(refused(resetSize(SHAPE, ['nope']))).toMatch(/no block/);
  });
});

// ---- P23 line shapes ---------------------------------------------------------------------------------------------

describe('segments and tidy (UI36 helpers)', () => {
  test('segment runs agree with the layout module\'s merged line', () => {
    for (const line of [
      [[0, 0], [10, 0], [20, 0], [20, 5], [20, 5], [20, 9], [0, 9]],
      [[0, 0], [0, 0]], [[0, 0], [10, 0], [5, 0]], [[1, 1], [1, 8], [1, 20], [4, 20]],
    ] as [number, number][][]) {
      const runs = segmentRuns(line);
      expect(runs.map((r) => [line[r.a], line[r.b]]).flat().filter((_p, k, all) => k === 0 || k % 2 === 1 || all.length < 2))
        .toEqual(mergePolyline(line).length < 2 ? [] : mergePolyline(line));
    }
  });

  test('tidy removes a checked point in a straight row or on top of a neighbour; ports and unchecked points stay', () => {
    const xy: [number, number][] = [[0, 0], [10, 0], [20, 0], [20, 10], [20, 10], [30, 10], [40, 10]];
    expect(tidy(xy, [1])).toEqual([true, false, true, true, true, true, true]);
    expect(tidy(xy, [3, 4])).toEqual([true, true, true, false, true, true, true]);
    expect(tidy(xy, [5, 6, 0])).toEqual([true, true, true, true, true, false, true]);
    expect(tidy(xy, [])).toEqual(xy.map(() => true));
  });
});

describe('P23 line shapes (UI36)', () => {
  test('segment drag on an automatic line attached to ports at both ends: a stub at each, sides stored', () => {
    const r = dragSegment(SHAPE, L, 'a->c', 0, { dx: 30.4, dy: 7 });
    expectParity(r, SHAPE, {
      layout: editJson(SHAPE.layout, (js) => {
        js.edges = { 'a->c': { source_side: 'bottom', target_side: 'top', points: [P(100, 102), P(130, 102), P(130, 120), P(100, 120)] } };
      }),
    });
    // Redrawn through L11, the line is port → stubs → port, with every stored point on it.
    expect(drawn(ok(r).files, 'a->c')).toEqual([[100, 82], [100, 102], [130, 102], [130, 120], [100, 120], [100, 140]]);
  });

  test('segment drag of a middle segment: its two corners move by the same amount', () => {
    expectParity(dragSegment(SHAPE, L, 'c->d', 1, { dx: -100, dy: 0 }), SHAPE, {
      layout: editJson(SHAPE.layout, (js) => {
        js.edges = { 'c->d': { source_side: 'right', target_side: 'left', points: [P(292, 166), P(292, 158)] } };
      }),
    });
  });

  test('becoming manual stores an end that isn\'t at its port; label_at of another edit stays', () => {
    const files = { ...SHAPE, layout: editJson(SHAPE.layout, (js) => { js.edges = { 'a->d': { label_at: 0.25 } }; }) };
    expectParity(dragSegment(files, layoutOf(files), 'a->d', 0, { dx: 0, dy: 10 }), files, {
      layout: editJson(files.layout, (js) => {
        js.edges['a->d'] = { source_side: 'right', target_side: 'left', points: [P(160, 82), P(392, 82), P(392, 158)], label_at: 0.25 };
      }),
    });
  });

  test('makeManual on its own: corners plus the off-port end, and the sides; a straight line stores only its sides', () => {
    expectParity(makeManual(SHAPE, L, 'a->d'), SHAPE, {
      layout: editJson(SHAPE.layout, (js) => {
        js.edges = { 'a->d': { source_side: 'right', target_side: 'left', points: [P(160, 72), P(392, 72), P(392, 158)] } };
      }),
    });
    expectParity(makeManual(SHAPE, L, 'a->b'), SHAPE, {
      layout: editJson(SHAPE.layout, (js) => { js.edges = { 'a->b': { source_side: 'right', target_side: 'left' } }; }),
    });
  });

  test('a segment dragged back into line tidies away: no points left, the line is automatic again, its sides stay', () => {
    expectParity(dragSegment(SHAPE, L, 'a->c', 0, { dx: 0, dy: 0 }), SHAPE, {
      layout: editJson(SHAPE.layout, (js) => { js.edges = { 'a->c': { source_side: 'bottom', target_side: 'top' } }; }),
    });
  });

  test('move a bend point (rounded, halves toward −∞) on an automatic line', () => {
    expectParity(dragBend(SHAPE, L, 'c->d', 0, { x: 300.5, y: 166 }), SHAPE, {
      layout: editJson(SHAPE.layout, (js) => {
        js.edges = { 'c->d': { source_side: 'right', target_side: 'left', points: [P(300, 166), P(392, 158)] } };
      }),
    });
  });

  test('move a bend point on a manual line: stored points keep their values; tidy removes a neighbour in a row', () => {
    const manual = ok(dragSegment(SHAPE, L, 'a->c', 0, { dx: 30, dy: 0 })).files;
    const out = layoutOf(manual);
    // (100,102) is now in a vertical row with the port (100,82) and the moved point (100,110): removed.
    expectParity(dragBend(manual, out, 'a->c', 1, { x: 100, y: 110 }), manual, {
      layout: editJson(manual.layout, (js) => { js.edges['a->c'].points = [P(100, 110), P(130, 120), P(100, 120)]; }),
    });
    // Onto its neighbour: one of the two goes.
    expectParity(dragBend(manual, out, 'a->c', 2, { x: 130, y: 102 }), manual, {
      layout: editJson(manual.layout, (js) => { js.edges['a->c'].points = [P(100, 102), P(130, 102), P(100, 120)]; }),
    });
  });

  test('add a bend point: nearest spot on the line, in path order, kept though it is in a straight row', () => {
    const r = addBend(SHAPE, L, 'a->b', { x: 250.4, y: 70 });
    expect(ok(r).index).toBe(0);
    const one = expectParity(r, SHAPE, {
      layout: editJson(SHAPE.layout, (js) => { js.edges = { 'a->b': { source_side: 'right', target_side: 'left', points: [P(250, 56)] } }; }),
    });
    const two = addBend(one, layoutOf(one), 'a->b', { x: 300, y: 40 });
    expect(ok(two).index).toBe(1);
    const both = expectParity(two, one, { layout: editJson(one.layout, (js) => { js.edges['a->b'].points.push(P(300, 56)); }) });
    const first = addBend(both, layoutOf(both), 'a->b', { x: 170, y: 58 });
    expect(ok(first).index).toBe(0);
    const three = expectParity(first, both, { layout: editJson(both.layout, (js) => { js.edges['a->b'].points.unshift(P(170, 56)); }) });
    // Other points are left alone: dragging the last point only checks it and its neighbours, so (170,56), in a row
    // with the port and (250,56), stays.
    expectParity(dragBend(three, layoutOf(three), 'a->b', 2, { x: 300, y: 90 }), three, {
      layout: editJson(three.layout, (js) => { js.edges['a->b'].points[2] = P(300, 90); }),
    });
  });

  test('add a bend point between a manual line\'s stored points, on an elbow segment or next to a port', () => {
    const files = { ...SHAPE, layout: editJson(SHAPE.layout, (js) => { js.edges = { 'c->d': { points: [P(200, 190), P(300, 190)] } }; }) };
    const out = layoutOf(files);
    // L11: out of the right port horizontally, between bend points along the flow first, into the left port horizontally.
    expect(drawn(files, 'c->d')).toEqual([[160, 166], [200, 166], [200, 190], [300, 190], [300, 158], [400, 158]]);
    const onElbow = addBend(files, out, 'c->d', { x: 310, y: 175 });
    expect(ok(onElbow).index).toBe(2);
    expectParity(onElbow, files, { layout: editJson(files.layout, (js) => { js.edges['c->d'].points.push(P(300, 175)); }) });
    const last = addBend(files, out, 'c->d', { x: 350, y: 150 });
    expect(ok(last).index).toBe(2);
    expectParity(last, files, { layout: editJson(files.layout, (js) => { js.edges['c->d'].points.push(P(350, 158)); }) });
    const first = addBend(files, out, 'c->d', { x: 180, y: 170 });
    expect(ok(first).index).toBe(0);
    expectParity(first, files, { layout: editJson(files.layout, (js) => { js.edges['c->d'].points.unshift(P(180, 166)); }) });
  });

  test('remove a bend point; removing the last one removes points and keeps the sides', () => {
    expectParity(removeBend(SHAPE, L, 'c->d', 0), SHAPE, {
      layout: editJson(SHAPE.layout, (js) => { js.edges = { 'c->d': { source_side: 'right', target_side: 'left', points: [P(392, 158)] } }; }),
    });
    const one = { ...SHAPE, layout: editJson(SHAPE.layout, (js) => { js.edges = { 'c->d': { source_side: 'right', points: [P(300, 160)], label_at: 0.5 } }; }) };
    expectParity(removeBend(one, layoutOf(one), 'c->d', 0), one, {
      layout: editJson(one.layout, (js) => { delete js.edges['c->d'].points; }),
    });
  });

  test('reset the line: points and both sides go, label_at stays; an emptied entry and edges map go', () => {
    const files = { ...SHAPE, layout: editJson(SHAPE.layout, (js) => {
      js.edges = { 'a->d': { source_side: 'top', target_side: 'left', points: [P(300, 20)], label_at: 0.4 }, 'c->d': { source_side: 'right' } };
    }) };
    expectParity(resetLine(files, 'a->d'), files, { layout: editJson(files.layout, (js) => { js.edges['a->d'] = { label_at: 0.4 }; }) });
    const only = { ...SHAPE, layout: editJson(SHAPE.layout, (js) => { js.edges = { 'c->d': { source_side: 'right' } }; }) };
    expectParity(resetLine(only, 'c->d'), only, { layout: editJson(only.layout, (js) => { delete js.edges; }) });
  });

  test('refusals', () => {
    expect(refused(dragSegment(SHAPE, L, 'x->y', 0, { dx: 1, dy: 1 }))).toMatch(/no line/);
    expect(refused(dragSegment(SHAPE, L, 'c->d', 3, { dx: 1, dy: 1 }))).toMatch(/no segment 3/);
    expect(refused(dragBend(SHAPE, L, 'c->d', 2, { x: 1, y: 1 }))).toMatch(/no bend point 2/);
    expect(refused(dragBend(SHAPE, L, 'a->b', 0, { x: 1, y: 1 }))).toMatch(/no bend point 0/);
    expect(refused(removeBend(SHAPE, L, 'c->d', -1))).toMatch(/no bend point/);
    expect(refused(addBend(SHAPE, L, 'c->d', { x: NaN, y: 0 }))).toMatch(/finite/);
    // A layout that doesn't match the files (a stale UI state) is refused rather than guessed at.
    const manual = { ...SHAPE, layout: editJson(SHAPE.layout, (js) => { js.edges = { 'c->d': { points: [P(300, 160)] } }; }) };
    expect(refused(dragBend(manual, L, 'c->d', 0, { x: 1, y: 1 }))).toMatch(/out of date/);
    expect(refused(dragBend(SHAPE, layoutOf(manual), 'c->d', 0, { x: 1, y: 1 }))).toMatch(/out of date/);
    // Points whose lane doesn't exist don't apply: the line is automatic, and shaping it replaces them (§5).
    const stale = { ...SHAPE, layout: editJson(SHAPE.layout, (js) => { js.edges = { 'c->d': { points: [{ lane: 'gone', along: 1, across: 1 }] } }; }) };
    expectParity(removeBend(stale, layoutOf(stale), 'c->d', 1), stale, {
      layout: editJson(stale.layout, (js) => { js.edges['c->d'] = { source_side: 'right', target_side: 'left', points: [P(392, 166)] }; }),
    });
  });
});

// ---- P24 line labels ---------------------------------------------------------------------------------------------

describe('P24 line labels (UI37)', () => {
  test('drag: the centre is projected onto the drawn line; label_at is the fraction of its length, two decimals', () => {
    // a->d is 232 + 86 + 8 = 326 long; (392,100) projects 232 + 28 = 260 along it: 0.7975…
    const r = setLabelAt(SHAPE, L, 'a->d', { x: 380, y: 100 });
    expect(ok(r).labelAt).toBe(0.8);
    expectParity(r, SHAPE, { layout: editJson(SHAPE.layout, (js) => { js.edges = { 'a->d': { label_at: 0.8 } }; }) });
    expect(ok(setLabelAt(SHAPE, L, 'a->d', { x: 0, y: 0 })).labelAt).toBe(0);
    expect(ok(setLabelAt(SHAPE, L, 'a->d', { x: 999, y: 999 })).labelAt).toBe(1);
  });

  test('on a manual line, kept with its points and sides; the line does not become manual', () => {
    const files = { ...SHAPE, layout: editJson(SHAPE.layout, (js) => { js.edges = { 'c->d': { source_side: 'right', points: [P(200, 190), P(300, 190)] } }; }) };
    // Drawn: (160,166) (200,166) (200,190) (300,190) (300,158) (400,158): 40 + 24 + 100 + 32 + 100 = 296 long; the
    // nearest point to (305,170) is (300,170), 40 + 24 + 100 + 20 = 184 along it: 0.6216…
    expect(drawn(files, 'c->d')).toEqual([[160, 166], [200, 166], [200, 190], [300, 190], [300, 158], [400, 158]]);
    expectParity(setLabelAt(files, layoutOf(files), 'c->d', { x: 305, y: 170 }), files, {
      layout: editJson(files.layout, (js) => { js.edges['c->d'].label_at = 0.62; }),
    });
    expectParity(setLabelAt(SHAPE, L, 'a->c', { x: 0, y: 111 }), SHAPE, {
      layout: editJson(SHAPE.layout, (js) => { js.edges = { 'a->c': { label_at: 0.5 } }; }),
    });
  });

  test('reset its position: label_at goes, and the entry if that empties it', () => {
    const files = { ...SHAPE, layout: editJson(SHAPE.layout, (js) => { js.edges = { 'a->d': { label_at: 0.3 }, 'a->b': { source_side: 'top', label_at: 1 } }; }) };
    expectParity(resetLabelAt(files, 'a->d'), files, { layout: editJson(files.layout, (js) => { delete js.edges['a->d']; }) });
    expectParity(resetLabelAt(files, 'a->b'), files, { layout: editJson(files.layout, (js) => { delete js.edges['a->b'].label_at; }) });
    // No layout file and nothing to reset: still no file.
    expect(ok(resetLabelAt({ ...SHAPE, layout: null }, 'a->d')).files.layout).toBeNull();
  });

  test('refusals', () => {
    expect(refused(setLabelAt(SHAPE, L, 'x->y', { x: 0, y: 0 }))).toMatch(/no line/);
    expect(refused(resetLabelAt(SHAPE, 'x->y'))).toMatch(/no line/);
  });
});

test('layoutJs reads the file', () => {
  expect(layoutJs(SHAPE).hints).toEqual({ kept: true });
});
