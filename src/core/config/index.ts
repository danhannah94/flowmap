// The `.flow.yaml` config (§4): reading, applying to the diagram, and writing it the way the UI does.
export * from './model';
export { parseConfig, checkReferences, checkNoteClashes, scalarString, type ConfigParse } from './parse';
export {
  effectiveKind, resolveStyle, legend, laneOrder, diagramTitle, fieldSuggestions, matchFields, ruleMatches, nodeMeta,
  type NodeFieldsInput,
} from './style';
export { isValidColor, normalizeColor, sameColor, colorForTheme, type Theme } from './color';
export {
  ConfigDoc, fieldValueFromForm, fieldValueToJs, type EditResult, type FieldValue, type MatchInput,
} from './doc';
export {
  checkLinks, exportFileOf, exportLinkHref, isWellFormedLinkTarget, linkHasTraversal, linkOf, linkTargetsByNode,
  linkTargetToMmdPath, movedLinkTarget, normalizeLinkTarget, relativePath, renamedFolderLinkTarget,
} from './links';
