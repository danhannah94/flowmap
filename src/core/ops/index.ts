// The operations layer (design.md §8.1, §8.2): every edit a person can make in the UI, as a pure function over the
// diagram's three files. Each operation takes `Files` and returns the new `Files` (null for a file that should not
// exist) or a refusal. The `.mmd` is always written in canonical form (§3.3); the config keeps every untouched byte
// (UI26); the layout file is rewritten only when its content changes.
export { mentions, type Files, type OpResult } from './context';
export { blockGroupAt, type LayoutArg } from './frame';
export {
  NEW_BLOCK_LABELS, addNode, addNodeAt, changeShape, clearAllPins, deleteItems, moveNodesToGroup, moveNodesToLane,
  pinNodes, positionInLane, renameNode, resetSize, resizedBox, resizeNode, setNodeLabel, unpinNodes, type DropPosition,
  type ResizableBlock, type ResizeHandle,
} from './nodes';
export {
  PASTE_STEP, copyFragment, duplicateNodes, fragmentBounds, fragmentToMermaid, isFragment, pasteFragment,
  type Fragment, type FragmentEdge, type FragmentNode, type PastedBlock, type PastePlacement,
} from './fragment';
export { connect, reconnect, setEdgeLabel, type ConnectSides } from './edges';
export {
  STUB, addBend, dragBend, dragSegment, makeManual, removeBend, resetLabelAt, resetLine, setLabelAt,
} from './lines';
export {
  addNote, deleteNote, hideTitle, moveNote, moveTitle, resetTitlePosition, setNoteStyle, setNoteText, showTitle,
  type NoteStyle,
} from './notes';
export {
  addLane, deleteLane, displayLaneOrder, laneSlug, moveLane, promoteUnassigned, renameLane, reorderLanes,
  resetLaneLength, resetLaneSize, resizeLane, resizeLaneLength, setLaneLabel, type DeleteLaneMode,
} from './lanes';
export { setDirection, setTitle } from './diagram';
export {
  addRule, applySwatch, clearNodeLink, deleteOrphanEdgeEntry, deleteOrphanLaneEntry, deleteOrphanNodeEntry,
  deleteOrphanNoteEntry, deleteOrphanPin, deleteRule, editMatchCondition, moveRule, removeFieldFromNodes,
  removeMatchCondition, removeNodeField, replaceNodeEntry, replaceStyles, resetBlockColors, setBlockColors,
  setFieldOnNodes, setMatchCondition, setNodeField, setNodeLink, setRuleLegend, setStyleColor, setStyleProp,
} from './config';
