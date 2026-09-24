// Evidence and styles (design.md §8.2 UI24–UI27): thin wrappers over the `ConfigDoc` operations, so the UI has one
// API over the three files. The config writer keeps every untouched byte (UI26); these add the shared rules (an
// `.mmd` with errors refuses everything; several blocks are handled in file declaration order) and check that the
// blocks exist.
import type { ColorProp, ConfigDoc, EditResult, FieldValue, MatchInput, StyleProp } from '../config';
import { removePin } from '../layoutfile';
import { run, type Ctx, type Files, type OpResult } from './context';

function configOp(files: Files, edit: (doc: ConfigDoc, ctx: Ctx) => EditResult): OpResult {
  return run(files, (ctx) => {
    ctx.requireConfig();
    ctx.editConfig('always', (doc) => edit(doc, ctx));
    return {};
  });
}

// ---- UI24 Inspector: fields and node YAML

/** UI24: add or edit one metadata field of a block (new entries and fields go at the end, UI26). */
export function setNodeField(files: Files, id: string, key: string, value: FieldValue): OpResult {
  return setFieldOnNodes(files, [id], key, value);
}

/** UI24 with several blocks selected: set a field on all of them, in file declaration order. */
export function setFieldOnNodes(files: Files, ids: readonly string[], key: string, value: FieldValue): OpResult {
  return configOp(files, (doc, ctx) => doc.setFieldOnNodes(ctx.sortByDeclaration(ids), key, value));
}

/** UI24: delete one field of a block; a block left with no fields loses its entry (§4). */
export function removeNodeField(files: Files, id: string, key: string): OpResult {
  return removeFieldFromNodes(files, [id], key);
}

/** UI24 `field-remove-all`: remove a named field from several blocks. */
export function removeFieldFromNodes(files: Files, ids: readonly string[], key: string): OpResult {
  return configOp(files, (doc, ctx) => doc.removeFieldFromNodes(ctx.sortByDeclaration(ids), key));
}

/** UI24 node YAML: replace a block's whole metadata entry; empty YAML (or `{}`) removes it; not a map is refused. */
export function replaceNodeEntry(files: Files, id: string, yamlText: string): OpResult {
  return configOp(files, (doc, ctx) => {
    ctx.requireNode(id);
    return doc.replaceNodeEntry(id, yamlText);
  });
}

// ---- UI25 Styles panel

export function addRule(files: Files): OpResult {
  return configOp(files, (doc) => doc.addRule());
}

export function deleteRule(files: Files, index: number): OpResult {
  return configOp(files, (doc) => doc.deleteRule(index));
}

export function moveRule(files: Files, index: number, dir: 'up' | 'down'): OpResult {
  return configOp(files, (doc) => doc.moveRule(index, dir));
}

/** Empty (or null) removes the legend. */
export function setRuleLegend(files: Files, index: number, text: string | null): OpResult {
  return configOp(files, (doc) => doc.setRuleLegend(index, text));
}

/** Add a match condition (equals a value, present, absent), or replace the one on the same field. */
export function setMatchCondition(files: Files, index: number, field: string, cond: MatchInput): OpResult {
  return configOp(files, (doc) => doc.setMatchCondition(index, field, cond));
}

/** Edit a condition: rename its field in place if changed, and set its test. */
export function editMatchCondition(
  files: Files, index: number, oldField: string, newField: string, cond: MatchInput,
): OpResult {
  return configOp(files, (doc) => doc.editMatchCondition(index, oldField, newField, cond));
}

export function removeMatchCondition(files: Files, index: number, field: string): OpResult {
  return configOp(files, (doc) => doc.removeMatchCondition(index, field));
}

/** A non-colour property (`border_style`, `border_width`, `font_style`, `badge`); null or empty clears it. */
export function setStyleProp(files: Files, index: number, prop: StyleProp, value: string | number | null): OpResult {
  return configOp(files, (doc) => doc.setStyleProp(index, prop, value));
}

/** A colour property from its light and dark inputs (UI25); both empty clears it. */
export function setStyleColor(
  files: Files, index: number, prop: ColorProp, light: string | null, dark: string | null,
): OpResult {
  return configOp(files, (doc) => doc.setStyleColor(index, prop, light, dark));
}

/** UI25 styles YAML: replace the whole `styles` list; anything but a list of rules is refused. */
export function replaceStyles(files: Files, yamlText: string): OpResult {
  return configOp(files, (doc) => doc.replaceStyles(yamlText));
}

// ---- UI27 Orphans

/** UI27: delete a config `nodes` entry (`W-config-unknown-node`). */
export function deleteOrphanNodeEntry(files: Files, id: string): OpResult {
  return configOp(files, (doc) => doc.deleteNodeEntry(id));
}

/** UI27: delete a config `lanes` entry (`W-config-unknown-lane`); every entry with that id goes. */
export function deleteOrphanLaneEntry(files: Files, id: string): OpResult {
  return configOp(files, (doc) => doc.deleteLaneEntry(id));
}

/** UI27: delete a pin (`W-layout-unknown-node`). */
export function deleteOrphanPin(files: Files, id: string): OpResult {
  return run(files, (ctx) => {
    ctx.editLayout('always', (file) => removePin(file, id));
    return {};
  });
}
