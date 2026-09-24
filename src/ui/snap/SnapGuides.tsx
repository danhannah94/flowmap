// The snap guides (UI39, §8.3 `data-testid="snap-guide"`): while a drag is snapped, a thin line across the whole
// canvas at each snapped coordinate (vertical for x, horizontal for y). Drawn in screen space over the canvas, so it
// stays one crisp pixel at any zoom; it never takes pointer events. Mounted once through the `overlays` registry.
import { createPortal } from 'react-dom';
import { useCanvasWrap } from '../canvas/connect';
import { overlays } from '../chrome/Panels';
import { useSignal } from '../features/signal';
import { shallow, useStoreState } from '../store/hooks';
import { snapGuides } from './guides';
import './snap.css';

export function SnapGuides() {
  const guides = useSignal(snapGuides);
  const viewport = useStoreState((s) => s.viewport, shallow);
  const size = useStoreState((s) => s.viewportSize, shallow);
  const wrap = useCanvasWrap();
  if (!wrap || guides.length === 0) return null;
  // Half-pixel offsets keep a 1 px line on one row of device pixels.
  const px = (v: number) => Math.round(v) + 0.5;
  return createPortal(
    <svg
      className="fm-snap-guides"
      data-testid="snap-guide"
      data-guides={guides.map((g) => `${g.axis}:${g.at}`).join(' ')}
      width={size.width}
      height={size.height}
      aria-hidden="true"
    >
      {guides.map((g) => {
        if (g.axis === 'x') {
          const x = px(g.at * viewport.zoom + viewport.x);
          return <line key={`x${g.at}`} data-axis="x" data-at={g.at} x1={x} x2={x} y1={0} y2={size.height} />;
        }
        const y = px(g.at * viewport.zoom + viewport.y);
        return <line key={`y${g.at}`} data-axis="y" data-at={g.at} x1={0} x2={size.width} y1={y} y2={y} />;
      })}
    </svg>,
    wrap,
  );
}

overlays.push({ id: 'snap-guides', Component: SnapGuides });
