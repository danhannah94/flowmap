// The layout function (§6): places lanes, nodes and edges for `flowmap layout`, the SVG export and the UI.
//
// Pipeline (all deterministic, L10):
// 1. Sizes from measure.nodeSize; pins validated (a pin whose lane is stale is ignored, §5).
// 2. Strongly connected components; inside each, back edges picked by hinted rank or a DFS from the entry node.
// 3. Ranks (columns along the flow): longest path over the remaining DAG, never below a node's hinted rank. Edges
//    between different SCCs always go to a higher rank, which gives L5 for unpinned nodes.
// 4. Rows (tracks across the flow) inside each lane: a node takes its hinted row, else its main predecessor's row
//    (so a chain and a decision's main branch run straight), else the nearest free row.
// 5. Coordinates: columns and rows sized by their largest node (never smaller than the hinted size), nodes centred
//    in their cell; unpinned nodes that would collide with a pinned node slide across within their lane (L3, which
//    never disturbs L5); lanes grow to hold their nodes and pins (L1, L2, L4). Pins may be negative (a block dropped
//    before or above everything, v1.1 §5): all of this is computed in stored coordinates, then translated (§6 Frame,
//    `pinTranslation`) so the output starts at 0 and the first lane grows toward its start to hold its pins. A lane
//    with a stored size (A8) is at least that thick, measured from its zero line; with a stored lane length (A13), the
//    lanes are at least that long along the flow, measured from the flow axis's zero line (T after the start).
// 6. Ports per node side (decisions use their four corners), then the orthogonal A* router (router.ts), then edge
//    labels next to the source (L8).
// Everything from step 2 on works in abstract coordinates: x along the flow, y across it; the output maps them to
// real x/y for LR or TB.

import type {
  Direction, Graph, LayoutEdgeEntry, LayoutInput, LayoutResult, LayoutResultEdge, LayoutTextBox, Pin, ShapeKind, Side as RealSide,
} from '../types';
import { UNASSIGNED, isLaneFree, pinOf, sizeOf } from '../types';
import { effectiveSize, edgeLabelSize, noteSize, roundRadius, SHAPE_GEOMETRY, TITLE_FONT, titleSize } from '../measure';
import { portPoint } from '../shapes';
import { facingAbstract, pointAtFraction } from './geometry';

// Geometry the UI and the edit operations share with the layout (v1.1): polylines (UI36, UI37), lanes of points
// (§5), ports (§6 L12) and the stored frame of bend points.
export {
  polylineLength, pointAtFraction, projectOntoPolyline, mergePolyline, laneAt, nodePort, nodePorts, endAtPort,
  pointFromStored, storedFromPoint, facingAbstract, facingSide, type AbstractSide, type Point, type Frame,
} from './geometry';
import { stronglyConnected, backEdges, assignRanks, heights, type IndexedEdge } from './graphalg';
import { readHints, type Hints } from './hints';
import { Router, MARGIN, type Dir, type Port, type RBox } from './router';

/**
 * Length along the flow of the strip at the start of every lane that holds its label. Nodes start after it. A
 * lane-free diagram (amendment A4) draws no header, so it reserves no strip: see `headerLength`.
 */
export const LANE_HEADER = 40;
/** Minimum lane thickness across the flow (L1). */
export const MIN_LANE = 100;
const LEAD = 32; // along gap between the header strip (or the diagram's start) and the first column
const END_MARGIN = 48;
const LANE_PAD = 24; // across padding inside a lane (L2 requires 12)
const ROW_GAP = 44; // across gap between rows of one lane
const COL_GAP = 72; // minimum along gap between columns (room for a yes/no label without widening)
const CLEAR = 24; // clearance kept between an unpinned node and a pinned one (L3 requires 16)
const PIN_PAD = 16; // room a lane keeps after a pinned node
const LABEL_REACH = 58; // label centres stay this close to the source box (L8 allows 60)
const ALT_SIDE = 90; // router cost of using a side other than the planned one

/** Length along the flow of the lane-label strip in a layout: LANE_HEADER, or 0 for a lane-free diagram (A4). */
export function headerLength(layout: Pick<LayoutResult, 'lanes'>): number {
  return isLaneFree(layout.lanes) ? 0 : LANE_HEADER;
}

/**
 * The layout's frame (v1.1 §6 Frame): how stored pin positions are translated so the output starts at 0. `along` is
 * T = max(0, −(smallest applied pin `along`)), added to every flow-axis position. `across` is U = max(0, −(smallest
 * applied `across` in the first displayed lane `firstLane`)): the first lane's zero line lies U after its start edge
 * and the lane is U thicker; every other lane's zero line is its start edge (their `across` is never negative, §5).
 * Both 0 when nothing is negative (every v1.0 file), which leaves the output unchanged. `pins`: the pins that apply.
 */
export interface Translation {
  along: number;
  across: number;
}

export function pinTranslation(pins: Iterable<Partial<Pin>>, firstLane: string | undefined): Translation {
  let along = 0;
  let across = 0;
  for (const p of pins) {
    // A layout-file entry may hold only a size (v1.1): it has no pin and doesn't count.
    if (p.lane === undefined || p.along === undefined || p.across === undefined) continue;
    along = Math.max(along, -p.along);
    if (p.lane === firstLane) across = Math.max(across, -p.across);
  }
  return { along: along + 0, across: across + 0 };
}

export interface LayoutOutput {
  result: LayoutResult;
  hints: unknown;
  /**
   * The frame (§6) this layout used: T (`along`) and U (`across`), from the applied pins and bend points. Output =
   * stored + T on the flow axis; in the first lane (and for notes and the title) + U across. Ops that turn an output
   * position back into a stored one subtract it.
   */
  translation: Translation;
  /**
   * A8: how thick each lane's band would be across the flow without its stored size, by lane id: what its content
   * needs (never less than L1's 100, and including U for the first lane). A lane can't be dragged thinner than this.
   */
  laneNeeds: Record<string, number>;
  /**
   * A13: how long the lanes would be along the flow without the stored lane length: what the content needs (the
   * diagram's flow-axis length, T included). The pool's far edge can't be dragged shorter than this.
   */
  laneLengthNeed: number;
}

/** Room between the title's bottom and the diagram's top, and the title's default top: as the UI has drawn it. */
export const TITLE_GAP = 18;
/** Gap between the diagram's bottom and the default row of notes, and between notes in that row. */
export const NOTE_GAP = 24;

interface N {
  i: number;
  id: string;
  label: string;
  kind: ShapeKind;
  laneId: string;
  lane: number;
  sa: number; // size along the flow
  sc: number; // size across the flow
  pinned: boolean;
  pinA: number;
  pinC: number;
  rank: number;
  row: number;
  x: number; // abstract box: x along, y across (absolute)
  y: number;
  c: number; // across offset inside the lane
}

interface E {
  i: number;
  id: string;
  s: number;
  t: number;
  label: string | null;
  /** v1.1 (§5): stored sides (real names), applied bend points (stored frame), `label_at`. */
  srcSide: RealSide | null;
  tgtSide: RealSide | null;
  points: Pin[] | null;
  labelAt: number | null;
}

/** v1.0-style entry point: the graph, the pins that apply and the hints; no v1.1 placements, notes or title. */
export function layout(graph: Graph, pins: Record<string, Pin>, hintsIn?: unknown): LayoutOutput {
  return layoutDiagram({ graph, file: { version: 1, nodes: pins, hints: hintsIn } });
}

/** Real side names from abstract side codes, per direction (abstract: 0 = +along, 1 = -along, 2 = +across, 3 = -across). */
const REAL_SIDE: Record<Direction, RealSide[]> = { LR: ['right', 'left', 'bottom', 'top'], TB: ['bottom', 'top', 'right', 'left'] };
const absSide = (dir: Direction, s: RealSide): Side => REAL_SIDE[dir].indexOf(s) as Side;

/** The layout function (§6): the graph plus everything placed or shaped by hand (§5), the notes and the title. */
export function layoutDiagram(input: LayoutInput): LayoutOutput {
  const { graph } = input;
  const file = input.file;
  const fileNodes = file?.nodes ?? {};
  const fileEdges: Record<string, LayoutEdgeEntry> = file?.edges ?? {};
  const dir: Direction = graph.direction === 'TB' ? 'TB' : 'LR';
  const hints = readHints(file?.hints);
  const sizesValid = hints !== null && hints.dir === dir;

  // ---- Lanes (display order from the graph; defensive about stray lane ids; _unassigned last).
  const laneList: { id: string; label: string }[] = [];
  const laneIdx = new Map<string, number>();
  const addLane = (id: string, label: string) => {
    if (laneIdx.has(id)) return;
    laneIdx.set(id, laneList.length);
    laneList.push({ id, label });
  };
  for (const l of graph.lanes) if (l.id !== UNASSIGNED) addLane(l.id, l.label);
  for (const n of graph.nodes) if (n.lane !== UNASSIGNED && !laneIdx.has(n.lane)) addLane(n.lane, n.lane);
  const unassignedLabel = graph.lanes.find((l) => l.id === UNASSIGNED)?.label ?? 'Unassigned';
  if (graph.lanes.some((l) => l.id === UNASSIGNED) || graph.nodes.some((n) => n.lane === UNASSIGNED)) {
    addLane(UNASSIGNED, unassignedLabel);
  }
  // Amendment A4: no subgraphs means no lane labels, so no header strip; the first column moves up to the start.
  const head = isLaneFree(laneList) ? 0 : LANE_HEADER;

  // ---- Nodes.
  const byId = new Map<string, number>();
  const nodes: N[] = graph.nodes.map((gn, i) => {
    byId.set(gn.id, i);
    const entry = Object.prototype.hasOwnProperty.call(fileNodes, gn.id) ? fileNodes[gn.id] : undefined;
    const size = effectiveSize(gn.label, gn.kind, sizeOf(entry)); // §5: max(stored, what the label needs)
    const pin = pinOf(entry);
    const pinned = !!pin && pin.lane === gn.lane && Number.isFinite(pin.along) && Number.isFinite(pin.across);
    return {
      i, id: gn.id, label: gn.label, kind: gn.kind, laneId: gn.lane, lane: laneIdx.get(gn.lane)!,
      sa: dir === 'LR' ? size.width : size.height,
      sc: dir === 'LR' ? size.height : size.width,
      pinned,
      pinA: pinned ? Math.round(pin!.along) : 0,
      pinC: pinned ? Math.round(pin!.across) : 0,
      rank: 0, row: -1, x: 0, y: 0, c: 0,
    };
  });
  const edges: E[] = [];
  graph.edges.forEach((ge, i) => {
    const s = byId.get(ge.source);
    const t = byId.get(ge.target);
    if (s === undefined || t === undefined) return;
    const entry = Object.prototype.hasOwnProperty.call(fileEdges, ge.id) ? fileEdges[ge.id] : undefined;
    const valid = (x: unknown): x is RealSide => x === 'top' || x === 'right' || x === 'bottom' || x === 'left';
    // §5: a line with points is manual, unless a point's lane no longer exists (then its points are ignored).
    const pts = entry?.points;
    const points = pts && pts.length > 0 && pts.every((p) => laneIdx.has(p.lane) && Number.isFinite(p.along) && Number.isFinite(p.across))
      ? pts.map((p) => ({ lane: p.lane, along: Math.round(p.along), across: Math.round(p.across) }))
      : null;
    const la = entry?.label_at;
    edges.push({
      i, id: ge.id, s, t, label: ge.label,
      srcSide: valid(entry?.source_side) ? entry.source_side : null,
      tgtSide: valid(entry?.target_side) ? entry.target_side : null,
      points,
      labelAt: typeof la === 'number' && Number.isFinite(la) ? Math.min(1, Math.max(0, la)) : null,
    });
  });
  // The frame (§6): negative pins and bend points translate along (everything), and across in the first lane.
  const shift = pinTranslation(
    [
      ...nodes.filter((v) => v.pinned).map((v) => ({ lane: v.laneId, along: v.pinA, across: v.pinC })),
      ...edges.flatMap((e) => e.points ?? []),
    ],
    laneList[0]?.id,
  );
  const FIRST = head + LEAD + shift.along; // along position of the first column
  const n = nodes.length;

  // ---- Ranks.
  const hintOf = (v: N) => {
    const h = hints?.n[v.id];
    return h && h[0] === v.laneId ? h : undefined;
  };
  const hintRank = nodes.map((v) => hints?.n[v.id]?.[1]);
  const ie: IndexedEdge[] = edges.map((e) => ({ s: e.s, t: e.t }));
  const comp = stronglyConnected(n, ie);
  const back = backEdges(n, ie, comp, hintRank);
  const rank = assignRanks(n, ie, back, hintRank);
  const height = heights(n, ie, back, rank);
  nodes.forEach((v) => (v.rank = rank[v.i]!));

  // ---- Rows inside lanes (unpinned nodes only).
  const fwdOut: number[][] = Array.from({ length: n }, () => []); // edge indices (into `edges`)
  const fwdIn: number[][] = Array.from({ length: n }, () => []);
  edges.forEach((e, k) => {
    if (back[k]) return;
    fwdOut[e.s]!.push(k);
    fwdIn[e.t]!.push(k);
  });
  // Main successor: the same-lane unpinned successor that continues the longest path (next rank first).
  const mainSucc = new Array<number>(n).fill(-1);
  for (const u of nodes) {
    let best = -1;
    let bestKey: number[] = [];
    for (const k of fwdOut[u.i]!) {
      const t = nodes[edges[k]!.t]!;
      if (t.pinned || u.pinned || t.lane !== u.lane) continue;
      const key = [t.rank === u.rank + 1 ? 1 : 0, height[t.i]!, -k];
      if (best < 0 || cmp(key, bestKey) > 0) {
        best = t.i;
        bestKey = key;
      }
    }
    mainSucc[u.i] = best;
  }
  const occupied = new Map<string, Set<number>>();
  const byRank = new Map<number, N[]>();
  for (const v of nodes) {
    if (v.pinned) continue;
    let l = byRank.get(v.rank);
    if (!l) byRank.set(v.rank, (l = []));
    l.push(v);
  }
  for (const r of [...byRank.keys()].sort((a, b) => a - b)) {
    const group = byRank.get(r)!.map((v) => {
      const h = hintOf(v);
      if (h && h[2] >= 0) return { v, want: h[2], strength: 3 };
      const preds = fwdIn[v.i]!.map((k) => nodes[edges[k]!.s]!).filter((u) => !u.pinned && u.lane === v.lane && u.row >= 0);
      const owner = preds.find((u) => mainSucc[u.i] === v.i);
      if (owner) return { v, want: owner.row, strength: 2 };
      if (preds.length) return { v, want: preds[0]!.row, strength: 1 };
      for (const k of fwdOut[v.i]!) {
        const t = nodes[edges[k]!.t]!;
        const th = hintOf(t);
        if (!t.pinned && t.lane === v.lane && th && th[2] >= 0) return { v, want: th[2], strength: 1 };
      }
      return { v, want: 0, strength: 0 };
    });
    group.sort((a, b) => b.strength - a.strength || a.want - b.want || a.v.i - b.v.i);
    for (const { v, want } of group) {
      const key = v.lane + ':' + r;
      let occ = occupied.get(key);
      if (!occ) occupied.set(key, (occ = new Set()));
      let row = want;
      for (let d = 0; ; d++) {
        if (!occ.has(want + d)) {
          row = want + d;
          break;
        }
        if (d > 0 && want - d >= 0 && !occ.has(want - d)) {
          row = want - d;
          break;
        }
      }
      occ.add(row);
      v.row = row;
    }
  }

  // ---- Columns along the flow.
  const maxRank = nodes.reduce((m, v) => Math.max(m, v.rank), 0);
  const colW = new Array<number>(maxRank + 1).fill(0);
  for (const v of nodes) if (!v.pinned) colW[v.rank] = Math.max(colW[v.rank]!, v.sa);
  if (sizesValid) hints!.cols.forEach((w, r) => r <= maxRank && (colW[r] = Math.max(colW[r]!, w)));
  // Gaps between columns: room for labels leaving a column and for the vertical runs of edges that change row.
  // Pinned nodes count too (by their rank and hinted row), so pinning a node never pulls later columns in.
  const need = new Array<number>(maxRank + 1).fill(COL_GAP);
  const bends = new Array<number>(maxRank + 1).fill(0);
  const rowOf = (v: N) => (v.pinned ? (hintOf(v)?.[2] ?? -1) : v.row);
  for (const e of edges) {
    const s = nodes[e.s]!;
    const t = nodes[e.t]!;
    if (e.label) {
      const lw = (dir === 'LR' ? edgeLabelSize(e.label).width : edgeLabelSize(e.label).height) + 28;
      need[s.rank] = Math.max(need[s.rank]!, Math.min(LABEL_REACH * 2, lw));
    }
    if (t.rank > s.rank && (t.lane !== s.lane || rowOf(t) !== rowOf(s))) bends[s.rank]!++;
  }
  const gapW = need.map((g, r) => Math.min(160, Math.max(g, 24 + 12 * bends[r]!)));
  if (sizesValid) hints!.gaps.forEach((g, r) => r <= maxRank && (gapW[r] = Math.max(gapW[r]!, g)));
  const colStart = new Array<number>(maxRank + 2).fill(FIRST);
  for (let r = 0; r <= maxRank; r++) colStart[r + 1] = colStart[r]! + (colW[r]! > 0 ? colW[r]! + gapW[r]! : 0);

  // ---- Rows across the flow, per lane.
  const L = laneList.length;
  const rowH: number[][] = Array.from({ length: L }, () => []);
  for (const v of nodes) {
    if (v.pinned) continue;
    const rh = rowH[v.lane]!;
    while (rh.length <= v.row) rh.push(0);
    rh[v.row] = Math.max(rh[v.row]!, v.sc);
  }
  if (sizesValid) {
    laneList.forEach((l, li) => {
      const hr = hints!.rows[l.id];
      if (!hr) return;
      const rh = rowH[li]!;
      hr.forEach((h, r) => {
        while (rh.length <= r) rh.push(0);
        rh[r] = Math.max(rh[r]!, h);
      });
      // Trailing rows kept only by hints are dropped: they would just leave empty space at the lane's end.
      while (rh.length && !nodes.some((v) => !v.pinned && v.lane === li && v.row === rh.length - 1)) rh.pop();
    });
  }
  const rowStart = rowH.map((rh) => {
    const out: number[] = [];
    let c = LANE_PAD;
    for (const h of rh) {
      out.push(c);
      c += h > 0 ? h + ROW_GAP : 0;
    }
    return out;
  });

  // ---- Lane-local placement, pins, and collisions with pins.
  const laneThick = new Array<number>(L).fill(MIN_LANE);
  for (let li = 0; li < L; li++) {
    const members = nodes.filter((v) => v.lane === li);
    const placed: { a: number; c: number; sa: number; sc: number }[] = [];
    for (const v of members) {
      if (!v.pinned) continue;
      v.x = v.pinA + shift.along;
      v.c = v.pinC;
      placed.push({ a: v.x, c: v.c, sa: v.sa, sc: v.sc });
      laneThick[li] = Math.max(laneThick[li]!, v.c + v.sc + PIN_PAD);
    }
    const free = members.filter((v) => !v.pinned).sort((a, b) => a.rank - b.rank || a.row - b.row || a.i - b.i);
    for (const v of free) {
      v.x = colStart[v.rank]! + Math.floor((colW[v.rank]! - v.sa) / 2);
      const want = rowStart[li]![v.row]! + Math.floor((rowH[li]![v.row]! - v.sc) / 2);
      v.c = slide(v.x, v.sa, v.sc, want, placed);
      placed.push({ a: v.x, c: v.c, sa: v.sa, sc: v.sc });
      laneThick[li] = Math.max(laneThick[li]!, v.c + v.sc + LANE_PAD);
    }
    // The first lane's across-zero line sits U after its start edge, so the lane grows toward its start.
    const u = li === 0 ? shift.across : 0;
    if (u > 0) {
      for (const v of members) v.c += u;
      laneThick[li] = laneThick[li]! + u;
    }
  }
  // Bend points are exact (L4) and belong to their lane's band (§5): the lane grows across to contain each one.
  let pointEnd = 0;
  for (const e of edges) {
    for (const p of e.points ?? []) {
      const li = laneIdx.get(p.lane)!;
      laneThick[li] = Math.max(laneThick[li]!, (li === 0 ? shift.across : 0) + p.across + 1);
      pointEnd = Math.max(pointEnd, p.along + shift.along + END_MARGIN);
    }
  }
  // A8: a stored lane size is a minimum, measured from the lane's zero line (U after its start edge in the first lane).
  const laneNeeds: Record<string, number> = {};
  const laneEntries = file?.lanes ?? {};
  laneList.forEach((l, li) => {
    laneNeeds[l.id] = laneThick[li]!;
    const stored = Object.prototype.hasOwnProperty.call(laneEntries, l.id) ? laneEntries[l.id]!.size : undefined;
    if (typeof stored === 'number' && Number.isFinite(stored)) {
      laneThick[li] = Math.max(laneThick[li]!, (li === 0 ? shift.across : 0) + Math.round(stored));
    }
  });
  const laneStart: number[] = [];
  let acc = 0;
  for (let li = 0; li < L; li++) {
    laneStart.push(acc);
    acc += laneThick[li]!;
  }
  const totalC = acc;
  let totalA = Math.max(FIRST + 160, pointEnd);
  for (const v of nodes) {
    v.y = laneStart[v.lane]! + v.c;
    totalA = Math.max(totalA, v.x + v.sa + END_MARGIN);
  }
  // A13: a stored lane length is a minimum, measured from the flow axis's zero line (T after the start), so the far
  // edge keeps its place relative to everything else when T changes. A lane-free diagram (A4) has no bands, so it
  // doesn't apply there (the file keeps it for when lanes come back).
  const laneLengthNeed = totalA;
  const storedLength = file?.lane_length;
  if (head > 0 && typeof storedLength === 'number' && Number.isFinite(storedLength)) {
    totalA = Math.max(totalA, shift.along + Math.round(storedLength));
  }

  // ---- Edges.
  const boxes: RBox[] = nodes.map((v) => ({ x: v.x, y: v.y, w: v.sa, h: v.sc }));
  // Bend points in abstract coordinates: exact (L4), from their lane's zero line (U in the first lane).
  const bendPts = edges.map((e) =>
    e.points
      ? e.points.map((p): [number, number] => {
        const li = laneIdx.get(p.lane)!;
        return [p.along + shift.along, laneStart[li]! + (li === 0 ? shift.across : 0) + p.across];
      })
      : null,
  );
  const routed = routeEdges(nodes, edges, boxes, mainSucc, height, back, dir, totalA, totalC, laneStart.slice(1), head, bendPts);

  // ---- Output in real coordinates.
  const P = (x: number, y: number): [number, number] => (dir === 'LR' ? [x, y] : [y, x]);
  const result: LayoutResult = {
    direction: dir,
    width: dir === 'LR' ? totalA : totalC,
    height: dir === 'LR' ? totalC : totalA,
    lanes: laneList.map((l, li) =>
      dir === 'LR'
        ? { id: l.id, label: l.label, x: 0, y: laneStart[li]!, width: totalA, height: laneThick[li]! }
        : { id: l.id, label: l.label, x: laneStart[li]!, y: 0, width: laneThick[li]!, height: totalA },
    ),
    nodes: nodes.map((v) => {
      const [x, y] = P(v.x, v.y);
      return {
        id: v.id, lane: v.laneId, kind: v.kind, label: v.label, x, y,
        width: dir === 'LR' ? v.sa : v.sc, height: dir === 'LR' ? v.sc : v.sa, pinned: v.pinned,
      };
    }),
    edges: graph.edges.map((ge, gi): LayoutResultEdge => {
      const r = routed.get(gi);
      return {
        id: ge.id, source: ge.source, target: ge.target, label: ge.label,
        points: r ? r.points.map(([x, y]) => P(x, y)) : [],
        label_pos: r && r.labelPos ? P(r.labelPos[0], r.labelPos[1]) : null,
        manual: r ? r.manual : false,
        source_side: r ? REAL_SIDE[dir][r.sides[0]]! : REAL_SIDE[dir][0]!,
        target_side: r ? REAL_SIDE[dir][r.sides[1]]! : REAL_SIDE[dir][1]!,
      };
    }),
  };

  // ---- Notes and the title (§6 "Notes and title"): outside L1–L8, in real x/y; the frame shifts them (T along the
  // flow, U across), stored or default. Defaults: the title above the diagram's top-left corner; unplaced notes in a
  // row below the diagram, in config order.
  const [sx, sy] = P(shift.along, shift.across);
  if (input.title !== undefined) {
    if (input.title === null) result.title = null;
    else {
      const size = titleSize(input.title);
      const at = file?.title ?? { x: 0, y: -(TITLE_FONT.lineHeight + TITLE_GAP) };
      result.title = { text: input.title, x: Math.round(at.x) + sx, y: Math.round(at.y) + sy, ...size };
    }
  }
  if (input.notes !== undefined) {
    const stored = file?.notes ?? {};
    let rowX = 0;
    result.notes = input.notes.map((note) => {
      const size = noteSize(note.text, note.font_size, note.bold);
      const at = Object.prototype.hasOwnProperty.call(stored, note.id) ? stored[note.id] : undefined;
      let box: LayoutTextBox;
      if (at) box = { text: note.text, x: Math.round(at.x) + sx, y: Math.round(at.y) + sy, ...size };
      else {
        box = { text: note.text, x: rowX + sx, y: result.height + NOTE_GAP, ...size };
        rowX += size.width + NOTE_GAP;
      }
      return { id: note.id, ...box };
    });
  }

  // ---- Hints out: ranks and rows of every node (pinned nodes keep the row they had), sizes as used.
  const hn: Hints['n'] = {};
  for (const v of nodes) {
    const prevRow = hints?.n[v.id]?.[0] === v.laneId ? hints.n[v.id]![2] : -1;
    hn[v.id] = [v.laneId, v.rank, v.pinned ? prevRow : v.row];
  }
  const hr: Hints['rows'] = {};
  laneList.forEach((l, li) => (hr[l.id] = rowH[li]!.slice()));
  const hintsOut: Hints = { v: 1, dir, n: hn, cols: colW.slice(), gaps: gapW.slice(), rows: hr };
  return { result, hints: hintsOut, translation: { along: shift.along, across: shift.across }, laneNeeds, laneLengthNeed };
}

/** Nearest across position to `want` (at least LANE_PAD... or 12 when crowded) that keeps CLEAR from placed boxes. */
function slide(a: number, sa: number, sc: number, want: number, placed: { a: number; c: number; sa: number; sc: number }[]): number {
  const near = placed.filter((p) => a < p.a + p.sa + CLEAR && p.a < a + sa + CLEAR);
  if (!near.length) return want;
  const hits = (c: number) => near.some((p) => c < p.c + p.sc + CLEAR && p.c < c + sc + CLEAR);
  if (!hits(want)) return want;
  const cands = new Set<number>();
  for (const p of near) {
    cands.add(p.c + p.sc + CLEAR);
    cands.add(p.c - CLEAR - sc);
  }
  const sorted = [...cands].filter((c) => c >= LANE_PAD).sort((x, y) => Math.abs(x - want) - Math.abs(y - want) || x - y);
  for (const c of sorted) if (!hits(c)) return c;
  return Math.max(...near.map((p) => p.c + p.sc + CLEAR)); // below everything: always free
}

function cmp(a: number[], b: number[]): number {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k]! - b[k]!;
  return 0;
}

// ============================================================================================================
// Ports and routing
// ============================================================================================================

interface Routed {
  points: [number, number][];
  labelPos: [number, number] | null;
  /** Abstract side codes used at the source and the target. */
  sides: [Side, Side];
  manual: boolean;
}

/** Side codes are router directions: 0 = forward (+x), 1 = back (-x), 2 = +y, 3 = -y. */
type Side = Dir;

function routeEdges(
  nodes: N[], edges: E[], boxes: RBox[], mainSucc: number[], height: number[], back: boolean[], dir: Direction,
  totalA: number, totalC: number, laneBorders: number[], headerEnd: number, bends: ([number, number][] | null)[],
): Map<number, Routed> {
  const cy = (b: RBox) => b.y + b.h / 2;
  const cx = (b: RBox) => b.x + b.w / 2;
  // v1.1: sides set in the layout file (abstract codes; null = the layout chooses), and manual lines (L11).
  const fixSrc = edges.map((e) => (e.srcSide ? absSide(dir, e.srcSide) : null));
  const fixTgt = edges.map((e) => (e.tgtSide ? absSide(dir, e.tgtSide) : null));
  const manual = edges.map((_, k) => bends[k] !== null);
  const ports = new PortGeometry(nodes, boxes, dir);

  // Natural sides for each edge from the geometry.
  const srcSide: Side[] = [];
  const tgtSide: Side[] = [];
  edges.forEach((e, k) => {
    const s = boxes[e.s]!;
    const t = boxes[e.t]!;
    if (e.s === e.t) {
      srcSide[k] = 0;
      tgtSide[k] = 3;
      return;
    }
    const dy = cy(t) - cy(s);
    const aligned = Math.abs(dy) <= 1;
    if (t.x >= s.x + s.w + 2 * MARGIN + 4) {
      srcSide[k] = 0;
      tgtSide[k] = 1;
    } else if (t.x + t.w <= s.x - 2 * MARGIN - 4) {
      // Going back against the flow: leave and enter across the flow, around the boxes in between.
      if (aligned) {
        srcSide[k] = 2;
        tgtSide[k] = 2;
      } else {
        srcSide[k] = dy < 0 ? 3 : 2;
        tgtSide[k] = dy < 0 ? 2 : 3;
      }
    } else {
      const down = dy > 0 || (dy === 0 && cx(t) >= cx(s));
      srcSide[k] = down ? 2 : 3;
      tgtSide[k] = down ? 3 : 2;
      if (s.y < t.y + t.h && t.y < s.y + s.h) {
        // Overlapping on both axes is only possible for pinned nodes; pick the open direction along the flow.
        srcSide[k] = cx(t) >= cx(s) ? 0 : 1;
        tgtSide[k] = cx(t) >= cx(s) ? 1 : 0;
      }
    }
  });

  // A set side is used as set; a manual line takes the side facing its first (last) bend point where none is set.
  edges.forEach((e, k) => {
    const pts = bends[k];
    if (pts) {
      srcSide[k] = fixSrc[k] ?? facingAbstract(boxes[e.s]!, pts[0]!);
      tgtSide[k] = fixTgt[k] ?? facingAbstract(boxes[e.t]!, pts[pts.length - 1]!);
      return;
    }
    if (fixSrc[k] !== null) srcSide[k] = fixSrc[k]!;
    if (fixTgt[k] !== null) tgtSide[k] = fixTgt[k]!;
  });
  // Ends whose side is decided already (set, or on a manual line): the layout's own choices work around them.
  const fixedEnd = (k: number, end: 0 | 1) => manual[k] || (end === 0 ? fixSrc[k] : fixTgt[k]) !== null;

  // Decisions: one edge per corner where possible. The straight-ahead corner goes to the aligned (or main) branch.
  const outOf: number[][] = nodes.map(() => []);
  const inTo: number[][] = nodes.map(() => []);
  edges.forEach((e, k) => {
    outOf[e.s]!.push(k);
    inTo[e.t]!.push(k);
  });
  for (const d of nodes) {
    if (d.kind !== 'decision') continue;
    const db = boxes[d.i]!;
    const used = new Set<Side>();
    for (const k of outOf[d.i]!) if (fixedEnd(k, 0)) used.add(srcSide[k]!);
    for (const k of inTo[d.i]!) if (fixedEnd(k, 1)) used.add(tgtSide[k]!);
    const outs = outOf[d.i]!.filter((k) => edges[k]!.t !== d.i && !fixedEnd(k, 0));
    const alignedFwd = (k: number) => srcSide[k] === 0 && Math.abs(cy(boxes[edges[k]!.t]!) - cy(db)) <= 1;
    const order = [...outs].sort((a, b) => {
      const ka = [alignedFwd(a) ? 1 : 0, edges[a]!.t === mainSucc[d.i] ? 1 : 0, srcSide[a] === 0 ? 1 : 0, height[edges[a]!.t]!, -a];
      const kb = [alignedFwd(b) ? 1 : 0, edges[b]!.t === mainSucc[d.i] ? 1 : 0, srcSide[b] === 0 ? 1 : 0, height[edges[b]!.t]!, -b];
      return cmp(kb, ka);
    });
    let first = true;
    for (const k of order) {
      const t = boxes[edges[k]!.t]!;
      const dy = cy(t) - cy(db);
      let want: Side = srcSide[k]!;
      // Only one branch goes straight ahead; the others leave from the corner facing their target.
      if (want === 0 && !first && !alignedFwd(k)) want = dy < 0 ? 3 : 2;
      if (want === 0 && !first) want = dy < 0 ? 3 : 2;
      first = false;
      const pref: Side[] = [want, ...(dy < 0 ? ([3, 0, 2] as Side[]) : ([2, 0, 3] as Side[]))];
      const side = pref.find((s) => !used.has(s)) ?? want;
      srcSide[k] = side;
      used.add(side);
    }
    for (const k of inTo[d.i]!) {
      if (edges[k]!.s === d.i || fixedEnd(k, 1)) continue;
      const sb = boxes[edges[k]!.s]!;
      const want = tgtSide[k]!;
      const dy = cy(sb) - cy(db);
      const pref: Side[] = [want, 1, ...(dy < 0 ? ([3, 2] as Side[]) : ([2, 3] as Side[])), 0];
      const side = pref.find((s) => !used.has(s)) ?? want;
      tgtSide[k] = side;
      used.add(side);
    }
    for (const k of outOf[d.i]!) {
      if (edges[k]!.t !== d.i) continue;
      const free = ([0, 2, 3, 1] as Side[]).filter((s) => !used.has(s));
      if (!fixedEnd(k, 0)) {
        srcSide[k] = free.shift() ?? 0;
        used.add(srcSide[k]!);
      }
      if (!fixedEnd(k, 1)) {
        tgtSide[k] = free.shift() ?? 3;
        used.add(tgtSide[k]!);
      }
    }
  }

  // Port positions: spread the edges on each side, in the order of their other ends so they don't cross.
  const portPos = new Map<string, number>(); // `${edge}:${end}` -> offset along the side from the box's top/left
  const bySide = new Map<string, { k: number; end: 0 | 1; other: number; aligned: boolean }[]>();
  edges.forEach((e, k) => {
    for (const end of [0, 1] as const) {
      if (fixedEnd(k, end)) continue; // at the side's port (L12), not spread
      const v = end === 0 ? e.s : e.t;
      const side = end === 0 ? srcSide[k]! : tgtSide[k]!;
      const ob = boxes[end === 0 ? e.t : e.s]!;
      const b = boxes[v]!;
      const alongSideAxisY = side < 2; // F/B sides run across the flow (y)
      const other = alongSideAxisY ? cy(ob) : cx(ob);
      const aligned = e.s !== e.t && (alongSideAxisY ? Math.abs(cy(ob) - cy(b)) <= 1 : Math.abs(cx(ob) - cx(b)) <= 1);
      const key = v + ':' + side;
      let l = bySide.get(key);
      if (!l) bySide.set(key, (l = []));
      l.push({ k, end, other, aligned });
    }
  });
  for (const [key, list] of bySide) {
    const [vs, ss] = key.split(':');
    const v = nodes[Number(vs)]!;
    const side = Number(ss) as Side;
    const b = boxes[v.i]!;
    const len = side < 2 ? b.h : b.w;
    const mid = Math.floor(len / 2); // the midline (sizes may be odd since v1.1 sizes: keep ports on whole pixels)
    const single = singlePortSide(v.kind, side, dir);
    list.sort((p, q) => p.other - q.other || p.k - q.k || p.end - q.end);
    if (single || list.length === 1) {
      for (const p of list) portPos.set(p.k + ':' + p.end, mid);
      continue;
    }
    const anchor = Math.max(0, list.findIndex((p) => p.aligned));
    const hasAnchor = list.some((p) => p.aligned);
    const usable = Math.max(8, len - 2 * roundEnd(v.kind, side, b, dir) - 16);
    const count = hasAnchor ? 2 * Math.max(anchor, list.length - 1 - anchor) : list.length - 1;
    const sp = Math.max(4, Math.min(16, count > 0 ? usable / count : 16));
    list.forEach((p, idx) => {
      const off = hasAnchor ? (idx - anchor) * sp : (idx - (list.length - 1) / 2) * sp;
      portPos.set(p.k + ':' + p.end, Math.round(mid + off));
    });
  }

  const portOf = (v: number, side: Side, offset: number, cost: number): Port => {
    const b = boxes[v]!;
    switch (side) {
      case 0: return { x: b.x + b.w, y: b.y + offset, dir: 0, cost };
      case 1: return { x: b.x, y: b.y + offset, dir: 1, cost };
      case 2: return { x: b.x + offset, y: b.y + b.h, dir: 2, cost };
      default: return { x: b.x + offset, y: b.y, dir: 3, cost };
    }
  };
  const mid = (v: number, side: Side) => Math.floor(side < 2 ? boxes[v]!.h / 2 : boxes[v]!.w / 2);
  const requests = edges.map((e, k) => {
    if (manual[k]) return null; // drawn, not routed
    // A set side (L12): only its port, on the box boundary where the side's midline meets it (the drawn line then
    // continues inward to the port itself when the outline is inside the box).
    const starts: Port[] = fixSrc[k] !== null
      ? [ports.boundary(e.s, fixSrc[k]!)]
      : [portOf(e.s, srcSide[k]!, portPos.get(k + ':0')!, 0)];
    const goals: Port[] = fixTgt[k] !== null
      ? [ports.boundary(e.t, fixTgt[k]!)]
      : [portOf(e.t, tgtSide[k]!, portPos.get(k + ':1')!, 0)];
    for (const side of [0, 1, 2, 3] as Side[]) {
      if (fixSrc[k] === null && side !== srcSide[k]) starts.push(portOf(e.s, side, mid(e.s, side), ALT_SIDE));
      if (fixTgt[k] === null && side !== tgtSide[k]) goals.push(portOf(e.t, side, mid(e.t, side), ALT_SIDE));
    }
    return { src: e.s, tgt: e.t, starts, goals };
  });
  // Manual lines (L11): source port, each bend point in order, target port, one elbow per step that isn't lined up.
  const drawn = edges.map((e, k) => {
    const pts = bends[k];
    return pts ? manualLine(ports.port(e.s, srcSide[k]!), srcSide[k]!, pts, ports.port(e.t, tgtSide[k]!), tgtSide[k]!) : null;
  });
  const xs: number[] = [];
  const ys: number[] = [];
  requests.forEach((r) => {
    if (!r) return;
    for (const p of [...r.starts, ...r.goals]) {
      xs.push(p.x);
      ys.push(p.y);
    }
  });
  // Manual lines' corners are grid lines too, so the router can see them (automatic lines avoid running along them).
  for (const pts of drawn) for (const [x, y] of pts ?? []) {
    xs.push(x);
    ys.push(y);
  }
  const router = new Router(boxes, { width: totalA, height: totalC, laneBorders, headerEnd, xs, ys });
  // Built only if needed: a set side's port can face out of the diagram (a block pinned at its start edge).
  let outside: Router | null = null;

  // Order: straight neighbours first (they claim the straight tracks), then decision branches (their labels matter),
  // then the rest by length; edges against the flow last.
  const orderKey = (k: number): number[] => {
    const e = edges[k]!;
    const s = boxes[e.s]!;
    const t = boxes[e.t]!;
    const straight = srcSide[k] === 0 && tgtSide[k] === 1 && Math.abs(cy(s) - cy(t)) <= 1 ? 0 : 1;
    const backwards = back[k] || t.x + t.w <= s.x ? 1 : 0;
    const dec = nodes[e.s]!.kind === 'decision' ? 0 : 1;
    const len = Math.abs(cx(s) - cx(t)) + Math.abs(cy(s) - cy(t));
    return [backwards, straight, dec, len, k];
  };
  // Manual lines first (they are fixed), in edge order; then the automatic ones.
  const order = [
    ...edges.map((_, k) => k).filter((k) => manual[k]),
    ...edges.map((_, k) => k).filter((k) => !manual[k]).sort((a, b) => cmp(orderKey(a), orderKey(b))),
  ];

  const out = new Map<number, Routed>();
  const labels: RBox[] = [];
  const segs: [number, number, number, number][] = [];
  for (const k of order) {
    const e = edges[k]!;
    let points: [number, number][];
    let sides: [Side, Side];
    if (manual[k]) {
      points = drawn[k]!;
      sides = [srcSide[k]!, tgtSide[k]!];
      router.addPolyline(points);
    } else {
      const req = requests[k]!;
      let r = router.route(req);
      if (!r) {
        outside ??= new Router(boxes, { width: totalA, height: totalC, laneBorders, headerEnd, xs, ys, pad: 48 });
        r = outside.route(req)!;
        router.addPolyline(r.points);
      }
      points = r.points;
      sides = [r.start.dir, r.goal.dir];
      // A set side's port may lie inside the box (a slanted or wavy outline): extend the end stub to it.
      if (fixSrc[k] !== null) points[0] = ports.port(e.s, fixSrc[k]!);
      if (fixTgt[k] !== null) points[points.length - 1] = ports.port(e.t, fixTgt[k]!);
    }
    for (let q = 0; q + 1 < points.length; q++) segs.push([points[q]![0], points[q]![1], points[q + 1]![0], points[q + 1]![1]]);
    let labelPos: [number, number] | null = null;
    if (e.label !== null && e.label !== '') {
      const size = edgeLabelSize(e.label);
      const lw = dir === 'LR' ? size.width : size.height;
      const lh = dir === 'LR' ? size.height : size.width;
      if (e.labelAt !== null) {
        // L8 with `label_at`: the centre at that fraction of the drawn line's length.
        const [ax, ay] = pointAtFraction(points, e.labelAt);
        labelPos = [Math.round(ax) + 0, Math.round(ay) + 0];
      } else {
        const place = placeLabel(points, boxes[e.s]!, lw, lh, boxes, labels, segs);
        labelPos = [place.x + lw / 2, place.y + lh / 2].map(Math.round) as [number, number];
      }
      const lb = { x: labelPos[0] - lw / 2, y: labelPos[1] - lh / 2, w: lw, h: lh };
      labels.push(lb);
      router.addLabel(lb);
    }
    out.set(e.i, { points, labelPos, sides, manual: manual[k]! });
  }
  return out;
}

/**
 * A manual line (§6 L11) in abstract coordinates: port `a` (side `sa`) → each bend point → port `b` (side `sb`). A step
 * between two points that aren't lined up gets one elbow: out of a port, first perpendicular to its side; into a port,
 * arriving perpendicular to its side; between bend points, along the flow first (abstract x). Consecutive repeated
 * points are dropped; everything else (bend points in a straight row included) is kept, so every bend point is on it.
 */
function manualLine(a: [number, number], sa: Side, pts: [number, number][], b: [number, number], sb: Side): [number, number][] {
  const out: [number, number][] = [];
  const push = (p: [number, number]) => {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push([p[0], p[1]]);
  };
  const lined = (p: [number, number], q: [number, number]) => p[0] === q[0] || p[1] === q[1];
  push(a);
  const first = pts[0]!;
  // Out of the source port: perpendicular to its side first (sides 0/1 are across the flow, so move along x).
  if (!lined(a, first)) push(sa < 2 ? [first[0], a[1]] : [a[0], first[1]]);
  push(first);
  for (let k = 1; k < pts.length; k++) {
    const p = pts[k - 1]!;
    const q = pts[k]!;
    if (!lined(p, q)) push([q[0], p[1]]); // along the flow first
    push(q);
  }
  const last = pts[pts.length - 1]!;
  // Into the target port: the last segment is perpendicular to its side.
  if (!lined(last, b)) push(sb < 2 ? [last[0], b[1]] : [b[0], last[1]]);
  push(b);
  return out;
}

/** Ports (§6 L12) of the laid-out nodes, in abstract coordinates. */
class PortGeometry {
  constructor(private nodes: N[], private boxes: RBox[], private dir: Direction) {}

  /** The port of an abstract side of node `v`: on the drawn outline, integers. */
  port(v: number, side: Side): [number, number] {
    const b = this.boxes[v]!;
    const LR = this.dir === 'LR';
    const real = LR ? { x: b.x, y: b.y, width: b.w, height: b.h } : { x: b.y, y: b.x, width: b.h, height: b.w };
    const [px, py] = portPoint(this.nodes[v]!.kind, real, REAL_SIDE[this.dir][side]!);
    return LR ? [px, py] : [py, px];
  }

  /** Where a line reaching that port crosses the box boundary (the router's end point), as a router port. */
  boundary(v: number, side: Side): Port {
    const b = this.boxes[v]!;
    const [px, py] = this.port(v, side);
    switch (side) {
      case 0: return { x: b.x + b.w, y: py, dir: 0, cost: 0 };
      case 1: return { x: b.x, y: py, dir: 1, cost: 0 };
      case 2: return { x: px, y: b.y + b.h, dir: 2, cost: 0 };
      default: return { x: px, y: b.y, dir: 3, cost: 0 };
    }
  }
}

/** Sides with a single attachment point: round ends and the parallelogram's slanted sides. */
function singlePortSide(kind: ShapeKind, side: Side, dir: Direction): boolean {
  // Convert the abstract side to a real one: in TB, abstract ±x is real ±y.
  const realHorizontalSide = dir === 'LR' ? side < 2 : side >= 2; // real left/right side
  if (kind === 'decision') return true;
  if (kind === 'terminal') return realHorizontalSide;
  if (kind === 'delay') return realHorizontalSide && (dir === 'LR' ? side === 0 : side === 2);
  return false;
}

/** Room taken by round corners at the ends of a side, so spread ports stay on the straight part. */
function roundEnd(kind: ShapeKind, side: Side, b: RBox, dir: Direction): number {
  const realH = dir === 'LR' ? b.h : b.w;
  const realHorizontalSide = dir === 'LR' ? side < 2 : side >= 2;
  if (kind === 'terminal' && !realHorizontalSide) return roundRadius(realH);
  if (kind === 'delay' && !realHorizontalSide) return roundRadius(realH) / 2;
  if (kind === 'io' && !realHorizontalSide) return SHAPE_GEOMETRY.ioSkew;
  if (kind === 'database' && !realHorizontalSide) return SHAPE_GEOMETRY.databaseRy;
  return 0;
}

/**
 * Puts an edge label next to the start of its edge (L8: centre within 60 px of the source box), beside the first
 * segment, avoiding boxes, other labels and edges where it can. Returns the label's top-left (abstract).
 */
function placeLabel(
  points: [number, number][], src: RBox, lw: number, lh: number, boxes: RBox[], labels: RBox[],
  segs: [number, number, number, number][],
): { x: number; y: number } {
  const [x0, y0] = points[0]!;
  const [x1, y1] = points[1] ?? points[0]!;
  const horiz = y0 === y1;
  const sgn = horiz ? Math.sign(x1 - x0) || 1 : Math.sign(y1 - y0) || 1;
  const cands: { x: number; y: number }[] = [];
  if (horiz) {
    const along = [6, 14, 22];
    for (const a of along) {
      const cxn = x0 + sgn * Math.min(a + lw / 2, LABEL_REACH);
      cands.push({ x: cxn - lw / 2, y: y0 - 3 - lh });
      cands.push({ x: cxn - lw / 2, y: y0 + 3 });
    }
  } else {
    for (const a of [4, 12, 20]) {
      const cyn = y0 + sgn * Math.min(a + lh / 2, LABEL_REACH);
      cands.push({ x: x0 + 5, y: cyn - lh / 2 });
      cands.push({ x: x0 - 5 - lw, y: cyn - lh / 2 });
    }
  }
  // Fallback: centred on the segment right at the port (its background hides the line).
  const onLine = horiz
    ? { x: x0 + sgn * (Math.min(lw / 2 + 2, LABEL_REACH)) - lw / 2, y: y0 - lh / 2 }
    : { x: x0 - lw / 2, y: y0 + sgn * Math.min(lh / 2 + 2, LABEL_REACH) - lh / 2 };
  const firstSeg = 1; // skip the edge's own first segment
  const ownSegStart = segs.length - (points.length - 1);
  let best = onLine;
  let bestScore = Infinity;
  for (const c of [...cands, onLine]) {
    const r = { x: c.x, y: c.y, w: lw, h: lh };
    if (distToBox(c.x + lw / 2, c.y + lh / 2, src) > LABEL_REACH) continue;
    let score = 0;
    for (const b of boxes) score += overlapArea(r, b, 3) * 4;
    for (const l of labels) score += overlapArea(r, l, 3) * 4;
    segs.forEach((s, si) => {
      if (si === ownSegStart && firstSeg) return;
      if (segHitsRect(s, r, 1)) score += 400;
    });
    if (c === onLine) score += 300;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
    if (score === 0) break;
  }
  return best;
}

function overlapArea(a: RBox, b: RBox, pad: number): number {
  const w = Math.min(a.x + a.w, b.x + b.w + pad) - Math.max(a.x, b.x - pad);
  const h = Math.min(a.y + a.h, b.y + b.h + pad) - Math.max(a.y, b.y - pad);
  return w > 0 && h > 0 ? w * h : 0;
}

function segHitsRect(s: [number, number, number, number], r: RBox, pad: number): boolean {
  const [ax, ay, bx, by] = s;
  const minX = Math.min(ax, bx);
  const maxX = Math.max(ax, bx);
  const minY = Math.min(ay, by);
  const maxY = Math.max(ay, by);
  return maxX > r.x - pad && minX < r.x + r.w + pad && maxY > r.y - pad && minY < r.y + r.h + pad;
}

/** Distance from a point to a box's boundary. */
function distToBox(px: number, py: number, b: RBox): number {
  const dx = Math.max(b.x - px, 0, px - (b.x + b.w));
  const dy = Math.max(b.y - py, 0, py - (b.y + b.h));
  if (dx === 0 && dy === 0) return Math.min(px - b.x, b.x + b.w - px, py - b.y, b.y + b.h - py);
  return Math.hypot(dx, dy);
}

