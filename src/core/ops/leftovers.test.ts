// Live entries versus leftovers in the layout file (§8.2 "Keeping the layout file in step", rulings R11.4, R12, R14.3,
// R15). A leftover is an entry that applies to nothing: an orphaned edge entry (no line has its key) or an orphaned pin.
// - R11.4: when re-keying (rename, reconnect, delete), a live line's entry that lands on an orphan's key replaces it,
//   whatever the order of the two in the file.
// - §8.2 / R14.3 / R15: deleting a lane removes the `points` of every LIVE line with a bend point in that lane; an
//   orphaned entry's bend points in the deleted first lane are leftovers: they get U, or go if still negative.
import { loadDocument } from '../document';
import * as ops from './index';
import type { Files } from './index';
import { editJson, expectParity } from './testkit';
import { layoutOf } from './testkit-v11';

const P = (lane: string, along: number, across: number) => ({ lane, along, across });

describe('R11.4: a live entry re-keyed onto an orphan\'s key replaces it (P28)', () => {
  const MMD = `flowchart LR

  subgraph side [Side]
    x["X"]
    d["D"]
  end

  x --> d
`;
  const LIVE = { source_side: 'right', points: [P('side', 600, 20)] };
  const ORPHAN = { label_at: 0.75 };
  const withEdges = (edges: Record<string, unknown>): Files => ({
    mmd: MMD,
    config: null,
    layout: JSON.stringify({ version: 1, nodes: { x: { lane: 'side', along: 0, across: 0 } }, edges }),
  });

  for (const [name, edges] of [
    ['orphan after the live entry', { 'x->d': LIVE, 'b->d': ORPHAN }],
    ['orphan before the live entry', { 'b->d': ORPHAN, 'x->d': LIVE }],
  ] as const) {
    test(`rename: ${name}`, () => {
      const files = withEdges(edges);
      expectParity(ops.renameNode(files, 'x', 'b'), files, {
        mmd: MMD.replace('x["X"]', 'b["X"]').replace('x --> d', 'b --> d'),
        layout: editJson(files.layout, (js) => {
          js.nodes = { b: js.nodes.x };
          js.edges = { 'b->d': LIVE };
        }),
      });
    });
  }

  test('rename: a live line without an entry still displaces the orphan on its new key', () => {
    const files = withEdges({ 'b->d': ORPHAN });
    expectParity(ops.renameNode(files, 'x', 'b'), files, {
      mmd: MMD.replace('x["X"]', 'b["X"]').replace('x --> d', 'b --> d'),
      layout: editJson(files.layout, (js) => {
        js.nodes = { b: js.nodes.x };
        delete js.edges;
      }),
    });
  });

  test('rename: an orphan that only names the renamed node is not one of its lines, and keeps its key', () => {
    const files = withEdges({ 'x->d': LIVE, 'x->zz': ORPHAN });
    expectParity(ops.renameNode(files, 'x', 'b'), files, {
      mmd: MMD.replace('x["X"]', 'b["X"]').replace('x --> d', 'b --> d'),
      layout: editJson(files.layout, (js) => {
        js.nodes = { b: js.nodes.x };
        js.edges = { 'b->d': LIVE, 'x->zz': ORPHAN };
      }),
    });
  });

  test('reconnect: the live entry lands on an orphan before it in the file', () => {
    const mmd = MMD.replace('    d["D"]\n', '    d["D"]\n    e["E"]\n');
    const files: Files = { mmd, config: null, layout: JSON.stringify({ version: 1, nodes: {}, edges: { 'x->e': ORPHAN, 'x->d': { label_at: 0.2, target_side: 'left' } } }) };
    expectParity(ops.reconnect(files, 'x->d', 'target', 'e'), files, {
      mmd: mmd.replace('x --> d', 'x --> e'),
      layout: editJson(files.layout, (js) => { js.edges = { 'x->e': { label_at: 0.2 } }; }),
    });
  });
});

describe('R14.3, R15: deleting the first lane keeps leftovers there (orphaned entries\' bend points) with U added (P28)', () => {
  const MMD = `flowchart LR

  subgraph first [First]
    a["A"]
  end

  subgraph second [Second]
    b["B"]
    c["C"]
  end

  a --> b
  b --> c
`;
  /** The first lane grows by U = 30 toward its start (a is pinned at -30). */
  const files: Files = {
    mmd: MMD,
    config: null,
    layout: JSON.stringify({
      version: 1,
      nodes: { a: { lane: 'first', along: 0, across: -30 } },
      edges: {
        'x->y': { points: [P('first', 50, -10)] }, // an orphan: -10 + 30 = 20, kept
        'q->r': { label_at: 0.5, points: [P('first', 60, -40)] }, // an orphan still negative after U: the point goes
        'b->c': { points: [P('first', 70, 5), P('second', 80, 5)] }, // a live line: its points go (§8.2)
      },
    }),
  };

  test('the fixture: U = 30', () => {
    expect(layoutOf(files).translation.across).toBe(30);
  });

  for (const mode of [{ mode: 'delete' }, { mode: 'move', target: 'second' }] as const) {
    test(`delete the first lane (${mode.mode}): orphans' points get U or go; live lines lose theirs`, () => {
      const r = ops.deleteLane(files, 'first', mode);
      const after = expectParity(r, files, {
        mmd: mode.mode === 'delete'
          ? 'flowchart LR\n\n  subgraph second [Second]\n    b["B"]\n    c["C"]\n  end\n\n  b --> c\n'
          : 'flowchart LR\n\n  subgraph second [Second]\n    b["B"]\n    c["C"]\n    a["A"]\n  end\n\n  a --> b\n  b --> c\n',
        layout: editJson(files.layout, (js) => {
          js.nodes = {};
          js.edges = { 'x->y': { points: [P('first', 50, 20)] }, 'q->r': { label_at: 0.5 } };
        }),
      });
      expect(loadDocument(after.mmd, after.config, after.layout, 'x.mmd').problems.errors).toEqual([]);
    });
  }
});
