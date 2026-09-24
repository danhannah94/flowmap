import { useStore, useStoreState } from '../store/hooks';
import { icons } from './icons';

/** Bottom-right zoom widget: out, the zoom level (click for 100%), in. */
export function ZoomControls() {
  const store = useStore();
  const zoom = useStoreState((s) => s.viewport.zoom);
  const hasLayout = useStoreState((s) => !!s.shown?.layout);
  if (!hasLayout) return null;
  return (
    <div className="fm-zoom" data-canvas-control>
      <button type="button" className="fm-zoom-btn" title="Zoom out" aria-label="Zoom out" onClick={() => store.zoomBy(1 / 1.2)}>
        {icons.zoomOut}
      </button>
      <button
        type="button"
        className="fm-zoom-level"
        title="Reset to 100%"
        onClick={() => store.zoomBy(1 / store.getState().viewport.zoom)}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" className="fm-zoom-btn" title="Zoom in" aria-label="Zoom in" onClick={() => store.zoomBy(1.2)}>
        {icons.zoomIn}
      </button>
    </div>
  );
}
