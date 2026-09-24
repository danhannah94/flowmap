// Keyboard shortcuts (UI33): one window listener that runs the first enabled command whose `keys` match. Nothing
// fires while the person is typing in an editor, or while a dialog is open.
import { COMMANDS } from './commands';
import { isEnabled } from './commands/types';
import type { Store } from './store/store';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function isTyping(target: EventTarget | null): boolean {
  const el = target instanceof HTMLElement ? target : null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/** Does the key event match a binding such as `mod+z`, `shift+mod+z`, `Delete`, `?` or `shift+1`? */
export function matches(e: KeyboardEvent, binding: string): boolean {
  const parts = binding.split('+');
  // `mod++` means mod and the `+` key.
  let key = parts.pop()!;
  if (key === '' && binding.endsWith('++')) {
    parts.pop();
    key = '+';
  }
  const want = new Set(parts.map((p) => p.toLowerCase()));
  const mod = e.metaKey || e.ctrlKey;
  if (want.has('mod') !== mod) return false;
  if (want.has('alt') !== e.altKey) return false;
  const printable = key.length === 1 && !/[a-z0-9]/i.test(key);
  if (!printable && want.has('shift') !== e.shiftKey) return false;
  if (key.length === 1 && /[a-z]/i.test(key)) return e.key.toLowerCase() === key.toLowerCase();
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}` || e.key === key;
  return e.key === key;
}

export function modLabel(): string {
  return isMac ? '⌘' : 'Ctrl';
}

export function installKeyboard(store: Store): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return;
    if (isTyping(e.target)) return;
    const s = store.getState();
    if (s.editing || s.confirm) return;
    // Enter or Space on a focused button presses the button, not a shortcut.
    if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof HTMLElement && e.target.closest('button, a')) return;
    const matching = COMMANDS.filter((cmd) => cmd.keys?.some((k) => matches(e, k)));
    if (matching.length === 0) return;
    const cmd = matching.find((c) => isEnabled(c, s, store));
    // A matching but disabled shortcut still swallows browser defaults like Cmd+A or Cmd+Z.
    if (cmd || e.metaKey || e.ctrlKey || e.key.startsWith('Arrow')) e.preventDefault();
    cmd?.run(store, e);
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
