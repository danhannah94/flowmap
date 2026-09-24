// Shared shapes between core modules. Each module owns its internals; these are the seams.
// Section numbers refer to docs/design.md.

export type Direction = 'LR' | 'TB';

export const SHAPE_KINDS = [
  'step', 'decision', 'terminal', 'subprocess', 'database', 'io', 'document', 'delay',
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const UNASSIGNED = '_unassigned';

/** A problem found in one of the three files (§7). `line` is a 1-based .mmd line, or null for config/layout. */
export interface Problem {
  code: string;
  line: number | null;
  message: string;
}

export interface Problems {
  errors: Problem[];
  warnings: Problem[];
}

/** The diagram as the layout, renderer and UI see it: resolved lanes, derived edge ids (§3.4). */
export interface Graph {
  direction: Direction;
  /** Display order (§4 lanes, then file order), with `_unassigned` last only when a node has no lane (§7). */
  lanes: GraphLane[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphLane {
  id: string;
  label: string;
}

export interface GraphNode {
  id: string;
  label: string;
  /** Shape kind (§3.1). The effective kind for style matching lives in the config module. */
  kind: ShapeKind;
  /** Lane id, or `_unassigned`. */
  lane: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string | null;
}

/** One pin from the .layout.json file (§5). */
export interface Pin {
  lane: string;
  along: number;
  across: number;
}

export interface LayoutFile {
  version: 1;
  nodes: Record<string, Pin>;
  /** Builder-defined layout-stability hints (§5). Opaque outside the layout module. */
  hints?: unknown;
}

/** `flowmap layout --json` output (§7). All numbers are integers. */
export interface LayoutResult {
  direction: Direction;
  width: number;
  height: number;
  lanes: { id: string; label: string; x: number; y: number; width: number; height: number }[];
  nodes: {
    id: string; lane: string; kind: ShapeKind; label: string;
    x: number; y: number; width: number; height: number; pinned: boolean;
  }[];
  edges: {
    id: string; source: string; target: string; label: string | null;
    points: [number, number][]; label_pos: [number, number] | null;
  }[];
}

/** A colour as written in the config: one value, or per theme (§4). */
export type ThemedColor = string | { light?: string; dark?: string };

/** Style properties after rules are applied to one node (§4). Absent = theme default. */
export interface ResolvedStyle {
  fill?: ThemedColor;
  border_color?: ThemedColor;
  text_color?: ThemedColor;
  border_style?: 'solid' | 'dashed' | 'dotted';
  border_width?: number;
  font_style?: 'normal' | 'italic' | 'bold';
  badge?: string;
}

export interface LegendItem {
  text: string;
  style: ResolvedStyle;
}
