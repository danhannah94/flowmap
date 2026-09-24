// Applying the config to the diagram: effective kind, style matching (§4), legend, lane order and title.
import type { LegendItem, ResolvedStyle, ShapeKind } from '../types';
import { UNASSIGNED } from '../types';
import { isScalarValue } from './emit';
import { BLOCK_STYLE_KEY, type FlowConfig, type NodeMeta, type StyleRule } from './model';
import { scalarString } from './parse';

/** The node properties a rule can match on, besides metadata. `kind` here is the SHAPE kind. */
export interface NodeFieldsInput {
  id: string;
  lane: string;
  label: string;
  kind: ShapeKind;
}

/** §4: the metadata `kind` if the config sets one (as a string), otherwise the shape kind. */
export function effectiveKind(shapeKind: ShapeKind, meta: NodeMeta | undefined | null): string {
  const k = meta?.kind;
  if (k !== undefined && k !== null && isScalarValue(k)) return scalarString(k);
  return shapeKind;
}

export function nodeMeta(config: FlowConfig | null, id: string): NodeMeta | undefined {
  return config && Object.hasOwn(config.nodes, id) ? config.nodes[id] : undefined;
}

/**
 * Every field `match` can see (§4): the metadata, then `id`, `lane`, `label` (built-ins win over metadata keys of the
 * same name) and `kind` as the effective kind.
 */
export function matchFields(config: FlowConfig | null, node: NodeFieldsInput): Record<string, unknown> {
  const meta = nodeMeta(config, node.id);
  return { ...(meta ?? {}), id: node.id, lane: node.lane, label: node.label, kind: effectiveKind(node.kind, meta) };
}

function fieldMatches(fields: Record<string, unknown>, field: string, value: string): boolean {
  const has = Object.hasOwn(fields, field);
  if (value === 'present') return has;
  if (value === 'absent') return !has;
  if (!has) return false;
  const v = fields[field];
  if (Array.isArray(v)) return v.some((x) => isScalarValue(x) && scalarString(x) === value);
  if (isScalarValue(v)) return scalarString(v) === value;
  return false;
}

/**
 * Every condition holds (AND); an empty match applies to every node. v1.1: a condition on `style` (a block's own
 * style, §4), including `present` and `absent`, is always false.
 */
export function ruleMatches(rule: StyleRule, fields: Record<string, unknown>): boolean {
  return rule.match.every((c) => c.field !== BLOCK_STYLE_KEY && fieldMatches(fields, c.field, c.value));
}

/**
 * The node's style: matching rules applied top to bottom, a later rule overriding earlier properties, then (v1.1) the
 * node's own `style`, which overrides every rule (§4).
 */
export function resolveStyle(config: FlowConfig | null, node: NodeFieldsInput): ResolvedStyle {
  const out: ResolvedStyle = {};
  if (!config) return out;
  const fields = matchFields(config, node);
  for (const rule of config.styles) {
    if (ruleMatches(rule, fields)) Object.assign(out, rule.style);
  }
  const own = config.nodeStyles && Object.hasOwn(config.nodeStyles, node.id) ? config.nodeStyles[node.id] : undefined;
  if (own) Object.assign(out, own);
  return out;
}

/** Rules with legend text, in rule order, each with its own style as the swatch (§4 Legend). */
export function legend(config: FlowConfig | null): LegendItem[] {
  if (!config) return [];
  return config.styles
    .filter((r) => r.legend !== null && r.legend.trim() !== '')
    .map((r) => ({ text: r.legend as string, style: { ...r.style } }));
}

/** Display order of real lanes: those listed in the config (first mention), then the rest in file order. */
export function laneOrder(config: FlowConfig | null, fileLaneIds: readonly string[]): string[] {
  const real = new Set(fileLaneIds);
  const out: string[] = [];
  for (const l of config?.lanes ?? []) {
    if (real.has(l.id) && l.id !== UNASSIGNED && !out.includes(l.id)) out.push(l.id);
  }
  for (const id of fileLaneIds) if (!out.includes(id)) out.push(id);
  return out;
}

/** The diagram title: the config `title`, or the `.mmd` file's base name (§4). Accepts a name or a path. */
export function diagramTitle(config: FlowConfig | null, mmdName: string): string {
  if (config?.title && config.title.trim() !== '') return config.title;
  const base = mmdName.split(/[\\/]/).pop() ?? mmdName;
  return base.replace(/\.mmd$/i, '');
}

/**
 * Suggested values for a metadata key (UI24): values style rules match on for that key, then values the key has on
 * nodes (list items count), without duplicates, in that order.
 */
export function fieldSuggestions(config: FlowConfig | null, key: string, exceptNodeId?: string): string[] {
  if (!config) return [];
  const out: string[] = [];
  const add = (s: string) => { if (!out.includes(s)) out.push(s); };
  for (const r of config.styles) for (const c of r.match) if (c.field === key && c.op === 'equals') add(c.value);
  if (key === BLOCK_STYLE_KEY) return out;
  for (const [id, meta] of Object.entries(config.nodes)) {
    if (id === exceptNodeId || !Object.hasOwn(meta, key)) continue;
    const v = meta[key];
    if (Array.isArray(v)) v.forEach((x) => { if (isScalarValue(x)) add(scalarString(x)); });
    else if (isScalarValue(v)) add(scalarString(v));
  }
  return out;
}
