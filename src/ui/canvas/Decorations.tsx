// The legend below the diagram (UI2), in world coordinates like the SVG export. (The title, which can be moved and
// hidden since v1.1, is drawn with the notes: src/ui/notes.)
import { resolveStyle, type Theme } from '../../core/theme';
import type { LayoutResult, LegendItem } from '../../core/types';
import { notesRowBottom } from '../notes/geometry';
import { LEGEND_GAP } from '../store/store';
import { useStoreState } from '../store/hooks';

export function Legend({ items, layout, theme }: { items: LegendItem[]; layout: LayoutResult; theme: Theme }) {
  // Below the diagram and the default row of notes under it (§6), so the two never overlap.
  const bottom = useStoreState((s) => notesRowBottom(s.shown));
  return (
    <div
      data-testid="legend"
      className="fm-legend"
      style={{ left: 0, top: Math.max(bottom, layout.height) + LEGEND_GAP, width: Math.max(layout.width, 320) }}
    >
      {items.map((item, i) => {
        const s = resolveStyle(item.style, theme);
        return (
          <div key={i} data-testid="legend-item" className="fm-legend-item">
            <svg width={30} height={20} aria-hidden="true">
              <rect
                x={2}
                y={2}
                width={26}
                height={16}
                rx={3}
                fill={s.fill}
                stroke={s.stroke}
                strokeWidth={s.strokeWidth}
                strokeDasharray={s.dasharray ?? undefined}
              />
              {s.badge ? <circle cx={26} cy={4} r={3.5} fill={theme.badgeFill} stroke={theme.badgeText} strokeWidth={1} /> : null}
            </svg>
            <span style={{ fontStyle: s.fontStyle, fontWeight: s.fontWeight === 'bold' ? 700 : undefined }}>{item.text}</span>
          </div>
        );
      })}
    </div>
  );
}
