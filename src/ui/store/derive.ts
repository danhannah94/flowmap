// Everything the UI shows is derived from the three file texts by the same core the CLI uses (design.md §6, U9):
// `loadDocument` parses, checks and lays out with exactly the hints on disk, so a node's position here equals
// `flowmap layout` output to the pixel. This module adds the UI's read-only rules (UI31) and a small cache, so undo,
// redo and echoes of our own saves don't lay out twice.
import { loadDocument, type FlowDocument } from '../../core/document';
import type { Files } from '../../core/ops';
import { parseLayoutFile, serializeLayoutFile, setHints } from '../../core/layoutfile';
import { pinTranslation, type Translation } from '../../core/layout';
import type { LayoutResult } from '../../core/types';
import type { Point } from '../canvas/viewport';

/** Problem codes that come from the `.mmd` itself (§3): any error among them makes the diagram read-only. */
export const MMD_CODES = new Set([
  'E-header', 'E-nested', 'E-unclosed', 'E-shape', 'E-edge', 'E-duplicate', 'E-syntax', 'W-no-lane', 'W-direction',
]);

export interface Derived {
  doc: FlowDocument;
  /** The layout to draw: the document's, or null when the `.mmd` has errors and nothing could be laid out. */
  layout: LayoutResult | null;
  /** UI31: `.mmd` errors make the whole diagram read-only. */
  readOnly: boolean;
  /** UI31: `E-config` means default styles and no config editing. */
  configBroken: boolean;
  /** UI31: `E-layout` means no pins, and dragging and pinning are off. */
  layoutBroken: boolean;
}

const cache = new Map<string, Derived>();
const CACHE_MAX = 64;

function key(files: Files, name: string): string {
  return `${name}\u0000${files.mmd}\u0001${files.config ?? '\u0002'}\u0001${files.layout ?? '\u0002'}`;
}

export function derive(files: Files, name: string): Derived {
  const k = key(files, name);
  const hit = cache.get(k);
  if (hit) {
    cache.delete(k);
    cache.set(k, hit); // most recently used last
    return hit;
  }
  const doc = loadDocument(files.mmd, files.config, files.layout, name);
  const errors = doc.problems.errors;
  const out: Derived = {
    doc,
    layout: doc.layout?.result ?? null,
    readOnly: errors.some((e) => MMD_CODES.has(e.code)),
    configBroken: errors.some((e) => e.code === 'E-config'),
    layoutBroken: errors.some((e) => e.code === 'E-layout'),
  };
  cache.set(k, out);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return out;
}

/**
 * Layout stability (§6, H5): when an edit already rewrites the layout file (a pin, an unpin…), carry the current
 * layout's hints into that same write, so the next layout keeps unrelated boxes where they were. Hints are never
 * written on their own: what's on disk is always exactly what we lay out with, so the UI and the CLI agree (U9).
 */
export function withHints(before: Files, after: Files, current: Derived | null): Files {
  if (!current?.doc.layout || after.layout === null || after.layout === before.layout) return after;
  const parsed = parseLayoutFile(after.layout);
  if (!parsed.file) return after;
  const text = serializeLayoutFile(setHints(parsed.file, current.doc.layout.hints));
  return text === after.layout ? after : { ...after, layout: text };
}

export function sameFiles(a: Files, b: Files): boolean {
  return a.mmd === b.mmd && a.config === b.config && a.layout === b.layout;
}

/** The layout's frame (`pinTranslation`, §6): its translation of negative pins, from the pins that apply. */
export function translationOf(d: Derived | null): Translation {
  return pinTranslation(Object.values(d?.doc.pins ?? {}), d?.layout?.lanes[0]?.id);
}

/**
 * How far, in world px, the whole diagram moved between two layouts because its frame changed (§6: a block dropped
 * before or above everything, its undo, an unpin): the store pans the view by the opposite (UI43), so what the person
 * didn't move stays put on screen and a dropped block ends where it was released. T moves everything along the flow;
 * U (the first lane growing toward its start) moves everything across it, since every lane is at or after the first.
 */
export function originMove(prev: Derived | null, next: Derived): Point {
  if (!prev?.layout || !next.layout) return { x: 0, y: 0 };
  const a = translationOf(prev);
  const b = translationOf(next);
  const along = b.along - a.along;
  const sameFirst = prev.layout.lanes[0]?.id === next.layout.lanes[0]?.id;
  const across = sameFirst ? b.across - a.across : 0;
  return next.layout.direction === 'TB' ? { x: across, y: along } : { x: along, y: across };
}
