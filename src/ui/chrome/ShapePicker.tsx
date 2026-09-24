// UI7: the shape picker (`data-testid="shape-picker"`, one option per shape with `data-shape`), shown while exactly one
// block is selected. It is a small contextual bar docked at the top of the canvas, or at the bottom when the selected
// block sits under the top spot (so it never covers the block it edits, and a double-click's second press still
// lands on the block); the block's current shape is pressed. Its id chip opens the id editor (UI9).
// The actions come in as props (commands/blocks.ts mounts it), so this file doesn't import the commands.
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SHAPE_KINDS, type ShapeKind } from '../../core/types';
import { useCanvasWrap } from '../canvas/connect';
import { editable } from '../commands/types';
import { useStore, useStoreState } from '../store/hooks';
import type { Store } from '../store/store';
import { ShapeIcon } from './Palette';
import '../blocks.css';

const SHAPE_NAMES: Record<ShapeKind, string> = {
  step: 'Step',
  decision: 'Decision',
  terminal: 'Start / end',
  subprocess: 'Subprocess',
  database: 'System / data',
  io: 'Input / output',
  document: 'Document',
  delay: 'Wait',
};

/** The picker's distance from the canvas edge it docks to, and the clearance it keeps around the selected block. */
const DOCK = 12;
const GAP = 8;

export interface ShapePickerProps {
  onShape: (store: Store, id: string, shape: ShapeKind) => void;
  onRename: (store: Store, id: string) => void;
}

export function ShapePicker({ onShape, onRename }: ShapePickerProps) {
  const store = useStore();
  const wrap = useCanvasWrap();
  const id = useStoreState((s) => (s.selection.nodes.length === 1 && !s.drag ? s.selection.nodes[0]! : null));
  const kind = useStoreState((s) => (id ? s.shown?.layout?.nodes.find((n) => n.id === id)?.kind ?? null : null));
  const canEdit = useStoreState(editable);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 460, height: 42 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && (el.offsetWidth !== size.width || el.offsetHeight !== size.height)) setSize({ width: el.offsetWidth, height: el.offsetHeight });
  });
  const atBottom = useStoreState((s) => {
    const n = id ? s.shown?.layout?.nodes.find((x) => x.id === id) : undefined;
    if (!n) return false;
    const { viewport: v, viewportSize: c } = s;
    const left = n.x * v.zoom + v.x;
    const top = n.y * v.zoom + v.y;
    const right = left + n.width * v.zoom;
    const bottom = top + n.height * v.zoom;
    const overlaps = (y0: number, y1: number) =>
      right > (c.width - size.width) / 2 - GAP && left < (c.width + size.width) / 2 + GAP && bottom > y0 && top < y1;
    const topBand = [0, DOCK + size.height + GAP] as const;
    const bottomBand = [c.height - DOCK - size.height - GAP, c.height] as const;
    return overlaps(...topBand) && !overlaps(...bottomBand);
  });
  if (!id || !kind || !wrap) return null;
  return createPortal(
    <div
      ref={ref}
      className={`fm-picker${atBottom ? ' fm-picker-bottom' : ''}`}
      data-testid="shape-picker"
      role="toolbar"
      aria-label="Block shape"
    >
      {SHAPE_KINDS.map((k) => (
        <button
          key={k}
          type="button"
          className="fm-picker-shape"
          data-shape={k}
          aria-pressed={k === kind}
          aria-label={SHAPE_NAMES[k]}
          title={k === kind ? `${SHAPE_NAMES[k]} (current shape)` : `Change to ${SHAPE_NAMES[k].toLowerCase()}`}
          disabled={!canEdit}
          onClick={() => onShape(store, id, k)}
        >
          <ShapeIcon kind={k} width={26} height={18} />
        </button>
      ))}
      <span className="fm-picker-sep" aria-hidden="true" />
      <button
        type="button"
        className="fm-picker-id"
        title="Rename this block’s id (F2)"
        aria-label={`Rename id ${id}`}
        disabled={!canEdit}
        onClick={() => onRename(store, id)}
      >
        <span className="fm-picker-id-text">{id}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 20h4L19 9l-4-4L4 16v4z" />
          <path d="M13.5 6.5l4 4" />
        </svg>
      </button>
    </div>,
    wrap,
  );
}
