// Loading one diagram from its three texts (design.md §2, §7). Pure: no fs, no network — the CLI, the server and
// the UI all call this with text they've already read, and get back everything a consumer needs to show or export
// the diagram. Degrades exactly as §7 says: `.mmd` errors are fatal for layout (and so for export); `E-config` and
// `E-layout` are not (default styles and no notes, or none of the layout file's placements, respectively), and
// their problems are still reported.
import type { Diagram } from './mmd';
import { parse, toGraph } from './mmd';
import type { FlowConfig } from './config';
import {
  checkNoteClashes, checkReferences, diagramTitle, laneOrder, legend, NOTE_FONT_SIZE, parseConfig, resolveStyle,
} from './config';
import { checkLayoutRefs, checkRanges, effectivePlacements, firstLaneOf, parseLayoutFile } from './layoutfile';
import { layoutDiagram } from './layout';
import type { LayoutOutput } from './layout';
import type {
  Graph, LayoutEdgeEntry, LayoutFile, LayoutInput, LegendItem, NoteInput, Pin, Problems, ResolvedStyle, Size, XY,
} from './types';

/** A note as the diagram shows it (§4, §5 v1.1): the config's note with defaults applied, plus its stored position. */
export interface DocumentNote extends NoteInput {
  /** The stored position (§5), or null when the layout places it (§6). */
  position: XY | null;
}

export interface FlowDocument {
  /** Every problem found across the three files, in a stable order: `.mmd` problems by line, then config, then
   *  layout, each including its own cross-file checks (config's unknown-node/lane and note-id clashes; layout's
   *  ranges and unknown node/edge/note entries). */
  problems: Problems;
  /** The parsed `.mmd`, whatever could be parsed even when it has errors. */
  diagram: Diagram;
  /** The config, or null when it has errors (§7: use default styles). No config file gives an empty (not null) config. */
  config: FlowConfig | null;
  /** The layout file as parsed, or null when there is none or it has errors (§5: none of its placements apply). */
  layoutFile: LayoutFile | null;
  /** Pins that apply: the node exists and its pin's lane still matches (§5). Empty when the layout file has errors. */
  pins: Record<string, Pin>;
  /** v1.1: stored sizes of existing nodes (they apply even when the pin is ignored, §5). */
  sizes: Record<string, Size>;
  /** v1.1: entries of existing edges; `points` left out when a point's lane doesn't exist (§5). */
  edgeEntries: Record<string, LayoutEdgeEntry>;
  /** v1.1: the config's notes in config order, with their positions. Empty when the config has errors (UI31). */
  notes: DocumentNote[];
  /** The diagram in display order (§4 lane order, `_unassigned` last only if some node has no lane). */
  graph: Graph;
  /** Exactly what the layout function was given (v1.1). */
  layoutInput: LayoutInput;
  /** The computed layout, or null when the `.mmd` has errors (fatal for layout and export, §7). */
  layout: LayoutOutput | null;
  /** Every node's resolved style (empty object = theme defaults), by node id: rules, then the block's own `style`. */
  styles: Record<string, ResolvedStyle>;
  legend: LegendItem[];
  /** The title text (config `title`, or the `.mmd` base name), whether or not it is shown. */
  title: string;
  /** v1.1: false when the config says `show_title: false` (always true while the config has errors, UI31). */
  showTitle: boolean;
  /** v1.1: the title's stored position, or null when the layout places it. */
  titlePosition: XY | null;
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

  // v1.1 §4: a note id equal to a node or subgraph id is E-config, so the config counts as having errors.
  const clashErrors = checkNoteClashes(configParse.config, graph.nodes.map((n) => n.id), fileLaneIds);
  const config = clashErrors.length ? null : configParse.config;

  // §5 Values: a negative `across` outside the first displayed lane (pins and bend points) is out of range: E-layout,
  // and none of the file's placements apply.
  const rangeErrors = checkRanges(parsedLayout.file, firstLaneOf(order));
  const layoutFile = rangeErrors.length ? null : parsedLayout.file;

  const configRefWarnings = checkReferences(config, graph.nodes.map((n) => n.id), graph.lanes.map((l) => l.id));
  const noteIds = config ? Object.keys(config.notes) : null;
  // UI31: while the config has E-config its notes can't be read, so W-layout-unknown-note isn't reported.
  const layoutRefWarnings = checkLayoutRefs(layoutFile, graph.nodes, graph.edges.map((e) => e.id), noteIds);

  const problems: Problems = {
    errors: [
      ...mmdParse.problems.errors,
      ...configParse.problems.errors,
      ...clashErrors,
      ...parsedLayout.problems.errors,
      ...rangeErrors,
    ],
    warnings: [
      ...mmdParse.problems.warnings,
      ...configParse.problems.warnings,
      ...configRefWarnings,
      ...parsedLayout.problems.warnings,
      ...layoutRefWarnings,
    ],
  };

  const placements = effectivePlacements(layoutFile, {
    nodes: graph.nodes, edges: graph.edges, lanes: graph.lanes, noteIds: noteIds ?? [],
  });

  const notes: DocumentNote[] = Object.entries(config?.notes ?? {}).map(([id, n]) => {
    const note: DocumentNote = {
      id, text: n.text, font_size: n.font_size ?? NOTE_FONT_SIZE, bold: n.bold ?? false, position: placements.notes.get(id) ?? null,
    };
    if (n.color !== undefined) note.color = n.color;
    return note;
  });
  const title = diagramTitle(config, mmdName);
  const showTitle = config?.showTitle ?? true;

  const layoutInput: LayoutInput = {
    graph,
    file: layoutFile,
    notes: notes.map(({ position: _p, ...n }) => n),
    title: showTitle ? title : null,
  };
  const mmdHasErrors = mmdParse.problems.errors.length > 0;
  const layoutOutput = mmdHasErrors ? null : layoutDiagram(layoutInput);

  const styles: Record<string, ResolvedStyle> = {};
  for (const node of graph.nodes) {
    styles[node.id] = resolveStyle(config, { id: node.id, lane: node.lane, label: node.label, kind: node.kind });
  }

  return {
    problems,
    diagram: mmdParse.diagram,
    config,
    layoutFile,
    pins: Object.fromEntries(placements.pins),
    sizes: Object.fromEntries(placements.sizes),
    edgeEntries: Object.fromEntries(placements.edges),
    notes,
    graph,
    layoutInput,
    layout: layoutOutput,
    styles,
    legend: legend(config),
    title,
    showTitle,
    titlePosition: placements.title,
  };
}
