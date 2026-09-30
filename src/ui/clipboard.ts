// Copy, cut, paste and duplicate (amendment A12). The logic lives in the core (`copyFragment`, `pasteFragment`,
// `duplicateNodes`, src/core/ops/fragment.ts); this file is the UI side:
//
// - The in-app clipboard holds the last copied fragment. It lives in `localStorage` (so a copy in one diagram pastes
//   into another, in any tab of this browser) and in memory (when storage is unavailable), read back through
//   `isFragment` since anything could have written it.
// - A copy also writes the fragment as flowmap Mermaid to the system clipboard (guarded: the permission may be
//   missing), so pasting into a text editor or a chat gives valid `.mmd` text. Paste reads only the in-app clipboard.
// - A paste lands at the pointer when it is over the canvas (the group's top-left there, each block in the lane under
//   its centre, as a drop), else one step (PASTE_STEP) along and across from where the originals were, in their own
//   lanes. Pasting the same copy again without moving the pointer steps again, so repeats don't pile up.
// - Each paste, cut and duplicate is one undo step, and what it adds becomes the selection.
import {
  copyFragment, deleteItems, duplicateNodes, fragmentToMermaid, isFragment, PASTE_STEP, pasteFragment,
  type Files, type Fragment, type OpResult,
} from '../core/ops';
import { settlePlaced } from './actions';
import type { Point } from './canvas/viewport';
import type { Store } from './store/store';

export const CLIPBOARD_KEY = 'flowmap.clipboard';

interface Clip {
  fragment: Fragment;
  /** Unique per copy: tells a repeat paste of the same copy from a new one. */
  stamp: string;
}

let memory: Clip | null = null;

function isClip(v: unknown): v is Clip {
  return typeof v === 'object' && v !== null && typeof (v as Clip).stamp === 'string' && isFragment((v as Clip).fragment);
}

/** The in-app clipboard (storage first: another tab may have copied since), or null when it's empty. */
export function readClip(): Clip | null {
  try {
    const raw = localStorage.getItem(CLIPBOARD_KEY);
    if (raw !== null) {
      const v: unknown = JSON.parse(raw);
      if (isClip(v)) return v;
    }
  } catch {
    /* storage unavailable or damaged: fall back to memory */
  }
  return memory;
}

function writeClip(fragment: Fragment): void {
  const clip: Clip = { fragment, stamp: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}` };
  memory = clip;
  try {
    localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(clip));
  } catch {
    /* storage unavailable or full: the memory copy still pastes in this tab */
  }
  try {
    const text = fragmentToMermaid(fragment);
    void navigator.clipboard?.writeText(text).catch(() => {});
  } catch {
    /* no system clipboard here */
  }
}

/** The last paste, so a repeat of the same copy at the same spot steps on instead of landing on top of it. */
let lastPaste: { stamp: string; file: string; at: Point | null; k: number } | null = null;

const samePoint = (a: Point | null, b: Point | null) => (a === null || b === null ? a === b : a.x === b.x && a.y === b.y);

/** Is there a text selection on the page (outside an editor) that Cmd/Ctrl+C should copy instead? */
export function pageTextSelected(): boolean {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  return !!sel && !sel.isCollapsed && sel.toString().trim() !== '';
}

/** Cmd/Ctrl+C: copy the selected blocks and the lines between them. Returns whether something was copied. */
export function copySelection(store: Store): boolean {
  const s = store.getState();
  const layout = s.derived?.doc.layout;
  const ids = s.selection.nodes;
  if (!s.files || !layout || ids.length === 0) return false;
  const r = copyFragment(s.files, ids, layout);
  if (!r.ok) {
    store.toast(r.error);
    return false;
  }
  writeClip(r.fragment);
  lastPaste = null;
  return true;
}

/** Cmd/Ctrl+X: copy, then delete the selection as Delete does (UI14), as one undo step. */
export function cutSelection(store: Store): void {
  if (!copySelection(store)) return;
  const { nodes, edges } = store.getState().selection;
  const r = store.apply(deleteItems, { nodes, edges });
  if (r.ok) store.clearSelection();
}

/** Cmd/Ctrl+V: paste the in-app clipboard (see the file comment for where it lands). */
export function pasteClipboard(store: Store): void {
  const clip = readClip();
  const s = store.getState();
  const output = s.derived?.doc.layout;
  if (!clip || !output) return;
  const pointer = store.pointerWorld();
  const at = pointer ? { x: Math.round(pointer.x), y: Math.round(pointer.y) } : null;
  const again = lastPaste && lastPaste.stamp === clip.stamp && lastPaste.file === s.file && samePoint(lastPaste.at, at);
  const k = again ? lastPaste!.k + 1 : at ? 0 : 1;
  let ids: string[] = [];
  const r = store.apply(function paste(files: Files): OpResult {
    if (at) {
      const step = PASTE_STEP * k;
      const pasted = pasteFragment(files, clip.fragment, output, { at: { x: at.x + step, y: at.y + step } });
      if (!pasted.ok) return pasted;
      ids = pasted.ids;
      // A drop at the pointer: make it exact on screen whatever the paste does to the lanes and the frame.
      const placed = pasted.blocks.map((b) => ({ id: b.id, from: b.lane, lane: b.lane, box: b.box! }));
      return settlePlaced(store, files, pasted.files, placed);
    }
    const pasted = pasteFragment(files, clip.fragment, output, { step: PASTE_STEP * k });
    if (pasted.ok) ids = pasted.ids;
    return pasted;
  });
  if (!r.ok) return;
  lastPaste = { stamp: clip.stamp, file: s.file, at, k };
  selectAndReveal(store, ids);
}

/** Cmd/Ctrl+D (UI13 as amended by A12): duplicate the given blocks in place, one step along and across. */
export function duplicateBlocks(store: Store, ids: readonly string[]): void {
  const layout = store.getState().derived?.doc.layout;
  if (!layout || ids.length === 0) return;
  const r = store.apply(duplicateNodes, ids, layout);
  if (r.ok) selectAndReveal(store, r.ids);
}

function selectAndReveal(store: Store, ids: readonly string[]): void {
  if (ids.length === 0) return;
  store.select({ nodes: ids });
  const boxes = (store.layout?.nodes ?? []).filter((n) => ids.includes(n.id));
  if (boxes.length === 0) return;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  store.reveal({ x, y, width: right - x, height: bottom - y }, { onlyIfOffscreen: true });
}
