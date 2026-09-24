// Edges, drawn from the layout's routed `points` (§6 L6–L8, L11) with arrowheads and labels at `label_pos`.
//
// v1.1 (§8.3 "Edge (v1.1)"): each edge element carries `data-manual` and `data-points` (the layout's points, as in
// `flowmap layout`), and its label is `data-role="edge-label"` (draggable along the line, UI37). A selected line is
// drawn in a second layer above the blocks, with its shaping handles (lineHandles.tsx): the handles are what a person
// is reaching for, so no block or connection handle may cover them. While a line is shaped, it is drawn live in its
// new shape (`shaping`), with the old line as a faint dashed ghost.
import { memo, useMemo } from 'react';
import { edgeLabelLines, edgeLabelSize, LABEL_FONT } from '../../core/measure';
import type { Theme } from '../../core/theme';
import type { LayoutEdgeEntry, LayoutResult } from '../../core/types';
import { useSignal } from '../features/signal';
import { shallow, useStoreState } from '../store/hooks';
import { edgePoints, roundedPath, type LayoutEdge, type LayoutNode } from './geometry';
import { lineModel, type XY } from './lineGeometry';
import { LineHandles, shaping, type Shaping } from './lineHandles';
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

/**
 * How far along a selected line, from each end, its bare stroke lets the pointer through: the blocks' connection
 * handles reach 38 px out from the box (lines.css `--reach`), and an end can be up to 20 px inside it (§6 L12).
 */
const HANDLE_REACH = 60;

/** A polyline without its first and last `by` px (at most a third of its length each). */
function trimEnds(pts: Point[], by: number): Point[] {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  const cut = Math.min(by, total / 3);
  if (cut <= 0) return pts;
  const from = (path: Point[]): Point[] => {
    let left = cut;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > left) return [{ x: a.x + ((b.x - a.x) * left) / len, y: a.y + ((b.y - a.y) * left) / len }, ...path.slice(i)];
      left -= len;
    }
    return [path[path.length - 1]!];
  };
  return from(from(pts).reverse()).reverse();
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
  /** A drag on this line in progress (lineHandles.tsx), or null. */
  shape: Shaping | null;
}

const EdgeView = memo(function EdgeView({ edge, source, target, selected, mode, dx, dy, shape }: EdgeProps) {
  const drawnPts = useMemo(() => edgePoints(edge, source, target), [edge, source, target]);
  const shapedPts = useMemo(
    () => (shape?.points ? edgePoints({ ...edge, points: shape.points }, source, target) : null),
    [shape?.points, edge, source, target],
  );
  const pts = shapedPts ?? drawnPts;
  const line = useMemo(() => roundedPath(trimEnd(pts, ARROW)), [pts]);
  // A selected line is drawn above the blocks: near its ends its bare stroke steps aside for the blocks' connection
  // handles, so the handle on the side it leaves from can still start a line.
  const hit = useMemo(() => roundedPath(selected ? trimEnds(pts, HANDLE_REACH) : pts), [pts, selected]);
  const ghost = useMemo(() => (shape?.ghost ? roundedPath(drawnPts) : null), [shape?.ghost, drawnPts]);
  const end = pts[pts.length - 1];
  const before = pts[pts.length - 2];
  const arrow = end && before ? arrowHead(before, end) : '';
  const lines = edge.label ? edgeLabelLines(edge.label) : [];
  const size = edge.label ? edgeLabelSize(edge.label) : null;
  const labelPos: XY | null = shape?.label ?? edge.label_pos;
  const dataPoints = useMemo(() => edge.points.map((p) => `${p[0]},${p[1]}`).join(' '), [edge.points]);
  return (
    <g
      className={`fm-edge fm-edge-${mode}${shape?.points ? ' fm-edge-shaping' : ''}`}
      data-edge-id={edge.id}
      data-source={edge.source}
      data-target={edge.target}
      data-selected={selected ? 'true' : 'false'}
      data-manual={edge.manual ? 'true' : 'false'}
      data-points={dataPoints}
      transform={mode === 'moving' ? `translate(${dx} ${dy})` : undefined}
    >
      <path className="fm-edge-hit" d={hit} />
      {ghost ? <path className="fm-edge-ghost" d={ghost} /> : null}
      <path className="fm-edge-line" d={line} />
      <path className="fm-edge-arrow" d={arrow} />
      {edge.label && labelPos && size ? (
        <g className="fm-edge-label" data-role="edge-label" data-dragging={shape?.label ? 'true' : undefined}>
          <rect
            x={labelPos[0] - size.width / 2 - 3}
            y={labelPos[1] - size.height / 2 - 1}
            width={size.width + 6}
            height={size.height + 2}
            rx={5}
          />
          {lines.map((l, i) => (
            <text
              key={i}
              x={labelPos[0]}
              y={labelPos[1] - size.height / 2 + i * LABEL_FONT.lineHeight + LABEL_FONT.lineHeight * 0.7}
              textAnchor="middle"
            >
              {l}
            </text>
          ))}
        </g>
      ) : null}
      {selected && pts.length >= 2 ? <SelectedHandles edge={edge} shape={shape} /> : null}
    </g>
  );
});

/** The shaping handles of a selected line, read from the current document (layout with its frame, stored entries). */
function SelectedHandles({ edge, shape }: { edge: LayoutEdge; shape: Shaping | null }) {
  const zoom = useStoreState((s) => s.viewport.zoom);
  const output = useStoreState((s) => s.shown?.doc.layout ?? null);
  const entry = useStoreState((s): LayoutEdgeEntry | undefined => s.shown?.doc.edgeEntries[edge.id]);
  const model = useMemo(() => (output ? lineModel(output, entry, edge.id) : null), [output, entry, edge.id]);
  if (!model) return null;
  return <LineHandles model={model} zoom={zoom} shape={shape} />;
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
  const shape = useSignal(shaping);
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);
  const selected = useMemo(() => new Set(selectedEdges), [selectedEdges]);
  const moving = useMemo(() => new Set(drag?.ids ?? []), [drag?.ids]);
  const view = (e: LayoutEdge) => {
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
        shape={shape?.edgeId === e.id ? shape : null}
      />
    );
  };
  // Selected lines, and one being shaped, go in the layer above the blocks.
  const top = (e: LayoutEdge) => selected.has(e.id) || shape?.edgeId === e.id;
  const svg = (className: string, children: React.ReactNode) => (
    <svg
      className={className}
      style={{ left: 0, top: 0, width: layout.width, height: layout.height, color: theme.edgeColor }}
      width={layout.width}
      height={layout.height}
    >
      {children}
    </svg>
  );
  return (
    <>
      {svg('fm-edges', layout.edges.filter((e) => !top(e)).map(view))}
      {svg('fm-edges fm-edges-top', layout.edges.filter(top).map(view))}
    </>
  );
}
