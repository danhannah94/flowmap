// The parsed `.mmd` model (design.md §3). It holds everything canonical form (§3.3) needs and nothing it doesn't, so
// `format(parse(x))` is a pure function of this structure. It is plain data (no classes, no cycles): edit operations
// copy it (`structuredClone` works) and change the copy.
//
// The structure mirrors canonical form: unlaned declarations, then lanes (each holding its own declarations), then
// edges, then pass-through lines. Every order below is the order canonical form writes.

import type { Direction, EdgeStyle, ShapeKind } from '../types';

/** A comment line as written, trimmed (`%% note`, `%%{init: …}%%`). Indentation is decided by the formatter. */
export type Comment = string;

export interface Diagram {
  /** From the header (`TD` is stored as `TB`). */
  direction: Direction;
  /** §3.3: comments before the header plus those directly after it. Written at column 0 under the header. */
  fileComment: Comment[];
  /** Nodes declared outside any subgraph, in order of first declaration. */
  unlaned: NodeDecl[];
  /** Subgraphs, in file order. */
  lanes: Lane[];
  /** Edges after chain and `&` expansion (§3.1), in file order. */
  edges: Edge[];
  /** `classDef`, `class`, `style`, `linkStyle`, `click` lines, in file order (§3.1, §3.3 step 6). */
  passThrough: PassThrough[];
  /** §3.3: comments after the last kept statement. Written at column 0 at the end of the file. */
  trailingComments: Comment[];
}

export interface Lane {
  id: string;
  /** Decoded label. A subgraph written without a label gets its id here (§3.1). */
  label: string;
  /** Comment block directly above the `subgraph` line; it stays there (§3.3). */
  comments: Comment[];
  /** Nodes first declared directly in this subgraph (not in one of its groups), in order of first declaration. */
  nodes: NodeDecl[];
  /**
   * A19: subgraphs nested inside this one (groups), in file order. Absent or empty when there are none; canonical form
   * writes them after `nodes`, one level deeper.
   */
  groups?: Group[];
  /** Comment block directly above `end`; written as the subgraph's last lines, after its declarations and groups (§3.3). */
  endComments: Comment[];
  /** 1-based source line of the `subgraph` line, when parsed from text. */
  line?: number;
}

/**
 * A19: a subgraph inside a lane or another group: a box inside its lane around the blocks declared in it. It has the
 * same shape as a lane (its own nodes, its own groups, comments); only where it sits differs.
 */
export type Group = Lane;

/** A lane or a group: anything a node can be declared in. */
export type Container = Lane;

export interface NodeDecl {
  id: string;
  shape: ShapeKind;
  /** Decoded label (`#quot;` is stored as `"`). */
  label: string;
  /** `:::className` suffix, or null. Never set on `document` or `delay` (§3.1). */
  className: string | null;
  /** Comment block that travels with this declaration (§3.3). */
  comments: Comment[];
  /** 1-based source line of the first declaration, when parsed from text. */
  line?: number;
}

export interface Edge {
  source: string;
  target: string;
  /** Decoded label, or null for none (an empty label is none, §3.1). */
  label: string | null;
  /** A18: the arrow form (`-->` solid, `-.->` dashed, `==>` thick, `<-->` bidirectional). Absent means `solid`. */
  style?: EdgeStyle;
  /** Comment block that travels with this edge (§3.3). */
  comments: Comment[];
  /** 1-based source line the edge was expanded from, when parsed from text. */
  line?: number;
}

export interface PassThrough {
  /** The line, trimmed, with a trailing `;` removed and otherwise unchanged (§3.3 step 6). */
  text: string;
  comments: Comment[];
  line?: number;
}

/** A node that is used in edges but never declared (§3.2): kind `step`, label = id, no lane. */
export interface UndeclaredNode {
  id: string;
  /** Line of its first mention (the first edge that uses it), when known. */
  line?: number;
}

/** An empty diagram, the starting point for building one in code. */
export function emptyDiagram(direction: Direction = 'LR'): Diagram {
  return { direction, fileComment: [], unlaned: [], lanes: [], edges: [], passThrough: [], trailingComments: [] };
}

/** A declared node, with its lane id (null = unlaned) and (A19) its group: the innermost group around it, or null. */
export interface DeclaredNode {
  node: NodeDecl;
  lane: string | null;
  group: string | null;
}

/**
 * Every declared node with its lane and group, in canonical order: unlaned first, then lanes in file order; inside a
 * subgraph, its own nodes before those of its groups (depth first, in file order).
 */
export function declaredNodes(d: Diagram): DeclaredNode[] {
  const out: DeclaredNode[] = d.unlaned.map((node) => ({ node, lane: null, group: null }));
  const walk = (c: Container, lane: string, group: string | null) => {
    for (const node of c.nodes) out.push({ node, lane, group });
    for (const g of c.groups ?? []) walk(g, lane, g.id);
  };
  for (const lane of d.lanes) walk(lane, lane.id, null);
  return out;
}

/** Find a declared node, the lane it's in (null = unlaned) and its group (null = none). */
export function findNode(d: Diagram, id: string): DeclaredNode | undefined {
  return declaredNodes(d).find((entry) => entry.node.id === id);
}

/** A19: a group as found in the diagram, with its lane and its parent group (null: directly in its lane). */
export interface GroupInfo {
  group: Group;
  lane: string;
  parent: string | null;
  /** 1 for a group directly in its lane, 2 inside that, and so on. */
  depth: number;
}

/** A19: every group, in file order (a group before the groups inside it). */
export function allGroups(d: Diagram): GroupInfo[] {
  const out: GroupInfo[] = [];
  const walk = (c: Container, lane: string, parent: string | null, depth: number) => {
    for (const g of c.groups ?? []) {
      out.push({ group: g, lane, parent, depth });
      walk(g, lane, g.id, depth + 1);
    }
  };
  for (const lane of d.lanes) walk(lane, lane.id, null, 1);
  return out;
}

/** A19: every subgraph id (lanes and groups), in file order. */
export function subgraphIds(d: Diagram): string[] {
  const out: string[] = [];
  for (const lane of d.lanes) {
    out.push(lane.id);
    for (const g of allGroups({ ...d, lanes: [lane] })) out.push(g.group.id);
  }
  return out;
}

/**
 * Nodes that appear in edges but are never declared, in order of first mention (§3.2). Derived from the edges, so it
 * stays right after edits (deleting a declaration whose node still has edges makes that node undeclared).
 */
export function undeclaredNodes(d: Diagram): UndeclaredNode[] {
  const declared = new Set(declaredNodes(d).map((entry) => entry.node.id));
  const seen = new Map<string, UndeclaredNode>();
  for (const edge of d.edges) {
    for (const id of [edge.source, edge.target]) {
      if (declared.has(id) || seen.has(id)) continue;
      seen.set(id, edge.line === undefined ? { id } : { id, line: edge.line });
    }
  }
  return [...seen.values()];
}

/**
 * Derived edge ids (§3.4): `<source>-><target>`, with `#2`, `#3`… on repeats of the same pair, in file order.
 * Returns one id per edge, index-aligned with `edges`.
 */
export function edgeIds(edges: readonly Pick<Edge, 'source' | 'target'>[]): string[] {
  const counts = new Map<string, number>();
  return edges.map((edge) => {
    const base = `${edge.source}->${edge.target}`;
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}
