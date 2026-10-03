// Shared shapes between core modules. Each module owns its internals; these are the seams.
// Section numbers refer to docs/design.md.

export type Direction = 'LR' | 'TB';

export const SHAPE_KINDS = [
  'step', 'decision', 'terminal', 'subprocess', 'database', 'io', 'document', 'delay',
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

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
  /** A19: the groups (subgraphs inside lanes), in file order, a group before those inside it. Absent when none. */
  groups?: GraphGroup[];
}

/** A19: a group, a box inside its lane around the blocks declared in it (§3.1, §6 L13). */
export interface GraphGroup {
  id: string;
  label: string;
  /** The lane it is in. */
  lane: string;
  /** The group it is directly inside, or null when it is directly in its lane. */
  parent: string | null;
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
  /** A19: the innermost group it is declared in; absent when it is directly in its lane (or unlaned). */
  group?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string | null;
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
 * A node's pin (§5): a `Pin`, plus (A19) the group the node was in when pinned, absent for a node directly in its
 * lane. The pin applies only while both the lane and the group still match the `.mmd`.
 */
export interface NodePin extends Pin {
  group?: string;
}

/**
 * One `nodes` entry of the layout file (§5), exactly as in the JSON: a pin (`lane`, `along`, `across`, all three or
 * none, plus A19's optional `group` with them), a size (`width`, `height`, both or none), or both; never empty.
 * `pinOf` and `sizeOf` read the two halves.
 */
export interface LayoutNodeEntry extends Partial<NodePin>, Partial<Size> {}

/** The pin half of a `nodes` entry, or null when it has none. */
export function pinOf(entry: LayoutNodeEntry | undefined): NodePin | null {
  if (!entry || entry.lane === undefined || entry.along === undefined || entry.across === undefined) return null;
  const pin: NodePin = { lane: entry.lane, along: entry.along, across: entry.across };
  if (entry.group !== undefined) pin.group = entry.group;
  return pin;
}

/** A19: whether a node pin still applies to a node in this lane and group (`group` undefined: directly in the lane). */
export function pinMatches(pin: NodePin, lane: string, group: string | undefined | null): boolean {
  return pin.lane === lane && (pin.group ?? null) === (group ?? null);
}

/** The size half of a `nodes` entry, or null when it has none. */
export function sizeOf(entry: LayoutNodeEntry | undefined): Size | null {
  if (!entry || entry.width === undefined || entry.height === undefined) return null;
  return { width: entry.width, height: entry.height };
}

/** One `edges` entry of the layout file (§5 v1.1), keyed by edge id; never empty. */
export interface LayoutEdgeEntry {
  source_side?: Side;
  target_side?: Side;
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
  points: [number, number][]; label_pos: [number, number] | null;
  /** v1.1: drawn through its bend points (§6 L11). */
  manual: boolean;
  /** v1.1: the sides actually used, stored or chosen by the layout. */
  source_side: Side;
  target_side: Side;
}

/** A19: a group's box in the layout JSON (§7). */
export interface LayoutGroupBox {
  id: string;
  label: string;
  lane: string;
  /** The enclosing group, or null for one directly in its lane. */
  parent: string | null;
  x: number; y: number; width: number; height: number;
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
    id: string; lane: string;
    /** A19: the node's group; present only when it is in one. */
    group?: string;
    kind: ShapeKind; label: string;
    x: number; y: number; width: number; height: number; pinned: boolean;
  }[];
  /** A19: every group's box, in file order (a group before those inside it). Present only when the diagram has groups. */
  groups?: LayoutGroupBox[];
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
