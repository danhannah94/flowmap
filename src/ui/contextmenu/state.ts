// Which context menu is open (UI40), what it is on, and the facts its "shows when" rules read from the files.
import { COLOR_PROPS } from '../../core/config';
import { UNASSIGNED, type LayoutEdgeEntry } from '../../core/types';
import type { Point } from '../canvas/viewport';
import { signal } from '../features/signal';
import type { State } from '../store/store';
import type { MenuTarget } from './registry';

export interface OpenMenu {
  /** Bumped on every open, so a menu opened again elsewhere starts fresh. */
  seq: number;
  target: MenuTarget;
  /** Where it was opened: diagram coordinates, and window (client) px for placing the menu. */
  world: Point;
  client: Point;
}

export const openMenu = signal<OpenMenu | null>(null);

let seq = 0;

export function showContextMenu(target: MenuTarget, world: Point, client: Point): void {
  openMenu.set({ seq: ++seq, target, world, client });
}

export function closeContextMenu(): void {
  openMenu.set(null);
}

/**
 * What a right-click at `el` is on, by the §8.3 attributes: a note, the title, a line (and which bend point), a
 * block, a lane header, or else the canvas. Null when it is on none of the canvas's content we handle (an editor).
 * For a block, `ids` is the clicked block alone, or the whole block selection when the block is one of several
 * selected (UI40).
 */
export function menuTargetAt(el: Element, s: State): MenuTarget | null {
  if (el.closest('input, textarea, select, [contenteditable="true"]')) return null;
  const note = el.closest<HTMLElement | SVGElement>('[data-note-id]');
  if (note) return { kind: 'note', id: note.dataset.noteId! };
  if (el.closest('[data-testid="title"]')) return { kind: 'title' };
  const edge = el.closest<HTMLElement | SVGElement>('[data-edge-id]');
  if (edge) {
    const bend = el.closest<HTMLElement | SVGElement>('[data-bend]');
    const i = bend ? Number(bend.dataset.bend) : NaN;
    return { kind: 'line', id: edge.dataset.edgeId!, bend: Number.isInteger(i) ? i : null };
  }
  const node = el.closest<HTMLElement>('[data-node-id]');
  if (node) {
    const id = node.dataset.nodeId!;
    const sel = s.selection.nodes;
    return { kind: 'block', ids: sel.length > 1 && sel.includes(id) ? [...sel] : [id], clicked: id };
  }
  const header = el.closest<HTMLElement>('[data-lane-header]');
  const lane = header?.dataset.laneHeader;
  // Unassigned can't be renamed, moved or deleted: its header is just canvas.
  if (lane && lane !== UNASSIGNED) return { kind: 'lane', id: lane };
  return { kind: 'canvas' };
}

/** Does the target still exist (the menu closes when an edit or the AI removes it)? */
export function targetExists(t: MenuTarget, s: State): boolean {
  const layout = s.shown?.layout;
  if (!layout) return false;
  switch (t.kind) {
    case 'block':
      return t.ids.every((id) => layout.nodes.some((n) => n.id === id));
    case 'line':
      return layout.edges.some((e) => e.id === t.id);
    case 'note':
      return (layout.notes ?? []).some((n) => n.id === t.id) || !!s.derived?.doc.notes.some((n) => n.id === t.id);
    case 'lane':
      return layout.lanes.some((l) => l.id === t.id);
    default:
      return true;
  }
}

// ---- Facts for the "shows when" rules (UI40's table), read from the files as parsed.

export function isPinned(s: State, id: string): boolean {
  return !!s.shown?.layout?.nodes.find((n) => n.id === id)?.pinned;
}

export function hasStoredSize(s: State, id: string): boolean {
  return !!s.derived?.doc.sizes[id];
}

/** The block has a `style` with colours in the config (§4, UI35). */
export function hasBlockColours(s: State, id: string): boolean {
  const style = s.derived?.doc.config?.nodes[id]?.style;
  if (!style || typeof style !== 'object' || Array.isArray(style)) return false;
  return COLOR_PROPS.some((p) => Object.hasOwn(style, p));
}

/** The line's entry in the layout file (§5), if any. */
export function edgeEntry(s: State, id: string): LayoutEdgeEntry | undefined {
  return s.derived?.doc.layoutFile?.edges?.[id];
}

export function edgeLabel(s: State, id: string): string | null {
  return s.shown?.layout?.edges.find((e) => e.id === id)?.label ?? null;
}

export function titleHasPosition(s: State): boolean {
  return !!s.derived?.doc.titlePosition || !!s.derived?.doc.layoutFile?.title;
}

export function titleHidden(s: State): boolean {
  return s.derived?.doc.showTitle === false;
}
