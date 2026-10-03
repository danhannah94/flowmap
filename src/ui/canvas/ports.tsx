// Connection handles and connection points on a block (design.md §8.2 UI38, §8.3 "Node (v1.1)").
//
// - Four handles, `data-handle="source"` with `data-port="top|right|bottom|left"`, in that DOM order. Each sits just
//   outside the block, square to its side and in line with the side's port (§6 L12; a diamond's vertices), so the
//   side's own resize handle (`data-resize`, on the border) stays clickable next to it. They exist for their own block
//   only: shown, and taking the pointer, while the block is hovered or selected (lines.css), never covering another
//   block or a lane header. Their size stays the same on screen at any zoom (`--zoom`, set by the canvas), within caps.
//   Dragging one starts a line from that side (connect.tsx).
// - While a line is being connected or reconnected over this block, its four connection points `data-port-target`
//   show on the ports themselves; the nearest is highlighted (`data-nearest`), and the one a drop would attach to is
//   `data-active` (the pointer is on it). Which block and port is set by connect.tsx through `connectTarget`.
// - A22: the points a drop along a side snaps to (0.25 and 0.75; 0.5 is the side's port) show as small ticks,
//   `data-port-tick="<side>"` with `data-at`; and when a drop would attach along a side off its midline, a marker
//   `data-port-drop` with `data-side` and `data-at` shows exactly where.
import { memo } from 'react';
import { nodePort, nodePorts } from '../../core/layout';
import type { Side } from '../../core/types';
import { signal, useSignal } from '../features/signal';
import type { LayoutNode } from './geometry';
import './lines.css';

/** The block a line being connected or reconnected is over, its nearest connection point, and whether a drop attaches there. */
export interface ConnectTarget {
  node: string;
  nearest: Side;
  active: boolean;
  /** A22: where along `nearest` a drop attaches (0.5: its port), when `active`; else null. */
  frac?: number | null;
}

/** A22: the snap points along each side other than its port (UI38's ticks). */
const TICKS = [0.25, 0.75] as const;

export const connectTarget = signal<ConnectTarget | null>(null);

const ARROW: Record<Side, string> = {
  // A small arrow pointing away from the block: "drag out from here".
  top: 'M8 1.5 14.5 12.5H1.5Z',
  right: 'M14.5 8 3.5 14.5V1.5Z',
  bottom: 'M8 14.5 1.5 3.5H14.5Z',
  left: 'M1.5 8 12.5 1.5V14.5Z',
};

export const PortHandles = memo(function PortHandles({ node }: { node: LayoutNode }) {
  const ports = nodePorts(node);
  return (
    <>
      {ports.map(({ side, point }) => {
        // In line with the port, just outside the box on its side.
        const along = side === 'top' || side === 'bottom' ? { left: point[0] - node.x } : { top: point[1] - node.y };
        return (
          <div key={side} className={`fm-port fm-port-${side}`} data-handle="source" data-port={side} style={along}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d={ARROW[side]} />
            </svg>
          </div>
        );
      })}
      <PortTargets node={node} />
    </>
  );
});

/** The connection points shown while a line is dragged over this block (UI38). */
function PortTargets({ node }: { node: LayoutNode }) {
  const t = useSignal(connectTarget);
  if (!t || t.node !== node.id) return null;
  const frac = t.active ? (t.frac ?? 0.5) : null;
  const along = frac !== null && frac !== 0.5;
  const drop = along ? nodePort(node, t.nearest, frac) : null;
  return (
    <>
      {nodePorts(node).map(({ side, point }) => (
        <div
          key={side}
          className="fm-port-target"
          data-port-target={side}
          data-nearest={t.nearest === side ? 'true' : undefined}
          data-active={t.nearest === side && t.active && !along ? 'true' : undefined}
          style={{ left: point[0] - node.x, top: point[1] - node.y }}
        />
      ))}
      {nodePorts(node).flatMap(({ side }) => TICKS.map((at) => {
        const [x, y] = nodePort(node, side, at);
        return (
          <div
            key={`${side}:${at}`}
            className="fm-port-tick"
            data-port-tick={side}
            data-at={at}
            data-active={along && t.nearest === side && frac === at ? 'true' : undefined}
            style={{ left: x - node.x, top: y - node.y }}
          />
        );
      }))}
      {drop ? (
        <div
          className="fm-port-drop"
          data-port-drop=""
          data-side={t.nearest}
          data-at={frac!}
          style={{ left: drop[0] - node.x, top: drop[1] - node.y }}
        />
      ) : null}
    </>
  );
}
