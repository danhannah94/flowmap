// UI1: the home page lists the diagrams; `/?file=<name>.mmd` opens one in the editor.
import { useEffect, useMemo, useState } from 'react';
import { createDiagram, deleteDiagram, listDiagrams } from './api';
import { Canvas } from './canvas/Canvas';
import { Palette } from './chrome/Palette';
import './chrome/evidence'; // evidence and styles (UI24–UI27): inspector, styles panel, orphan deletes
import './contextmenu'; // context menus (UI40)
import './snap/SnapGuides'; // snap guides while dragging (UI39)
import { ConfirmDialog, ErrorBanner, Notices, Overlays, SidePanels } from './chrome/Panels';
import { Logo, ThemeToggle, TopBar } from './chrome/Toolbar';
import { ZoomControls } from './chrome/ZoomControls';
import { installKeyboard } from './keyboard';
import { StoreContext, useStore, useStoreState } from './store/hooks';
import { Store } from './store/store';

export function App() {
  const store = useMemo(() => new Store(), []);
  const file = new URLSearchParams(location.search).get('file');
  useThemeOnRoot(store);
  return (
    <StoreContext.Provider value={store}>
      {file ? <Editor file={file} /> : <HomePage />}
    </StoreContext.Provider>
  );
}

/** Keep `<html data-theme>` in step with the store (the chrome's CSS variables hang off it). */
function useThemeOnRoot(store: Store) {
  useEffect(() => {
    const apply = () => {
      const t = store.getState().theme;
      if (document.documentElement.dataset.theme !== t) document.documentElement.dataset.theme = t;
    };
    apply();
    return store.subscribe(apply);
  }, [store]);
}

function Editor({ file }: { file: string }) {
  const store = useStore();
  const status = useStoreState((s) => s.status);
  const loadError = useStoreState((s) => s.loadError);

  useEffect(() => {
    void store.open(file);
    const uninstall = installKeyboard(store);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (store.dirty) {
        void store.flush();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.title = `${file.replace(/\.mmd$/i, '')} · flowmap`;
    return () => {
      uninstall();
      window.removeEventListener('beforeunload', beforeUnload);
      store.close();
    };
  }, [store, file]);

  if (status === 'failed') {
    return (
      <div className="fm-app">
        <div className="fm-homepage">
          <div className="fm-home-card">
            <h1>Couldn’t open {file}</h1>
            <p className="fm-muted">{loadError}</p>
            <a className="fm-btn fm-btn-primary" href="/">All diagrams</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fm-app">
      <TopBar />
      <div className="fm-main">
        <div className="fm-stage">
          <ErrorBanner />
          <div className="fm-canvas-wrap">
            <Canvas />
            <Palette />
            <ZoomControls />
            <Notices />
          </div>
        </div>
        <SidePanels />
      </div>
      <ConfirmDialog />
      <Overlays />
    </div>
  );
}

function HomePage() {
  const store = useStore();
  const [files, setFiles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = 'flowmap';
    listDiagrams().then(setFiles, (e: Error) => setError(e.message));
  }, []);

  const handleDelete = async (file: string) => {
    const ok = await store.confirm({
      message: `Delete ${file}?`,
      detail: 'It moves to .flowmap-trash in this folder.',
      yes: 'Delete',
      no: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    const r = await deleteDiagram(file);
    if (r.ok) setFiles((cur) => (cur ? cur.filter((f) => f !== file) : cur));
    else store.toast(`Couldn’t delete ${file}: ${r.error}`);
  };

  return (
    <div className="fm-app">
      <header className="fm-topbar">
        <div className="fm-topbar-left">
          <span className="fm-home">
            <Logo />
          </span>
          <div className="fm-docname">
            <span className="fm-docname-title">flowmap</span>
          </div>
        </div>
        <div />
        <div className="fm-topbar-right">
          <ThemeToggle />
        </div>
      </header>
      <main className="fm-homepage">
        <div className="fm-home-card">
          <div className="fm-home-head">
            <h1>Diagrams</h1>
            <NewDiagram taken={files ?? []} />
          </div>
          {error ? <p className="fm-error-text">Couldn’t list the diagrams: {error}</p> : null}
          {files === null && !error ? <p className="fm-muted">Loading…</p> : null}
          {files && files.length === 0 ? <p className="fm-muted">No .mmd files in this folder yet. Start one with New diagram.</p> : null}
          <ul data-testid="diagram-list" className="fm-diagram-list">
            {(files ?? []).map((f) => (
              <li key={f} className="fm-diagram-row">
                <a data-file={f} href={`/?file=${encodeURIComponent(f)}`}>
                  <span className="fm-diagram-name">{f.replace(/\.mmd$/i, '')}</span>
                  <span className="fm-diagram-file">{f}</span>
                </a>
                <button
                  type="button"
                  className="fm-diagram-delete-btn"
                  data-testid="diagram-delete"
                  data-diagram-file={f}
                  // Fixed, generic text (not the file name): the file's own list entry sits right next to it for
                  // context, and a name built from arbitrary diagram names would be one accessibility feature away
                  // from colliding with an unrelated `getByRole('button', { name })` query elsewhere in the app.
                  title="Delete this diagram"
                  aria-label="Delete this diagram"
                  onClick={(e) => {
                    e.preventDefault();
                    void handleDelete(f);
                  }}
                >
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <ConfirmDialog />
      <Notices />
    </div>
  );
}

/** The same trash glyph the lane menu's delete item uses (`LaneMenu.tsx`), so both "delete" affordances match. */
function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}

/** The file name for a new diagram's name: lowercase words joined by `-` (`Purchase approval` → `purchase-approval.mmd`). */
function diagramFileName(name: string): string | null {
  const slug = name.trim().toLowerCase().replace(/\.mmd$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? `${slug}.mmd` : null;
}

/** What a new diagram starts as (amendment A4). Both write the same empty `.mmd`; the choice only shapes the first steps. */
type NewMode = 'flowchart' | 'swimlanes';

const NEW_MODES: { mode: NewMode; label: string; note: string }[] = [
  { mode: 'flowchart', label: 'Flowchart', note: 'Blocks and lines, no lanes' },
  { mode: 'swimlanes', label: 'Swimlanes', note: 'A lane for each role or team' },
];

/**
 * Home page: name a new diagram, choose Flowchart (no lanes) or Swimlanes, create its empty `.mmd`, and open it. The
 * choice is a UI convenience (A4): the file is the same `flowchart LR` either way, and the editor's first-steps hint
 * follows the choice (`&new=` on the editor's address).
 */
function NewDiagram({ taken }: { taken: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<NewMode>('flowchart');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = diagramFileName(name);
  const submit = async () => {
    if (!file || busy) return;
    if (taken.includes(file)) {
      setError(`${file} already exists`);
      return;
    }
    setBusy(true);
    const r = await createDiagram(file);
    setBusy(false);
    if (r.ok) location.href = `/?file=${encodeURIComponent(file)}&new=${mode}`;
    else setError(r.error);
  };
  const cancel = () => {
    setOpen(false);
    setName('');
    setError(null);
  };
  if (!open) {
    return (
      <button type="button" className="fm-btn fm-btn-primary" onClick={() => setOpen(true)}>
        New diagram
      </button>
    );
  }
  return (
    <form
      className="fm-new-diagram"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel();
      }}
    >
      <input
        autoFocus
        className="fm-new-diagram-input"
        placeholder="Name, e.g. Purchase approval"
        aria-label="New diagram name"
        value={name}
        spellCheck={false}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
      />
      <button type="submit" className="fm-btn fm-btn-primary" disabled={!file || busy}>
        Create
      </button>
      <div className="fm-new-diagram-kind" role="radiogroup" aria-label="Kind of diagram">
        {NEW_MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={mode === m.mode}
            data-mode={m.mode}
            className={`fm-new-diagram-choice${mode === m.mode ? ' fm-active' : ''}`}
            onClick={() => setMode(m.mode)}
          >
            <KindIcon mode={m.mode} />
            <span className="fm-new-diagram-choice-text">
              <span className="fm-new-diagram-choice-label">{m.label}</span>
              <span className="fm-new-diagram-choice-note">{m.note}</span>
            </span>
          </button>
        ))}
      </div>
      <div className={error ? 'fm-new-diagram-note fm-error-text' : 'fm-new-diagram-note'}>
        {error ?? (file ? `Creates ${file}` : 'Enter to create, Esc to cancel')}
      </div>
    </form>
  );
}

/** A tiny picture of each kind of diagram: three linked boxes, bare or in two lanes. */
function KindIcon({ mode }: { mode: NewMode }) {
  return (
    <svg width="34" height="24" viewBox="0 0 34 24" aria-hidden="true" className="fm-new-diagram-icon">
      {mode === 'swimlanes' ? (
        <>
          <rect x="0.5" y="0.5" width="33" height="11.5" rx="2" fill="none" stroke="currentColor" strokeOpacity="0.45" />
          <rect x="0.5" y="12" width="33" height="11.5" rx="2" fill="none" stroke="currentColor" strokeOpacity="0.45" />
          <rect x="4" y="3.5" width="8" height="5.5" rx="1" fill="currentColor" />
          <rect x="22" y="15" width="8" height="5.5" rx="1" fill="currentColor" />
          <path d="M12 6.25h5v11.5h5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </>
      ) : (
        <>
          <rect x="1" y="9" width="8" height="6" rx="1" fill="currentColor" />
          <path d="M17 6l4.5 6-4.5 6-4.5-6z" fill="currentColor" />
          <rect x="25" y="9" width="8" height="6" rx="1" fill="currentColor" />
          <path d="M9 12h3.5M21.5 12H25" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </>
      )}
    </svg>
  );
}
