// UI6: the shape palette. Three ways to add a block: click a shape then click in a lane; select a lane then click a
// shape; or drag a shape into a lane (lands pinned where dropped). Each new block opens in label editing.
// In a diagram without lanes (amendment A4), a click adds the block at once (unlaned, placed by the layout) and a drag
// adds it pinned wherever it is dropped on the canvas.
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { nodeSize } from '../../core/measure';
import { NEW_BLOCK_LABELS } from '../../core/ops';
import { isLaneFree, SHAPE_KINDS, UNASSIGNED, type ShapeKind } from '../../core/types';
import { addBlock, addBlockAt, laneFreeNow } from '../actions';
import { Shape } from '../canvas/Shape';
import { toWorld } from '../canvas/viewport';
import { useStore, useStoreState } from '../store/hooks';

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

/** A small picture of a shape, drawn with the same geometry as the canvas. */
export function ShapeIcon({ kind, width = 30, height = 20 }: { kind: ShapeKind; width?: number; height?: number }) {
  const W = 60;
  const H = 40;
  return (
    <svg width={width} height={height} viewBox={`-2 -2 ${W + 4} ${H + 4}`} aria-hidden="true" className="fm-shape-icon">
      <Shape kind={kind} width={W} height={H} nonScaling paint={{ fill: 'var(--icon-fill)', stroke: 'currentColor', strokeWidth: 1.6, dasharray: null }} />
    </svg>
  );
}

interface Ghost {
  kind: ShapeKind;
  x: number;
  y: number;
  overCanvas: boolean;
}

export function Palette() {
  const store = useStore();
  const tool = useStoreState((s) => s.tool);
  const editableNow = useStoreState((s) => s.status === 'ready' && !!s.derived && !s.derived.readOnly && !!s.shown?.layout);
  const zoom = useStoreState((s) => s.viewport.zoom);
  const theme = useStoreState((s) => s.theme);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const press = useRef<{ kind: ShapeKind; x: number; y: number; id: number; dragging: boolean } | null>(null);

  const canvasEl = () => document.querySelector<HTMLElement>('[data-testid="canvas"]');

  const laneFree = useStoreState((s) => !!s.shown?.layout && isLaneFree(s.shown.layout.lanes));

  const click = (kind: ShapeKind) => {
    const s = store.getState();
    if (laneFreeNow(store)) {
      addBlock(store, kind, UNASSIGNED);
      return;
    }
    if (s.selection.lane) {
      addBlock(store, kind, s.selection.lane);
      return;
    }
    store.setTool(s.tool.kind === 'place' && s.tool.shape === kind ? { kind: 'select' } : { kind: 'place', shape: kind });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>, kind: ShapeKind) => {
    if (e.button !== 0 || !editableNow) return;
    press.current = { kind, x: e.clientX, y: e.clientY, id: e.pointerId, dragging: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4) return;
    p.dragging = true;
    const c = canvasEl()?.getBoundingClientRect();
    const over = !!c && e.clientX >= c.left && e.clientX <= c.right && e.clientY >= c.top && e.clientY <= c.bottom;
    setGhost({ kind: p.kind, x: e.clientX, y: e.clientY, overCanvas: over });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    setGhost(null);
    if (!p.dragging) {
      click(p.kind);
      return;
    }
    const el = canvasEl();
    const c = el?.getBoundingClientRect();
    if (!c || e.clientX < c.left || e.clientX > c.right || e.clientY < c.top || e.clientY > c.bottom) return;
    const world = toWorld(store.getState().viewport, { x: e.clientX - c.left, y: e.clientY - c.top });
    addBlockAt(store, p.kind, world);
  };
  const onPointerCancel = () => {
    press.current = null;
    setGhost(null);
  };

  return (
    <div className="fm-palette" data-testid="palette" role="toolbar" aria-label="Shapes">
      {SHAPE_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          className={`fm-palette-btn${tool.kind === 'place' && tool.shape === kind ? ' fm-active' : ''}`}
          data-shape={kind}
          title={
            laneFree
              ? `${SHAPE_NAMES[kind]}: click to add (or drag onto the canvas)`
              : `${SHAPE_NAMES[kind]}: click, then click in a lane (or drag into a lane)`
          }
          aria-label={SHAPE_NAMES[kind]}
          disabled={!editableNow}
          onPointerDown={(e) => onPointerDown(e, kind)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onClick={(e) => {
            // Pointer clicks are handled on pointerup; this is the keyboard path (Enter/Space on the button).
            if (e.detail === 0) click(kind);
          }}
        >
          <ShapeIcon kind={kind} />
          <span className="fm-palette-label">{SHAPE_NAMES[kind]}</span>
        </button>
      ))}
      {ghost ? createPortal(<DragGhost ghost={ghost} zoom={zoom} theme={theme} />, document.body) : null}
    </div>
  );
}

function DragGhost({ ghost, zoom, theme }: { ghost: Ghost; zoom: number; theme: 'light' | 'dark' }) {
  const size = nodeSize(NEW_BLOCK_LABELS[ghost.kind], ghost.kind);
  const scale = ghost.overCanvas ? zoom : 0.6;
  const w = size.width * scale;
  const h = size.height * scale;
  return (
    <div className="fm-ghost" data-theme={theme} style={{ left: ghost.x - w / 2, top: ghost.y - h / 2, width: w, height: h }}>
      <svg width={w} height={h} viewBox={`0 0 ${size.width} ${size.height}`} overflow="visible">
        <Shape
          kind={ghost.kind}
          width={size.width}
          height={size.height}
          paint={{ fill: 'var(--ghost-fill)', stroke: 'var(--accent)', strokeWidth: 1.5, dasharray: '6 4' }}
        />
      </svg>
    </div>
  );
}
