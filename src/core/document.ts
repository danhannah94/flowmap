// Loading one diagram from its three texts (design.md §2, §7). Pure: no fs, no network — the CLI, the server and
// the UI all call this with text they've already read, and get back everything a consumer needs to show or export
// the diagram. Degrades exactly as §7 says: `.mmd` errors are fatal for layout (and so for export); `E-config` and
// `E-layout` are not (default styles, or no pins, respectively), and their problems are still reported.
import type { Diagram } from './mmd';
import { parse, toGraph } from './mmd';
import type { FlowConfig } from './config';
import { checkReferences, diagramTitle, laneOrder, legend, parseConfig, resolveStyle } from './config';
import { checkLayoutRefs, checkPinRanges, effectivePins, firstLaneOf, parseLayoutFile } from './layoutfile';
import { layout } from './layout';
import type { LayoutOutput } from './layout';
import type { Graph, LegendItem, Pin, Problems, ResolvedStyle } from './types';

export interface FlowDocument {
  /** Every problem found across the three files, in a stable order: `.mmd` problems by line, then config, then
   *  layout, each including its own cross-file checks (config's unknown-node/lane, layout's unknown-node). */
  problems: Problems;
  /** The parsed `.mmd`, whatever could be parsed even when it has errors. */
  diagram: Diagram;
  /** The config, or null when it has errors (§7: use default styles). No config file gives an empty (not null) config. */
  config: FlowConfig | null;
  /** Pins that apply: the node exists and its pin's lane still matches (§5). Empty when the layout file has errors. */
  pins: Record<string, Pin>;
  /** The diagram in display order (§4 lane order, `_unassigned` last only if some node has no lane). */
  graph: Graph;
  /** The computed layout, or null when the `.mmd` has errors (fatal for layout and export, §7). */
  layout: LayoutOutput | null;
  /** Every node's resolved style (empty object = theme defaults), by node id. */
  styles: Record<string, ResolvedStyle>;
  legend: LegendItem[];
  title: string;
}

/**
 * Load a diagram. `configText` and `layoutText` are null when that file doesn't exist. `mmdName` is the `.mmd`
 * file's base name (or path), used as the title when there is no config or no `title` in it (§4).
 */
export function loadDocument(
  mmdText: string,
  configText: string | null,
  layoutText: string | null,
  mmdName: string,
): FlowDocument {
  const mmdParse = parse(mmdText);
  const configParse = parseConfig(configText);
  const parsedLayout = parseLayoutFile(layoutText);

  const fileLaneIds = mmdParse.diagram.lanes.map((lane) => lane.id);
  const order = laneOrder(configParse.config, fileLaneIds);
  const graph = toGraph(mmdParse.diagram, order);
  // §5 Values: a negative `across` outside the first displayed lane is out of range (E-layout: no placements).
  const rangeErrors = checkPinRanges(parsedLayout.file, firstLaneOf(order));
  const layoutParse = rangeErrors.length
    ? { file: null, problems: { errors: [...parsedLayout.problems.errors, ...rangeErrors], warnings: parsedLayout.problems.warnings } }
    : parsedLayout;

  const configRefWarnings = checkReferences(
    configParse.config,
    graph.nodes.map((n) => n.id),
    graph.lanes.map((l) => l.id),
  );
  const layoutRefWarnings = checkLayoutRefs(layoutParse.file, graph.nodes);

  const problems: Problems = {
    errors: [...mmdParse.problems.errors, ...configParse.problems.errors, ...layoutParse.problems.errors],
    warnings: [
      ...mmdParse.problems.warnings,
      ...configParse.problems.warnings,
      ...configRefWarnings,
      ...layoutParse.problems.warnings,
      ...layoutRefWarnings,
    ],
  };

  const pinsMap = effectivePins(layoutParse.file, graph.nodes);
  const pins: Record<string, Pin> = Object.fromEntries(pinsMap);

  const mmdHasErrors = mmdParse.problems.errors.length > 0;
  const layoutOutput = mmdHasErrors ? null : layout(graph, pins, layoutParse.file?.hints);

  const styles: Record<string, ResolvedStyle> = {};
  for (const node of graph.nodes) {
    styles[node.id] = resolveStyle(configParse.config, {
      id: node.id,
      lane: node.lane,
      label: node.label,
      kind: node.kind,
    });
  }

  return {
    problems,
    diagram: mmdParse.diagram,
    config: configParse.config,
    pins,
    graph,
    layout: layoutOutput,
    styles,
    legend: legend(configParse.config),
    title: diagramTitle(configParse.config, mmdName),
  };
}
