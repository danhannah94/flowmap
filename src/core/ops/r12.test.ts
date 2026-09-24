// Ruling R12: an operation that changes which lane is displayed first re-expresses the old first lane's pins and bend
// points with its growth U (§6 Frame) added to every `across`, in the same write. Parity: the hand edit adds U (read off
// the layout's frame) to those values. Checks: the layout file stays valid (no E-layout), every `across` outside the
// first lane is at least 0, and the old first lane's blocks and bend points keep their place in their lane.
import { loadDocument } from '../document';
import type { LayoutOutput } from '../layout';
import * as ops from './index';
import type { Files } from './index';
import { edit, editJson, expectParity, ok } from './testkit';
import { layoutOf, SHAPE, SHAPE_CONFIG, SHAPE_LAYOUT, SHAPE_MMD } from './testkit-v11';

/** `a` pinned above the top lane and a bend point above it too, so the top lane grows toward its start. */
const NEG: Files = {
  ...SHAPE,
  layout: editJson(SHAPE_LAYOUT, (js) => {
    js.nodes.a = { lane: 'top', along: 40, across: -20, width: 130, height: 60 };
    js.nodes.zz = { lane: 'top', along: 5, across: 3 }; // an orphan pin in the same lane: shifted too
    js.edges = { 'c->d': { source_side: 'right', points: [{ lane: 'top', along: 300, across: -45 }, { lane: 'bottom', along: 300, across: 50 }] } };
  }),
};

/** Where a node sits inside its lane: its offset from the lane's start edge across the flow, and its `along`. */
function inLane(out: LayoutOutput, id: string): [number, number] {
  const n = out.result.nodes.find((x) => x.id === id)!;
  const l = out.result.lanes.find((x) => x.id === n.lane)!;
  return out.result.direction === 'TB' ? [n.x - l.x, n.y] : [n.y - l.y, n.x];
}

/** Whether an edge's drawn line passes through (x, the lane's start edge + `offset`). */
function drawnAt(out: LayoutOutput, edgeId: string, x: number, laneId: string, offset: number): boolean {
  const l = out.result.lanes.find((ln) => ln.id === laneId)!;
  return out.result.edges.find((e) => e.id === edgeId)!.points.some(([px, py]) => px === x && py === l.y + offset);
}

function expectValid(files: Files): LayoutOutput {
  const doc = loadDocument(files.mmd, files.config, files.layout, 'x.mmd');
  expect(doc.problems.errors).toEqual([]);
  return doc.layout!;
}

describe('R12: the old first lane keeps its place when another lane becomes first', () => {
  const before = layoutOf(NEG);
  const U = before.translation.across;

  test('the fixture: the top lane has grown by U = 45 toward its start', () => {
    expect(U).toBe(45);
    expect(before.result.lanes[0]!.id).toBe('top');
  });

  test('reorder lanes: pins and bend points in the old first lane get U added', () => {
    const r = ops.reorderLanes(NEG, ['bottom', 'top']);
    const after = expectParity(r, NEG, {
      config: `${SHAPE_CONFIG}lanes:\n  - id: bottom\n  - id: top\n`,
      layout: editJson(NEG.layout, (js) => {
        js.nodes.a.across += U;
        js.nodes.b.across += U;
        js.nodes.zz.across += U;
        js.edges['c->d'].points[0].across += U;
      }),
    });
    const out = expectValid(after);
    expect(out.result.lanes[0]!.id).toBe('bottom');
    expect(out.translation.across).toBe(0);
    for (const id of ['a', 'b']) expect(inLane(out, id)).toEqual(inLane(before, id));
    // The bend point was drawn U − 45 = 0 below the top lane's start edge, and still is.
    expect(drawnAt(before, 'c->d', 300, 'top', 0)).toBe(true);
    expect(drawnAt(out, 'c->d', 300, 'top', 0)).toBe(true);
    // The other lane's blocks are unchanged in theirs.
    for (const id of ['c', 'd']) expect(inLane(out, id)).toEqual(inLane(before, id));
  });

  test('move a lane (the lane menu) does the same; moving back does not undo it (nothing is negative then)', () => {
    const down = ok(ops.moveLane(NEG, 'top', 'down')).files;
    expect(JSON.parse(down.layout!)).toEqual(JSON.parse(ok(ops.reorderLanes(NEG, ['bottom', 'top'])).files.layout!));
    const back = ok(ops.moveLane(down, 'top', 'up')).files;
    expect(back.layout).toBe(down.layout);
    expect(inLane(expectValid(back), 'a')).toEqual(inLane(before, 'a'));
  });

  test('delete the first lane: what stays in it (an orphan pin) gets U; moved blocks lose their pins', () => {
    const r = ops.deleteLane(NEG, 'top', { mode: 'move', target: 'bottom' });
    const after = expectParity(r, NEG, {
      mmd: SHAPE_MMD.replace('  subgraph top [Top]\n    a["Alpha"]\n    b["Beta"]\n  end\n\n', '')
        .replace('    d{"Delta?"}\n', '    d{"Delta?"}\n    a["Alpha"]\n    b["Beta"]\n'),
      layout: editJson(NEG.layout, (js) => {
        js.nodes.a = { width: 130, height: 60 };
        delete js.nodes.b;
        js.nodes.zz.across += U;
        delete js.edges['c->d'].points;
      }),
    });
    expectValid(after);
  });

  test('add a lane to a lane-free diagram: the Unassigned lane\'s negative values get U', () => {
    const free: Files = {
      mmd: 'flowchart LR\n  x["X"]\n  y["Y"]\n  x --> y\n',
      config: null,
      layout: JSON.stringify({ version: 1, nodes: { x: { lane: '_unassigned', along: 10, across: -30 } },
        edges: { 'x->y': { points: [{ lane: '_unassigned', along: 150, across: -12 }] } } }),
    };
    const out0 = layoutOf(free);
    expect(out0.translation.across).toBe(30);
    const r = ops.addLane(free, 'Sales');
    const after = expectParity(r, free, {
      mmd: 'flowchart LR\n  x["X"]\n  y["Y"]\n\n  subgraph sales [Sales]\n  end\n\n  x --> y\n',
      layout: JSON.stringify({ version: 1, nodes: { x: { lane: '_unassigned', along: 10, across: 0 } },
        edges: { 'x->y': { points: [{ lane: '_unassigned', along: 150, across: 18 }] } } }),
    });
    const out = expectValid(after);
    expect(out.result.lanes.map((l) => l.id)).toEqual(['sales', '_unassigned']);
    // The pinned block keeps its place in its lane (y is automatic, and moves only for the new lane-header strip, A4).
    expect(inLane(out, 'x')).toEqual(inLane(out0, 'x'));
    expect(drawnAt(out0, 'x->y', 150, '_unassigned', 18)).toBe(true);
    expect(drawnAt(out, 'x->y', 150, '_unassigned', 18)).toBe(true);
  });

  test('nothing negative (U = 0): the layout file is untouched', () => {
    expect(ok(ops.reorderLanes(SHAPE, ['bottom', 'top'])).files.layout).toBe(SHAPE.layout);
  });

  test('the first lane staying first changes nothing', () => {
    expect(ok(ops.reorderLanes(NEG, ['top', 'bottom'])).files.layout).toBe(NEG.layout);
    expect(ok(ops.addLane(NEG, 'Later')).files.layout).toBe(NEG.layout);
  });

  test('a layout file with errors: refused if it could hold a negative value in the old first lane', () => {
    const broken = { ...NEG, layout: NEG.layout!.replace('"along": 400', '"along": 400.5') };
    expect(ops.reorderLanes(broken, ['bottom', 'top'])).toMatchObject({ ok: false, error: expect.stringMatching(/layout file has errors/) });
    const noNegatives = { ...SHAPE, layout: SHAPE.layout!.replace('"along": 400', '"along": 400.5') };
    expect(ok(ops.reorderLanes(noNegatives, ['bottom', 'top'])).files.layout).toBe(noNegatives.layout);
    // Reordering with a config order that doesn't touch the first lane writes only the config.
    const three = { ...broken, mmd: edit(SHAPE_MMD, ['  a --> b\n', '  subgraph z [Z]\n  end\n\n  a --> b\n']) };
    expect(ok(ops.reorderLanes(three, ['top', 'z', 'bottom'])).files.layout).toBe(three.layout);
  });
});
