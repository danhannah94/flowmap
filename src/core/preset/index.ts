// Preset packs (A20, design.md §4.1): icons and styles keyed on a block's metadata `kind`.
export { BUILTIN_PACKS, builtinPresetNames } from './builtin';
export { GLYPHS, GLYPH_GRID, GLYPH_STROKE, glyphNames, hasGlyph, isSafePathData } from './glyphs';
export {
  applyPreset, builtinPack, classifyPresetRef, lookupKind, metaKindOf, parsePackText, presetFileOf, resolvePreset,
  type PresetApplication, type PresetFiles, type PresetKind, type PresetPack, type PresetRef, type PresetResolution,
} from './pack';
