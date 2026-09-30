// A command is one thing a person can do from the toolbar and/or the keyboard (§8.3 toolbar test ids, UI33).
// The toolbar renders the commands listed in TOOLBAR (commands/index.ts) by id; the keyboard handler runs the first
// enabled command whose `keys` match. Feature files export arrays of commands; nothing else needs to change.
import type { ReactNode } from 'react';
import type { State, Store } from '../store/store';

export interface Command {
  /** Unique id; for toolbar commands also the button's `data-testid` (§8.3). */
  id: string;
  /** Tooltip and accessible name. */
  title: string;
  /** Toolbar icon (see chrome/icons.tsx). Commands without an icon show `title` as text. */
  icon?: ReactNode;
  /**
   * Keyboard bindings: `mod+z` (Cmd on a Mac, Ctrl elsewhere; either is accepted), `shift+mod+z`, `Delete`,
   * `ArrowUp`, `?`… Modifiers must match exactly, except that printable keys ignore Shift. Keys never fire while
   * the person is typing in an editor.
   */
  keys?: readonly string[];
  /** Shown in the shortcut list (`?`). Defaults to `title`. */
  help?: string;
  /** Enabled right now? (Default: when the diagram is editable.) Disabled toolbar buttons render `disabled`. */
  enabled?: (s: State, store: Store) => boolean;
  /**
   * When the command is disabled, leave the browser's own action alone instead of swallowing it (copy and paste: text
   * selected in a panel still copies). By default a disabled Cmd/Ctrl shortcut still blocks the browser's default.
   */
  native?: boolean;
  /** Toggle state for buttons such as styles or connect (`aria-pressed`). */
  active?: (s: State) => boolean;
  run: (store: Store, e?: KeyboardEvent) => void;
}

/** Enabled when the diagram is loaded and has no `.mmd` errors (UI31). */
export const editable = (s: State) => s.status === 'ready' && !!s.derived && !s.derived.readOnly;

export function isEnabled(cmd: Command, s: State, store: Store): boolean {
  return (cmd.enabled ?? editable)(s, store);
}
