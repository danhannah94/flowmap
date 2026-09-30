// Negative pins (v1.1 §5 Values, §6 Frame): a block dropped before or above everything keeps a negative `along` (any
// lane) or `across` (first lane only), and the layout translates: along the flow by T = max(0, −min along); across,
// the first lane's zero line sits U = max(0, −min across in it) after its start edge and the lane is U thicker. A
// negative `across` in any other lane is E-layout. With every value ≥ 0 nothing changes.
import { describe, expect, test } from 'vitest';
import { loadDocument } from '../document';
import { serializeLayoutFile } from '../layoutfile';
import { duplicateNodes, pinNodes, positionInLane } from '../ops';
import { canon, ok } from '../ops/testkit';
import type { Files } from '../ops';
import { UNASSIGNED, type LayoutResult, type Pin } from '../types';
import { pinTranslation } from './index';

const FLOW = canon(`flowchart LR
  n1["Step 1"]
  n2["Step 2"]
  n3{"Decision 1"}
  n4["Yes"]
  n5["No"]
  n1 --> n2
  n2 --> n3
  n3 -->|yes| n4
  n3 -->|no| n5
`);

const LANES = canon(`flowchart LR
  subgraph alpha [Alpha]
    a1["First"]
    a2["Second"]
  end
  subgraph beta [Beta]
    b1["Third"]
    b2["Fourth"]
  end
  subgraph gamma [Gamma]
    c1["Fifth"]
  end
  a1 --> a2
  a2 --> b1
  b1 --> b2
  b2 --> c1
`);

const U = UNASSIGNED;
const P = (lane: string, along: number, across: number): Pin => ({ lane, along, across });
const text = (nodes: Record<string, Pin>, hints?: unknown) =>
  serializeLayoutFile(hints === undefined ? { version: 1, nodes } : { version: 1, nodes, hints });
const lay = (mmd: string, layout: string | null): LayoutResult => loadDocument(mmd, null, layout, 't.mmd').layout!.result;
const hintsOf = (mmd: string) => loadDocument(mmd, null, null, 't.mmd').layout!.hints;
const node = (r: LayoutResult, id: string) => r.nodes.find((n) => n.id === id)!;
const lane = (r: LayoutResult, id: string) => r.lanes.find((l) => l.id === id)!;
const tb = (mmd: string) => mmd.replace('flowchart LR', 'flowchart TB');

describe('pinTranslation (the frame)', () => {
  test('zero when nothing is negative', () => {
    expect(pinTranslation([], 'a')).toEqual({ along: 0, across: 0 });
    expect(pinTranslation([P('a', 0, 0), P('b', 30, 12)], 'a')).toEqual({ along: 0, across: 0 });
  });
  test('along from every pin, across from the first lane only', () => {
    expect(pinTranslation([P('a', -40, 5), P('a', 10, -30), P('b', -5, -50), P('c', 3, 4)], 'a')).toEqual({ along: 40, across: 30 });
    expect(pinTranslation([P('a', 1, -30)], undefined)).toEqual({ along: 0, across: 0 });
  });
});

describe('the layout translates negative pins', () => {
  // Carry the unpinned layout's hints (as the UI does), so automatic placement is comparable across the cases.
  const withHints = (mmd: string, nodes: Record<string, Pin>) => text(nodes, hintsOf(mmd));

  for (const dir of ['LR', 'TB'] as const) {
    const flow = dir === 'LR' ? FLOW : tb(FLOW);
    const A = (n: { x: number; y: number }) => (dir === 'LR' ? n.x : n.y);
    const C = (n: { x: number; y: number }) => (dir === 'LR' ? n.y : n.x);

    test(`${dir} lane-free: a pin before and above everything; everything else moves with the translation`, () => {
      const base = lay(flow, withHints(flow, { n5: P(U, 300, 100) }));
      const moved = lay(flow, withHints(flow, { n5: P(U, 300, 100), n1: P(U, -150, -90) }));
      // n1 is at the diagram's start: its stored position plus the translation, i.e. 0 / the lane's start.
      expect([A(node(moved, 'n1')), C(node(moved, 'n1'))]).toEqual([0, 0]);
      // Every other block keeps its place relative to the stored frame: shifted by exactly (150, 90).
      for (const id of ['n2', 'n3', 'n4', 'n5']) {
        expect([A(node(moved, id)), C(node(moved, id))]).toEqual([A(node(base, id)) + 150, C(node(base, id)) + 90]);
      }
      // The output still starts at 0 and contains everything.
      expect(Math.min(...moved.nodes.map(A))).toBe(0);
      expect(Math.min(...moved.nodes.map(C))).toBe(0);
      expect(dir === 'LR' ? moved.width : moved.height).toBe((dir === 'LR' ? base.width : base.height) + 150);
      for (const e of moved.edges) for (const [x, y] of e.points) expect(x >= 0 && y >= 0).toBe(true);
    });
  }

  for (const dir of ['LR', 'TB'] as const) {
    test(`${dir} with lanes: along translates every lane; the first lane grows toward its start, moving everything`, () => {
      const mmd = dir === 'LR' ? LANES : tb(LANES);
      const A = (n: { x: number; y: number }) => (dir === 'LR' ? n.x : n.y);
      const C = (n: { x: number; y: number }) => (dir === 'LR' ? n.y : n.x);
      const size = (l: { width: number; height: number }) => (dir === 'LR' ? l.height : l.width);
      const base = lay(mmd, withHints(mmd, { b2: P('beta', 400, 30) }));
      const moved = lay(mmd, withHints(mmd, { b2: P('beta', 400, 30), a1: P('alpha', -60, -40) }));
      // a1 sits at the frame's origin: before everything, at the first lane's start edge.
      expect([A(node(moved, 'a1')), C(node(moved, 'a1'))]).toEqual([0, 0]);
      // Everything else (pinned and automatic, every lane) moved by exactly (60, 40).
      for (const id of ['a2', 'b1', 'b2', 'c1']) {
        expect([A(node(moved, id)), C(node(moved, id))]).toEqual([A(node(base, id)) + 60, C(node(base, id)) + 40]);
      }
      // The first lane is 40 thicker; the lanes still start at 0 and stack.
      expect(size(lane(moved, 'alpha'))).toBe(size(lane(base, 'alpha')) + 40);
      expect(C(lane(moved, 'alpha'))).toBe(0);
      expect(C(lane(moved, 'beta'))).toBe(C(lane(base, 'beta')) + 40);
    });
  }

  test('a negative across outside the first lane is E-layout: laid out with none of the file\'s placements', () => {
    const doc = loadDocument(LANES, null, text({ b1: P('beta', -60, -40), b2: P('beta', 400, 30) }), 't.mmd');
    expect(doc.problems.errors.map((e) => [e.code, e.line])).toEqual([['E-layout', null]]);
    expect(doc.pins).toEqual({});
    expect(doc.layout!.result.nodes.every((n) => !n.pinned)).toBe(true);
    // The first lane follows the config's lane order.
    const cfg = 'version: 1\nlanes:\n  - id: beta\n  - id: alpha\n';
    const ok2 = loadDocument(LANES, cfg, text({ b1: P('beta', -60, -40) }), 't.mmd');
    expect(ok2.problems.errors).toEqual([]);
    expect(ok2.pins.b1).toEqual(P('beta', -60, -40));
  });

  test('every value ≥ 0: byte-identical output (v1.0 files are unchanged)', () => {
    const nodes = { b1: P('beta', 0, 0), c1: P('gamma', 500, 12) };
    const a = loadDocument(LANES, null, text(nodes), 't.mmd').layout!;
    expect(pinTranslation(Object.values(nodes), 'alpha')).toEqual({ along: 0, across: 0 });
    expect(JSON.stringify(a.result)).toBe(JSON.stringify(loadDocument(LANES, null, text(nodes), 't.mmd').layout!.result));
    expect(node(a.result, 'b1').x).toBe(0);
    expect(node(a.result, 'b1').y).toBe(lane(a.result, 'beta').y);
  });

  test('a stale pin (its lane changed in the text) is ignored, negative or not', () => {
    const r = lay(LANES, text({ b1: P('alpha', -500, -500), a1: P('gamma', -500, 5) }));
    expect(node(r, 'b1').pinned).toBe(false);
    expect(Math.min(...r.nodes.map((n) => n.x))).toBeGreaterThan(0);
  });

  test('deterministic', () => {
    const t = text({ n1: P(U, -77, -33), n4: P(U, 900, -5) });
    expect(lay(FLOW, t)).toEqual(lay(FLOW, t));
  });
});

describe('ops measure pins in the stored frame', () => {
  const files: Files = { mmd: FLOW, config: null, layout: text({ n1: P(U, -150, -90) }) };
  test('positionInLane subtracts the translation, so a pin written from it round-trips', () => {
    const doc = loadDocument(files.mmd, null, files.layout, 't.mmd');
    const shift = pinTranslation(Object.values(doc.pins), U);
    expect(shift).toEqual({ along: 150, across: 90 });
    expect(positionInLane(doc.layout!.result, 'n1', shift)).toEqual({ along: -150, across: -90 });
    const n2 = positionInLane(doc.layout!.result, 'n2', shift)!;
    const again = ok(pinNodes(files, [{ id: 'n2', ...n2 }])).files;
    const r = lay(again.mmd, again.layout);
    expect([node(r, 'n2').x, node(r, 'n2').y]).toEqual([node(doc.layout!.result, 'n2').x, node(doc.layout!.result, 'n2').y]);
  });
  test('duplicate pins the copy 40 px along and across from the original, in the stored frame (A12)', () => {
    const doc = loadDocument(files.mmd, null, files.layout, 't.mmd');
    const r = ok(duplicateNodes(files, ['n1'], doc.layout!.result));
    const pins = JSON.parse(r.files.layout!).nodes as Record<string, Pin>;
    expect(pins[r.ids[0]!]).toEqual(P(U, -110, -50));
  });
});
