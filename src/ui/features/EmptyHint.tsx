// A first-steps hint on a diagram with no blocks yet (H2: a map from scratch without reading docs). It sits at the
// bottom of the canvas and goes away with the first block.
// - A diagram without lanes is a plain flowchart (amendment A4): click a shape to add a block. When it was just made
//   as "Swimlanes" on the home page (`&new=swimlanes`, a UI convenience that writes nothing), it offers a first lane
//   instead.
// - With lanes: how to add a block to them.
import { createPortal } from 'react-dom';
import { isLaneFree } from '../../core/types';
import { useCanvasWrap } from '../canvas/connect';
import { icons } from '../chrome/icons';
import { editable } from '../commands/types';
import { useStore, useStoreState } from '../store/hooks';
import { promptAddLane } from './laneActions';

/** The kind of diagram the home page was asked for (`&new=flowchart|swimlanes` on a just-created diagram). */
export function newDiagramMode(): 'flowchart' | 'swimlanes' | null {
  const mode = new URLSearchParams(location.search).get('new');
  return mode === 'flowchart' || mode === 'swimlanes' ? mode : null;
}

export function EmptyHint() {
  const store = useStore();
  const wrap = useCanvasWrap();
  const state = useStoreState((s) => {
    const layout = s.shown?.layout;
    if (!layout || layout.nodes.length > 0 || !editable(s) || s.editing) return null;
    if (!isLaneFree(layout.lanes)) return 'no-blocks';
    return newDiagramMode() === 'swimlanes' ? 'no-lanes' : 'flowchart';
  });
  const lane = useStoreState((s) => (s.selection.lane ? s.shown?.layout?.lanes.find((l) => l.id === s.selection.lane)?.label ?? null : null));
  if (!state || !wrap) return null;
  return createPortal(
    <div className="fm-empty-hint" role="note" data-canvas-control data-hint={state}>
      {state === 'no-lanes' ? (
        <>
          <span>Start with a lane for each role or team.</span>
          <button type="button" className="fm-btn fm-btn-primary fm-empty-hint-btn" onClick={() => promptAddLane(store)}>
            {icons.addLane}
            Add a lane
          </button>
        </>
      ) : state === 'flowchart' ? (
        <span>Click a shape in the palette to add a block, or drag it onto the canvas.</span>
      ) : (
        <span>
          {lane ? `Click a shape in the palette to add a block to ${lane}.` : 'Click a shape in the palette, then click in a lane.'}
        </span>
      )}
    </div>,
    wrap,
  );
}
