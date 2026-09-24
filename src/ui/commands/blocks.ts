// Block and line commands (design.md §8.2 UI7, UI9, UI12–UI15, UI17; toolbar test ids §8.3; keys UI33).
// Each command turns an intent into one core operation through `store.apply` (one undo step). The canvas side of
// lines (drag to connect, reconnect, the edge label editor, the preview) lives in canvas/connect.tsx.
import { createElement } from 'react';
import { parseLayoutFile } from '../../core/layoutfile';
import {
  changeShape, clearAllPins, deleteItems, duplicateNodes, renameNode, unpinNodes,
} from '../../core/ops';
import type { ShapeKind } from '../../core/types';
import { armConnect, connectArmed, disarmConnect, editEdgeLabel } from '../canvas/connect';
import type { Rect } from '../canvas/viewport';
import { icons } from '../chrome/icons';
import { overlays } from '../chrome/Panels';
import { ShapePicker } from '../chrome/ShapePicker';
import { removeNote } from '../notes/actions';
import type { State, Store } from '../store/store';
import { editable, type Command } from './types';

// ---- UI7 Change shape

/** UI7: change a block's shape (the declaration is rewritten in place). */
export function changeBlockShape(store: Store, id: string, shape: ShapeKind): void {
  const node = store.layout?.nodes.find((n) => n.id === id);
  if (node?.kind === shape) return;
  store.apply(changeShape, id, shape);
}

// ---- UI9 Rename id

/**
 * UI9: open the id editor (`id-editor`) for a block. Enter commits; a refused id (bad form, reserved or taken) keeps
 * the editor open with the reason in `id-error`; Escape cancels. The inspector's `id-edit` button calls this.
 *
 * `anchor`: a rect in world coordinates for the editor to cover; by default it is a centred prompt, which stays
 * readable at any zoom and has room for the refusal message.
 */
export function editNodeId(store: Store, id: string, opts: { anchor?: Rect | null } = {}): void {
  const reason = store.readOnlyReason();
  if (reason) {
    store.toast(reason, 'info');
    return;
  }
  if (!store.layout?.nodes.some((n) => n.id === id)) return;
  const anchor = opts.anchor ?? null;
  store.beginEdit({
    testid: 'id-editor',
    target: { kind: 'node-id', id },
    initial: id,
    anchor,
    variant: 'plain',
    placeholder: `New id for “${id}”`,
    commit: (text) => {
      const next = text.trim();
      if (next === id) return;
      const files = store.getState().files;
      if (!files) return 'The diagram is not loaded';
      // Check first, so a refusal shows in the editor (`id-error`) rather than as a toast.
      const check = renameNode(files, id, next);
      if (!check.ok) return check.error;
      const r = store.apply(renameNode, id, next);
      if (!r.ok) return r.error;
      store.select({ nodes: [next] });
    },
  });
}

// ---- UI12 Unpin, re-layout all

/** Ids with an entry in the layout file (pinned, or a pin that no longer applies), or null if it has errors. */
function pinnedIds(s: State): Set<string> | null {
  const text = s.files?.layout ?? null;
  if (text === null) return new Set();
  const parsed = parseLayoutFile(text);
  return parsed.file ? new Set(Object.keys(parsed.file.nodes)) : null;
}

const pinsCache = new WeakMap<object, Set<string> | null>();
function pins(s: State): Set<string> | null {
  const key = s.files;
  if (!key) return new Set();
  if (!pinsCache.has(key)) pinsCache.set(key, pinnedIds(s));
  return pinsCache.get(key)!;
}

function unpinSelection(store: Store): void {
  const p = pins(store.getState());
  const ids = store.getState().selection.nodes.filter((id) => p?.has(id));
  if (ids.length) store.apply(unpinNodes, ids);
}

async function relayoutAll(store: Store): Promise<void> {
  const count = pins(store.getState())?.size ?? 0;
  const ok = await store.confirm({
    message: 'Re-layout the whole diagram?',
    detail: `This clears ${count === 1 ? 'the 1 pinned position' : `all ${count} pinned positions`}, so every block goes back to automatic placement. You can undo it.`,
    yes: 'Re-layout all',
    no: 'Cancel',
    danger: true,
  });
  if (ok) store.apply(clearAllPins);
}

// ---- UI13 Duplicate

function duplicateSelection(store: Store): void {
  const layout = store.layout;
  const ids = store.getState().selection.nodes;
  if (!layout || ids.length === 0) return;
  const r = store.apply(duplicateNodes, ids, layout);
  if (r.ok) store.select({ nodes: r.ids });
}

// ---- UI14 Delete (and UI41: a selected note)

/** A note is what's selected (a note's selection leaves no block or line selected, UI10). The title isn't deleted. */
const selectedNote = (s: State): string | null => (s.selection.annotation?.kind === 'note' ? s.selection.annotation.id : null);

function deleteSelection(store: Store): void {
  const s = store.getState();
  const { nodes, edges } = s.selection;
  if (nodes.length || edges.length) {
    const r = store.apply(deleteItems, { nodes, edges });
    if (r.ok) store.clearSelection();
    return;
  }
  const note = selectedNote(s);
  if (note !== null) removeNote(store, note);
}

// The shape picker (UI7), mounted over the canvas while one block is selected.
overlays.push({
  id: 'shape-picker',
  Component: function BlockShapePicker() {
    return createElement(ShapePicker, { onShape: changeBlockShape, onRename: (store, id) => editNodeId(store, id) });
  },
});

// ---- Commands

const hasNodes = (s: State) => s.selection.nodes.length > 0;

export const blockCommands: Command[] = [
  {
    id: 'connect',
    title: 'Connect: select a block, press connect, click the target',
    help: 'Connect the selected block to the next block you click (or drag from a block’s handle)',
    icon: icons.connect,
    enabled: (s) => editable(s) && !!s.shown?.layout?.nodes.length && s.selection.nodes.length <= 1
      && s.selection.edges.length === 0,
    active: connectArmed,
    run: (store) => {
      if (connectArmed(store.getState())) disarmConnect(store);
      else armConnect(store);
    },
  },
  {
    id: 'duplicate',
    title: 'Duplicate',
    icon: icons.duplicate,
    keys: ['mod+d'],
    help: 'Duplicate the selected blocks',
    enabled: (s) => editable(s) && hasNodes(s) && !!s.shown?.layout,
    run: duplicateSelection,
  },
  {
    id: 'delete',
    title: 'Delete',
    icon: icons.delete,
    keys: ['Delete', 'Backspace'],
    help: 'Delete the selected blocks and lines, or the selected note',
    enabled: (s) => editable(s) && (s.selection.nodes.length > 0 || s.selection.edges.length > 0 || selectedNote(s) !== null),
    run: deleteSelection,
  },
  {
    id: 'unpin',
    title: 'Unpin (back to automatic placement)',
    icon: icons.unpin,
    enabled: (s) => {
      if (!editable(s)) return false;
      const p = pins(s);
      return !!p && s.selection.nodes.some((id) => p.has(id));
    },
    run: unpinSelection,
  },
  {
    id: 'relayout-all',
    title: 'Re-layout all (clear every pin)',
    icon: icons.relayout,
    enabled: (s) => editable(s) && (pins(s)?.size ?? 0) > 0,
    run: (store) => void relayoutAll(store),
  },
  {
    id: 'rename-id',
    title: 'Rename the selected block’s id',
    keys: ['F2'],
    enabled: (s) => editable(s) && s.selection.nodes.length === 1,
    run: (store) => editNodeId(store, store.getState().selection.nodes[0]!),
  },
  {
    id: 'edit-edge-label',
    title: 'Edit the selected line’s label',
    keys: ['Enter'],
    enabled: (s) => editable(s) && s.selection.nodes.length === 0 && s.selection.edges.length === 1,
    run: (store) => editEdgeLabel(store, store.getState().selection.edges[0]!),
  },
];
