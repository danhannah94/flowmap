// The operations layer (design.md §8.1, §8.2): every edit a person can make in the UI, as a pure function over the
// diagram's three files. Each operation takes `Files` and returns the new `Files` (null for a file that should not
// exist) or a refusal. The `.mmd` is always written in canonical form (§3.3); the config keeps every untouched byte
// (UI26); the layout file is rewritten only when its content changes.
export { mentions, type Files, type OpResult } from './context';
export {
  NEW_BLOCK_LABELS, addNode, changeShape, clearAllPins, deleteItems, duplicateNodes, moveNodesToLane, pinNodes,
  positionInLane, renameNode, setNodeLabel, unpinNodes, type DropPosition,
} from './nodes';
export { connect, reconnect, setEdgeLabel } from './edges';
export {
  addLane, deleteLane, displayLaneOrder, laneSlug, moveLane, renameLane, reorderLanes, setLaneLabel,
  type DeleteLaneMode,
} from './lanes';
export { setDirection, setTitle } from './diagram';
export {
  addRule, deleteOrphanLaneEntry, deleteOrphanNodeEntry, deleteOrphanPin, deleteRule, editMatchCondition, moveRule,
  removeFieldFromNodes, removeMatchCondition, removeNodeField, replaceNodeEntry, replaceStyles, setFieldOnNodes,
  setMatchCondition, setNodeField, setRuleLegend, setStyleColor, setStyleProp,
} from './config';
