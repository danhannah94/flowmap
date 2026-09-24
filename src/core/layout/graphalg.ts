// Graph algorithms for the layered layout: strongly connected components, cycle breaking and ranking.
// Everything works on node indices (file order) and edge indices (file order), so results are deterministic.

export interface IndexedEdge {
  s: number;
  t: number;
}

/** Tarjan's SCC, iterative. Returns the component id of each node (ids are arbitrary but deterministic). */
export function stronglyConnected(n: number, edges: IndexedEdge[]): number[] {
  const out: number[][] = Array.from({ length: n }, () => []);
  for (const e of edges) out[e.s]!.push(e.t);
  const index = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const onStack = new Array<boolean>(n).fill(false);
  const comp = new Array<number>(n).fill(-1);
  const stack: number[] = [];
  let counter = 0;
  let compCount = 0;
  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
    const work: [number, number][] = [[root, 0]];
    index[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = true;
    while (work.length) {
      const frame = work[work.length - 1]!;
      const v = frame[0];
      const succ = out[v]!;
      if (frame[1] < succ.length) {
        const w = succ[frame[1]++]!;
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = true;
          work.push([w, 0]);
        } else if (onStack[w]) low[v] = Math.min(low[v]!, index[w]!);
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1]![0];
        low[parent] = Math.min(low[parent]!, low[v]!);
      }
      if (low[v] === index[v]) {
        let w: number;
        do {
          w = stack.pop()!;
          onStack[w] = false;
          comp[w] = compCount;
        } while (w !== v);
        compCount++;
      }
    }
  }
  return comp;
}

/**
 * Picks the edges to reverse so the rest is acyclic. Only edges inside one SCC can be back edges. Within an SCC the
 * nodes get an order: by hinted rank when every node of the SCC has one (so a stable layout keeps its loops), else by
 * a depth-first search from the SCC's entry node (the first node reached from outside, in edge order). An edge is a
 * back edge when it doesn't go forward in that order. Self-loops are always back edges.
 */
export function backEdges(n: number, edges: IndexedEdge[], comp: number[], hintRank: (number | undefined)[]): boolean[] {
  const back = edges.map((e) => e.s === e.t);
  const members = new Map<number, number[]>();
  for (let v = 0; v < n; v++) {
    const c = comp[v]!;
    let m = members.get(c);
    if (!m) members.set(c, (m = []));
    m.push(v);
  }
  const out: number[][] = Array.from({ length: n }, () => []);
  edges.forEach((e, i) => out[e.s]!.push(i));
  const order = new Array<number>(n).fill(0);
  for (const [c, vs] of members) {
    if (vs.length < 2) continue;
    if (vs.every((v) => hintRank[v] !== undefined)) {
      const sorted = [...vs].sort((a, b) => hintRank[a]! - hintRank[b]! || a - b);
      sorted.forEach((v, i) => (order[v] = i));
      continue;
    }
    // Entry: target of the first edge (file order) coming from outside the SCC; else the first member.
    let entry = vs[0]!;
    for (const e of edges) {
      if (comp[e.t] === c && comp[e.s] !== c) {
        entry = e.t;
        break;
      }
    }
    // Iterative DFS inside the SCC; reverse postorder gives the order.
    const seen = new Set<number>();
    const post: number[] = [];
    const starts = [entry, ...vs.filter((v) => v !== entry)];
    for (const st of starts) {
      if (seen.has(st)) continue;
      seen.add(st);
      const work: [number, number][] = [[st, 0]];
      while (work.length) {
        const frame = work[work.length - 1]!;
        const v = frame[0];
        const es = out[v]!;
        if (frame[1] < es.length) {
          const w = edges[es[frame[1]++]!]!.t;
          if (comp[w] === c && !seen.has(w)) {
            seen.add(w);
            work.push([w, 0]);
          }
          continue;
        }
        work.pop();
        post.push(v);
      }
    }
    post.reverse().forEach((v, i) => (order[v] = i));
  }
  edges.forEach((e, i) => {
    if (e.s !== e.t && comp[e.s] === comp[e.t] && order[e.t]! <= order[e.s]!) back[i] = true;
  });
  return back;
}

/**
 * Ranks (layer indices) for a DAG given by the non-back edges: every forward edge goes to a strictly higher rank.
 * A node's rank is the longest path from a source, raised to its hinted rank if it has one. Sources without a hint
 * are then pulled forward next to their earliest successor, so they don't dangle at the far left.
 */
export function assignRanks(n: number, edges: IndexedEdge[], back: boolean[], hintRank: (number | undefined)[]): number[] {
  const preds: number[][] = Array.from({ length: n }, () => []);
  const succs: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array<number>(n).fill(0);
  edges.forEach((e, i) => {
    if (back[i]) return;
    preds[e.t]!.push(e.s);
    succs[e.s]!.push(e.t);
    indeg[e.t]!++;
  });
  // Kahn's algorithm, smallest index first (deterministic).
  const topo: number[] = [];
  const ready: number[] = [];
  for (let v = 0; v < n; v++) if (indeg[v] === 0) ready.push(v);
  const heap = new MinHeap();
  for (const v of ready) heap.push(v, v);
  while (heap.size) {
    const v = heap.pop();
    topo.push(v);
    for (const w of succs[v]!) if (--indeg[w]! === 0) heap.push(w, w);
  }
  const rank = new Array<number>(n).fill(0);
  for (const v of topo) {
    let r = hintRank[v] ?? 0;
    for (const u of preds[v]!) r = Math.max(r, rank[u]! + 1);
    rank[v] = r;
  }
  for (let k = topo.length - 1; k >= 0; k--) {
    const v = topo[k]!;
    if (preds[v]!.length || hintRank[v] !== undefined || !succs[v]!.length) continue;
    let m = Infinity;
    for (const w of succs[v]!) m = Math.min(m, rank[w]!);
    rank[v] = Math.max(rank[v]!, m - 1);
  }
  return rank;
}

/** Longest path (in edges) from each node to a sink, over non-back edges. */
export function heights(n: number, edges: IndexedEdge[], back: boolean[], rank: number[]): number[] {
  const byRankDesc = Array.from({ length: n }, (_, i) => i).sort((a, b) => rank[b]! - rank[a]! || a - b);
  const succs: number[][] = Array.from({ length: n }, () => []);
  edges.forEach((e, i) => {
    if (!back[i]) succs[e.s]!.push(e.t);
  });
  const h = new Array<number>(n).fill(0);
  for (const v of byRankDesc) for (const w of succs[v]!) h[v] = Math.max(h[v]!, h[w]! + 1);
  return h;
}

/** A small binary min-heap of integers keyed by numbers. */
export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.vals.length;
  }
  push(val: number, key: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = v.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! <= key) break;
      k[i] = k[p]!;
      v[i] = v[p]!;
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0]!;
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    const n = v.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r]! < k[l]! ? r : l;
        if (k[c]! >= lastK) break;
        k[i] = k[c]!;
        v[i] = v[c]!;
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return top;
  }
}
