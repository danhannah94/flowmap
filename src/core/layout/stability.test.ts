// Stability (§6, H5): with the hints from the previous layout, a small edit must not reshuffle unrelated nodes.
// "Slot" = a node's lane, column (rank) and row, read from the returned hints. "Inverted" = the node swapped its
// relative position (left/right or above/below) with some other unrelated node: what an eye sees as a reshuffle.
// A rigid shift (a lane grows, a column widens, everything after it slides along together) inverts nothing.
import { describe, expect, it } from 'vitest';
import type { Graph, LayoutResult, Pin } from '../types';
import { layout } from './index';
import type { Hints } from './hints';
import { checkLayout, purchaseRequest, randomGraph, scc } from './testkit';

const slots = (h: unknown) => (h as Hints).n;
const boxOf = (r: LayoutResult) => new Map(r.nodes.map((n) => [n.id, `${n.x},${n.y}`]));

function diff(before: { result: LayoutResult; hints: unknown }, after: { result: LayoutResult; hints: unknown }, skip: Set<string>) {
  const s0 = slots(before.hints);
  const s1 = slots(after.hints);
  const b0 = boxOf(before.result);
  const b1 = boxOf(after.result);
  let reslotted = 0;
  let moved = 0;
  const ids = Object.keys(s0).filter((id) => !skip.has(id) && s1[id]);
  for (const id of ids) {
    if (s0[id]!.join() !== s1[id]!.join()) reslotted++;
    if (b0.get(id) !== b1.get(id)) moved++;
  }
  const p0 = new Map(before.result.nodes.map((n) => [n.id, n]));
  const p1 = new Map(after.result.nodes.map((n) => [n.id, n]));
  const inv = new Set<string>();
  for (let a = 0; a < ids.length; a++)
    for (let b = a + 1; b < ids.length; b++) {
      const A0 = p0.get(ids[a]!)!;
      const B0 = p0.get(ids[b]!)!;
      const A1 = p1.get(ids[a]!)!;
      const B1 = p1.get(ids[b]!)!;
      if (Math.sign(A0.x - B0.x) !== Math.sign(A1.x - B1.x) || Math.sign(A0.y - B0.y) !== Math.sign(A1.y - B1.y)) {
        inv.add(ids[a]!);
        inv.add(ids[b]!);
      }
    }
  return { reslotted, moved, inverted: inv.size };
}

function downstream(g: Graph, from: string): Set<string> {
  const out = new Map<string, string[]>();
  for (const e of g.edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length) for (const t of out.get(stack.pop()!) ?? []) if (!seen.has(t)) seen.add(t), stack.push(t);
  return seen;
}

const clone = (g: Graph): Graph => JSON.parse(JSON.stringify(g));

/** Nodes whose strongly connected component (as a set of ids) differs between two graphs. */
function changedScc(a: Graph, b: Graph): string[] {
  const groups = (g: Graph) => {
    const ids = g.nodes.map((n) => n.id);
    const comp = scc(ids, g.edges);
    const by = new Map<number, string[]>();
    for (const id of ids) by.set(comp.get(id)!, [...(by.get(comp.get(id)!) ?? []), id]);
    return new Map(ids.map((id) => [id, by.get(comp.get(id)!)!.filter((x) => b.nodes.some((n) => n.id === x) && a.nodes.some((n) => n.id === x)).sort().join()]));
  };
  const ga = groups(a);
  const gb = groups(b);
  return [...gb.keys()].filter((id) => ga.get(id) !== gb.get(id));
}

const bases: [string, Graph, Record<string, Pin>][] = [
  ['purchase-request LR', purchaseRequest('LR').graph, purchaseRequest('LR').pins],
  ['purchase-request TB', purchaseRequest('TB').graph, purchaseRequest('TB').pins],
  ...[31, 32, 33, 34].map((s) => [`random ${s}`, randomGraph(s, { nodes: 40, direction: s % 2 ? 'LR' : 'TB' }), {}] as [string, Graph, Record<string, Pin>]),
];

describe.each(bases)('stability: %s', (_name, base, pins) => {
  const first = layout(base, pins);

  it('a rename keeps every slot, and nodes before it stay put', () => {
    const g = clone(base);
    const victim = g.nodes[Math.floor(g.nodes.length / 3)]!;
    victim.label = victim.label + ' (renamed, now a bit longer)';
    const after = layout(g, pins, first.hints);
    expect(checkLayout(g, pins, after.result)).toEqual([]);
    const d = diff(first, after, new Set([victim.id]));
    expect(d.reslotted).toBe(0);
    expect(d.inverted).toBe(0);
    // Columns only ever widen, so nodes in earlier columns stay at the same position along the flow.
    const rank = slots(first.hints)[victim.id]![1];
    const LR = first.result.direction === 'LR';
    const along = (r: LayoutResult) => new Map(r.nodes.map((n) => [n.id, LR ? n.x : n.y]));
    const a0 = along(first.result);
    const a1 = along(after.result);
    for (const [id, s] of Object.entries(slots(first.hints))) if (s[1] < rank && id !== victim.id) expect(a1.get(id)).toBe(a0.get(id));
  });

  it('an added node in the middle of a chain moves nothing outside its downstream', () => {
    const g = clone(base);
    const e = g.edges[Math.floor(g.edges.length / 2)]!;
    const src = g.nodes.find((n) => n.id === e.source)!;
    g.nodes.push({ id: 'added', label: 'A new step', kind: 'step', lane: src.lane });
    g.edges.push({ id: `${e.source}->added`, source: e.source, target: 'added', label: null });
    g.edges.push({ id: `added->${e.target}`, source: 'added', target: e.target, label: null });
    const after = layout(g, pins, first.hints);
    expect(checkLayout(g, pins, after.result)).toEqual([]);
    const d = diff(first, after, downstream(g, 'added'));
    expect(d.reslotted).toBe(0);
    expect(d.inverted).toBeLessThanOrEqual(2);
  });

  it('an added edge moves nothing outside the target\'s downstream', () => {
    const g = clone(base);
    const s = g.nodes[1]!;
    const t = g.nodes[g.nodes.length - 1]!;
    g.edges.push({ id: `${s.id}->${t.id}#new`, source: s.id, target: t.id, label: 'new' });
    const after = layout(g, pins, first.hints);
    expect(checkLayout(g, pins, after.result)).toEqual([]);
    const d = diff(first, after, downstream(g, t.id));
    expect(d.reslotted).toBe(0);
    expect(d.inverted).toBe(0);
  });

  it('one drag (a new pin) leaves everything else where it was', () => {
    const r = first.result;
    const victim = r.nodes.find((n) => !n.pinned && n.lane !== '_unassigned')!;
    const lane = r.lanes.find((l) => l.id === victim.lane)!;
    const LR = r.direction === 'LR';
    const pin: Pin = {
      lane: victim.lane,
      along: (LR ? victim.x : victim.y) + 30,
      across: Math.max(12, (LR ? victim.y - lane.y : victim.x - lane.x) + 20),
    };
    const pins2 = { ...pins, [victim.id]: pin };
    const after = layout(base, pins2, first.hints);
    expect(checkLayout(base, pins2, after.result)).toEqual([]);
    const d = diff(first, after, new Set([victim.id]));
    expect(d.reslotted).toBe(0);
    expect(d.inverted).toBeLessThanOrEqual(2); // only a node the dragged box lands on may step aside
    // Beyond that, only rigid shifts: a lane the pin made deeper pushes the lanes after it along together.
    const lanes0 = new Map(first.result.lanes.map((l) => [l.id, l]));
    const lanes1 = new Map(after.result.lanes.map((l) => [l.id, l]));
    let relMoved = 0;
    for (const n1 of after.result.nodes) {
      const n0 = first.result.nodes.find((n) => n.id === n1.id)!;
      if (n1.id === victim.id) continue;
      const l0 = lanes0.get(n0.lane)!;
      const l1 = lanes1.get(n1.lane)!;
      if (n1.x - l1.x !== n0.x - l0.x || n1.y - l1.y !== n0.y - l0.y) relMoved++;
    }
    expect(relMoved).toBeLessThanOrEqual(1);
  });

  it('deleting a node (an AI text edit) keeps every slot the loop structure allows', () => {
    const g = clone(base);
    const victim = g.nodes[Math.floor(g.nodes.length / 2)]!;
    g.nodes = g.nodes.filter((n) => n !== victim);
    g.edges = g.edges.filter((e) => e.source !== victim.id && e.target !== victim.id);
    const after = layout(g, pins, first.hints);
    expect(checkLayout(g, pins, after.result)).toEqual([]);
    // A node whose loop (SCC) the deletion broke may have to move: L5 then forces its former back edge forward.
    const skip = new Set([victim.id, ...changedScc(base, g)]);
    const d = diff(first, after, skip);
    expect(d.reslotted).toBe(0);
    expect(d.inverted).toBe(0);
  });
});
