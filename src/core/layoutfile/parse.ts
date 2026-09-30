// Reading the `.layout.json` file (§5) and checking it against the diagram. Pure: text in, data out.
//
// Two stages, because some rules need the diagram:
// - `parseLayoutFile` checks everything the file alone decides: the keys, every value's type and range (integers;
//   sizes at least 40; sides; `label_at` 0 to 1 with at most two decimals; no empty entry). Any failure is `E-layout`
//   (line null) and the file is dropped: the diagram lays out with none of its placements.
// - `checkRanges` needs the display lane order: `across` (of pins and bend points) may be negative only in the first
//   displayed lane. `checkLayoutRefs` needs the ids: warnings for entries of unknown nodes, edges and notes.
// `effectivePlacements` then says what applies: stale pins and point sets with a missing lane are ignored.
import type {
  LayoutEdgeEntry, LayoutFile, LayoutLaneEntry, LayoutNodeEntry, Pin, Problem, Problems, Side, Size, XY,
} from '../types';
import { pinOf, sizeOf, SIDES } from '../types';

export interface LayoutParse {
  /** The file, or null when there is no file or it has errors (§5: lay out with none of its placements). */
  file: LayoutFile | null;
  problems: Problems;
}

const TOP_KEYS = new Set(['version', 'nodes', 'lanes', 'lane_length', 'edges', 'notes', 'title', 'hints']);
const PIN_KEYS = ['lane', 'along', 'across'] as const;
const SIZE_KEYS = ['width', 'height'] as const;
const NODE_KEYS = new Set<string>([...PIN_KEYS, ...SIZE_KEYS]);
const EDGE_KEYS = new Set(['source_side', 'target_side', 'points', 'label_at']);
const XY_KEYS = new Set(['x', 'y']);
const LANE_KEYS = new Set(['size']);

/** The smallest stored width or height (§5). */
export const MIN_SIZE = 40;
/** The smallest stored lane size (A8): every lane is at least 100 px across anyway (§6 L1). */
export const MIN_LANE_SIZE = 100;
/**
 * The smallest stored lane length along the flow (A13), matching a lane size's minimum. Never binding in practice: a
 * diagram with lanes is always longer than this (the header strip, the lead and a first column), and the stored value
 * is only a minimum.
 */
export const MIN_LANE_LENGTH = MIN_LANE_SIZE;

const err = (message: string): Problem => ({ code: 'E-layout', line: null, message });
const warn = (code: string, message: string): Problem => ({ code, line: null, message });

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Define an own property, safe for any key (a key such as `__proto__` must not touch the prototype). */
export function put<T>(obj: Record<string, T>, key: string, value: NoInfer<T>): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

/** An integer position (§5 Values: every number is an integer except `label_at`). Negative allowed here. */
export const isCoord = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
/** A stored width or height: an integer of at least 40. */
export const isSizeValue = (v: unknown): v is number => isCoord(v) && v >= MIN_SIZE;
/** A stored lane size (A8): an integer of at least 100. */
export const isLaneSizeValue = (v: unknown): v is number => isCoord(v) && v >= MIN_LANE_SIZE;
/** A stored lane length along the flow (A13): an integer of at least 100. */
export const isLaneLengthValue = (v: unknown): v is number => isCoord(v) && v >= MIN_LANE_LENGTH;
export const isSide = (v: unknown): v is Side => typeof v === 'string' && (SIDES as readonly string[]).includes(v);
/** `label_at`: a number from 0 to 1 with at most two decimals. */
export const isLabelAt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 && Number(v.toFixed(2)) === v;

const keyList = (keys: string[]) => keys.map((k) => `"${k}"`).join(', ');
const unknownKeys = (o: Record<string, unknown>, allowed: Set<string>) => Object.keys(o).filter((k) => !allowed.has(k));

/** Normalise −0 to 0 (JSON `-0` parses to −0; it is written as 0). */
const n0 = (v: number) => v + 0;

/** Check one pin-shaped value (a pin's fields, or a bend point). Returns the problems, empty when fine. */
function pinProblems(o: Record<string, unknown>): string[] {
  const bad: string[] = [];
  if (typeof o.lane !== 'string') bad.push('"lane" must be a lane id');
  if (!isCoord(o.along)) bad.push('"along" must be an integer');
  if (!isCoord(o.across)) bad.push('"across" must be an integer');
  return bad;
}

function readNodeEntry(v: unknown): { entry?: LayoutNodeEntry; bad: string[] } {
  if (!isObject(v)) return { bad: ['must be an object {lane, along, across}'] };
  const keys = Object.keys(v);
  if (keys.length === 0) return { bad: ['is empty (an entry holds a pin, a size, or both)'] };
  const bad: string[] = [];
  const extra = unknownKeys(v, NODE_KEYS);
  if (extra.length) bad.push(`unknown key${extra.length > 1 ? 's' : ''} ${keyList(extra)}`);
  const pinKeys = PIN_KEYS.filter((k) => k in v);
  const sizeKeys = SIZE_KEYS.filter((k) => k in v);
  if (pinKeys.length > 0 && pinKeys.length < PIN_KEYS.length) {
    bad.push(`a pin needs all of "lane", "along" and "across" (has only ${keyList(pinKeys)})`);
  } else if (pinKeys.length) bad.push(...pinProblems(v));
  if (sizeKeys.length === 1) bad.push(`a size needs both "width" and "height" (has only ${keyList(sizeKeys)})`);
  else if (sizeKeys.length === 2) {
    if (!isSizeValue(v.width)) bad.push(`"width" must be an integer of at least ${MIN_SIZE}`);
    if (!isSizeValue(v.height)) bad.push(`"height" must be an integer of at least ${MIN_SIZE}`);
  }
  if (bad.length) return { bad };
  const entry: LayoutNodeEntry = {};
  if (pinKeys.length) Object.assign(entry, { lane: v.lane as string, along: n0(v.along as number), across: n0(v.across as number) });
  if (sizeKeys.length) Object.assign(entry, { width: v.width as number, height: v.height as number });
  return { entry, bad };
}

function readEdgeEntry(v: unknown): { entry?: LayoutEdgeEntry; bad: string[] } {
  if (!isObject(v)) return { bad: ['must be an object with any of source_side, target_side, points, label_at'] };
  if (Object.keys(v).length === 0) return { bad: ['is empty'] };
  const bad: string[] = [];
  const extra = unknownKeys(v, EDGE_KEYS);
  if (extra.length) bad.push(`unknown key${extra.length > 1 ? 's' : ''} ${keyList(extra)}`);
  for (const k of ['source_side', 'target_side'] as const) {
    if (k in v && !isSide(v[k])) bad.push(`"${k}" must be top, right, bottom or left`);
  }
  const points: Pin[] = [];
  if ('points' in v) {
    if (!Array.isArray(v.points) || v.points.length === 0) bad.push('"points" must be a non-empty list of {lane, along, across}');
    else {
      v.points.forEach((p, i) => {
        if (!isObject(p)) { bad.push(`point ${i + 1} must be an object {lane, along, across}`); return; }
        const pe = unknownKeys(p, new Set(PIN_KEYS));
        const pb = pinProblems(p);
        if (pe.length) pb.unshift(`unknown key${pe.length > 1 ? 's' : ''} ${keyList(pe)}`);
        if (pb.length) bad.push(`point ${i + 1}: ${pb.join(', ')}`);
        else points.push({ lane: p.lane as string, along: n0(p.along as number), across: n0(p.across as number) });
      });
    }
  }
  if ('label_at' in v && !isLabelAt(v.label_at)) bad.push('"label_at" must be a number from 0 to 1 with at most two decimals');
  if (bad.length) return { bad };
  const entry: LayoutEdgeEntry = {};
  if ('source_side' in v) entry.source_side = v.source_side as Side;
  if ('target_side' in v) entry.target_side = v.target_side as Side;
  if ('points' in v) entry.points = points;
  if ('label_at' in v) entry.label_at = n0(v.label_at as number);
  return { entry, bad };
}

function readXY(v: unknown): { xy?: XY; bad: string[] } {
  if (!isObject(v)) return { bad: ['must be an object {x, y}'] };
  if (Object.keys(v).length === 0) return { bad: ['is empty'] };
  const bad: string[] = [];
  const extra = unknownKeys(v, XY_KEYS);
  if (extra.length) bad.push(`unknown key${extra.length > 1 ? 's' : ''} ${keyList(extra)}`);
  if (!isCoord(v.x)) bad.push('"x" must be an integer');
  if (!isCoord(v.y)) bad.push('"y" must be an integer');
  return bad.length ? { bad } : { xy: { x: n0(v.x as number), y: n0(v.y as number) }, bad };
}

function readLaneEntry(v: unknown): { entry?: LayoutLaneEntry; bad: string[] } {
  if (!isObject(v)) return { bad: ['must be an object {size}'] };
  if (Object.keys(v).length === 0) return { bad: ['is empty'] };
  const bad: string[] = [];
  const extra = unknownKeys(v, LANE_KEYS);
  if (extra.length) bad.push(`unknown key${extra.length > 1 ? 's' : ''} ${keyList(extra)}`);
  if (!isLaneSizeValue(v.size)) bad.push(`"size" must be an integer of at least ${MIN_LANE_SIZE}`);
  return bad.length ? { bad } : { entry: { size: v.size as number }, bad };
}

/**
 * Read an id-keyed map section, reporting every bad entry. `label` names an entry in messages (v1.0's wording is kept
 * for pins, so a v1.0 file's `validate` output is unchanged).
 */
function readSection<T>(
  js: Record<string, unknown>, key: string, what: string, problems: Problems,
  read: (v: unknown) => { value?: T; bad: string[] },
  label: (id: string, v: unknown) => string,
): Record<string, T> | undefined {
  if (!(key in js)) return undefined;
  const section = js[key];
  if (!isObject(section)) {
    problems.errors.push(err(`Layout file "${key}" must be an object of ${what}`));
    return undefined;
  }
  const out: Record<string, T> = {};
  for (const [id, v] of Object.entries(section)) {
    const r = read(v);
    if (r.bad.length || r.value === undefined) {
      problems.errors.push(err(isObject(v) ? `${label(id, v)}: ${r.bad.join('; ')}` : `${label(id, v)} ${r.bad.join('; ')}`));
    } else put(out, id, r.value);
  }
  return out;
}

const hasPinKey = (v: unknown) => !isObject(v) || PIN_KEYS.some((k) => k in v);

/**
 * Parse a layout file (§5). `E-layout` (line null) for invalid JSON, a key outside §5's list (plus `hints`, which may
 * hold anything and passes through untouched), an empty entry, or a value of the wrong type or range. Every bad
 * entry is reported. An empty `lanes`, `edges` or `notes` map is accepted and dropped (the writer never writes one).
 * (A8) `lanes` maps a lane id to `{size}`; an entry for a lane that doesn't exist is not a problem here (the UI's next
 * write drops it). (A13) `lane_length` is one integer of at least 100.
 */
export function parseLayoutFile(text: string | null): LayoutParse {
  const problems: Problems = { errors: [], warnings: [] };
  if (text === null) return { file: null, problems };
  let js: unknown;
  try {
    js = JSON.parse(text);
  } catch (e) {
    problems.errors.push(err(`Layout file is not valid JSON: ${(e as Error).message}`));
    return { file: null, problems };
  }
  if (!isObject(js)) {
    problems.errors.push(err('Layout file must be a JSON object {"version": 1, "nodes": {…}}'));
    return { file: null, problems };
  }
  for (const k of Object.keys(js)) {
    if (!TOP_KEYS.has(k)) problems.errors.push(err(`Layout file has an unknown key "${k}"`));
  }
  if (js.version !== 1) problems.errors.push(err(`Layout file "version" must be 1 (found ${JSON.stringify(js.version)})`));
  if (!('nodes' in js)) problems.errors.push(err('Layout file "nodes" must be an object of pins'));
  const nodes = readSection(js, 'nodes', 'pins', problems, (v) => {
    const r = readNodeEntry(v);
    return { value: r.entry, bad: r.bad };
  }, (id, v) => (hasPinKey(v) ? `Pin "${id}"` : `Node entry "${id}"`));
  const lanes = readSection(js, 'lanes', 'lane sizes by lane id', problems, (v) => {
    const r = readLaneEntry(v);
    return { value: r.entry, bad: r.bad };
  }, (id) => `Lane entry "${id}"`);
  const edges = readSection(js, 'edges', 'line entries by edge id', problems, (v) => {
    const r = readEdgeEntry(v);
    return { value: r.entry, bad: r.bad };
  }, (id) => `Line entry "${id}"`);
  const notes = readSection(js, 'notes', 'note positions by note id', problems, (v) => {
    const r = readXY(v);
    return { value: r.xy, bad: r.bad };
  }, (id) => `Note position "${id}"`);
  let laneLength: number | undefined;
  if ('lane_length' in js) {
    if (isLaneLengthValue(js.lane_length)) laneLength = js.lane_length + 0;
    else problems.errors.push(err(`Layout file "lane_length" must be an integer of at least ${MIN_LANE_LENGTH}`));
  }
  let title: XY | undefined;
  if ('title' in js) {
    const r = readXY(js.title);
    if (r.xy) title = r.xy;
    else problems.errors.push(err(`Layout file "title" ${r.bad.join('; ')}`));
  }
  if (problems.errors.length) return { file: null, problems };
  const file: LayoutFile = { version: 1, nodes: nodes ?? {} };
  if (lanes && Object.keys(lanes).length) file.lanes = lanes;
  if (laneLength !== undefined) file.lane_length = laneLength;
  if (edges && Object.keys(edges).length) file.edges = edges;
  if (notes && Object.keys(notes).length) file.notes = notes;
  if (title) file.title = title;
  if ('hints' in js) file.hints = js.hints;
  return { file, problems };
}

// ---------------------------------------------------------------------------------------------------------------
// Checks against the diagram

export interface NodeLane {
  id: string;
  /** The node's lane in the `.mmd`, or `_unassigned`. */
  lane: string;
}

/** The first displayed lane (§6 L1): the first in display order, or `_unassigned` when the diagram has no lanes. */
export function firstLaneOf(laneOrderIds: readonly string[]): string {
  return laneOrderIds[0] ?? '_unassigned';
}

/**
 * §5 Values: `across` may be negative only in the first displayed lane (`firstLane`; `_unassigned` in a lane-free
 * diagram), for pins and bend points alike. Anything else is out of range: `E-layout` (line null), and the diagram
 * lays out with none of the file's placements. Checked whether or not the pin or point set applies.
 */
export function checkRanges(file: LayoutFile | null, firstLane: string): Problem[] {
  if (!file) return [];
  const out: Problem[] = [];
  for (const [id, entry] of Object.entries(file.nodes)) {
    const pin = pinOf(entry);
    if (pin && pin.across < 0 && pin.lane !== firstLane) {
      out.push(err(`Pin "${id}": "across" must be at least 0 outside the first lane`));
    }
  }
  for (const [id, entry] of Object.entries(file.edges ?? {})) {
    const i = (entry.points ?? []).findIndex((p) => p.across < 0 && p.lane !== firstLane);
    if (i >= 0) out.push(err(`Edge "${id}" point ${i + 1}: "across" must be at least 0 outside the first lane`));
  }
  return out;
}

/** v1.0 name of `checkRanges` (it now checks bend points too). */
export const checkPinRanges = checkRanges;

/**
 * Entries for ids that don't exist (§5, UI27): `W-layout-unknown-node` (node entries, pinned or sized),
 * `W-layout-unknown-edge` (when `edgeIds` is given) and `W-layout-unknown-note` (when `noteIds` is given; pass null
 * while the config has `E-config`, UI31: its notes can't be read, so every note would look orphaned). In that order,
 * each in file order.
 */
export function checkLayoutRefs(
  file: LayoutFile | null,
  nodes: Iterable<NodeLane>,
  edgeIds?: Iterable<string>,
  noteIds?: Iterable<string> | null,
): Problem[] {
  if (!file) return [];
  const ids = new Set([...nodes].map((n) => n.id));
  const out = Object.keys(file.nodes)
    .filter((id) => !ids.has(id))
    .map((id) => warn('W-layout-unknown-node', pinOf(file.nodes[id])
      ? `Layout file pins "${id}", which is not in the diagram`
      : `Layout file sizes "${id}", which is not in the diagram`));
  if (edgeIds) {
    const edges = new Set(edgeIds);
    for (const id of Object.keys(file.edges ?? {})) {
      if (!edges.has(id)) out.push(warn('W-layout-unknown-edge', `Layout file has an entry for line "${id}", which is not in the diagram`));
    }
  }
  if (noteIds) {
    const notes = new Set(noteIds);
    for (const id of Object.keys(file.notes ?? {})) {
      if (!notes.has(id)) out.push(warn('W-layout-unknown-note', `Layout file places note "${id}", which is not in the config`));
    }
  }
  return out;
}

/** The pins that apply: the node exists and the pin's lane is still the node's lane (§5; otherwise auto-placed). */
export function effectivePins(file: LayoutFile | null, nodes: Iterable<NodeLane>): Map<string, Pin> {
  const out = new Map<string, Pin>();
  if (!file) return out;
  for (const n of nodes) {
    const pin = pinOf(Object.hasOwn(file.nodes, n.id) ? file.nodes[n.id] : undefined);
    if (pin && pin.lane === n.lane) out.set(n.id, pin);
  }
  return out;
}

/** What of the file applies to this diagram (§5). */
export interface Placements {
  /** Pins of existing nodes whose lane still matches. */
  pins: Map<string, Pin>;
  /** Sizes of existing nodes (a size applies even when its pin is ignored). */
  sizes: Map<string, Size>;
  /** Entries of existing edges; `points` is left out when any point's lane doesn't exist (the line is automatic). */
  edges: Map<string, LayoutEdgeEntry>;
  /** Positions of existing notes (all note entries when `noteIds` is not given). */
  notes: Map<string, XY>;
  title: XY | null;
}

export interface PlacementTargets {
  nodes: Iterable<NodeLane>;
  edges: Iterable<{ id: string }>;
  /** The displayed lanes, `_unassigned` included when it shows. */
  lanes: Iterable<{ id: string }>;
  /** Existing note ids; omitted: every note entry counts. */
  noteIds?: Iterable<string>;
}

/** The effective placements (§5): what the layout applies. Everything else in the file is ignored. */
export function effectivePlacements(file: LayoutFile | null, t: PlacementTargets): Placements {
  const out: Placements = { pins: new Map(), sizes: new Map(), edges: new Map(), notes: new Map(), title: null };
  if (!file) return out;
  const nodes = [...t.nodes];
  out.pins = effectivePins(file, nodes);
  for (const n of nodes) {
    const size = sizeOf(Object.hasOwn(file.nodes, n.id) ? file.nodes[n.id] : undefined);
    if (size) out.sizes.set(n.id, size);
  }
  const lanes = new Set([...t.lanes].map((l) => l.id));
  const edgeEntries = file.edges ?? {};
  for (const e of t.edges) {
    if (!Object.hasOwn(edgeEntries, e.id)) continue;
    const entry = { ...edgeEntries[e.id]! };
    if (entry.points) {
      if (entry.points.every((p) => lanes.has(p.lane))) entry.points = entry.points.map((p) => ({ ...p }));
      else delete entry.points;
    }
    if (Object.keys(entry).length) out.edges.set(e.id, entry);
  }
  const notes = file.notes ?? {};
  const noteIds = t.noteIds ? [...t.noteIds] : Object.keys(notes);
  for (const id of noteIds) if (Object.hasOwn(notes, id)) out.notes.set(id, { ...notes[id]! });
  out.title = file.title ? { ...file.title } : null;
  return out;
}
