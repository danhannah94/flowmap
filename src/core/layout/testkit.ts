// Test utilities for the layout: a strict geometric checker for §6 L1–L8 (L10 is checked by running twice), quality
// statistics, a seeded random graph generator and a hand-built copy of fixtures/purchase-request. Pure: no fs.
import type { Graph, GraphEdge, GraphNode, LayoutResult, Pin, ShapeKind } from '../types';
import { SHAPE_KINDS, UNASSIGNED } from '../types';

type Box = { x: number; y: number; width: number; height: number };

const interiorHit = (ax: number, ay: number, bx: number, by: number, r: Box): boolean => {
  // Does the segment (axis-aligned) pass through the open interior of r?
  if (ay === by) {
    if (!(ay > r.y && ay < r.y + r.height)) return false;
    return Math.max(ax, bx) > r.x && Math.min(ax, bx) < r.x + r.width;
  }
  if (!(ax > r.x && ax < r.x + r.width)) return false;
  return Math.max(ay, by) > r.y && Math.min(ay, by) < r.y + r.height;
};

/** Distance from a point to the boundary of a box (0 on it). */
export function distToBoundary(px: number, py: number, b: Box): number {
  const dx = Math.max(b.x - px, 0, px - (b.x + b.width));
  const dy = Math.max(b.y - py, 0, py - (b.y + b.height));
  if (dx === 0 && dy === 0) return Math.min(px - b.x, b.x + b.width - px, py - b.y, b.y + b.height - py);
  return Math.hypot(dx, dy);
}

const overlapsWithin = (a: Box, b: Box, gap: number): boolean =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** SCC ids (plain recursive Tarjan: independent of the layout's own implementation). */
export function scc(ids: string[], edges: { source: string; target: string }[]): Map<string, number> {
  const out = new Map<string, string[]>(ids.map((i) => [i, []]));
  for (const e of edges) out.get(e.source)?.push(e.target);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const on = new Set<string>();
  const st: string[] = [];
  const comp = new Map<string, number>();
  let c = 0;
  let k = 0;
  const visit = (v: string) => {
    index.set(v, k);
    low.set(v, k++);
    st.push(v);
    on.add(v);
    for (const w of out.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      let w: string;
      do {
        w = st.pop()!;
        on.delete(w);
        comp.set(w, c);
      } while (w !== v);
      c++;
    }
  };
  for (const v of ids) if (!index.has(v)) visit(v);
  return comp;
}

export interface CheckOptions {
  /** Also flag quality problems that §6 allows: edges through their own source/target, labels over boxes. */
  strict?: boolean;
}

/** Checks L1–L8 on a layout result. Returns human-readable violations (empty = all good). */
export function checkLayout(graph: Graph, pins: Record<string, Pin>, res: LayoutResult, opts: CheckOptions = {}): string[] {
  const v: string[] = [];
  const LR = res.direction === 'LR';
  const ints = (what: string, ...ns: number[]) => {
    if (ns.some((x) => !Number.isInteger(x))) v.push(`non-integer ${what}: ${ns.join(',')}`);
  };
  ints('diagram size', res.width, res.height);
  if (res.direction !== graph.direction) v.push(`direction ${res.direction} != ${graph.direction}`);

  // L1: lanes in display order, stacked, full span, >= 100 across.
  const expectLanes = graph.lanes.map((l) => l.id);
  const hasUnassigned = graph.nodes.some((n) => n.lane === UNASSIGNED);
  if (hasUnassigned && !expectLanes.includes(UNASSIGNED)) expectLanes.push(UNASSIGNED);
  const got = res.lanes.map((l) => l.id);
  if (got.join('|') !== expectLanes.join('|')) v.push(`L1 lane order ${got.join(',')} != ${expectLanes.join(',')}`);
  if (got.includes(UNASSIGNED) && got[got.length - 1] !== UNASSIGNED) v.push('L1 _unassigned is not last');
  let pos = 0;
  for (const l of res.lanes) {
    ints(`lane ${l.id}`, l.x, l.y, l.width, l.height);
    const start = LR ? l.y : l.x;
    const thick = LR ? l.height : l.width;
    if (start !== pos) v.push(`L1 lane ${l.id} starts at ${start}, expected ${pos}`);
    pos = start + thick;
    if (thick < 100) v.push(`L1 lane ${l.id} is ${thick} across`);
    if (LR ? l.x !== 0 || l.width !== res.width : l.y !== 0 || l.height !== res.height) v.push(`L1 lane ${l.id} doesn't span the diagram`);
  }
  if (res.lanes.length && pos !== (LR ? res.height : res.width)) v.push(`L1 lanes end at ${pos}, diagram is ${LR ? res.height : res.width}`);

  // Nodes: presence and L2, L4.
  const laneOf = new Map(res.lanes.map((l) => [l.id, l]));
  const byId = new Map(res.nodes.map((n) => [n.id, n]));
  if (res.nodes.length !== graph.nodes.length) v.push(`node count ${res.nodes.length} != ${graph.nodes.length}`);
  for (const gn of graph.nodes) {
    const n = byId.get(gn.id);
    if (!n) {
      v.push(`missing node ${gn.id}`);
      continue;
    }
    ints(`node ${n.id}`, n.x, n.y, n.width, n.height);
    if (n.lane !== gn.lane || n.kind !== gn.kind || n.label !== gn.label) v.push(`node ${n.id} lane/kind/label mismatch`);
    const pin = pins[gn.id];
    const shouldPin = !!pin && pin.lane === gn.lane;
    if (n.pinned !== shouldPin) v.push(`node ${n.id} pinned=${n.pinned}, expected ${shouldPin}`);
    const lane = laneOf.get(n.lane);
    if (!lane) {
      v.push(`node ${n.id} lane ${n.lane} missing`);
      continue;
    }
    const pad = n.pinned ? 0 : 12;
    if (n.x < lane.x + pad || n.y < lane.y + pad || n.x + n.width > lane.x + lane.width - pad || n.y + n.height > lane.y + lane.height - pad) {
      if (!n.pinned || n.x < lane.x || n.y < lane.y || n.x + n.width > lane.x + lane.width || n.y + n.height > lane.y + lane.height)
        v.push(`L2 node ${n.id} (${n.x},${n.y} ${n.width}x${n.height}) not inside lane ${lane.id} with padding ${pad}`);
    }
    if (shouldPin) {
      const along = LR ? n.x : n.y;
      const across = LR ? n.y - lane.y : n.x - lane.x;
      if (along !== pin!.along || across !== pin!.across) v.push(`L4 node ${n.id} at along ${along}/across ${across}, pin says ${pin!.along}/${pin!.across}`);
    }
  }

  // L3: no two boxes within 16 px, except two pinned.
  const ns = res.nodes;
  const sorted = [...ns].sort((a, b) => a.x - b.x);
  for (let a = 0; a < sorted.length; a++) {
    const A = sorted[a]!;
    for (let b = a + 1; b < sorted.length; b++) {
      const B = sorted[b]!;
      if (B.x >= A.x + A.width + 16) break;
      if (A.pinned && B.pinned) continue;
      if (overlapsWithin(A, B, 16)) v.push(`L3 ${A.id} and ${B.id} closer than 16 px`);
    }
  }

  // L5: flow direction for unpinned, non-SCC edges.
  const comp = scc(graph.nodes.map((n) => n.id), graph.edges);
  for (const e of graph.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t || s.pinned || t.pinned || comp.get(e.source) === comp.get(e.target)) continue;
    if ((LR ? t.x < s.x : t.y < s.y)) v.push(`L5 edge ${e.id} goes against the flow`);
  }

  // L6, L7, L8 per edge.
  const pinnedOverlap = new Set<string>();
  const pinnedNodes = ns.filter((n) => n.pinned);
  for (let a = 0; a < pinnedNodes.length; a++)
    for (let b = a + 1; b < pinnedNodes.length; b++)
      if (overlaps(pinnedNodes[a]!, pinnedNodes[b]!)) {
        pinnedOverlap.add(pinnedNodes[a]!.id);
        pinnedOverlap.add(pinnedNodes[b]!.id);
      }
  const edgeById = new Map(res.edges.map((e) => [e.id, e]));
  if (res.edges.length !== graph.edges.length) v.push(`edge count ${res.edges.length} != ${graph.edges.length}`);
  for (const ge of graph.edges) {
    const e = edgeById.get(ge.id);
    if (!e) {
      v.push(`missing edge ${ge.id}`);
      continue;
    }
    const s = byId.get(ge.source)!;
    const t = byId.get(ge.target)!;
    const pts = e.points;
    if (pts.length < 2) {
      v.push(`L6 edge ${e.id} has ${pts.length} points`);
      continue;
    }
    for (const [x, y] of pts) ints(`edge ${e.id} point`, x, y);
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, ay] = pts[k]!;
      const [bx, by] = pts[k + 1]!;
      if (ax !== bx && ay !== by) v.push(`L6 edge ${e.id} segment ${k} is diagonal`);
    }
    if (distToBoundary(pts[0]![0], pts[0]![1], s) > 2) v.push(`L6 edge ${e.id} doesn't start on ${s.id}'s boundary`);
    const last = pts[pts.length - 1]!;
    if (distToBoundary(last[0], last[1], t) > 2) v.push(`L6 edge ${e.id} doesn't end on ${t.id}'s boundary`);
    const exempt = pinnedOverlap.has(s.id) || pinnedOverlap.has(t.id);
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, ay] = pts[k]!;
      const [bx, by] = pts[k + 1]!;
      for (const n of ns) {
        const own = n.id === s.id || n.id === t.id;
        if (own && !opts.strict) continue;
        if (!own && exempt) continue;
        if (interiorHit(ax, ay, bx, by, n)) v.push(`L7 edge ${e.id} crosses ${own ? 'its own endpoint ' : ''}${n.id}`);
      }
    }
    const hasLabel = ge.label !== null && ge.label !== '';
    if (e.label !== ge.label) v.push(`edge ${e.id} label mismatch`);
    if (hasLabel !== (e.label_pos !== null)) v.push(`L8 edge ${e.id} label_pos presence wrong`);
    if (e.label_pos) {
      ints(`edge ${e.id} label_pos`, ...e.label_pos);
      const d = distToBoundary(e.label_pos[0], e.label_pos[1], s);
      if (d > 60) v.push(`L8 edge ${e.id} label ${d.toFixed(1)} px from its source`);
    }
  }
  return v;
}

/** Quality numbers for eyeballing and regression tests (not contract). */
export function qualityStats(res: LayoutResult): { bends: number; crossings: number; sharedTrack: number; ownCross: number } {
  let bends = 0;
  let crossings = 0;
  let sharedTrack = 0;
  let ownCross = 0;
  const segs: { e: number; h: boolean; c: number; lo: number; hi: number }[] = [];
  const byId = new Map(res.nodes.map((n) => [n.id, n]));
  res.edges.forEach((e, ei) => {
    bends += Math.max(0, e.points.length - 2);
    const s = byId.get(e.source)!;
    const t = byId.get(e.target)!;
    for (let k = 0; k + 1 < e.points.length; k++) {
      const [ax, ay] = e.points[k]!;
      const [bx, by] = e.points[k + 1]!;
      const h = ay === by;
      segs.push({ e: ei, h, c: h ? ay : ax, lo: h ? Math.min(ax, bx) : Math.min(ay, by), hi: h ? Math.max(ax, bx) : Math.max(ay, by) });
      if (interiorHit(ax, ay, bx, by, s) || interiorHit(ax, ay, bx, by, t)) ownCross++;
    }
  });
  for (let a = 0; a < segs.length; a++)
    for (let b = a + 1; b < segs.length; b++) {
      const A = segs[a]!;
      const B = segs[b]!;
      if (A.e === B.e) continue;
      if (A.h === B.h) {
        if (A.c === B.c && Math.min(A.hi, B.hi) - Math.max(A.lo, B.lo) > 12) sharedTrack++;
      } else {
        const H = A.h ? A : B;
        const V = A.h ? B : A;
        if (V.c > H.lo && V.c < H.hi && H.c > V.lo && H.c < V.hi) crossings++;
      }
    }
  return { bends, crossings, sharedTrack, ownCross };
}

// ------------------------------------------------------------------------------------------------------------
// Random graphs
// ------------------------------------------------------------------------------------------------------------

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ('check review approve send quote vendor invoice order request budget move ship receive sign match ' +
  'create update wait for the a manager finance purchase form complete missing freight part service defer next ' +
  'quarter ERP spreadsheet email call confirm schedule delivery pick three over $1,000 PO receipt paid closed').split(' ');

export interface RandomGraphOptions {
  nodes: number;
  direction?: 'LR' | 'TB';
  lanes?: number;
}

/** A process-map-shaped random graph: chains with decision branches (2-3 labelled branches), loops back, cross-lane
 * hops, duplicate edges, a self-loop now and then, empty lanes and unlaned nodes. */
export function randomGraph(seed: number, opts: RandomGraphOptions): Graph {
  const r = rng(seed);
  const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const laneCount = opts.lanes ?? 1 + Math.floor(r() * 7);
  const lanes = Array.from({ length: laneCount }, (_, i) => ({ id: `lane${i}`, label: `Lane ${i} ${pick(WORDS)}` }));
  const emptyLane = laneCount > 2 && r() < 0.4 ? Math.floor(r() * laneCount) : -1;
  const unlanedRate = r() < 0.3 ? 0.08 : 0;
  const nodes: GraphNode[] = [];
  for (let i = 0; i < opts.nodes; i++) {
    const kindRoll = r();
    const kind: ShapeKind = kindRoll < 0.45 ? 'step' : kindRoll < 0.65 ? 'decision' : pick(SHAPE_KINDS);
    const words = 1 + Math.floor(r() * (r() < 0.2 ? 14 : 6));
    let label = Array.from({ length: words }, () => pick(WORDS)).join(' ');
    if (r() < 0.03) label = 'Supercalifragilisticexpialidocious-and-then-some-more';
    if (kind === 'decision') label = label.split(' ').slice(0, 4).join(' ') + '?';
    let lane = lanes.length ? pick(lanes).id : UNASSIGNED;
    if (lanes.length && emptyLane >= 0 && lane === lanes[emptyLane]!.id) lane = lanes[(emptyLane + 1) % laneCount]!.id;
    if (r() < unlanedRate) lane = UNASSIGNED;
    nodes.push({ id: `n${i}`, label, kind, lane });
  }
  const edges: GraphEdge[] = [];
  const counts = new Map<string, number>();
  const add = (s: number, t: number, label: string | null) => {
    const base = `n${s}->n${t}`;
    const c = (counts.get(base) ?? 0) + 1;
    counts.set(base, c);
    edges.push({ id: c === 1 ? base : `${base}#${c}`, source: `n${s}`, target: `n${t}`, label });
  };
  // Backbone: each node links forward to one of the next few nodes; decisions branch.
  for (let i = 0; i < opts.nodes - 1; i++) {
    const node = nodes[i]!;
    if (node.kind === 'decision') {
      const branches = r() < 0.3 ? 3 : 2;
      const labels = branches === 3 ? ['yes', 'no', 'maybe later'] : r() < 0.5 ? ['yes', 'no'] : ['approved', 'rejected'];
      for (let b = 0; b < branches; b++) {
        let t = Math.min(opts.nodes - 1, i + 1 + Math.floor(r() * 4));
        if (b > 0 && r() < 0.35) t = Math.max(0, i - 1 - Math.floor(r() * 6)); // loop back
        add(i, t, labels[b]!);
      }
    } else if (r() < 0.93) {
      add(i, Math.min(opts.nodes - 1, i + 1 + Math.floor(r() * (r() < 0.8 ? 2 : 8))), r() < 0.1 ? pick(WORDS) : null);
    }
  }
  const extra = Math.floor(opts.nodes * 0.15);
  for (let k = 0; k < extra; k++) {
    const s = Math.floor(r() * opts.nodes);
    const t = Math.floor(r() * opts.nodes);
    if (s === t && r() > 0.3) continue;
    add(s, t, r() < 0.2 ? pick(WORDS) : null);
  }
  if (edges.length && r() < 0.3) {
    const e = pick(edges);
    add(Number(e.source.slice(1)), Number(e.target.slice(1)), null); // duplicate
  }
  const laneIds = lanes.map((l) => ({ ...l }));
  if (nodes.some((n) => n.lane === UNASSIGNED)) laneIds.push({ id: UNASSIGNED, label: 'Unassigned' });
  return { direction: opts.direction ?? 'LR', lanes: laneIds, nodes, edges };
}

/** Legal random pins (non-negative, across >= 12 as the UI writes them) for a fraction of the nodes. */
export function randomPins(seed: number, graph: Graph, fraction: number, alongMax = 2000): Record<string, Pin> {
  const r = rng(seed ^ 0x9e3779b9);
  const pins: Record<string, Pin> = {};
  for (const n of graph.nodes) {
    if (r() >= fraction) continue;
    pins[n.id] = { lane: n.lane, along: Math.floor(r() * alongMax), across: 12 + Math.floor(r() * 220) };
  }
  // A stale pin (wrong lane) that must be ignored.
  const first = graph.nodes[0];
  if (first && r() < 0.5) pins[first.id] = { lane: 'no-such-lane', along: 10, across: 20 };
  return pins;
}

// ------------------------------------------------------------------------------------------------------------
// fixtures/purchase-request, built by hand (the parser is written elsewhere)
// ------------------------------------------------------------------------------------------------------------

export function purchaseRequest(direction: 'LR' | 'TB' = 'LR'): { graph: Graph; pins: Record<string, Pin> } {
  const lanes = [
    ['requester', 'Requester'], ['manager', 'Manager'], ['purchasing', 'Purchasing'], ['finance', 'Finance'], ['vendor', 'Vendor'],
  ].map(([id, label]) => ({ id: id!, label: label! }));
  const N = (id: string, label: string, kind: ShapeKind, lane: string): GraphNode => ({ id, label, kind, lane });
  const nodes = [
    N('intake', 'Needs a part or service', 'terminal', 'requester'),
    N('r01', 'Fill the purchase request form', 'step', 'requester'),
    N('r02', 'Receive the delivery and sign for it', 'step', 'requester'),
    N('closed', 'Request closed', 'terminal', 'requester'),
    N('m01', 'Review the request', 'step', 'manager'),
    N('m02', 'Approved?', 'decision', 'manager'),
    N('m03', 'Tell the requester why not', 'step', 'manager'),
    N('p01', 'Check the request is complete', 'step', 'purchasing'),
    N('p02', 'Complete?', 'decision', 'purchasing'),
    N('p03', 'Send it back with what is missing', 'step', 'purchasing'),
    N('p04', 'Over $1,000?', 'decision', 'purchasing'),
    N('p05', 'Get three quotes', 'step', 'purchasing'),
    N('p06', 'Pick the vendor', 'step', 'purchasing'),
    N('p07', 'Create the PO in the ERP', 'step', 'purchasing'),
    N('f01', 'Budget available?', 'decision', 'finance'),
    N('f02', 'Move budget or defer to next quarter', 'step', 'finance'),
    N('f03', 'Match the invoice to the PO and the receipt', 'step', 'finance'),
    N('f04', 'Vendor paid', 'terminal', 'finance'),
    N('v01', 'Send a quote', 'document', 'vendor'),
    N('v02', 'Ship the order', 'step', 'vendor'),
  ];
  const E = (s: string, t: string, label: string | null = null): GraphEdge => ({ id: `${s}->${t}`, source: s, target: t, label });
  const edges = [
    E('intake', 'r01'), E('r01', 'p01'), E('p01', 'p02'), E('p02', 'p03', 'no'), E('p03', 'r01'), E('p02', 'p04', 'yes'),
    E('p04', 'm01', 'yes'), E('p04', 'p05', 'no'), E('m01', 'm02'), E('m02', 'm03', 'no'), E('m03', 'closed'),
    E('m02', 'p05', 'yes'), E('p05', 'v01'), E('v01', 'p06'), E('p06', 'f01'), E('f01', 'p07', 'yes'), E('f01', 'f02', 'no'),
    E('f02', 'f01'), E('p07', 'v02'), E('v02', 'r02'), E('r02', 'f03'), E('f03', 'f04'),
  ];
  return {
    graph: { direction, lanes, nodes, edges },
    pins: { closed: { lane: 'requester', along: 1400, across: 40 } },
  };
}
