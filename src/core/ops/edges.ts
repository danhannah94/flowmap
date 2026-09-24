// Line operations (design.md §8.2 UI15–UI17). Edge ids are derived (§3.4), so an operation that changes an edge's
// endpoints reports its new id.
import { refuse, run, type Files, type OpResult } from './context';

/** UI15: connect `source` to `target`; the new edge is appended at the end of the edge section. Returns its id. */
export function connect(files: Files, source: string, target: string): OpResult<{ edgeId: string }> {
  return run(files, (ctx) => {
    ctx.requireNode(source);
    ctx.requireNode(target);
    ctx.d.edges.push({ source, target, label: null, comments: [] });
    return { edgeId: ctx.edgeIds().at(-1)! };
  });
}

/**
 * UI16: move one end of an edge to another block. The edge keeps its place in the file, its label and its comment;
 * its id follows its new endpoints (returned).
 */
export function reconnect(
  files: Files,
  edgeId: string,
  end: 'source' | 'target',
  node: string,
): OpResult<{ edgeId: string }> {
  return run(files, (ctx) => {
    if (end !== 'source' && end !== 'target') refuse(`An edge end is "source" or "target", not "${String(end)}"`);
    const i = ctx.edgeIndex(edgeId);
    ctx.requireNode(node);
    ctx.d.edges[i]![end] = node;
    return { edgeId: ctx.edgeIds()[i]! };
  });
}

/** UI17: set an edge's label; an empty label (or null) removes it. Labels are one line (§3.1). */
export function setEdgeLabel(files: Files, edgeId: string, label: string | null): OpResult {
  return run(files, (ctx) => {
    const i = ctx.edgeIndex(edgeId);
    if (label !== null && /[\r\n]/.test(label)) refuse('An edge label must be a single line');
    ctx.d.edges[i]!.label = label === null || label.trim() === '' ? null : label;
    return {};
  });
}
