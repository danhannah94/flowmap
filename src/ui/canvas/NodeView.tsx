// One block on the canvas. The element's box is exactly the layout box (`data-x/y/width/height`, U9); the label is
// wrapped with the shared `wrapLabel` inside the shape's `textArea`, in Inter 13/18, as the layout measured it (U10).
import { Fragment, memo } from 'react';
import { badgeBox, textArea, wrapLabel } from '../../core/measure';
import type { ResolvedNodeStyle } from '../../core/theme';
import type { Direction } from '../../core/types';
import { followLink } from '../links';
import { useStore } from '../store/hooks';
import { labelPieces, type LayoutNode } from './geometry';
import { PortHandles } from './ports';
import { ResizeHandles } from './ResizeHandles';
import { OutlineOnly, Shape } from './Shape';

interface Props {
  node: LayoutNode;
  style: ResolvedNodeStyle;
  direction: Direction;
  selected: boolean;
  /** Offset while being dragged (world px), or 0. */
  dx: number;
  dy: number;
  dragging: boolean;
  /** Hide the label while its in-place editor is open. */
  editing: boolean;
  /** v1.1: the block has a stored size (`data-sized`, §8.3). */
  sized?: boolean;
  /** v1.1 UI34: show the resize handles (the one selected block, when resizing is allowed). */
  resizable?: boolean;
  /** A15: the block's link target (§4 `link`), or null. Draws the corner badge; Cmd/Ctrl+click (gestures.ts) also
   *  follows it. */
  link?: string | null;
}

export const NodeView = memo(function NodeView({
  node, style, direction, selected, dx, dy, dragging, editing, sized = false, resizable = false, link = null,
}: Props) {
  const area = textArea(node.kind, node.width, node.height);
  const lines = wrapLabel(node.label, area.width);
  const pieces = labelPieces(node.label, lines);
  const paint = { fill: style.fill, stroke: style.stroke, strokeWidth: style.strokeWidth, dasharray: style.dasharray };
  const moved = dx !== 0 || dy !== 0;
  return (
    <div
      className="fm-node"
      data-node-id={node.id}
      data-kind={node.kind}
      data-lane={node.lane}
      data-pinned={node.pinned ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      data-x={node.x}
      data-y={node.y}
      data-width={node.width}
      data-height={node.height}
      data-sized={sized ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : undefined}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        transform: moved ? `translate(${dx}px, ${dy}px)` : undefined,
      }}
    >
      <svg className="fm-node-svg" width={node.width} height={node.height} aria-hidden="true">
        {selected && (
          <OutlineOnly
            kind={node.kind}
            width={node.width}
            height={node.height}
            className="fm-node-halo"
            paint={{ fill: 'none', stroke: 'currentColor', strokeWidth: style.strokeWidth + 6, dasharray: null }}
          />
        )}
        <Shape kind={node.kind} width={node.width} height={node.height} paint={paint} />
      </svg>
      {resizable ? <ResizeHandles node={node} /> : null}
      <div
        className="fm-node-text"
        style={{ left: area.x, top: area.y, width: area.width, height: area.height, visibility: editing ? 'hidden' : undefined }}
      >
        <div
          data-role="label"
          className="fm-label"
          style={{
            color: style.textColor,
            fontStyle: style.fontStyle,
            fontWeight: style.fontWeight === 'bold' ? 700 : 400,
          }}
        >
          {pieces.map((p, i) => (
            <Fragment key={i}>
              {p.sep}
              <span className="fm-line">{p.text}</span>
            </Fragment>
          ))}
        </div>
      </div>
      {style.badge ? <Badge node={node} text={style.badge} /> : null}
      {node.pinned ? <div className="fm-pin" title="Pinned" aria-hidden="true" /> : null}
      {link ? <LinkBadge target={link} /> : null}
      {/* v1.1 UI38: four connection handles (top, right, bottom, left) and, while a line is dragged over, its connection points */}
      <PortHandles node={node} />
    </div>
  );
});

/** The style badge: a tag on the top edge, clear of the label's text area (`badgeBox`, shared with the SVG export). */
function Badge({ node, text }: { node: LayoutNode; text: string }) {
  const b = badgeBox(node.kind, node.width, node.height, text);
  return (
    <div className="fm-badge" data-role="badge" style={{ left: b.x, top: b.y, width: b.width, height: b.height }}>
      {text}
    </div>
  );
}

/**
 * A15: the small link icon in the block's corner. Rendered as a native `<button>` so `gestures.ts`'s hit-test
 * classifies it as a `control` (the same rule buttons and inputs already get) and a plain click never starts a
 * selection or drag gesture; its own `onClick` follows the link. Hovering shows the target as its title.
 */
function LinkBadge({ target }: { target: string }) {
  const store = useStore();
  return (
    <button
      type="button"
      className="fm-link-badge"
      data-testid="link-badge"
      data-link-target={target}
      title={target}
      aria-label={`Open linked diagram: ${target}`}
      onClick={(e) => {
        e.stopPropagation();
        followLink(store, target);
      }}
    >
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
        <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
      </svg>
    </button>
  );
}
