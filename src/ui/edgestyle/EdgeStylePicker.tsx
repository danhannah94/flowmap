// A18 / UI44: the line style picker (`data-testid="edge-style-picker"`, one option per style with `data-edge-style`),
// shown while one or more lines are selected and no block is. It is the sibling of the shape picker (UI7): a small
// contextual bar docked at the top of the canvas, or at the bottom when the selected lines run under the top spot, so
// it never covers the line it edits. The style every selected line has is pressed.
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EDGE_STYLES, type EdgeStyle } from '../../core/types';
import { useCanvasWrap } from '../canvas/connect';
import { editable } from '../commands/types';
import { shallow, useStore, useStoreState } from '../store/hooks';
import type { Store } from '../store/store';
import '../blocks.css';
import './edgestyle.css';
import { EDGE_STYLE_HINTS, EDGE_STYLE_NAMES, EdgeStyleIcon } from './EdgeStyleIcon';

const NONE: readonly string[] = [];
const DOCK = 12;
const GAP = 8;

/** The style all of `styles` share, or null when they differ (or there are none). */
export function commonStyle(styles: readonly EdgeStyle[]): EdgeStyle | null {
  return styles.length > 0 && styles.every((s) => s === styles[0]) ? styles[0]! : null;
}

export function EdgeStylePicker({ onStyle }: { onStyle: (store: Store, ids: readonly string[], style: EdgeStyle) => void }) {
  const store = useStore();
  const wrap = useCanvasWrap();
  const ids = useStoreState((s) => (s.selection.nodes.length === 0 && !s.drag ? s.selection.edges : NONE), shallow);
  const current = useStoreState((s) => {
    const edges = s.shown?.layout?.edges ?? [];
    return commonStyle(ids.map((id) => edges.find((e) => e.id === id)?.style ?? 'solid'));
  });
  const exists = useStoreState((s) => ids.length > 0 && ids.every((id) => s.shown?.layout?.edges.some((e) => e.id === id)));
  const canEdit = useStoreState(editable);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 190, height: 42 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && (el.offsetWidth !== size.width || el.offsetHeight !== size.height)) setSize({ width: el.offsetWidth, height: el.offsetHeight });
  });
  // Dock at the bottom when a selected line passes under the bar's top spot.
  const atBottom = useStoreState((s) => {
    const { viewport: v, viewportSize: c } = s;
    const left = (c.width - size.width) / 2 - GAP;
    const right = (c.width + size.width) / 2 + GAP;
    const bottomOfTop = DOCK + size.height + GAP;
    const under = (edge: { points: [number, number][] }, y0: number, y1: number) => edge.points.some(([x, y]) => {
      const sx = x * v.zoom + v.x;
      const sy = y * v.zoom + v.y;
      return sx > left && sx < right && sy > y0 && sy < y1;
    });
    const picked = (s.shown?.layout?.edges ?? []).filter((e) => ids.includes(e.id));
    const topHit = picked.some((e) => under(e, 0, bottomOfTop));
    const bottomHit = picked.some((e) => under(e, c.height - bottomOfTop, c.height));
    return topHit && !bottomHit;
  });
  if (ids.length === 0 || !exists || !wrap) return null;
  return createPortal(
    <div
      ref={ref}
      className={`fm-picker fm-edge-style-picker${atBottom ? ' fm-picker-bottom' : ''}`}
      data-testid="edge-style-picker"
      role="toolbar"
      aria-label="Line style"
    >
      {EDGE_STYLES.map((style) => (
        <button
          key={style}
          type="button"
          className="fm-picker-shape fm-edge-style-option"
          data-edge-style={style}
          aria-pressed={style === current}
          aria-label={EDGE_STYLE_NAMES[style]}
          title={EDGE_STYLE_HINTS[style]}
          disabled={!canEdit}
          onClick={() => {
            if (style !== current) onStyle(store, ids, style);
          }}
        >
          <EdgeStyleIcon style={style} />
        </button>
      ))}
    </div>,
    wrap,
  );
}
