// UI1: the home page lists the diagrams; `/?file=<name>.mmd` opens one in the editor.
import { useEffect, useMemo, useState } from 'react';
import { listDiagrams } from './api';
import { Canvas } from './canvas/Canvas';
import { Palette } from './chrome/Palette';
import { ConfirmDialog, ErrorBanner, Notices, SidePanels } from './chrome/Panels';
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
    </div>
  );
}

function HomePage() {
  const [files, setFiles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    document.title = 'flowmap';
    listDiagrams().then(setFiles, (e: Error) => setError(e.message));
  }, []);
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
          <h1>Diagrams</h1>
          {error ? <p className="fm-error-text">Couldn’t list the diagrams: {error}</p> : null}
          {files === null && !error ? <p className="fm-muted">Loading…</p> : null}
          {files && files.length === 0 ? <p className="fm-muted">No .mmd files in this folder yet.</p> : null}
          <ul data-testid="diagram-list" className="fm-diagram-list">
            {(files ?? []).map((f) => (
              <li key={f}>
                <a data-file={f} href={`/?file=${encodeURIComponent(f)}`}>
                  <span className="fm-diagram-name">{f.replace(/\.mmd$/i, '')}</span>
                  <span className="fm-diagram-file">{f}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
