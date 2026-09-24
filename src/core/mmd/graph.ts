// The model as the layout, renderer and UI see it (types.ts `Graph`): resolved lanes in display order, never-declared
// nodes filled in, and derived edge ids.

import { UNASSIGNED, type Graph, type GraphLane, type GraphNode } from '../types';
import type { Diagram } from './model';
import { declaredNodes, edgeIds, undeclaredNodes } from './model';

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

  const nodes: GraphNode[] = declaredNodes(d).map(({ node, lane }) => ({
    id: node.id,
    label: node.label,
    kind: node.shape,
    lane: lane ?? UNASSIGNED,
  }));
  // §3.2: a never-declared node is a `step` labelled with its id, in no lane.
  for (const { id } of undeclaredNodes(d)) nodes.push({ id, label: id, kind: 'step', lane: UNASSIGNED });
  if (nodes.some((node) => node.lane === UNASSIGNED)) lanes.push({ id: UNASSIGNED, label: UNASSIGNED_LABEL });

  const ids = edgeIds(d.edges);
  const edges = d.edges.map((edge, k) => ({ id: ids[k]!, source: edge.source, target: edge.target, label: edge.label }));

  return { direction: d.direction, lanes, nodes, edges };
}
