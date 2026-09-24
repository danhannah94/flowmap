// The `.mmd` module (design.md §3): parse, canonical format, graph view, and the model they share.
export * from './model';
export { parse, type ParseResult } from './parse';
export { format, formatNodeDecl, formatEdge, formatLaneHeader } from './format';
export { toGraph, UNASSIGNED_LABEL } from './graph';
export {
  isReservedId, isIdForm, isValidId, decodeLabel, encodeLabel, canWriteUnquoted, normaliseUnquoted,
} from './syntax';
