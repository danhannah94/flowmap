// A15: the viewport of a diagram left through a followed link, so Back can restore it cheaply (design.md §4
// "Following a link"). Keyed by the `?file=` name, in `sessionStorage` (per tab, cleared when the tab closes, so it
// never grows unbounded and never leaks across browser sessions). Degrades quietly if storage is unavailable.
//
// An entry is only ever applied when the diagram is reached through the history (Back or Forward); any other open
// (from the home list, a typed URL, a reload) fits as usual and discards it. When Back restores the page from the
// browser's back/forward cache, the page comes back with its own view and never reopens the diagram, so the entry is
// discarded on that `pageshow` too: otherwise the next ordinary open would reuse a stale pan and zoom.
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

/** True when this page load came from Back or Forward (the Navigation Timing API's `back_forward`), the only kind of
 *  navigation that restores a remembered viewport. */
export function cameThroughHistory(): boolean {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return nav?.type === 'back_forward';
  } catch {
    return false;
  }
}

/** The viewport to open `file` with: its remembered one when reached through the history, else null (fit). Either way
 *  the entry is consumed, so it can't resurface on a later, ordinary open. */
export function viewportForOpen(file: string, throughHistory = cameThroughHistory()): Viewport | null {
  const v = takeViewport(file);
  return throughHistory ? v : null;
}

/** While `file` is open: a restore from the back/forward cache (`pageshow` with `persisted`) discards its entry, since
 *  the restored page already has its view. Returns the uninstaller. */
export function discardOnBfcacheRestore(file: string): () => void {
  const onShow = (e: PageTransitionEvent) => {
    if (e.persisted) takeViewport(file);
  };
  window.addEventListener('pageshow', onShow);
  return () => window.removeEventListener('pageshow', onShow);
}
