// A small, deterministic YAML emitter for the values the UI writes into the config (§4 "How the UI writes the config").
// We emit text ourselves (rather than via yaml's stringifier) so that new text is predictable and so that edits can be
// spliced into the original file without re-rendering anything else (UI26).
import { parseDocument } from 'yaml';

export type Seg = string | number;
export type Path = Seg[];

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date) && !ArrayBuffer.isView(v);
}

export function isScalarValue(v: unknown): v is string | number | boolean | null {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

const plainCache = new Map<string, boolean>();

function parsesTo(src: string, version: '1.1' | '1.2', expected: unknown): boolean {
  try {
    const doc = parseDocument(src, { version, uniqueKeys: false });
    if (doc.errors.length || doc.warnings.length) return false;
    return sameJs(doc.toJS(), expected);
  } catch {
    return false;
  }
}

function sameJs(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameJs(x, b[i]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameJs(a[k], b[k]));
  }
  return false;
}

/** Deep equality of parsed YAML values (key order matters). */
export const deepEqual = sameJs;

/**
 * True when `s` can be written as a plain scalar and read back as the same string, as a block value, a flow item and
 * a key, under both YAML 1.2 (our reader) and YAML 1.1 (PyYAML and friends: `yes`, `on`, dates, sexagesimals).
 * Over-quoting is harmless; under-quoting changes the parsed type.
 */
export function plainOk(s: string): boolean {
  const hit = plainCache.get(s);
  if (hit !== undefined) return hit;
  let ok = s.length > 0 && s.trim() === s && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/.test(s);
  if (ok) {
    for (const version of ['1.2', '1.1'] as const) {
      ok = ok
        && parsesTo(`k: ${s}\n`, version, { k: s })
        && parsesTo(`[${s}]\n`, version, [s])
        && parsesTo(`{${s}: 1}\n`, version, { [s]: 1 })
        && parsesTo(`${s}: 1\n`, version, { [s]: 1 });
      if (!ok) break;
    }
  }
  if (plainCache.size > 5000) plainCache.clear();
  plainCache.set(s, ok);
  return ok;
}

/** A YAML double-quoted scalar. JSON string syntax is a subset of YAML's; escape the few extra non-printables. */
export function doubleQuote(s: string): string {
  return JSON.stringify(s).replace(/[\u007f-\u009f\u2028\u2029\ufeff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function renderString(s: string): string {
  return plainOk(s) ? s : doubleQuote(s);
}

export function renderScalar(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return renderString(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return '.nan';
    if (v === Infinity) return '.inf';
    if (v === -Infinity) return '-.inf';
    return String(v);
  }
  if (typeof v === 'bigint') return String(v);
  return doubleQuote(String(v));
}

export function renderKey(k: string): string {
  return renderString(k);
}

/** Flow-style rendering, safe anywhere (block or flow context). */
export function renderInline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(renderInline).join(', ')}]`;
  if (isPlainObject(v)) {
    return `{${Object.entries(v).map(([k, x]) => `${renderKey(k)}: ${renderInline(x)}`).join(', ')}}`;
  }
  return renderScalar(v);
}

/**
 * Where a collection value at `path` is written in flow style even in a block context. Style rules keep their
 * `match` and `style` maps (and anything inside them) inline, as the fixture does.
 */
export function flowByPolicy(path: Path): boolean {
  return path[0] === 'styles' && path.length >= 3;
}

export function isInlineish(v: unknown, path: Path): boolean {
  if (!Array.isArray(v) && !isPlainObject(v)) return true;
  if (Array.isArray(v)) {
    if (v.length === 0 || v.every(isScalarValue)) return true;
  } else if (Object.keys(v).length === 0) return true;
  return flowByPolicy(path);
}

const pad = (n: number) => ' '.repeat(n);

/** Block lines for `key: value` at `indent`; `keyText` is the already-rendered key. */
export function renderPairLines(keyText: string, value: unknown, indent: number, path: Path): string[] {
  if (isInlineish(value, path)) return [`${pad(indent)}${keyText}: ${renderInline(value)}`];
  const head = `${pad(indent)}${keyText}:`;
  if (Array.isArray(value)) {
    return [head, ...value.flatMap((item, i) => renderItemLines(item, indent + 2, [...path, i]))];
  }
  return [head, ...renderMapLines(value as Record<string, unknown>, indent + 2, path)];
}

export function renderMapLines(map: Record<string, unknown>, indent: number, path: Path): string[] {
  return Object.entries(map).flatMap(([k, v]) => renderPairLines(renderKey(k), v, indent, [...path, k]));
}

/** Block lines for a sequence item with its `- ` at `indent`. */
export function renderItemLines(value: unknown, indent: number, path: Path): string[] {
  if (isInlineish(value, path)) return [`${pad(indent)}- ${renderInline(value)}`];
  const inner = Array.isArray(value)
    ? value.flatMap((item, i) => renderItemLines(item, indent + 2, [...path, i]))
    : renderMapLines(value as Record<string, unknown>, indent + 2, path);
  inner[0] = `${pad(indent)}- ${inner[0]!.slice(indent + 2)}`;
  return inner;
}

/** Top-level-ish rendering of a whole value at column 0 (for YAML text areas). */
export function renderDocument(value: unknown, path: Path): string {
  if (Array.isArray(value) && value.length > 0 && !isInlineish(value, path)) {
    return value.flatMap((item, i) => renderItemLines(item, 0, [...path, i])).join('\n') + '\n';
  }
  if (isPlainObject(value) && Object.keys(value).length > 0) return renderMapLines(value, 0, path).join('\n') + '\n';
  return renderInline(value) + '\n';
}
