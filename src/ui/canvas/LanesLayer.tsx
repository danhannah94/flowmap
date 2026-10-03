// Lanes: full-width bands (§6 L1) in display order, each with its header in the LANE_HEADER strip at the start of
// the flow (left for LR, top for TB). The header is the lane's handle for later features (rename, menu, reorder);
// lane features can also draw over the bands (A8: the resize handle on each lane's far edge).
// A diagram without subgraphs (amendment A4) is a plain flowchart: its one lane, Unassigned, is drawn bare (no band,
// no header, and it lets clicks through to the canvas), keeping only its `data-lane-id` (§8.3).
import { memo } from 'react';
import { LANE_HEADER } from '../../core/layout';
import { blockGroupAt } from '../../core/ops/frame';
import type { Theme } from '../../core/theme';
import { isLaneFree, UNASSIGNED, type Direction, type LayoutResult } from '../../core/types';
import type { State } from '../store/store';
import { useStoreState } from '../store/hooks';
import { dropBand, dropLaneAt, type LayoutLane } from './geometry';

interface LaneProps {
  lane: LayoutLane;
  index: number;
  direction: Direction;
  selected: boolean;
  fill: string;
  editing: boolean;
  /** Extra header content (the lane menu, added by lane features). */
  headerExtras?: React.ReactNode;
  /** A block being dragged would land in this lane (UI11): highlight it. */
  dropTarget: boolean;
}

const LaneView = memo(function LaneView({ lane, index, direction, selected, fill, editing, headerExtras, dropTarget }: LaneProps) {
  const header = direction === 'TB'
    ? { left: 0, top: 0, width: lane.width, height: LANE_HEADER }
    : { left: 0, top: 0, width: LANE_HEADER, height: lane.height };
  return (
    <div
      className={`fm-lane fm-${direction}`}
      data-lane-id={lane.id}
      data-selected={selected ? 'true' : 'false'}
      data-index={index}
      data-drop-target={dropTarget ? 'true' : undefined}
      style={{ left: lane.x, top: lane.y, width: lane.width, height: lane.height, background: fill }}
    >
      <div className="fm-lane-header" data-lane-header={lane.id} style={header}>
        <span className="fm-lane-label" title={lane.label} style={{ visibility: editing ? 'hidden' : undefined }}>
          {lane.label}
        </span>
        {headerExtras}
      </div>
    </div>
  );
});

/** Hook point for lane features: content rendered inside each lane header (e.g. the lane menu button). */
export type LaneHeaderExtras = (lane: LayoutLane) => React.ReactNode;
let laneHeaderExtras: LaneHeaderExtras | null = null;
export function setLaneHeaderExtras(fn: LaneHeaderExtras | null): void {
  laneHeaderExtras = fn;
}

/**
 * Hook point for lane features: content drawn after every lane band, above the bands and below lines and blocks (A8:
 * the lane resize handles). Not drawn in a diagram without subgraphs (A4: it has no bands).
 */
export type LaneLayerExtras = (layout: LayoutResult) => React.ReactNode;
let laneLayerExtras: LaneLayerExtras | null = null;
export function setLaneLayerExtras(fn: LaneLayerExtras | null): void {
  laneLayerExtras = fn;
}

/**
 * While blocks are dragged: the lane the block under the pointer would move to on drop (its centre's lane, or
 * Unassigned outside every lane, as `dropNodes` decides), or null while it stays in its own lane.
 */
function dropTargetLane(s: State): string | null {
  const drag = s.drag;
  const layout = s.shown?.layout;
  if (!drag || !layout || drag.ids.length === 0) return null;
  const n = layout.nodes.find((x) => x.id === (drag.lead ?? drag.ids[0]));
  if (!n) return null;
  const lane = dropLaneAt(layout, { x: n.x + drag.dx + n.width / 2, y: n.y + drag.dy + n.height / 2 });
  return lane !== n.lane ? lane : null;
}

/**
 * A19: while blocks are dragged, the group the block under the pointer would join on drop (the innermost group box
 * holding its centre, in the lane it lands in, as `dropNodes` decides), or null when that is where it already is.
 */
function dropTargetGroup(s: State): string | null {
  const drag = s.drag;
  const layout = s.shown?.layout;
  if (!drag || !layout?.groups || drag.ids.length === 0) return null;
  const n = layout.nodes.find((x) => x.id === (drag.lead ?? drag.ids[0]));
  if (!n) return null;
  const c = { x: n.x + drag.dx + n.width / 2, y: n.y + drag.dy + n.height / 2 };
  const group = blockGroupAt(layout, dropLaneAt(layout, c), c.x, c.y);
  return group !== (n.group ?? null) ? group : null;
}

/** A19: the groups of a diagram (§6 L13), drawn over the lane bands and under lines and blocks; clicks go through. */
const GroupsView = memo(function GroupsView({ groups, dropTarget }: { groups: NonNullable<LayoutResult['groups']>; dropTarget: string | null }) {
  return (
    <>
      {groups.map((g) => (
        <div
          key={g.id}
          className="fm-group"
          data-group-id={g.id}
          data-lane={g.lane}
          data-parent-group={g.parent ?? undefined}
          data-x={g.x}
          data-y={g.y}
          data-width={g.width}
          data-height={g.height}
          data-drop-target={dropTarget === g.id ? 'true' : undefined}
          style={{ left: g.x, top: g.y, width: g.width, height: g.height }}
        >
          <span className="fm-group-label" data-role="group-label" title={g.label}>{g.label}</span>
        </div>
      ))}
    </>
  );
});

export function LanesLayer({ layout, theme }: { layout: LayoutResult; theme: Theme }) {
  const selectedLane = useStoreState((s) => s.selection.lane);
  const dropTarget = useStoreState(dropTargetLane);
  const dropGroup = useStoreState(dropTargetGroup);
  const editingLane = useStoreState((s) => (s.editing?.target.kind === 'lane' ? s.editing.target.id ?? null : null));
  if (isLaneFree(layout.lanes)) {
    return (
      <div className="fm-lanes">
        {layout.lanes.map((lane) => (
          <div
            key={lane.id}
            className="fm-lane fm-lane-bare"
            data-lane-id={lane.id}
            data-selected="false"
            style={{ left: lane.x, top: lane.y, width: lane.width, height: lane.height }}
          />
        ))}
      </div>
    );
  }
  // Dropping outside every lane moves a block to Unassigned: when that lane isn't showing yet, preview where it
  // will appear.
  const preview = dropTarget === UNASSIGNED && !layout.lanes.some((l) => l.id === UNASSIGNED) ? dropBand(layout, UNASSIGNED) : null;
  return (
    <div className="fm-lanes">
      {layout.lanes.map((lane, i) => (
        <LaneView
          key={lane.id}
          lane={lane}
          index={i}
          direction={layout.direction}
          selected={selectedLane === lane.id}
          fill={theme.laneFill[i % 2]!}
          editing={editingLane === lane.id}
          headerExtras={laneHeaderExtras?.(lane)}
          dropTarget={dropTarget === lane.id}
        />
      ))}
      {preview ? (
        <div
          className={`fm-lane-preview fm-${layout.direction}`}
          data-drop-preview={UNASSIGNED}
          style={{ left: preview.x, top: preview.y, width: preview.width, height: preview.height }}
        >
          <span className="fm-lane-preview-label">Unassigned</span>
        </div>
      ) : null}
      {layout.groups ? <GroupsView groups={layout.groups} dropTarget={dropGroup} /> : null}
      {laneLayerExtras?.(layout)}
    </div>
  );
}
