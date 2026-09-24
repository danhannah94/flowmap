// Notes and the title (design.md §8.2 UI41, UI42): what a person can do to them, each as one core operation through
// `store.apply` (one undo step). Positions are diagram coordinates as drawn (the canvas's world); the ops subtract the
// layout's frame (§6), which they read from the layout they are given (`LayoutOutput.translation`), so a note lands
// exactly where it was put even while a negative pin or bend point shifts the output.
import type { LayoutOutput } from '../../core/layout';
import {
  addNote, deleteNote, hideTitle, moveNote, moveTitle, resetTitlePosition, setNoteStyle, setNoteText, showTitle,
  type NoteStyle,
} from '../../core/ops';
import type { XY } from '../../core/types';
import { toWorld } from '../canvas/viewport';
import { editTitle } from '../features/diagramActions';
import { signal } from '../features/signal';
import type { Annotation, Store } from '../store/store';

// ---- Transient state -------------------------------------------------------------------------------------------

/**
 * The open note editor (`note-editor`): a new note not written yet (`at`: where its top-left will be), or an existing
 * one. `seq` makes each opening a fresh editor.
 */
export type NoteDraft = { kind: 'new'; at: XY; seq: number } | { kind: 'edit'; id: string; seq: number };

export const noteEditor = signal<NoteDraft | null>(null);

/** A note or the title being dragged: its offset from where it is drawn (world px, snapped). */
export interface AnnotationDrag {
  target: Annotation;
  dx: number;
  dy: number;
}

export const annotationDrag = signal<AnnotationDrag | null>(null);

let seq = 0;

export const sameAnnotation = (a: Annotation | null | undefined, b: Annotation | null | undefined): boolean =>
  !!a && !!b && a.kind === b.kind && (a.kind === 'title' || a.id === (b as { id: string }).id);

// ---- Why something is off right now (UI31) ---------------------------------------------------------------------

const CONFIG_BROKEN = 'The config file has errors, so notes and the title’s visibility can’t be changed until it is fixed';
const LAYOUT_BROKEN = 'The layout file has errors, so notes and the title can’t be placed until it is fixed';

/** A change that writes the config (a note's text or style, `show_title`): off with `.mmd` errors or `E-config`. */
export function configBlocked(store: Store): string | null {
  const ro = store.readOnlyReason();
  if (ro) return ro;
  return store.getState().derived?.configBroken ? CONFIG_BROKEN : null;
}

/** A change that writes the layout file (a move, the title's reset): off with `.mmd` errors or `E-layout`. */
export function layoutBlocked(store: Store): string | null {
  const ro = store.readOnlyReason();
  if (ro) return ro;
  return store.getState().derived?.layoutBroken ? LAYOUT_BROKEN : null;
}

/** Adding a note writes both files. */
export function addBlocked(store: Store): string | null {
  return configBlocked(store) ?? layoutBlocked(store);
}

/** The current layout with its frame, for the ops (null while the `.mmd` can't be laid out). */
function layoutNow(store: Store): LayoutOutput | null {
  return store.getState().derived?.doc.layout ?? null;
}

// ---- Selection (UI10: a note or the title is selected on its own) ----------------------------------------------

export function selectAnnotation(store: Store, target: Annotation): void {
  if (!sameAnnotation(store.getState().selection.annotation, target)) store.select({ annotation: target });
}

export function selectedAnnotation(store: Store): Annotation | null {
  return store.getState().selection.annotation ?? null;
}

// ---- Notes (UI41) ----------------------------------------------------------------------------------------------

/**
 * Open the editor for a new note with its top-left at a world point. Nothing is written until the first commit with
 * some text (`commitNote`), which writes the note, its text and its position as one step.
 */
export function beginNewNote(store: Store, at: XY): void {
  const blocked = addBlocked(store);
  if (blocked) {
    store.toast(blocked, 'info');
    return;
  }
  store.endEdit();
  store.clearSelection();
  noteEditor.set({ kind: 'new', at: { x: at.x, y: at.y }, seq: ++seq });
}

/** The toolbar's `add-note`: a new note at the centre of the view. */
export function addNoteAtViewCentre(store: Store): void {
  const { viewport, viewportSize } = store.getState();
  beginNewNote(store, toWorld(viewport, { x: viewportSize.width / 2, y: viewportSize.height / 2 }));
}

/** Double-click, Enter or `edit-note`: edit a note's text in place. */
export function editNote(store: Store, id: string): void {
  const blocked = configBlocked(store);
  if (blocked) {
    store.toast(blocked, 'info');
    return;
  }
  if (!store.layout?.notes?.some((n) => n.id === id)) return;
  store.endEdit();
  selectAnnotation(store, { kind: 'note', id });
  noteEditor.set({ kind: 'edit', id, seq: ++seq });
}

/**
 * Commit the editor's text. A new note with blank text adds nothing; otherwise it is written, as typed (the op drops
 * trailing line breaks), and selected. An existing note's text is replaced; blank text deletes it.
 */
export function commitNote(store: Store, draft: NoteDraft, text: string): void {
  if (draft.kind === 'new') {
    if (text.trim() === '') return;
    const layout = layoutNow(store);
    if (!layout) return;
    const r = store.apply(addNote, { text, at: draft.at }, layout);
    if (r.ok) selectAnnotation(store, { kind: 'note', id: r.id });
    return;
  }
  const current = store.getState().derived?.doc.notes.find((n) => n.id === draft.id);
  if (!current || text.replace(/[\r\n]+$/, '') === current.text) return;
  const r = store.apply(setNoteText, draft.id, text);
  if (r.ok && text.trim() === '') store.clearSelection();
}

export function removeNote(store: Store, id: string): void {
  const r = store.apply(deleteNote, id);
  if (r.ok && sameAnnotation(selectedAnnotation(store), { kind: 'note', id })) store.clearSelection();
}

/** Move a note's top-left to a world point (a drop, after snapping, UI39; or a nudge). */
export function moveNoteTo(store: Store, id: string, at: XY): void {
  const layout = layoutNow(store);
  if (layout) store.apply(moveNote, id, at, layout);
}

export function styleNote(store: Store, id: string, style: NoteStyle): void {
  store.apply(setNoteStyle, id, style);
}

// ---- The title (UI42) ------------------------------------------------------------------------------------------

export function moveTitleTo(store: Store, at: XY): void {
  const layout = layoutNow(store);
  if (layout) store.apply(moveTitle, at, layout);
}

export function resetTitle(store: Store): void {
  store.apply(resetTitlePosition);
}

export function hideTheTitle(store: Store): void {
  const r = store.apply(hideTitle);
  if (r.ok && selectedAnnotation(store)?.kind === 'title') store.clearSelection();
}

export function showTheTitle(store: Store): void {
  store.apply(showTitle);
}

// ---- Either --------------------------------------------------------------------------------------------------

/** Enter on a selected note or the title edits it (UI22 for the title). */
export function editAnnotation(store: Store, target: Annotation): void {
  if (target.kind === 'title') editTitle(store);
  else editNote(store, target.id);
}

/** Arrow keys on a selected note or the title: move it by (dx, dy) px, like a block's nudge (UI10; no snapping). */
export function nudgeAnnotation(store: Store, dx: number, dy: number): void {
  const target = selectedAnnotation(store);
  const layout = store.layout;
  if (!target || !layout) return;
  const blocked = layoutBlocked(store);
  if (blocked) {
    store.toast(blocked, 'info');
    return;
  }
  const box = target.kind === 'title' ? layout.title : layout.notes?.find((n) => n.id === target.id);
  if (!box) return;
  const at = { x: box.x + dx, y: box.y + dy };
  if (target.kind === 'title') moveTitleTo(store, at);
  else moveNoteTo(store, target.id, at);
}
