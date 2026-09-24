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

import { ConfigDoc, laneOrder, parseConfig, type EditResult, type FlowConfig } from '../config';
import { checkPinRanges, firstLaneOf, parseLayoutFile, serializeLayoutFile } from '../layoutfile';
import {
  declaredNodes, edgeIds, findNode, format, isIdForm, isReservedId, parse, undeclaredNodes,
  type Diagram, type NodeDecl,
} from '../mmd';
import { UNASSIGNED, type LayoutFile } from '../types';

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
  private readonly layoutIn: LayoutFile | null;

  constructor(readonly input: Files) {
    const { diagram, problems } = parse(input.mmd);
    if (problems.errors.length) {
      const first = problems.errors[0]!;
      refuse(`The .mmd file has errors (${first.code} at line ${first.line}); fix it before editing`);
    }
    this.d = structuredClone(diagram);
    this.configText = input.config;
    const cfg = parseConfig(input.config);
    this.config = cfg.config;
    this.configBroken = cfg.config === null;
    const lay = parseLayoutFile(input.layout);
    // A file that parses but has a value out of range for this diagram (§5 Values) is a file with errors too.
    const file = lay.file && checkPinRanges(lay.file, this.firstLane()).length === 0 ? lay.file : null;
    this.layoutBroken = input.layout !== null && file === null;
    this.layoutIn = file;
    this.layout = file === null ? null : structuredClone(file);
  }

  /** The first displayed lane now (§6 L1; `_unassigned` in a lane-free diagram): the only one whose `across` may be < 0. */
  firstLane(): string {
    return firstLaneOf(laneOrder(this.config, this.d.lanes.map((l) => l.id)));
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

  // ---- ids

  /**
   * §3.1: an id is taken if it is a node or subgraph id in the `.mmd` or a key under `nodes` in the config or layout
   * file. For a file with errors, any whole-word mention of the id counts (conservative).
   */
  isTaken(id: string): boolean {
    if (this.hasNode(id) || this.hasLane(id)) return true;
    if (this.config && Object.hasOwn(this.config.nodes, id)) return true;
    if (this.configBroken && this.configText !== null && mentions(this.configText, id)) return true;
    if (this.layoutIn && Object.hasOwn(this.layoutIn.nodes, id)) return true;
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

  commit(): Files {
    let layout = this.input.layout;
    if (!this.layoutBroken && !sameJson(this.layout, this.layoutIn)) {
      layout = this.layout === null ? null : serializeLayoutFile(this.layout);
    }
    return { mmd: format(this.d), config: this.configText, layout };
  }
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
