// Lanes, diagram, export and keyboard features (UI18–UI23, UI32, UI33), wired into the foundation through its
// extension points only: the lane-header extras hook (the lane menu), the gesture and double-click registries (header
// drag reorder, header double-click), and the overlay slot (menu popover, delete dialog, drop indicator, export
// result, shortcut list). Imported once, for its side effects, by commands/lanes.ts.
import { useEffect } from 'react';
import { registerDoubleClick } from '../canvas/gestures';
import { setLaneHeaderExtras } from '../canvas/LanesLayer';
import { overlays } from '../chrome/Panels';
import { useStore } from '../store/hooks';
import { editTitle } from './diagramActions';
import { ExportResult } from './ExportResult';
import { editLaneLabel } from './laneActions';
import { LaneDeleteDialog } from './LaneDeleteDialog';
import { LaneMenuButton, LaneMenuPopover } from './LaneMenu';
import { LaneDragOverlay, registerLaneReorder } from './laneReorder';
import { ShortcutList } from './ShortcutList';
import './features.css';

let installed = false;

export function installFeatures(): void {
  if (installed) return;
  installed = true;
  setLaneHeaderExtras((lane) => <LaneMenuButton lane={lane} />);
  registerLaneReorder();
  registerDoubleClick('lane', (store, hit) => (hit.kind === 'lane' && hit.header ? editLaneLabel(store, hit.id) : false));
  overlays.push({ id: 'lanes-diagram', Component: FeatureHost });
}

function FeatureHost() {
  useTitleDoubleClick();
  return (
    <>
      <LaneMenuPopover />
      <LaneDeleteDialog />
      <LaneDragOverlay />
      <ExportResult />
      <ShortcutList />
    </>
  );
}

/**
 * UI22: double-click the title to edit it. The title isn't one of the canvas's hit-test kinds, so this listens on the
 * document and checks what is under the pointer (pointer capture retargets the event to the canvas).
 */
function useTitleDoubleClick(): void {
  const store = useStore();
  useEffect(() => {
    const onDbl = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el?.closest('[data-testid="title"]')) return;
      if (store.getState().editing) return;
      e.preventDefault();
      editTitle(store);
    };
    document.addEventListener('dblclick', onDbl);
    return () => document.removeEventListener('dblclick', onDbl);
  }, [store]);
}
