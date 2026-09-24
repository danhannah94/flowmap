// The UI's one store (design.md §8.2): the three files, their versions on disk, the derived document, selection,
// viewport, theme, undo/redo, save state and transient UI state. Every edit goes through `apply(op, ...args)`, which
// runs a pure core operation (src/core/ops) against the current files. The UI never edits file text itself.
//
// Sync model (UI28–UI30):
// - `apply` updates the view at once (optimistic) and saves with PUT within 1 s. Rapid edits are coalesced into one
//   PUT, but each `apply` is its own undo step.
// - Each PUT carries the versions it was based on. A 409 means the disk changed: the disk wins, our unsaved edit is
//   dropped (`edit-dropped`) and history is cleared (`history-cleared`).
// - An external `changed` event does the same (and `edit-dropped` too if an edit was still unsaved). Pan/zoom are
//   kept; the selection keeps ids that still exist.
import type { Files, OpResult } from '../../core/ops';
import type { LayoutResult, ShapeKind } from '../../core/types';
import { fetchDiagram, putDiagram, sameVersions, subscribeChanges, type Snapshot, type Versions } from '../api';
import { derive, sameFiles, withHints, type Derived } from './derive';
import { fitViewport, zoomAround, type Rect, type Viewport } from '../canvas/viewport';

export type ThemeName = 'light' | 'dark';
export type SaveStatus = 'saved' | 'saving' | 'error';

export interface Selection {
  nodes: readonly string[];
  edges: readonly string[];
  /** A selected lane (UI6: click a lane's empty area, then a palette shape). Exclusive with nodes and edges. */
  lane: string | null;
}

export const EMPTY_SELECTION: Selection = Object.freeze({ nodes: [], edges: [], lane: null }) as Selection;

/** The palette's armed shape (UI6: click a shape, then click in a lane). */
export type Tool = { kind: 'select' } | { kind: 'place'; shape: ShapeKind };

/**
 * An in-place text editor (UI8 labels, and later lanes, edges, title, ids, the add-lane prompt). `anchor` is a rect in
 * layout (world) coordinates the editor covers, or null for a centred prompt. `commit` returns an error message to
 * keep the editor open and show it (`id-error`), or nothing to close it.
 */
export interface EditRequest {
  testid: 'label-editor' | 'title-editor' | 'id-editor';
  /** What is being edited, for the canvas to hide the text underneath (e.g. `{kind: 'node', id}`). */
  target: { kind: string; id?: string };
  initial: string;
  anchor: Rect | null;
  placeholder?: string;
  /** Text style hint: `label` (13/18 Inter, centred) or `title` (20 bold, left). */
  variant?: 'label' | 'title' | 'plain';
  /** Where the anchored editor sits on its anchor: centred (blocks, lines), or from its start edge (lanes, title). */
  align?: 'center' | 'start';
  commit: (text: string) => string | void;
  cancel?: () => void;
}

export interface DragPreview {
  ids: readonly string[];
  /** The block under the pointer (whose lane change the canvas previews). */
  lead?: string;
  dx: number;
  dy: number;
}

export interface Notice {
  id: number;
  /** `history-cleared` and `edit-dropped` render with those test ids (§8.3); `toast` is a refusal or message. */
  kind: 'history-cleared' | 'edit-dropped' | 'toast';
  text: string;
  tone: 'info' | 'warn' | 'error';
}

export interface ConfirmRequest {
  message: string;
  detail?: string;
  yes: string;
  no: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface HistoryEntry {
  before: Files;
  after: Files;
  label: string;
}

export interface State {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  loadError: string | null;
  /** The `.mmd` file name being edited (`?file=`). */
  file: string;
  files: Files | null;
  derived: Derived | null;
  /** What the canvas draws: the current derived document, or the last one that could be laid out (read-only). */
  shown: Derived | null;
  selection: Selection;
  viewport: Viewport;
  viewportSize: { width: number; height: number };
  themePref: ThemeName | null;
  systemTheme: ThemeName;
  /** The theme in effect (`data-theme`). */
  theme: ThemeName;
  undoStack: readonly HistoryEntry[];
  redoStack: readonly HistoryEntry[];
  save: SaveStatus;
  saveError: string | null;
  notices: readonly Notice[];
  tool: Tool;
  editing: EditRequest | null;
  drag: DragPreview | null;
  /** Shift-drag selection box, in world coordinates. */
  marquee: Rect | null;
  confirm: ConfirmRequest | null;
  /** Open/closed side panels and popovers by name (`styles`, `shortcuts`, …), for feature code to use. */
  panels: Readonly<Record<string, boolean>>;
  exportPath: string | null;
}

type Listener = () => void;

const THEME_KEY = 'flowmap.theme';
const SAVE_DEBOUNCE = 120;
const SAVE_MAX_WAIT = 600;
const RETRY_MS = 1500;
const NOTICE_MS = 10000;
const TOAST_MS = 4500;

let noticeSeq = 0;

function readThemePref(): ThemeName | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): ThemeName {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initialState(): State {
  const pref = readThemePref();
  const sys = systemTheme();
  return {
    status: 'idle',
    loadError: null,
    file: '',
    files: null,
    derived: null,
    shown: null,
    selection: EMPTY_SELECTION,
    viewport: { x: 0, y: 0, zoom: 1 },
    viewportSize: { width: 0, height: 0 },
    themePref: pref,
    systemTheme: sys,
    theme: pref ?? sys,
    undoStack: [],
    redoStack: [],
    save: 'saved',
    saveError: null,
    notices: [],
    tool: { kind: 'select' },
    editing: null,
    drag: null,
    marquee: null,
    confirm: null,
    panels: {},
    exportPath: null,
  };
}

export class Store {
  private state: State = initialState();
  private readonly listeners = new Set<Listener>();

  // ---- sync internals (not part of the rendered state)
  /** What we believe is on disk: the files and versions of our last load, save or external change. */
  private disk: Snapshot | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private firstUnsavedAt = 0;
  private inFlight = false;
  /** Bumped whenever the disk replaces our state, so a PUT that was in flight is ignored when it returns. */
  private generation = 0;
  private unsubscribe: (() => void) | null = null;
  private fitPending = false;

  constructor() {
    if (typeof matchMedia === 'function') {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        const sys: ThemeName = e.matches ? 'dark' : 'light';
        this.set((s) => ({ systemTheme: sys, theme: s.themePref ?? sys }));
      });
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Subscription

  getState = (): State => this.state;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  set(patch: Partial<State> | ((s: State) => Partial<State>)): void {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    for (const fn of this.listeners) fn();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Loading and sync

  async open(file: string): Promise<void> {
    this.unsubscribe?.();
    this.generation++;
    this.set({ status: 'loading', file, loadError: null });
    try {
      const snap = await fetchDiagram(file);
      this.disk = snap;
      this.fitPending = true;
      this.setFiles(snap.files, { keepSelection: false });
      this.set({ status: 'ready', undoStack: [], redoStack: [], save: 'saved' });
      this.unsubscribe = subscribeChanges(
        file,
        (s) => this.onExternal(s),
        () => void this.recheck(),
      );
      this.maybeFit();
    } catch (e) {
      this.set({ status: 'failed', loadError: (e as Error).message });
    }
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** True when there is an edit the disk doesn't have yet. */
  get dirty(): boolean {
    return this.inFlight || (!!this.state.files && !!this.disk && !sameFiles(this.state.files, this.disk.files));
  }

  /** Save now (used before leaving the page); resolves when nothing is pending. */
  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.save();
  }

  private scheduleSave(): void {
    if (!this.firstUnsavedAt) this.firstUnsavedAt = Date.now();
    if (this.state.save !== 'saving') this.set({ save: 'saving', saveError: null });
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const waited = Date.now() - this.firstUnsavedAt;
    const delay = Math.max(0, Math.min(SAVE_DEBOUNCE, SAVE_MAX_WAIT - waited));
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, delay);
  }

  private async save(): Promise<void> {
    if (this.inFlight || !this.disk || !this.state.files) return;
    const files = this.state.files;
    if (sameFiles(files, this.disk.files)) {
      this.firstUnsavedAt = 0;
      this.set({ save: 'saved', saveError: null });
      return;
    }
    const gen = this.generation;
    this.inFlight = true;
    this.firstUnsavedAt = 0;
    const outcome = await putDiagram(this.state.file, this.disk.versions, files);
    this.inFlight = false;
    if (gen !== this.generation) return; // the disk replaced everything while this was in flight
    if (outcome.kind === 'saved') {
      this.disk = { files, versions: outcome.versions };
      if (!sameFiles(this.state.files!, files)) this.scheduleSave();
      else if (!this.saveTimer) this.set({ save: 'saved', saveError: null });
    } else if (outcome.kind === 'conflict') {
      this.replaceFromDisk(outcome.snapshot, true);
    } else {
      this.set({ save: 'error', saveError: outcome.message });
      if (!this.saveTimer) {
        this.saveTimer = setTimeout(() => {
          this.saveTimer = null;
          void this.save();
        }, RETRY_MS);
      }
    }
  }

  private onExternal(snap: Snapshot): void {
    if (!this.disk || this.state.status !== 'ready') return;
    if (sameVersions(snap.versions, this.disk.versions)) return; // nothing new (or an echo of our own save)
    this.replaceFromDisk(snap, this.dirty);
  }

  /** After the push channel reconnects, compare with the disk in case an event was missed. */
  private async recheck(): Promise<void> {
    try {
      const snap = await fetchDiagram(this.state.file);
      this.onExternal(snap);
    } catch {
      /* the next reconnect tries again */
    }
  }

  /** The disk wins (UI28–UI30): replace the files, keep the view, clear history, and say so. */
  private replaceFromDisk(snap: Snapshot, dropped: boolean): void {
    this.generation++;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.inFlight = false;
    this.firstUnsavedAt = 0;
    this.disk = snap;
    this.setFiles(snap.files, { keepSelection: true });
    const editing = this.state.editing;
    const editTargetGone = editing?.target.id !== undefined && editing.target.kind === 'node'
      && !this.state.shown?.layout?.nodes.some((n) => n.id === editing.target.id);
    this.set({
      undoStack: [],
      redoStack: [],
      save: 'saved',
      saveError: null,
      editing: editTargetGone ? null : editing,
    });
    this.notify('history-cleared', 'The files changed on disk. The view is up to date; undo history was cleared.', 'info');
    if (dropped) this.notify('edit-dropped', 'Your last edit was not saved: the file changed on disk first.', 'warn');
  }

  private setFiles(files: Files, opts: { keepSelection: boolean }): void {
    const d = derive(files, this.state.file);
    const shown = d.layout ? d : this.state.shown;
    const selection = opts.keepSelection ? pruneSelection(this.state.selection, shown?.layout ?? null) : EMPTY_SELECTION;
    this.set({ files, derived: d, shown, selection });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Editing

  /** Why editing is off right now, or null. */
  readOnlyReason(): string | null {
    const s = this.state;
    if (s.status !== 'ready' || !s.derived) return 'The diagram is still loading';
    if (s.derived.readOnly) return 'The .mmd file has errors, so the diagram is read-only until it is fixed (see the error list)';
    return null;
  }

  /**
   * Run one core operation against the current files, as one undo step. On success the view updates at once and
   * the files are saved within a second; a refusal shows its message as a toast. Returns the op's result (with the
   * files as they will be saved), so callers can read values such as a new block's `id`.
   */
  apply<A extends unknown[], R extends object>(
    op: (files: Files, ...args: A) => OpResult<R>,
    ...args: A
  ): OpResult<R> {
    const reason = this.readOnlyReason();
    if (reason) {
      this.toast(reason);
      return { ok: false, error: reason };
    }
    const s = this.state;
    const before = s.files!;
    let r: OpResult<R>;
    try {
      r = op(before, ...args);
    } catch (e) {
      console.error('flowmap: operation failed', e);
      const error = `Something went wrong: ${(e as Error).message}`;
      this.toast(error);
      return { ok: false, error };
    }
    if (!r.ok) {
      this.toast(r.error);
      return r;
    }
    const after = withHints(before, r.files, s.derived);
    if (sameFiles(after, before)) return { ...r, files: after };
    const entry: HistoryEntry = { before, after, label: op.name };
    this.set({ undoStack: [...s.undoStack, entry], redoStack: [] });
    this.setFiles(after, { keepSelection: true });
    this.scheduleSave();
    return { ...r, files: after };
  }

  get canUndo(): boolean {
    return this.state.undoStack.length > 0 && !this.readOnlyReason();
  }

  get canRedo(): boolean {
    return this.state.redoStack.length > 0 && !this.readOnlyReason();
  }

  /** UI28: restore all three files byte for byte to how they were before the last edit (deleting created files). */
  undo(): void {
    const s = this.state;
    const entry = s.undoStack[s.undoStack.length - 1];
    if (!entry || this.readOnlyReason()) return;
    this.set({ undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, entry], editing: null });
    this.setFiles(entry.before, { keepSelection: true });
    this.scheduleSave();
  }

  redo(): void {
    const s = this.state;
    const entry = s.redoStack[s.redoStack.length - 1];
    if (!entry || this.readOnlyReason()) return;
    this.set({ redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, entry], editing: null });
    this.setFiles(entry.after, { keepSelection: true });
    this.scheduleSave();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Selection

  select(sel: Partial<Selection>, mode: 'replace' | 'toggle' = 'replace'): void {
    if (mode === 'replace') {
      this.set({ selection: { nodes: sel.nodes ?? [], edges: sel.edges ?? [], lane: sel.lane ?? null } });
      return;
    }
    const cur = this.state.selection;
    const toggle = (list: readonly string[], ids: readonly string[] = []) => {
      const out = new Set(list);
      for (const id of ids) {
        if (out.has(id)) out.delete(id);
        else out.add(id);
      }
      return [...out];
    };
    this.set({ selection: { nodes: toggle(cur.nodes, sel.nodes), edges: toggle(cur.edges, sel.edges), lane: null } });
  }

  clearSelection(): void {
    const s = this.state.selection;
    if (s.nodes.length || s.edges.length || s.lane) this.set({ selection: EMPTY_SELECTION });
  }

  selectAll(): void {
    const layout = this.layout;
    if (!layout) return;
    this.set({ selection: { nodes: layout.nodes.map((n) => n.id), edges: layout.edges.map((e) => e.id), lane: null } });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // View

  /** The layout the canvas draws (possibly the last good one while the `.mmd` has errors). */
  get layout(): LayoutResult | null {
    return this.state.shown?.layout ?? null;
  }

  setViewport(v: Viewport): void {
    this.set({ viewport: v });
  }

  /**
   * The canvas element's size: the visible area, which ends at the side column's edge (the column is a sibling, so
   * opening it narrows the canvas). When the canvas shrinks, the view pans the least amount that keeps the block
   * being edited or the one selected block in view.
   */
  setViewportSize(width: number, height: number): void {
    const cur = this.state.viewportSize;
    if (cur.width === width && cur.height === height) return;
    this.set({ viewportSize: { width, height } });
    if (this.fitPending) {
      this.maybeFit();
      return;
    }
    if (cur.width > 0 && (width < cur.width || height < cur.height)) this.revealFocus();
  }

  /** The world rect the person is working on: the open editor's target, else the one selected block. */
  private focusRect(): Rect | null {
    const s = this.state;
    if (s.editing?.anchor) return s.editing.anchor;
    if (s.selection.nodes.length !== 1) return null;
    const id = s.selection.nodes[0];
    const n = this.layout?.nodes.find((x) => x.id === id);
    return n ? { x: n.x, y: n.y, width: n.width, height: n.height } : null;
  }

  private revealFocus(): void {
    if (this.state.drag || this.state.marquee) return; // never move the world under a gesture in progress
    const r = this.focusRect();
    if (r) this.reveal(r);
  }

  /**
   * Pan (never zoom) the least amount that brings a world rect into the visible area, clear of the palette. With
   * `onlyIfOffscreen`, a rect that is at least partly visible is left where it is.
   */
  reveal(r: Rect, opts: { margin?: number; onlyIfOffscreen?: boolean } = {}): void {
    const { viewport: v, viewportSize: size } = this.state;
    if (size.width === 0) return;
    const margin = opts.margin ?? 32;
    if (opts.onlyIfOffscreen) {
      const sx = r.x * v.zoom + v.x;
      const sy = r.y * v.zoom + v.y;
      if (sx < size.width && sx + r.width * v.zoom > 0 && sy < size.height && sy + r.height * v.zoom > 0) return;
    }
    const shift = (start: number, end: number, lo: number, hi: number) => {
      if (end - start > hi - lo || start < lo) return lo - start; // too big, or off the start: align the start
      if (end > hi) return hi - end;
      return 0;
    };
    const x0 = r.x * v.zoom + v.x;
    const y0 = r.y * v.zoom + v.y;
    const dx = shift(x0, x0 + r.width * v.zoom, PALETTE_INSET + 8, size.width - margin);
    const dy = shift(y0, y0 + r.height * v.zoom, margin, size.height - margin);
    if (dx || dy) this.set({ viewport: { ...v, x: v.x + dx, y: v.y + dy } });
  }

  private maybeFit(): void {
    const { viewportSize } = this.state;
    if (!this.fitPending || !this.layout || viewportSize.width === 0) return;
    this.fitPending = false;
    this.fit();
  }

  /** Fit the whole diagram (title and legend included) in the canvas. */
  fit(): void {
    const s = this.state;
    const bounds = contentBounds(s.shown);
    if (!bounds || s.viewportSize.width === 0) return;
    this.set({ viewport: fitViewport(bounds, s.viewportSize, 40, PALETTE_INSET) });
  }

  /**
   * Zoom by `factor` around a screen point: the pointer for the wheel; for the buttons and keys, the one selected
   * block if it is on screen (so it stays put while you zoom in to work on it), else the middle of the visible area.
   */
  zoomBy(factor: number, center?: { x: number; y: number }): void {
    const s = this.state;
    this.set({ viewport: zoomAround(s.viewport, factor, center ?? this.zoomCentre()) });
  }

  private zoomCentre(): { x: number; y: number } {
    const { viewport: v, viewportSize: size, selection } = this.state;
    const middle = { x: size.width / 2, y: size.height / 2 };
    if (selection.nodes.length !== 1) return middle;
    const n = this.layout?.nodes.find((x) => x.id === selection.nodes[0]);
    if (!n) return middle;
    const c = { x: (n.x + n.width / 2) * v.zoom + v.x, y: (n.y + n.height / 2) * v.zoom + v.y };
    return c.x >= 0 && c.x <= size.width && c.y >= 0 && c.y <= size.height ? c : middle;
  }

  toggleTheme(): void {
    const next: ThemeName = this.state.theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* private mode: the toggle still works for this page */
    }
    this.set({ themePref: next, theme: next });
  }

  setTool(tool: Tool): void {
    this.set({ tool });
  }

  togglePanel(name: string, open?: boolean): void {
    this.set((s) => ({ panels: { ...s.panels, [name]: open ?? !s.panels[name] } }));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Editors, dialogs, notices

  beginEdit(req: EditRequest): void {
    this.set({ editing: req });
  }

  endEdit(): void {
    if (this.state.editing) this.set({ editing: null });
  }

  /** Ask for a confirmation (`data-testid="confirm"`). */
  confirm(opts: Omit<ConfirmRequest, 'resolve' | 'yes' | 'no'> & { yes?: string; no?: string }): Promise<boolean> {
    return new Promise((resolve) => {
      this.state.confirm?.resolve(false);
      this.set({
        confirm: {
          yes: 'OK',
          no: 'Cancel',
          ...opts,
          resolve: (ok) => {
            this.set({ confirm: null });
            resolve(ok);
          },
        },
      });
    });
  }

  toast(text: string, tone: Notice['tone'] = 'error'): void {
    this.notify('toast', text, tone);
  }

  notify(kind: Notice['kind'], text: string, tone: Notice['tone']): void {
    const id = ++noticeSeq;
    this.set((s) => ({
      notices: [...s.notices.filter((n) => n.kind === 'toast' || n.kind !== kind), { id, kind, text, tone }].slice(-6),
    }));
    setTimeout(() => this.dismiss(id), kind === 'toast' ? TOAST_MS : NOTICE_MS);
  }

  dismiss(id: number): void {
    if (this.state.notices.some((n) => n.id === id)) this.set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
  }
}

/** Keep only selected ids that still exist in the layout. */
function pruneSelection(sel: Selection, layout: LayoutResult | null): Selection {
  if (!layout) return EMPTY_SELECTION;
  const nodes = new Set(layout.nodes.map((n) => n.id));
  const edges = new Set(layout.edges.map((e) => e.id));
  const lanes = new Set(layout.lanes.map((l) => l.id));
  const next: Selection = {
    nodes: sel.nodes.filter((id) => nodes.has(id)),
    edges: sel.edges.filter((id) => edges.has(id)),
    lane: sel.lane && lanes.has(sel.lane) ? sel.lane : null,
  };
  return next.nodes.length === sel.nodes.length && next.edges.length === sel.edges.length && next.lane === sel.lane
    ? sel
    : next;
}

/** Room the floating shape palette takes at the canvas's left edge (fit keeps the diagram clear of it). */
export const PALETTE_INSET = 92;

/** Title band above the diagram and legend below it, in world coordinates (shared with the canvas). */
export const TITLE_BAND = 64;
export const LEGEND_GAP = 28;

export function legendRows(count: number, width: number): number {
  if (count === 0) return 0;
  const perRow = Math.max(1, Math.floor(Math.max(width, 320) / 260));
  return Math.ceil(count / perRow);
}

function contentBounds(shown: Derived | null): Rect | null {
  const layout = shown?.layout;
  if (!layout) return null;
  const legend = shown!.doc.legend.length;
  const bottom = layout.height + (legend ? LEGEND_GAP + legendRows(legend, layout.width) * 30 : 0);
  return { x: 0, y: -TITLE_BAND, width: Math.max(layout.width, 320), height: bottom + TITLE_BAND };
}
