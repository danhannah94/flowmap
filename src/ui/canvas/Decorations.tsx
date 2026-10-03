// The legend below the diagram (UI2), in world coordinates like the SVG export. (The title, which can be moved and
// hidden since v1.1, is drawn with the notes: src/ui/notes.)
import { resolveStyle, type Theme } from '../../core/theme';
import type { LayoutResult, LegendItem } from '../../core/types';
import { Glyph } from './Icon';
import { notesRowBottom } from '../notes/geometry';
import { LEGEND_GAP, legendWidth } from '../store/store';
import { LEGEND_ROW_HEIGHT, LEGEND_SWATCH_H, LEGEND_SWATCH_W, legendLayout } from '../../core/legend';
import { useStoreState } from '../store/hooks';

export function Legend({ items, layout, theme }: { items: LegendItem[]; layout: LayoutResult; theme: Theme }) {
  // Below the diagram and the default row of notes under it (§6), so the two never overlap.
  const bottom = useStoreState((s) => notesRowBottom(s.shown));
  if (items.length === 0) return null;
  // Wrapped into rows exactly as the export wraps them (core/legend), so a long legend stays under the diagram and
  // "fit" (which measures it the same way, store.ts) brings all of it into view.
  const width = legendWidth(layout);
  const { items: placed, totalHeight } = legendLayout(items, width);
  return (
    <div
      data-testid="legend"
      className="fm-diagram-legend"
      style={{ left: 0, top: Math.max(bottom, layout.height) + LEGEND_GAP, width, height: totalHeight }}
    >
      {placed.map(({ item, x, y }, i) => {
        const s = resolveStyle(item.style, theme);
        return (
          <div
            key={i}
            data-testid="legend-item"
            className="fm-legend-item"
            data-icon={item.icon?.name}
            style={{ left: x, top: y, height: LEGEND_ROW_HEIGHT }}
          >
            <svg width={LEGEND_SWATCH_W} height={LEGEND_SWATCH_H} overflow="visible" aria-hidden="true">
              <rect
                x={0}
                y={0}
                width={LEGEND_SWATCH_W}
                height={LEGEND_SWATCH_H}
                rx={3}
                fill={s.fill}
                stroke={s.stroke}
                strokeWidth={s.strokeWidth}
                strokeDasharray={s.dasharray ?? undefined}
              />
              {item.icon ? <Glyph icon={item.icon} x={7} y={2} size={12} color={s.textColor} /> : null}
              {s.badge ? <circle cx={24} cy={2} r={3.5} fill={theme.badgeFill} stroke={theme.badgeText} strokeWidth={1} /> : null}
            </svg>
            <span style={{ fontStyle: s.fontStyle, fontWeight: s.fontWeight === 'bold' ? 700 : undefined }}>{item.text}</span>
          </div>
        );
      })}
    </div>
  );
}
