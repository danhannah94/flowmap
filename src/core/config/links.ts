// A15: a block's link to another diagram (§4 "link", a reserved metadata key: model.ts's LINK_KEY). Pure helpers
// shared by the CLI (`flowmap validate`, `flowmap export`), the operations layer and the UI: parsing and validating
// a target's *shape* lives here (no fs); whether it *exists* is decided by the caller, which knows the served root
// (the CLI walks the directory; the UI uses the diagrams the server lists, reusing the home page's API).
import type { Problem } from '../types';
import { isScalarValue } from './emit';
import { LINK_KEY, type FlowConfig, type NodeMeta } from './model';
import { scalarString } from './parse';

/** One path segment: letters, digits, `_`, `-`, `.` (a bare `.` or `..` is handled separately, below). */
const SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * True for a well-formed link target (§4 A15): one or more `/`-separated segments, none empty, no backslash, no
 * leading or trailing slash, no drive letter (`C:\…`) and no absolute path (`/…`). A `..` segment is allowed here
 * (it's well-formed but out of bounds; `linkHasTraversal` flags that separately, since design.md calls it a warning,
 * not malformed input). Doesn't say whether the target file exists.
 */
export function isWellFormedLinkTarget(target: string): boolean {
  if (typeof target !== 'string' || target === '' || target.trim() !== target) return false;
  if (target.startsWith('/') || target.endsWith('/') || target.includes('\\') || target.includes('//')) return false;
  if (/^[A-Za-z]:/.test(target)) return false;
  return target.split('/').every((seg) => seg === '..' || SEGMENT_RE.test(seg));
}

/** True when a link target has a `..` segment: it points outside the served root (§4 A15). */
export function linkHasTraversal(target: string): boolean {
  return target.split('/').some((seg) => seg === '..');
}

/** A well-formed target's `.mmd` path, relative to the served root; null when the target isn't well-formed. */
export function linkTargetToMmdPath(target: string): string | null {
  return isWellFormedLinkTarget(target) ? `${target}.mmd` : null;
}

/**
 * A node's link target as written (§4's `link`), or null when it has none or the value isn't a scalar (a list or
 * map under `link` is kept as-is by the node YAML editor, but is never followed or checked: it isn't "the link").
 */
export function linkOf(meta: NodeMeta | undefined | null): string | null {
  if (!meta || !Object.hasOwn(meta, LINK_KEY)) return null;
  const v = meta[LINK_KEY];
  return v !== null && isScalarValue(v) ? scalarString(v) : null;
}

/**
 * Accepts what the Inspector's picker, or a pasted path, gives (§4 "Setting a link"): trims it, turns backslashes
 * into forward slashes and drops a trailing `.mmd` (case-insensitive) and a trailing slash, so pasting a file name
 * or a Windows-style path still works. Null when the result isn't well-formed; the caller shows that as a refusal.
 */
export function normalizeLinkTarget(raw: string): string | null {
  const t = raw.trim().replace(/\\/g, '/').replace(/\.mmd$/i, '').replace(/\/+$/, '');
  return isWellFormedLinkTarget(t) ? t : null;
}

/**
 * §4 A15 validation: a link whose target doesn't exist is `W-link-missing`; a link with a `..` segment is
 * `W-link-traversal` (error-free; the UI refuses to follow it, and `flowmap validate` still reports the diagram as
 * clean of errors). A malformed target (anything `isWellFormedLinkTarget` rejects) is also `W-link-missing`. A link
 * to the block's own diagram is allowed (no warning) when it's listed in `exists`. `exists` is given the target
 * exactly as written (a well-formed, non-traversing one): it knows the served root, this module doesn't.
 */
export function checkLinks(
  config: FlowConfig | null,
  nodeIds: Iterable<string>,
  exists: (target: string) => boolean,
): Problem[] {
  if (!config) return [];
  const out: Problem[] = [];
  for (const id of nodeIds) {
    const target = linkOf(config.nodes[id]);
    if (target === null) continue;
    if (!isWellFormedLinkTarget(target)) {
      out.push({ code: 'W-link-missing', line: null, message: `Block "${id}" links to "${target}", which isn't a valid diagram path` });
      continue;
    }
    if (linkHasTraversal(target)) {
      out.push({ code: 'W-link-traversal', line: null, message: `Block "${id}" links to "${target}", which is outside the served root` });
      continue;
    }
    if (!exists(target)) {
      out.push({ code: 'W-link-missing', line: null, message: `Block "${id}" links to "${target}", which doesn't exist` });
    }
  }
  return out;
}

/**
 * A17 (§12): the new value for a link target after the diagram it names moves from `oldId` to `newId` (both
 * root-relative paths, no `.mmd`, §4), or null when `target` isn't affected. An exact match only: a link is
 * root-relative, so a diagram's own *outbound* links (naming some other, unmoved diagram) never change when it
 * moves — this only matches an *incoming* link, another diagram's `link:` value that named the moved one — with
 * one exception that falls out of the same rule rather than needing its own: a self-link (a diagram linking to
 * itself, §4, allowed) equals `oldId` too, so it's swept up and corrected like any other match.
 */
export function movedLinkTarget(target: string, oldId: string, newId: string): string | null {
  return target === oldId ? newId : null;
}

/**
 * A17 (§12): the new value for a link target after folder `oldFolder` is renamed to `newFolder` (both root-relative
 * folder paths, §8.2 A16), or null when `target` doesn't point inside it. Prefix-safe: only a target starting with
 * `oldFolder` followed by `/` matches, so renaming `a` to `a2` doesn't touch a link into a same-prefixed sibling
 * like `a-other/x` or `ab/x`; a nested link (`oldFolder/sub/diagram`) keeps its `/sub/diagram` tail after the rename.
 */
export function renamedFolderLinkTarget(target: string, oldFolder: string, newFolder: string): string | null {
  const prefix = `${oldFolder}/`;
  return target.startsWith(prefix) ? `${newFolder}/${target.slice(prefix.length)}` : null;
}

/**
 * Well-formed, non-traversing link targets by node id, for the SVG export (§7.1 A15): wraps a linked block in
 * `<a href="<target>.svg">`. A malformed or traversing target is left out (nothing to link to safely); a missing
 * target is still included (the exported set may gain that page later, or another export writes it alongside).
 */
export function linkTargetsByNode(config: FlowConfig | null, nodeIds: Iterable<string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!config) return out;
  for (const id of nodeIds) {
    const target = linkOf(config.nodes[id]);
    if (target !== null && isWellFormedLinkTarget(target) && !linkHasTraversal(target)) out[id] = target;
  }
  return out;
}
