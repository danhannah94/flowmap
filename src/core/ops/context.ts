// The shared machinery of the operations layer (design.md §8.1, §8.2): every UI edit is a pure function over the
// diagram's three files. An operation loads all three (refusing everything if the `.mmd` has errors), edits a copy of
// the `.mmd` model, edits the config through `ConfigDoc` (which splices bytes minimally, UI26) and the layout file
// through the `layoutfile` pin operations, then writes the `.mmd` with `format()` (canonical, §3.3).
//
// The three rules at the top of §8.2 are enforced here:
// - Order: `sortByDeclaration` puts several blocks in file declaration order.
// - Files with errors: an operation that would change a config or layout file that has errors is refused. Because a
//   broken file can't be read, "would change" is decided conservatively: an operation that always writes that file
//   is refused, and one that writes it only for certain ids is refused if any of those ids appears in the raw text.
// - Undo of created files: a file that was `null` (absent) and isn't written stays `null`, so a snapshot of the
//   input restores "no file".
//
// v1.1 adds "Keeping the layout file in step" (§8.2): `rekeyEdgeEntries` re-keys edge entries by position after an
// operation changes the edge list, and `commit` re-expresses bend points in `_unassigned` when an operation makes the
// Unassigned lane disappear. A config whose note ids clash with node or lane ids has errors (§4, UI31), as in the UI.

import { checkNoteClashes, ConfigDoc, laneOrder, parseConfig, type EditResult, type FlowConfig } from '../config';
import {
  checkPinRanges, effectivePlacements, firstLaneOf, movePointsToLane, parseLayoutFile, rekeyEdgesByPosition,
  serializeLayoutFile,
} from '../layoutfile';
import { pinTranslation, type LayoutOutput, type Translation } from '../layout';
import { loadDocument } from '../document';
import {
  declaredNodes, edgeIds, findNode, format, isIdForm, isReservedId, parse, toGraph, undeclaredNodes,
  type Diagram, type Edge, type NodeDecl,
} from '../mmd';
import { UNASSIGNED, type Graph, type LayoutFile } from '../types';

/** The diagram's three files. `null` means the file doesn't exist (only the `.mmd` is required, §2). */
export interface Files {
  mmd: string;
  config: string | null;
  layout: string | null;
}

/** The result of an operation: the new files (plus any values the operation reports), or why it was refused. */
export type OpResult<T extends object = object> = ({ ok: true; files: Files } & T) | { ok: false; error: string };

class Refusal extends Error {}

/** Refuse the operation with a message for the person (shown by the UI). */
export function refuse(message: string): never {
  throw new Refusal(message);
}

/** True if `id` appears in `text` as a whole id-like token (used to decide whether a broken file would change). */
export function mentions(text: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`).test(text);
}

/** Which ids an edit to a file depends on: `'always'` if it writes the file whatever it holds. */
export type Mentions = 'always' | readonly string[];

export class Ctx {
  /** A private copy of the parsed `.mmd`, edited in place by the operation. */
  readonly d: Diagram;
  configText: string | null;
  /** The config as loaded, or null if it has errors (or, when there is no file, an empty config). */
  readonly config: FlowConfig | null;
  readonly configBroken: boolean;
  readonly layoutBroken: boolean;
  /** The layout file being edited (null: no file). */
  layout: LayoutFile | null;
  /** The layout file as loaded (null: no file, or it has errors). */
  readonly layoutIn: LayoutFile | null;
  /** The `.mmd` as loaded (never edited): the diagram the person was looking at. */
  readonly original: Diagram;
  /**
   * The config that decides lane order: the parsed config even when a note-id clash gives it errors (a clash doesn't
   * stop the file being read, and `loadDocument` orders lanes by it too).
   */
  private readonly orderConfig: FlowConfig | null;
  /** The edges as loaded, by identity (the operation edits these objects in place), and their ids then. */
  private readonly edgesIn: readonly Edge[];
  private readonly edgeIdsIn: readonly string[];
  private rekeyed = false;
  private frameIn: Translation | null = null;

  constructor(readonly input: Files) {
    const { diagram, problems } = parse(input.mmd);
    if (problems.errors.length) {
      const first = problems.errors[0]!;
      refuse(`The .mmd file has errors (${first.code} at line ${first.line}); fix it before editing`);
    }
    this.original = diagram;
    this.d = structuredClone(diagram);
    this.edgesIn = [...this.d.edges];
    this.edgeIdsIn = edgeIds(this.d.edges);
    this.configText = input.config;
    const cfg = parseConfig(input.config);
    this.orderConfig = cfg.config;
    // §4 (v1.1): a note id equal to a node or subgraph id is E-config, so the config counts as having errors (UI31).
    const clash = checkNoteClashes(cfg.config, this.nodeOrder(), this.d.lanes.map((l) => l.id)).length > 0;
    this.config = clash ? null : cfg.config;
    this.configBroken = this.config === null;
    const lay = parseLayoutFile(input.layout);
    // A file that parses but has a value out of range for this diagram (§5 Values) is a file with errors too.
    const file = lay.file && checkPinRanges(lay.file, this.firstLane()).length === 0 ? lay.file : null;
    this.layoutBroken = input.layout !== null && file === null;
    this.layoutIn = file;
    this.layout = file === null ? null : structuredClone(file);
  }

  /** The first displayed lane now (§6 L1; `_unassigned` in a lane-free diagram): the only one whose `across` may be < 0. */
  firstLane(): string {
    return firstLaneOf(laneOrder(this.orderConfig, this.d.lanes.map((l) => l.id)));
  }

  /** The diagram as loaded, as the layout sees it (lanes in display order, `_unassigned` last when it shows). */
  graphIn(): Graph {
    return toGraph(this.original, laneOrder(this.orderConfig, this.original.lanes.map((l) => l.id)));
  }

  /**
   * The frame (§6) of the diagram as loaded: T and U from the pins and bend points that apply, exactly as the layout
   * function works it out (`LayoutOutput.translation`). Used when a caller gives a bare `LayoutResult`.
   */
  frame(): Translation {
    if (this.frameIn) return this.frameIn;
    const graph = this.graphIn();
    const placed = effectivePlacements(this.layoutIn, { nodes: graph.nodes, edges: graph.edges, lanes: graph.lanes });
    const points = [...placed.edges.values()].flatMap((e) => e.points ?? []);
    this.frameIn = pinTranslation([...placed.pins.values(), ...points], graph.lanes[0]?.id);
    return this.frameIn;
  }

  // ---- files with errors

  private blocked(text: string | null, broken: boolean, deps: Mentions): boolean {
    if (!broken || text === null) return false;
    return deps === 'always' || deps.some((id) => mentions(text, id));
  }

  /**
   * Apply a config edit. If the config has errors, the edit is refused when it could change the file (`deps`), and
   * otherwise skipped (the file is left alone).
   */
  editConfig(deps: Mentions, edit: (doc: ConfigDoc) => EditResult): void {
    if (this.configBroken) {
      if (this.blocked(this.configText, true, deps)) {
        refuse('The config file has errors; fix it before making this change (it would edit the config)');
      }
      return;
    }
    const r = edit(new ConfigDoc(this.configText));
    if (!r.ok) refuse(r.error);
    this.configText = r.text;
  }

  /** Apply a layout-file edit; same rules as `editConfig` for a layout file with errors. */
  editLayout(deps: Mentions, edit: (file: LayoutFile | null) => LayoutFile | null): void {
    if (this.layoutBroken) {
      if (this.blocked(this.input.layout, true, deps)) {
        refuse('The layout file has errors; fix it before making this change (it would edit the pins)');
      }
      return;
    }
    this.layout = edit(this.layout);
  }

  /** Refuse if the config can't be edited at all (for operations that always write it). */
  requireConfig(): void {
    if (this.configBroken) refuse('The config file has errors; fix it before editing the config');
  }

  /** Refuse if the layout file can't be edited at all (v1.1: for operations that always write it, UI31). */
  requireLayout(): void {
    if (this.layoutBroken) refuse('The layout file has errors; fix it before making this change (it would edit the layout file)');
  }

  // ---- nodes and lanes

  /** Every node id in the diagram, in file declaration order (§8.2 Order), then never-declared nodes by mention. */
  nodeOrder(): string[] {
    return [...declaredNodes(this.d).map((e) => e.node.id), ...undeclaredNodes(this.d).map((n) => n.id)];
  }

  hasNode(id: string): boolean {
    return this.nodeOrder().includes(id);
  }

  requireNode(id: string): void {
    if (!this.hasNode(id)) refuse(`There is no block "${id}"`);
  }

  /** The node's lane id, or `_unassigned` (§3.2). */
  laneOf(id: string): string {
    return findNode(this.d, id)?.lane ?? UNASSIGNED;
  }

  hasLane(id: string): boolean {
    return this.d.lanes.some((l) => l.id === id);
  }

  requireLane(id: string, opts: { unassigned?: boolean } = {}): void {
    if (id === UNASSIGNED && opts.unassigned) return;
    if (!this.hasLane(id)) refuse(`There is no lane "${id}"`);
  }

  /** The declaration list a lane id refers to (`_unassigned`: the unlaned section). */
  declsOf(lane: string): NodeDecl[] {
    if (lane === UNASSIGNED) return this.d.unlaned;
    const found = this.d.lanes.find((l) => l.id === lane);
    if (!found) return refuse(`There is no lane "${lane}"`);
    return found.nodes;
  }

  /** Remove a node's declaration (with its comments) and return it; undefined for a never-declared node. */
  removeDecl(id: string): NodeDecl | undefined {
    for (const list of [this.d.unlaned, ...this.d.lanes.map((l) => l.nodes)]) {
      const i = list.findIndex((n) => n.id === id);
      if (i >= 0) return list.splice(i, 1)[0];
    }
    return undefined;
  }

  /** Ids in file declaration order, without repeats; unknown ids are refused. */
  sortByDeclaration(ids: readonly string[]): string[] {
    const order = this.nodeOrder();
    const want = new Set(ids);
    for (const id of want) if (!order.includes(id)) refuse(`There is no block "${id}"`);
    return order.filter((id) => want.has(id));
  }

  /** The edge ids of the current diagram (§3.4), index-aligned with `d.edges`. */
  edgeIds(): string[] {
    return edgeIds(this.d.edges);
  }

  edgeIndex(edgeId: string): number {
    const i = this.edgeIds().indexOf(edgeId);
    if (i < 0) refuse(`There is no line "${edgeId}"`);
    return i;
  }

  /**
   * §8.2 "Keeping the layout file in step": after the edge list changed, re-key every edge entry by its edge's new id,
   * matching edges by position (an edge keeps its identity while the operation edits it in place, so a reconnect that
   * creates or breaks a duplicate pair keeps entries on the right lines). A deleted edge's entry is deleted. Entries of
   * edges that don't exist (orphans) are left alone. Call once, after the edges are final.
   */
  rekeyEdgeEntries(): void {
    if (this.rekeyed) throw new Error('rekeyEdgeEntries: call it once per operation');
    this.rekeyed = true;
    const idsNow = this.edgeIds();
    const at = new Map(this.d.edges.map((e, j) => [e, j]));
    const newIds = this.edgesIn.map((e) => {
      const j = at.get(e);
      return j === undefined ? null : idsNow[j]!;
    });
    const changed = this.edgeIdsIn.filter((id, k) => newIds[k] !== id);
    if (changed.length === 0) return;
    this.editLayout(changed, (file) => rekeyEdgesByPosition(file, this.edgeIdsIn, newIds));
  }

  // ---- ids

  /**
   * §3.1: an id is taken if it is a node or subgraph id in the `.mmd` or a key under `nodes` or (v1.1) `notes` in the
   * config or layout file. For a file with errors, any whole-word mention of the id counts (conservative).
   */
  isTaken(id: string): boolean {
    if (this.hasNode(id) || this.hasLane(id)) return true;
    if (this.config && (Object.hasOwn(this.config.nodes, id) || Object.hasOwn(this.config.notes, id))) return true;
    if (this.configBroken && this.configText !== null && mentions(this.configText, id)) return true;
    if (this.layoutIn && (Object.hasOwn(this.layoutIn.nodes, id) || Object.hasOwn(this.layoutIn.notes ?? {}, id))) return true;
    if (this.layoutBroken && this.input.layout !== null && mentions(this.input.layout, id)) return true;
    return false;
  }

  /** UI6: the first of `n1`, `n2`, … that isn't taken. */
  nextNodeId(): string {
    for (let k = 1; ; k++) if (!this.isTaken(`n${k}`)) return `n${k}`;
  }

  /** UI9 / UI19: refuse an id that breaks the id rules or is reserved or taken. */
  checkNewId(id: string, what: 'block' | 'lane'): void {
    if (!isIdForm(id)) {
      refuse(`"${id}" is not a valid id: use letters, digits, _ and -, starting with a letter or _, `
        + 'not ending in - and without --');
    }
    if (isReservedId(id)) refuse(`"${id}" is a reserved word and can't be a ${what} id`);
    if (this.isTaken(id)) refuse(`"${id}" is already used`);
  }

  // ---- writing

  /**
   * §8.2: when an operation leaves no block in Unassigned, so that its lane disappears, every bend point in
   * `_unassigned` is re-expressed in the last remaining lane at the same on-screen position (in the layout as it was:
   * `along` unchanged, `across` moved by the distance between the two lanes' zero lines).
   */
  private keepUnassignedPoints(): void {
    const had = this.original.lanes.length > 0 && this.graphIn().nodes.some((n) => n.lane === UNASSIGNED);
    if (!had) return;
    const now = [...declaredNodes(this.d).map((e) => e.lane), ...undeclaredNodes(this.d).map(() => null)];
    if (now.some((lane) => lane === null)) return;
    if (this.layoutBroken) {
      if (this.input.layout !== null && mentions(this.input.layout, UNASSIGNED)) {
        refuse('The layout file has errors; fix it before making this change (it would move bend points out of Unassigned)');
      }
      return;
    }
    const inUnassigned = Object.values(this.layout?.edges ?? {}).some((e) => (e.points ?? []).some((p) => p.lane === UNASSIGNED));
    if (!inUnassigned) return;
    const order = laneOrder(this.config ?? this.orderConfig, this.d.lanes.map((l) => l.id));
    const last = order[order.length - 1];
    if (last === undefined) return;
    const before = loadLayout(this.input);
    if (!before) return;
    const lanes = before.result.lanes;
    const zero = (id: string): number | null => {
      const i = lanes.findIndex((l) => l.id === id);
      if (i < 0) return null;
      const l = lanes[i]!;
      return (before.result.direction === 'TB' ? l.x : l.y) + (i === 0 ? before.translation.across : 0);
    };
    const from = zero(UNASSIGNED);
    const to = zero(last);
    if (from === null || to === null) return;
    this.layout = movePointsToLane(this.layout, UNASSIGNED, last, { across: from - to });
  }

  commit(): Files {
    this.keepUnassignedPoints();
    let layout = this.input.layout;
    if (!this.layoutBroken && !sameJson(this.layout, this.layoutIn)) {
      layout = this.layout === null ? null : serializeLayoutFile(this.layout);
    }
    return { mmd: format(this.d), config: this.configText, layout };
  }
}

/** The layout of the files as loaded (null when the `.mmd` has errors), for re-expressing positions. */
function loadLayout(files: Files): LayoutOutput | null {
  return loadDocument(files.mmd, files.config, files.layout, 'diagram.mmd').layout;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Run an operation body over the files: load, edit, write, and turn refusals into `{ok: false}`. */
export function run<T extends object>(files: Files, body: (ctx: Ctx) => T): OpResult<T> {
  try {
    const ctx = new Ctx(files);
    const extra = body(ctx);
    return { ok: true, files: ctx.commit(), ...extra };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, error: e.message };
    throw e;
  }
}

/** Labels are one line in v1 (§3.1). A block label may not be empty (UI8). */
export function checkBlockLabel(label: string, what = 'A block label'): void {
  if (typeof label !== 'string' || label.trim() === '') refuse(`${what} can't be empty`);
  if (/[\r\n]/.test(label)) refuse(`${what} must be a single line`);
}
