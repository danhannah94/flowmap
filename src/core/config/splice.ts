// Text-splicing edits on a YAML file. Every edit replaces the smallest byte range that covers what changes, located
// through the `yaml` AST's source ranges, so every untouched line of the file survives byte for byte (UI26).
// Each primitive takes the current text and returns the new text; callers chain them, re-parsing in between.
import {
  parseDocument, isMap, isSeq, isScalar, isPair, isAlias, isCollection,
  type Document, type YAMLMap, type YAMLSeq, type Pair, type Node as YNode,
} from 'yaml';
import {
  type Path, type Seg, deepEqual, isInlineish, isPlainObject, renderInline, renderItemLines, renderKey, renderMapLines,
  renderPairLines,
} from './emit';

export class SpliceError extends Error {}

type AnyNode = YNode | null | undefined;
type Holder =
  | { type: 'root' }
  | { type: 'pair'; map: YAMLMap; pair: Pair; path: Path }
  | { type: 'item'; seq: YAMLSeq; index: number; path: Path };

export function parseYaml(src: string): Document.Parsed {
  const doc = parseDocument(src, { uniqueKeys: true });
  if (doc.errors.length) throw new SpliceError(`YAML error: ${doc.errors[0]!.message}`);
  return doc;
}

function rangeOf(n: AnyNode): [number, number, number] {
  const r = (n as { range?: [number, number, number] } | null | undefined)?.range;
  if (!r) throw new SpliceError('internal: node without a source range');
  return r;
}

export function keyString(pair: Pair): string {
  const k = pair.key as AnyNode;
  if (isScalar(k)) return String(k.value);
  return String(k);
}

export function findPair(map: YAMLMap, key: Seg): Pair | undefined {
  const s = String(key);
  return (map.items as Pair[]).find((p) => isPair(p) && keyString(p) === s);
}

function toJs(n: AnyNode, doc: Document.Parsed): unknown {
  if (n === null || n === undefined) return null;
  if (isScalar(n)) return n.value ?? null;
  return (n as unknown as { toJS(d: Document.Parsed, o: object): unknown }).toJS(doc, { maxAliasCount: 100 });
}

/** The node at `path` and what holds it, or undefined if some segment is missing. */
export function locate(doc: Document.Parsed, path: Path): { node: AnyNode; holder: Holder } | undefined {
  let node: AnyNode = doc.contents as AnyNode;
  let holder: Holder = { type: 'root' };
  for (let i = 0; i < path.length; i++) {
    const seg = path[i]!;
    if (isMap(node)) {
      const pair = findPair(node, seg);
      if (!pair) return undefined;
      holder = { type: 'pair', map: node, pair, path: path.slice(0, i + 1) };
      node = pair.value as AnyNode;
    } else if (isSeq(node) && typeof seg === 'number') {
      if (seg < 0 || seg >= node.items.length) return undefined;
      holder = { type: 'item', seq: node, index: seg, path: path.slice(0, i + 1) };
      node = node.items[seg] as AnyNode;
    } else return undefined;
  }
  return { node, holder };
}

export function valueAt(src: string, path: Path): unknown {
  const doc = parseYaml(src);
  const hit = locate(doc, path);
  return hit ? toJs(hit.node, doc) : undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// Line geometry

export function lineStart(src: string, off: number): number {
  return src.lastIndexOf('\n', off - 1) + 1;
}
function lineEndIncl(src: string, off: number): number {
  const i = src.indexOf('\n', off);
  return i < 0 ? src.length : i + 1;
}
function column(src: string, off: number): number {
  return off - lineStart(src, off);
}
function onlyWsBefore(src: string, off: number): boolean {
  return src.slice(lineStart(src, off), off).trim() === '';
}
function backOverWs(src: string, from: number, to: number): number {
  let e = to;
  while (e > from && /\s/.test(src[e - 1]!)) e--;
  return e;
}
/** Past `end`, swallow comment lines indented deeper than `col` (they belong to the entry above). */
function extendDeeperComments(src: string, end: number, col: number): number {
  let result = end;
  let p = end;
  while (p < src.length) {
    const le = lineEndIncl(src, p);
    const line = src.slice(p, le).replace(/\r?\n$/, '');
    if (line.trim() === '') { p = le; continue; }
    const ind = line.length - line.trimStart().length;
    if (line.trimStart().startsWith('#') && ind > col) { result = le; p = le; continue; }
    break;
  }
  return result;
}

export interface Span {
  start: number;
  end: number;
  /** Column of the key or of the `-`. */
  col: number;
  /** The span starts mid-line (a first key right after `- `, or a nested `- -`). */
  inline: boolean;
}

export function pairSpan(src: string, pair: Pair): Span {
  const kr = rangeOf(pair.key as AnyNode);
  const ks = kr[0];
  const inline = !onlyWsBefore(src, ks);
  const start = inline ? ks : lineStart(src, ks);
  const vEnd = pair.value ? Math.max(rangeOf(pair.value as AnyNode)[1], kr[1]) : kr[1];
  const ce = backOverWs(src, ks, vEnd);
  const col = column(src, ks);
  const end = extendDeeperComments(src, lineEndIncl(src, Math.max(ce - 1, ks)), col);
  return { start, end, col, inline };
}

function dashOf(src: string, seq: YAMLSeq, index: number): number {
  const dcol = column(src, rangeOf(seq)[0]);
  const r0 = rangeOf(seq.items[index] as AnyNode)[0];
  let ls = lineStart(src, r0);
  for (;;) {
    const p = ls + dcol;
    if (src[p] === '-' && /^[\s-]*$/.test(src.slice(ls, p)) && p <= r0) return p;
    if (ls === 0) throw new SpliceError('internal: sequence indicator not found');
    ls = lineStart(src, ls - 1);
  }
}

export function itemSpan(src: string, seq: YAMLSeq, index: number): Span {
  const d = dashOf(src, seq, index);
  const inline = !onlyWsBefore(src, d);
  const start = inline ? d : lineStart(src, d);
  const ce = backOverWs(src, d, Math.max(rangeOf(seq.items[index] as AnyNode)[1], d + 1));
  const col = column(src, d);
  const end = extendDeeperComments(src, lineEndIncl(src, Math.max(ce - 1, d)), col);
  return { start, end, col, inline };
}

function splice(src: string, start: number, end: number, text: string): string {
  return src.slice(0, start) + text + src.slice(end);
}

/** Replace a span with block lines; the lines carry their own indentation. */
function replaceSpan(src: string, span: Span, lines: string[]): string {
  const first = span.inline ? lines[0]!.slice(span.col) : lines[0]!;
  return splice(src, span.start, span.end, [first, ...lines.slice(1)].join('\n') + '\n');
}

function singleLine(src: string, n: AnyNode): boolean {
  const r = rangeOf(n);
  return !src.slice(r[0], r[1]).includes('\n');
}

/** An existing value that can be swapped for inline text by replacing just its range. */
function inlineReplaceable(src: string, n: AnyNode): boolean {
  if (!n) return false;
  const r = rangeOf(n);
  if (r[1] <= r[0]) return false; // empty value: needs a space after the colon; take the span path
  if (isScalar(n)) return (n.type === 'PLAIN' || n.type === 'QUOTE_DOUBLE' || n.type === 'QUOTE_SINGLE') && singleLine(src, n);
  if (isCollection(n)) return !!(n as YAMLMap).flow;
  return isAlias(n);
}

// ---------------------------------------------------------------------------------------------------------------
// Primitives

function replaceHolder(src: string, holder: Holder, node: AnyNode, value: unknown): string {
  const path = holder.type === 'root' ? [] : holder.path;
  if (holder.type === 'pair') {
    const { map, pair } = holder;
    if (map.flow) {
      if (!node) throw new SpliceError('internal: flow pair without value');
      const r = rangeOf(node);
      return splice(src, r[0], r[1], renderInline(value));
    }
    if (isInlineish(value, path) && inlineReplaceable(src, node)) {
      const r = rangeOf(node);
      return splice(src, r[0], r[1], renderInline(value));
    }
    const span = pairSpan(src, pair);
    const kr = rangeOf(pair.key as AnyNode);
    return replaceSpan(src, span, renderPairLines(src.slice(kr[0], kr[1]), value, span.col, path));
  }
  if (holder.type === 'item') {
    const { seq, index } = holder;
    if (seq.flow) {
      const r = rangeOf(node);
      return splice(src, r[0], r[1], renderInline(value));
    }
    if (isInlineish(value, path) && inlineReplaceable(src, node)) {
      const r = rangeOf(node);
      return splice(src, r[0], r[1], renderInline(value));
    }
    const span = itemSpan(src, seq, index);
    return replaceSpan(src, span, renderItemLines(value, span.col, path));
  }
  // root
  if (!isPlainObject(value)) throw new SpliceError('internal: the document root must be a map');
  if (node) {
    const r = rangeOf(node);
    const lines = Object.keys(value).length ? renderMapLines(value, 0, []).join('\n') : '{}';
    return splice(src, r[0], r[1], lines);
  }
  return appendRootLines(src, Object.keys(value).length ? renderMapLines(value, 0, []) : []);
}

function appendRootLines(src: string, lines: string[]): string {
  if (!lines.length) return src;
  const base = src.length && !src.endsWith('\n') ? src + '\n' : src;
  return base + lines.join('\n') + '\n';
}

function nest(segs: Path, value: unknown): unknown {
  let v = value;
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]!;
    if (typeof s === 'number') throw new SpliceError('internal: cannot create a sequence index');
    v = { [s]: v };
  }
  return v;
}

function appendPair(src: string, map: YAMLMap, holder: Holder, mapPath: Path, key: string, value: unknown): string {
  const path = [...mapPath, key];
  if (map.flow) {
    if (map.items.length === 0) {
      // An empty `{}` takes the shape of its new contents (block for a node entry, flow for a rule's match).
      return replaceHolder(src, holder, map, { [key]: value });
    }
    const last = map.items[map.items.length - 1] as Pair;
    const end = last.value ? rangeOf(last.value as AnyNode)[1] : rangeOf(last.key as AnyNode)[1];
    return splice(src, end, end, `, ${renderKey(key)}: ${renderInline(value)}`);
  }
  const col = column(src, rangeOf((map.items[0] as Pair).key as AnyNode)[0]);
  const lines = renderPairLines(renderKey(key), value, col, path);
  if (holder.type === 'root') return appendRootLines(src, lines); // §4: new top-level keys go at the end of the file
  const span = pairSpan(src, map.items[map.items.length - 1] as Pair);
  const lead = span.end === src.length && !src.endsWith('\n') ? '\n' : '';
  return splice(src, span.end, span.end, lead + lines.join('\n') + '\n');
}

/** Set the value at `path`, creating missing maps along the way. No change if it already holds an equal value. */
export function setIn(src: string, path: Path, value: unknown): string {
  const doc = parseYaml(src);
  let node: AnyNode = doc.contents as AnyNode;
  let holder: Holder = { type: 'root' };
  if (!node) return replaceHolder(src, holder, node, nest(path, value));
  for (let i = 0; i < path.length; i++) {
    const seg = path[i]!;
    const last = i === path.length - 1;
    if (isMap(node)) {
      const pair = findPair(node, seg);
      if (!pair) return appendPair(src, node, holder, path.slice(0, i), String(seg), nest(path.slice(i + 1), value));
      const child = pair.value as AnyNode;
      const h: Holder = { type: 'pair', map: node, pair, path: path.slice(0, i + 1) };
      if (last) {
        if (deepEqual(toJs(child, doc), value)) return src;
        return replaceHolder(src, h, child, value);
      }
      const next = path[i + 1]!;
      if (!(typeof next === 'number' ? isSeq(child) : isMap(child))) {
        return replaceHolder(src, h, child, nest(path.slice(i + 1), value));
      }
      node = child;
      holder = h;
    } else if (isSeq(node) && typeof seg === 'number') {
      if (seg < 0 || seg >= node.items.length) throw new SpliceError(`internal: no item ${seg}`);
      const child = node.items[seg] as AnyNode;
      const h: Holder = { type: 'item', seq: node, index: seg, path: path.slice(0, i + 1) };
      if (last) {
        if (deepEqual(toJs(child, doc), value)) return src;
        return replaceHolder(src, h, child, value);
      }
      node = child;
      holder = h;
    } else {
      throw new SpliceError(`internal: cannot set ${path.join('.')}`);
    }
  }
  // path was empty: replace the root
  return replaceHolder(src, { type: 'root' }, node, value);
}

function flowElementRanges(coll: YAMLMap | YAMLSeq): [number, number][] {
  return (coll.items as unknown[]).map((it) => {
    if (isPair(it)) {
      const kr = rangeOf(it.key as AnyNode);
      return [kr[0], it.value ? rangeOf(it.value as AnyNode)[1] : kr[1]];
    }
    const r = rangeOf(it as AnyNode);
    return [r[0], r[1]];
  });
}

function deleteFlowElement(src: string, coll: YAMLMap | YAMLSeq, index: number): string {
  const els = flowElementRanges(coll);
  if (index < els.length - 1) return splice(src, els[index]![0], els[index + 1]![0], '');
  return splice(src, els[index - 1]![1], els[index]![1], '');
}

/**
 * Delete the map key or sequence item at `path`. A collection left empty becomes `{}` / `[]` in place (§4); the root
 * map simply loses the key. No change if the path doesn't exist.
 */
export function deleteIn(src: string, path: Path): string {
  const doc = parseYaml(src);
  const parentHit = locate(doc, path.slice(0, -1));
  if (!parentHit) return src;
  const { node: coll, holder } = parentHit;
  const seg = path[path.length - 1]!;
  if (isMap(coll)) {
    const idx = (coll.items as Pair[]).findIndex((p) => isPair(p) && keyString(p) === String(seg));
    if (idx < 0) return src;
    if (coll.items.length === 1 && holder.type !== 'root') return replaceHolder(src, holder, coll, {});
    if (coll.flow) {
      if (coll.items.length === 1) return replaceHolder(src, holder, coll, {});
      return deleteFlowElement(src, coll, idx);
    }
    const pair = coll.items[idx] as Pair;
    const span = pairSpan(src, pair);
    if (span.inline && idx + 1 < coll.items.length) {
      // First key on a `- ` line: pull the next key up onto the dash line.
      const next = rangeOf((coll.items[idx + 1] as Pair).key as AnyNode)[0];
      return splice(src, span.start, next, '');
    }
    return splice(src, span.start, span.end, '');
  }
  if (isSeq(coll) && typeof seg === 'number') {
    if (seg < 0 || seg >= coll.items.length) return src;
    if (coll.items.length === 1) return replaceHolder(src, holder, coll, []);
    if (coll.flow) return deleteFlowElement(src, coll, seg);
    const span = itemSpan(src, coll, seg);
    return splice(src, span.start, span.end, '');
  }
  return src;
}

/** Rename a key of the map at `mapPath`, in place. */
export function renameKey(src: string, mapPath: Path, oldKey: string, newKey: string): string {
  const doc = parseYaml(src);
  const hit = locate(doc, mapPath);
  if (!hit || !isMap(hit.node)) return src;
  const pair = findPair(hit.node, oldKey);
  if (!pair) return src;
  const kr = rangeOf(pair.key as AnyNode);
  return splice(src, kr[0], kr[1], renderKey(newKey));
}

/** Append an item to the sequence at `path` (creating it if missing). */
export function appendItem(src: string, path: Path, value: unknown): string {
  const doc = parseYaml(src);
  const hit = locate(doc, path);
  if (!hit || !isSeq(hit.node)) return setIn(src, path, [value]);
  const seq = hit.node;
  const n = seq.items.length;
  if (n === 0) return replaceHolder(src, hit.holder, seq, [value]);
  if (seq.flow) {
    const end = rangeOf(seq.items[n - 1] as AnyNode)[1];
    return splice(src, end, end, `, ${renderInline(value)}`);
  }
  const span = itemSpan(src, seq, n - 1);
  const lines = renderItemLines(value, span.col, [...path, n]);
  const lead = span.end === src.length && !src.endsWith('\n') ? '\n' : '';
  return splice(src, span.end, span.end, lead + lines.join('\n') + '\n');
}

/** Swap two items of the sequence at `path` (their text moves; the text between them stays). */
export function swapItems(src: string, path: Path, a: number, b: number): string {
  const [i, j] = a < b ? [a, b] : [b, a];
  if (i === j) return src;
  const doc = parseYaml(src);
  const hit = locate(doc, path);
  if (!hit || !isSeq(hit.node)) return src;
  const seq = hit.node;
  if (i < 0 || j >= seq.items.length) return src;
  if (seq.flow) {
    const ri = rangeOf(seq.items[i] as AnyNode);
    const rj = rangeOf(seq.items[j] as AnyNode);
    const ti = src.slice(ri[0], ri[1]);
    const tj = src.slice(rj[0], rj[1]);
    return src.slice(0, ri[0]) + tj + src.slice(ri[1], rj[0]) + ti + src.slice(rj[1]);
  }
  const si = itemSpan(src, seq, i);
  const sj = itemSpan(src, seq, j);
  let ti = src.slice(si.start, si.end);
  let tj = src.slice(sj.start, sj.end);
  const between = src.slice(si.end, sj.start);
  const eofNoNl = !tj.endsWith('\n');
  if (eofNoNl) { tj += '\n'; ti = ti.replace(/\n$/, ''); }
  return src.slice(0, si.start) + tj + between + ti + src.slice(sj.end);
}

/**
 * Rebuild the sequence at `path` from `order`: each entry is an existing item index (its text, with any comment lines
 * just above it, moves verbatim) or a new value to render. Items not listed are dropped.
 */
export function rebuildSeq(src: string, path: Path, order: ({ index: number } | { value: unknown })[]): string {
  const doc = parseYaml(src);
  const hit = locate(doc, path);
  if (!hit || !isSeq(hit.node) || hit.node.items.length === 0 || order.length === 0) {
    return setIn(src, path, order.map((o) => ('index' in o ? valueAt(src, [...path, o.index]) : o.value)));
  }
  const seq = hit.node;
  if (seq.flow) {
    const texts = order.map((o) => {
      if ('value' in o) return renderInline(o.value);
      const r = rangeOf(seq.items[o.index] as AnyNode);
      return src.slice(r[0], r[1]);
    });
    const r = rangeOf(seq);
    return splice(src, r[0], r[1], `[${texts.join(', ')}]`);
  }
  const spans = seq.items.map((_, k) => itemSpan(src, seq, k));
  const chunks = spans.map((s, k) => {
    const gap = k > 0 ? src.slice(spans[k - 1]!.end, s.start) : '';
    const t = gap + src.slice(s.start, s.end);
    return t.endsWith('\n') ? t : t + '\n';
  });
  const first = spans[0]!;
  const lastSpan = spans[spans.length - 1]!;
  const text = order.map((o, k) => {
    if ('index' in o) return chunks[o.index]!;
    return renderItemLines(o.value, first.col, [...path, k]).join('\n') + '\n';
  }).join('');
  const regionEndsNl = src.slice(first.start, lastSpan.end).endsWith('\n');
  const out = first.inline ? text.slice(first.col) : text;
  return splice(src, first.start, lastSpan.end, regionEndsNl ? out : out.replace(/\n$/, ''));
}

/**
 * The source text of the value at `path`, dedented, for YAML text areas (comments kept). Undefined if missing.
 */
export function sourceOf(src: string, path: Path): string | undefined {
  const doc = parseYaml(src);
  const hit = locate(doc, path);
  if (!hit || hit.node === null || hit.node === undefined) return undefined;
  const node = hit.node;
  if (!isCollection(node) || (node as YAMLMap).flow) {
    const r = rangeOf(node);
    return src.slice(r[0], r[1]) + '\n';
  }
  if (node.items.length === 0) return undefined;
  let start: number;
  let end: number;
  let col: number;
  if (isMap(node)) {
    const pairs = node.items as Pair[];
    const firstKey = rangeOf(pairs[0]!.key as AnyNode)[0];
    col = column(src, firstKey);
    if (!onlyWsBefore(src, firstKey)) return undefined;
    start = hit.holder.type === 'pair' ? lineEndIncl(src, rangeOf(hit.holder.pair.key as AnyNode)[1]) : lineStart(src, firstKey);
    if (start > firstKey) start = lineStart(src, firstKey);
    end = hit.holder.type === 'pair' ? pairSpan(src, hit.holder.pair).end : pairSpan(src, pairs[pairs.length - 1]!).end;
  } else {
    const first = itemSpan(src, node as YAMLSeq, 0);
    if (first.inline) return undefined;
    col = first.col;
    start = first.start;
    end = itemSpan(src, node as YAMLSeq, node.items.length - 1).end;
  }
  const lines = src.slice(start, end).replace(/\n$/, '').split('\n');
  return lines.map((l) => {
    const ind = l.length - l.trimStart().length;
    return ind >= col ? l.slice(col) : l.trimStart();
  }).join('\n') + '\n';
}
