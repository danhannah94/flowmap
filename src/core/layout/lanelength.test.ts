// Amendment A13: a stored lane length is a minimum for the lanes' shared length along the flow. The frame's flow-axis
// length is max(T + stored, what the content needs), measured from the flow axis's zero line (T after the start, §6
// Frame), so a block dropped before the flow start doesn't move the far edge relative to everything else.
// `laneLengthNeed` reports what the content needs, which is where the far-edge handle stops. A lane-free diagram (A4)
// has no bands, so the stored length doesn't apply there.
import { describe, expect, it } from 'vitest';
import type { Graph, LayoutFile, LayoutResult } from '../types';
import { UNASSIGNED } from '../types';
import { layoutDiagram } from './index';
import { checkLayout } from './testkit';

const GRAPH: Graph = {
  direction: 'LR',
  lanes: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
  nodes: [
    { id: 'a1', label: 'Fill the purchase request form', kind: 'step', lane: 'a' },
    { id: 'a2', label: 'Approved?', kind: 'decision', lane: 'a' },
    { id: 'b1', label: 'Send the quote', kind: 'io', lane: 'b' },
    { id: 'u1', label: 'Loose end', kind: 'step', lane: UNASSIGNED },
  ],
  edges: [
    { id: 'a1->a2', source: 'a1', target: 'a2', label: null },
    { id: 'a2->b1', source: 'a2', target: 'b1', label: 'yes' },
  ],
};
const LANE_FREE: Graph = {
  direction: 'LR',
  lanes: [],
  nodes: GRAPH.nodes.map((n) => ({ ...n, lane: UNASSIGNED })),
  edges: GRAPH.edges,
};
const tb = (g: Graph): Graph => ({ ...g, direction: 'TB' });
const file = (f: Partial<LayoutFile>): LayoutFile => ({ version: 1, nodes: {}, ...f });
/** The lanes' length along the flow: every lane's, which must all be the diagram's. */
const along = (r: LayoutResult) => {
  const total = r.direction === 'TB' ? r.height : r.width;
  for (const l of r.lanes) expect(r.direction === 'TB' ? l.height : l.width).toBe(total);
  return total;
};
const alongOf = (r: LayoutResult, id: string) => {
  const n = r.nodes.find((x) => x.id === id)!;
  return r.direction === 'TB' ? n.y : n.x;
};

describe('A13 stored lane length', () => {
  for (const g of [GRAPH, tb(GRAPH)]) {
    it(`${g.direction}: a longer length is exact; every lane spans it; nothing else moves`, () => {
      const plain = layoutDiagram({ graph: g, file: null });
      expect(plain.laneLengthNeed).toBe(along(plain.result));
      const f = file({ lane_length: plain.laneLengthNeed + 250 });
      const out = layoutDiagram({ graph: g, file: f });
      expect(along(out.result)).toBe(plain.laneLengthNeed + 250);
      expect(out.laneLengthNeed).toBe(plain.laneLengthNeed);
      expect(out.result.nodes).toEqual(plain.result.nodes);
      expect(out.result.lanes.map((l) => [l.id, l.x, l.y])).toEqual(plain.result.lanes.map((l) => [l.id, l.x, l.y]));
      // Across the flow nothing changes.
      expect(g.direction === 'TB' ? out.result.width : out.result.height).toBe(g.direction === 'TB' ? plain.result.width : plain.result.height);
      expect(checkLayout(g, {}, out.result, { strict: true, file: f })).toEqual([]);
    });

    it(`${g.direction}: a length shorter than the content needs changes nothing (it is a minimum)`, () => {
      const plain = layoutDiagram({ graph: g, file: null });
      for (const n of [100, plain.laneLengthNeed - 1, plain.laneLengthNeed]) {
        expect(layoutDiagram({ graph: g, file: file({ lane_length: n }) }).result).toEqual(plain.result);
      }
    });
  }

  it('measured from the flow axis\'s zero line: a block dropped before the flow start (T) keeps the far edge in place', () => {
    const pinned = { a1: { lane: 'a', along: 60, across: 30 } };
    const plain = layoutDiagram({ graph: GRAPH, file: file({ nodes: pinned, lane_length: 1400 }) });
    expect(plain.translation.along).toBe(0);
    expect(along(plain.result)).toBe(1400);
    // Drop b1 120 px before the flow start: T = 120 and every flow-axis position moves by it, the far edge too.
    const dropped = { ...pinned, b1: { lane: 'b', along: -120, across: 20 } };
    const out = layoutDiagram({ graph: GRAPH, file: file({ nodes: dropped, lane_length: 1400 }) });
    expect(out.translation.along).toBe(120);
    expect(along(out.result)).toBe(120 + 1400);
    expect(along(out.result) - alongOf(out.result, 'a1')).toBe(along(plain.result) - alongOf(plain.result, 'a1'));
    // The need includes T: without a stored length the lanes are exactly that long.
    expect(along(layoutDiagram({ graph: GRAPH, file: file({ nodes: dropped }) }).result)).toBe(out.laneLengthNeed);
  });

  it('a lane-free diagram (A4) has no bands: the stored length doesn\'t apply', () => {
    for (const g of [LANE_FREE, tb(LANE_FREE)]) {
      const plain = layoutDiagram({ graph: g, file: null });
      const out = layoutDiagram({ graph: g, file: file({ lane_length: plain.laneLengthNeed + 500 }) });
      expect(out.result).toEqual(plain.result);
      expect(out.laneLengthNeed).toBe(plain.laneLengthNeed);
    }
  });

  it('with lane sizes (A8): both apply, each on its own axis', () => {
    const plain = layoutDiagram({ graph: GRAPH, file: null });
    const f = file({ lanes: { a: { size: plain.laneNeeds.a! + 40 } }, lane_length: plain.laneLengthNeed + 60 });
    const out = layoutDiagram({ graph: GRAPH, file: f });
    expect(out.result.width).toBe(plain.result.width + 60);
    expect(out.result.height).toBe(plain.result.height + 40);
    expect(checkLayout(GRAPH, {}, out.result, { strict: true, file: f })).toEqual([]);
  });

  it('deterministic (L10)', () => {
    const f = file({ lane_length: 2222 });
    expect(layoutDiagram({ graph: GRAPH, file: f })).toEqual(layoutDiagram({ graph: GRAPH, file: f }));
  });
});
