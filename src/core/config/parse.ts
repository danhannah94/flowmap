// Reading the `.flow.yaml` config (§4) and checking it against the diagram (§7 codes).
import { parseDocument } from 'yaml';
import type { Problem, Problems, ResolvedStyle, ThemedColor } from '../types';
import { UNASSIGNED } from '../types';
import { isValidColor, normalizeColor } from './color';
import { isIdForm, isReservedId } from '../mmd/syntax';
import { isPlainObject, isScalarValue } from './emit';
import {
  BLOCK_STYLE_KEY, BORDER_STYLES, COLOR_PROPS, emptyConfig, FONT_STYLES, NOTE_FONT_MAX, NOTE_FONT_MIN, STYLE_PROPS,
  type ConfigLane, type ConfigNote, type FlowConfig, type MatchCondition, type NodeMeta, type StyleRule,
} from './model';

const TOP_KEYS = new Set(['version', 'title', 'show_title', 'lanes', 'styles', 'nodes', 'notes']);
const NOTE_KEYS = new Set(['text', 'font_size', 'bold', 'color']);
const RULE_KEYS = new Set(['legend', 'match', 'style']);
const LANE_KEYS = new Set(['id']);

/** A YAML scalar as the string match compares (§4: `2` matches `"2"`). */
export function scalarString(v: string | number | boolean | null): string {
  return v === null ? 'null' : String(v);
}

const err = (message: string): Problem => ({ code: 'E-config', line: null, message });
const warn = (code: string, message: string): Problem => ({ code, line: null, message });

export interface ConfigParse {
  /** The config, or null when it has errors (use default styles, §7). No file gives an empty config. */
  config: FlowConfig | null;
  problems: Problems;
}

export function parseConfig(text: string | null): ConfigParse {
  const problems: Problems = { errors: [], warnings: [] };
  if (text === null) return { config: emptyConfig(), problems };
  const doc = parseDocument(text, { uniqueKeys: true });
  const [firstYamlError] = doc.errors;
  if (firstYamlError) {
    // The yaml library can report several cascading parse errors for one malformed file (for example an
    // unclosed flow collection produces both a "block collections not allowed" and a follow-on "must end with
    // ]" error). One invalid file is one error (§4), so only the first is reported.
    problems.errors.push(err(`Config is not valid YAML: ${firstYamlError.message}`));
    return { config: null, problems };
  }
  let js: unknown;
  try {
    js = doc.toJS({ maxAliasCount: 100 });
  } catch (e) {
    problems.errors.push(err(`Config is not valid YAML: ${(e as Error).message}`));
    return { config: null, problems };
  }
  const config = readConfig(js, problems);
  return { config: problems.errors.length ? null : config, problems };
}

function readConfig(js: unknown, p: Problems): FlowConfig {
  const config = emptyConfig();
  if (js === null || js === undefined) return config;
  if (!isPlainObject(js)) {
    p.errors.push(err('Config must be a map of keys (version, title, show_title, lanes, styles, nodes, notes)'));
    return config;
  }
  for (const key of Object.keys(js)) {
    if (!TOP_KEYS.has(key)) p.warnings.push(warn('W-config-key', `Unknown config key "${key}" (ignored)`));
  }
  if ('version' in js && js.version !== 1) {
    p.errors.push(err(`Config version must be 1 (found ${JSON.stringify(js.version)})`));
  }
  const title = js.title;
  if (title !== undefined && title !== null) {
    if (isScalarValue(title)) config.title = scalarString(title);
    else p.errors.push(err('Config "title" must be text'));
  }
  const lanes = js.lanes;
  if (lanes !== undefined && lanes !== null) {
    if (!Array.isArray(lanes)) p.errors.push(err('Config "lanes" must be a list'));
    else config.lanes = readLanes(lanes, p);
  }
  const styles = js.styles;
  if (styles !== undefined && styles !== null) {
    if (!Array.isArray(styles)) p.errors.push(err('Config "styles" must be a list of rules'));
    else config.styles = readRules(styles, p);
  }
  const nodes = js.nodes;
  if (nodes !== undefined && nodes !== null) {
    if (!isPlainObject(nodes)) p.errors.push(err('Config "nodes" must be a map of node ids'));
    else {
      for (const [id, entry] of Object.entries(nodes)) {
        if (entry === null) config.nodes[id] = {};
        else if (isPlainObject(entry)) {
          config.nodes[id] = entry as NodeMeta;
          const style = readBlockStyle(id, entry, p);
          if (style) config.nodeStyles[id] = style;
        } else p.errors.push(err(`Config entry for node "${id}" must be a map of fields`));
      }
    }
  }
  const showTitle = js.show_title;
  if (showTitle !== undefined && showTitle !== null) {
    if (typeof showTitle === 'boolean') config.showTitle = showTitle;
    else p.errors.push(err('Config "show_title" must be true or false'));
  }
  const notes = js.notes;
  if (notes !== undefined && notes !== null) {
    if (!isPlainObject(notes)) p.errors.push(err('Config "notes" must be a map of note ids'));
    else {
      for (const [id, entry] of Object.entries(notes)) {
        const note = readNote(id, entry, p);
        if (note) config.notes[id] = note;
      }
    }
  }
  return config;
}

/**
 * v1.1 §4: a block's own `style` map. Bad or unknown properties are `W-style` and ignored, as in rules; a `style` that
 * isn't a map is `W-style` and ignored as a whole; a null `style` is no style. Returns the valid properties, or
 * undefined when the node has no `style`.
 */
function readBlockStyle(id: string, entry: Record<string, unknown>, p: Problems): ResolvedStyle | undefined {
  if (!Object.hasOwn(entry, BLOCK_STYLE_KEY)) return undefined;
  const raw = entry[BLOCK_STYLE_KEY];
  if (raw === null || raw === undefined) return undefined;
  const where = `node "${id}" style`;
  if (!isPlainObject(raw)) {
    p.warnings.push(warn('W-style', `${where} must be a map of style properties (ignored)`));
    return undefined;
  }
  return readStyle(raw, where, p);
}

/**
 * v1.1 §4 notes: `{text, font_size?, bold?, color?}`. The id follows the node id rules (else `E-config`); a missing,
 * non-text or blank `text` is `E-config`; a bad `font_size`, `bold` or `color` is `W-style` and ignored; any other key
 * is `W-config-key`. Trailing line breaks in `text` are dropped (a note has none, §4; a YAML `|` block adds one).
 */
function readNote(id: string, entry: unknown, p: Problems): ConfigNote | undefined {
  let ok = true;
  if (!isIdForm(id) || isReservedId(id)) {
    p.errors.push(err(`Config note id "${id}" must follow the node id rules (letters, digits, _ and -, not reserved)`));
    ok = false;
  }
  if (!isPlainObject(entry)) {
    p.errors.push(err(`Config note "${id}" must be a map with a "text"`));
    return undefined;
  }
  const text = entry.text;
  if (typeof text !== 'string' || text.trim() === '') {
    p.errors.push(err(`Config note "${id}" needs a "text" that isn't empty`));
    ok = false;
  }
  const where = `note "${id}"`;
  const bad = (prop: string, why: string) => p.warnings.push(warn('W-style', `${where}: ${why} "${prop}" (ignored)`));
  const note: ConfigNote = { text: typeof text === 'string' ? text.replace(/[\r\n]+$/, '') : '' };
  for (const [k, v] of Object.entries(entry)) {
    if (k === 'text') continue;
    if (!NOTE_KEYS.has(k)) { p.warnings.push(warn('W-config-key', `Unknown key "${k}" in ${where} (ignored)`)); continue; }
    if (v === null) continue;
    if (k === 'font_size') {
      if (typeof v === 'number' && Number.isInteger(v) && v >= NOTE_FONT_MIN && v <= NOTE_FONT_MAX) note.font_size = v;
      else bad(k, `bad value (an integer ${NOTE_FONT_MIN} to ${NOTE_FONT_MAX}) for`);
    } else if (k === 'bold') {
      if (typeof v === 'boolean') note.bold = v;
      else bad(k, 'bad value (true or false) for');
    } else if (k === 'color') {
      const c = readColor(v);
      if (c === undefined) bad(k, 'bad colour (use #rgb, #rrggbb or {light, dark}) for');
      else note.color = c;
    }
  }
  return ok ? note : undefined;
}

function readLanes(list: unknown[], p: Problems): ConfigLane[] {
  const out: ConfigLane[] = [];
  list.forEach((entry, i) => {
    if (!isPlainObject(entry) || !('id' in entry) || !isScalarValue(entry.id) || entry.id === null) {
      p.errors.push(err(`Config lanes entry ${i + 1} must be a map with an "id"`));
      return;
    }
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entry)) {
      if (LANE_KEYS.has(k)) continue;
      extra[k] = v;
      p.warnings.push(warn('W-config-key', `Unknown key "${k}" in lanes entry "${scalarString(entry.id)}" (ignored)`));
    }
    out.push({ id: scalarString(entry.id), extra });
  });
  return out;
}

/** Validate a `styles` list; E-config problems for wrong types, W-style / W-config-key for the rest. */
export function readRules(list: unknown[], p: Problems): StyleRule[] {
  const out: StyleRule[] = [];
  list.forEach((rule, i) => {
    const where = `style rule ${i + 1}`;
    if (!isPlainObject(rule)) {
      p.errors.push(err(`Config ${where} must be a map with "match" and "style"`));
      return;
    }
    for (const k of Object.keys(rule)) {
      if (!RULE_KEYS.has(k)) p.warnings.push(warn('W-config-key', `Unknown key "${k}" in ${where} (ignored)`));
    }
    let ok = true;
    if (!('match' in rule)) { p.errors.push(err(`Config ${where} has no "match"`)); ok = false; }
    else if (!isPlainObject(rule.match)) { p.errors.push(err(`Config ${where}: "match" must be a map`)); ok = false; }
    if (!('style' in rule)) { p.errors.push(err(`Config ${where} has no "style"`)); ok = false; }
    else if (!isPlainObject(rule.style)) { p.errors.push(err(`Config ${where}: "style" must be a map`)); ok = false; }
    let legend: string | null = null;
    if (rule.legend !== undefined && rule.legend !== null) {
      if (isScalarValue(rule.legend)) legend = scalarString(rule.legend);
      else { p.errors.push(err(`Config ${where}: "legend" must be text`)); ok = false; }
    }
    const match: MatchCondition[] = [];
    if (isPlainObject(rule.match)) {
      for (const [field, v] of Object.entries(rule.match)) {
        if (!isScalarValue(v)) {
          p.errors.push(err(`Config ${where}: match value for "${field}" must be a single value, not a list or map`));
          ok = false;
          continue;
        }
        const s = scalarString(v);
        match.push({ field, op: s === 'present' || s === 'absent' ? s : 'equals', value: s });
      }
    }
    const rawStyle = isPlainObject(rule.style) ? rule.style : {};
    const style = readStyle(rawStyle, where, p);
    if (ok) out.push({ legend, match, style, rawStyle });
  });
  return out;
}

function readColor(v: unknown): ThemedColor | undefined {
  if (isValidColor(v)) return normalizeColor(v);
  if (!isPlainObject(v)) return undefined;
  const keys = Object.keys(v);
  if (!keys.every((k) => k === 'light' || k === 'dark')) return undefined;
  if (!isValidColor(v.light)) return undefined;
  if (v.dark !== undefined && !isValidColor(v.dark)) return undefined;
  const c: { light: string; dark?: string } = { light: normalizeColor(v.light) };
  if (v.dark !== undefined) c.dark = normalizeColor(v.dark as string);
  return c;
}

function readStyle(raw: Record<string, unknown>, where: string, p: Problems): ResolvedStyle {
  const style: ResolvedStyle = {};
  const bad = (prop: string, why: string) => p.warnings.push(warn('W-style', `${where}: ${why} "${prop}" (ignored)`));
  for (const [prop, v] of Object.entries(raw)) {
    if (!(STYLE_PROPS as readonly string[]).includes(prop)) { bad(prop, 'unknown style property'); continue; }
    if ((COLOR_PROPS as readonly string[]).includes(prop)) {
      const c = readColor(v);
      if (c === undefined) bad(prop, 'bad colour (use #rgb, #rrggbb or {light, dark}) for');
      else style[prop as 'fill'] = c;
    } else if (prop === 'border_style') {
      if (typeof v === 'string' && (BORDER_STYLES as readonly string[]).includes(v)) style.border_style = v as 'solid';
      else bad(prop, 'bad value (solid, dashed or dotted) for');
    } else if (prop === 'font_style') {
      if (typeof v === 'string' && (FONT_STYLES as readonly string[]).includes(v)) style.font_style = v as 'normal';
      else bad(prop, 'bad value (normal, italic or bold) for');
    } else if (prop === 'border_width') {
      if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 4) style.border_width = v;
      else bad(prop, 'bad value (an integer 1 to 4) for');
    } else if (prop === 'badge') {
      if (v !== null && isScalarValue(v)) {
        const s = scalarString(v);
        if (s !== '') style.badge = s;
      } else bad(prop, 'bad value (short text) for');
    }
  }
  return style;
}

/**
 * v1.1 §4: a note id that equals a node or subgraph id in the `.mmd` is `E-config` (line null). Needs the diagram, so it
 * is checked beside `checkReferences`; a config with such an error counts as having errors (default styles, no notes).
 */
export function checkNoteClashes(config: FlowConfig | null, nodeIds: Iterable<string>, laneIds: Iterable<string>): Problem[] {
  if (!config) return [];
  const nodes = new Set(nodeIds);
  const lanes = new Set(laneIds);
  const out: Problem[] = [];
  for (const id of Object.keys(config.notes)) {
    if (nodes.has(id)) out.push(err(`Config note "${id}" has the same id as a block in the diagram`));
    else if (lanes.has(id)) out.push(err(`Config note "${id}" has the same id as a lane in the diagram`));
  }
  return out;
}

/**
 * Config entries that don't match the diagram (§4): `W-config-unknown-node` for `nodes` keys not in the `.mmd`,
 * `W-config-unknown-lane` for `lanes` entries that aren't subgraphs (always including `_unassigned`, §3.2).
 */
export function checkReferences(config: FlowConfig | null, nodeIds: Iterable<string>, laneIds: Iterable<string>): Problem[] {
  if (!config) return [];
  const nodes = new Set(nodeIds);
  const lanes = new Set(laneIds);
  lanes.delete(UNASSIGNED);
  const out: Problem[] = [];
  for (const id of Object.keys(config.nodes)) {
    if (!nodes.has(id)) out.push(warn('W-config-unknown-node', `Config has metadata for "${id}", which is not in the diagram`));
  }
  const seen = new Set<string>();
  for (const lane of config.lanes ?? []) {
    if (lanes.has(lane.id) || seen.has(lane.id)) continue;
    seen.add(lane.id);
    out.push(warn('W-config-unknown-lane', lane.id === UNASSIGNED
      ? `Config lanes lists "${UNASSIGNED}", which is never listed (it always shows last)`
      : `Config lanes lists "${lane.id}", which is not a lane in the diagram`));
  }
  return out;
}
