// Lexical rules shared by the parser, the formatter and (later) the edit operations: ids, reserved words, label
// escapes and the unquoted-label test. Section numbers refer to docs/design.md.

/**
 * §3.1 node id: `[A-Za-z_][A-Za-z0-9_-]*`, not ending in `-` and not containing `--`. Written as "a word, then any
 * number of `-word`", which enforces both extra rules and lets a scanner stop in front of an arrow (`a-->b`).
 */
export const ID_SOURCE = '[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*';
const ID_EXACT = new RegExp(`^${ID_SOURCE}$`);

/** §3.1 statement keywords. They match as whole tokens only (`class_a` is an id). */
export const KEYWORDS = ['subgraph', 'end', 'direction', 'classDef', 'class', 'style', 'linkStyle', 'click'] as const;
export const PASS_THROUGH_KEYWORDS: ReadonlySet<string> = new Set(['classDef', 'class', 'style', 'linkStyle', 'click']);

/** §3.1 reserved ids (plus anything starting with `end-` or `end_`). */
const RESERVED_IDS: ReadonlySet<string> = new Set([
  'end', 'subgraph', 'graph', 'flowchart', 'direction', 'class', 'classDef', 'style', 'linkStyle', 'click', 'default',
  '_unassigned',
]);

/** True if `id` is reserved (§3.1): in the list, or starting with `end-` or `end_`. */
export function isReservedId(id: string): boolean {
  return RESERVED_IDS.has(id) || id.startsWith('end-') || id.startsWith('end_');
}

/** True if `id` has the §3.1 id form (reserved or not). */
export function isIdForm(id: string): boolean {
  return ID_EXACT.test(id);
}

/** True if `id` may be used as a node or subgraph id: the right form and not reserved. */
export function isValidId(id: string): boolean {
  return isIdForm(id) && !isReservedId(id);
}

// ---- Labels ---------------------------------------------------------------------------------------------------------

/** §3.1: exactly these three escapes are decoded; any other `#…;` is kept literally. */
const ESCAPE = /#(quot|35|92);/g;
const DECODED: Record<string, string> = { quot: '"', '35': '#', '92': '\\' };

export function decodeLabel(raw: string): string {
  return raw.replace(ESCAPE, (_, name: string) => DECODED[name]!);
}

/**
 * Encode a decoded label for writing inside double quotes (§3.3): `"` becomes `#quot;`, a `#` that would otherwise
 * read as one of the three escapes becomes `#35;`, and (inside `@{…}` only) a backslash becomes `#92;`.
 */
export function encodeLabel(label: string, opts: { backslash?: boolean } = {}): string {
  let out = '';
  for (let i = 0; i < label.length; i++) {
    const ch = label[i]!;
    if (ch === '"') out += '#quot;';
    else if (ch === '#' && /^#(?:quot|35|92);/.test(label.slice(i))) out += '#35;';
    else if (ch === '\\' && opts.backslash) out += '#92;';
    else out += ch;
  }
  return out;
}

/**
 * §3.3 unquoted test (lane and edge labels): not empty, only ASCII letters, digits, spaces and `_ . , ' ? ! -`, no
 * leading or trailing space and no two spaces in a row.
 */
const UNQUOTED_SAFE = /^[A-Za-z0-9_.,'?!-]+(?: [A-Za-z0-9_.,'?!-]+)*$/;

export function canWriteUnquoted(label: string): boolean {
  return UNQUOTED_SAFE.test(label);
}

/** §3.1: unquoted labels are trimmed and runs of whitespace collapse to one space. */
export function normaliseUnquoted(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Characters an unquoted label can't contain (§3.1): brackets, braces, parentheses, `|` and `"`. */
export const UNQUOTED_FORBIDDEN = new Set(['[', ']', '{', '}', '(', ')', '|', '"']);
