// Pure geometry for the eight node shapes (design.md §3.1), given a box (x, y, width, height).
// Framework-free: the SVG renderer (src/core/svg) and the web UI's canvas both draw nodes from this
// module, so a shape looks identical everywhere. No fs, no DOM, no colour — geometry only.
//
// The exact parameters below (bar inset, cylinder cap height, parallelogram skew, wave amplitude,
// round-end radius) are not free choices: they must match measure.ts's SHAPE_GEOMETRY and its
// textArea()/outlineInset() model exactly, or a label could be sized for one shape and drawn inside
// a visually different one, and the layout module's edge endpoints would miss the drawn boundary.
// Importing the shared constants (rather than redeclaring them) keeps the two in lockstep.
import type { ShapeKind, Side } from './types';
import { outlineInset, roundRadius, SHAPE_GEOMETRY } from './measure';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RectShape {
  tag: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  ry: number;
}

export interface PolygonShape {
  tag: 'polygon';
  /** "x1,y1 x2,y2 ..." — ready for an SVG `points` attribute. */
  points: string;
}

export interface PathShape {
  tag: 'path';
  /** Ready for an SVG `d` attribute. */
  d: string;
}

export interface EllipseShape {
  tag: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** What design.md §7.1 calls a node's "first shape child": it carries fill/stroke/dash presentation attributes. */
export type OutlineShape = RectShape | PolygonShape | PathShape;

/** A decoration drawn after the outline (subprocess bars, the cylinder's lid ellipse). Stroke only, no fill. */
export type DecorationShape = PathShape | EllipseShape | RectShape;

export interface ShapeGeometry {
  outline: OutlineShape;
  decorations: DecorationShape[];
}

function n(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function pt(x: number, y: number): string {
  return `${n(x)},${n(y)}`;
}

// --- step: rectangle --------------------------------------------------------------------------

export function stepShape(box: Box): ShapeGeometry {
  return {
    outline: { tag: 'rect', x: n(box.x), y: n(box.y), width: n(box.width), height: n(box.height), rx: 0, ry: 0 },
    decorations: [],
  };
}

// --- decision: diamond -------------------------------------------------------------------------

export function decisionShape(box: Box): ShapeGeometry {
  const { x, y, width, height } = box;
  const points = [
    pt(x + width / 2, y),
    pt(x + width, y + height / 2),
    pt(x + width / 2, y + height),
    pt(x, y + height / 2),
  ].join(' ');
  return { outline: { tag: 'polygon', points }, decorations: [] };
}

// --- terminal: stadium (start/end) ------------------------------------------------------------

export function terminalShape(box: Box): ShapeGeometry {
  const { x, y, width, height } = box;
  const r = roundRadius(height); // stadium corner radius = min(H/2, ROUND_MAX) (measure.ts's shape-geometry contract)
  return {
    outline: { tag: 'rect', x: n(x), y: n(y), width: n(width), height: n(height), rx: n(r), ry: n(r) },
    decorations: [],
  };
}

// --- subprocess: rectangle with side bars -----------------------------------------------------

export function subprocessShape(box: Box): ShapeGeometry {
  const { x, y, width, height } = box;
  const inset = SHAPE_GEOMETRY.subprocessBar;
  const decorations: DecorationShape[] = [
    { tag: 'path', d: `M ${pt(x + inset, y)} L ${pt(x + inset, y + height)}` },
    { tag: 'path', d: `M ${pt(x + width - inset, y)} L ${pt(x + width - inset, y + height)}` },
  ];
  return {
    outline: { tag: 'rect', x: n(x), y: n(y), width: n(width), height: n(height), rx: 0, ry: 0 },
    decorations,
  };
}

// --- database: cylinder ------------------------------------------------------------------------

export function databaseShape(box: Box): ShapeGeometry {
  const { x, y, width, height } = box;
  const rx = width / 2;
  const ry = SHAPE_GEOMETRY.databaseRy;
  const d = [
    `M ${pt(x, y + ry)}`,
    `A ${n(rx)} ${n(ry)} 0 0 0 ${pt(x + width, y + ry)}`,
    `L ${pt(x + width, y + height - ry)}`,
    `A ${n(rx)} ${n(ry)} 0 0 1 ${pt(x, y + height - ry)}`,
    'Z',
  ].join(' ');
  const decorations: DecorationShape[] = [
    { tag: 'ellipse', cx: n(x + width / 2), cy: n(y + ry), rx: n(rx), ry: n(ry) },
  ];
  return { outline: { tag: 'path', d }, decorations };
}

// --- io: parallelogram -------------------------------------------------------------------------

export function ioShape(box: Box): ShapeGeometry {
  const { x, y, width, height } = box;
  const skew = SHAPE_GEOMETRY.ioSkew;
  const points = [
    pt(x + skew, y),
    pt(x + width, y),
    pt(x + width - skew, y + height),
    pt(x, y + height),
  ].join(' ');
  return { outline: { tag: 'polygon', points }, decorations: [] };
}

// --- document: rectangle with a wavy bottom ----------------------------------------------------

/** Points sampled along the wave for one full period; smooth enough at every node size in practice. */
const DOCUMENT_WAVE_SEGMENTS = 24;

export function documentShape(box: Box): ShapeGeometry {
  const { x, y, width, height } = box;
  const wave = SHAPE_GEOMETRY.documentWave;
  // Bottom edge: y = H - WAVE + WAVE*sin(2*pi*x/W) (measure.ts's shape-geometry contract), sampled
  // right to left so the path continues naturally from the straight top and right edges.
  const commands = [`M ${pt(x, y)}`, `L ${pt(x + width, y)}`];
  for (let i = DOCUMENT_WAVE_SEGMENTS; i >= 0; i--) {
    const px = (width * i) / DOCUMENT_WAVE_SEGMENTS;
    const py = height - wave + wave * Math.sin((2 * Math.PI * px) / width);
    commands.push(`L ${pt(x + px, y + py)}`);
  }
  commands.push('Z');
  return { outline: { tag: 'path', d: commands.join(' ') }, decorations: [] };
}

// --- delay: half-rounded rectangle --------------------------------------------------------------

export function delayShape(box: Box): ShapeGeometry {
  const { x, y, width, height } = box;
  const r = roundRadius(height); // right end rounded with radius min(H/2, ROUND_MAX) (measure.ts's shape-geometry contract)
  const d = [
    `M ${pt(x, y)}`,
    `L ${pt(x + width - r, y)}`,
    `A ${n(r)} ${n(r)} 0 0 1 ${pt(x + width, y + r)}`,
    `L ${pt(x + width, y + height - r)}`,
    `A ${n(r)} ${n(r)} 0 0 1 ${pt(x + width - r, y + height)}`,
    `L ${pt(x, y + height)}`,
    'Z',
  ].join(' ');
  return { outline: { tag: 'path', d }, decorations: [] };
}

/** Dispatch by shape kind (design.md §3.1). The one entry point the renderer and the UI canvas share. */
export function shapeGeometry(kind: ShapeKind, box: Box): ShapeGeometry {
  switch (kind) {
    case 'step':
      return stepShape(box);
    case 'decision':
      return decisionShape(box);
    case 'terminal':
      return terminalShape(box);
    case 'subprocess':
      return subprocessShape(box);
    case 'database':
      return databaseShape(box);
    case 'io':
      return ioShape(box);
    case 'document':
      return documentShape(box);
    case 'delay':
      return delayShape(box);
    default: {
      const exhaustive: never = kind;
      throw new Error(`shapes.shapeGeometry: unknown shape kind ${String(exhaustive)}`);
    }
  }
}

// --- ports (v1.1 §6 L12) -------------------------------------------------------------------------

/** A port is never deeper inside the box than this (§6 L12). */
export const PORT_MAX_INSET = 20;

/**
 * How far inside the box a side's port is: where the drawn outline crosses the side's midline (the centre line
 * `floor(size / 2)`, as UI39 counts centre lines). 0 on a straight side and at a diamond's vertex; the parallelogram's
 * slanted sides (half the skew), the document's wavy bottom (the wave's amplitude) and round ends narrower than
 * their radius sit inside. Rounded to a whole pixel, at most PORT_MAX_INSET.
 */
export function portInset(kind: ShapeKind, width: number, height: number, side: Side): number {
  // A diamond's port is its vertex, even when an odd size puts the vertex half a pixel off the whole-pixel midline
  // (where the face would already be a few pixels in on a wide, flat diamond).
  if (kind === 'decision') return 0;
  const t = side === 'top' || side === 'bottom' ? Math.floor(width / 2) : Math.floor(height / 2);
  return Math.min(PORT_MAX_INSET, Math.max(0, Math.round(outlineInset(kind, width, height, side, t))));
}

/**
 * The port of one side of a block (§6 L12), in the box's coordinates: on the side's midline, on the drawn outline.
 * Diamonds have theirs at their four vertices. Integers when the box is.
 */
export function portPoint(kind: ShapeKind, box: Box, side: Side): [number, number] {
  const inset = portInset(kind, box.width, box.height, side);
  const cx = box.x + Math.floor(box.width / 2);
  const cy = box.y + Math.floor(box.height / 2);
  switch (side) {
    case 'top':
      return [cx, box.y + inset];
    case 'bottom':
      return [cx, box.y + box.height - inset];
    case 'left':
      return [box.x + inset, cy];
    case 'right':
      return [box.x + box.width - inset, cy];
  }
}
