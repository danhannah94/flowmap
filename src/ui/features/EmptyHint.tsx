// A first-steps hint on a diagram with no blocks yet (H2: a map from scratch without reading docs): with no lanes, a
// button to add the first one; with lanes, how to add a block. It sits at the bottom of the canvas and goes away with
// the first block.
import { createPortal } from 'react-dom';
import { useCanvasWrap } from '../canvas/connect';
import { icons } from '../chrome/icons';
import { editable } from '../commands/types';
import { useStore, useStoreState } from '../store/hooks';
import { promptAddLane } from './laneActions';

export function EmptyHint() {
  const store = useStore();
  const wrap = useCanvasWrap();
  const state = useStoreState((s) => {
    const layout = s.shown?.layout;
    if (!layout || layout.nodes.length > 0 || !editable(s) || s.editing) return null;
    return layout.lanes.length === 0 ? 'no-lanes' : 'no-blocks';
  });
  const lane = useStoreState((s) => (s.selection.lane ? s.shown?.layout?.lanes.find((l) => l.id === s.selection.lane)?.label ?? null : null));
  if (!state || !wrap) return null;
  return createPortal(
    <div className="fm-empty-hint" role="note" data-canvas-control>
      {state === 'no-lanes' ? (
        <>
          <span>Start with a lane for each role or team.</span>
          <button type="button" className="fm-btn fm-btn-primary fm-empty-hint-btn" onClick={() => promptAddLane(store)}>
            {icons.addLane}
            Add a lane
          </button>
        </>
      ) : (
        <span>
          {lane ? `Click a shape in the palette to add a block to ${lane}.` : 'Click a shape in the palette, then click in a lane.'}
        </span>
      )}
    </div>,
    wrap,
  );
}
