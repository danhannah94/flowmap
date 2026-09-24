// Notes and the title (design.md §8.2 UI41, UI42). A note is its `notes` entry in the config (text and style, §4) plus
// its position in the layout file (§5); the title's visibility is the config's `show_title`, its position the layout
// file's `title`. Positions are taken in diagram coordinates (as the UI draws them) and stored less the frame (§5,
// §6: notes and the title shift with it), rounded to whole pixels (halves toward −∞).
import { removeNoteEntries, setNotePosition, setTitlePosition } from '../layoutfile';
import type { XY } from '../types';
import { refuse, run, type Ctx, type Files, type OpResult } from './context';
import { storedXY, viewOf, type LayoutArg } from './frame';

function frameFor(ctx: Ctx, layout?: LayoutArg) {
  return layout === undefined ? ctx.frame() : viewOf(ctx, layout).frame;
}

/** Refuse unless the config can be read and has this note (UI31: with `E-config` notes can't be read). */
function requireNote(ctx: Ctx, id: string): void {
  ctx.requireConfig();
  if (!Object.hasOwn(ctx.config!.notes, id)) refuse(`There is no note "${id}"`);
}

/** §3.1 / UI41: the first of `note1`, `note2`, … that isn't taken. */
function nextNoteId(ctx: Ctx): string {
  for (let k = 1; ; k++) if (!ctx.isTaken(`note${k}`)) return `note${k}`;
}

/**
 * UI41: add a note, in one step: its id (the first free `note1`, `note2`…), its text (as typed, without trailing line
 * breaks) and its position `at`. Blank text adds nothing, so it is refused. `layout` gives the frame (omitted: worked
 * out from the files). Returns the new id.
 */
export function addNote(files: Files, args: { text: string; at: XY }, layout?: LayoutArg): OpResult<{ id: string }> {
  return run(files, (ctx) => {
    ctx.requireConfig();
    ctx.requireLayout();
    if (typeof args.text !== 'string' || args.text.trim() === '') refuse('A note needs some text');
    const pos = storedXY(ctx, frameFor(ctx, layout), args.at);
    const id = nextNoteId(ctx);
    ctx.editConfig('always', (doc) => doc.addNote(id, args.text));
    ctx.editLayout('always', (file) => setNotePosition(file, id, pos));
    return { id };
  });
}

/** UI41: edit a note's text (line breaks allowed; trailing ones dropped). Blank text deletes the note. */
export function setNoteText(files: Files, id: string, text: string): OpResult {
  return run(files, (ctx) => {
    requireNote(ctx, id);
    if (typeof text !== 'string' || text.trim() === '') removeNote(ctx, id);
    else ctx.editConfig('always', (doc) => doc.setNoteText(id, text));
    return {};
  });
}

/** UI41: move a note (the UI snaps first, UI39). */
export function moveNote(files: Files, id: string, at: XY, layout?: LayoutArg): OpResult {
  return run(files, (ctx) => {
    requireNote(ctx, id);
    ctx.requireLayout();
    const pos = storedXY(ctx, frameFor(ctx, layout), at);
    ctx.editLayout('always', (file) => setNotePosition(file, id, pos));
    return {};
  });
}

/** A note's style from its context menu: each given property is set; null (or its default) removes its key (§4). */
export interface NoteStyle {
  font_size?: number | null;
  bold?: boolean;
  /** Light and dark inputs, as in the styles panel; both empty removes the colour. */
  color?: { light: string | null; dark: string | null } | null;
}

/** UI41: set a note's font size, bold and colour. */
export function setNoteStyle(files: Files, id: string, style: NoteStyle): OpResult {
  return run(files, (ctx) => {
    requireNote(ctx, id);
    if (style.font_size !== undefined) ctx.editConfig('always', (doc) => doc.setNoteFontSize(id, style.font_size ?? null));
    if (style.bold !== undefined) ctx.editConfig('always', (doc) => doc.setNoteBold(id, style.bold === true));
    if (style.color !== undefined) {
      ctx.editConfig('always', (doc) => doc.setNoteColor(id, style.color?.light ?? null, style.color?.dark ?? null));
    }
    return {};
  });
}

function removeNote(ctx: Ctx, id: string): void {
  ctx.editConfig('always', (doc) => doc.deleteNote(id));
  ctx.editLayout([id], (file) => removeNoteEntries(file, [id]));
}

/** UI41: delete a note: its config entry (an emptied `notes` goes) and its position. */
export function deleteNote(files: Files, id: string): OpResult {
  return run(files, (ctx) => {
    requireNote(ctx, id);
    removeNote(ctx, id);
    return {};
  });
}

/** UI42: move the title (writes the layout file's `title`; the UI snaps first, UI39). */
export function moveTitle(files: Files, at: XY, layout?: LayoutArg): OpResult {
  return run(files, (ctx) => {
    ctx.requireLayout();
    const pos = storedXY(ctx, frameFor(ctx, layout), at);
    ctx.editLayout('always', (file) => setTitlePosition(file, pos));
    return {};
  });
}

/** UI42 "Reset position": remove the title's position from the layout file. */
export function resetTitlePosition(files: Files): OpResult {
  return run(files, (ctx) => {
    ctx.editLayout(['title'], (file) => setTitlePosition(file, null));
    return {};
  });
}

/** UI42: hide the title (`show_title: false` in the config, creating the file if needed). */
export function hideTitle(files: Files): OpResult {
  return run(files, (ctx) => {
    ctx.requireConfig();
    ctx.editConfig('always', (doc) => doc.setShowTitle(false));
    return {};
  });
}

/** UI42 `show-title`: show a hidden title (removes `show_title`; `true` is never written). */
export function showTitle(files: Files): OpResult {
  return run(files, (ctx) => {
    ctx.requireConfig();
    ctx.editConfig('always', (doc) => doc.setShowTitle(true));
    return {};
  });
}
