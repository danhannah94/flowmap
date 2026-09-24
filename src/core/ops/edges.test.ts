// Parity tests for line operations (design.md §10 Part 3: P5–P8).
import { connect, deleteItems, reconnect, setEdgeLabel } from './index';
import { edit, expectParity, ok, PR, refused, RICH, RICH_MMD } from './testkit';

describe('P5 connect (UI15)', () => {
  test('appended at the end of the edge section; returns the edge id', () => {
    const r = connect(PR, 'm03', 'p01');
    expect(ok(r).edgeId).toBe('m03->p01');
    expectParity(r, PR, { mmd: edit(PR.mmd, ['  f03 --> f04\n', '  f03 --> f04\n  m03 --> p01\n']) });
  });

  test('after the last edge even when edges are written inside subgraphs, before pass-through lines', () => {
    expectParity(connect(RICH, 'stray', 'intake'), RICH, {
      mmd: edit(RICH_MMD, ['loose --> stray\n', 'loose --> stray\nstray --> intake\n']),
    });
  });

  test('a duplicate edge gets the next #n id', () => {
    const r = connect(RICH, 'r01', 'm01');
    expect(ok(r).edgeId).toBe('r01->m01#3');
    expectParity(r, RICH, { mmd: edit(RICH_MMD, ['loose --> stray\n', 'loose --> stray\nr01 --> m01\n']) });
    expect(ok(connect(PR, 'intake', 'r01')).edgeId).toBe('intake->r01#2');
  });

  test('to a never-declared node, and a loop onto itself', () => {
    expectParity(connect(RICH, 'ghost', 'ghost'), RICH, {
      mmd: edit(RICH_MMD, ['loose --> stray\n', 'loose --> stray\nghost-->ghost\n']),
    });
  });

  test('refusals: unknown blocks, lanes are not blocks', () => {
    expect(refused(connect(PR, 'nope', 'r01'))).toMatch(/no block/);
    expect(refused(connect(PR, 'r01', 'manager'))).toMatch(/no block/);
  });
});

describe('P6 reconnect (UI16)', () => {
  test('source: keeps its place, label and comment; the id follows the endpoints', () => {
    const r = reconnect(RICH, 'r01->m01', 'source', 'intake');
    expect(ok(r).edgeId).toBe('intake->m01');
    expectParity(r, RICH, { mmd: edit(RICH_MMD, ['%% hand-off to the manager\nr01 --> m01', '%% hand-off to the manager\nintake --> m01']) });
  });

  test('target, on a labelled edge', () => {
    const r = reconnect(PR, 'p02->p03', 'target', 'm03');
    expect(ok(r).edgeId).toBe('p02->m03');
    expectParity(r, PR, { mmd: edit(PR.mmd, ['  p02 -->|no| p03\n', '  p02 -->|no| m03\n']) });
  });

  test('one edge of an & group, and an edge written inside a subgraph', () => {
    expectParity(reconnect(RICH, 'f01->ghost', 'target', 'loose'), RICH, {
      mmd: edit(RICH_MMD, ['f01 --> f02 & ghost\n', 'f01 --> f02 & loose\n']),
    });
    expectParity(reconnect(RICH, 'm01->m02', 'source', 'f02'), RICH, {
      mmd: edit(RICH_MMD, ['  m01 --> m02\n', '  f02 --> m02\n']),
    });
  });

  test('the second of two duplicate edges', () => {
    const r = reconnect(RICH, 'r01->m01#2', 'target', 'm02');
    expect(ok(r).edgeId).toBe('r01->m02');
    expectParity(r, RICH, { mmd: edit(RICH_MMD, ['r01 --> m01\nloose', 'r01 --> m02\nloose']) });
  });

  test('refusals', () => {
    expect(refused(reconnect(PR, 'x->y', 'source', 'r01'))).toMatch(/no line/);
    expect(refused(reconnect(PR, 'r01->p01', 'source', 'nope'))).toMatch(/no block/);
    expect(refused(reconnect(PR, 'r01->p01', 'middle' as 'source', 'p02'))).toMatch(/source/);
  });
});

describe('P7 edge label (UI17)', () => {
  test('set', () => {
    expectParity(setEdgeLabel(PR, 'r01->p01', 'sends it'), PR, { mmd: edit(PR.mmd, ['  r01 --> p01\n', '  r01 -- sends it --> p01\n']) });
  });

  test('set one that needs quotes, keeping the comment', () => {
    expectParity(setEdgeLabel(RICH, 'r01->m01', 'Over "$1k" & #1'), RICH, {
      mmd: edit(RICH_MMD, ['%% hand-off to the manager\nr01 --> m01', '%% hand-off to the manager\nr01 -->|"Over #quot;$1k#quot; & #1"| m01']),
    });
  });

  test('change', () => {
    expectParity(setEdgeLabel(PR, 'p02->p04', 'complete'), PR, { mmd: edit(PR.mmd, ['p02 -->|yes| p04', 'p02 -->|complete| p04']) });
    expectParity(setEdgeLabel(RICH, 'm02->r01', 'not yet'), RICH, { mmd: edit(RICH_MMD, ['m02 -- no --> r01', 'm02 -->|not yet| r01']) });
  });

  test('clear: empty, blank or null removes the label', () => {
    for (const empty of ['', '   ', null]) {
      expectParity(setEdgeLabel(PR, 'm02->m03', empty), PR, { mmd: edit(PR.mmd, ['m02 -->|no| m03', 'm02 --> m03']) });
    }
  });

  test('refusals', () => {
    expect(refused(setEdgeLabel(PR, 'm02->m03', 'a\nb'))).toMatch(/single line/);
    expect(refused(setEdgeLabel(PR, 'm02->zz', 'x'))).toMatch(/no line/);
  });
});

describe('P8 delete an edge (UI14)', () => {
  test('with its comment', () => {
    expectParity(deleteItems(RICH, { edges: ['r01->m01'] }), RICH, {
      mmd: edit(RICH_MMD, ['%% hand-off to the manager\nr01 --> m01\n', '']),
    });
  });

  test('one of two duplicates; one of an & group', () => {
    expectParity(deleteItems(RICH, { edges: ['r01->m01#2'] }), RICH, { mmd: edit(RICH_MMD, ['r01 --> m01\nloose', 'loose']) });
    expectParity(deleteItems(RICH, { edges: ['f01->f02'] }), RICH, { mmd: edit(RICH_MMD, ['f01 --> f02 & ghost', 'f01 --> ghost']) });
  });

  test('the last edge of a never-declared node removes that node', () => {
    const after = expectParity(deleteItems(RICH, { edges: ['f01->ghost'] }), RICH, { mmd: edit(RICH_MMD, [' & ghost', '']) });
    expect(after.mmd).not.toContain('ghost');
  });

  test('purchase-request: an edge and the layout and config untouched', () => {
    expectParity(deleteItems(PR, { edges: ['p02->p04'] }), PR, { mmd: edit(PR.mmd, ['  p02 -->|yes| p04\n', '']) });
  });
});
