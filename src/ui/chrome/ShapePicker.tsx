// UI7: the shape picker (`data-testid="shape-picker"`, one option per shape with `data-shape`), shown while exactly one
// block is selected. It is a small contextual bar docked at the top of the canvas (so it never covers blocks the way a
// popover next to the block could); the block's current shape is pressed. Its id chip opens the id editor (UI9).
// The actions come in as props (commands/blocks.ts mounts it), so this file doesn't import the commands.
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
  if (!id || !kind || !wrap) return null;
  return createPortal(
    <div className="fm-picker" data-testid="shape-picker" role="toolbar" aria-label="Block shape">
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
