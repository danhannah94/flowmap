// Copy, paste and duplicate (amendment A12), checked the way the parity tests are (design.md §10 Part 3): each paste
// is compared with the same change made by hand to the files, positions read off `flowmap layout` output.
import { parse } from '../mmd';
import {
  copyFragment, deleteItems, fragmentToMermaid, isFragment, PASTE_STEP, pasteFragment, type Fragment,
} from './index';
import { edit, editJson, expectParity, ok, refused } from './testkit';
import { layoutJs, layoutOf, SHAPE, SHAPE_CONFIG, SHAPE_LAYOUT, SHAPE_MMD } from './testkit-v11';
import type { Files } from './context';

const withLayout = (change: (js: any) => void): Files => ({ ...SHAPE, layout: editJson(SHAPE_LAYOUT, change) });

function copy(files: Files, ids: string[]): Fragment {
  const r = copyFragment(files, ids, layoutOf(files));
  if (!r.ok) throw new Error(r.error);
  return r.fragment;
}

/** A line with a stored side, label position and bend point, between `b` (top) and `d` (bottom). */
const SHAPED = withLayout((js) => {
  js.edges = { 'b->d': { source_side: 'bottom', target_side: 'top', points: [{ lane: 'top', along: 560, across: 60 }], label_at: 0.3 } };
});

describe('copyFragment', () => {
  test('blocks in file declaration order, their lanes, and only the lines with both ends copied', () => {
    const f = copy(SHAPE, ['d', 'b']);
    expect(f.nodes.map((n) => n.id)).toEqual(['b', 'd']);
    expect(f.lanes).toEqual([{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }]);
    expect(f.edges).toEqual([{ source: 'b', target: 'd', label: null }]);
    const b = f.nodes[0]!;
    expect(b).toMatchObject({ shape: 'step', label: 'Beta', className: null, lane: 'top', pos: { along: 400, across: 30 }, size: null, meta: { owner: 'sam' } });
    const drawn = layoutOf(SHAPE).result.nodes.find((n) => n.id === 'b')!;
    expect(b.box).toEqual({ x: drawn.x, y: drawn.y, width: drawn.width, height: drawn.height });
    expect(f.nodes[1]).toMatchObject({ shape: 'decision', label: 'Delta?', lane: 'bottom', meta: null });
  });

  test('a line keeps its label, sides, label position and bend points (with where they were drawn)', () => {
    const f = copy(SHAPED, ['a', 'b', 'd']);
    expect(f.edges.map((e) => [e.source, e.target, e.label])).toEqual([['a', 'b', null], ['b', 'd', null], ['a', 'd', 'yes']]);
    const bd = f.edges[1]!;
    expect(bd).toMatchObject({ source_side: 'bottom', target_side: 'top', label_at: 0.3 });
    const top = layoutOf(SHAPED).result.lanes.find((l) => l.id === 'top')!;
    expect(bd.points).toEqual([{ pin: { lane: 'top', along: 560, across: 60 }, x: 560, y: top.y + 60 }]);
  });

  test('stored sizes are copied', () => {
    const files = withLayout((js) => { js.nodes.c.width = 150; js.nodes.c.height = 70; });
    expect(copy(files, ['c']).nodes[0]!.size).toEqual({ width: 150, height: 70 });
  });

  test('refusals: nothing selected, an unknown block, a broken config that mentions a copied block', () => {
    expect(copyFragment(SHAPE, [], layoutOf(SHAPE))).toEqual({ ok: false, error: expect.stringMatching(/Select/) });
    expect(copyFragment(SHAPE, ['zz'], layoutOf(SHAPE))).toEqual({ ok: false, error: expect.stringMatching(/no block/) });
    const broken = { ...SHAPE, config: 'version: 1\nnodes:\n  b: [oops\n' };
    expect(copyFragment(broken, ['b'], layoutOf(broken))).toEqual({ ok: false, error: expect.stringMatching(/config file has errors/) });
    expect(copyFragment(broken, ['c'], layoutOf(broken)).ok).toBe(true); // c isn't in the broken file
  });
});

describe('pasteFragment in the same diagram (step)', () => {
  test('new ids from the originals, same lanes, metadata and lines copied, pinned one step along and across', () => {
    const f = copy(SHAPED, ['d', 'b']);
    const r = pasteFragment(SHAPED, f, layoutOf(SHAPED), { step: PASTE_STEP });
    expect(ok(r).ids).toEqual(['b-2', 'd-2']);
    expect(ok(r).from).toEqual(['b', 'd']);
    expectParity(r, SHAPED, {
      mmd: edit(SHAPE_MMD,
        ['    b["Beta"]\n', '    b["Beta"]\n    b-2["Beta"]\n'],
        ['    d{"Delta?"}\n', '    d{"Delta?"}\n    d-2{"Delta?"}\n'],
        ['  a -->|yes| d\n', '  a -->|yes| d\n  b-2 --> d-2\n']),
      config: `${SHAPE_CONFIG}  b-2:\n    owner: sam\n`,
      layout: editJson(SHAPED.layout, (js) => {
        js.nodes['b-2'] = { lane: 'top', along: 440, across: 70 };
        js.nodes['d-2'] = { lane: 'bottom', along: 440, across: 70 };
        js.edges['b-2->d-2'] = { source_side: 'bottom', target_side: 'top', points: [{ lane: 'top', along: 600, across: 100 }], label_at: 0.3 };
      }),
    });
  });

  test('pasting again steps again and takes the next free ids; a line label is kept', () => {
    const f = copy(SHAPE, ['a', 'd']);
    const once = ok(pasteFragment(SHAPE, f, layoutOf(SHAPE), { step: PASTE_STEP })).files;
    const twice = pasteFragment(once, f, layoutOf(once), { step: 2 * PASTE_STEP });
    expect(ok(twice).ids).toEqual(['a-3', 'd-3']);
    expect(twice.ok && twice.files.mmd).toContain('  a-2 -->|yes| d-2\n  a-3 -->|yes| d-3\n');
    const pins = layoutJs(ok(twice).files).nodes;
    expect(pins['a-3']).toEqual({ lane: 'top', along: 120, across: 110 });
    expect(pins['d-3']).toEqual({ lane: 'bottom', along: 480, across: 110 });
  });

  test('ids: a trailing -<number> is counted on from, and ids taken anywhere (config, layout) are skipped', () => {
    const files: Files = {
      mmd: 'flowchart LR\n\n  subgraph s [S]\n    review-2["Review"]\n  end\n',
      config: 'version: 1\nnodes:\n  review-3:\n    note: orphan\n',
      layout: '{"version": 1, "nodes": {"review-4": {"width": 60, "height": 60}}}\n',
    };
    const f = copy(files, ['review-2']);
    expect(ok(pasteFragment(files, f, layoutOf(files), { step: 40 })).ids).toEqual(['review-5']);
  });

  test('a cut then a paste gives the block its id back and reuses its metadata entry (no orphan, no copy)', () => {
    const f = copy(SHAPE, ['b']);
    const cut = ok(deleteItems(SHAPE, { nodes: ['b'] })).files;
    expect(cut.config).toBe(SHAPE_CONFIG); // UI14 never deletes metadata
    const r = pasteFragment(cut, f, layoutOf(cut), { step: 0 });
    expect(ok(r).ids).toEqual(['b']);
    expect(ok(r).files.config).toBe(SHAPE_CONFIG);
    expect(layoutJs(ok(r).files).nodes.b).toEqual({ lane: 'top', along: 400, across: 30 });
    // Metadata edited since the cut: that entry belongs to someone else now, so the paste takes a new id.
    const edited = { ...cut, config: SHAPE_CONFIG.replace('owner: sam', 'owner: lee') };
    expect(ok(pasteFragment(edited, f, layoutOf(edited), { step: 0 })).ids).toEqual(['b-2']);
  });

  test('a new line whose id has an orphaned layout entry replaces it (R11.4)', () => {
    const files = withLayout((js) => { js.edges = { 'b-2->d-2': { label_at: 0.9 } }; });
    const r = ok(pasteFragment(files, copy(files, ['b', 'd']), layoutOf(files), { step: 40 }));
    expect(layoutJs(r.files).edges).toBeUndefined();
  });

  test('refusals: nothing to paste, a layout file with errors, a broken config when there is metadata to write', () => {
    const f = copy(SHAPE, ['b']);
    expect(refused(pasteFragment(SHAPE, { ...f, nodes: [] }, layoutOf(SHAPE), { step: 40 }))).toMatch(/nothing to paste/);
    const badLayout = { ...SHAPE, layout: '{"version": 1, "nodes": {"a": 3}}' };
    expect(refused(pasteFragment(badLayout, f, layoutOf(badLayout), { step: 40 }))).toMatch(/layout file has errors/);
    const badConfig = { ...SHAPE, config: 'version: 1\nnodes: [\n' };
    expect(refused(pasteFragment(badConfig, f, layoutOf(badConfig), { step: 40 }))).toMatch(/config file has errors/);
    expect(ok(pasteFragment(badConfig, copy(SHAPE, ['c']), layoutOf(badConfig), { step: 40 })).files.config).toBe(badConfig.config);
  });
});

describe('pasteFragment into another diagram', () => {
  const TARGET: Files = {
    mmd: 'flowchart LR\n\n  subgraph x [X]\n    q["Q"]\n  end\n\n  subgraph bottom [Bottom]\n    r["R"]\n  end\n',
    config: null,
    layout: null,
  };

  test('lanes that exist are kept; a missing lane falls back to the first lane; free ids are kept; files are created', () => {
    const f = copy(SHAPED, ['b', 'd']);
    const r = pasteFragment(TARGET, f, layoutOf(TARGET), { step: 40 });
    expect(ok(r).ids).toEqual(['b', 'd']);
    expectParity(r, TARGET, {
      mmd: edit(TARGET.mmd, ['    q["Q"]\n', '    q["Q"]\n    b["Beta"]\n'], ['    r["R"]\n', '    r["R"]\n    d{"Delta?"}\n'])
        .concat('\n  b --> d\n'),
      config: 'version: 1\nnodes:\n  b:\n    owner: sam\n',
      // The bend point was in `top`, which this diagram doesn't have: the line is routed automatically (sides kept).
      layout: editJson(null, (js) => {
        js.nodes.b = { lane: 'x', along: 440, across: 70 };
        js.nodes.d = { lane: 'bottom', along: 440, across: 70 };
        js.edges = { 'b->d': { source_side: 'bottom', target_side: 'top', label_at: 0.3 } };
      }),
    });
  });

  test('a lane-free diagram takes every block into Unassigned', () => {
    const free: Files = { mmd: 'flowchart LR\n  z["Z"]\n', config: null, layout: null };
    const r = ok(pasteFragment(free, copy(SHAPE, ['a', 'c']), layoutOf(free), { step: 40 }));
    expect(r.files.mmd).toBe('flowchart LR\n\n  z["Z"]\n  a["Alpha"]\n  c["Gamma"]\n\n  a --> c\n');
    expect(layoutJs(r.files).nodes).toEqual({
      a: { lane: '_unassigned', along: 80, across: 70 }, c: { lane: '_unassigned', along: 80, across: 80 },
    });
  });
});

describe('pasteFragment at a point (the pointer)', () => {
  test('the group\'s top-left lands at the point; each block joins the lane under its own centre (UI43)', () => {
    const out = layoutOf(SHAPE);
    const box = (id: string) => out.result.nodes.find((n) => n.id === id)!;
    const bottom = out.result.lanes.find((l) => l.id === 'bottom')!;
    const f = copy(SHAPE, ['a', 'b']); // both in the top lane, side by side
    const at = { x: 900, y: bottom.y + 20 };
    const r = ok(pasteFragment(SHAPE, f, out, { at }));
    expect(r.blocks.map((b) => [b.id, b.lane])).toEqual([['a-2', 'bottom'], ['b-2', 'bottom']]);
    const dx = at.x - Math.min(box('a').x, box('b').x);
    const dy = at.y - Math.min(box('a').y, box('b').y);
    expect(r.blocks[0]!.box).toEqual({ x: box('a').x + dx, y: box('a').y + dy, width: box('a').width, height: box('a').height });
    const pins = layoutJs(r.files).nodes;
    expect(pins['a-2']).toEqual({ lane: 'bottom', along: box('a').x + dx, across: box('a').y + dy - bottom.y });
    expect(pins['b-2']).toEqual({ lane: 'bottom', along: box('b').x + dx, across: box('b').y + dy - bottom.y });
    expect(r.files.mmd).toContain('  a-2 --> b-2\n');
  });

  test('a point below every lane puts the blocks in Unassigned (A4c)', () => {
    const out = layoutOf(SHAPE);
    const r = ok(pasteFragment(SHAPE, copy(SHAPE, ['c']), out, { at: { x: 100, y: out.result.height + 200 } }));
    expect(r.blocks[0]!.lane).toBe('_unassigned');
    expect(r.files.mmd).toMatch(/^flowchart LR\n\n {2}c-2\["Gamma"\]\n/);
  });
});

describe('fragmentToMermaid', () => {
  test('a valid flowmap .mmd in canonical form, with lanes, labels and lines', () => {
    expect(fragmentToMermaid(copy(SHAPE, ['a', 'b', 'c', 'd']))).toBe(SHAPE_MMD);
    const text = fragmentToMermaid(copy(SHAPE, ['d', 'a']));
    expect(text).toBe('flowchart LR\n\n  subgraph top [Top]\n    a["Alpha"]\n  end\n\n  subgraph bottom [Bottom]\n    d{"Delta?"}\n  end\n\n  a -->|yes| d\n');
    expect(parse(text).problems.errors).toEqual([]);
  });

  test('Unassigned blocks are written without a lane', () => {
    const files: Files = { mmd: 'flowchart TB\n  u(["Loose #quot;one#quot;"])\n\n  subgraph s [S]\n    v["V"]\n  end\n\n  u --> v\n', config: null, layout: null };
    const text = fragmentToMermaid(copy(files, ['u', 'v']));
    expect(text).toBe('flowchart TB\n\n  u(["Loose #quot;one#quot;"])\n\n  subgraph s [S]\n    v["V"]\n  end\n\n  u --> v\n');
    expect(parse(text).problems.errors).toEqual([]);
  });
});

describe('isFragment (a fragment read back from storage)', () => {
  test('a fragment survives JSON; damaged ones are rejected', () => {
    const f = JSON.parse(JSON.stringify(copy(SHAPED, ['a', 'b', 'd'])));
    expect(isFragment(f)).toBe(true);
    const bad = (change: (x: any) => void) => {
      const x = structuredClone(f);
      change(x);
      return isFragment(x);
    };
    expect(bad((x) => { x.version = 2; })).toBe(false);
    expect(bad((x) => { x.nodes[0].shape = 'hexagon'; })).toBe(false);
    expect(bad((x) => { x.nodes[0].id = 'end'; })).toBe(false); // reserved (§3.1)
    expect(bad((x) => { x.nodes[0].id = '9a'; })).toBe(false);
    expect(bad((x) => { x.nodes[1].id = x.nodes[0].id; })).toBe(false);
    expect(bad((x) => { x.nodes[0].label = 'two\nlines'; })).toBe(false);
    expect(bad((x) => { x.edges[0].target = 'nowhere'; })).toBe(false);
    expect(bad((x) => { x.edges[1].points = []; })).toBe(false);
    expect(bad((x) => { x.nodes[0].size = { width: 10, height: 50 }; })).toBe(false);
    expect(isFragment(null)).toBe(false);
    expect(isFragment('flowchart LR')).toBe(false);
  });
});
