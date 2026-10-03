// Preset packs (A20): a shareable set of kinds, each with an icon, a style and a legend label, that a diagram uses by
// naming it (`preset:` in the `.flow.yaml`, §4.1) instead of redefining the same style rules in every file.
//
// A pack is data: this module reads and checks it (a built-in, or the text of a pack file the host read), and says
// what a diagram's blocks get from it. Pure: no fs. A pack file's text is supplied by the host (the CLI, the server),
// because only the host knows where the diagram lives.
import { parseDocument } from 'yaml';
import { isPlainObject, isScalarValue } from '../config/emit';
import type { FlowConfig } from '../config/model';
import { readStyle, scalarString } from '../config/parse';
import { nodeMeta } from '../config/style';
import type { LegendItem, Problem, Problems, ResolvedIcon, ResolvedStyle } from '../types';
import { BUILTIN_PACKS } from './builtin';
import { GLYPHS, hasGlyph, isSafePathData, MAX_PATHS } from './glyphs';

const warn = (code: string, message: string): Problem => ({ code, line: null, message });

/** One kind in a pack: the role a block plays (`database`), and how blocks of that kind look. */
export interface PresetKind {
  id: string;
  /** The legend text, or null for a kind that has no legend entry. */
  label: string | null;
  aliases: string[];
  icon: ResolvedIcon | null;
  /** Valid properties only (bad ones warned `W-style` and dropped). */
  style: ResolvedStyle;
}

export interface PresetPack {
  /** The reference the diagram used (`cloud`, `packs/team.yaml`). */
  ref: string;
  name: string;
  /** In pack order. */
  kinds: PresetKind[];
  /** Kind ids and aliases to kinds. */
  byName: ReadonlyMap<string, PresetKind>;
}

/** The text of the pack files a host has read, keyed by the reference as written in the config; null: not readable. */
export type PresetFiles = Record<string, string | null>;

export type PresetRef =
  | { type: 'builtin'; name: string }
  | { type: 'file'; path: string }
  | { type: 'invalid'; reason: string };

const FILE_REF = /[/\\]|\.(ya?ml|json)$/i;
const BUILTIN_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;

/**
 * §4.1: a reference containing `/` or ending `.yaml`, `.yml` or `.json` is a file, relative to the diagram's folder,
 * written with forward slashes and never absolute; anything else is the name of a built-in. A file path is returned
 * normalised (`./a//b.yaml` is `a/b.yaml`; `..` segments are kept: the host decides how far up it will go).
 */
export function classifyPresetRef(ref: string): PresetRef {
  const r = ref.trim();
  if (r === '') return { type: 'invalid', reason: 'is empty' };
  if (!FILE_REF.test(r)) {
    return BUILTIN_NAME.test(r) ? { type: 'builtin', name: r } : { type: 'invalid', reason: 'is not a built-in name or a file path' };
  }
  if (r.includes('\\')) return { type: 'invalid', reason: 'must use forward slashes' };
  if (r.startsWith('/') || /^[A-Za-z]:/.test(r)) return { type: 'invalid', reason: 'must be relative to the diagram, not absolute' };
  const segments = r.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.length === 0 || segments[segments.length - 1] === '..') return { type: 'invalid', reason: 'does not name a file' };
  return { type: 'file', path: segments.join('/') };
}

/** The pack file a config asks for (normalised path), or null: no preset, a built-in, or an invalid reference. */
export function presetFileOf(config: FlowConfig | null): string | null {
  if (!config?.preset) return null;
  const ref = classifyPresetRef(config.preset);
  return ref.type === 'file' ? ref.path : null;
}

// ---- reading a pack

const PACK_KEYS = new Set(['version', 'name', 'kinds']);
const KIND_KEYS = new Set(['label', 'aliases', 'icon', 'style']);

function readIcon(raw: unknown, where: string, p: Problem[]): ResolvedIcon | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    if (hasGlyph(raw)) return { name: raw, paths: GLYPHS[raw]! };
    p.push(warn('W-preset-invalid', `${where}: no built-in icon "${raw}" (ignored)`));
    return null;
  }
  if (isPlainObject(raw) && Array.isArray(raw.paths)) {
    const paths = raw.paths;
    if (paths.length === 0 || paths.length > MAX_PATHS || !paths.every(isSafePathData)) {
      p.push(warn('W-preset-invalid', `${where}: icon "paths" must be 1 to ${MAX_PATHS} SVG path strings (ignored)`));
      return null;
    }
    return { name: 'custom', paths: paths as string[] };
  }
  p.push(warn('W-preset-invalid', `${where}: icon must be a built-in icon name or {paths: [...]} (ignored)`));
  return null;
}

function readKind(id: string, raw: unknown, packName: string, p: Problem[]): PresetKind | null {
  const where = `Preset "${packName}" kind "${id}"`;
  if (raw === null) return { id, label: null, aliases: [], icon: null, style: {} };
  if (!isPlainObject(raw)) {
    p.push(warn('W-preset-invalid', `${where} must be a map (ignored)`));
    return null;
  }
  for (const k of Object.keys(raw)) {
    if (!KIND_KEYS.has(k)) p.push(warn('W-preset-invalid', `${where}: unknown key "${k}" (ignored)`));
  }
  let label: string | null = null;
  if (raw.label !== undefined && raw.label !== null) {
    if (isScalarValue(raw.label) && scalarString(raw.label).trim() !== '') label = scalarString(raw.label);
    else p.push(warn('W-preset-invalid', `${where}: label must be text (ignored)`));
  }
  const aliases: string[] = [];
  if (raw.aliases !== undefined && raw.aliases !== null) {
    if (Array.isArray(raw.aliases) && raw.aliases.every((a) => isScalarValue(a) && a !== null && scalarString(a).trim() !== '')) {
      for (const a of raw.aliases) aliases.push(scalarString(a as string));
    } else p.push(warn('W-preset-invalid', `${where}: aliases must be a list of names (ignored)`));
  }
  const icon = readIcon(raw.icon, where, p);
  let style: ResolvedStyle = {};
  if (raw.style !== undefined && raw.style !== null) {
    if (isPlainObject(raw.style)) {
      const sp: Problems = { errors: [], warnings: [] };
      style = readStyle(raw.style, where, sp);
      p.push(...sp.warnings);
    } else p.push(warn('W-preset-invalid', `${where}: style must be a map of style properties (ignored)`));
  }
  return { id, label, aliases, icon, style };
}

function readPack(js: unknown, ref: string, p: Problem[]): PresetPack | null {
  if (!isPlainObject(js)) {
    p.push(warn('W-preset-invalid', `Preset "${ref}" must be a map with a "kinds" map (ignored)`));
    return null;
  }
  for (const k of Object.keys(js)) {
    if (!PACK_KEYS.has(k)) p.push(warn('W-preset-invalid', `Preset "${ref}": unknown key "${k}" (ignored)`));
  }
  if ('version' in js && js.version !== 1) {
    p.push(warn('W-preset-invalid', `Preset "${ref}": version must be 1 (found ${JSON.stringify(js.version)}) (ignored)`));
    return null;
  }
  const name = typeof js.name === 'string' && js.name.trim() !== '' ? js.name.trim() : ref;
  if (!isPlainObject(js.kinds)) {
    p.push(warn('W-preset-invalid', `Preset "${ref}" needs a "kinds" map (ignored)`));
    return null;
  }
  const kinds: PresetKind[] = [];
  const byName = new Map<string, PresetKind>();
  for (const [id, raw] of Object.entries(js.kinds)) {
    const kind = readKind(id, raw, name, p);
    if (!kind) continue;
    if (byName.has(id)) {
      p.push(warn('W-preset-invalid', `Preset "${name}": "${id}" is already used by another kind (ignored)`));
      continue;
    }
    kinds.push(kind);
    byName.set(id, kind);
  }
  // Aliases after every id is known, so an alias never shadows a kind id wherever it is written.
  for (const kind of kinds) {
    kind.aliases = kind.aliases.filter((a) => {
      if (byName.has(a)) {
        p.push(warn('W-preset-invalid', `Preset "${name}" kind "${kind.id}": alias "${a}" is already used by another kind (ignored)`));
        return false;
      }
      byName.set(a, kind);
      return true;
    });
  }
  return { ref, name, kinds, byName };
}

/** Read a pack file's text (YAML, which includes JSON). A pack that can't be read at all gives no pack and a warning.
 *  Every warning is about the pack file's own content, so each carries `file: ref` (shown as its location). */
export function parsePackText(text: string, ref: string): { pack: PresetPack | null; warnings: Problem[] } {
  const { pack, warnings } = readPackText(text, ref);
  return { pack, warnings: warnings.map((w) => ({ ...w, file: ref })) };
}

function readPackText(text: string, ref: string): { pack: PresetPack | null; warnings: Problem[] } {
  const warnings: Problem[] = [];
  const doc = parseDocument(text, { uniqueKeys: true });
  const [firstError] = doc.errors;
  if (firstError) {
    warnings.push(warn('W-preset-invalid', `Preset file "${ref}" is not valid YAML: ${firstError.message} (ignored)`));
    return { pack: null, warnings };
  }
  let js: unknown;
  try {
    js = doc.toJS({ maxAliasCount: 100 });
  } catch (e) {
    warnings.push(warn('W-preset-invalid', `Preset file "${ref}" is not valid YAML: ${(e as Error).message} (ignored)`));
    return { pack: null, warnings };
  }
  return { pack: readPack(js, ref, warnings), warnings };
}

/** One built-in pack, by name (checked through the same reader as a pack file), or null for an unknown name. */
export function builtinPack(name: string): PresetPack | null {
  if (!Object.hasOwn(BUILTIN_PACKS, name)) return null;
  return readPack(BUILTIN_PACKS[name], name, []);
}

export interface PresetResolution {
  pack: PresetPack | null;
  warnings: Problem[];
}

/**
 * Find the pack a config names. A built-in is looked up here; a file's text comes from `files` (read by the host,
 * keyed by the reference as written). A file the host has not been asked about at all (no key) resolves silently to
 * no pack: the UI shows a diagram before it has fetched a pack file it just named, and the CLI and server always
 * supply it. Anything else that goes wrong is a warning and the diagram is drawn without the pack.
 */
export function resolvePreset(ref: string | null, files: PresetFiles | undefined): PresetResolution {
  if (ref === null) return { pack: null, warnings: [] };
  const c = classifyPresetRef(ref);
  if (c.type === 'invalid') {
    return { pack: null, warnings: [warn('W-preset-invalid', `Preset "${ref}" ${c.reason} (ignored)`)] };
  }
  if (c.type === 'builtin') {
    const pack = builtinPack(c.name);
    if (pack) return { pack, warnings: [] };
    const known = Object.keys(BUILTIN_PACKS).join(', ');
    return { pack: null, warnings: [warn('W-preset-unknown', `Unknown preset "${ref}" (built-in presets: ${known}; a value containing "/" or ending in .yaml, .yml or .json is a pack file path, relative to the diagram's folder)`)] };
  }
  if (!files || !Object.hasOwn(files, ref)) return { pack: null, warnings: [] };
  const text = files[ref];
  if (text === null || text === undefined) {
    return { pack: null, warnings: [warn('W-preset-unknown', `Preset file "${ref}" could not be read (the path is relative to the diagram's folder and must stay inside the served folder; moving the diagram doesn't update it, so a moved diagram's pack path may need changing)`)] };
  }
  return parsePackText(text, ref);
}

// ---- applying a pack to a diagram

/** The metadata `kind` of a block as text, or null (no config entry, no `kind`, or not a single value). */
export function metaKindOf(config: FlowConfig | null, id: string): string | null {
  const k = nodeMeta(config, id)?.kind;
  return k !== undefined && k !== null && isScalarValue(k) ? scalarString(k) : null;
}

export function lookupKind(pack: PresetPack | null, kind: string | null): PresetKind | null {
  return pack && kind !== null ? (pack.byName.get(kind) ?? null) : null;
}

export interface PresetApplication {
  /** The pack's style for each block of a pack kind (the lowest layer: rules and the block's own style win). */
  styles: Record<string, ResolvedStyle>;
  icons: Record<string, ResolvedIcon>;
  /** The legend entries for the pack's kinds that the diagram uses, in pack order (§4.1). */
  legend: LegendItem[];
  warnings: Problem[];
}

/**
 * What a pack gives a diagram. Only the block's metadata `kind` selects a pack kind: a block's shape kind (`database`
 * is also a shape) does not, so a pack never restyles blocks that merely have a particular shape. A metadata kind the
 * pack does not know is `W-preset-kind`, unless a style rule of the diagram matches on that kind (then the kind is
 * the diagram's own and the pack has no say).
 */
export function applyPreset(pack: PresetPack | null, config: FlowConfig | null, nodeIds: readonly string[]): PresetApplication {
  const out: PresetApplication = { styles: {}, icons: {}, legend: [], warnings: [] };
  if (!pack) return out;
  const used = new Set<PresetKind>();
  const unknown = new Map<string, string[]>();
  const ownKinds = new Set(
    (config?.styles ?? []).flatMap((r) => r.match.filter((c) => c.field === 'kind' && c.op === 'equals').map((c) => c.value)),
  );
  for (const id of nodeIds) {
    const k = metaKindOf(config, id);
    if (k === null) continue;
    const kind = lookupKind(pack, k);
    if (!kind) {
      if (!ownKinds.has(k)) unknown.set(k, [...(unknown.get(k) ?? []), id]);
      continue;
    }
    used.add(kind);
    out.styles[id] = kind.style;
    if (kind.icon) out.icons[id] = kind.icon;
  }
  for (const [k, ids] of unknown) {
    out.warnings.push(warn('W-preset-kind', `Preset "${pack.name}" has no kind "${k}" (used by ${ids.join(', ')})`));
  }
  for (const kind of pack.kinds) {
    if (!used.has(kind) || kind.label === null) continue;
    const item: LegendItem = { text: kind.label, style: { ...kind.style } };
    if (kind.icon) item.icon = kind.icon;
    out.legend.push(item);
  }
  return out;
}
