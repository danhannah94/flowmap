// Edges, drawn from the layout's routed `points` (§6 L6–L8) with arrowheads and labels at `label_pos`.
import { memo, useMemo } from 'react';
import { edgeLabelLines, edgeLabelSize, LABEL_FONT } from '../../core/measure';
import type { Theme } from '../../core/theme';
import type { LayoutResult } from '../../core/types';
import { shallow, useStoreState } from '../store/hooks';
import { edgePoints, roundedPath, type LayoutEdge, type LayoutNode } from './geometry';
import type { Point } from './viewport';

const ARROW = 9; // arrowhead length (px)

/** Stop the line short of the end so the arrowhead's tip lands exactly on the end point. */
function trimEnd(pts: Point[], by: number): Point[] {
  if (pts.length < 2) return pts;
  const a = pts[pts.length - 2]!;
  const b = pts[pts.length - 1]!;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len <= by + 1) return pts;
  const k = (len - by) / len;
  return [...pts.slice(0, -1), { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }];
}

type Mode = 'normal' | 'moving' | 'detached';

interface EdgeProps {
  edge: LayoutEdge;
  source: LayoutNode | undefined;
  target: LayoutNode | undefined;
  selected: boolean;
  /** While blocks are dragged: an edge between two moving blocks moves with them; one touching a single moving block
   *  fades until the drop re-routes it. */
  mode: Mode;
  dx: number;
  dy: number;
}

const EdgeView = memo(function EdgeView({ edge, source, target, selected, mode, dx, dy }: EdgeProps) {
  const pts = useMemo(() => edgePoints(edge, source, target), [edge, source, target]);
  const line = useMemo(() => roundedPath(trimEnd(pts, ARROW)), [pts]);
  const hit = useMemo(() => roundedPath(pts), [pts]);
  const end = pts[pts.length - 1];
  const before = pts[pts.length - 2];
  const arrow = end && before ? arrowHead(before, end) : '';
  const lines = edge.label ? edgeLabelLines(edge.label) : [];
  const size = edge.label ? edgeLabelSize(edge.label) : null;
  return (
    <g
      className={`fm-edge fm-edge-${mode}`}
      data-edge-id={edge.id}
      data-source={edge.source}
      data-target={edge.target}
      data-selected={selected ? 'true' : 'false'}
      transform={mode === 'moving' ? `translate(${dx} ${dy})` : undefined}
    >
      <path className="fm-edge-hit" d={hit} />
      <path className="fm-edge-line" d={line} />
      <path className="fm-edge-arrow" d={arrow} />
      {edge.label && edge.label_pos && size ? (
        <g className="fm-edge-label">
          <rect
            x={edge.label_pos[0] - size.width / 2 - 3}
            y={edge.label_pos[1] - size.height / 2 - 1}
            width={size.width + 6}
            height={size.height + 2}
            rx={5}
          />
          {lines.map((l, i) => (
            <text
              key={i}
              x={edge.label_pos![0]}
              y={edge.label_pos![1] - size.height / 2 + i * LABEL_FONT.lineHeight + LABEL_FONT.lineHeight * 0.7}
              textAnchor="middle"
            >
              {l}
            </text>
          ))}
        </g>
      ) : null}
      {selected && pts.length >= 2 ? (
        <>
          <EndGrip pts={pts} end="source" />
          <EndGrip pts={pts} end="target" />
        </>
      ) : null}
    </g>
  );
});

/**
 * A selected edge's draggable end (UI16). It sits a little way along the line from its block rather than on the
 * border: blocks are drawn above edges and their handles reach outside the box, so a grip centred on the border
 * would be under the block. At the target end it sits just behind the arrowhead. Its radius keeps it about 10 px
 * across on screen when zoomed out (capped so it never dwarfs the line), inside a wider invisible hit ring of about
 * 14 px; where the ring reaches under a block, the block wins.
 */
function EndGrip({ pts, end }: { pts: Point[]; end: 'source' | 'target' }) {
  const zoom = useStoreState((s) => s.viewport.zoom);
  const r = Math.min(14, Math.max(5, 6 / zoom));
  const hit = Math.min(20, Math.max(8, 9 / zoom));
  const path = end === 'source' ? pts : [...pts].reverse();
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  let left = Math.min(end === 'source' ? 13 : ARROW + 5, total / 3);
  let at = path[0]!;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len >= left && len > 0) {
      at = { x: a.x + ((b.x - a.x) * left) / len, y: a.y + ((b.y - a.y) * left) / len };
      break;
    }
    left -= len;
    at = b;
  }
  return (
    <g className="fm-edge-end" data-edge-end={end}>
      <circle className="fm-edge-end-hit" cx={at.x} cy={at.y} r={hit} />
      <circle className="fm-edge-end-dot" cx={at.x} cy={at.y} r={r} style={{ strokeWidth: Math.min(4, 2 / zoom) }} />
    </g>
  );
}

function arrowHead(from: Point, tip: Point): string {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const ux = (tip.x - from.x) / len;
  const uy = (tip.y - from.y) / len;
  const bx = tip.x - ux * ARROW;
  const by = tip.y - uy * ARROW;
  const w = 4.5;
  const f = (n: number) => Math.round(n * 100) / 100;
  return `M${f(tip.x)},${f(tip.y)}L${f(bx - uy * w)},${f(by + ux * w)}L${f(bx + uy * w)},${f(by - ux * w)}Z`;
}

export function EdgesLayer({ layout, theme }: { layout: LayoutResult; theme: Theme }) {
  const selectedEdges = useStoreState((s) => s.selection.edges, shallow);
  const drag = useStoreState((s) => s.drag);
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);
  const selected = useMemo(() => new Set(selectedEdges), [selectedEdges]);
  const moving = useMemo(() => new Set(drag?.ids ?? []), [drag?.ids]);
  return (
    <svg
      className="fm-edges"
      style={{ left: 0, top: 0, width: layout.width, height: layout.height, color: theme.edgeColor }}
      width={layout.width}
      height={layout.height}
    >
      {layout.edges.map((e) => {
        let mode: Mode = 'normal';
        if (drag) {
          const s = moving.has(e.source);
          const t = moving.has(e.target);
          mode = s && t ? 'moving' : s || t ? 'detached' : 'normal';
        }
        return (
          <EdgeView
            key={e.id}
            edge={e}
            source={byId.get(e.source)}
            target={byId.get(e.target)}
            selected={selected.has(e.id)}
            mode={mode}
            dx={mode === 'moving' ? drag!.dx : 0}
            dy={mode === 'moving' ? drag!.dy : 0}
          />
        );
      })}
    </svg>
  );
}
