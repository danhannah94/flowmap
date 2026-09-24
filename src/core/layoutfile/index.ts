// The `.layout.json` file (§5): reading, checking against the diagram, the UI's writes (UI10–UI14, UI19, UI21,
// UI23, UI27, UI34–UI43, §8.2 "Keeping the layout file in step") and its text. Pure: text in, text out. Write
// operations take and return `LayoutFile | null` (null: no file on disk), so an operation that has nothing to write
// never creates a file (UI28).
export {
  parseLayoutFile, checkRanges, checkPinRanges, checkLayoutRefs, effectivePins, effectivePlacements, firstLaneOf,
  isLabelAt, MIN_SIZE,
  type LayoutParse, type NodeLane, type Placements, type PlacementTargets,
} from './parse';
export {
  setPin, setPins, removePin, removePins, setSize, setSizes, removeNodeEntries, nodeEntry,
  updateEdge, updateEdges, setEdgeSide, setEdgePoints, setLabelAt, resetEdge, removeEdgeEntries,
  rekeyEdges, rekeyEdgesByPosition, splitEdgeId,
  renameNode, renamePinNode, renameLane, renameLaneInPins, dropPointsInLanes, movePointsToLane,
  clearPinsAndPoints, clearPins,
  setNotePosition, removeNoteEntries, setTitlePosition,
  flipDirection, setHints, roundPx, pinFromDrop,
  type EdgePatch,
} from './write';
export { serializeLayoutFile } from './serialize';
export { pinOf, sizeOf } from '../types';
