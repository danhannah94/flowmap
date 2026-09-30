// A15: following a block's link to another diagram (design.md §4 "Following a link"). Shared by the canvas gesture
// (Cmd/Ctrl+click, and a plain click on the link badge) and the Inspector's "Open" control.
import { checkLinks, linkHasTraversal, linkTargetToMmdPath, type FlowConfig } from '../core/config';
import type { Problem } from '../core/types';
import type { Store } from './store/store';
import { saveViewport } from './store/viewportCache';

/**
 * Opens `target` (a well-formed link target, §4), using the app's own navigation (`?file=`) so Back returns here.
 * Refuses a target with a `..` segment (it would point outside the served root) or one that isn't well-formed at
 * all, with a toast; a target that is well-formed but doesn't exist is still opened (the same "couldn't open" screen
 * a missing or deleted diagram already shows, App.tsx).
 */
export function followLink(store: Store, target: string): void {
  if (linkHasTraversal(target)) {
    store.toast('This link points outside the folder flowmap is serving, so it can’t be opened.');
    return;
  }
  const path = linkTargetToMmdPath(target);
  if (!path) {
    store.toast('This block’s link isn’t a valid diagram path.');
    return;
  }
  const s = store.getState();
  saveViewport(s.file, s.viewport);
  location.href = `/?file=${encodeURIComponent(path)}`;
}

/**
 * The `.mmd` path a link targets, for a plain `<a href>` fallback (e.g. the Inspector's "Open" control): null when
 * the target isn't well-formed (nothing sensible to link to).
 */
export function linkHref(target: string): string | null {
  const path = linkTargetToMmdPath(target);
  return path ? `/?file=${encodeURIComponent(path)}` : null;
}

/**
 * §4 A15 "in flowmap validate (CLI) and the UI problems list": every block's link checked against the diagrams the
 * server lists (the home page's `GET /api/diagrams`, §8.2), reusing whatever the store has already fetched. Null
 * `knownDiagrams` (not fetched yet) means no link warnings yet, rather than a false "missing" for every link.
 */
export function linkProblems(
  config: FlowConfig | null,
  nodeIds: readonly string[],
  knownDiagrams: readonly string[] | null,
): Problem[] {
  if (!config || !knownDiagrams) return [];
  const targets = new Set(knownDiagrams.map((f) => f.replace(/\.mmd$/i, '')));
  return checkLinks(config, nodeIds, (t) => targets.has(t));
}
