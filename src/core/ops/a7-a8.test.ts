// Amendments A7 (renaming the Unassigned lane promotes it to a real lane) and A8 (lane sizes). Parity as in the other
// ops tests: the operation's files equal the same change made by hand (then `fmt` on the `.mmd`); plus the promise both
// make on screen: nothing the person didn't touch moves.
import { loadDocument } from '../document';
import type { LayoutOutput } from '../layout';
import {
  addLane, clearAllPins, deleteLane, moveNodesToLane, promoteUnassigned, renameLane, reorderLanes, resetLaneSize,
  resizeLane, setDirection, setNodeLabel, setTitle, type Files,
} from './index';
import { edit, editJson, expectParity, ok, PR, refused, RICH, RICH_CONFIG, RICH_MMD } from './testkit';
import { layoutOf, SHAPE, SHAPE_CONFIG, SHAPE_LAYOUT } from './testkit-v11';

const EMPTY_LANE = '\nsubgraph empty [Empty lane]\n  %% nothing here yet\nend\n';
const UNLANED = '%% an unlaned note\nloose["Loose end"]\nstray{"Stray question?"}:::hot\n';
const PROMOTED = 'subgraph loose-ends [Loose ends]\n  %% an unlaned note\n  loose["Loose end"]\n  stray{"Stray question?"}:::hot\n  ghost["ghost"]\nend\n';

function expectValid(files: Files): LayoutOutput {
  const doc = loadDocument(files.mmd, files.config, files.layout, 'x.mmd');
  expect(doc.problems.errors).toEqual([]);
  return doc.layout!;
}

/** Every lane band and block box, with lane ids mapped (`from` → `to`), for "nothing moved on screen". */
function boxes(out: LayoutOutput, from?: string, to?: string) {
  const id = (lane: string) => (lane === from ? to! : lane);
  return {
    lanes: out.result.lanes.map((l) => ({ ...l, id: id(l.id), label: '' })),
    nodes: out.result.nodes.map((n) => ({ ...n, lane: id(n.lane) })).sort((p, q) => (p.id < q.id ? -1 : 1)),
    size: [out.result.width, out.result.height],
  };
}

describe('A7: renaming Unassigned makes it a real lane', () => {
  test('a subgraph with the label and the UI18 id, holding every unlaned block with its comments; pins follow', () => {
    const r = promoteUnassigned(RICH, 'Loose ends');
    expect(ok(r).id).toBe('loose-ends');
    const after = expectParity(r, RICH, {
      mmd: edit(RICH_MMD, [UNLANED, ''], [EMPTY_LANE, `${EMPTY_LANE}${PROMOTED}`]),
      layout: editJson(RICH.layout, (js) => { js.nodes.stray.lane = 'loose-ends'; }),
    });
    // Nothing moves on screen: the new lane is drawn where Unassigned was (last), every block where it was.
    const out = expectValid(after);
    expect(out.result.lanes.map((l) => l.id)).toEqual(['finance', 'requester', 'manager', 'empty', 'loose-ends']);
    expect(boxes(out)).toEqual(boxes(layoutOf(RICH), '_unassigned', 'loose-ends'));
  });

  test('a config lanes list that lists every lane gets the new lane appended; style rules on _unassigned follow', () => {
    const config = edit(RICH_CONFIG, ['  - id: manager\n', '  - id: manager\n  - id: empty\n'],
      ['  - match: {confidence: confirmed}\n', '  - legend: Loose\n    match: {lane: _unassigned}   # unlaned\n    style: {border_style: dotted}\n  - match: {confidence: confirmed}\n']);
    const files = { ...RICH, config };
    const after = expectParity(promoteUnassigned(files, 'Loose ends'), files, {
      mmd: edit(RICH_MMD, [UNLANED, ''], [EMPTY_LANE, `${EMPTY_LANE}${PROMOTED}`]),
      config: edit(config, ['  - id: empty\n', '  - id: empty\n  - id: loose-ends\n'], ['match: {lane: _unassigned}', 'match: {lane: loose-ends}']),
      layout: editJson(RICH.layout, (js) => { js.nodes.stray.lane = 'loose-ends'; }),
    });
    expect(boxes(expectValid(after))).toEqual(boxes(layoutOf(files), '_unassigned', 'loose-ends'));
    const doc = loadDocument(after.mmd, after.config, after.layout, 'x.mmd');
    expect(doc.styles.loose).toEqual({ border_style: 'dotted' });
  });

  test('a taken id gets -2; a stale config entry for the new id is removed (R6.4)', () => {
    expect(ok(promoteUnassigned(RICH, 'Manager')).id).toBe('manager-2');
    expect(ok(promoteUnassigned(RICH, 'Loose')).id).toBe('loose-2'); // `loose` is a block
    const r = promoteUnassigned(RICH, 'Archive');
    expectParity(r, RICH, {
      mmd: edit(RICH_MMD, [UNLANED, ''], [EMPTY_LANE, `${EMPTY_LANE}${PROMOTED.replace('loose-ends [Loose ends]', 'archive [Archive]')}`]),
      config: edit(RICH.config!, ['  - id: archive        # stale: no such lane\n', '']),
      layout: editJson(RICH.layout, (js) => { js.nodes.stray.lane = 'archive'; }),
    });
  });

  test('no config: none is created; bend points and the lane size in _unassigned follow', () => {
    const files: Files = {
      mmd: 'flowchart LR\n  loose["Loose"]\n\n  subgraph a [A]\n    x["X"]\n  end\n\n  x --> loose\n',
      config: null,
      layout: JSON.stringify({ version: 1, nodes: {}, lanes: { _unassigned: { size: 260 } },
        edges: { 'x->loose': { points: [{ lane: '_unassigned', along: 300, across: 20 }] } } }),
    };
    const after = expectParity(promoteUnassigned(files, 'B'), files, {
      mmd: 'flowchart LR\n\n  subgraph a [A]\n    x["X"]\n  end\n\n  subgraph b [B]\n    loose["Loose"]\n  end\n\n  x --> loose\n',
      layout: JSON.stringify({ version: 1, nodes: {}, lanes: { b: { size: 260 } },
        edges: { 'x->loose': { points: [{ lane: 'b', along: 300, across: 20 }] } } }),
    });
    expect(boxes(expectValid(after))).toEqual(boxes(layoutOf(files), '_unassigned', 'b'));
    expect(layoutOf(after).result.edges[0]!.points).toEqual(layoutOf(files).result.edges[0]!.points);
  });

  test('a lane-free diagram: its one lane becomes the first real lane; U, notes and the title stay put', () => {
    const files: Files = {
      mmd: 'flowchart LR\n  x["X"]\n  y["Y"]\n  x --> y\n',
      config: 'version: 1\nnotes:\n  n1:\n    text: Hello\n',
      layout: JSON.stringify({ version: 1, nodes: { x: { lane: '_unassigned', along: 10, across: -30 } },
        lanes: { _unassigned: { size: 200 } }, notes: { n1: { x: 5, y: -70 } }, title: { x: 0, y: -90 } }),
    };
    const before = layoutOf(files);
    expect(before.translation.across).toBe(30);
    const after = expectParity(promoteUnassigned(files, 'Sales'), files, {
      mmd: 'flowchart LR\n\n  subgraph sales [Sales]\n    x["X"]\n    y["Y"]\n  end\n\n  x --> y\n',
      layout: JSON.stringify({ version: 1, nodes: { x: { lane: 'sales', along: 10, across: -30 } },
        lanes: { sales: { size: 200 } }, notes: { n1: { x: 5, y: -70 } }, title: { x: 0, y: -90 } }),
    });
    const out = expectValid(after);
    expect(out.translation.across).toBe(30);
    expect(out.result.lanes[0]!.height).toBe(230);
    // Across the flow nothing moves (along it, the new lane-header strip shifts the automatic blocks, as UI18 does, A4).
    expect(out.result.nodes.map((n) => n.y)).toEqual(before.result.nodes.map((n) => n.y));
    expect(out.result.notes).toEqual(before.result.notes);
    expect([out.result.title!.x, out.result.title!.y]).toEqual([before.result.title!.x, before.result.title!.y]);
  });

  test('refusals: nothing in Unassigned, an empty or multi-line label; files with errors that it would change', () => {
    expect(refused(promoteUnassigned(PR, 'Loose'))).toMatch(/No block is in Unassigned/);
    expect(refused(promoteUnassigned(RICH, ' '))).toMatch(/empty/);
    expect(refused(promoteUnassigned(RICH, 'a\nb'))).toMatch(/single line/);
    const brokenConfig = { ...RICH, config: 'version: 1\nstyles: [\n' };
    expect(ok(promoteUnassigned(brokenConfig, 'Loose ends')).files.config).toBe(brokenConfig.config);
    expect(refused(promoteUnassigned({ ...RICH, config: 'version: 1\n# _unassigned\nstyles: [\n' }, 'Loose ends'))).toMatch(/config file has errors/);
    expect(refused(promoteUnassigned({ ...RICH, layout: RICH.layout!.replace('"along": 500', '"along": 500.5') }, 'Loose ends')))
      .toMatch(/layout file has errors/);
  });
});

describe('UI19: renaming the first lane keeps it first (R12 does not apply)', () => {
  test('notes and the title stay put when the first lane, grown by U, gets a new id', () => {
    const files: Files = {
      ...SHAPE,
      config: `${SHAPE_CONFIG}notes:\n  n1:\n    text: Hello\n`,
      layout: editJson(SHAPE_LAYOUT, (js) => {
        js.nodes.a.across = -20;
        js.notes = { n1: { x: 5, y: -70 } };
        js.title = { x: 0, y: -90 };
      }),
    };
    expect(layoutOf(files).translation.across).toBe(20);
    const after = expectParity(renameLane(files, 'top', 'upper'), files, {
      mmd: edit(SHAPE.mmd, ['subgraph top [Top]', 'subgraph upper [Top]']),
      layout: editJson(files.layout, (js) => { js.nodes.a.lane = 'upper'; js.nodes.b.lane = 'upper'; }),
    });
    expect(boxes(expectValid(after))).toEqual(boxes(layoutOf(files), 'top', 'upper'));
    expect(layoutOf(after).result.notes).toEqual(layoutOf(files).result.notes);
  });
});

describe('A8: lane sizes', () => {
  const out0 = layoutOf(SHAPE);
  const need = out0.laneNeeds;
  const band = (out: LayoutOutput, id: string) => out.result.lanes.find((l) => l.id === id)!;

  test('dragging a lane\'s far edge stores its size; later lanes move by the difference, its own blocks stay', () => {
    const r = resizeLane(SHAPE, 'top', need.top! + 80.4);
    expect(ok(r).size).toBe(need.top! + 80);
    const after = expectParity(r, SHAPE, {
      layout: editJson(SHAPE_LAYOUT, (js) => { js.lanes = { top: { size: need.top! + 80 } }; }),
    });
    const out = expectValid(after);
    expect(band(out, 'top').height).toBe(need.top! + 80);
    expect(band(out, 'bottom').y).toBe(band(out0, 'bottom').y + 80);
    const at = (o: LayoutOutput, id: string) => o.result.nodes.find((n) => n.id === id)!;
    for (const id of ['a', 'b']) expect(at(out, id).y).toBe(at(out0, id).y);
    for (const id of ['c', 'd']) expect(at(out, id).y).toBe(at(out0, id).y + 80);
    // Resizing again changes the entry in place; dragging back to what the content needs (or less) removes it.
    const again = ok(resizeLane(after, 'top', need.top! + 20)).files;
    expect(JSON.parse(again.layout!).lanes).toEqual({ top: { size: need.top! + 20 } });
    for (const size of [need.top!, need.top! - 50, 0]) {
      const back = ok(resizeLane(after, 'top', size));
      expect(back.size).toBeNull();
      expect(JSON.parse(back.files.layout!)).toEqual(JSON.parse(SHAPE_LAYOUT));
    }
    expect(ok(resizeLane(SHAPE, 'top', need.top!)).files).toEqual(SHAPE);
  });

  test('the first lane grown by U: the stored size leaves U out, so the band is exactly the size dragged to', () => {
    const files = { ...SHAPE, layout: editJson(SHAPE_LAYOUT, (js) => { js.nodes.a.across = -25; }) };
    const out = layoutOf(files);
    expect(out.translation.across).toBe(25);
    const r = resizeLane(files, 'top', out.laneNeeds.top! + 40);
    expect(ok(r).size).toBe(out.laneNeeds.top! + 40 - 25);
    expect(band(expectValid(ok(r).files), 'top').height).toBe(out.laneNeeds.top! + 40);
  });

  test('Unassigned, and top-to-bottom (the size is the lane\'s width)', () => {
    const u = layoutOf(RICH).laneNeeds._unassigned!;
    const r = ok(resizeLane(RICH, '_unassigned', u + 100)).files;
    expect(JSON.parse(r.layout!).lanes).toEqual({ _unassigned: { size: u + 100 } });
    const tb = ok(setDirection(SHAPE, 'TB')).files;
    const t = layoutOf(tb);
    const wide = ok(resizeLane(tb, 'bottom', t.laneNeeds.bottom! + 60)).files;
    expect(band(expectValid(wide), 'bottom').width).toBe(t.laneNeeds.bottom! + 60);
  });

  test('refusals: a lane that isn\'t showing, a bad number, a layout file with errors', () => {
    expect(refused(resizeLane(SHAPE, 'nope', 300))).toMatch(/no lane "nope"/);
    expect(refused(resizeLane(SHAPE, '_unassigned', 300))).toMatch(/no lane "_unassigned"/);
    expect(refused(resizeLane(SHAPE, 'top', Number.NaN))).toMatch(/finite/);
    expect(refused(resizeLane({ ...SHAPE, layout: '{' }, 'top', 300))).toMatch(/layout file has errors/);
  });

  const SIZED: Files = {
    ...SHAPE,
    layout: editJson(SHAPE_LAYOUT, (js) => { js.lanes = { top: { size: 300 }, bottom: { size: 250 } }; }),
  };

  test('Reset size removes the entry; with none, nothing changes', () => {
    expectParity(resetLaneSize(SIZED, 'top'), SIZED, { layout: editJson(SIZED.layout, (js) => { delete js.lanes.top; }) });
    expect(ok(resetLaneSize(SHAPE, 'top')).files).toEqual(SHAPE);
    expect(refused(resetLaneSize(SHAPE, 'nope'))).toMatch(/no lane/);
  });

  test('deleting a lane drops its entry; renaming it (UI19) carries the entry over in place', () => {
    expectParity(deleteLane(SIZED, 'bottom', { mode: 'delete' }), SIZED, {
      mmd: edit(SHAPE.mmd, ['  subgraph bottom [Bottom]\n    c["Gamma"]\n    d{"Delta?"}\n  end\n\n', ''],
        ['  a --> c\n  b --> d\n  c --> d\n  a -->|yes| d\n', '']),
      layout: editJson(SIZED.layout, (js) => { delete js.lanes.bottom; delete js.nodes.c; delete js.nodes.d; }),
    });
    const after = expectParity(renameLane(SIZED, 'top', 'upper'), SIZED, {
      mmd: edit(SHAPE.mmd, ['subgraph top [Top]', 'subgraph upper [Top]']),
      layout: editJson(SIZED.layout, (js) => {
        js.nodes.a.lane = 'upper';
        js.nodes.b.lane = 'upper';
        js.lanes = { upper: { size: 300 }, bottom: { size: 250 } };
      }),
    });
    expect(Object.keys(JSON.parse(after.layout!).lanes)).toEqual(['upper', 'bottom']);
  });

  test('A7: promoting Unassigned carries its size over; Unassigned going away otherwise drops it', () => {
    const files = { ...RICH, layout: editJson(RICH.layout, (js) => { js.lanes = { _unassigned: { size: 250 } }; }) };
    expect(JSON.parse(ok(promoteUnassigned(files, 'Loose ends')).files.layout!).lanes).toEqual({ 'loose-ends': { size: 250 } });
    const moved = ok(moveNodesToLane(files, ['loose', 'stray', 'ghost'], 'manager')).files;
    expect('lanes' in JSON.parse(moved.layout!)).toBe(false);
  });

  test('entries for lanes that don\'t exist are dropped on the next write, whatever it changes', () => {
    const files = { ...SHAPE, layout: editJson(SHAPE_LAYOUT, (js) => { js.lanes = { gone: { size: 200 }, top: { size: 400 } }; }) };
    expect(loadDocument(files.mmd, files.config, files.layout, 'x.mmd').problems).toEqual({ errors: [], warnings: [] });
    for (const r of [setNodeLabel(files, 'a', 'Alpha 2'), setTitle(files, 'New title'), addLane(files, 'Later')]) {
      expect(JSON.parse(ok(r).files.layout!).lanes).toEqual({ top: { size: 400 } });
    }
  });

  test('R12: when the first lane stops being first, its size gets U like its pins (its band keeps its thickness)', () => {
    const files = { ...SIZED, layout: editJson(SIZED.layout, (js) => { js.nodes.a.across = -20; }) };
    const before = layoutOf(files);
    expect(before.translation.across).toBe(20);
    expect(band(before, 'top').height).toBe(320);
    const after = expectParity(reorderLanes(files, ['bottom', 'top']), files, {
      config: `${SHAPE_CONFIG}lanes:\n  - id: bottom\n  - id: top\n`,
      layout: editJson(files.layout, (js) => {
        js.nodes.a.across += 20;
        js.nodes.b.across += 20;
        js.lanes.top.size += 20;
      }),
    });
    expect(band(expectValid(after), 'top').height).toBe(320);
  });

  test('the direction toggle, re-layout all and undo keep sizes byte for byte', () => {
    const tb = ok(setDirection(SIZED, 'TB')).files;
    expect(JSON.parse(tb.layout!).lanes).toEqual({ top: { size: 300 }, bottom: { size: 250 } });
    expect(expectValid(tb).result.lanes.map((l) => l.width)).toEqual([300, 250]);
    expect(JSON.parse(ok(clearAllPins(SIZED)).files.layout!).lanes).toEqual({ top: { size: 300 }, bottom: { size: 250 } });
    expect(ok(setDirection(tb, 'LR')).files).toEqual(SIZED);
  });
});
