// Dismissing warnings in the error banner (UI31; errors are never dismissible, only `W-…` codes). A dismissal is
// keyed by the warning's code and message, not its line: a line shifts as the person edits the .mmd, and a dismissal
// tied to a line would either resurface on every edit or silently hide whatever warning happened to land on that
// line next. Dismissals are remembered per diagram (by file name) in localStorage, so they survive a reload; every
// storage access is wrapped in try/catch so the feature degrades to "nothing persists" rather than throwing when
// storage is unavailable (private browsing, quota, disabled).
import type { Problem } from '../../core/types';

const PREFIX = 'flowmap.dismissed-warnings.';

/** The key a warning is remembered by: stable across edits that only move its line. */
export function warningKey(problem: Pick<Problem, 'code' | 'message'>): string {
  return `${problem.code}\u0000${problem.message}`;
}

function storageKey(file: string): string {
  return `${PREFIX}${file}`;
}

/** Every dismissed key remembered for `file`. Empty (never throws) if storage is unavailable or holds garbage. */
export function loadDismissed(file: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(file));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

/** Persist the dismissed set for `file` (removes the entry once it's empty). Never throws. */
export function saveDismissed(file: string, keys: ReadonlySet<string>): void {
  try {
    if (keys.size === 0) localStorage.removeItem(storageKey(file));
    else localStorage.setItem(storageKey(file), JSON.stringify([...keys]));
  } catch {
    // Storage unavailable: dismissals just won't survive a reload.
  }
}

/**
 * Drop any remembered dismissal whose warning is no longer in the current problems list. This is what makes fixing
 * the cause "forget" the dismissal: once the warning's key is gone, nothing remembers it was dismissed, so if the
 * same code+message reappears later (the cause comes back) it shows again rather than staying silently hidden.
 */
export function pruneDismissed(dismissed: ReadonlySet<string>, activeKeys: ReadonlySet<string>): Set<string> {
  const kept = new Set<string>();
  for (const k of dismissed) if (activeKeys.has(k)) kept.add(k);
  return kept;
}
