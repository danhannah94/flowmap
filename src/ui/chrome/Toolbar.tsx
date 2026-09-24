// The top bar: back to the list, the diagram's name, the command toolbar (§8.3 test ids), save status, theme toggle.
import { command, TOOLBAR, type Command } from '../commands';
import { isEnabled } from '../commands/types';
import { shallow, useStore, useStoreState } from '../store/hooks';
import { icons } from './icons';
import { SaveStatus } from './SaveStatus';

function ToolButton({ cmd }: { cmd: Command }) {
  const store = useStore();
  // Re-render on any state change that flips enabled/active (cheap: a couple of booleans).
  const [enabled, active] = useStoreState((s) => [isEnabled(cmd, s, store), cmd.active?.(s) ?? false] as const, shallow);
  const shortcut = cmd.keys?.[0];
  return (
    <button
      type="button"
      className={`fm-tool${active ? ' fm-active' : ''}`}
      data-testid={cmd.id}
      title={shortcut ? `${cmd.title} (${prettyKey(shortcut)})` : cmd.title}
      aria-label={cmd.title}
      aria-pressed={cmd.active ? active : undefined}
      disabled={!enabled}
      onClick={() => cmd.run(store)}
    >
      {cmd.icon ?? <span className="fm-tool-text">{cmd.title}</span>}
    </button>
  );
}

export function prettyKey(k: string): string {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return k
    .replace(/^shift\+mod\+/, mac ? '⇧⌘' : 'Ctrl+Shift+')
    .replace(/^mod\+/, mac ? '⌘' : 'Ctrl+')
    .replace(/^shift\+/, mac ? '⇧' : 'Shift+')
    .replace('Arrow', '')
    .replace(/(^|[⌘⇧+])([a-z])$/, (_m, p: string, c: string) => p + c.toUpperCase());
}

export function Toolbar() {
  return (
    <div className="fm-toolbar" role="toolbar" aria-label="Diagram tools">
      {TOOLBAR.map((group, i) => (
        <div className="fm-tool-group" key={i}>
          {group.map((id) => {
            const cmd = command(id);
            return cmd ? <ToolButton key={id} cmd={cmd} /> : null;
          })}
        </div>
      ))}
    </div>
  );
}

export function ThemeToggle() {
  const store = useStore();
  const theme = useStoreState((s) => s.theme);
  return (
    <button
      type="button"
      className="fm-tool"
      data-testid="theme-toggle"
      title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
      aria-label="Switch light / dark"
      onClick={() => store.toggleTheme()}
    >
      {theme === 'dark' ? icons.sun : icons.moon}
    </button>
  );
}

export function TopBar() {
  const file = useStoreState((s) => s.file);
  const title = useStoreState((s) => s.derived?.doc.title ?? '');
  return (
    <header className="fm-topbar">
      <div className="fm-topbar-left">
        <a className="fm-home" href="/" title="All diagrams">
          <Logo />
        </a>
        <div className="fm-docname">
          <span className="fm-docname-title">{title || file.replace(/\.mmd$/i, '')}</span>
          <span className="fm-docname-file">{file}</span>
        </div>
      </div>
      <Toolbar />
      <div className="fm-topbar-right">
        <SaveStatus />
        <ThemeToggle />
      </div>
    </header>
  );
}

export function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="9" width="12" height="14" rx="3.5" fill="var(--accent)" />
      <path d="M14 16h6" stroke="var(--muted)" strokeWidth="2.5" />
      <path d="M20 16l7-6.5v13z" fill="var(--muted)" />
    </svg>
  );
}
