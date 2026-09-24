// Parser for the flowmap subset of Mermaid flowchart syntax (design.md §3.1, §3.2), building the model in model.ts.
//
// It works line by line. Each line is a comment, a blank, or one statement; a statement is classified by its first
// whole token (keywords, §3.1) and otherwise parsed as node declarations and edges by a small scanner. A line with a
// syntax error is reported and skipped, and parsing carries on, so every error in the file is reported (§3.1, §7).
// Cross-line rules (duplicates, lanes, unclosed subgraphs, edges to subgraphs, W-no-lane) are applied as lines are
// read or at the end.

import type { Direction, Problem, Problems, ShapeKind } from '../types';
import type { Comment, Diagram, Edge, Lane, NodeDecl } from './model';
import { emptyDiagram, undeclaredNodes } from './model';
import {
  ID_SOURCE, PASS_THROUGH_KEYWORDS, UNQUOTED_FORBIDDEN, decodeLabel, isReservedId, normaliseUnquoted,
} from './syntax';

export interface ParseResult {
  diagram: Diagram;
  problems: Problems;
}

// ---- Line scanner ---------------------------------------------------------------------------------------------------

/** A problem that ends parsing of the current line. */
class LineError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const syntaxError = (message: string) => new LineError('E-syntax', message);
const shapeError = (message: string) => new LineError('E-shape', message);
const edgeError = (message: string) => new LineError('E-edge', message);

class Scanner {
  pos = 0;
  constructor(readonly s: string) {}

  peek(offset = 0): string | undefined {
    return this.s[this.pos + offset];
  }
  eof(): boolean {
    return this.pos >= this.s.length;
  }
  startsWith(text: string): boolean {
    return this.s.startsWith(text, this.pos);
  }
  skipWs(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.pos++;
  }
  /** Match a sticky regex at the current position; on success, consume it. */
  match(re: RegExp): string | undefined {
    re.lastIndex = this.pos;
    const m = re.exec(this.s);
    if (!m) return undefined;
    this.pos += m[0].length;
    return m[0];
  }
  /** Read a double-quoted string starting at the current `"`; returns the raw text between the quotes. */
  quoted(onUnterminated: () => LineError): string {
    const end = this.s.indexOf('"', this.pos + 1);
    if (end < 0) throw onUnterminated();
    const raw = this.s.slice(this.pos + 1, end);
    this.pos = end + 1;
    return raw;
  }
}

const ID = new RegExp(ID_SOURCE, 'y');
/** A class name, shaped like an id (no `--`, no trailing `-`) so that `a[x]:::hot-->b` leaves the arrow alone. */
const CLASS_NAME = /[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*/y;
const YAML_KEY = /[A-Za-z_][A-Za-z0-9_-]*/y;
const YAML_BARE = /[^\s,}"]+/y;

/**
 * Arrows outside the subset (§3.1: `---`, `-.->`, `==>`, `--o`, `--x`, `<-->`, `~~~`, `o--o`, …). Only consulted after
 * the accepted forms (`-->`, `-- label -->`) have been ruled out.
 */
const OTHER_ARROW = /^[<ox]?(?:-{2,}|={2,}|~{3,}|-\.)/;

// ---- Statement grammar ----------------------------------------------------------------------------------------------

interface ShapeDecl {
  shape: ShapeKind;
  label: string;
  className: string | null;
}

interface NodeRef {
  id: string;
  /** Set when the reference carries a shape, which makes it a declaration (§3.2). */
  decl: ShapeDecl | null;
}

/** `a & b --> c -->|x| d`: groups joined by arrows. `labels[i]` is the arrow between groups i and i+1. */
interface EdgeStatement {
  groups: NodeRef[][];
  labels: (string | null)[];
}

/**
 * Shape openers in the order they must be tried (longest first, so `[[` wins over `[` and `{{` over `{`). A null
 * shape is another Mermaid shape (§3.1: `[\…\]`, `((…))`, `(…)`, `{{…}}`, `>…]`), which is E-shape.
 */
const SHAPE_OPENERS: { open: string; close: string; shape: ShapeKind | null }[] = [
  { open: '[\\', close: '', shape: null },
  { open: '[[', close: ']]', shape: 'subprocess' },
  { open: '[(', close: ')]', shape: 'database' },
  { open: '[/', close: '/]', shape: 'io' },
  { open: '[', close: ']', shape: 'step' },
  { open: '([', close: '])', shape: 'terminal' },
  { open: '(', close: '', shape: null },
  { open: '{{', close: '', shape: null },
  { open: '{', close: '}', shape: 'decision' },
  { open: '>', close: '', shape: null },
];

function parseEdgeStatement(s: string): EdgeStatement {
  const sc = new Scanner(s);
  const groups = [parseGroup(sc)];
  const labels: (string | null)[] = [];
  for (;;) {
    sc.skipWs();
    if (sc.eof()) break;
    labels.push(parseArrow(sc));
    sc.skipWs();
    groups.push(parseGroup(sc));
  }
  return { groups, labels };
}

/** `a & b & c` (§3.1 `&` groups). */
function parseGroup(sc: Scanner): NodeRef[] {
  const refs = [parseNodeRef(sc)];
  for (;;) {
    const save = sc.pos;
    sc.skipWs();
    if (sc.peek() !== '&') {
      sc.pos = save;
      return refs;
    }
    sc.pos++;
    sc.skipWs();
    refs.push(parseNodeRef(sc));
  }
}

function parseNodeRef(sc: Scanner): NodeRef {
  const id = sc.match(ID);
  if (id === undefined) throw syntaxError(`expected a node id at "${sc.s.slice(sc.pos)}"`);
  if (isReservedId(id)) throw syntaxError(`"${id}" is a reserved id`);
  const decl = parseShape(sc);
  if (sc.startsWith(':::')) {
    // §3.1: a class suffix follows one of the six bracket shapes; `@{…}` nodes and bare references can't carry one.
    if (decl === null) throw syntaxError(`a class suffix needs a shape: "${id}:::…"`);
    if (decl.shape === 'document' || decl.shape === 'delay') throw shapeError('an @{…} node cannot have a class suffix');
    sc.pos += 3;
    const className = sc.match(CLASS_NAME);
    if (className === undefined) throw syntaxError('expected a class name after ":::"');
    decl.className = className;
  }
  return { id, decl };
}

/** The shape right after an id (no space in between), or null for a plain reference. */
function parseShape(sc: Scanner): ShapeDecl | null {
  if (sc.startsWith('@{')) return parseExpandedShape(sc);
  const opener = SHAPE_OPENERS.find(({ open }) => sc.startsWith(open));
  if (!opener) return null;
  if (opener.shape === null) throw shapeError(`shape not supported: "${opener.open}…"`);
  sc.pos += opener.open.length;
  const label = parseBracketLabel(sc, opener.close, opener.shape);
  return { shape: opener.shape, label, className: null };
}

/**
 * The label inside a bracket shape, up to and including `close` (§3.1 labels). Quoted: anything but a raw `"`, kept
 * exactly. Unquoted: no brackets, braces, parentheses, `|` or `"` (and no `/` for `io`); trimmed and collapsed.
 */
function parseBracketLabel(sc: Scanner, close: string, shape: ShapeKind): string {
  const start = sc.pos;
  let label: string;
  sc.skipWs();
  if (sc.peek() === '"') {
    label = decodeLabel(sc.quoted(() => syntaxError('unterminated quoted label')));
    sc.skipWs();
  } else {
    sc.pos = start;
    while (!sc.eof() && !UNQUOTED_FORBIDDEN.has(sc.peek()!) && !(shape === 'io' && sc.peek() === '/')) sc.pos++;
    label = decodeLabel(normaliseUnquoted(sc.s.slice(start, sc.pos)));
    if (label === '') throw syntaxError('empty unquoted label');
  }
  if (!sc.startsWith(close)) {
    // `[/…\]` is Mermaid's trapezoid, not an io parallelogram.
    if (shape === 'io' && (sc.startsWith('\\]') || sc.s.startsWith('\\]', sc.pos - 1))) {
      throw shapeError('shape not supported: trapezoid "[/…\\]"');
    }
    throw syntaxError(`expected "${close}" to close the label`);
  }
  sc.pos += close.length;
  return label;
}

/**
 * `id@{ shape: doc, label: "…" }` (§3.1): exactly the keys `shape` and `label` in either order, a space after each
 * `:`, other whitespace optional, the label double-quoted (a backslash in it is written `#92;`), the shape `doc` or
 * `delay`. Anything else is E-shape.
 */
function parseExpandedShape(sc: Scanner): ShapeDecl {
  sc.pos += 2;
  const entries = new Map<string, { value: string; quoted: boolean }>();
  for (;;) {
    sc.skipWs();
    const key = sc.match(YAML_KEY);
    if (key === undefined) throw shapeError('expected a key in "@{…}"');
    sc.skipWs();
    if (sc.peek() !== ':') throw shapeError(`expected ":" after "${key}" in "@{…}"`);
    sc.pos++;
    // Without the space, Mermaid's YAML reading silently loses the key (§3.1).
    if (sc.peek() !== ' ' && sc.peek() !== '\t') throw shapeError(`"@{…}" needs a space after "${key}:"`);
    sc.skipWs();
    let entry: { value: string; quoted: boolean };
    if (sc.peek() === '"') {
      const raw = sc.quoted(() => syntaxError('unterminated quoted label in "@{…}"'));
      if (raw.includes('\\')) throw shapeError('a backslash in an "@{…}" label is written #92;');
      entry = { value: decodeLabel(raw), quoted: true };
    } else {
      const bare = sc.match(YAML_BARE);
      if (bare === undefined) throw shapeError(`expected a value for "${key}" in "@{…}"`);
      entry = { value: bare, quoted: false };
    }
    if (entries.has(key)) throw shapeError(`"${key}" appears twice in "@{…}"`);
    entries.set(key, entry);
    sc.skipWs();
    if (sc.peek() === ',') {
      sc.pos++;
      continue;
    }
    if (sc.peek() === '}') {
      sc.pos++;
      break;
    }
    if (sc.eof()) throw syntaxError('unterminated "@{…}"');
    throw shapeError(`unexpected "${sc.peek()}" in "@{…}"`);
  }
  const shape = entries.get('shape');
  const label = entries.get('label');
  if (entries.size !== 2 || !shape || !label) throw shapeError('"@{…}" takes exactly the keys shape and label');
  if (shape.quoted || (shape.value !== 'doc' && shape.value !== 'delay')) {
    throw shapeError(`shape not supported: "${shape.value}"`);
  }
  if (!label.quoted) throw shapeError('the label in "@{…}" must be double-quoted');
  return { shape: shape.value === 'doc' ? 'document' : 'delay', label: label.value, className: null };
}

/**
 * An arrow and its label (§3.1 edges): `-->`, `-->|label|`, `-->|"label"|`, `-- label -->`, with whitespace optional.
 * Returns the decoded label, or null for none. Other arrows are E-edge.
 */
function parseArrow(sc: Scanner): string | null {
  if (sc.startsWith('-->')) {
    const next = sc.peek(3);
    if (next === '-' || next === '>') throw edgeError(`arrow not supported: "${sc.s.slice(sc.pos)}"`);
    sc.pos += 3;
    const save = sc.pos;
    sc.skipWs();
    if (sc.peek() === '|') return parsePipeLabel(sc);
    sc.pos = save;
    return null;
  }
  if (sc.startsWith('--')) {
    const c = sc.peek(2);
    const after = sc.peek(3);
    // `---`, `--.`, `--=`, and `--x` / `--o` standing alone, are other arrows.
    if (c === '-' || c === '.' || c === '=') throw edgeError('arrow not supported');
    if ((c === 'x' || c === 'o') && (after === undefined || after === ' ' || after === '\t' || after === '|')) {
      throw edgeError(`arrow not supported: "--${c}"`);
    }
    // `-- label -->`: the label runs to the next `--`, which must be the closing `-->`.
    const start = sc.pos + 2;
    const close = sc.s.indexOf('--', start);
    if (close < 0) throw syntaxError('"--" without a closing "-->"');
    const tail = sc.s[close + 2];
    if (tail !== '>' || sc.s[close + 3] === '-' || sc.s[close + 3] === '>') throw edgeError('arrow not supported');
    const label = parseTextLabel(sc.s.slice(start, close));
    sc.pos = close + 3;
    const save = sc.pos;
    sc.skipWs();
    if (sc.peek() === '|') throw syntaxError('an arrow has two labels');
    sc.pos = save;
    return label;
  }
  if (OTHER_ARROW.test(sc.s.slice(sc.pos))) throw edgeError(`arrow not supported: "${sc.s.slice(sc.pos)}"`);
  throw syntaxError(`unexpected "${sc.s.slice(sc.pos)}"`);
}

/** `|label|` or `|"label"|` after `-->`, at the opening `|`. */
function parsePipeLabel(sc: Scanner): string | null {
  sc.pos++;
  const start = sc.pos;
  sc.skipWs();
  let label: string;
  if (sc.peek() === '"') {
    label = decodeLabel(sc.quoted(() => syntaxError('unterminated quoted edge label')));
    sc.skipWs();
    if (sc.peek() !== '|') throw syntaxError('expected "|" after the quoted edge label');
  } else {
    sc.pos = start;
    const end = sc.s.indexOf('|', start);
    if (end < 0) throw syntaxError('unterminated edge label "|…"');
    label = unquotedLabel(sc.s.slice(start, end));
    sc.pos = end;
  }
  sc.pos++;
  return label === '' ? null : label;
}

/** The text of a `-- label -->` arrow: quoted or unquoted, empty meaning none. */
function parseTextLabel(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) {
    if (trimmed.length < 2 || !trimmed.endsWith('"') || trimmed.slice(1, -1).includes('"')) {
      throw syntaxError('malformed quoted edge label');
    }
    const label = decodeLabel(trimmed.slice(1, -1));
    return label === '' ? null : label;
  }
  const label = unquotedLabel(raw);
  return label === '' ? null : label;
}

function unquotedLabel(raw: string): string {
  for (const ch of raw) if (UNQUOTED_FORBIDDEN.has(ch)) throw syntaxError(`"${ch}" in an unquoted label; quote it`);
  return decodeLabel(normaliseUnquoted(raw));
}

// ---- Other statement kinds ------------------------------------------------------------------------------------------

const HEADER = /^(?:flowchart|graph)[ \t]+(LR|TB|TD)[ \t]*;?$/;
const HEADER_KEYWORD = /^(?:flowchart|graph)(?![A-Za-z0-9_-])/;
const SUBGRAPH = new RegExp(`^subgraph[ \\t]+(${ID_SOURCE})(?![A-Za-z0-9_-])[ \\t]*(.*)$`);
const DIRECTION = /^direction[ \t]+(?:TB|TD|BT|RL|LR)$/;

/** `[Label]` or `["Label"]` after a subgraph id (§3.1), or null when there is no label. */
function parseLaneLabel(rest: string): string | null {
  if (rest === '') return null;
  const sc = new Scanner(rest);
  if (sc.peek() !== '[') throw syntaxError(`unexpected "${rest}" after the subgraph id`);
  sc.pos++;
  const label = parseBracketLabel(sc, ']', 'step');
  if (!sc.eof()) throw syntaxError(`unexpected "${sc.s.slice(sc.pos)}" after the subgraph label`);
  return label;
}

/**
 * §3.1: in a pass-through line, a `;` is allowed only inside a double-quoted string or ending a `#…;` escape
 * (`fill:#f96;` style entity text); any other one means several statements on one line.
 */
function checkPassThroughSemicolons(text: string): void {
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ';' && !inQuote && !/#[A-Za-z0-9]+$/.test(text.slice(0, i))) {
      throw syntaxError('";" separates statements; put one statement per line');
    }
  }
}

// ---- The parser -----------------------------------------------------------------------------------------------------

interface OpenSubgraph {
  line: number;
  /** The lane the block adds nodes to, or null if the `subgraph` line itself was an error. */
  lane: Lane | null;
}

export function parse(text: string): ParseResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const diagram = emptyDiagram();
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  const error = (code: string, line: number, message: string) => errors.push({ code, line, message });
  const warn = (code: string, line: number, message: string) => warnings.push({ code, line, message });

  // §3.3 file comment, part 1: every comment before the header.
  let i = 0;
  for (; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t === '') continue;
    if (!t.startsWith('%%')) break;
    diagram.fileComment.push(t);
  }

  // §3.1 header: the first line that isn't a comment or blank.
  if (i >= lines.length) {
    error('E-header', 1, 'missing header: expected "flowchart LR" or "flowchart TB"');
  } else {
    const t = lines[i]!.trim();
    const m = HEADER.exec(t);
    if (m) {
      diagram.direction = (m[1] === 'LR' ? 'LR' : 'TB') as Direction; // TD means TB
      i++;
    } else {
      const what = HEADER_KEYWORD.test(t) ? `bad header "${t}"` : `missing header (found "${t}")`;
      error('E-header', i + 1, `${what}: expected "flowchart LR" or "flowchart TB"`);
      // That line stands in for the header either way, so it isn't reported a second time as a statement.
      i++;
    }
    // §3.3 file comment, part 2: comment lines directly after the header, up to the first blank line or statement.
    for (; i < lines.length; i++) {
      const next = lines[i]!.trim();
      if (!next.startsWith('%%')) break;
      diagram.fileComment.push(next);
    }
  }

  /** The comment block waiting for the next kept statement (§3.3). */
  let pending: Comment[] = [];
  const takePending = (): Comment[] => {
    const taken = pending;
    pending = [];
    return taken;
  };

  const stack: OpenSubgraph[] = [];
  const lanes = new Map<string, Lane>();
  const nodes = new Map<string, { decl: NodeDecl; lane: string | null }>();

  /**
   * Declare a node (§3.2). Returns the new declaration, or null if it is a repeat (identical: no effect; different:
   * E-duplicate at this line).
   */
  const declare = (id: string, shape: ShapeDecl, line: number): NodeDecl | null => {
    const lane = stack[0]?.lane ?? null;
    const laneId = lane?.id ?? null;
    if (lanes.has(id)) {
      error('E-duplicate', line, `"${id}" is already a subgraph id`);
      return null;
    }
    const existing = nodes.get(id);
    if (existing) {
      const d = existing.decl;
      const same = d.shape === shape.shape && d.label === shape.label && d.className === shape.className
        && existing.lane === laneId;
      if (!same) error('E-duplicate', line, `"${id}" is declared again differently (first at line ${d.line})`);
      return null;
    }
    const decl: NodeDecl = { id, shape: shape.shape, label: shape.label, className: shape.className, comments: [], line };
    (lane ? lane.nodes : diagram.unlaned).push(decl);
    nodes.set(id, { decl, lane: laneId });
    if (!laneId) warn('W-no-lane', line, `"${id}" is not in any subgraph`);
    return decl;
  };

  const handleSubgraph = (stmt: string, line: number): void => {
    if (stack.length > 0) {
      // §3.1: one level only. The inner block still opens (and its `end` closes it); its nodes stay in the outer lane.
      error('E-nested', line, 'a subgraph inside a subgraph');
      stack.push({ line, lane: null });
      return;
    }
    const open: OpenSubgraph = { line, lane: null };
    stack.push(open);
    const m = SUBGRAPH.exec(stmt);
    if (!m) throw syntaxError(`bad subgraph line "${stmt}": expected "subgraph <id> [<Label>]"`);
    const id = m[1]!;
    if (isReservedId(id)) throw syntaxError(`"${id}" is a reserved id`);
    const label = parseLaneLabel(m[2]!) ?? id;
    const existing = lanes.get(id);
    if (existing) {
      error('E-duplicate', line, `subgraph "${id}" is already defined (line ${existing.line})`);
      open.lane = existing;
      return;
    }
    if (nodes.has(id)) {
      error('E-duplicate', line, `"${id}" is already a node id`);
      return;
    }
    const lane: Lane = { id, label, comments: takePending(), nodes: [], endComments: [], line };
    lanes.set(id, lane);
    diagram.lanes.push(lane);
    open.lane = lane;
  };

  const handleEnd = (stmt: string): void => {
    if (stmt !== 'end') throw syntaxError(`unexpected "${stmt}"`);
    if (stack.length === 0) throw syntaxError('"end" without a subgraph');
    const closed = stack.pop()!;
    // §3.3: a comment directly above `end` stays inside that subgraph, as its last lines.
    if (stack.length === 0 && closed.lane) closed.lane.endComments.push(...takePending());
  };

  const handlePassThrough = (stmt: string, line: number): void => {
    if (!/^[A-Za-z]+[ \t]+\S/.test(stmt)) throw syntaxError(`incomplete "${stmt}" line`);
    if (stmt.endsWith(';')) throw syntaxError('";" separates statements; put one statement per line');
    checkPassThroughSemicolons(stmt);
    diagram.passThrough.push({ text: stmt, comments: takePending(), line });
  };

  const handleEdgeStatement = (stmt: string, line: number): void => {
    const { groups, labels } = parseEdgeStatement(stmt);
    const refs = groups.flat();
    // §3.1: a line that is only a bare id is E-syntax; a node joins a lane by being declared there.
    if (labels.length === 0 && refs.some((ref) => ref.decl === null)) {
      throw syntaxError(`"${stmt}" declares nothing: give the node a shape, or connect it with an arrow`);
    }
    let firstDecl: NodeDecl | null = null;
    for (const ref of refs) {
      if (!ref.decl) continue;
      const decl = declare(ref.id, ref.decl, line);
      firstDecl ??= decl;
    }
    // §3.1: chains and `&` groups expand source-major, left to right.
    const edges: Edge[] = [];
    labels.forEach((label, k) => {
      for (const source of groups[k]!) {
        for (const target of groups[k + 1]!) {
          edges.push({ source: source.id, target: target.id, label, comments: [], line });
        }
      }
    });
    // §3.3: a comment goes with the first edge the line produces, else with its (first new) declaration; if the
    // line keeps nothing, it waits for the next kept statement.
    const holder = edges[0] ?? firstDecl;
    if (holder) holder.comments = takePending();
    diagram.edges.push(...edges);
  };

  for (; i < lines.length; i++) {
    const line = i + 1;
    const t = lines[i]!.trim();
    if (t === '') continue;
    if (t.startsWith('%%')) {
      pending.push(t);
      continue;
    }
    // §3.1: a trailing `;` is accepted and dropped.
    const stmt = t.endsWith(';') ? t.slice(0, -1).trimEnd() : t;
    if (stmt === '') continue;
    const keyword = /^[A-Za-z0-9_-]+/.exec(stmt)?.[0];
    try {
      if (keyword === 'subgraph') handleSubgraph(stmt, line);
      else if (keyword === 'end') handleEnd(stmt);
      else if (keyword === 'direction') {
        if (!DIRECTION.test(stmt)) throw syntaxError(`bad direction line "${stmt}"`);
        // §3.1: ignored with a warning and dropped on the next write; its comment waits for the next statement.
        warn('W-direction', line, 'direction lines are ignored; the header sets the direction');
      } else if (keyword !== undefined && PASS_THROUGH_KEYWORDS.has(keyword)) handlePassThrough(stmt, line);
      else handleEdgeStatement(stmt, line);
    } catch (e) {
      if (!(e instanceof LineError)) throw e;
      error(e.code, line, e.message);
    }
  }

  for (const open of stack) error('E-unclosed', open.line, 'subgraph without "end"');

  // §3.1: an edge to or from a subgraph id is E-syntax (once per line).
  const flagged = new Set<number>();
  for (const edge of diagram.edges) {
    const laneEnd = lanes.has(edge.source) ? edge.source : lanes.has(edge.target) ? edge.target : null;
    if (laneEnd === null || edge.line === undefined || flagged.has(edge.line)) continue;
    flagged.add(edge.line);
    error('E-syntax', edge.line, `an edge can't connect to subgraph "${laneEnd}"`);
  }

  // §3.2: a never-declared node has no lane; warn at its first mention.
  for (const node of undeclaredNodes(diagram)) {
    if (lanes.has(node.id)) continue;
    warn('W-no-lane', node.line ?? 1, `"${node.id}" is never declared, so it is not in any subgraph`);
  }

  diagram.trailingComments = takePending();
  errors.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  warnings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return { diagram, problems: { errors, warnings } };
}
