// Config writing (§4 "How the UI writes the config", UI9, UI13, UI19–UI27). Every operation takes the config text
// (or null when there is no file) and returns the new text, or a refusal. Only the bytes that change are rewritten.
import { parseDocument } from 'yaml';
import { UNASSIGNED, type Problems } from '../types';
import { isValidColor, sameColor } from './color';
import { deepEqual, isPlainObject, isScalarValue, renderDocument, type Path } from './emit';
import { BORDER_STYLES, COLOR_PROPS, FONT_STYLES, type ColorProp, type FlowConfig, type StyleProp } from './model';
import { parseConfig, readRules, scalarString } from './parse';
import {
  appendItem, deleteIn, rebuildSeq, renameKey, setIn, sourceOf, SpliceError, swapItems, valueAt,
} from './splice';

/** The new file text (null: there is still no file), or why the operation was refused. */
export type EditResult = { ok: true; text: string | null } | { ok: false; error: string };

/** A metadata value from the inspector's field form (UI24). */
export type FieldValue =
  | { type: 'text'; value: string }
  | { type: 'list'; items: string[] }
  | { type: 'map'; entries: [string, string][] }
  | { type: 'yaml'; text: string };

export type MatchInput = { op: 'equals'; value: string } | { op: 'present' } | { op: 'absent' };

class Refusal extends Error {}
const refuse = (msg: string): never => { throw new Refusal(msg); };

const NEW_FILE = 'version: 1\n';

/**
 * The field form's textarea to a value (§8.3 Field form): text as is; a list is one item per line (blank lines
 * skipped); a map is one `key: value` per line, split at the first `: ` (a line ending in `:` has an empty value).
 */
export function fieldValueFromForm(type: 'text' | 'list' | 'map' | 'yaml', text: string): FieldValue | { error: string } {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  if (type === 'text') return { type, value: text };
  if (type === 'yaml') return { type, text };
  if (type === 'list') return { type, items: lines.filter((l) => l.trim() !== '') };
  const entries: [string, string][] = [];
  for (const l of lines) {
    if (l.trim() === '') continue;
    const at = l.indexOf(': ');
    if (at > 0) entries.push([l.slice(0, at), l.slice(at + 2)]);
    else if (l.endsWith(':') && l.length > 1) entries.push([l.slice(0, -1), '']);
    else return { error: `Each map line must be "key: value" (got "${l}")` };
  }
  return { type, entries };
}

function parseYamlValue(text: string, what: string): unknown {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) refuse(`${what} is not valid YAML: ${doc.errors[0]!.message}`);
  try {
    return doc.toJS({ maxAliasCount: 100 }) ?? null;
  } catch (e) {
    return refuse(`${what} is not valid YAML: ${(e as Error).message}`);
  }
}

export function fieldValueToJs(v: FieldValue): unknown {
  switch (v.type) {
    case 'text': return v.value;
    case 'list': return [...v.items];
    case 'map': {
      const m: Record<string, string> = {};
      for (const [k, x] of v.entries) m[k] = x;
      return m;
    }
    case 'yaml': return parseYamlValue(v.text, 'The value');
  }
}

/** Rules that match `field` with the old value get the new one (UI9, UI19). */
function renameMatchValues(src: string, field: string, oldV: string, newV: string): string {
  let out = src;
  const raw = valueAt(out, ['styles']);
  if (!Array.isArray(raw)) return out;
  raw.forEach((rule, i) => {
    if (!isPlainObject(rule) || !isPlainObject(rule.match) || !Object.hasOwn(rule.match, field)) return;
    const v = rule.match[field];
    if (isScalarValue(v) && scalarString(v) === oldV) out = setIn(out, ['styles', i, 'match', field], newV);
  });
  return out;
}

const blank = (s: string | null | undefined) => s === null || s === undefined || s.trim() === '';

export class ConfigDoc {
  constructor(readonly text: string | null) {}

  /** The parsed config (null if the file has errors). */
  get config(): FlowConfig | null {
    return parseConfig(this.text).config;
  }

  private run(op: (src: string, cfg: FlowConfig) => string): EditResult {
    let cfg: FlowConfig;
    if (this.text !== null) {
      const parsed = parseConfig(this.text);
      if (!parsed.config) {
        return { ok: false, error: 'The config file has errors; fix it before editing the config from the UI' };
      }
      cfg = parsed.config;
    } else cfg = parseConfig(null).config!;
    const base = this.text ?? NEW_FILE;
    let out: string;
    try {
      out = op(base, cfg);
    } catch (e) {
      if (e instanceof Refusal) return { ok: false, error: e.message };
      if (e instanceof SpliceError) return { ok: false, error: `Could not edit the config: ${e.message}` };
      throw e;
    }
    if (this.text === null && out === base) return { ok: true, text: null };
    if (out !== this.text && parseConfig(out).problems.errors.length) {
      return { ok: false, error: 'internal: the edit would leave the config invalid' };
    }
    return { ok: true, text: out };
  }

  // ---- title (UI22)

  setTitle(title: string | null): EditResult {
    return this.run((src) => (blank(title) ? deleteIn(src, ['title']) : setIn(src, ['title'], title)));
  }

  // ---- lanes (UI18–UI21, UI27)

  /** UI20: write `lanes` as exactly these lanes in this order; existing entries keep extra keys (and their text). */
  setLaneOrder(laneIds: readonly string[]): EditResult {
    const ids = [...new Set(laneIds)].filter((id) => id !== UNASSIGNED);
    return this.run((src, cfg) => {
      const existing = cfg.lanes ?? [];
      if (cfg.lanes && existing.length === ids.length && existing.every((l, i) => l.id === ids[i])) return src;
      if (!cfg.lanes) return setIn(src, ['lanes'], ids.map((id) => ({ id })));
      const firstIndex = new Map<string, number>();
      existing.forEach((l, i) => { if (!firstIndex.has(l.id)) firstIndex.set(l.id, i); });
      return rebuildSeq(src, ['lanes'], ids.map((id) => {
        const index = firstIndex.get(id);
        return index === undefined ? { value: { id } } : { index };
      }));
    });
  }

  /** UI18: a new lane is appended to `lanes` only if the config has a `lanes` list. */
  appendLane(id: string): EditResult {
    return this.run((src, cfg) => {
      if (!cfg.lanes || cfg.lanes.some((l) => l.id === id)) return src;
      return appendItem(src, ['lanes'], { id });
    });
  }

  /** UI21 / UI27: remove every `lanes` entry with this id. */
  deleteLaneEntry(id: string): EditResult {
    return this.run((src, cfg) => {
      let out = src;
      const idx = (cfg.lanes ?? []).map((l, i) => (l.id === id ? i : -1)).filter((i) => i >= 0);
      for (const i of idx.reverse()) out = deleteIn(out, ['lanes', i]);
      return out;
    });
  }

  /** UI19: rename a lane id in `lanes` and in rules that match `lane` with the old value. */
  renameLane(oldId: string, newId: string): EditResult {
    return this.run((src, cfg) => {
      if (oldId === newId) return src;
      let out = src;
      (cfg.lanes ?? []).forEach((l, i) => { if (l.id === oldId) out = setIn(out, ['lanes', i, 'id'], newId); });
      return renameMatchValues(out, 'lane', oldId, newId);
    });
  }

  // ---- node metadata (UI24, UI9, UI13, UI27)

  setNodeField(id: string, key: string, value: FieldValue): EditResult {
    return this.setFieldOnNodes([id], key, value);
  }

  removeNodeField(id: string, key: string): EditResult {
    return this.removeFieldFromNodes([id], key);
  }

  /** Set one field on several nodes, in the given order (new entries are appended in that order). */
  setFieldOnNodes(ids: readonly string[], key: string, value: FieldValue): EditResult {
    return this.run((src) => {
      if (key.trim() === '') refuse('A field needs a name');
      const v = fieldValueToJs(value);
      let out = src;
      for (const id of ids) out = setIn(out, ['nodes', id, key], v);
      return out;
    });
  }

  /** Remove a field from several nodes; a node left with no fields loses its entry (§4). */
  removeFieldFromNodes(ids: readonly string[], key: string): EditResult {
    return this.run((src) => {
      let out = src;
      for (const id of ids) {
        const entry = valueAt(out, ['nodes', id]);
        if (!isPlainObject(entry) || !Object.hasOwn(entry, key)) continue;
        out = Object.keys(entry).length === 1 ? deleteIn(out, ['nodes', id]) : deleteIn(out, ['nodes', id, key]);
      }
      return out;
    });
  }

  /** UI24 node YAML: replace the node's whole entry. Empty YAML (or `{}`) removes it; anything but a map is refused. */
  replaceNodeEntry(id: string, yamlText: string): EditResult {
    return this.run((src) => {
      const v = parseYamlValue(yamlText, 'The node YAML');
      if (v === null || (isPlainObject(v) && Object.keys(v).length === 0)) return deleteIn(src, ['nodes', id]);
      if (!isPlainObject(v)) refuse('The node YAML must be a map of fields (key: value)');
      return setIn(src, ['nodes', id], v);
    });
  }

  /** UI9: rename the node's `nodes` key in place and update rules that match `id` with the old value. */
  renameNode(oldId: string, newId: string): EditResult {
    return this.run((src, cfg) => {
      if (oldId === newId) return src;
      if (Object.hasOwn(cfg.nodes, newId)) refuse(`The config already has an entry for "${newId}"`);
      let out = src;
      if (Object.hasOwn(cfg.nodes, oldId)) out = renameKey(out, ['nodes'], oldId, newId);
      return renameMatchValues(out, 'id', oldId, newId);
    });
  }

  /** UI13: copy a node's entry to a new id, appended at the end of `nodes`. Nothing to copy: no change. */
  copyNode(fromId: string, toId: string): EditResult {
    return this.run((src, cfg) => {
      if (!Object.hasOwn(cfg.nodes, fromId)) return src;
      if (Object.hasOwn(cfg.nodes, toId)) refuse(`The config already has an entry for "${toId}"`);
      const entry = valueAt(src, ['nodes', fromId]);
      if (!isPlainObject(entry) || Object.keys(entry).length === 0) return src;
      return setIn(src, ['nodes', toId], structuredClone(entry));
    });
  }

  /** UI27: delete a node's entry (an emptied `nodes` becomes `nodes: {}`). */
  deleteNodeEntry(id: string): EditResult {
    return this.run((src) => deleteIn(src, ['nodes', id]));
  }

  // ---- style rules (UI25)

  private rule(cfg: FlowConfig, i: number): void {
    if (!Number.isInteger(i) || i < 0 || i >= cfg.styles.length) refuse(`There is no style rule ${i + 1}`);
  }

  /** A new rule `{match: {}, style: {}}`, appended at the end of `styles`. */
  addRule(): EditResult {
    return this.run((src) => appendItem(src, ['styles'], { match: {}, style: {} }));
  }

  deleteRule(i: number): EditResult {
    return this.run((src, cfg) => { this.rule(cfg, i); return deleteIn(src, ['styles', i]); });
  }

  /** Move a rule one place; moving past either end changes nothing. */
  moveRule(i: number, dir: 'up' | 'down'): EditResult {
    return this.run((src, cfg) => {
      this.rule(cfg, i);
      const j = dir === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= cfg.styles.length) return src;
      return swapItems(src, ['styles'], i, j);
    });
  }

  setRuleLegend(i: number, text: string | null): EditResult {
    return this.run((src, cfg) => {
      this.rule(cfg, i);
      return blank(text) ? deleteIn(src, ['styles', i, 'legend']) : setIn(src, ['styles', i, 'legend'], text);
    });
  }

  /** Add a match condition, or replace the one on the same field. */
  setMatchCondition(i: number, field: string, cond: MatchInput): EditResult {
    return this.run((src, cfg) => {
      this.rule(cfg, i);
      if (field.trim() === '') refuse('A match condition needs a field');
      return setIn(src, ['styles', i, 'match', field], cond.op === 'equals' ? cond.value : cond.op);
    });
  }

  /** Edit a condition: rename its field in place (if changed) and set its test. */
  editMatchCondition(i: number, oldField: string, newField: string, cond: MatchInput): EditResult {
    return this.run((src, cfg) => {
      this.rule(cfg, i);
      if (newField.trim() === '') refuse('A match condition needs a field');
      const match = valueAt(src, ['styles', i, 'match']);
      if (!isPlainObject(match) || !Object.hasOwn(match, oldField)) refuse(`Rule ${i + 1} has no condition on "${oldField}"`);
      let out = src;
      if (oldField !== newField) {
        if (Object.hasOwn(match as object, newField)) refuse(`Rule ${i + 1} already has a condition on "${newField}"`);
        out = renameKey(out, ['styles', i, 'match'], oldField, newField);
      }
      return setIn(out, ['styles', i, 'match', newField], cond.op === 'equals' ? cond.value : cond.op);
    });
  }

  removeMatchCondition(i: number, field: string): EditResult {
    return this.run((src, cfg) => { this.rule(cfg, i); return deleteIn(src, ['styles', i, 'match', field]); });
  }

  /**
   * Set or clear (null or empty) a non-colour style property: `border_style`, `font_style` (one of their values),
   * `border_width` (an integer, written as one), `badge` (text). Colours go through setStyleColor.
   */
  setStyleProp(i: number, prop: StyleProp, value: string | number | null): EditResult {
    if ((COLOR_PROPS as readonly string[]).includes(prop)) {
      return this.setStyleColor(i, prop as ColorProp, value === null ? null : String(value), null);
    }
    return this.run((src, cfg) => {
      this.rule(cfg, i);
      const path: Path = ['styles', i, 'style', prop];
      if (value === null || (typeof value === 'string' && value.trim() === '')) return deleteIn(src, path);
      let v: string | number;
      switch (prop) {
        case 'border_width': {
          const n = typeof value === 'number' ? value : /^\s*-?\d+\s*$/.test(value) ? Number(value) : NaN;
          if (!Number.isInteger(n)) refuse('Border width must be a whole number');
          v = n;
          break;
        }
        case 'border_style':
          if (!(BORDER_STYLES as readonly string[]).includes(String(value))) refuse('Border style must be solid, dashed or dotted');
          v = String(value);
          break;
        case 'font_style':
          if (!(FONT_STYLES as readonly string[]).includes(String(value))) refuse('Font style must be normal, italic or bold');
          v = String(value);
          break;
        case 'badge':
          v = String(value);
          break;
        default:
          return refuse(`Unknown style property "${prop}"`);
      }
      return setIn(src, path, v);
    });
  }

  /**
   * Set a colour property from its light and dark inputs (UI25): both empty clears it; a dark colour needs a light
   * one; a dark value that is empty or the same colour as the light one writes a single colour; otherwise
   * `{light, dark}`. Colours are `#rgb` or `#rrggbb`, written lowercase as entered.
   */
  setStyleColor(i: number, prop: ColorProp, light: string | null, dark: string | null): EditResult {
    return this.run((src, cfg) => {
      this.rule(cfg, i);
      if (!(COLOR_PROPS as readonly string[]).includes(prop)) refuse(`"${prop}" is not a colour property`);
      const l = blank(light) ? null : light!.trim().toLowerCase();
      const d = blank(dark) ? null : dark!.trim().toLowerCase();
      const path: Path = ['styles', i, 'style', prop];
      if (l === null && d === null) return deleteIn(src, path);
      if (l === null) return refuse('A dark colour needs a light colour too');
      if (!isValidColor(l)) refuse(`"${light}" is not a colour (use #rgb or #rrggbb)`);
      if (d !== null && !isValidColor(d)) refuse(`"${dark}" is not a colour (use #rgb or #rrggbb)`);
      const value = d === null || sameColor(l, d) ? l : { light: l, dark: d };
      return setIn(src, path, value);
    });
  }

  /** UI25 styles YAML: replace the whole `styles` list; anything but a list of rules is refused. */
  replaceStyles(yamlText: string): EditResult {
    return this.run((src) => {
      const v = parseYamlValue(yamlText, 'The styles YAML');
      if (!Array.isArray(v)) return refuse('The styles YAML must be a list of rules (- match: … style: …)');
      const problems: Problems = { errors: [], warnings: [] };
      readRules(v, problems);
      const first = problems.errors[0];
      if (first) refuse(first.message.replace(/^Config /, ''));
      if (deepEqual(valueAt(src, ['styles']) ?? null, v)) return src;
      return setIn(src, ['styles'], v);
    });
  }

  // ---- text for the YAML editors

  /** The node's metadata entry as YAML (its source text, comments kept), or '' if it has none. */
  nodeYaml(id: string): string {
    return this.yamlOf(['nodes', id]);
  }

  /** The whole `styles` list as YAML (its source text, comments kept), or '' if there is none. */
  stylesYaml(): string {
    return this.yamlOf(['styles']);
  }

  private yamlOf(path: Path): string {
    if (this.text === null || !parseConfig(this.text).config) return '';
    try {
      const v = valueAt(this.text, path);
      if (v === undefined || v === null) return '';
      const src = sourceOf(this.text, path);
      if (src !== undefined && deepEqual(parseDocument(src).toJS() ?? null, v)) return src;
      return renderDocument(v, path);
    } catch {
      return '';
    }
  }
}
