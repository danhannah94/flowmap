// UI33: the shortcut list (`data-testid="shortcuts"`), shown by `?` or the keyboard button at the bottom left. It is
// generated from the command registry (every command with `keys`, commands/*.ts), so a shortcut another feature adds
// shows up here by itself; mouse gestures are listed below it. The list is not modal: shortcuts keep working while it
// is open, so a person can try them. `?` again, Escape or × closes it. (v1.1 rows: editing and moving a selected note
// or the title come from the note commands; double-click, right-click menus, Alt to skip snapping, resize, line
// shaping and connection points are listed under Mouse.)
import { useEffect } from 'react';
import { COMMANDS, type Command } from '../commands';
import { isTyping } from '../keyboard';
import { useStore, useStoreState } from '../store/hooks';

export const SHORTCUTS_PANEL = 'shortcuts';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const NAMED: Record<string, string> = {
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Escape: 'Esc', Enter: 'Enter', Delete: 'Delete', Backspace: 'Backspace', ' ': 'Space', Tab: 'Tab',
};

/** `shift+mod+z` → ['⇧', '⌘', 'Z'] (or ['Ctrl', 'Shift', 'Z']): one key cap per part. */
export function keyCaps(binding: string): string[] {
  const parts = binding.split('+');
  let key = parts.pop()!;
  if (key === '' && binding.endsWith('++')) {
    parts.pop();
    key = '+';
  }
  const mods = parts.map((p) => p.toLowerCase());
  const caps: string[] = [];
  const mod = (m: string, mac: string, other: string) => {
    if (mods.includes(m)) caps.push(isMac ? mac : other);
  };
  if (isMac) {
    mod('alt', '⌥', 'Alt');
    mod('shift', '⇧', 'Shift');
    mod('mod', '⌘', 'Ctrl');
  } else {
    mod('mod', '⌘', 'Ctrl');
    mod('alt', '⌥', 'Alt');
    mod('shift', '⇧', 'Shift');
  }
  caps.push(NAMED[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  return caps;
}

interface Row {
  text: string;
  bindings: string[][];
}

/** Every command with keys, in registry order; the four nudges collapse into one row. */
function keyboardRows(commands: readonly Command[]): Row[] {
  const rows: Row[] = [];
  let nudge: Row | null = null;
  const seen = new Set<string>();
  for (const cmd of commands) {
    if (!cmd.keys?.length || seen.has(cmd.id)) continue;
    seen.add(cmd.id);
    const bindings = cmd.keys.map(keyCaps);
    if (cmd.id.startsWith('nudge-')) {
      if (!nudge) rows.push((nudge = { text: 'Nudge the selection 10 px (pins it)', bindings: [] }));
      nudge.bindings.push(...bindings);
      continue;
    }
    rows.push({ text: cmd.help ?? cmd.title, bindings });
  }
  return rows;
}

const ALT = isMac ? '⌥' : 'Alt';

const MOUSE: Row[] = [
  { text: 'Edit a block, a note, a line label, a lane name or the title', bindings: [['Double-click']] },
  { text: 'The menu for a block, line, lane, note, the title or the canvas', bindings: [['Right-click']] },
  { text: 'Add to or remove from the selection', bindings: [['Shift', 'Click']] },
  { text: 'Select with a box', bindings: [['Shift', 'Drag']] },
  { text: 'Move a block, note or the title (snaps to alignment)', bindings: [['Drag']] },
  { text: 'Move without snapping', bindings: [[ALT, 'Drag']] },
  { text: 'Resize the selected block', bindings: [['Drag a handle']] },
  { text: 'Bend or straighten a line', bindings: [['Drag a line handle']] },
  { text: 'Connect from a side', bindings: [['Drag a connection point']] },
  { text: 'Pan', bindings: [['Drag the background']] },
  { text: 'Zoom', bindings: [['Scroll'], ['Pinch']] },
  { text: 'Reorder lanes', bindings: [['Drag a lane header']] },
];

export function ShortcutList() {
  const store = useStore();
  const open = useStoreState((s) => !!s.panels[SHORTCUTS_PANEL]);

  // Escape closes the list before it clears the selection (the global handler skips a prevented event).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isTyping(e.target) || store.getState().editing) return;
      e.preventDefault();
      store.togglePanel(SHORTCUTS_PANEL, false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, store]);

  return (
    <>
      <button
        type="button"
        className={`fm-shortcuts-btn${open ? ' fm-active' : ''}`}
        data-testid="shortcuts-toggle"
        data-canvas-control
        title="Keyboard shortcuts (?)"
        aria-label="Keyboard shortcuts"
        aria-expanded={open}
        onClick={() => store.togglePanel(SHORTCUTS_PANEL)}
      >
        ?
      </button>
      {open ? (
        <section className="fm-shortcuts" data-testid="shortcuts" aria-label="Keyboard shortcuts">
          <header className="fm-shortcuts-head">
            <span>Keyboard shortcuts</span>
            <button type="button" className="fm-notice-close" aria-label="Close" onClick={() => store.togglePanel(SHORTCUTS_PANEL, false)}>
              ×
            </button>
          </header>
          <div className="fm-shortcuts-body">
            <Table rows={keyboardRows(COMMANDS)} />
            <div className="fm-shortcuts-sub">Mouse</div>
            <Table rows={MOUSE} />
            <p className="fm-shortcuts-note">Shortcuts don’t fire while you’re typing in an editor or a field.</p>
          </div>
        </section>
      ) : null}
    </>
  );
}

function Table({ rows }: { rows: Row[] }) {
  return (
    <dl className="fm-shortcut-rows">
      {rows.map((r) => (
        <div className="fm-shortcut-row" key={r.text}>
          <dt>{r.text}</dt>
          <dd>
            {r.bindings.map((caps, i) => (
              <span key={i} className="fm-binding">
                {i > 0 ? <span className="fm-or">or</span> : null}
                {caps.map((c, j) => (
                  <kbd key={j}>{c}</kbd>
                ))}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
