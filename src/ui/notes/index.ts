// Notes and the movable, hideable title (design.md §8.2 UI41, UI42). Importing this registers the note editor overlay
// and the context-menu behaviour; the canvas draws `NotesLayer`, and `noteCommands` joins the toolbar and keyboard.
import { overlays } from '../chrome/Panels';
import { NoteEditorHost } from './NoteEditor';
import './menu';
import './notes.css';

overlays.push({ id: 'note-editor', Component: NoteEditorHost });

export { NotesLayer } from './NotesLayer';
export { noteCommands } from './commands';
export { notesRowBottom, withAnnotations } from './geometry';
