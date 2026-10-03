// Shared shapes between core modules. Each module owns its internals; these are the seams.
// Section numbers refer to docs/design.md.

export type Direction = 'LR' | 'TB';

export const SHAPE_KINDS = [
  'step', 'decision', 'terminal', 'subprocess', 'database', 'io', 'document', 'delay',
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/**
 * Amendment A18: how an edge is drawn. `solid` is `-->` (the default and the only style older files have), `dashed` is
 * `-.->` (async, event, optional), `thick` is `==>` (critical path), `bidirectional` is `<-->` (arrowheads at both
 * ends). The style never changes where a line goes: the layout and router treat every style like `-->`.
 */
export const EDGE_STYLES = ['solid', 'dashed', 'thick', 'bidirectional'] as const;
export type EdgeStyle = (typeof EDGE_STYLES)[number];

export const UNASSIGNED = '_unassigned';

/**
 * Amendment A4: a diagram whose `.mmd` has no subgraphs is a plain flowchart. Every node sits in `_unassigned`, and
 * nothing draws a lane band or header for it (no room is reserved for a lane label either). Works on the graph's or
 * the layout's lane list (they list the same lanes).
 */
export function isLaneFree(lanes: readonly { id: string }[]): boolean {
  return lanes.every((l) => l.id === UNASSIGNED);
}

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
  /** A18: absent means `solid`. */
  style?: EdgeStyle;
}

/** One pin from the .layout.json file (§5). Bend points (v1.1) have the same form. */
export interface Pin {
  lane: string;
  along: number;
  across: number;
}

/** A block side (§5 v1.1): a line leaves or enters a block at the side's port (§6 L12). */
export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];

/** A block size a person chose by resizing (§5 v1.1): integers of at least 40. */
export interface Size {
  width: number;
  height: number;
}

/** A position in pixels (§5 v1.1 notes and title): the top-left corner, x horizontal and y vertical. */
export interface XY {
  x: number;
  y: number;
}

/**
 * One `nodes` entry of the layout file (§5), exactly as in the JSON: a pin (`lane`, `along`, `across`, all three or
 * none), a size (`width`, `height`, both or none), or both; never empty. `pinOf` and `sizeOf` read the two halves.
 */
export interface LayoutNodeEntry extends Partial<Pin>, Partial<Size> {}

/** The pin half of a `nodes` entry, or null when it has none. */
export function pinOf(entry: LayoutNodeEntry | undefined): Pin | null {
  if (!entry || entry.lane === undefined || entry.along === undefined || entry.across === undefined) return null;
  return { lane: entry.lane, along: entry.along, across: entry.across };
}

/** The size half of a `nodes` entry, or null when it has none. */
export function sizeOf(entry: LayoutNodeEntry | undefined): Size | null {
  if (!entry || entry.width === undefined || entry.height === undefined) return null;
  return { width: entry.width, height: entry.height };
}

/** One `edges` entry of the layout file (§5 v1.1), keyed by edge id; never empty. */
export interface LayoutEdgeEntry {
  source_side?: Side;
  /**
   * A22: where along `source_side` the line leaves, as a fraction of the side's length from its start (the left end of
   * a top or bottom side, the top end of a left or right side), 0 to 1 with at most two decimals. Absent: the side's
   * midline port (0.5). Only with `source_side`.
   */
  source_at?: number;
  target_side?: Side;
  /** A22: where along `target_side` the line arrives, as `source_at`. Only with `target_side`. */
  target_at?: number;
  /** Bend points from source to target, lane-relative like pins (`lane` may be `_unassigned`). Present = manual. */
  points?: Pin[];
  /** Where the label's centre sits along the drawn line, 0 to 1 (at most two decimals). */
  label_at?: number;
}

/**
 * One `lanes` entry of the layout file (A8), keyed by lane id (`_unassigned` included): the lane's size across the
 * flow as a person dragged it, measured from the lane's zero line to its far edge (§6 Frame: the band's thickness, less
 * the first lane's growth U). An integer of at least 100 (L1). The layout uses it as a minimum.
 */
export interface LayoutLaneEntry {
  size: number;
}

export interface LayoutFile {
  version: 1;
  nodes: Record<string, LayoutNodeEntry>;
  /** A8: stored lane sizes by lane id; absent when the file has none (an empty map is never written). */
  lanes?: Record<string, LayoutLaneEntry>;
  /**
   * A13: the lanes' shared length along the flow as a person dragged it (the pool's far edge: the right for `LR`, the
   * bottom for `TB`), measured from the flow axis's zero line (§6 Frame: the frame's length less T), so a block
   * dropped before the flow start doesn't move the far edge on screen. An integer of at least 100; the layout uses it
   * as a minimum. Absent when not set.
   */
  lane_length?: number;
  /**
   * A22: spread the line ends that share a side evenly along it (`true`), instead of meeting at the side's midline
   * port. Absent (or `false`) by default; the UI writes the default by removing the key.
   */
  spread_ends?: boolean;
  /** v1.1: absent when the file has none (an empty map is never written). */
  edges?: Record<string, LayoutEdgeEntry>;
  /** v1.1: note positions by note id. */
  notes?: Record<string, XY>;
  /** v1.1: the title's position. */
  title?: XY;
  /** Builder-defined layout-stability hints (§5). Opaque outside the layout module. */
  hints?: unknown;
}

/** A note from the config (§4 v1.1), with defaults applied (`font_size` 14, `bold` false); bad properties dropped. */
export interface NoteInput {
  id: string;
  text: string;
  font_size: number;
  bold: boolean;
  /** Absent: the theme's text colour. Only the SVG and UI read it; the layout doesn't. */
  color?: ThemedColor;
}

/**
 * Everything the layout function reads (§6). `file` is the parsed layout file, or null when there is none or it has
 * errors (then nothing in it applies). Entries for unknown ids, stale pins and point sets with a missing lane are
 * ignored by the layout itself.
 * - `notes`: the config's notes in config order. Omitted: the result has no `notes` (a v1.0-style caller).
 * - `title`: the shown title's text, or null when hidden (`show_title: false`). Omitted: the result has no `title`.
 */
export interface LayoutInput {
  graph: Graph;
  file: LayoutFile | null;
  notes?: NoteInput[];
  title?: string | null;
}

export interface LayoutResultEdge {
  id: string; source: string; target: string; label: string | null;
  /** A18: how the line is drawn; left out when `solid`, so a diagram that uses only `-->` has the same output as before. */
  style?: EdgeStyle;
  points: [number, number][]; label_pos: [number, number] | null;
  /** v1.1: drawn through its bend points (§6 L11). */
  manual: boolean;
  /** v1.1: the sides actually used, stored or chosen by the layout. */
  source_side: Side;
  target_side: Side;
  /**
   * A22: where along its side an end is attached, when the layout file says: its stored `source_at`, or (with
   * `spread_ends`) its spread position when that isn't 0.5. Absent otherwise (the midline port, or an automatic end
   * spread on its side as v1.1 does).
   */
  source_at?: number;
  target_at?: number;
}

/** A note or title box in diagram coordinates (x and y may be negative). */
export interface LayoutTextBox {
  text: string;
  x: number; y: number; width: number; height: number;
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
  edges: LayoutResultEdge[];
  /** v1.1: every note, in config order. Present whenever the caller passed `notes`. */
  notes?: ({ id: string } & LayoutTextBox)[];
  /** v1.1: the title's box, or null when hidden. Present whenever the caller passed `title`. */
  title?: LayoutTextBox | null;
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
