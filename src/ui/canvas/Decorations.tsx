// The title above the diagram and the legend below it (UI2), in world coordinates like the SVG export.
import { resolveStyle, type Theme } from '../../core/theme';
import type { LayoutResult, LegendItem } from '../../core/types';
import { LEGEND_GAP, TITLE_BAND } from '../store/store';
import { useStoreState } from '../store/hooks';

export function DiagramTitle({ title }: { title: string }) {
  const editing = useStoreState((s) => s.editing?.target.kind === 'title');
  return (
    <div className="fm-title-wrap" style={{ left: 0, top: -TITLE_BAND }}>
      <div data-testid="title" className="fm-title" style={{ visibility: editing ? 'hidden' : undefined }}>
        {title}
      </div>
    </div>
  );
}

export function Legend({ items, layout, theme }: { items: LegendItem[]; layout: LayoutResult; theme: Theme }) {
  return (
    <div
      data-testid="legend"
      className="fm-legend"
      style={{ left: 0, top: layout.height + LEGEND_GAP, width: Math.max(layout.width, 320) }}
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
