// The UI's writes to the layout file (§5, §8.2 "Keeping the layout file in step"). Pure: every operation takes the
// file (null: no file on disk) and returns a new one without mutating its input.
//
// - Operations that only remove things keep "no file" as null (so they never create a file, UI28).
// - Entries keep their place in the file; a new entry goes last; a renamed entry keeps its place (R5.10).
// - An entry an operation empties is removed, and an empty `edges` or `notes` map is left out (§5 Values).
// - Values are checked: a bad value is a programming error and throws (the file must always parse back).
import type { LayoutEdgeEntry, LayoutFile, LayoutNodeEntry, Pin, Side, Size, XY } from '../types';
import { pinOf, sizeOf } from '../types';
import { isCoord, isLabelAt, isSide, isSizeValue, MIN_SIZE, put } from './parse';

type Entries<T> = Record<string, T>;

function emptyFile(): LayoutFile {
  return { version: 1, nodes: {} };
}

/** Build a file in canonical shape: key order version, nodes, edges, notes, title, hints; empty maps left out. */
function build(parts: {
  nodes: Entries<LayoutNodeEntry>;
  edges?: Entries<LayoutEdgeEntry>;
  notes?: Entries<XY>;
  title?: XY;
  hints?: unknown;
}): LayoutFile {
  const out: LayoutFile = { version: 1, nodes: parts.nodes };
  if (parts.edges && Object.keys(parts.edges).length) out.edges = parts.edges;
  if (parts.notes && Object.keys(parts.notes).length) out.notes = parts.notes;
  if (parts.title) out.title = parts.title;
  if (parts.hints !== undefined) out.hints = parts.hints;
  return out;
}

const partsOf = (f: LayoutFile) => ({ nodes: f.nodes, edges: f.edges, notes: f.notes, title: f.title, hints: f.hints });

/** Map every entry of a section; `undefined` from `fn` drops the entry; a returned key renames it (in place). */
function mapEntries<T>(
  entries: Entries<T> | undefined,
  fn: (id: string, v: T) => { key?: string; value: T | undefined },
): Entries<T> {
  const out: Entries<T> = {};
  for (const [id, v] of Object.entries(entries ?? {})) {
    const r = fn(id, v);
    if (r.value !== undefined) put(out, r.key ?? id, r.value);
  }
  return out;
}

/** Set (or with `undefined`, remove) one entry: an existing entry keeps its place, a new one goes last. */
function withEntry<T>(entries: Entries<T> | undefined, id: string, value: T | undefined): Entries<T> {
  const out: Entries<T> = {};
  let seen = false;
  for (const [k, v] of Object.entries(entries ?? {})) {
    if (k === id) { seen = true; if (value !== undefined) put(out, k, value); } else put(out, k, v);
  }
  if (!seen && value !== undefined) put(out, id, value);
  return out;
}

// ---- node entries: pins and sizes -----------------------------------------------------------------------------

/** A node entry from its two halves, key order lane, along, across, width, height; undefined when both are absent. */
export function nodeEntry(pin: Pin | null, size: Size | null): LayoutNodeEntry | undefined {
  if (!pin && !size) return undefined;
  const e: LayoutNodeEntry = {};
  if (pin) Object.assign(e, { lane: pin.lane, along: pin.along + 0, across: pin.across + 0 });
  if (size) Object.assign(e, { width: size.width, height: size.height });
  return e;
}

function checkPin(pin: Pin, what = 'pin'): void {
  if (!pin || typeof pin.lane !== 'string' || !isCoord(pin.along) || !isCoord(pin.across)) {
    throw new Error(`invalid ${what} ${JSON.stringify(pin)}: lane must be a string, along/across integers`);
  }
}

function checkSize(size: Size): void {
  if (!size || !isSizeValue(size.width) || !isSizeValue(size.height)) {
    throw new Error(`invalid size ${JSON.stringify(size)}: width and height must be integers of at least ${MIN_SIZE}`);
  }
}

function checkXY(xy: XY): void {
  if (!xy || !isCoord(xy.x) || !isCoord(xy.y)) throw new Error(`invalid position ${JSON.stringify(xy)}: x and y must be integers`);
}

function updateNodes(
  file: LayoutFile | null,
  changes: Iterable<[string, (e: LayoutNodeEntry | undefined) => LayoutNodeEntry | undefined]>,
  create: boolean,
): LayoutFile | null {
  if (!file && !create) return null;
  const base = file ?? emptyFile();
  let nodes = base.nodes;
  for (const [id, fn] of changes) {
    nodes = withEntry(nodes, id, fn(Object.hasOwn(nodes, id) ? nodes[id] : undefined));
  }
  return build({ ...partsOf(base), nodes });
}

/** Pin (or re-pin) a node, keeping its size. Creates the file if there is none. */
export function setPin(file: LayoutFile | null, id: string, pin: Pin): LayoutFile {
  return setPins(file, [[id, pin]]);
}

/** Pin several nodes at once (one drag of a selection is one write), keeping their sizes. */
export function setPins(file: LayoutFile | null, pins: Iterable<[string, Pin]>): LayoutFile {
  const list = [...pins];
  for (const [, pin] of list) checkPin(pin);
  return updateNodes(file, list.map(([id, pin]) => [id, (e) => nodeEntry(pin, sizeOf(e))]), true)!;
}

/** Unpin nodes (UI12, and blocks moved out of a deleted lane): the pin goes, a size stays. No file stays no file. */
export function removePins(file: LayoutFile | null, ids: Iterable<string>): LayoutFile | null {
  return updateNodes(file, [...ids].map((id) => [id, (e) => nodeEntry(null, sizeOf(e))]), false);
}

export function removePin(file: LayoutFile | null, id: string): LayoutFile | null {
  return removePins(file, [id]);
}

/** UI34: set a node's size (both dimensions), or with null remove it (Reset size), keeping its pin. */
export function setSize(file: LayoutFile | null, id: string, size: Size | null): LayoutFile | null {
  return setSizes(file, [[id, size]]);
}

/** Set or remove several sizes in one write (duplicating a selection copies each size, UI13). */
export function setSizes(file: LayoutFile | null, sizes: Iterable<[string, Size | null]>): LayoutFile | null {
  const list = [...sizes];
  for (const [, size] of list) if (size !== null) checkSize(size);
  return updateNodes(file, list.map(([id, size]) => [id, (e) => nodeEntry(pinOf(e), size)]), list.some(([, s]) => s !== null));
}

/** Delete nodes' whole entries, pin and size (UI14 delete, UI27 orphan delete). No file stays no file. */
export function removeNodeEntries(file: LayoutFile | null, ids: Iterable<string>): LayoutFile | null {
  return updateNodes(file, [...ids].map((id) => [id, () => undefined]), false);
}

// ---- edge entries ---------------------------------------------------------------------------------------------

/** A change to an edge entry: a value sets that field, null removes it, a missing key leaves it as it is. */
export interface EdgePatch {
  source_side?: Side | null;
  target_side?: Side | null;
  points?: Pin[] | null;
  label_at?: number | null;
}

const EDGE_ORDER = ['source_side', 'target_side', 'points', 'label_at'] as const;

function checkPatch(p: EdgePatch): void {
  for (const k of ['source_side', 'target_side'] as const) {
    const v = p[k];
    if (v !== undefined && v !== null && !isSide(v)) throw new Error(`invalid ${k} ${JSON.stringify(v)}`);
  }
  if (p.points !== undefined && p.points !== null) {
    if (!Array.isArray(p.points) || p.points.length === 0) throw new Error('points must be a non-empty list (null removes them)');
    for (const pt of p.points) checkPin(pt, 'bend point');
  }
  if (p.label_at !== undefined && p.label_at !== null && !isLabelAt(p.label_at)) {
    throw new Error(`invalid label_at ${JSON.stringify(p.label_at)}: a number from 0 to 1 with at most two decimals`);
  }
}

/** Apply a patch to an entry; the result has the fixed key order, or is undefined when empty. */
function patchEntry(entry: LayoutEdgeEntry | undefined, patch: EdgePatch): LayoutEdgeEntry | undefined {
  const merged: Record<string, unknown> = { ...(entry ?? {}) };
  for (const k of EDGE_ORDER) {
    if (!(k in patch) || patch[k] === undefined) continue;
    const v = patch[k];
    if (v === null) delete merged[k];
    else merged[k] = k === 'points' ? (v as Pin[]).map((p) => ({ lane: p.lane, along: p.along + 0, across: p.across + 0 })) : v;
  }
  const out: LayoutEdgeEntry = {};
  for (const k of EDGE_ORDER) if (merged[k] !== undefined) Object.assign(out, { [k]: merged[k] });
  return Object.keys(out).length ? out : undefined;
}

/**
 * Change one edge's entry (UI36–UI38): each field in the patch is set, or removed with null. An emptied entry is
 * removed. Creates the file only when something is set.
 */
export function updateEdge(file: LayoutFile | null, edgeId: string, patch: EdgePatch): LayoutFile | null {
  return updateEdges(file, [[edgeId, patch]]);
}

/** Several edge changes in one write. */
export function updateEdges(file: LayoutFile | null, patches: Iterable<[string, EdgePatch]>): LayoutFile | null {
  const list = [...patches];
  for (const [, p] of list) checkPatch(p);
  const sets = list.some(([, p]) => EDGE_ORDER.some((k) => p[k] !== undefined && p[k] !== null));
  if (!file && !sets) return null;
  const base = file ?? emptyFile();
  let edges = base.edges ?? {};
  for (const [id, p] of list) edges = withEntry(edges, id, patchEntry(Object.hasOwn(edges, id) ? edges[id] : undefined, p));
  return build({ ...partsOf(base), edges });
}

/** Set or (null) remove one side of a line (UI38). */
export function setEdgeSide(file: LayoutFile | null, edgeId: string, end: 'source' | 'target', side: Side | null): LayoutFile | null {
  return updateEdge(file, edgeId, end === 'source' ? { source_side: side } : { target_side: side });
}

/** Set a line's bend points (it becomes manual), or with null remove them (automatic again) (UI36). */
export function setEdgePoints(file: LayoutFile | null, edgeId: string, points: Pin[] | null): LayoutFile | null {
  return updateEdge(file, edgeId, { points });
}

/** Set or (null) remove where a line's label sits (UI37). */
export function setLabelAt(file: LayoutFile | null, edgeId: string, labelAt: number | null): LayoutFile | null {
  return updateEdge(file, edgeId, { label_at: labelAt });
}

/** UI36 "Reset line": remove the line's points and both sides (`label_at` stays). */
export function resetEdge(file: LayoutFile | null, edgeId: string): LayoutFile | null {
  return updateEdge(file, edgeId, { points: null, source_side: null, target_side: null });
}

/** Delete edges' whole entries (UI14 delete, UI27 orphan delete). */
export function removeEdgeEntries(file: LayoutFile | null, ids: Iterable<string>): LayoutFile | null {
  if (!file) return null;
  const drop = new Set(ids);
  return build({ ...partsOf(file), edges: mapEntries(file.edges, (id, v) => ({ value: drop.has(id) ? undefined : v })) });
}

/**
 * Re-key edge entries (§8.2): `mapping` gives an old edge id's new id, or null when that edge was deleted (its entry
 * goes). Entries not in the mapping (orphans) keep their key, unless a re-keyed entry takes it: then the live edge's
 * entry wins. Every entry keeps its place in the file.
 */
export function rekeyEdges(
  file: LayoutFile | null,
  mapping: ReadonlyMap<string, string | null> | Readonly<Record<string, string | null>>,
): LayoutFile | null {
  if (!file || !file.edges) return file;
  const m = mapping instanceof Map ? mapping : new Map(Object.entries(mapping));
  const targets = new Set([...m.values()].filter((v): v is string => v !== null));
  const edges: Entries<LayoutEdgeEntry> = {};
  for (const [id, entry] of Object.entries(file.edges)) {
    if (m.has(id)) {
      const to = m.get(id);
      if (to !== null && to !== undefined) put(edges, to, entry);
    } else if (!targets.has(id)) put(edges, id, entry);
  }
  return build({ ...partsOf(file), edges });
}

/**
 * Re-key by position (§8.2): `oldIds` are the edge ids before the operation (index-aligned with the file's edges then)
 * and `newIds[i]` is the id of old edge i afterwards, or null if it was deleted.
 */
export function rekeyEdgesByPosition(
  file: LayoutFile | null, oldIds: readonly string[], newIds: readonly (string | null)[],
): LayoutFile | null {
  if (oldIds.length !== newIds.length) throw new Error('rekeyEdgesByPosition: oldIds and newIds must be index-aligned');
  const m = new Map<string, string | null>();
  oldIds.forEach((id, i) => m.set(id, newIds[i]!));
  return rekeyEdges(file, m);
}

/** An edge id's endpoints (§3.4: `<source>-><target>`, then `#n` for repeats). Ids never contain `->` or `#`. */
export function splitEdgeId(id: string): { source: string; target: string; suffix: string } | null {
  const m = /^(.+?)->(.+?)(#\d+)?$/.exec(id);
  return m ? { source: m[1]!, target: m[2]!, suffix: m[3] ?? '' } : null;
}

/**
 * UI9: rename a node in the layout file: its node entry (in place) and the keys of its edges' entries (a line's id
 * follows its endpoints, §3.4; the new id is unused, so repeat numbers don't change). No file stays no file.
 */
export function renameNode(file: LayoutFile | null, oldId: string, newId: string): LayoutFile | null {
  if (!file || oldId === newId) return file;
  const touches = (id: string) => { const s = splitEdgeId(id); return !!s && (s.source === oldId || s.target === oldId); };
  if (!Object.hasOwn(file.nodes, oldId) && !Object.keys(file.edges ?? {}).some(touches)) return file;
  const nodes = mapEntries(file.nodes, (id, v) => (id === newId && Object.hasOwn(file.nodes, oldId) ? { value: undefined } : { key: id === oldId ? newId : id, value: v }));
  const edges = mapEntries(file.edges, (id, v) => {
    const s = splitEdgeId(id);
    if (!s || (s.source !== oldId && s.target !== oldId)) return { value: v };
    const src = s.source === oldId ? newId : s.source;
    const tgt = s.target === oldId ? newId : s.target;
    return { key: `${src}->${tgt}${s.suffix}`, value: v };
  });
  return build({ ...partsOf(file), nodes, edges });
}

/** v1.0 name of `renameNode`. */
export const renamePinNode = renameNode;

/** UI19: every pin and bend point in the old lane records the new lane id. */
export function renameLane(file: LayoutFile | null, oldLane: string, newLane: string): LayoutFile | null {
  if (!file) return null;
  const nodes = mapEntries(file.nodes, (_id, e) => {
    const pin = pinOf(e);
    return { value: pin && pin.lane === oldLane ? nodeEntry({ ...pin, lane: newLane }, sizeOf(e)) : e };
  });
  const edges = mapEntries(file.edges, (_id, e) => ({
    value: e.points && e.points.some((p) => p.lane === oldLane)
      ? { ...e, points: e.points.map((p) => (p.lane === oldLane ? { ...p, lane: newLane } : p)) }
      : e,
  }));
  return build({ ...partsOf(file), nodes, edges });
}

/** v1.0 name of `renameLane` (it now renames bend points too). */
export const renameLaneInPins = renameLane;

/** UI21: remove the `points` of every line with a bend point in any of these lanes (emptied entries go). */
export function dropPointsInLanes(file: LayoutFile | null, lanes: string | Iterable<string>): LayoutFile | null {
  if (!file) return null;
  const set = new Set(typeof lanes === 'string' ? [lanes] : lanes);
  const edges = mapEntries(file.edges, (_id, e) => (
    e.points && e.points.some((p) => set.has(p.lane)) ? { value: patchEntry(e, { points: null }) } : { value: e }
  ));
  return build({ ...partsOf(file), edges });
}

/**
 * §8.2: re-express every bend point in `fromLane` in `toLane` (when the Unassigned lane disappears, its points move
 * to the last remaining lane at the same on-screen position): `along` and `across` shift by the given amounts.
 */
export function movePointsToLane(
  file: LayoutFile | null, fromLane: string, toLane: string, shift: { along?: number; across: number },
): LayoutFile | null {
  if (!file) return null;
  const da = shift.along ?? 0;
  if (!isCoord(da) || !isCoord(shift.across)) throw new Error('movePointsToLane: shifts must be integers');
  const edges = mapEntries(file.edges, (_id, e) => ({
    value: e.points && e.points.some((p) => p.lane === fromLane)
      ? { ...e, points: e.points.map((p) => (p.lane === fromLane ? { lane: toLane, along: p.along + da + 0, across: p.across + shift.across + 0 } : p)) }
      : e,
  }));
  return build({ ...partsOf(file), edges });
}

/**
 * Rulings R12, R14 and R15: lane `lane` stops being the first displayed lane, and `u` is the growth it had toward its
 * start (§6 Frame). In one write:
 * - every pin and bend point stored in that lane gets `u` added to its `across`, whether it applies or not (stale and
 *   orphaned pins, ignored point sets: R14.2, R14.3);
 * - stored note and title positions get `u` added on the across axis, y for `LR` and x for `TB` (R14.1);
 * - a pin or bend point there that would still be negative applies to nothing (it didn't count toward U), and is
 *   removed so the file stays valid (R15.2): the pin goes (a size stays), the point goes, and a point set left empty
 *   goes (a manual line needs a bend point, R11.1).
 * Entries keep their place. No file stays no file.
 */
export function reexpressOldFirstLane(
  file: LayoutFile | null, lane: string, u: number, direction: 'LR' | 'TB',
): LayoutFile | null {
  if (!file) return null;
  if (!isCoord(u) || u < 0) throw new Error('reexpressOldFirstLane: u must be an integer of at least 0');
  const nodes = mapEntries(file.nodes, (_id, e) => {
    const pin = pinOf(e);
    if (!pin || pin.lane !== lane) return { value: e };
    const across = pin.across + u;
    return { value: nodeEntry(across < 0 ? null : { ...pin, across }, sizeOf(e)) };
  });
  const edges = mapEntries(file.edges, (_id, e) => {
    if (!e.points || !e.points.some((p) => p.lane === lane)) return { value: e };
    const points = e.points
      .map((p) => (p.lane === lane ? { lane: p.lane, along: p.along, across: p.across + u + 0 } : p))
      .filter((p) => p.across >= 0 || p.lane !== lane);
    return { value: patchEntry(e, { points: points.length ? points : null }) };
  });
  const LR = direction !== 'TB';
  const shift = (p: XY): XY => (LR ? { x: p.x, y: p.y + u + 0 } : { x: p.x + u + 0, y: p.y });
  const notes = mapEntries(file.notes, (_id, p) => ({ value: shift(p) }));
  return build({ ...partsOf(file), nodes, edges, notes, title: file.title ? shift(file.title) : undefined });
}

/**
 * UI12 "Re-layout all": remove every pin and every line's `points`; keep sizes, sides, `label_at`, notes, the title
 * position and `hints`. No file stays no file.
 */
export function clearPinsAndPoints(file: LayoutFile | null): LayoutFile | null {
  if (!file) return null;
  const nodes = mapEntries(file.nodes, (_id, e) => ({ value: nodeEntry(null, sizeOf(e)) }));
  const edges = mapEntries(file.edges, (_id, e) => ({ value: patchEntry(e, { points: null }) }));
  return build({ ...partsOf(file), nodes, edges });
}

/** v1.0 name of `clearPinsAndPoints` (UI12's operation; v1.1 also clears bend points). */
export const clearPins = clearPinsAndPoints;

// ---- notes and title ------------------------------------------------------------------------------------------

/** UI41: set a note's position, or with null remove it. Creates the file only when setting. */
export function setNotePosition(file: LayoutFile | null, noteId: string, pos: XY | null): LayoutFile | null {
  if (pos !== null) checkXY(pos);
  if (!file && pos === null) return null;
  const base = file ?? emptyFile();
  return build({ ...partsOf(base), notes: withEntry(base.notes, noteId, pos === null ? undefined : { x: pos.x + 0, y: pos.y + 0 }) });
}

/** Delete notes' positions (a deleted note, UI41; an orphan, UI27). */
export function removeNoteEntries(file: LayoutFile | null, ids: Iterable<string>): LayoutFile | null {
  if (!file) return null;
  const drop = new Set(ids);
  return build({ ...partsOf(file), notes: mapEntries(file.notes, (id, v) => ({ value: drop.has(id) ? undefined : v })) });
}

/** UI42: set the title's position, or with null remove it (Reset position). */
export function setTitlePosition(file: LayoutFile | null, pos: XY | null): LayoutFile | null {
  if (pos !== null) checkXY(pos);
  if (!file && pos === null) return null;
  const base = file ?? emptyFile();
  return build({ ...partsOf(base), title: pos === null ? undefined : { x: pos.x + 0, y: pos.y + 0 } });
}

// ---- direction and hints --------------------------------------------------------------------------------------

const ROTATE: Record<Side, Side> = { right: 'bottom', bottom: 'right', left: 'top', top: 'left' };

/**
 * UI23: flipping the direction keeps pins, sizes, bend points and `label_at`; sides rotate with the diagram
 * (right ↔ bottom, left ↔ top) and note and title positions swap x and y. No file stays no file.
 */
export function flipDirection(file: LayoutFile | null): LayoutFile | null {
  if (!file) return null;
  const edges = mapEntries(file.edges, (_id, e) => ({
    value: patchEntry(e, {
      source_side: e.source_side ? ROTATE[e.source_side] : undefined,
      target_side: e.target_side ? ROTATE[e.target_side] : undefined,
    }),
  }));
  const notes = mapEntries(file.notes, (_id, p) => ({ value: { x: p.y, y: p.x } }));
  return build({ ...partsOf(file), edges, notes, title: file.title ? { x: file.title.y, y: file.title.x } : undefined });
}

/** Replace the layout module's hints (undefined removes them). Keeps everything else. Creates the file if needed. */
export function setHints(file: LayoutFile | null, hints: unknown): LayoutFile {
  return build({ ...partsOf(file ?? emptyFile()), hints });
}

// ---- drop positions -------------------------------------------------------------------------------------------

/** UI10: round to a whole pixel, halves toward −∞ (never −0). */
export function roundPx(v: number): number {
  return Math.ceil(v - 0.5) + 0;
}

/**
 * UI10/UI43 drop: exactly where the block (or bend point) was dropped, rounded to whole pixels. `along` may be
 * negative (before the start of the flow axis), and so may `across` in the first displayed lane (`firstLane`: before
 * the first lane, or the top of a lane-free diagram); the layout's frame translates to contain them (§6). In any other
 * lane `across` is at least 0: it lands on that lane's start edge (§5 Values).
 */
export function pinFromDrop(lane: string, along: number, across: number, firstLane: string): Pin {
  const c = roundPx(across);
  return { lane, along: roundPx(along), across: lane === firstLane ? c : Math.max(0, c) };
}
