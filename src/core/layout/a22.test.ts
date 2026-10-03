// Amendment A22: more than one connection point per side. An edge end may sit at an offset along its side
// (`source_at` / `target_at`, §5, L12), and with `spread_ends` the ends sharing a side are spread evenly along it.
// Without either, every layout is exactly what it was (the golden tests hold that for the fixtures; this file checks
// the new behaviour and that its defaults change nothing).
import { describe, expect, it } from 'vitest';
import type { Graph, LayoutFile, LayoutInput, LayoutResult, Pin } from '../types';
import { SHAPE_KINDS, SIDES } from '../types';
import { alongSide, portPoint } from '../shapes';
import { layoutDiagram } from './index';
import { edgeEndPort, endAtPort, fractionAlongSide, nodePort } from './geometry';
import { atPortAt, checkLayout, randomGraph, randomShaping, rng } from './testkit';

const run = (input: LayoutInput) => layoutDiagram(input);
const node = (r: LayoutResult, id: string) => r.nodes.find((n) => n.id === id)!;
const edge = (r: LayoutResult, id: string) => r.edges.find((e) => e.id === id)!;
const file = (f: Partial<LayoutFile>): LayoutFile => ({ version: 1, nodes: {}, ...f });
const tb = (g: Graph): Graph => ({ ...g, direction: 'TB' });

/** A sequence-style exchange: a client sends three requests to a server and gets two answers back. */
const EXCHANGE: Graph = {
  direction: 'LR',
  lanes: [{ id: 'l', label: 'Lane' }],
  nodes: [
    { id: 'client', label: 'Client', kind: 'step', lane: 'l' },
    { id: 'server', label: 'Authorization server', kind: 'step', lane: 'l' },
  ],
  edges: [
    { id: 'client->server', source: 'client', target: 'server', label: '1 request' },
    { id: 'server->client', source: 'server', target: 'client', label: '2 answer' },
    { id: 'client->server#2', source: 'client', target: 'server', label: '3 request' },
    { id: 'server->client#2', source: 'server', target: 'client', label: '4 answer' },
    { id: 'client->server#3', source: 'client', target: 'server', label: '5 request' },
  ],
};
const EXCHANGE_PINS: Record<string, Pin> = {
  client: { lane: 'l', along: 40, across: 20 },
  server: { lane: 'l', along: 460, across: 20 },
};
/** Every line connected by a handle: each leaves from the side facing the other block and arrives on that side. */
const SIDED: LayoutFile['edges'] = Object.fromEntries(EXCHANGE.edges.map((e) => [
  e.id, e.source === 'client' ? { source_side: 'right', target_side: 'left' } : { source_side: 'left', target_side: 'right' },
]));

/** Three blocks fanning out from one side: a → top, middle, bottom. */
const FAN: Graph = {
  direction: 'LR',
  lanes: [{ id: 'l', label: 'Lane' }],
  nodes: [
    { id: 'a', label: 'Start', kind: 'step', lane: 'l' },
    { id: 'up', label: 'Up', kind: 'step', lane: 'l' },
    { id: 'mid', label: 'Middle', kind: 'step', lane: 'l' },
    { id: 'down', label: 'Down', kind: 'step', lane: 'l' },
  ],
  // File order is not the order along the side: the spread follows where the lines go.
  edges: [
    { id: 'a->down', source: 'a', target: 'down', label: null },
    { id: 'a->up', source: 'a', target: 'up', label: null },
    { id: 'a->mid', source: 'a', target: 'mid', label: null },
  ],
};
const FAN_PINS: Record<string, Pin> = {
  a: { lane: 'l', along: 40, across: 120 },
  up: { lane: 'l', along: 420, across: 0 },
  mid: { lane: 'l', along: 420, across: 120 },
  down: { lane: 'l', along: 420, across: 240 },
};
const FAN_SIDES: LayoutFile['edges'] = {
  'a->down': { source_side: 'right' },
  'a->up': { source_side: 'right' },
  'a->mid': { source_side: 'right' },
};

describe('ports at an offset along a side (portPoint, nodePort)', () => {
  const b = { x: 100, y: 50, width: 160, height: 60 };
  it('0.5, and no offset at all, are the midline port exactly as before', () => {
    for (const kind of SHAPE_KINDS) for (const side of SIDES) {
      expect(portPoint(kind, b, side, 0.5)).toEqual(portPoint(kind, b, side));
    }
    expect(alongSide(161)).toBe(80);
    expect(alongSide(161, 0.5)).toBe(80);
  });
  it('an offset is floor(at × size) from the side\'s start (left end, or top end), in hundredths', () => {
    expect(portPoint('step', b, 'top', 0.25)).toEqual([140, 50]);
    expect(portPoint('step', b, 'bottom', 0.75)).toEqual([220, 110]);
    expect(portPoint('step', b, 'left', 0)).toEqual([100, 50]);
    expect(portPoint('step', b, 'right', 1)).toEqual([260, 110]);
    // 0.29 × 100 is 28.999… in floating point; computed in hundredths it is 29.
    expect(alongSide(100, 0.29)).toBe(29);
    expect(alongSide(100, 0.57)).toBe(57);
  });
  it('the port stays on the drawn outline: a diamond\'s face, round ends, the slanted and wavy sides', () => {
    // Diamond: the top-left face at a quarter of the width is half-way down from the top vertex's height.
    expect(portPoint('decision', b, 'top', 0.25)).toEqual([140, 65]);
    expect(portPoint('decision', b, 'right', 0.75)).toEqual([220, 95]);
    // A round end of a terminal: at the very top of the left side the outline is the radius in.
    const [x] = portPoint('terminal', b, 'left', 0);
    expect(x).toBeGreaterThan(100);
    expect(portPoint('io', b, 'top', 0)).toEqual([100, 64]); // the parallelogram's top starts at the skew
    for (const kind of SHAPE_KINDS) for (const side of SIDES) for (const at of [0, 0.1, 0.25, 0.33, 0.5, 0.75, 0.9, 1]) {
      expect(atPortAt(kind, b, side, portPoint(kind, b, side, at), at), `${kind} ${side} ${at}`).toBe(true);
    }
  });
  it('fractionAlongSide projects a point onto a side, clamped to 0..1', () => {
    expect(fractionAlongSide(b, 'top', [140, 0])).toBe(0.25);
    expect(fractionAlongSide(b, 'left', [0, 80])).toBe(0.5);
    expect(fractionAlongSide(b, 'right', [0, 0])).toBe(0);
    expect(fractionAlongSide(b, 'bottom', [999, 0])).toBe(1);
  });
});

describe('stored offsets (source_at / target_at)', () => {
  for (const g of [EXCHANGE, tb(EXCHANGE)]) {
    it(`${g.direction}: each line starts and ends at its offset port, and the layout reports the offsets`, () => {
      const edges: LayoutFile['edges'] = {};
      const ats = [0.2, 0.35, 0.5, 0.65, 0.8];
      g.edges.forEach((e, k) => { edges[e.id] = { ...SIDED![e.id]!, source_at: ats[k]!, target_at: ats[k]! }; });
      const f = file({ nodes: EXCHANGE_PINS, edges });
      const r = run({ graph: g, file: f }).result;
      expect(checkLayout(g, EXCHANGE_PINS, r, { strict: true, file: f })).toEqual([]);
      const starts = new Set<string>();
      g.edges.forEach((ge, k) => {
        const e = edge(r, ge.id);
        expect([e.source_at, e.target_at]).toEqual([ats[k], ats[k]]);
        expect(e.points[0]).toEqual(nodePort(node(r, ge.source), e.source_side, ats[k]));
        expect(e.points[e.points.length - 1]).toEqual(nodePort(node(r, ge.target), e.target_side, ats[k]));
        expect(endAtPort(r, ge.id, 'source')).toBe(true);
        expect(endAtPort(r, ge.id, 'target')).toBe(true);
        starts.add(e.points[0]!.join(','));
      });
      expect(starts.size).toBe(5); // five lines, five different points: nothing overlaps at the ends
    });
  }

  it('without an offset an end with a set side is at the midline port, and nothing is reported (unchanged from v1.1)', () => {
    const f = file({ nodes: EXCHANGE_PINS, edges: SIDED });
    const r = run({ graph: EXCHANGE, file: f }).result;
    expect(checkLayout(EXCHANGE, EXCHANGE_PINS, r, { strict: true, file: f })).toEqual([]);
    for (const e of r.edges) {
      expect('source_at' in e).toBe(false);
      expect('target_at' in e).toBe(false);
      expect(e.points[0]).toEqual(nodePort(node(r, e.source), e.source_side));
    }
    // All three requests leave the client's right side at the same point: the problem A22 solves.
    const outs = r.edges.filter((e) => e.source === 'client').map((e) => e.points[0]!.join(','));
    expect(new Set(outs).size).toBe(1);
  });

  it('an explicit 0.5 is the midline port, so it lays out exactly like no offset', () => {
    const plain = file({ nodes: EXCHANGE_PINS, edges: SIDED });
    const half = file({ nodes: EXCHANGE_PINS, edges: Object.fromEntries(Object.entries(SIDED!).map(([id, e]) => [id, { ...e, source_at: 0.5, target_at: 0.5 }])) });
    const a = run({ graph: EXCHANGE, file: plain }).result;
    const b = run({ graph: EXCHANGE, file: half }).result;
    expect(b.edges.map((e) => e.points)).toEqual(a.edges.map((e) => e.points));
  });

  it('a manual line is drawn from and to its offset ports (L11)', () => {
    const f = file({
      nodes: EXCHANGE_PINS,
      edges: { 'client->server': { source_side: 'right', source_at: 0.25, target_side: 'left', target_at: 0.75, points: [{ lane: 'l', along: 300, across: 10 }] } },
    });
    const r = run({ graph: EXCHANGE, file: f }).result;
    expect(checkLayout(EXCHANGE, EXCHANGE_PINS, r, { file: f })).toEqual([]);
    const e = edge(r, 'client->server');
    expect(e.manual).toBe(true);
    expect(e.points[0]).toEqual(nodePort(node(r, 'client'), 'right', 0.25));
    expect(e.points[e.points.length - 1]).toEqual(nodePort(node(r, 'server'), 'left', 0.75));
    expect(edgeEndPort(node(r, 'server'), e, 'target')).toEqual(e.points[e.points.length - 1]);
  });

  it('a diamond\'s offset port is on its face: the line runs on inside the box to it', () => {
    const g: Graph = {
      direction: 'LR', lanes: [{ id: 'l', label: 'L' }],
      nodes: [{ id: 'q', label: 'Approved?', kind: 'decision', lane: 'l' }, { id: 'z', label: 'Next', kind: 'step', lane: 'l' }],
      edges: [{ id: 'q->z', source: 'q', target: 'z', label: 'yes' }],
    };
    const pins = { q: { lane: 'l', along: 40, across: 20 }, z: { lane: 'l', along: 400, across: 20 } };
    const f = file({ nodes: pins, edges: { 'q->z': { source_side: 'right', source_at: 0.25 } } });
    const r = run({ graph: g, file: f }).result;
    expect(checkLayout(g, pins, r, { strict: true, file: f })).toEqual([]);
    expect(edge(r, 'q->z').points[0]).toEqual(nodePort(node(r, 'q'), 'right', 0.25));
  });
});

describe('spread_ends', () => {
  it('off (the default): every end with a set side meets at the midline port', () => {
    const f = file({ nodes: FAN_PINS, edges: FAN_SIDES });
    const r = run({ graph: FAN, file: f }).result;
    expect(checkLayout(FAN, FAN_PINS, r, { strict: true, file: f })).toEqual([]);
    const starts = r.edges.map((e) => e.points[0]!.join(','));
    expect(new Set(starts).size).toBe(1);
    expect(starts[0]).toBe(nodePort(node(r, 'a'), 'right').join(','));
  });

  it('`false` is the same as absent', () => {
    const a = run({ graph: FAN, file: file({ nodes: FAN_PINS, edges: FAN_SIDES }) }).result;
    const b = run({ graph: FAN, file: file({ nodes: FAN_PINS, edges: FAN_SIDES, spread_ends: false }) }).result;
    expect(b).toEqual(a);
  });

  for (const g of [FAN, tb(FAN)]) {
    it(`${g.direction}: on, the ends sharing a side are spread at 0.25, 0.5, 0.75 in the order of where they go (no crossings)`, () => {
      // The side along the flow: right for LR, bottom for TB.
      const side = g.direction === 'LR' ? 'right' : 'bottom';
      const sides = Object.fromEntries(Object.keys(FAN_SIDES!).map((id) => [id, { source_side: side } as const]));
      const f = file({ nodes: FAN_PINS, edges: sides, spread_ends: true });
      const r = run({ graph: g, file: f }).result;
      expect(checkLayout(g, FAN_PINS, r, { strict: true, file: f })).toEqual([]);
      const a = node(r, 'a');
      // The block nearest the side's start (the top one for LR's right side, the left one for TB's bottom side) gets the
      // first slot, and so on: the lines don't cross on the way out.
      expect(edge(r, 'a->up').points[0]).toEqual(nodePort(a, edge(r, 'a->up').source_side, 0.25));
      expect(edge(r, 'a->mid').points[0]).toEqual(nodePort(a, edge(r, 'a->mid').source_side, 0.5));
      expect(edge(r, 'a->down').points[0]).toEqual(nodePort(a, edge(r, 'a->down').source_side, 0.75));
      expect(edge(r, 'a->up').source_at).toBe(0.25);
      expect('source_at' in edge(r, 'a->mid')).toBe(false); // 0.5 is the midline port: not reported
      expect(edge(r, 'a->down').source_at).toBe(0.75);
      for (const e of r.edges) expect(endAtPort(r, e.id, 'source')).toBe(true);
    });
  }

  it('on: two ends give 0.33 and 0.67; a stored offset is kept and isn\'t counted in the spread', () => {
    const pair: Graph = { ...FAN, edges: FAN.edges.filter((e) => e.id !== 'a->mid') };
    const two = run({ graph: pair, file: file({ nodes: FAN_PINS, edges: { 'a->up': { source_side: 'right' }, 'a->down': { source_side: 'right' } }, spread_ends: true }) }).result;
    expect([edge(two, 'a->up').source_at, edge(two, 'a->down').source_at]).toEqual([0.33, 0.67]);
    const f = file({ nodes: FAN_PINS, edges: { ...FAN_SIDES, 'a->mid': { source_side: 'right', source_at: 0.1 } }, spread_ends: true });
    const r = run({ graph: FAN, file: f }).result;
    expect(checkLayout(FAN, FAN_PINS, r, { strict: true, file: f })).toEqual([]);
    expect([edge(r, 'a->up').source_at, edge(r, 'a->mid').source_at, edge(r, 'a->down').source_at]).toEqual([0.33, 0.1, 0.67]);
  });

  it('on: the sequence-style exchange gets a separate point for every line end', () => {
    const f = file({ nodes: EXCHANGE_PINS, edges: SIDED, spread_ends: true });
    const r = run({ graph: EXCHANGE, file: f }).result;
    expect(checkLayout(EXCHANGE, EXCHANGE_PINS, r, { strict: true, file: f })).toEqual([]);
    const ends = r.edges.flatMap((e) => [`${e.source}:${e.points[0]!.join(',')}`, `${e.target}:${e.points[e.points.length - 1]!.join(',')}`]);
    expect(new Set(ends).size).toBe(ends.length);
  });

  it('on: automatic ends (no set side) are spread evenly too, and manual lines\' ends', () => {
    const f = file({
      nodes: FAN_PINS, spread_ends: true,
      edges: { 'a->up': { points: [{ lane: 'l', along: 300, across: 30 }] } },
    });
    const r = run({ graph: FAN, file: f }).result;
    expect(checkLayout(FAN, FAN_PINS, r, { strict: true, file: f })).toEqual([]);
    const right = r.edges.filter((e) => e.source_side === 'right');
    expect(right.length).toBe(3);
    expect(new Set(right.map((e) => e.points[0]!.join(','))).size).toBe(3);
  });

  it('random diagrams with offsets and spreading still satisfy L1–L12 (both directions)', () => {
    const r = rng(2222);
    for (let k = 0; k < Number(process.env.FLOWMAP_RANDOM_A22 ?? 24); k++) {
      const seed = 9100 + k;
      const g = randomGraph(seed, { nodes: 10 + Math.floor(r() * 60), direction: k % 2 ? 'TB' : 'LR' });
      const s = randomShaping(seed, g, { sided: 0.6, offsets: 0.6, spread: k % 3 !== 0 });
      const out = run({ graph: g, file: s.file, notes: s.notes, title: s.title });
      const problems = checkLayout(g, s.pins, out.result, { file: s.file, notes: s.notes, title: s.title });
      // A set port that faces straight into another block (pinned less than the router's margin away) can't be left
      // without crossing it, wherever along the side the port is: that is v1.1's limit, not A22's, so it is set aside.
      const blocked = new Set(out.result.edges.filter((e) => facesABlock(out.result, e, 'source') || facesABlock(out.result, e, 'target')).map((e) => e.id));
      expect(problems.filter((p) => !(/^L7 edge (\S+) crosses /.test(p) && blocked.has(p.split(' ')[2]!))), `seed ${seed}`).toEqual([]);
      expect(run({ graph: g, file: s.file, notes: s.notes, title: s.title }).result).toEqual(out.result); // L10
    }
  }, 60000);

  it('the set-aside case exists without A22 too: a midline port facing a block pinned 1 px away', () => {
    const g: Graph = {
      direction: 'LR', lanes: [{ id: 'l', label: 'L' }],
      nodes: [
        { id: 'a', label: 'A', kind: 'step', lane: 'l' }, { id: 'blk', label: 'Blocker', kind: 'step', lane: 'l' },
        { id: 'z', label: 'Z', kind: 'step', lane: 'l' },
      ],
      edges: [{ id: 'a->z', source: 'a', target: 'z', label: null }],
    };
    const pins = { a: { lane: 'l', along: 200, across: 20 }, blk: { lane: 'l', along: 180, across: 73 }, z: { lane: 'l', along: 600, across: 300 } };
    const f = file({ nodes: pins, edges: { 'a->z': { source_side: 'bottom' } } });
    const r = run({ graph: g, file: f }).result;
    expect(facesABlock(r, edge(r, 'a->z'), 'source')).toBe(true);
    expect(checkLayout(g, pins, r, { file: f }).every((p) => p.startsWith('L7 edge a->z crosses blk'))).toBe(true);
  });
});

/** Whether an end's port looks straight into another block less than 16 px (twice the router's margin) away. */
function facesABlock(r: LayoutResult, e: LayoutResult['edges'][number], end: 'source' | 'target'): boolean {
  const own = node(r, end === 'source' ? e.source : e.target);
  const side = end === 'source' ? e.source_side : e.target_side;
  const [px, py] = edgeEndPort(own, e, end);
  const [dx, dy] = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] }[side];
  return r.nodes.some((n) => n.id !== e.source && n.id !== e.target && [2, 4, 8, 12, 16].some((d) => {
    const x = px + dx! * d;
    const y = py + dy! * d;
    return x > n.x && x < n.x + n.width && y > n.y && y < n.y + n.height;
  }));
}
