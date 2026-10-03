// Amendment A19, §6 L13: groups (subgraphs inside lanes). Containment at every depth, pins exact (and grouped pins
// that go stale ignored), no overlap of unpinned groups with each other or with non-members, L1–L8 still holding, and
// a diagram without groups laid out exactly as before (the v1.0 goldens in golden.test.ts pin that byte for byte).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDocument } from '../document';
import type { Graph, GraphGroup, LayoutFile, LayoutResult, NodePin, Pin } from '../types';
import { UNASSIGNED } from '../types';
import { layout, layoutDiagram } from './index';
import { atPortAt, checkLayout, groupLabelBox, groupLabelCrossings, randomGraph, randomShaping, rng } from './testkit';

const ROOT = join(import.meta.dirname, '../../..');
const GROUPS_MMD = readFileSync(join(ROOT, 'fixtures/syntax/groups.canonical.mmd'), 'utf8');

type Box = { x: number; y: number; width: number; height: number };
const inside = (inner: Box, outer: Box, pad = 0) =>
  inner.x >= outer.x + pad && inner.y >= outer.y + pad
  && inner.x + inner.width <= outer.x + outer.width - pad && inner.y + inner.height <= outer.y + outer.height - pad;
const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** A random process graph whose lanes hold up to three levels of groups, most nodes in one. */
function groupedGraph(seed: number, nodes: number, direction: 'LR' | 'TB'): Graph {
  const g = randomGraph(seed, { nodes, direction, lanes: 2 + (seed % 3) });
  const r = rng(seed * 7 + 3);
  const groups: GraphGroup[] = [];
  const byLane = new Map<string, GraphGroup[]>();
  let count = 0;
  for (const lane of g.lanes) {
    if (lane.id === UNASSIGNED) continue;
    const list: GraphGroup[] = [];
    const make = (parent: string | null, depth: number) => {
      const n = 1 + Math.floor(r() * 2);
      for (let k = 0; k < n; k++) {
        const grp: GraphGroup = { id: `g${++count}`, label: `Group ${count} ${'x'.repeat(Math.floor(r() * 30))}`, lane: lane.id, parent };
        groups.push(grp);
        list.push(grp);
        if (depth < 3 && r() < 0.5) make(grp.id, depth + 1);
      }
    };
    if (r() < 0.85) make(null, 1);
    byLane.set(lane.id, list);
  }
  for (const n of g.nodes) {
    const list = byLane.get(n.lane);
    if (list && list.length && r() < 0.65) n.group = list[Math.floor(r() * list.length)]!.id;
  }
  return { ...g, groups };
}

/** Every L13 property that holds with or without pins: containment at every depth and in the lane band. */
function checkGroups(graph: Graph, res: LayoutResult, pins: Record<string, NodePin> = {}): string[] {
  const v: string[] = [];
  const LR = res.direction === 'LR';
  const boxes = new Map((res.groups ?? []).map((b) => [b.id, b]));
  const lanes = new Map(res.lanes.map((l) => [l.id, l]));
  if ((graph.groups ?? []).length !== (res.groups ?? []).length) v.push('group count');
  for (const gg of graph.groups ?? []) {
    const b = boxes.get(gg.id);
    if (!b) { v.push(`no box for ${gg.id}`); continue; }
    if (b.lane !== gg.lane || b.parent !== gg.parent) v.push(`${gg.id}: lane/parent ${b.lane}/${b.parent}`);
    for (const k of [b.x, b.y, b.width, b.height]) if (!Number.isInteger(k)) v.push(`${gg.id}: non-integer box`);
    if (b.width < 56 || b.height < 56) v.push(`${gg.id}: box ${b.width}x${b.height} below the minimum`);
    const lane = lanes.get(gg.lane)!;
    if (!inside(b, lane)) v.push(`L13/L2 ${gg.id} sticks out of lane ${gg.lane}`);
    // L2 for groups: room at the lane's far edge.
    const far = LR ? lane.y + lane.height - (b.y + b.height) : lane.x + lane.width - (b.x + b.width);
    if (far < 12) v.push(`L13/L2 ${gg.id} is ${far}px from its lane's far edge`);
    if (gg.parent && !inside(b, boxes.get(gg.parent)!, 0)) v.push(`L13 ${gg.id} not inside ${gg.parent}`);
  }
  const anyPin = Object.keys(pins).length > 0;
  for (const n of res.nodes) {
    const gn = graph.nodes.find((x) => x.id === n.id)!;
    if ((n.group ?? undefined) !== gn.group) v.push(`${n.id}: output group ${n.group} != ${gn.group}`);
    if (!gn.group) continue;
    const b = boxes.get(gn.group)!;
    // Padding: at least 12 px, except on a side clipped at the lane's start edge or the flow start (pinned only).
    const lane = lanes.get(gn.lane)!;
    const clippedStart = (LR ? b.y === lane.y : b.x === lane.x) || (LR ? b.x === 0 : b.y === 0);
    if (!inside(n, b, n.pinned && clippedStart ? 0 : 12)) v.push(`L13 node ${n.id} not inside ${gn.group} with padding`);
  }
  if (!anyPin) {
    // Unpinned: siblings don't overlap, and no node overlaps a group it isn't a member of.
    const ancestors = (id: string | undefined): Set<string> => {
      const out = new Set<string>();
      for (let cur = id; cur; cur = (graph.groups ?? []).find((x) => x.id === cur)?.parent ?? undefined) out.add(cur);
      return out;
    };
    const gs = res.groups ?? [];
    for (let i = 0; i < gs.length; i++) {
      for (let j = i + 1; j < gs.length; j++) {
        const a = gs[i]!;
        const b = gs[j]!;
        const nested = ancestors(a.id).has(b.id) || ancestors(b.id).has(a.id);
        if (!nested && overlap(a, b)) v.push(`L13 groups ${a.id} and ${b.id} overlap`);
      }
    }
    for (const n of res.nodes) {
      const mine = ancestors(graph.nodes.find((x) => x.id === n.id)!.group);
      for (const b of gs) if (!mine.has(b.id) && overlap(n, b)) v.push(`L13 node ${n.id} overlaps group ${b.id}`);
    }
  }
  return v;
}

describe('A19 layout: the groups fixture', () => {
  for (const dir of ['LR', 'TB'] as const) {
    it(`${dir}: boxes contain their members at every depth, inside the lane, with no overlaps`, () => {
      const doc = loadDocument(GROUPS_MMD.replace('flowchart TB', `flowchart ${dir}`), null, null, 'groups.mmd');
      const res = doc.layout!.result;
      expect(checkLayout(doc.graph, {}, res)).toEqual([]);
      expect(checkGroups(doc.graph, res)).toEqual([]);
      expect(res.groups!.map((g) => [g.id, g.parent])).toEqual([['net', null], ['sub-a', 'net'], ['sub-b', 'net'], ['empty', null]]);
      // The label fits: the box is at least as wide as its label needs.
      const empty = res.groups!.find((g) => g.id === 'empty')!;
      expect(empty.width).toBeGreaterThanOrEqual(120);
    });
  }

  it('a diagram without groups has no `groups` key and no node carries `group`', () => {
    const doc = loadDocument('flowchart LR\n  subgraph a [A]\n    x["X"]\n  end\n', null, null, 'x.mmd');
    expect('groups' in doc.layout!.result).toBe(false);
    expect('group' in doc.layout!.result.nodes[0]!).toBe(false);
  });

  it('is deterministic (L10), from the files and again from its own hints', () => {
    const doc = loadDocument(GROUPS_MMD, null, null, 'groups.mmd');
    const again = loadDocument(GROUPS_MMD, null, null, 'groups.mmd');
    expect(JSON.stringify(again.layout)).toBe(JSON.stringify(doc.layout));
    // Laid out again from its own hints (as the UI does after every edit), blocks and groups stay where they were.
    const withHints = layoutDiagram({ graph: doc.graph, file: { version: 1, nodes: {}, hints: doc.layout!.hints } });
    expect(withHints.result.nodes).toEqual(doc.layout!.result.nodes);
    expect(withHints.result.groups).toEqual(doc.layout!.result.groups);
  });
});

describe('A19 layout: pins in groups', () => {
  const pinFile = (nodes: Record<string, NodePin>) => JSON.stringify({ version: 1, nodes });

  it('a pin with the node\'s group is exact (L4) and its group grows to hold it', () => {
    const before = loadDocument(GROUPS_MMD, null, null, 'groups.mmd').layout!.result;
    const doc = loadDocument(GROUPS_MMD, null, pinFile({ app2: { lane: 'acct', group: 'sub-a', along: 400, across: 900 } }), 'groups.mmd');
    const res = doc.layout!.result;
    const app2 = res.nodes.find((n) => n.id === 'app2')!;
    expect(app2.pinned).toBe(true);
    const lane = res.lanes.find((l) => l.id === 'acct')!;
    expect([app2.x - lane.x, app2.y]).toEqual([900, 400]); // TB: along is y, across is x from the lane's start
    expect(checkGroups(doc.graph, res, { app2: { lane: 'acct', group: 'sub-a', along: 400, across: 900 } })).toEqual([]);
    const sub = res.groups!.find((g) => g.id === 'sub-a')!;
    expect(sub.width).toBeGreaterThan(before.groups!.find((g) => g.id === 'sub-a')!.width);
    expect(checkLayout(doc.graph, { app2: { lane: 'acct', along: 400, across: 900 } }, res)).toEqual([]);
  });

  it('a pin whose group no longer matches (moved in text, or written without one) is ignored', () => {
    for (const pin of [
      { lane: 'acct', group: 'sub-b', along: 400, across: 900 },
      { lane: 'acct', along: 400, across: 900 },
    ]) {
      const doc = loadDocument(GROUPS_MMD, null, pinFile({ app2: pin }), 'groups.mmd');
      expect(doc.layout!.result.nodes.find((n) => n.id === 'app2')!.pinned).toBe(false);
      expect(doc.pins).toEqual({});
    }
    // A node directly in its lane: a pin naming a group is stale.
    const doc = loadDocument(GROUPS_MMD, null, pinFile({ gw: { lane: 'acct', group: 'net', along: 10, across: 10 } }), 'groups.mmd');
    expect(doc.layout!.result.nodes.find((n) => n.id === 'gw')!.pinned).toBe(false);
  });

  it('negative pins in a group (before everything) keep the frame and containment', () => {
    const pins = { app1: { lane: 'acct', group: 'sub-a', along: -60, across: -40 } };
    const doc = loadDocument(GROUPS_MMD, null, pinFile(pins), 'groups.mmd');
    const res = doc.layout!.result;
    expect(doc.layout!.translation).toEqual({ along: 60, across: 40 });
    expect(checkGroups(doc.graph, res, pins)).toEqual([]);
  });
});

describe('A19 layout: random grouped diagrams (C5 with groups)', () => {
  for (const [seed, n] of [[1, 12], [2, 30], [3, 60], [4, 100], [5, 25], [6, 45], [7, 80], [8, 18]] as const) {
    for (const dir of ['LR', 'TB'] as const) {
      it(`seed ${seed}, ${n} nodes, ${dir}: L1–L8 and L13 hold, unpinned and pinned`, () => {
        const graph = groupedGraph(seed, n, dir);
        expect(graph.nodes.filter((x) => x.group).length).toBeGreaterThan(0);
        const free = layout(graph, {});
        expect(checkLayout(graph, {}, free.result)).toEqual([]);
        expect(checkGroups(graph, free.result)).toEqual([]);
        // Again from its own hints, as the UI does after every edit.
        const again = layout(graph, {}, free.hints);
        expect(checkGroups(graph, again.result)).toEqual([]);
        // Pin a fifth of the nodes where they are (as a drag would), each with its group.
        const r = rng(seed + 99);
        const pins: Record<string, NodePin> = {};
        for (const node of free.result.nodes) {
          if (r() > 0.2) continue;
          const lane = free.result.lanes.find((l) => l.id === node.lane)!;
          const gn = graph.nodes.find((x) => x.id === node.id)!;
          const along = dir === 'LR' ? node.x : node.y;
          const across = dir === 'LR' ? node.y - lane.y : node.x - lane.x;
          pins[node.id] = { lane: node.lane, ...(gn.group ? { group: gn.group } : {}), along: along + 30, across };
        }
        const pinned = layout(graph, pins as Record<string, Pin>, free.hints);
        expect(checkLayout(graph, pins, pinned.result)).toEqual([]);
        expect(checkGroups(graph, pinned.result, pins)).toEqual([]);
      });
    }
  }
});

// ---- A19 with A22: line ends at an offset, and spread_ends, on blocks inside groups ----------------------------------

describe('A19 with A22: offsets and spreading on grouped blocks', () => {
  /** Lines between blocks in different groups (and depths), each end at a stored offset along a set side. */
  const OFFSETS: NonNullable<LayoutFile['edges']> = {
    'app1->db': { source_side: 'bottom', source_at: 0.25, target_side: 'top', target_at: 0.75 },
    'lb->app2': { source_side: 'bottom', source_at: 0.8, target_side: 'top', target_at: 0.1 },
    'db->audit': { source_side: 'right', source_at: 0.33 },
  };

  for (const dir of ['LR', 'TB'] as const) {
    it(`${dir}: each end is at its offset port, reported as stored, and L1–L13 still hold (unpinned and pinned)`, () => {
      const mmd = GROUPS_MMD.replace('flowchart TB', `flowchart ${dir}`);
      for (const pins of [{}, { app1: { lane: 'acct', group: 'sub-a', along: 300, across: 420 } }] as Record<string, NodePin>[]) {
        const f: LayoutFile = { version: 1, nodes: pins, edges: OFFSETS };
        const doc = loadDocument(mmd, null, JSON.stringify(f), 'groups.mmd');
        expect(doc.problems.errors).toEqual([]);
        const res = doc.layout!.result;
        expect(res.nodes.find((n) => n.id === 'app1')!.pinned).toBe('app1' in pins);
        expect(checkLayout(doc.graph, pins, res, { file: f })).toEqual([]);
        expect(checkGroups(doc.graph, res, pins)).toEqual([]);
        for (const [id, entry] of Object.entries(OFFSETS)) {
          const e = res.edges.find((x) => x.id === id)!;
          expect([e.source_at, e.target_at], id).toEqual([entry.source_at, entry.target_at]);
          for (const end of ['source', 'target'] as const) {
            const at = end === 'source' ? entry.source_at : entry.target_at;
            if (at === undefined) continue;
            const n = res.nodes.find((x) => x.id === (end === 'source' ? e.source : e.target))!;
            const p = end === 'source' ? e.points[0]! : e.points[e.points.length - 1]!;
            expect(atPortAt(n.kind, n, end === 'source' ? e.source_side : e.target_side, p, at), `${id} ${end}`).toBe(true);
            // The end sits on its block, so it is inside the block's group box too (containment, L13).
            const b = res.groups!.find((g) => g.id === n.group)!;
            expect(p[0]! >= b.x && p[0]! <= b.x + b.width && p[1]! >= b.y && p[1]! <= b.y + b.height, `${id} ${end} in ${b.id}`).toBe(true);
          }
        }
        // Offsets move only line ends: blocks and group boxes are where they are without them.
        const plain = loadDocument(mmd, null, JSON.stringify({ version: 1, nodes: pins }), 'groups.mmd').layout!.result;
        expect(res.nodes).toEqual(plain.nodes);
        expect(res.groups).toEqual(plain.groups);
      }
    });
  }

  it('spread_ends spreads the ends sharing a side of a grouped block, and leaves blocks and groups alone', () => {
    // db (in sub-b) has two lines coming in from above and one going out: give them all the same sides.
    const sides: NonNullable<LayoutFile['edges']> = {
      'app1->db': { target_side: 'top' }, 'app2->db': { target_side: 'top' }, 'db->audit': { source_side: 'top' },
    };
    const f: LayoutFile = { version: 1, nodes: {}, edges: sides, spread_ends: true };
    const doc = loadDocument(GROUPS_MMD, null, JSON.stringify(f), 'groups.mmd');
    const res = doc.layout!.result;
    expect(checkLayout(doc.graph, {}, res, { file: f })).toEqual([]);
    expect(checkGroups(doc.graph, res)).toEqual([]);
    const ats = ['app1->db', 'app2->db'].map((id) => res.edges.find((e) => e.id === id)!.target_at);
    const out = res.edges.find((e) => e.id === 'db->audit')!.source_at;
    expect([...ats, out].filter((a) => a !== undefined).sort()).toEqual([0.25, 0.75]); // 0.5 isn't reported
    const off = loadDocument(GROUPS_MMD, null, JSON.stringify({ ...f, spread_ends: false }), 'groups.mmd').layout!.result;
    expect(res.nodes).toEqual(off.nodes);
    expect(res.groups).toEqual(off.groups);
  });

  it('random grouped diagrams with set sides, offsets and spreading satisfy L1–L13 (both directions)', () => {
    let groupedOffsetEnds = 0;
    for (let k = 0; k < 12; k++) {
      const seed = 7300 + k;
      const graph = groupedGraph(seed, 12 + ((k * 7) % 40), k % 2 ? 'TB' : 'LR');
      // No pins: randomShaping's pins don't name groups, so they would go stale on grouped blocks.
      const s = randomShaping(seed, graph, { pinned: 0, sided: 0.6, offsets: 0.6, spread: k % 3 !== 0 });
      const out = layoutDiagram({ graph, file: s.file, notes: s.notes, title: s.title });
      expect(checkLayout(graph, {}, out.result, { file: s.file, notes: s.notes, title: s.title }), `seed ${seed}`).toEqual([]);
      expect(checkGroups(graph, out.result), `seed ${seed}`).toEqual([]);
      expect(layoutDiagram({ graph, file: s.file, notes: s.notes, title: s.title }).result).toEqual(out.result); // L10
      const grouped = new Set(out.result.nodes.filter((n) => n.group).map((n) => n.id));
      for (const e of out.result.edges) {
        if (e.source_at !== undefined && grouped.has(e.source)) groupedOffsetEnds++;
        if (e.target_at !== undefined && grouped.has(e.target)) groupedOffsetEnds++;
      }
    }
    // The run exercises the interaction: many line ends at an offset on blocks inside groups.
    expect(groupedOffsetEnds).toBeGreaterThan(20);
  }, 60000);
});

// ---- L13: automatic lines keep off group labels ---------------------------------------------------------------------
// QA regression: in a TB diagram a group's label sits across the top of its box, right where lines come in from above,
// and the line into the top of a block under the label struck through the label's text. Automatic lines now treat each
// label (and the room between it and the group's content) as off limits wherever another route exists. The fixtures
// in tests/layout-qa are the QA diagrams, with neutral names, plus a two-level nesting.

const QA = join(ROOT, 'tests/layout-qa');
const LABEL_CASES = ['group-label-tb', 'group-label-tb-subnets', 'group-label-lr', 'group-label-nested'];
const qaMmd = (name: string, dir: 'LR' | 'TB') =>
  readFileSync(join(QA, `${name}.mmd`), 'utf8').replace(/^flowchart (LR|TB)/m, `flowchart ${dir}`);

/** Pins every node where it was laid out, `along` px further along the flow, with its group (as a drag would). */
function pinAll(res: LayoutResult, graph: Graph, along: number, every = 1): Record<string, NodePin> {
  const LR = res.direction === 'LR';
  const pins: Record<string, NodePin> = {};
  res.nodes.forEach((node, k) => {
    if (k % every) return;
    const lane = res.lanes.find((l) => l.id === node.lane)!;
    const gn = graph.nodes.find((x) => x.id === node.id)!;
    pins[node.id] = {
      lane: node.lane, ...(gn.group ? { group: gn.group } : {}),
      along: (LR ? node.x : node.y) + along, across: LR ? node.y - lane.y : node.x - lane.x,
    };
  });
  return pins;
}

describe('A19 layout: automatic lines keep off group labels (L13)', () => {
  it('the label box the checks use is where the SVG export draws the label', () => {
    const doc = loadDocument(qaMmd('group-label-tb-subnets', 'TB'), null, null, 'x.mmd');
    const g = doc.layout!.result.groups!.find((x) => x.id === 'priv')!;
    const b = groupLabelBox(g);
    expect([b.x - g.x, b.y - g.y, b.height]).toEqual([10, 4, 16]);
    expect(b.width).toBeGreaterThan(60);
  });

  for (const name of LABEL_CASES) {
    for (const dir of ['TB', 'LR'] as const) {
      it(`${name}, ${dir}: no line crosses a group label, unpinned and pinned, and L1–L13 hold`, () => {
        const doc = loadDocument(qaMmd(name, dir), null, null, `${name}.mmd`);
        const res = doc.layout!.result;
        expect(res.groups!.length).toBeGreaterThan(0);
        expect(groupLabelCrossings(res)).toEqual([]);
        expect(checkLayout(doc.graph, {}, res, { strict: true })).toEqual([]);
        expect(checkGroups(doc.graph, res)).toEqual([]);
        // Every block pinned (moved 30 px along the flow), then every other one: still clear of every label.
        for (const every of [1, 2]) {
          const pins = pinAll(res, doc.graph, 30, every);
          const f: LayoutFile = { version: 1, nodes: pins };
          const pinned = loadDocument(qaMmd(name, dir), null, JSON.stringify(f), `${name}.mmd`).layout!.result;
          expect(groupLabelCrossings(pinned), `pinned every ${every}`).toEqual([]);
          expect(checkLayout(doc.graph, pins as Record<string, Pin>, pinned, { file: f }), `pinned every ${every}`).toEqual([]);
          expect(checkGroups(doc.graph, pinned, pins), `pinned every ${every}`).toEqual([]);
        }
      });
    }
  }

  it('TB: the line from above into a block right under its group\'s label comes in from the side instead of through it', () => {
    const doc = loadDocument(qaMmd('group-label-tb-subnets', 'TB'), null, null, 'x.mmd');
    const res = doc.layout!.result;
    const e = res.edges.find((x) => x.id === 'alb->app')!;
    expect(e.target_side).not.toBe('top');
    expect(groupLabelCrossings(res)).toEqual([]);
  });

  it('a side set into a label is still kept off it when there is room: the line runs round the label to its port', () => {
    const f: LayoutFile = { version: 1, nodes: {}, edges: { 'alb->app': { target_side: 'top' } } };
    const doc = loadDocument(qaMmd('group-label-tb-subnets', 'TB'), null, JSON.stringify(f), 'x.mmd');
    const res = doc.layout!.result;
    expect(checkLayout(doc.graph, {}, res, { file: f })).toEqual([]);
    expect(res.edges.find((x) => x.id === 'alb->app')!.target_side).toBe('top');
    expect(groupLabelCrossings(res)).toEqual([]);
  });

  it('where there is no other way (a set side whose port is on the label) the line still goes, at its port (L12)', () => {
    const mmd = qaMmd('group-label-tb-subnets', 'TB');
    const free = loadDocument(mmd, null, null, 'x.mmd').layout!.result;
    const label = groupLabelBox(free.groups!.find((g) => g.id === 'priv')!);
    const alb = free.nodes.find((n) => n.id === 'alb')!;
    const lane = free.lanes.find((l) => l.id === 'vpc')!;
    // The load balancer pinned with its bottom side 2 px into the label, over its middle: its bottom port is on it.
    const pin = { lane: 'vpc', along: label.y + 2 - alb.height, across: label.x + Math.floor(label.width / 2) - Math.floor(alb.width / 2) - lane.x };
    // The other blocks stay where they were (pinned there, with their groups), so the label does too.
    const stay = pinAll(free, loadDocument(mmd, null, null, 'x.mmd').graph, 0);
    const f: LayoutFile = { version: 1, nodes: { ...stay, alb: pin }, edges: { 'alb->app': { source_side: 'bottom' } } };
    const doc = loadDocument(mmd, null, JSON.stringify(f), 'x.mmd');
    const res = doc.layout!.result;
    expect(checkLayout(doc.graph, doc.pins, res, { file: f })).toEqual([]);
    expect(res.edges.find((x) => x.id === 'alb->app')!.source_side).toBe('bottom');
    expect(res.groups!.find((g) => g.id === 'priv')).toEqual(free.groups!.find((g) => g.id === 'priv'));
    expect(groupLabelCrossings(res)).toEqual(['alb->app → priv']);
  });

  it('random grouped diagrams (both directions, up to three levels): no automatic line crosses a label, L1–L13 hold', () => {
    let lines = 0;
    for (const [seed, n] of [[1, 12], [2, 30], [3, 60], [5, 25], [6, 45], [8, 18], [11, 36], [12, 20]] as const) {
      for (const dir of ['LR', 'TB'] as const) {
        const graph = groupedGraph(seed, n, dir);
        const free = layout(graph, {});
        expect(groupLabelCrossings(free.result), `seed ${seed} ${dir}`).toEqual([]);
        expect(checkLayout(graph, {}, free.result), `seed ${seed} ${dir}`).toEqual([]);
        expect(checkGroups(graph, free.result), `seed ${seed} ${dir}`).toEqual([]);
        const pins = pinAll(free.result, graph, 30, 5);
        const pinned = layout(graph, pins as Record<string, Pin>, free.hints);
        expect(groupLabelCrossings(pinned.result), `seed ${seed} ${dir} pinned`).toEqual([]);
        expect(checkLayout(graph, pins, pinned.result), `seed ${seed} ${dir} pinned`).toEqual([]);
        expect(checkGroups(graph, pinned.result, pins), `seed ${seed} ${dir} pinned`).toEqual([]);
        lines += free.result.edges.length;
      }
    }
    expect(lines).toBeGreaterThan(300);
  }, 60000);
});
