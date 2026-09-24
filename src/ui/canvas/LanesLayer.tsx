// Lanes: full-width bands (§6 L1) in display order, each with its header in the LANE_HEADER strip at the start of
// the flow (left for LR, top for TB). The header is the lane's handle for later features (rename, menu, reorder).
import { memo } from 'react';
import { LANE_HEADER } from '../../core/layout';
import type { Theme } from '../../core/theme';
import type { Direction, LayoutResult } from '../../core/types';
import type { State } from '../store/store';
import { useStoreState } from '../store/hooks';
import { laneAt, type LayoutLane } from './geometry';

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
 * While blocks are dragged: the lane the block under the pointer would move to on drop (its centre's lane, as
 * `dropNodes` decides), or null while it stays in its own lane.
 */
function dropTargetLane(s: State): string | null {
  const drag = s.drag;
  const layout = s.shown?.layout;
  if (!drag || !layout || drag.ids.length === 0) return null;
  const n = layout.nodes.find((x) => x.id === (drag.lead ?? drag.ids[0]));
  if (!n) return null;
  const lane = laneAt(layout, { x: n.x + drag.dx + n.width / 2, y: n.y + drag.dy + n.height / 2 });
  return lane && lane.id !== n.lane ? lane.id : null;
}

export function LanesLayer({ layout, theme }: { layout: LayoutResult; theme: Theme }) {
  const selectedLane = useStoreState((s) => s.selection.lane);
  const dropTarget = useStoreState(dropTargetLane);
  const editingLane = useStoreState((s) => (s.editing?.target.kind === 'lane' ? s.editing.target.id ?? null : null));
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
    </div>
  );
}
