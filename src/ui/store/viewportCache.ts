// A15: the viewport of a diagram left through a followed link, so Back can restore it cheaply (design.md §4
// "Following a link"). Keyed by the `?file=` name, in `sessionStorage` (per tab, cleared when the tab closes, so it
// never grows unbounded and never leaks across browser sessions). Degrades quietly if storage is unavailable.
import type { Viewport } from '../canvas/viewport';

const KEY = 'flowmap.viewport';

function readAll(): Record<string, Viewport> {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, Viewport>) : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, Viewport>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private mode, or storage unavailable: the viewport just won't be restored */
  }
}

/** Remember `file`'s current viewport, before navigating away from it (a followed link). */
export function saveViewport(file: string, viewport: Viewport): void {
  const all = readAll();
  all[file] = viewport;
  writeAll(all);
}

/** Read and forget `file`'s remembered viewport (one restore per save, so opening the same diagram again later
 *  fits normally instead of reusing a stale view). Null when there is none. */
export function takeViewport(file: string): Viewport | null {
  const all = readAll();
  const v = all[file];
  if (!v) return null;
  delete all[file];
  writeAll(all);
  return v;
}
