import { describe, expect, it } from 'vitest';
import { isLaneFree, type Graph, type LayoutResult, type Pin } from '../types';
import { headerLength, LANE_HEADER, layout } from './index';
import { checkLayout, qualityStats, randomGraph, randomPins, purchaseRequest, rng } from './testkit';

const run = (g: Graph, pins: Record<string, Pin> = {}, hints?: unknown) => layout(g, pins, hints);

describe('invariant checker (self-test: it must catch broken layouts)', () => {
  const { graph, pins } = purchaseRequest();
  const good = run(graph, pins).result;
  const broken = (f: (r: LayoutResult) => void) => {
    const r: LayoutResult = JSON.parse(JSON.stringify(good));
    f(r);
    return checkLayout(graph, pins, r);
  };
  it('accepts the real layout', () => expect(checkLayout(graph, pins, good)).toEqual([]));
  it('catches L1 (lane order, thin lane, gap)', () => {
    expect(broken((r) => r.lanes.reverse()).join()).toMatch(/L1/);
    expect(broken((r) => (r.lanes[0]!.height = 90)).join()).toMatch(/L1/);
  });
  it('catches L2 (node outside its lane or too close to the edge)', () => {
    expect(broken((r) => (r.nodes.find((n) => !n.pinned)!.y = r.lanes[0]!.y + r.lanes[0]!.height + 500)).join()).toMatch(/L2/);
    expect(broken((r) => (r.nodes.find((n) => n.id === 'intake')!.y = 4)).join()).toMatch(/L2/);
  });
  it('catches L3 (overlap)', () => {
    expect(broken((r) => {
      const [a, b] = r.nodes.filter((n) => n.lane === 'purchasing');
      b!.x = a!.x + 5;
      b!.y = a!.y;
    }).join()).toMatch(/L3/);
  });
  it('catches L4 (pin moved)', () => expect(broken((r) => (r.nodes.find((n) => n.id === 'closed')!.x += 1)).join()).toMatch(/L4/));
  it('catches L5 (edge against the flow)', () => {
    expect(broken((r) => (r.nodes.find((n) => n.id === 'f04')!.x = 80)).join()).toMatch(/L5/);
  });
  it('catches L6 (diagonal, detached end)', () => {
    expect(broken((r) => r.edges[0]!.points.splice(1, 0, [r.edges[0]!.points[0]![0] + 3, r.edges[0]!.points[0]![1] + 3])).join()).toMatch(/L6/);
    expect(broken((r) => (r.edges[0]!.points[0]![0] -= 10)).join()).toMatch(/L6/);
  });
  it('catches L7 (edge through a box)', () => {
    expect(broken((r) => {
      const e = r.edges.find((x) => x.id === 'intake->r01')!;
      const p02 = r.nodes.find((n) => n.id === 'p02')!;
      const [sx, sy] = e.points[0]!;
      const cy = p02.y + p02.height / 2;
      const cx = p02.x + p02.width / 2;
      const [tx, ty] = e.points[e.points.length - 1]!;
      e.points = [[sx, sy], [sx + 10, sy], [sx + 10, cy], [cx + 200, cy], [cx + 200, ty], [tx, ty]];
    }).join()).toMatch(/L7/);
  });
  it('catches L8 (label far from its source, or missing)', () => {
    expect(broken((r) => (r.edges.find((e) => e.label)!.label_pos = [5000, 5000])).join()).toMatch(/L8/);
    expect(broken((r) => (r.edges.find((e) => e.label)!.label_pos = null)).join()).toMatch(/L8/);
  });
  it('catches non-integers', () => expect(broken((r) => (r.nodes[0]!.x += 0.5)).join()).toMatch(/non-integer/));
});

describe('purchase-request fixture', () => {
  for (const dir of ['LR', 'TB'] as const) {
    it(`${dir}: satisfies L1–L8 strictly, pins exact, deterministic`, () => {
      const { graph, pins } = purchaseRequest(dir);
      const a = run(graph, pins);
      expect(checkLayout(graph, pins, a.result, { strict: true })).toEqual([]);
      const closed = a.result.nodes.find((n) => n.id === 'closed')!;
      expect(closed.pinned).toBe(true);
      expect(dir === 'LR' ? closed.x : closed.y).toBe(1400);
      expect(run(graph, pins).result).toEqual(a.result); // L10
      const q = qualityStats(a.result);
      expect(q.sharedTrack).toBe(0);
      expect(q.ownCross).toBe(0);
      expect(q.crossings).toBeLessThanOrEqual(2);
      expect(q.bends).toBeLessThanOrEqual(28);
    });
  }
  it('decisions branch from different corners and labels sit at their diamonds', () => {
    const { graph, pins } = purchaseRequest('LR');
    const r = run(graph, pins).result;
    const byId = new Map(r.nodes.map((n) => [n.id, n]));
    for (const d of r.nodes.filter((n) => n.kind === 'decision')) {
      const starts = r.edges.filter((e) => e.source === d.id).map((e) => e.points[0]!.join());
      expect(new Set(starts).size).toBe(starts.length);
      for (const e of r.edges.filter((x) => x.source === d.id && x.label)) {
        const [lx, ly] = e.label_pos!;
        const cx = d.x + d.width / 2;
        const cy = d.y + d.height / 2;
        expect(Math.abs(lx - cx) + Math.abs(ly - cy)).toBeLessThan(d.width / 2 + d.height / 2 + 40);
      }
    }
    // The main path runs straight: p01 -> p02 -> p04 share a centre line.
    const cy = (id: string) => byId.get(id)!.y + byId.get(id)!.height / 2;
    expect(cy('p02')).toBe(cy('p01'));
    expect(cy('p04')).toBe(cy('p02'));
  });
});

describe('edge cases', () => {
  it('lays out an empty diagram', () => {
    const r = run({ direction: 'LR', lanes: [], nodes: [], edges: [] }).result;
    expect(r.nodes).toEqual([]);
    expect(r.width).toBeGreaterThan(0);
  });
  it('keeps empty lanes at 100 px and puts _unassigned last', () => {
    const g: Graph = {
      direction: 'LR',
      lanes: [{ id: 'a', label: 'A' }, { id: 'empty', label: 'Empty' }, { id: '_unassigned', label: 'Unassigned' }],
      nodes: [{ id: 'x', label: 'X', kind: 'step', lane: '_unassigned' }, { id: 'y', label: 'Y', kind: 'io', lane: 'a' }],
      edges: [{ id: 'x->y', source: 'x', target: 'y', label: null }, { id: 'y->y', source: 'y', target: 'y', label: 'again' }],
    };
    const r = run(g).result;
    expect(checkLayout(g, {}, r, { strict: true })).toEqual([]);
    expect(r.lanes.map((l) => l.id)).toEqual(['a', 'empty', '_unassigned']);
    expect(r.lanes[1]!.height).toBe(100);
  });
  it('ignores a pin whose lane is stale, and grows a lane for a deep pin', () => {
    const { graph } = purchaseRequest();
    const pins: Record<string, Pin> = { r01: { lane: 'manager', along: 10, across: 10 }, m01: { lane: 'manager', along: 300, across: 600 } };
    const r = run(graph, pins).result;
    expect(checkLayout(graph, pins, r)).toEqual([]);
    expect(r.nodes.find((n) => n.id === 'r01')!.pinned).toBe(false);
    expect(r.lanes.find((l) => l.id === 'manager')!.height).toBeGreaterThanOrEqual(600 + 52);
  });
  it('handles pins at 0, overlapping pins and a pin on top of auto-placed nodes', () => {
    const { graph } = purchaseRequest();
    const pins: Record<string, Pin> = {
      p02: { lane: 'purchasing', along: 0, across: 0 },
      p03: { lane: 'purchasing', along: 20, across: 10 }, // overlaps p02
      f01: { lane: 'finance', along: 400, across: 24 },
    };
    const r = run(graph, pins).result;
    expect(checkLayout(graph, pins, r)).toEqual([]);
  });
  it('tolerates garbage hints', () => {
    const { graph, pins } = purchaseRequest();
    for (const h of [null, 42, 'x', [], { v: 2 }, { v: 1, n: { r01: ['requester', -5, 'x'] }, cols: 'no', rows: [1] }]) {
      expect(checkLayout(graph, pins, run(graph, pins, h).result)).toEqual([]);
    }
  });
  it('lays out many duplicate and parallel edges on separate tracks', () => {
    const g: Graph = {
      direction: 'LR',
      lanes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      nodes: [
        { id: 's', label: 'Start', kind: 'step', lane: 'a' },
        { id: 't', label: 'Target', kind: 'step', lane: 'b' },
      ],
      edges: [1, 2, 3, 4].map((k) => ({ id: k === 1 ? 's->t' : `s->t#${k}`, source: 's', target: 't', label: k === 2 ? 'second' : null })),
    };
    const r = run(g).result;
    expect(checkLayout(g, {}, r, { strict: true })).toEqual([]);
    expect(qualityStats(r).sharedTrack).toBe(0);
  });
});

describe('hints', () => {
  it('are a fixpoint: laying out with the hints a layout returned gives the same layout', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const g = randomGraph(seed, { nodes: 30 + seed * 10, direction: seed % 2 ? 'LR' : 'TB' });
      const pins = seed % 2 ? randomPins(seed, g, 0.15) : {};
      const first = run(g, pins);
      const second = run(g, pins, first.hints);
      expect(second.result).toEqual(first.result);
      expect(second.hints).toEqual(first.hints);
      expect(run(g, pins, second.hints).result).toEqual(first.result);
    }
  });
  it('survive JSON (they are stored in the layout file)', () => {
    const { graph, pins } = purchaseRequest();
    const a = run(graph, pins);
    const b = run(graph, pins, JSON.parse(JSON.stringify(a.hints)));
    expect(b.result).toEqual(a.result);
  });
});

// The main feedback loop: seeded random process-map-shaped graphs, 10 to 150 nodes, both directions, with and
// without legal pins. Every one must satisfy L1–L8 and be deterministic (L10).
describe('random graphs satisfy L1–L8 and L10', () => {
  const COUNT = Number(process.env.FLOWMAP_RANDOM ?? 160);
  const r = rng(2026);
  const cases = Array.from({ length: COUNT }, (_, k) => {
    const nodes = 10 + Math.floor(r() * 141);
    return { seed: 1000 + k, nodes, dir: k % 2 ? 'TB' : 'LR', pinFrac: k % 3 === 0 ? 0 : k % 3 === 1 ? 0.1 : 0.3 } as const;
  });
  it.each(cases)('seed $seed: $nodes nodes $dir pins $pinFrac', ({ seed, nodes, dir, pinFrac }) => {
    const g = randomGraph(seed, { nodes, direction: dir });
    const pins = pinFrac ? randomPins(seed, g, pinFrac, nodes * 40) : {};
    const a = run(g, pins);
    const v = checkLayout(g, pins, a.result);
    expect(v).toEqual([]);
    if (seed % 4 === 0) expect(run(g, pins).result).toEqual(a.result); // L10 (sampled to keep the suite quick)
  }, 15000);
});

describe('performance (C7)', () => {
  it('lays out 150-node diagrams well under 2 s', () => {
    let worst = 0;
    for (const seed of [11, 13, 15]) {
      for (const dir of ['LR', 'TB'] as const) {
        const g = randomGraph(seed, { nodes: 150, direction: dir });
        const pins = randomPins(seed, g, 0.15);
        const t0 = performance.now();
        run(g, pins);
        worst = Math.max(worst, performance.now() - t0);
      }
    }
    expect(worst).toBeLessThan(1500);
  }, 30000);
});

// Amendment A4: a diagram without subgraphs is a plain flowchart. Its layout JSON has the same shape (one
// `_unassigned` lane), reserves no lane-label strip, and still satisfies every §6 rule.
describe('lane-free diagrams (amendment A4)', () => {
  const laned = (g: Graph): Graph => ({
    ...g,
    lanes: [{ id: 'only', label: 'Only' }],
    nodes: g.nodes.map((n) => ({ ...n, lane: 'only' })),
  });
  it('isLaneFree and headerLength tell the two kinds of diagram apart', () => {
    const free = run(randomGraph(7, { nodes: 20, lanes: 0 })).result;
    expect(free.lanes.map((l) => l.id)).toEqual(['_unassigned']);
    expect(isLaneFree(free.lanes)).toBe(true);
    expect(headerLength(free)).toBe(0);
    expect(isLaneFree([])).toBe(true); // an empty diagram
    const { graph } = purchaseRequest();
    const withLanes = run(graph).result;
    expect(isLaneFree(withLanes.lanes)).toBe(false);
    expect(headerLength(withLanes)).toBe(LANE_HEADER);
  });
  for (const dir of ['LR', 'TB'] as const) {
    it(`${dir}: reserves no lane-label strip: every node sits LANE_HEADER px nearer the start than in one lane`, () => {
      for (const seed of [3, 4, 5]) {
        const g = randomGraph(seed, { nodes: 25, lanes: 0, direction: dir });
        const free = run(g).result;
        const one = run(laned(g)).result;
        const along = (n: { x: number; y: number }) => (dir === 'LR' ? n.x : n.y);
        const across = (n: { x: number; y: number }) => (dir === 'LR' ? n.y : n.x);
        const byId = new Map(one.nodes.map((n) => [n.id, n]));
        for (const n of free.nodes) {
          expect(along(n)).toBe(along(byId.get(n.id)!) - LANE_HEADER);
          expect(across(n)).toBe(across(byId.get(n.id)!));
        }
        // The first column starts right after the diagram's start margin, well inside where a header would be.
        expect(Math.min(...free.nodes.map(along))).toBeLessThan(LANE_HEADER);
        expect(dir === 'LR' ? free.width : free.height).toBe((dir === 'LR' ? one.width : one.height) - LANE_HEADER);
      }
    });
  }
  it('an empty lane-free diagram has no lanes at all', () => {
    const r = run({ direction: 'LR', lanes: [], nodes: [], edges: [] }).result;
    expect(r.lanes).toEqual([]);
  });
  it('pins are exact, including ones at along 0 (nothing to overlap there)', () => {
    const g = randomGraph(11, { nodes: 30, lanes: 0 });
    const pins: Record<string, Pin> = {
      n0: { lane: '_unassigned', along: 0, across: 12 },
      n5: { lane: '_unassigned', along: 500, across: 300 },
    };
    const r = run(g, pins).result;
    expect(checkLayout(g, pins, r, { strict: true })).toEqual([]);
    const n0 = r.nodes.find((n) => n.id === 'n0')!;
    expect([n0.x, n0.y, n0.pinned]).toEqual([0, 12, true]);
  });
  const COUNT = Number(process.env.FLOWMAP_RANDOM_LANEFREE ?? 60);
  const rr = rng(4242);
  const cases = Array.from({ length: COUNT }, (_, k) => {
    const nodes = 10 + Math.floor(rr() * 141);
    return { seed: 5000 + k, nodes, dir: k % 2 ? 'TB' : 'LR', pinFrac: k % 3 === 0 ? 0 : k % 3 === 1 ? 0.1 : 0.3 } as const;
  });
  it.each(cases)('random seed $seed: $nodes nodes $dir pins $pinFrac satisfy L1–L8 and L10', ({ seed, nodes, dir, pinFrac }) => {
    const g = randomGraph(seed, { nodes, direction: dir, lanes: 0 });
    expect(g.nodes.every((n) => n.lane === '_unassigned')).toBe(true);
    const pins = pinFrac ? randomPins(seed, g, pinFrac, nodes * 40) : {};
    const a = run(g, pins);
    expect(checkLayout(g, pins, a.result)).toEqual([]);
    expect(a.result.lanes.map((l) => l.id)).toEqual(['_unassigned']);
    if (seed % 4 === 0) expect(run(g, pins).result).toEqual(a.result); // L10
    if (seed % 5 === 0) expect(run(g, pins, a.hints).result).toEqual(a.result); // hints stay a fixpoint
  }, 15000);
});
