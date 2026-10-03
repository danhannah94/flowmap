// A20: a preset pack's icon, drawn from the same glyph paths and the same box (`iconBox`) as the SVG export, so the
// editor and the export agree. Everything is inline SVG: no network, no icon font.
import { memo } from 'react';
import { GLYPH_GRID, GLYPH_STROKE } from '../../core/preset';
import { ICON_CHIP, ICON_GLYPH, iconBox } from '../../core/measure';
import type { ResolvedNodeStyle } from '../../core/theme';
import type { ResolvedIcon, ShapeKind } from '../../core/types';

/** A glyph on the 24 x 24 grid, stroked in `color`, `size` px wide with its top-left at (x, y). */
export function Glyph({ icon, x, y, size, color }: { icon: ResolvedIcon; x: number; y: number; size: number; color: string }) {
  return (
    <g
      transform={`translate(${x} ${y}) scale(${size / GLYPH_GRID})`}
      fill="none"
      stroke={color}
      strokeWidth={GLYPH_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icon.paths.map((d, i) => <path key={i} d={d} />)}
    </g>
  );
}

/**
 * The icon on a block: a round tag on its top edge, towards the left, in the block's own fill and border with the glyph
 * in its text colour (the one colour that contrasts with the fill in either theme), and a ring in the canvas colour.
 */
export const NodeIcon = memo(function NodeIcon({ icon, kind, width, height, style, title }: {
  icon: ResolvedIcon;
  kind: ShapeKind;
  width: number;
  height: number;
  style: ResolvedNodeStyle;
  title: string;
}) {
  const b = iconBox(kind, width, height);
  const r = ICON_CHIP / 2;
  const pad = (ICON_CHIP - ICON_GLYPH) / 2;
  return (
    <svg
      className="fm-icon"
      data-testid="node-icon"
      data-icon={icon.name}
      width={ICON_CHIP + 4}
      height={ICON_CHIP + 4}
      viewBox={`-2 -2 ${ICON_CHIP + 4} ${ICON_CHIP + 4}`}
      style={{ left: b.x - 2, top: b.y - 2 }}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <circle cx={r} cy={r} r={r + 1.5} className="fm-icon-ring" />
      <circle cx={r} cy={r} r={r} fill={style.fill} stroke={style.stroke} strokeWidth={1.25} />
      <Glyph icon={icon} x={pad} y={pad} size={ICON_GLYPH} color={style.textColor} />
    </svg>
  );
});
