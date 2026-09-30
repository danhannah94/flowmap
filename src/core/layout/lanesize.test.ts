// Amendment A8: a stored lane size is a minimum. The band is max(stored, what its content needs) thick across the flow,
// measured from the lane's zero line (U after its start edge in the first lane, §6 Frame); `laneNeeds` reports what
// the content needs, which is where a lane's resize handle stops.
import { describe, expect, it } from 'vitest';
import type { Graph, LayoutFile, LayoutResult } from '../types';
import { UNASSIGNED } from '../types';
import { layoutDiagram, MIN_LANE } from './index';
import { checkLayout } from './testkit';

const GRAPH: Graph = {
  direction: 'LR',
  lanes: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }],
  nodes: [
    { id: 'a1', label: 'Fill the purchase request form', kind: 'step', lane: 'a' },
    { id: 'a2', label: 'Approved?', kind: 'decision', lane: 'a' },
    { id: 'b1', label: 'Send the quote', kind: 'io', lane: 'b' },
    { id: 'c1', label: 'Done', kind: 'terminal', lane: 'c' },
    { id: 'u1', label: 'Loose end', kind: 'step', lane: UNASSIGNED },
  ],
  edges: [
    { id: 'a1->a2', source: 'a1', target: 'a2', label: null },
    { id: 'a2->b1', source: 'a2', target: 'b1', label: 'yes' },
    { id: 'b1->c1', source: 'b1', target: 'c1', label: null },
  ],
};
const tb = (g: Graph): Graph => ({ ...g, direction: 'TB' });
const file = (f: Partial<LayoutFile>): LayoutFile => ({ version: 1, nodes: {}, ...f });
const across = (r: LayoutResult, id: string) => {
  const l = r.lanes.find((x) => x.id === id)!;
  return r.direction === 'TB' ? { start: l.x, size: l.width } : { start: l.y, size: l.height };
};
const nodeAt = (r: LayoutResult, id: string) => {
  const n = r.nodes.find((x) => x.id === id)!;
  return [n.x, n.y];
};

describe('A8 stored lane sizes', () => {
  for (const g of [GRAPH, tb(GRAPH)]) {
    it(`${g.direction}: a larger size is exact; later lanes and their blocks move by the difference, nothing else`, () => {
      const plain = layoutDiagram({ graph: g, file: null });
      const need = plain.laneNeeds;
      expect(Object.keys(need)).toEqual(['a', 'b', 'c', UNASSIGNED]);
      for (const l of plain.result.lanes) expect(need[l.id]).toBe(across(plain.result, l.id).size);
      const f = file({ lanes: { b: { size: need.b! + 70 } } });
      const out = layoutDiagram({ graph: g, file: f });
      expect(across(out.result, 'b')).toEqual({ start: across(plain.result, 'b').start, size: need.b! + 70 });
      expect(out.laneNeeds).toEqual(need);
      const shift = (id: string) => {
        const [x, y] = nodeAt(plain.result, id);
        return g.direction === 'TB' ? [x! + 70, y] : [x, y! + 70];
      };
      for (const id of ['a1', 'a2', 'b1']) expect(nodeAt(out.result, id)).toEqual(nodeAt(plain.result, id));
      for (const id of ['c1', 'u1']) expect(nodeAt(out.result, id)).toEqual(shift(id));
      expect(across(out.result, 'c').start).toBe(across(plain.result, 'c').start + 70);
      expect(checkLayout(g, {}, out.result, { strict: true, file: f })).toEqual([]);
    });

    it(`${g.direction}: a size smaller than the content needs changes nothing (it is a minimum)`, () => {
      const plain = layoutDiagram({ graph: g, file: null });
      const f = file({ lanes: { a: { size: MIN_LANE }, c: { size: plain.laneNeeds.c! } } });
      expect(layoutDiagram({ graph: g, file: f }).result).toEqual(plain.result);
    });
  }

  it('Unassigned can have a size; an entry for a lane that does not show is ignored', () => {
    const plain = layoutDiagram({ graph: GRAPH, file: null });
    const out = layoutDiagram({ graph: GRAPH, file: file({ lanes: { [UNASSIGNED]: { size: 400 }, gone: { size: 900 } } }) });
    expect(across(out.result, UNASSIGNED).size).toBe(400);
    expect(out.result.height).toBe(plain.result.height - plain.laneNeeds[UNASSIGNED]! + 400);
  });

  it('the first lane: measured from its zero line, so its band is U + size (and its need includes U)', () => {
    const f = file({ nodes: { a1: { lane: 'a', along: 60, across: -30 } }, lanes: { a: { size: 300 } } });
    const out = layoutDiagram({ graph: GRAPH, file: f });
    expect(out.translation.across).toBe(30);
    expect(across(out.result, 'a')).toEqual({ start: 0, size: 330 });
    const unsized = layoutDiagram({ graph: GRAPH, file: { ...f, lanes: undefined } });
    expect(out.laneNeeds.a).toBe(across(unsized.result, 'a').size);
    expect(checkLayout(GRAPH, { a1: { lane: 'a', along: 60, across: -30 } }, out.result, { strict: true, file: f })).toEqual([]);
  });

  it('deterministic (L10)', () => {
    const f = file({ lanes: { b: { size: 333 } } });
    expect(layoutDiagram({ graph: GRAPH, file: f })).toEqual(layoutDiagram({ graph: GRAPH, file: f }));
  });
});
