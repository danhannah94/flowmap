// The model as the layout, renderer and UI see it (types.ts `Graph`): resolved lanes in display order, never-declared
// nodes filled in, and derived edge ids.

import { UNASSIGNED, type Graph, type GraphLane, type GraphNode } from '../types';
import type { Diagram } from './model';
import { allGroups, declaredNodes, edgeIds, undeclaredNodes } from './model';

export const UNASSIGNED_LABEL = 'Unassigned';

/**
 * Build the graph. `laneOrder` is the config's `lanes` id list (§4): display order is those lanes first (ids not in
 * the diagram are skipped), then the rest in file order, then `_unassigned` last, only if some node has no lane (§7).
 */
export function toGraph(d: Diagram, laneOrder: readonly string[] = []): Graph {
  const byId = new Map(d.lanes.map((lane) => [lane.id, lane]));
  const lanes: GraphLane[] = [];
  const placed = new Set<string>();
  const place = (id: string) => {
    const lane = byId.get(id);
    if (!lane || placed.has(id)) return;
    placed.add(id);
    lanes.push({ id: lane.id, label: lane.label });
  };
  laneOrder.forEach(place);
  d.lanes.forEach((lane) => place(lane.id));

  const nodes: GraphNode[] = declaredNodes(d).map(({ node, lane, group }) => {
    const out: GraphNode = { id: node.id, label: node.label, kind: node.shape, lane: lane ?? UNASSIGNED };
    if (group !== null) out.group = group; // A19: only for a node in a group, so a graph without groups is unchanged
    return out;
  });
  // §3.2: a never-declared node is a `step` labelled with its id, in no lane.
  for (const { id } of undeclaredNodes(d)) nodes.push({ id, label: id, kind: 'step', lane: UNASSIGNED });
  if (nodes.some((node) => node.lane === UNASSIGNED)) lanes.push({ id: UNASSIGNED, label: UNASSIGNED_LABEL });

  const ids = edgeIds(d.edges);
  const edges = d.edges.map((edge, k) => ({ id: ids[k]!, source: edge.source, target: edge.target, label: edge.label }));

  const graph: Graph = { direction: d.direction, lanes, nodes, edges };
  // A19: groups, only when there are any (a graph without groups is exactly as before).
  const groups = allGroups(d);
  if (groups.length) graph.groups = groups.map((g) => ({ id: g.group.id, label: g.group.label, lane: g.lane, parent: g.parent }));
  return graph;
}
