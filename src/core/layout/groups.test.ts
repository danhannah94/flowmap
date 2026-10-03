// Amendment A19, §6 L13: groups (subgraphs inside lanes). Containment at every depth, pins exact (and grouped pins
// that go stale ignored), no overlap of unpinned groups with each other or with non-members, L1–L8 still holding, and
// a diagram without groups laid out exactly as before (the v1.0 goldens in golden.test.ts pin that byte for byte).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDocument } from '../document';
import type { Graph, GraphGroup, LayoutResult, NodePin, Pin } from '../types';
import { UNASSIGNED } from '../types';
import { layout, layoutDiagram } from './index';
import { checkLayout, randomGraph, rng } from './testkit';

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
