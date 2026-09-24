// Orthogonal edge router: A* over a sparse grid of "interesting" lines (box margins, centres, ports, and evenly
// spaced channel tracks), in abstract coordinates (x = along the flow, y = across it).
//
// Rules the search enforces:
// - a move never crosses the interior of any box (including the edge's own source and target);
// - a move inside a box's margin zone (MARGIN px around it) is allowed only for the edge's own source or target box,
//   and only along the line of one of its own ports, so edges leave and enter boxes perpendicularly and never hug
//   another box;
// - an edge starts at a start port moving outward and ends at a goal port moving inward.
// Costs: length, a penalty per bend, crossings, running on a track another edge already uses (parallel edges get
// their own track), touching another edge's corner, passing under a placed edge label, and the lane-header strip.

import { MinHeap } from './graphalg';

export interface RBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Direction codes: 0 = +x, 1 = -x, 2 = +y, 3 = -y. */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [1, -1, 0, 0] as const;
export const DY = [0, 0, 1, -1] as const;
export const OPP: readonly Dir[] = [1, 0, 3, 2];

/** A port: a point on a box boundary; `dir` points out of the box. `cost` is a preference penalty. */
export interface Port {
  x: number;
  y: number;
  dir: Dir;
  cost: number;
  /** Opaque tag handed back to the caller (for example which side / slot this is). */
  tag?: number;
}

export interface RouteRequest {
  src: number;
  tgt: number;
  starts: Port[];
  goals: Port[];
}

export interface RouteResult {
  points: [number, number][];
  start: Port;
  goal: Port;
  /** false when the route needed a fallback search (crossing other boxes' margins, or interiors when walled in). */
  clean: boolean;
}

export const MARGIN = 8;
const NEAR = 18; // routes running parallel within this distance of a box (outside MARGIN) pay NEAR_PER_PX
const NEAR_PER_PX = 1.5;
const TRACK = 12; // spacing of channel tracks
const MAX_TRACKS = 4; // channel tracks added inside one gap between interesting lines
const H_WEIGHT = 1.1; // weighted A*: slightly greedy, far fewer expansions
const BEND = 36;
const CROSS = 24;
const TOUCH = 80;
const OVERLAP_FLAT = 60;
const OVERLAP_PER_PX = 8;
const LABEL_PER_PX = 6;
const LABEL_FLAT = 40;
const BORDER_PER_PX = 2; // running along a lane border
const HEADER_PER_PX = 4;
const RELAX_HARD = 300; // relaxed search only: per grid step through a box (still far dearer than going round)
const RELAX_SOFT = 40; // tight and relaxed searches: stepping into another box's margin zone
const NEAR_OPT_BUDGET = 40000; // pops for the near-optimal first attempt (enough for ordinary edges)
const STRICT_BUDGET = 100000; // pops for the greedier strict attempts
// Time bound for pathological inputs (hundreds of scattered pins, very long edges): once a layout has spent this many
// pops in total, the remaining searches turn greedy. Ordinary diagrams of 150 nodes use a fraction of it.
const TOTAL_SOFT = 1500000;
const GREEDY = 8; // near best-first: relaxed searches, and everything once a layout has used TOTAL_SOFT pops

export interface RouterOptions {
  /** Diagram bounds in abstract coordinates; routes stay inside. */
  width: number;
  height: number;
  /** Lane boundaries (y values) that routes should not run along. */
  laneBorders: number[];
  /** Routes pay extra for running inside x < headerEnd (the lane-label strip). */
  headerEnd: number;
  /** Extra coordinates that must be grid lines (ports). */
  xs: number[];
  ys: number[];
}

export class Router {
  readonly xs: number[];
  readonly ys: number[];
  private nx: number;
  private ny: number;
  private hardH: Int32Array;
  private hardV: Int32Array;
  private softAH: Int32Array;
  private softBH: Int32Array;
  private softAV: Int32Array;
  private softBV: Int32Array;
  private useH: Uint16Array; // edges already routed along each horizontal grid edge
  private useV: Uint16Array;
  private ptH: Uint16Array; // routed horizontal segments through each point
  private ptV: Uint16Array;
  private labelH: Uint8Array;
  private nearH: Uint8Array; // grid edge runs close alongside some box
  private nearV: Uint8Array;
  private labelV: Uint8Array;
  private rowExtra: Float64Array; // per y line: cost per px for horizontal moves along it
  private colExtra: Float64Array; // per x line: cost per px for vertical moves along it
  // A* scratch
  private g: Float64Array;
  private parent: Int32Array;
  private stamp: Int32Array;
  private closed: Int32Array;
  private gen = 0;
  private pops = 0;

  constructor(private boxes: RBox[], opts: RouterOptions) {
    const xset = new Set<number>();
    const yset = new Set<number>();
    const W = opts.width;
    const H = opts.height;
    const addX = (v: number) => {
      if (v >= 0 && v <= W) xset.add(Math.round(v));
    };
    const addY = (v: number) => {
      if (v >= 0 && v <= H) yset.add(Math.round(v));
    };
    addX(2);
    addX(W - 2);
    addY(2);
    addY(H - 2);
    // Only the margin lines around each box are grid lines (plus ports and channel tracks); grid edges are classified
    // by whether their span overlaps a box, which is exact without lines on the box sides.
    for (const b of boxes) {
      addX(b.x - MARGIN);
      addX(b.x + b.w + MARGIN);
      addY(b.y - MARGIN);
      addY(b.y + b.h + MARGIN);
    }
    for (const v of opts.xs) addX(v);
    for (const v of opts.ys) addY(v);
    for (const v of opts.laneBorders) {
      addY(v - 12);
      addY(v + 12);
    }
    this.xs = subdivide([...xset].sort((a, b) => a - b));
    this.ys = subdivide([...yset].sort((a, b) => a - b));
    const nx = (this.nx = this.xs.length);
    const ny = (this.ny = this.ys.length);
    const n = nx * ny;
    this.hardH = new Int32Array(n).fill(-1);
    this.hardV = new Int32Array(n).fill(-1);
    this.softAH = new Int32Array(n).fill(-1);
    this.softBH = new Int32Array(n).fill(-1);
    this.softAV = new Int32Array(n).fill(-1);
    this.softBV = new Int32Array(n).fill(-1);
    this.useH = new Uint16Array(n);
    this.useV = new Uint16Array(n);
    this.ptH = new Uint16Array(n);
    this.ptV = new Uint16Array(n);
    this.labelH = new Uint8Array(n);
    this.nearH = new Uint8Array(n);
    this.nearV = new Uint8Array(n);
    this.labelV = new Uint8Array(n);
    this.rowExtra = new Float64Array(ny);
    this.colExtra = new Float64Array(nx);
    for (let j = 0; j < ny; j++) {
      const y = this.ys[j]!;
      if (opts.laneBorders.some((b) => Math.abs(b - y) <= 3)) this.rowExtra[j] = BORDER_PER_PX;
      if (y <= 3 || y >= H - 3) this.rowExtra[j] = BORDER_PER_PX;
    }
    for (let i = 0; i < nx; i++) {
      const x = this.xs[i]!;
      if (x < opts.headerEnd) this.colExtra[i] = HEADER_PER_PX;
      if (x <= 3 || x >= W - 3) this.colExtra[i] = BORDER_PER_PX;
    }
    boxes.forEach((b) => this.markNear(b));
    boxes.forEach((b, bi) => this.markBox(b, bi));
    this.g = new Float64Array(n * 4);
    this.parent = new Int32Array(n * 4);
    this.stamp = new Int32Array(n * 4);
    this.closed = new Int32Array(n * 4);
  }

  /** Flags grid edges running alongside a box in the band between MARGIN and NEAR. */
  private markNear(b: RBox): void {
    const { xs, ys, nx } = this;
    const x0 = b.x - NEAR;
    const x1 = b.x + b.w + NEAR;
    const y0 = b.y - NEAR;
    const y1 = b.y + b.h + NEAR;
    for (let j = lowerBound(ys, y0); j < ys.length && ys[j]! <= y1; j++) {
      const y = ys[j]!;
      const band = (y >= y0 && y <= b.y - MARGIN) || (y >= b.y + b.h + MARGIN && y <= y1);
      if (!band) continue;
      for (let i = Math.max(0, lowerBound(xs, b.x) - 1); i + 1 < xs.length && xs[i]! < b.x + b.w; i++) {
        if (xs[i + 1]! > b.x) this.nearH[i + j * nx] = 1;
      }
    }
    for (let i = lowerBound(xs, x0); i < xs.length && xs[i]! <= x1; i++) {
      const x = xs[i]!;
      const band = (x >= x0 && x <= b.x - MARGIN) || (x >= b.x + b.w + MARGIN && x <= x1);
      if (!band) continue;
      for (let j = Math.max(0, lowerBound(ys, b.y) - 1); j + 1 < ys.length && ys[j]! < b.y + b.h; j++) {
        if (ys[j + 1]! > b.y) this.nearV[i + j * nx] = 1;
      }
    }
  }

  private markBox(b: RBox, bi: number): void {
    const { xs, ys, nx } = this;
    const sx0 = b.x - MARGIN;
    const sx1 = b.x + b.w + MARGIN;
    const sy0 = b.y - MARGIN;
    const sy1 = b.y + b.h + MARGIN;
    // Horizontal grid edges on line ys[j] spanning (xs[i], xs[i+1]): inside the margin zone when the line is strictly
    // inside it and the span overlaps it; inside the box when the line is strictly inside the box and the span
    // overlaps the box.
    const i0 = Math.max(0, lowerBound(xs, sx0) - 1);
    for (let j = lowerBound(ys, sy0); j < ys.length && ys[j]! < sy1; j++) {
      const y = ys[j]!;
      if (y <= sy0) continue;
      const inY = y > b.y && y < b.y + b.h;
      for (let i = i0; i + 1 < xs.length && xs[i]! < sx1; i++) {
        if (xs[i + 1]! <= sx0) continue;
        const p = i + j * nx;
        if (inY && xs[i]! < b.x + b.w && xs[i + 1]! > b.x) this.hardH[p] = this.hardH[p] === -1 ? bi : -2;
        else mark(this.softAH, this.softBH, p, bi);
      }
    }
    const j0 = Math.max(0, lowerBound(ys, sy0) - 1);
    for (let i = lowerBound(xs, sx0); i < xs.length && xs[i]! < sx1; i++) {
      const x = xs[i]!;
      if (x <= sx0) continue;
      const inX = x > b.x && x < b.x + b.w;
      for (let j = j0; j + 1 < ys.length && ys[j]! < sy1; j++) {
        if (ys[j + 1]! <= sy0) continue;
        const p = i + j * nx;
        if (inX && ys[j]! < b.y + b.h && ys[j + 1]! > b.y) this.hardV[p] = this.hardV[p] === -1 ? bi : -2;
        else mark(this.softAV, this.softBV, p, bi);
      }
    }
  }

  /** Marks a placed edge label (abstract coordinates) so later routes avoid running under it. */
  addLabel(r: RBox): void {
    const { xs, ys, nx } = this;
    const x0 = r.x - 2;
    const x1 = r.x + r.w + 2;
    const y0 = r.y - 2;
    const y1 = r.y + r.h + 2;
    for (let j = lowerBound(ys, y0); j < ys.length && ys[j]! <= y1; j++) {
      for (let i = Math.max(0, lowerBound(xs, x0) - 1); i + 1 < xs.length && xs[i]! <= x1; i++) {
        const mx = (xs[i]! + xs[i + 1]!) / 2;
        if (mx >= x0 && mx <= x1) this.labelH[i + j * nx] = 1;
      }
    }
    for (let i = lowerBound(xs, x0); i < xs.length && xs[i]! <= x1; i++) {
      for (let j = Math.max(0, lowerBound(ys, y0) - 1); j + 1 < ys.length && ys[j]! <= y1; j++) {
        const my = (ys[j]! + ys[j + 1]!) / 2;
        if (my >= y0 && my <= y1) this.labelV[i + j * nx] = 1;
      }
    }
  }

  route(req: RouteRequest): RouteResult {
    const box = this.boxes;
    const s = box[req.src]!;
    const t = box[req.tgt]!;
    // Search window: the two boxes plus room to go around; widened, then unlimited, if that fails.
    const minX = Math.min(s.x, t.x);
    const maxX = Math.max(s.x + s.w, t.x + t.w);
    const minY = Math.min(s.y, t.y);
    const maxY = Math.max(s.y + s.h, t.y + t.h);
    // Search ladder. Long edges through busy areas are expensive for (near-)optimal A* because crossing and track
    // penalties aren't in the estimate, so the weight escalates: near-optimal with a small budget, then greedier.
    // All of these keep margins (strict). If a port is walled in by boxes closer than two margins (pins), a "tight"
    // search may cross other boxes' margins at a cost, never an interior (L7 holds). Only an enclosed port (inside
    // overlapping pins, which L7 exempts) falls through to the relaxed search that may cross interiors.
    const win = (pad: number) => [minX - pad, minY - pad, maxX + pad, maxY + pad];
    const span = maxX - minX + maxY - minY;
    // Walled in (inside overlapping or crowded pins)? A bounded flood from each end tells cheaply.
    const walled = this.walledIn(req.starts) || this.walledIn(req.goals);
    if (!walled) {
      const r =
        (span < 1500 ? this.search(req, 0, win(160), NEAR_OPT_BUDGET, 0) : null) ??
        this.search(req, 0, null, STRICT_BUDGET, 3) ??
        this.search(req, 0, null, STRICT_BUDGET * 3, 8) ??
        this.search(req, 1, null, STRICT_BUDGET * 3, 8);
      if (r) return r;
    }
    return this.search(req, 2, null, Infinity, GREEDY)!;
  }

  /**
   * True when every port in `ports` sits in a small pocket (a few thousand grid points) that box interiors close
   * off, even allowing other boxes' margins: then no route can avoid crossing a box.
   */
  private walledIn(ports: Port[]): boolean {
    const { xs, ys, nx, ny } = this;
    const LIMIT = 4000;
    for (const p of ports) {
      const i0 = indexOf(xs, p.x);
      const j0 = indexOf(ys, p.y);
      if (i0 < 0 || j0 < 0) continue;
      const start = i0 + j0 * nx;
      const seen = new Set<number>([start]);
      const queue = [start];
      let escaped = false;
      while (queue.length && !escaped) {
        const q = queue.pop()!;
        const i = q % nx;
        const j = (q - i) / nx;
        for (let d = 0; d < 4; d++) {
          const ni = i + DX[d]!;
          const nj = j + DY[d]!;
          if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
          const r = ni + nj * nx;
          if (seen.has(r)) continue;
          const e = Math.min(q, r);
          if ((d < 2 ? this.hardH[e] : this.hardV[e]) !== -1) continue;
          seen.add(r);
          queue.push(r);
          if (seen.size > LIMIT) {
            escaped = true;
            break;
          }
        }
      }
      if (escaped) return false;
    }
    return true;
  }

  private search(req: RouteRequest, mode: 0 | 1 | 2, win: number[] | null, budget: number, weight: number): RouteResult | null {
    const relaxed = mode === 2;
    const { xs, ys, nx, ny } = this;
    const gen = ++this.gen;
    const g = this.g;
    const parent = this.parent;
    const stamp = this.stamp;
    const closed = this.closed;
    let i0 = 0;
    let i1 = nx - 1;
    let j0 = 0;
    let j1 = ny - 1;
    if (win) {
      i0 = Math.max(0, lowerBound(xs, win[0]!) - 1);
      j0 = Math.max(0, lowerBound(ys, win[1]!) - 1);
      i1 = Math.min(nx - 1, lowerBound(xs, win[2]!));
      j1 = Math.min(ny - 1, lowerBound(ys, win[3]!));
    }
    // Lines along which the own boxes' margin zones may be crossed: [box, axis(0=h,1=v), line index].
    const own: number[] = [];
    const ports = [...req.starts.map((p) => [req.src, p] as const), ...req.goals.map((p) => [req.tgt, p] as const)];
    for (const [b, p] of ports) {
      if (p.dir < 2) own.push(b, 0, indexOf(ys, p.y));
      else own.push(b, 1, indexOf(xs, p.x));
    }
    const ownOK = (b: number, axis: number, line: number): boolean => {
      for (let k = 0; k < own.length; k += 3) if (own[k] === b && own[k + 1] === axis && own[k + 2] === line) return true;
      return false;
    };
    const goalAt = new Map<number, Port[]>();
    for (const gp of req.goals) {
      const p = indexOf(xs, gp.x) + indexOf(ys, gp.y) * nx;
      let l = goalAt.get(p);
      if (!l) goalAt.set(p, (l = []));
      l.push(gp);
    }
    const goalList = req.goals.map((gp) => [gp.x, gp.y, OPP[gp.dir]!, gp.cost] as const);
    /** Distance to the nearest goal (for the search weight). */
    const hdist = (x: number, y: number): number => {
      let m = Infinity;
      for (const [gx, gy] of goalList) m = Math.min(m, Math.abs(gx - x) + Math.abs(gy - y));
      return m;
    };
    /** Admissible estimate: distance + a lower bound on the bends still needed + the goal's preference cost. */
    const hfun = (x: number, y: number, d: Dir): number => {
      let m = Infinity;
      for (const [gx, gy, a, c] of goalList) {
        const v = Math.abs(gx - x) + Math.abs(gy - y) + BEND * minBends(gx - x, gy - y, d, a) + c;
        if (v < m) m = v;
      }
      return m;
    };
    let span = 0;
    for (const sp of req.starts) span = Math.max(span, hdist(sp.x, sp.y));
    // Weighted A*: near-optimal for short edges, greedier for long ones (they cross busy areas where exact search
    // would explore most of the diagram).
    const base = weight || (relaxed ? GREEDY : H_WEIGHT + Math.min(0.9, span / 3000));
    const hw = this.pops > TOTAL_SOFT ? Math.max(base, GREEDY) : base;
    const heap = new MinHeap();
    const push = (st: number, gv: number, par: number, x: number, y: number) => {
      if (stamp[st] === gen && (g[st]! <= gv || closed[st] === gen)) return; // never reopen: keeps parents acyclic
      stamp[st] = gen;
      g[st] = gv;
      parent[st] = par;
      // f = g + h + (hw - 1) * distance, with h the admissible estimate for the best goal.
      const d = (st & 3) as Dir;
      let h = Infinity;
      let dist = Infinity;
      for (let k = 0; k < goalList.length; k++) {
        const gl = goalList[k]!;
        const dx = gl[0] - x;
        const dy = gl[1] - y;
        const m = Math.abs(dx) + Math.abs(dy);
        const v = m + BEND * minBends(dx, dy, d, gl[2]) + gl[3];
        if (v < h) h = v;
        if (m < dist) dist = m;
      }
      heap.push(st, (gv + h + (hw - 1) * dist) * 4096 + Math.min(h, 4095));
    };
    const startOf = new Map<number, Port>();
    for (const sp of req.starts) {
      const i = indexOf(xs, sp.x);
      const j = indexOf(ys, sp.y);
      if (i < 0 || j < 0) continue;
      const st = (i + j * nx) * 4 + sp.dir;
      startOf.set(st, sp);
      push(st, sp.cost, -1, sp.x, sp.y);
    }
    let best = Infinity;
    let bestState = -1;
    let bestGoal: Port | null = null;
    const src = req.src;
    const tgt = req.tgt;
    while (heap.size) {
      const st = heap.pop();
      this.pops++;
      if (--budget < 0) return null;
      if (closed[st] === gen) continue;
      closed[st] = gen;
      const gv = g[st]!;
      const p = st >> 2;
      const d = (st & 3) as Dir;
      const i = p % nx;
      const j = (p - i) / nx;
      const px = xs[i]!;
      const py = ys[j]!;
      if (gv + hfun(px, py, d) >= best) break; // (unweighted: stop once no path can beat the best found)
      const goals = parent[st] === -1 ? undefined : goalAt.get(p);
      if (goals) {
        for (const gp of goals) {
          if (OPP[gp.dir] !== d) continue;
          if (gv + gp.cost < best) {
            best = gv + gp.cost;
            bestState = st;
            bestGoal = gp;
          }
        }
        continue; // a goal sits on its box boundary; nothing useful lies beyond it
      }
      for (let nd = 0 as Dir; nd < 4; nd = (nd + 1) as Dir) {
        if (nd === OPP[d]) continue;
        const bend = nd !== d;
        if (bend && parent[st] === -1) continue; // leave a start port straight out
        const ni = i + DX[nd];
        const nj = j + DY[nd];
        if (ni < i0 || ni > i1 || nj < j0 || nj > j1) continue;
        const q = ni + nj * nx;
        const horiz = nd < 2;
        const e = horiz ? (nd === 0 ? p : q) : nd === 2 ? p : q; // grid-edge index = lower/left endpoint
        let cost = 0;
        const len = horiz ? Math.abs(xs[ni]! - px) : Math.abs(ys[nj]! - py);
        let inOwn = false;
        const hard = horiz ? this.hardH[e]! : this.hardV[e]!;
        if (hard !== -1) {
          if (mode < 2) continue;
          cost += RELAX_HARD;
        }
        const sa = horiz ? this.softAH[e]! : this.softAV[e]!;
        if (sa !== -1) {
          const sb = horiz ? this.softBH[e]! : this.softBV[e]!;
          const axis = horiz ? 0 : 1;
          const line = horiz ? j : i;
          const okA = (sa === src || sa === tgt) && ownOK(sa, axis, line);
          const okB = sb === -1 || ((sb === src || sb === tgt) && ownOK(sb, axis, line));
          if (!okA || !okB) {
            if (mode === 0) continue;
            cost += RELAX_SOFT + 2 * len;
          } else inOwn = true;
        }
        cost += len * (1 + (horiz ? this.rowExtra[j]! : this.colExtra[i]!));
        if (bend) {
          cost += BEND;
          if (this.ptH[p]! || this.ptV[p]!) cost += TOUCH;
        }
        if (!inOwn) {
          const used = horiz ? this.useH[e]! : this.useV[e]!;
          if (used) cost += OVERLAP_FLAT + OVERLAP_PER_PX * len;
          if (horiz ? this.ptV[q]! : this.ptH[q]!) cost += CROSS;
          if (horiz ? this.labelH[e]! : this.labelV[e]!) cost += LABEL_FLAT + LABEL_PER_PX * len;
          if (horiz ? this.nearH[e]! : this.nearV[e]!) cost += NEAR_PER_PX * len;
        }
        const ng = gv + cost;
        const nst = q * 4 + nd;
        push(nst, ng, st, xs[ni]!, ys[nj]!);
      }
    }
    if (bestState < 0 || !bestGoal) return null;
    // Rebuild.
    const statePath: number[] = [];
    for (let st = bestState; st !== -1 && statePath.length <= nx * ny * 4; st = parent[st]!) statePath.push(st);
    statePath.reverse();
    const first = statePath[0]!;
    const start = startOf.get(first)!;
    const pts: [number, number][] = [];
    for (const st of statePath) {
      const p = st >> 2;
      const i = p % nx;
      const j = (p - i) / nx;
      pts.push([xs[i]!, ys[j]!]);
    }
    const points = mode === 2 ? simplify(pts) : this.straighten(simplify(pts), req);
    this.record(points);
    return { points, start, goal: bestGoal, clean: mode === 0 };
  }

  /** Walks a polyline along grid lines, calling `f(edgeIndex, horizontal, fromPoint, toPoint)` per grid step. */
  private walk(points: [number, number][], f: (e: number, horiz: boolean, p: number, q: number) => boolean): boolean {
    const { xs, ys, nx } = this;
    for (let k = 0; k + 1 < points.length; k++) {
      const [ax, ay] = points[k]!;
      const [bx, by] = points[k + 1]!;
      let i = indexOf(xs, ax);
      let j = indexOf(ys, ay);
      const ti = indexOf(xs, bx);
      const tj = indexOf(ys, by);
      if (i < 0 || j < 0 || ti < 0 || tj < 0) return false;
      if (ax !== bx && ay !== by) return false; // never walk a diagonal
      const horiz = ay === by;
      while (i !== ti || j !== tj) {
        const p = i + j * nx;
        if (horiz) i += ti > i ? 1 : -1;
        else j += tj > j ? 1 : -1;
        const q = i + j * nx;
        const e = horiz ? Math.min(p, q) : Math.min(p, q);
        if (!f(e, horiz, p, q)) return false;
      }
    }
    return true;
  }

  private record(points: [number, number][]): void {
    this.walk(points, (e, horiz, p, q) => {
      if (horiz) {
        this.useH[e] = Math.min(65535, this.useH[e]! + 1);
        this.ptH[p] = this.ptH[p]! + 1;
        this.ptH[q] = this.ptH[q]! + 1;
      } else {
        this.useV[e] = Math.min(65535, this.useV[e]! + 1);
        this.ptV[p] = this.ptV[p]! + 1;
        this.ptV[q] = this.ptV[q]! + 1;
      }
      return true;
    });
  }

  /** Is this polyline legal for the request (no box interiors, margins only on own port lines, no shared track)? */
  private legal(points: [number, number][], req: RouteRequest): boolean {
    const { xs, ys } = this;
    const portLines: [number, number, number][] = []; // [box, axis, coordinate]
    for (const p of req.starts) portLines.push([req.src, p.dir < 2 ? 0 : 1, p.dir < 2 ? p.y : p.x]);
    for (const p of req.goals) portLines.push([req.tgt, p.dir < 2 ? 0 : 1, p.dir < 2 ? p.y : p.x]);
    const own = (b: number, axis: number, c: number) => portLines.some(([pb, pa, pc]) => pb === b && pa === axis && pc === c);
    return this.walk(points, (e, horiz, p) => {
      if ((horiz ? this.hardH[e] : this.hardV[e]) !== -1) return false;
      const c = horiz ? ys[Math.floor(p / this.nx)]! : xs[p % this.nx]!;
      const axis = horiz ? 0 : 1;
      const sa = horiz ? this.softAH[e]! : this.softAV[e]!;
      const sb = horiz ? this.softBH[e]! : this.softBV[e]!;
      if (sb === -3) return false;
      for (const b of [sa, sb]) if (b !== -1 && !((b === req.src || b === req.tgt) && own(b, axis, c))) return false;
      const inOwn = sa !== -1;
      if (!inOwn && (horiz ? this.useH[e]! : this.useV[e]!)) return false;
      return true;
    });
  }

  /**
   * Removes jogs the weighted search leaves: slides an inner segment sideways until a neighbouring segment vanishes
   * (two bends fewer), when the result is still legal. The first and last segments (the port stubs) keep their
   * direction and at least MARGIN + 4 px of length.
   */
  private straighten(pts: [number, number][], req: RouteRequest): [number, number][] {
    let cur = pts;
    for (let guard = 0; guard < 40; guard++) {
      let improved = false;
      for (let k = 1; k + 2 < cur.length && !improved; k++) {
        // Segment k runs from cur[k] to cur[k+1]; its neighbours k-1 and k+1 are perpendicular to it.
        const a = cur[k]!;
        const b = cur[k + 1]!;
        const horiz = a[1] === b[1];
        for (const target of [cur[k - 1]!, cur[k + 2]!]) {
          const c = horiz ? target[1] : target[0];
          if (c === (horiz ? a[1] : a[0])) continue;
          const moved = cur.map((p) => [p[0], p[1]] as [number, number]);
          if (horiz) {
            moved[k]![1] = c;
            moved[k + 1]![1] = c;
          } else {
            moved[k]![0] = c;
            moved[k + 1]![0] = c;
          }
          const next = simplify(moved);
          if (next.length >= cur.length || next.length < 2 || !orthogonal(next)) continue;
          if (!stubOK(next, cur)) continue;
          if (!this.legal(next, req)) continue;
          cur = next;
          improved = true;
          break;
        }
      }
      if (!improved) break;
    }
    return cur;
  }
}

/**
 * Fewest bends a path can have from heading `d` to arrive heading `a` at an offset (dx, dy). Exact for 0/1/2, a lower
 * bound beyond (parity: same or opposite headings need an even count, perpendicular ones an odd count).
 */
export function minBends(dx: number, dy: number, d: Dir, a: Dir): number {
  const along = (dir: Dir) => (dir === 0 ? dx : dir === 1 ? -dx : dir === 2 ? dy : -dy); // progress along dir
  const side = (dir: Dir) => (dir < 2 ? dy : dx); // offset across dir
  if (d === a) return along(d) >= 0 && side(d) === 0 ? 0 : 2;
  if (d === OPP[a]) return 2;
  // Perpendicular: one bend (possibly right here) if the goal is not behind on d's axis and ahead on a's axis.
  return along(d) >= 0 && along(a) > 0 ? 1 : 3;
}

/** The first and last segments must keep their direction (out of / into the box) and some length. */
function stubOK(next: [number, number][], orig: [number, number][]): boolean {
  const dirOf = (p: [number, number], q: [number, number]) => [Math.sign(q[0] - p[0]), Math.sign(q[1] - p[1])].join();
  const len = (p: [number, number], q: [number, number]) => Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]);
  const n = next.length;
  const o = orig.length;
  if (next[0]![0] !== orig[0]![0] || next[0]![1] !== orig[0]![1]) return false;
  if (next[n - 1]![0] !== orig[o - 1]![0] || next[n - 1]![1] !== orig[o - 1]![1]) return false;
  if (dirOf(next[0]!, next[1]!) !== dirOf(orig[0]!, orig[1]!)) return false;
  if (dirOf(next[n - 2]!, next[n - 1]!) !== dirOf(orig[o - 2]!, orig[o - 1]!)) return false;
  if (n > 2 && (len(next[0]!, next[1]!) < MARGIN + 4 || len(next[n - 2]!, next[n - 1]!) < MARGIN + 4)) return false;
  return true;
}

function mark(a: Int32Array, b: Int32Array, p: number, bi: number): void {
  if (a[p] === -1) a[p] = bi;
  else if (a[p] === bi) return;
  else if (b[p] === -1) b[p] = bi;
  else if (b[p] !== bi) b[p] = -3; // three or more zones: never passable
}

/** Adds evenly spaced channel tracks inside every gap wider than two track spacings. */
function subdivide(sorted: number[]): number[] {
  const out: number[] = [];
  for (let k = 0; k < sorted.length; k++) {
    const a = sorted[k]!;
    out.push(a);
    const b = sorted[k + 1];
    if (b === undefined) break;
    const gap = b - a;
    if (gap >= 2 * TRACK) {
      const m = Math.min(MAX_TRACKS, Math.floor(gap / TRACK) - 1);
      for (let s = 1; s <= m; s++) out.push(Math.round(a + (gap * s) / (m + 1)));
    }
  }
  return [...new Set(out)].sort((x, y) => x - y);
}

export function lowerBound(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function indexOf(arr: number[], v: number): number {
  const i = lowerBound(arr, v);
  return arr[i] === v ? i : -1;
}

/** Drops repeated and collinear points (repeated until nothing changes, so the result has no collinear triple). */
export function simplify(pts: [number, number][]): [number, number][] {
  let cur = pts;
  for (;;) {
    const out: [number, number][] = [];
    for (const p of cur) {
      const last = out[out.length - 1];
      if (last && last[0] === p[0] && last[1] === p[1]) continue;
      if (out.length >= 2) {
        const a = out[out.length - 2]!;
        const b = out[out.length - 1]!;
        if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) {
          out[out.length - 1] = p;
          continue;
        }
      }
      out.push(p);
    }
    if (out.length === cur.length) return out;
    cur = out;
  }
}

function orthogonal(pts: [number, number][]): boolean {
  for (let k = 0; k + 1 < pts.length; k++) if (pts[k]![0] !== pts[k + 1]![0] && pts[k]![1] !== pts[k + 1]![1]) return false;
  return true;
}
