// Diagram actions (design.md §8.2 UI22 title, UI23 direction, UI32 export).
import { setDirection, setTitle } from '../../core/ops';
import { requestExport } from '../api';
import type { Store } from '../store/store';
import { TITLE_BAND } from '../store/store';

/** UI22: edit the title in place (`title-editor`). Empty (or only spaces) removes the config `title` (§4). */
export function editTitle(store: Store): void {
  if (store.readOnlyReason()) return;
  const doc = store.getState().derived?.doc;
  if (!doc || !store.layout) return;
  const current = doc.title;
  const shownWidth = document.querySelector<HTMLElement>('[data-testid="title"]')?.offsetWidth ?? 0;
  store.beginEdit({
    testid: 'title-editor',
    target: { kind: 'title' },
    initial: current,
    // In place, the input's text lines up with the title's (its padding and border sit left of x = 0).
    anchor: { x: -10, y: -TITLE_BAND + 12, width: Math.max(360, shownWidth + 80), height: 40 },
    variant: 'title',
    placeholder: 'Diagram title',
    commit: (text) => {
      if (text === current) return;
      store.apply(setTitle, text.trim() === '' ? '' : text);
    },
  });
}

/** UI23: flip between left-to-right and top-to-bottom; the view refits, since the whole diagram turns. */
export function toggleDirection(store: Store): void {
  const dir = store.getState().derived?.doc.graph.direction;
  if (!dir) return;
  const r = store.apply(setDirection, dir === 'LR' ? 'TB' : 'LR');
  if (r.ok) store.fit();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * UI32: write `exports/<name>.svg|png` beside the `.mmd` (light theme, as the CLI does by default) and show the path.
 * The server renders from the files on disk, so any unsaved edit is saved first.
 */
export async function exportDiagram(store: Store, format: 'svg' | 'png'): Promise<void> {
  const s = store.getState();
  if (s.panels.exporting) return;
  store.togglePanel('exporting', true);
  store.set({ exportPath: null });
  store.togglePanel(`exporting-${format}`, true);
  try {
    await store.flush();
    for (let i = 0; store.dirty && i < 60; i++) {
      await sleep(50);
      await store.flush();
    }
    const path = await requestExport(store.getState().file, format, 'light');
    store.set({ exportPath: path });
  } catch (e) {
    store.toast(`Couldn’t export the ${format.toUpperCase()}: ${(e as Error).message}`);
  } finally {
    store.set((st) => ({ panels: { ...st.panels, exporting: false, [`exporting-${format}`]: false } }));
  }
}
