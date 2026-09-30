// UI1: the home page lists the current folder's subfolders and diagrams (design.md A16); `/?file=<path>.mmd` opens
// one in the editor, `/?dir=<path>` browses a folder.
import { useEffect, useMemo } from 'react';
import { Canvas } from './canvas/Canvas';
import { Palette } from './chrome/Palette';
import './chrome/evidence'; // evidence and styles (UI24–UI27): inspector, styles panel, orphan deletes
import './contextmenu'; // context menus (UI40)
import './snap/SnapGuides'; // snap guides while dragging (UI39)
import { ConfirmDialog, ErrorBanner, Notices, Overlays, SidePanels } from './chrome/Panels';
import { TopBar } from './chrome/Toolbar';
import { ZoomControls } from './chrome/ZoomControls';
import { HomePage } from './home/Home';
import { folderOf, homeHref } from './home/paths';
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
            <a className="fm-btn fm-btn-primary" href={homeHref(folderOf(file))}>All diagrams</a>
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

