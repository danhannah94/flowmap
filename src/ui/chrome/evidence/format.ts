// Pure helpers for the inspector and styles panel (UI24, UI25): how a metadata value reads in the inspector (§8.3:
// a scalar as its YAML string, a list joined with `, `, a map as compact JSON), and how an existing value is put back
// into the field form (the type that round-trips it exactly, so saving an untouched value changes nothing).
import { stringify } from 'yaml';
import { fieldValueToJs, scalarString, type FieldValue, type FlowConfig, type StyleRule } from '../../../core/config';

export type FieldType = 'text' | 'list' | 'map' | 'yaml';

type Scalar = string | number | boolean | null;

export const isScalar = (v: unknown): v is Scalar =>
  v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

export const isPlainMap = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The inspector text of a metadata value (§8.3 Inspector). */
export function fieldText(v: unknown): string {
  if (isScalar(v)) return scalarString(v);
  if (Array.isArray(v)) return v.map((x) => (isScalar(x) ? scalarString(x) : JSON.stringify(x))).join(', ');
  return JSON.stringify(v);
}

/** The field form for an existing value: the simplest type that writes it back unchanged. */
export function formFor(v: unknown): { type: FieldType; text: string } {
  if (typeof v === 'string') return { type: 'text', text: v };
  if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.trim() !== '' && !/[\r\n]/.test(x))) {
    return { type: 'list', text: (v as string[]).join('\n') };
  }
  if (isPlainMap(v)) {
    const entries = Object.entries(v);
    const simple = entries.length > 0 && entries.every(([k, x]) =>
      typeof x === 'string' && !/[\r\n]/.test(x) && k.trim() !== '' && !k.includes(':') && !/[\r\n]/.test(k));
    if (simple) return { type: 'map', text: entries.map(([k, x]) => (x === '' ? `${k}:` : `${k}: ${x as string}`)).join('\n') };
  }
  return { type: 'yaml', text: yamlText(v) };
}

/** A value as YAML text for the `yaml` field type (no trailing newline). */
export function yamlText(v: unknown): string {
  return stringify(v, { lineWidth: 0 }).replace(/\n$/, '');
}

/** The textarea text of a value in another type, used when the person switches type on an untouched value. */
export function convertForm(v: unknown, to: FieldType): string | null {
  if (to === 'yaml') return yamlText(v);
  if (to === 'text') return isScalar(v) ? scalarString(v) : null;
  const f = formFor(v);
  return f.type === to ? f.text : null;
}

/** The JS value a form value writes, or undefined if it can't be read (the operation reports why). */
export function formJs(v: FieldValue): unknown {
  try {
    return fieldValueToJs(v);
  } catch {
    return undefined;
  }
}

export function sameJs(a: unknown, b: unknown): boolean {
  return a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

/** Built-in fields every block has for `match` (§4). */
export const BUILTIN_FIELDS = ['id', 'lane', 'label', 'kind'] as const;

/** The evidence fields the inspector offers as quick adds (design.md §1), with the type each usually takes. */
export const COMMON_FIELDS: readonly { key: string; type: FieldType; hint: string }[] = [
  { key: 'source', type: 'list', hint: 'Who said it: one interview per line' },
  { key: 'confidence', type: 'text', hint: 'How sure we are' },
  { key: 'quote', type: 'text', hint: 'The verbatim quote' },
  { key: 'open_question', type: 'text', hint: 'What we still need to find out' },
  { key: 'system', type: 'text', hint: 'The system or tool used' },
  { key: 'kind', type: 'text', hint: 'Overrides the shape kind for styling (e.g. wait)' },
];

/** Keys some style rule matches on (UI24: suggestions are offered for these). */
export function ruleKeys(config: FlowConfig | null): Set<string> {
  const out = new Set<string>();
  for (const r of config?.styles ?? []) for (const c of r.match) out.add(c.field);
  return out;
}

/** Every metadata key in the config, in first-seen order (for the key input's suggestions). */
export function knownKeys(config: FlowConfig | null): string[] {
  const out: string[] = [];
  const add = (k: string) => { if (!out.includes(k)) out.push(k); };
  for (const f of COMMON_FIELDS) add(f.key);
  for (const meta of Object.values(config?.nodes ?? {})) for (const k of Object.keys(meta)) add(k);
  for (const k of ruleKeys(config)) if (!(BUILTIN_FIELDS as readonly string[]).includes(k) || k === 'kind') add(k);
  return out;
}

/** The type a key usually has on other nodes (a list if any node has it as a list). */
export function usualType(config: FlowConfig | null, key: string): FieldType | null {
  let seen: FieldType | null = null;
  for (const meta of Object.values(config?.nodes ?? {})) {
    if (!Object.hasOwn(meta, key)) continue;
    const v = meta[key];
    if (Array.isArray(v)) return 'list';
    seen ??= typeof v === 'string' ? 'text' : formFor(v).type;
  }
  return seen;
}

/** A short human description of a rule's conditions ("confidence is single-source and system is present"). */
export function describeMatch(rule: StyleRule): string {
  if (rule.match.length === 0) return 'every block';
  return rule.match
    .map((c) => (c.op === 'equals' ? `${c.field} is ${c.value}` : c.op === 'present' ? `${c.field} is set` : `${c.field} is not set`))
    .join(' and ');
}

/** The id quoted in an orphan warning's message (`… "<id>" …`, UI27). */
export function orphanId(message: string): string | null {
  return /"([^"]+)"/.exec(message)?.[1] ?? null;
}
