// Notes and the title through the UI's actions on a live Store (UI41, UI42, UI10's selection rule), plus the framing
// helpers (fit, the legend under the default row of notes).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { canon } from '../../core/ops/testkit';
import type { Files } from '../../core/ops';
import { derive } from '../store/derive';
import { Store } from '../store/store';
import {
  beginNewNote, commitNote, editNote, hideTheTitle, moveNoteTo, noteEditor, nudgeAnnotation, removeNote,
  selectAnnotation,
} from './actions';
import { notesRowBottom, withAnnotations } from './geometry';

const MMD = canon(`flowchart LR
  a["Alpha"]
  b["Beta"]
  a --> b
`);

const NOTED: Files = {
  mmd: MMD,
  config: 'version: 1\nnotes:\n  placed:\n    text: Placed\n  loose:\n    text: "Two\\nlines"\n',
  layout: JSON.stringify({ version: 1, nodes: {}, notes: { placed: { x: -40, y: -90 } } }),
};

function storeFor(files: Files): Store {
  const store = new Store();
  const d = derive(files, 't.mmd');
  store.set({ status: 'ready', file: 't.mmd', files, derived: d, shown: d, viewport: { x: 100, y: 100, zoom: 1 }, viewportSize: { width: 1200, height: 800 } });
  return store;
}

beforeEach(() => {
  vi.useFakeTimers();
  noteEditor.set(null);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('notes through the store', () => {
  test('a new note is written only by a commit with text, as one undo step, and is then selected', () => {
    const store = storeFor({ mmd: MMD, config: null, layout: null });
    beginNewNote(store, { x: 30.5, y: -20.5 });
    const draft = noteEditor.get()!;
    expect(draft.kind).toBe('new');
    commitNote(store, draft, '  \n ');
    expect(store.getState().undoStack).toHaveLength(0);
    commitNote(store, draft, 'Hello\nworld\n\n');
    const s = store.getState();
    expect(s.undoStack).toHaveLength(1);
    expect(s.files!.config).toBe('version: 1\nnotes:\n  note1:\n    text: "Hello\\nworld"\n');
    // Halves round toward −∞ (UI10).
    expect(JSON.parse(s.files!.layout!).notes).toEqual({ note1: { x: 30, y: -21 } });
    expect(s.selection.annotation).toEqual({ kind: 'note', id: 'note1' });
    store.undo();
    expect(store.getState().files).toEqual({ mmd: MMD, config: null, layout: null });
  });

  test('a note or the title is selected on its own', () => {
    const store = storeFor(NOTED);
    store.select({ nodes: ['a'] });
    selectAnnotation(store, { kind: 'note', id: 'placed' });
    expect(store.getState().selection).toMatchObject({ nodes: [], edges: [], annotation: { kind: 'note', id: 'placed' } });
    store.select({ nodes: ['b'] });
    expect(store.getState().selection.annotation).toBeNull();
    selectAnnotation(store, { kind: 'title' });
    store.selectAll();
    expect(store.getState().selection.annotation).toBeFalsy();
    selectAnnotation(store, { kind: 'title' });
    store.clearSelection();
    expect(store.getState().selection.annotation).toBeFalsy();
  });

  test('deleting a selected note, or hiding a selected title, clears the selection', () => {
    const store = storeFor(NOTED);
    selectAnnotation(store, { kind: 'note', id: 'placed' });
    removeNote(store, 'placed');
    expect(store.getState().selection.annotation).toBeFalsy();
    expect(store.layout!.notes!.map((n) => n.id)).toEqual(['loose']);
    selectAnnotation(store, { kind: 'title' });
    hideTheTitle(store);
    expect(store.layout!.title).toBeNull();
    expect(store.getState().selection.annotation).toBeFalsy();
  });

  test('an undo that removes the selected note drops it from the selection', () => {
    const store = storeFor(NOTED);
    beginNewNote(store, { x: 0, y: 0 });
    commitNote(store, noteEditor.get()!, 'New');
    expect(store.getState().selection.annotation).toEqual({ kind: 'note', id: 'note1' });
    store.undo();
    expect(store.getState().selection.annotation).toBeNull();
  });

  test('editing: blank text deletes; unchanged text writes nothing', () => {
    const store = storeFor(NOTED);
    editNote(store, 'loose');
    const draft = noteEditor.get()!;
    commitNote(store, draft, 'Two\nlines\n');
    expect(store.getState().undoStack).toHaveLength(0);
    commitNote(store, draft, '   ');
    expect(store.layout!.notes!.map((n) => n.id)).toEqual(['placed']);
  });

  test('moves and nudges store the drawn position (no frame here)', () => {
    const store = storeFor(NOTED);
    moveNoteTo(store, 'placed', { x: -100, y: -200 });
    expect(JSON.parse(store.getState().files!.layout!).notes.placed).toEqual({ x: -100, y: -200 });
    selectAnnotation(store, { kind: 'note', id: 'placed' });
    nudgeAnnotation(store, 0, 10);
    expect(JSON.parse(store.getState().files!.layout!).notes.placed).toEqual({ x: -100, y: -190 });
    selectAnnotation(store, { kind: 'title' });
    const t = store.layout!.title!;
    nudgeAnnotation(store, -10, 0);
    expect(JSON.parse(store.getState().files!.layout!).title).toEqual({ x: t.x - 10, y: t.y });
  });
});

describe('framing', () => {
  test('the legend goes under the default row of notes, not under placed ones', () => {
    const d = derive(NOTED, 't.mmd');
    const loose = d.layout!.notes!.find((n) => n.id === 'loose')!;
    expect(loose.y).toBeGreaterThan(d.layout!.height);
    expect(notesRowBottom(d)).toBe(loose.y + loose.height);
    const none = derive({ ...NOTED, config: 'version: 1\n' }, 't.mmd');
    expect(notesRowBottom(none)).toBe(none.layout!.height);
  });

  test('fit takes in notes and the title wherever they are', () => {
    const d = derive(NOTED, 't.mmd');
    const r = withAnnotations({ x: 0, y: 0, width: 100, height: 100 }, d.layout!);
    expect(r.x).toBe(-40);
    expect(r.y).toBe(-90);
  });
});
