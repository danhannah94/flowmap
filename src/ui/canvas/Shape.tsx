// One node shape as SVG elements, from the shared geometry in src/core/shapes.ts, so the canvas, the palette and the
// SVG export draw every shape identically (§3.1).
import { memo } from 'react';
import { shapeGeometry, type DecorationShape, type OutlineShape } from '../../core/shapes';
import type { ShapeKind } from '../../core/types';

export interface ShapePaint {
  fill: string;
  stroke: string;
  strokeWidth: number;
  dasharray: string | null;
}

interface Props {
  kind: ShapeKind;
  width: number;
  height: number;
  paint: ShapePaint;
  /** Keep stroke widths constant when the SVG is scaled (palette icons). */
  nonScaling?: boolean;
  className?: string;
}

function Outline({ shape, paint, nonScaling, className }: { shape: OutlineShape; paint: ShapePaint; nonScaling?: boolean; className?: string }) {
  const common = {
    className,
    fill: paint.fill,
    stroke: paint.stroke,
    strokeWidth: paint.strokeWidth,
    strokeDasharray: paint.dasharray ?? undefined,
    strokeLinejoin: 'round' as const,
    vectorEffect: nonScaling ? ('non-scaling-stroke' as const) : undefined,
  };
  switch (shape.tag) {
    case 'rect':
      return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} ry={shape.ry} {...common} />;
    case 'polygon':
      return <polygon points={shape.points} {...common} />;
    case 'path':
      return <path d={shape.d} {...common} />;
  }
}

function Decoration({ shape, paint, nonScaling }: { shape: DecorationShape; paint: ShapePaint; nonScaling?: boolean }) {
  const common = {
    fill: 'none',
    stroke: paint.stroke,
    strokeWidth: Math.max(paint.strokeWidth - 0.5, 1),
    vectorEffect: nonScaling ? ('non-scaling-stroke' as const) : undefined,
  };
  switch (shape.tag) {
    case 'path':
      return <path d={shape.d} {...common} />;
    case 'ellipse':
      return <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...common} />;
    case 'rect':
      return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} {...common} />;
  }
}

/** The outline (first child, carrying the style) and decorations of one shape in a box at (0, 0). */
export const Shape = memo(function Shape({ kind, width, height, paint, nonScaling, className }: Props) {
  const geo = shapeGeometry(kind, { x: 0, y: 0, width, height });
  return (
    <>
      <Outline shape={geo.outline} paint={paint} nonScaling={nonScaling} className={className} />
      {geo.decorations.map((d, i) => (
        <Decoration key={i} shape={d} paint={paint} nonScaling={nonScaling} />
      ))}
    </>
  );
});

/** Just the outline, e.g. for a selection halo behind the node. */
export function OutlineOnly({ kind, width, height, paint, className }: Props) {
  const geo = shapeGeometry(kind, { x: 0, y: 0, width, height });
  return <Outline shape={geo.outline} paint={paint} className={className} />;
}
