// Copy, paste and duplicate (amendment A12): a *fragment* is a self-contained copy of some blocks and the lines between
// them, independent of the diagram it came from, so it can be pasted into the same diagram or another one.
//
// - `copyFragment` reads the selected blocks (declaration, lane, where each is drawn, stored size, config metadata)
//   and every line whose both ends are among them (label, sides, `label_at`, bend points). It changes nothing.
// - `pasteFragment` adds a fragment to a diagram as one operation: new ids derived from the originals (the original id
//   when it's free, else `<base>-2`, `<base>-3`…), the same shapes, labels and classes, the metadata copied under the
//   new ids, the sizes kept, every copy pinned, and the lines re-created between the copies (appended at the end of
//   the edge section, UI15). Two placements:
//   - `{ step }` keeps each block in its own lane when the target has that lane (else the first lane) and pins it at
//     its original lane-relative position moved `step` px along and across the flow (duplicate, and a paste with the
//     pointer off the canvas);
//   - `{ at }` drops the whole fragment with the top-left of its bounding box at a diagram point, like dragging the
//     group there: each block lands in the lane under its own centre (UI43).
// - `duplicateNodes` (UI13, A12) is `copyFragment` + `pasteFragment` with `{ step: PASTE_STEP }`.
// - `fragmentToMermaid` writes a fragment as a valid flowmap `.mmd` (canonical form), for the system clipboard.
import { pointFromStored, storedFromPoint } from '../layout';
import {
  pinFromDrop, removeEdgeEntries, roundPx, setPins, setSizes, sizeOf, updateEdges, type EdgePatch,
} from '../layoutfile';
import { emptyDiagram, findNode, format, isIdForm, isReservedId, undeclaredNodes, type Lane, type NodeDecl } from '../mmd';
import { SHAPE_KINDS, SIDES, UNASSIGNED, type Direction, type Pin, type ShapeKind, type Side, type Size, type XY } from '../types';
import { mentions, refuse, run, type Ctx, type Files, type OpResult } from './context';
import { blockGroupAt, blockLaneAt, checkXY, storedCorner, viewOf, type LayoutArg, type View } from './frame';
import { positionInLane } from './nodes';

/** How far a paste or duplicate is moved from its originals, along and across the flow (px), per repeat. */
export const PASTE_STEP = 40;

export interface FragmentNode {
  /** The original id. */
  id: string;
  shape: ShapeKind;
  label: string;
  className: string | null;
  /** The original lane id, or `_unassigned`. */
  lane: string;
  /** A19: the original group id; absent when the block was directly in its lane. */
  group?: string;
  /** Where the block was, as a pin records it (§5): `along` less T, `across` from its lane's zero line. */
  pos: { along: number; across: number };
  /** Where the block was drawn (diagram coordinates at zoom 1). */
  box: { x: number; y: number; width: number; height: number };
  /** Its stored size (v1.1 §5), or null. */
  size: Size | null;
  /** Its config `nodes` entry, or null. */
  meta: Record<string, unknown> | null;
}

export interface FragmentPoint {
  /** The bend point as stored (lane-relative). */
  pin: Pin;
  /** Where it was drawn. */
  x: number;
  y: number;
}

export interface FragmentEdge {
  source: string;
  target: string;
  label: string | null;
  source_side?: Side;
  target_side?: Side;
  label_at?: number;
  /** Bend points of a manual line (only when they applied in the source diagram). */
  points?: FragmentPoint[];
}

export interface Fragment {
  version: 1;
  direction: Direction;
  /** Lanes the copied blocks were in (not `_unassigned`), in display order, with their labels (for the Mermaid). */
  lanes: { id: string; label: string }[];
  /** In file declaration order (§8.2 Order). */
  nodes: FragmentNode[];
  /** In file order. */
  edges: FragmentEdge[];
}

// ---- copy

/**
 * The fragment for blocks `ids` (any order; unknown ids are refused) as drawn in `layout`: each block, and every line
 * whose both ends are among them. Refused if the config has errors and mentions one of the blocks (its evidence can't
 * be read, and a paste must never silently drop it).
 */
export function copyFragment(
  files: Files, ids: readonly string[], layout: LayoutArg,
): { ok: true; fragment: Fragment } | { ok: false; error: string } {
  let fragment: Fragment | null = null;
  const r = run(files, (ctx) => {
    fragment = readFragment(ctx, ids, layout);
    return {};
  });
  return r.ok ? { ok: true, fragment: fragment! } : r;
}

function readFragment(ctx: Ctx, ids: readonly string[], layout: LayoutArg): Fragment {
  const ordered = ctx.sortByDeclaration(ids);
  if (ordered.length === 0) refuse('Select one or more blocks first');
  if (ctx.configBroken && ctx.configText !== null && ordered.some((id) => mentions(ctx.configText!, id))) {
    refuse('The config file has errors, so these blocks’ evidence can’t be copied; fix it first');
  }
  const view = viewOf(ctx, layout);
  const drawn = view.result;
  const nodes: FragmentNode[] = ordered.map((id) => {
    const found = findNode(ctx.d, id);
    const box = drawn.nodes.find((n) => n.id === id);
    const pos = positionInLane(drawn, id, view.frame);
    if (!box || !pos) return refuse(`The layout has no position for "${id}"; try again`);
    const entry = ctx.layoutIn && Object.hasOwn(ctx.layoutIn.nodes, id) ? ctx.layoutIn.nodes[id] : undefined;
    const meta = ctx.config && Object.hasOwn(ctx.config.nodes, id) ? ctx.config.nodes[id]! : null;
    return {
      id,
      shape: found?.node.shape ?? 'step',
      label: found?.node.label ?? id,
      className: found?.node.className ?? null,
      lane: found?.lane ?? UNASSIGNED,
      ...(found?.group ? { group: found.group } : {}),
      pos,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      size: sizeOf(entry),
      meta: meta && Object.keys(meta).length ? structuredClone(meta) : null,
    };
  });
  const inside = new Set(ordered);
  const edgeIdList = ctx.edgeIds();
  const edges: FragmentEdge[] = [];
  ctx.d.edges.forEach((edge, k) => {
    if (!inside.has(edge.source) || !inside.has(edge.target)) return;
    const out: FragmentEdge = { source: edge.source, target: edge.target, label: edge.label };
    const entry = ctx.layoutIn?.edges?.[edgeIdList[k]!];
    if (entry?.source_side) out.source_side = entry.source_side;
    if (entry?.target_side) out.target_side = entry.target_side;
    if (entry?.label_at !== undefined) out.label_at = entry.label_at;
    const line = drawn.edges.find((e) => e.id === edgeIdList[k]);
    if (entry?.points && line?.manual) {
      const points = entry.points.map((pin) => {
        const at = pointFromStored(drawn, view.frame, pin);
        return at ? { pin: { ...pin }, x: at[0], y: at[1] } : null;
      });
      if (points.every((p) => p !== null)) out.points = points as FragmentPoint[];
    }
    edges.push(out);
  });
  const used = new Set(nodes.map((n) => n.lane));
  const lanes = drawn.lanes
    .filter((l) => l.id !== UNASSIGNED && used.has(l.id))
    .map((l) => ({ id: l.id, label: ctx.d.lanes.find((x) => x.id === l.id)?.label ?? l.label }));
  return { version: 1, direction: ctx.original.direction, lanes, nodes, edges };
}

// ---- paste

/**
 * Where a paste goes:
 * - `step`: each block in its own lane if the target has it, else the first displayed lane (`_unassigned` in a
 *   lane-free diagram); pinned at its original lane-relative position plus `step` px along and across the flow. Bend
 *   points move the same way (the line is routed automatically if one's lane is missing). (With the pointer over the
 *   canvas the UI uses `at` instead, so "the lane under the pointer" is each block's own drop lane.)
 * - `at`: the fragment's bounding box's top-left at this diagram point; each block in the lane under its own centre
 *   (UI43), bend points in the lane that contains them.
 */
export type PastePlacement = { step: number } | { at: XY };

export interface PastedBlock {
  id: string;
  /** The original id it copies. */
  from: string;
  lane: string;
  /** Its box as dropped (diagram coordinates in the layout given), for `at` placements. */
  box: { x: number; y: number; width: number; height: number } | null;
}

/**
 * A12: add `fragment` to the diagram as one operation (see the file comment). Returns the new blocks in fragment order
 * (file declaration order of the originals).
 */
export function pasteFragment(
  files: Files, fragment: Fragment, layout: LayoutArg, place: PastePlacement,
): OpResult<{ ids: string[]; from: string[]; blocks: PastedBlock[] }> {
  return run(files, (ctx) => {
    if (!isFragment(fragment) || fragment.nodes.length === 0) refuse('There is nothing to paste');
    ctx.requireLayout(); // every pasted block is pinned
    const view = viewOf(ctx, layout);
    const first = ctx.firstLane();
    const laneExists = (lane: string) => lane === UNASSIGNED || ctx.hasLane(lane);

    // Placement of each block.
    let dx = 0;
    let dy = 0;
    if ('at' in place) {
      checkXY(place.at);
      dx = place.at.x - Math.min(...fragment.nodes.map((n) => n.box.x));
      dy = place.at.y - Math.min(...fragment.nodes.map((n) => n.box.y));
    } else if (!Number.isFinite(place.step)) refuse('A paste needs a finite step');

    const blocks: PastedBlock[] = [];
    const pins: [string, Pin][] = [];
    const sizes: [string, Size][] = [];
    const adopted = new Set<string>();
    const used = new Set<string>();
    const idMap = new Map<string, string>();
    for (const n of fragment.nodes) {
      const id = pasteId(ctx, n, used);
      used.add(id.id);
      if (id.adopted) adopted.add(id.id);
      idMap.set(n.id, id.id);
      let lane: string;
      let group: string | null;
      let pin: Pin;
      let box: PastedBlock['box'] = null;
      if ('at' in place) {
        box = { x: roundPx(n.box.x + dx), y: roundPx(n.box.y + dy), width: n.box.width, height: n.box.height };
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        lane = blockLaneAt(view.result, cx, cy);
        group = blockGroupAt(view.result, lane, cx, cy); // A19: as a drop
        const corner = storedCorner(view, lane, box.x, box.y);
        pin = pinFromDrop(lane, corner.along, corner.across, first, group);
      } else {
        lane = laneExists(n.lane) ? n.lane : first;
        // A19: in its original's group when the copy is in that group's lane.
        group = n.group !== undefined && ctx.findGroup(n.group)?.lane === lane ? n.group : null;
        pin = pinFromDrop(lane, n.pos.along + place.step, n.pos.across + place.step, first, group);
      }
      const decl: NodeDecl = { id: id.id, shape: n.shape, label: n.label, className: n.className, comments: [] };
      (group === null ? ctx.declsOf(lane) : ctx.findGroup(group)!.group.nodes).push(decl);
      pins.push([id.id, pin]);
      if (n.size) sizes.push([id.id, { width: n.size.width, height: n.size.height }]);
      blocks.push({ id: id.id, from: n.id, lane, box });
    }

    // Metadata under the new ids (an adopted id already has its entry: see `pasteId`).
    const metas = fragment.nodes
      .map((n) => [idMap.get(n.id)!, n.meta] as const)
      .filter(([id, meta]) => meta !== null && !adopted.has(id));
    for (const [id, meta] of metas) ctx.editConfig('always', (doc) => doc.addNodeEntry(id, meta!));

    // Lines between the copies, appended at the end of the edge section (UI15).
    const before = ctx.d.edges.length;
    for (const e of fragment.edges) {
      const source = idMap.get(e.source);
      const target = idMap.get(e.target);
      if (!source || !target) continue;
      ctx.d.edges.push({ source, target, label: e.label, comments: [] });
    }
    ctx.rekeyEdgeEntries();
    const newEdgeIds = ctx.edgeIds().slice(before);
    // A bend point is kept only in a lane that shows after the paste (else the whole line is routed automatically).
    const shows = (lane: string) => (lane === UNASSIGNED
      ? ctx.d.unlaned.length > 0 || undeclaredNodes(ctx.d).length > 0
      : ctx.hasLane(lane));
    const patches: [string, EdgePatch][] = fragment.edges
      .filter((e) => idMap.has(e.source) && idMap.has(e.target))
      .map((e, k) => {
        const patch: EdgePatch = {};
        if (e.source_side) patch.source_side = e.source_side;
        if (e.target_side) patch.target_side = e.target_side;
        const points = e.points ? pastePoints(e.points, place, view, dx, dy, shows, first) : null;
        if (points) patch.points = points;
        if (e.label_at !== undefined) patch.label_at = e.label_at;
        return [newEdgeIds[k]!, patch];
      });

    ctx.editLayout('always', (file) => {
      let out = setPins(file, pins);
      if (sizes.length) out = setSizes(out, sizes)!;
      // A new line whose id has an orphaned entry (W-layout-unknown-edge) doesn't inherit it: R11.4, it replaces it.
      const lines = patches.map(([id]) => id);
      return updateEdges(removeEdgeEntries(out, lines), patches.filter(([, p]) => Object.keys(p).length > 0));
    });
    return { ids: blocks.map((b) => b.id), from: blocks.map((b) => b.from), blocks };
  });
}

function pastePoints(
  points: readonly FragmentPoint[], place: PastePlacement, view: View, dx: number, dy: number,
  shows: (lane: string) => boolean, first: string,
): Pin[] | null {
  const out: Pin[] = [];
  for (const p of points) {
    let pin: Pin | null;
    if ('at' in place) pin = storedFromPoint(view.result, view.frame, roundPx(p.x + dx), roundPx(p.y + dy));
    else pin = pinFromDrop(p.pin.lane, p.pin.along + place.step, p.pin.across + place.step, first);
    if (!pin || !shows(pin.lane)) return null;
    out.push(pin);
  }
  return out.length ? out : null;
}

/**
 * The id a pasted block gets: the original id when it's free; else `<base>-2`, `<base>-3`… (the first that follows the
 * id rules and is neither reserved nor taken, §3.1), where `<base>` is the id less a trailing `-<number>` (so copies of
 * `review-2` are `review-3`, not `review-2-2`). Ids taken earlier in the same paste count as taken.
 *
 * "Adopted": the original id when the only thing holding it is a config `nodes` entry equal to the block's own metadata
 * (what a cut leaves behind, UI14 never deletes metadata): a cut and paste then gives the block its id back and reuses
 * the entry, instead of leaving an orphan.
 */
function pasteId(ctx: Ctx, n: FragmentNode, used: ReadonlySet<string>): { id: string; adopted: boolean } {
  const ok = (id: string) => isIdForm(id) && !isReservedId(id) && !used.has(id);
  if (ok(n.id) && !ctx.isTaken(n.id)) return { id: n.id, adopted: false };
  if (ok(n.id) && adoptable(ctx, n)) return { id: n.id, adopted: true };
  const m = /^(.*?)-(\d+)$/.exec(n.id);
  const base = m && isIdForm(m[1]!) ? m[1]! : n.id;
  const start = m && base !== n.id ? Number(m[2]) + 1 : 2;
  for (let k = Math.max(2, start); k < start + 100_000; k++) {
    const id = `${base}-${k}`;
    if (ok(id) && !ctx.isTaken(id)) return { id, adopted: false };
  }
  return refuse(`No free id for a copy of "${n.id}"`);
}

function adoptable(ctx: Ctx, n: FragmentNode): boolean {
  const id = n.id;
  if (!n.meta || !ctx.config || ctx.hasNode(id) || ctx.hasLane(id) || ctx.findGroup(id)) return false;
  if (Object.hasOwn(ctx.config.notes, id)) return false;
  if (ctx.layoutBroken || (ctx.layoutIn && (Object.hasOwn(ctx.layoutIn.nodes, id) || Object.hasOwn(ctx.layoutIn.notes ?? {}, id)))) return false;
  if (!Object.hasOwn(ctx.config.nodes, id)) return false;
  return JSON.stringify(ctx.config.nodes[id]) === JSON.stringify(n.meta);
}

// ---- duplicate (UI13 as amended by A12)

/**
 * UI13 (A12): duplicate blocks in place: copy them with the lines between them and paste the copy `PASTE_STEP` px along
 * and across from the originals, each in its own lane. Returns the new ids, index-aligned with the originals in
 * declaration order (`from`).
 */
export function duplicateNodes(
  files: Files, ids: readonly string[], layout: LayoutArg,
): OpResult<{ ids: string[]; from: string[] }> {
  const copied = copyFragment(files, ids, layout);
  if (!copied.ok) return copied;
  const r = pasteFragment(files, copied.fragment, layout, { step: PASTE_STEP });
  return r.ok ? { ok: true, files: r.files, ids: r.ids, from: r.from } : r;
}

// ---- Mermaid text

/** The fragment as a flowmap `.mmd` in canonical form (§3.3), with the original ids, lanes and labels. */
export function fragmentToMermaid(fragment: Fragment): string {
  const d = emptyDiagram(fragment.direction);
  const lanes = new Map<string, Lane>();
  for (const l of fragment.lanes) lanes.set(l.id, { id: l.id, label: l.label, comments: [], nodes: [], endComments: [] });
  for (const n of fragment.nodes) {
    const decl: NodeDecl = { id: n.id, shape: n.shape, label: n.label, className: n.className, comments: [] };
    if (n.lane === UNASSIGNED) {
      d.unlaned.push(decl);
      continue;
    }
    if (!lanes.has(n.lane)) lanes.set(n.lane, { id: n.lane, label: n.lane, comments: [], nodes: [], endComments: [] });
    lanes.get(n.lane)!.nodes.push(decl);
  }
  d.lanes = [...lanes.values()].filter((l) => l.nodes.length > 0);
  d.edges = fragment.edges.map((e) => ({ source: e.source, target: e.target, label: e.label, comments: [] }));
  return format(d);
}

// ---- validation (a fragment read back from storage)

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Is `v` a well-formed fragment (for one read back from storage, which anything could have written)? */
export function isFragment(v: unknown): v is Fragment {
  if (!isObj(v) || v.version !== 1 || (v.direction !== 'LR' && v.direction !== 'TB')) return false;
  if (!Array.isArray(v.lanes) || !v.lanes.every((l) => isObj(l) && isStr(l.id) && isStr(l.label))) return false;
  if (!Array.isArray(v.nodes) || !Array.isArray(v.edges)) return false;
  const ids = new Set<string>();
  for (const n of v.nodes) {
    if (!isObj(n) || !isStr(n.id) || !isIdForm(n.id) || isReservedId(n.id) || ids.has(n.id)) return false;
    ids.add(n.id);
    if (!(SHAPE_KINDS as readonly unknown[]).includes(n.shape) || !isStr(n.label) || n.label.trim() === '' || /[\r\n]/.test(n.label)) return false;
    if (n.className !== null && !isStr(n.className)) return false;
    if (!isStr(n.lane) || (n.lane !== UNASSIGNED && !isIdForm(n.lane))) return false;
    if (n.group !== undefined && !(isStr(n.group) && isIdForm(n.group))) return false;
    if (!isObj(n.pos) || !isNum(n.pos.along) || !isNum(n.pos.across)) return false;
    if (!isObj(n.box) || !['x', 'y', 'width', 'height'].every((k) => isNum((n.box as Record<string, unknown>)[k]))) return false;
    if (n.size !== null && !(isObj(n.size) && Number.isInteger(n.size.width) && Number.isInteger(n.size.height)
      && (n.size.width as number) >= 40 && (n.size.height as number) >= 40)) return false;
    if (n.meta !== null && !isObj(n.meta)) return false;
  }
  for (const e of v.edges) {
    if (!isObj(e) || !isStr(e.source) || !isStr(e.target) || !ids.has(e.source) || !ids.has(e.target)) return false;
    if (e.label !== null && (!isStr(e.label) || /[\r\n]/.test(e.label))) return false;
    for (const k of ['source_side', 'target_side'] as const) {
      if (e[k] !== undefined && !(SIDES as readonly unknown[]).includes(e[k])) return false;
    }
    if (e.label_at !== undefined && !(isNum(e.label_at) && e.label_at >= 0 && e.label_at <= 1
      && Math.round(e.label_at * 100) === e.label_at * 100)) return false;
    if (e.points !== undefined) {
      if (!Array.isArray(e.points) || e.points.length === 0) return false;
      for (const p of e.points) {
        if (!isObj(p) || !isNum(p.x) || !isNum(p.y) || !isObj(p.pin)) return false;
        if (!isStr(p.pin.lane) || !Number.isInteger(p.pin.along) || !Number.isInteger(p.pin.across)) return false;
      }
    }
  }
  return true;
}

/** The bounding box of a fragment's blocks as drawn where it was copied. */
export function fragmentBounds(fragment: Fragment): { x: number; y: number; width: number; height: number } {
  const xs = fragment.nodes.map((n) => n.box.x);
  const ys = fragment.nodes.map((n) => n.box.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const r = Math.max(...fragment.nodes.map((n) => n.box.x + n.box.width));
  const b = Math.max(...fragment.nodes.map((n) => n.box.y + n.box.height));
  return { x, y, width: r - x, height: b - y };
}

