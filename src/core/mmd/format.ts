// Canonical form (design.md §3.3): what `flowmap fmt` and every UI write produce. A pure function of the model, so
// `format(parse(format(parse(x)))) === format(parse(x))` holds as long as parse reads canonical form back into the
// same model.

import type { Comment, Diagram, Edge, Lane, NodeDecl } from './model';
import { canWriteUnquoted, encodeLabel } from './syntax';
import type { ShapeKind } from '../types';

const NODE_INDENT_UNLANED = '  ';
const NODE_INDENT_LANED = '    ';
const STATEMENT_INDENT = '  ';

/** Bracket pairs for the six bracket shapes (§3.1). `document` and `delay` use `@{…}`. */
const BRACKETS: Record<Exclude<ShapeKind, 'document' | 'delay'>, [string, string]> = {
  step: ['[', ']'],
  decision: ['{', '}'],
  terminal: ['([', '])'],
  subprocess: ['[[', ']]'],
  database: ['[(', ')]'],
  io: ['[/', '/]'],
};

/**
 * One node declaration in canonical form, without indentation (§3.3): always a quoted label, `:::className` if
 * present, and `@{ shape: doc, label: "…" }` with keys in that order and one space after `{`, `:` and `,` and before
 * `}`. Inside `@{…}` a backslash is written `#92;`; elsewhere as is.
 */
export function formatNodeDecl(node: Pick<NodeDecl, 'id' | 'shape' | 'label' | 'className'>): string {
  if (node.shape === 'document' || node.shape === 'delay') {
    const shape = node.shape === 'document' ? 'doc' : 'delay';
    return `${node.id}@{ shape: ${shape}, label: "${encodeLabel(node.label, { backslash: true })}" }`;
  }
  const [open, close] = BRACKETS[node.shape];
  const suffix = node.className ? `:::${node.className}` : '';
  return `${node.id}${open}"${encodeLabel(node.label)}"${close}${suffix}`;
}

/** One edge in canonical form, without indentation (§3.3 step 5). */
export function formatEdge(edge: Pick<Edge, 'source' | 'target' | 'label'>): string {
  if (edge.label === null || edge.label === '') return `${edge.source} --> ${edge.target}`;
  return `${edge.source} -->|${formatInlineLabel(edge.label)}| ${edge.target}`;
}

/** A `subgraph` line in canonical form, without indentation (§3.3 step 4). */
export function formatLaneHeader(lane: Pick<Lane, 'id' | 'label'>): string {
  return `subgraph ${lane.id} [${formatInlineLabel(lane.label)}]`;
}

/** Lane and edge labels: unquoted when they pass the §3.3 test, else quoted and encoded. */
function formatInlineLabel(label: string): string {
  return canWriteUnquoted(label) ? label : `"${encodeLabel(label)}"`;
}

function withComments(out: string[], comments: readonly Comment[], indent: string, statement: string): void {
  for (const c of comments) out.push(indent + c);
  out.push(indent + statement);
}

/** The whole diagram in canonical form (§3.3), ending with exactly one newline. */
export function format(d: Diagram): string {
  const out: string[] = [`flowchart ${d.direction}`, ...d.fileComment];
  // §3.3: each non-empty section is preceded by one blank line; empty sections are left out with their blank line.
  const section = (lines: string[]) => {
    if (lines.length === 0) return;
    out.push('', ...lines);
  };

  const unlaned: string[] = [];
  for (const node of d.unlaned) withComments(unlaned, node.comments, NODE_INDENT_UNLANED, formatNodeDecl(node));
  section(unlaned);

  for (const lane of d.lanes) {
    const lines: string[] = [];
    withComments(lines, lane.comments, STATEMENT_INDENT, formatLaneHeader(lane));
    for (const node of lane.nodes) withComments(lines, node.comments, NODE_INDENT_LANED, formatNodeDecl(node));
    for (const c of lane.endComments) lines.push(NODE_INDENT_LANED + c);
    lines.push(`${STATEMENT_INDENT}end`);
    section(lines);
  }

  const edges: string[] = [];
  for (const edge of d.edges) withComments(edges, edge.comments, STATEMENT_INDENT, formatEdge(edge));
  section(edges);

  const passThrough: string[] = [];
  for (const line of d.passThrough) withComments(passThrough, line.comments, STATEMENT_INDENT, line.text);
  section(passThrough);

  section([...d.trailingComments]);

  return out.join('\n') + '\n';
}
