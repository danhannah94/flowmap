// A18: the four line styles as small pictures and names, shared by the picker bar and the context menu.
import type { EdgeStyle } from '../../core/types';

export const EDGE_STYLE_NAMES: Record<EdgeStyle, string> = {
  solid: 'Solid',
  dashed: 'Dashed',
  thick: 'Thick',
  bidirectional: 'Both ways',
};

/** What each style is for, shown as a tooltip. */
export const EDGE_STYLE_HINTS: Record<EdgeStyle, string> = {
  solid: 'Solid line (-->): a normal, synchronous step',
  dashed: 'Dashed line (-.->): async, event or optional',
  thick: 'Thick line (==>): the critical path',
  bidirectional: 'Arrowheads at both ends (<-->): a two-way link',
};

export function EdgeStyleIcon({ style, width = 30, height = 14 }: { style: EdgeStyle; width?: number; height?: number }) {
  const thick = style === 'thick';
  const head = (x: number, dir: 1 | -1) =>
    `M${x},7 L${x - 5 * dir},${thick ? 3 : 3.5} L${x - 5 * dir},${thick ? 11 : 10.5} Z`;
  const from = style === 'bidirectional' ? 7 : 2;
  return (
    <svg className="fm-edge-style-icon" width={width} height={height} viewBox="0 0 30 14" aria-hidden="true">
      <line
        x1={from}
        y1={7}
        x2={23}
        y2={7}
        stroke="currentColor"
        strokeWidth={thick ? 3 : 1.6}
        strokeDasharray={style === 'dashed' ? '4 3' : undefined}
      />
      <path d={head(28, 1)} fill="currentColor" />
      {style === 'bidirectional' ? <path d={head(2, -1)} fill="currentColor" /> : null}
    </svg>
  );
}
