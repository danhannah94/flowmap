// The `.layout.json` file (§5): reading, checking against the diagram, and the UI's writes (UI10–UI14, UI19, UI21,
// UI27). Pure: text in, text out. Write operations take and return `LayoutFile | null` (null: no file on disk), so an
// operation that has nothing to write never creates a file (UI28).
import type { LayoutFile, Pin, Problem, Problems } from '../types';

export interface LayoutParse {
  /** The file, or null when there is no file or it has errors (§5: lay out with no pins). */
  file: LayoutFile | null;
  problems: Problems;
}

const TOP_KEYS = new Set(['version', 'nodes', 'hints']);
const PIN_KEYS = ['lane', 'along', 'across'] as const;

const err = (message: string): Problem => ({ code: 'E-layout', line: null, message });

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A pin coordinate: an integer, possibly negative (v1.1 §5: a block dropped before or above everything). */
const isCoord = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Parse a layout file. `E-layout` (line null) for invalid JSON or anything outside the §5 shape: a top-level object with
 * `version: 1` and a `nodes` object of pins, each exactly `{lane: string, along, across}` with integer coordinates
 * (negative allowed: the layout translates, §6). `hints` may hold anything and is passed through untouched.
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
  const nodes: Record<string, Pin> = {};
  if (!isObject(js.nodes)) {
    problems.errors.push(err('Layout file "nodes" must be an object of pins'));
  } else {
    for (const [id, pin] of Object.entries(js.nodes)) {
      if (!isObject(pin)) { problems.errors.push(err(`Pin "${id}" must be an object {lane, along, across}`)); continue; }
      const extra = Object.keys(pin).filter((k) => !(PIN_KEYS as readonly string[]).includes(k));
      const bad: string[] = [];
      if (extra.length) bad.push(`unknown key${extra.length > 1 ? 's' : ''} ${extra.map((k) => `"${k}"`).join(', ')}`);
      if (typeof pin.lane !== 'string') bad.push('"lane" must be a lane id');
      if (!isCoord(pin.along)) bad.push('"along" must be an integer');
      if (!isCoord(pin.across)) bad.push('"across" must be an integer');
      if (bad.length) { problems.errors.push(err(`Pin "${id}": ${bad.join('; ')}`)); continue; }
      nodes[id] = { lane: pin.lane as string, along: pin.along as number, across: pin.across as number };
    }
  }
  if (problems.errors.length) return { file: null, problems };
  const file: LayoutFile = { version: 1, nodes };
  if ('hints' in js) file.hints = js.hints;
  return { file, problems };
}

export interface NodeLane {
  id: string;
  /** The node's lane in the `.mmd`, or `_unassigned`. */
  lane: string;
}

/** `W-layout-unknown-node` for each pin whose id is not a node in the `.mmd` (§5, UI27). */
export function checkLayoutRefs(file: LayoutFile | null, nodes: Iterable<NodeLane>): Problem[] {
  if (!file) return [];
  const ids = new Set([...nodes].map((n) => n.id));
  return Object.keys(file.nodes)
    .filter((id) => !ids.has(id))
    .map((id) => ({ code: 'W-layout-unknown-node', line: null, message: `Layout file pins "${id}", which is not in the diagram` }));
}

/** The pins that apply: the node exists and the pin's lane is still the node's lane (§5; otherwise auto-placed). */
export function effectivePins(file: LayoutFile | null, nodes: Iterable<NodeLane>): Map<string, Pin> {
  const out = new Map<string, Pin>();
  if (!file) return out;
  for (const n of nodes) {
    const pin = Object.hasOwn(file.nodes, n.id) ? file.nodes[n.id] : undefined;
    if (pin && pin.lane === n.lane) out.set(n.id, { ...pin });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Writes. Pins keep their order in the file; a new pin is added at the end; a renamed pin keeps its place.

function emptyFile(): LayoutFile {
  return { version: 1, nodes: {} };
}

function withNodes(file: LayoutFile, nodes: Record<string, Pin>): LayoutFile {
  const out: LayoutFile = { version: 1, nodes };
  if (file.hints !== undefined) out.hints = file.hints;
  return out;
}

/** UI10: round to a whole pixel, halves toward −∞ (never −0). */
export function roundPx(v: number): number {
  return Math.ceil(v - 0.5) + 0;
}

/**
 * UI10/UI43 drop: exactly where the block was dropped, rounded to whole pixels. `along` may be negative (before the
 * start of the flow axis), and so may `across` in the first displayed lane (`firstLane`: before the first lane, or the
 * top of a lane-free diagram); the layout's frame translates to contain them (§6). In any other lane `across` is at
 * least 0: a block dropped across a later lane's start edge lands on that edge (§5 Values).
 */
export function pinFromDrop(lane: string, along: number, across: number, firstLane: string): Pin {
  const c = roundPx(across);
  return { lane, along: roundPx(along), across: lane === firstLane ? c : Math.max(0, c) };
}

/**
 * §5 Values: `across` may be negative only in the first displayed lane (`firstLane`; `_unassigned` in a lane-free
 * diagram). Anything else is out of range: `E-layout` (line null), and the diagram lays out with none of the file's
 * placements.
 */
export function checkPinRanges(file: LayoutFile | null, firstLane: string): Problem[] {
  if (!file) return [];
  return Object.entries(file.nodes)
    .filter(([, pin]) => pin.across < 0 && pin.lane !== firstLane)
    .map(([id]) => err(`Pin "${id}": "across" must be at least 0 outside the first lane`));
}

/** The first displayed lane (§6 L1): the first in display order, or `_unassigned` when the diagram has no lanes. */
export function firstLaneOf(laneOrderIds: readonly string[]): string {
  return laneOrderIds[0] ?? '_unassigned';
}

function checkPin(pin: Pin): void {
  if (typeof pin.lane !== 'string' || !isCoord(pin.along) || !isCoord(pin.across)) {
    throw new Error(`invalid pin ${JSON.stringify(pin)}: along/across must be integers`);
  }
}

/** Pin (or re-pin) a node. Creates the file if there is none. */
export function setPin(file: LayoutFile | null, id: string, pin: Pin): LayoutFile {
  return setPins(file, [[id, pin]]);
}

/** Pin several nodes at once (one drag of a selection is one write). */
export function setPins(file: LayoutFile | null, pins: Iterable<[string, Pin]>): LayoutFile {
  const base = file ?? emptyFile();
  const nodes = { ...base.nodes };
  for (const [id, pin] of pins) {
    checkPin(pin);
    nodes[id] = { lane: pin.lane, along: pin.along, across: pin.across };
  }
  return withNodes(base, nodes);
}

/** Unpin nodes (UI12, UI14, UI27). No file stays no file. */
export function removePins(file: LayoutFile | null, ids: Iterable<string>): LayoutFile | null {
  if (!file) return null;
  const drop = new Set(ids);
  const nodes: Record<string, Pin> = {};
  for (const [id, pin] of Object.entries(file.nodes)) if (!drop.has(id)) nodes[id] = pin;
  return withNodes(file, nodes);
}

export function removePin(file: LayoutFile | null, id: string): LayoutFile | null {
  return removePins(file, [id]);
}

/** UI12 "Re-layout all": no pins, `hints` kept. No file stays no file. */
export function clearPins(file: LayoutFile | null): LayoutFile | null {
  return file ? withNodes(file, {}) : null;
}

/** UI9: the pin moves to the new id, in place. */
export function renamePinNode(file: LayoutFile | null, oldId: string, newId: string): LayoutFile | null {
  if (!file || !Object.hasOwn(file.nodes, oldId) || oldId === newId) return file;
  const nodes: Record<string, Pin> = {};
  for (const [id, pin] of Object.entries(file.nodes)) {
    if (id === newId) continue;
    nodes[id === oldId ? newId : id] = pin;
  }
  return withNodes(file, nodes);
}

/** UI19: every pin in the old lane records the new lane id. */
export function renameLaneInPins(file: LayoutFile | null, oldLane: string, newLane: string): LayoutFile | null {
  if (!file) return null;
  const nodes: Record<string, Pin> = {};
  for (const [id, pin] of Object.entries(file.nodes)) nodes[id] = pin.lane === oldLane ? { ...pin, lane: newLane } : pin;
  return withNodes(file, nodes);
}

/** Replace the layout module's hints (undefined removes them). Creates the file if there is none. */
export function setHints(file: LayoutFile | null, hints: unknown): LayoutFile {
  const out: LayoutFile = { version: 1, nodes: { ...(file ?? emptyFile()).nodes } };
  if (hints !== undefined) out.hints = hints;
  return out;
}

/**
 * The file text: 2-space JSON, keys in a fixed order (`version`, `nodes`, `hints`; each pin `lane`, `along`,
 * `across` on one line), pins in file order, ending with a newline. The fixture's layout file round-trips unchanged.
 */
export function serializeLayoutFile(file: LayoutFile): string {
  const entries = Object.entries(file.nodes);
  const nodes = entries.length === 0
    ? '{}'
    : `{\n${entries.map(([id, p]) => `    ${JSON.stringify(id)}: { "lane": ${JSON.stringify(p.lane)}, "along": ${p.along}, "across": ${p.across} }`).join(',\n')}\n  }`;
  let out = `{\n  "version": 1,\n  "nodes": ${nodes}`;
  if (file.hints !== undefined) {
    const h = JSON.stringify(file.hints, null, 2);
    if (h !== undefined) out += `,\n  "hints": ${h.split('\n').join('\n  ')}`;
  }
  return out + '\n}\n';
}
