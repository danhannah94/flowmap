// UI1: the home page lists the current folder's subfolders then its diagrams; `?dir=<path>` remembers the folder
// (design.md §8.2 amendment A16). Folders are real subdirectories of the served root, so a diagram's id is its
// root-relative path without the `.mmd` extension (`brehob/stage-2`), and `?file=` is that id plus `.mmd`.
import { useEffect, useRef, useState } from 'react';
import {
  createDiagram, createFolder, deleteDiagram, deleteFolder, listFolder, moveDiagram, renameFolder,
  type FolderListing, type LinkRewrite,
} from '../api';
import { ConfirmDialog, Notices } from '../chrome/Panels';
import { Logo, ThemeToggle } from '../chrome/Toolbar';
import { linkRewriteMessage } from '../links';
import { useStore } from '../store/hooks';
import { baseNameOf, crumbs, currentDir, folderOf, homeHref, joinDir } from './paths';

/** The drag data MIME a diagram row's drag carries (its root-relative `.mmd` path): a folder row, and a breadcrumb
 *  segment, both accept a drop of this type as "move here" (design.md A16). */
const DRAG_MIME = 'application/x-flowmap-diagram';

export function HomePage() {
  const store = useStore();
  const dir = currentDir();
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<string | null>(null); // the file a "Move to…" dialog is open for

  const reload = () => listFolder(dir).then(setListing, (e: Error) => setError(e.message));
  useEffect(() => {
    document.title = dir ? `${dir} · flowmap` : 'flowmap';
    setListing(null);
    setError(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir]);

  const handleDeleteDiagram = async (file: string) => {
    const ok = await store.confirm({
      message: `Delete ${baseNameOf(file)}?`,
      detail: 'It moves to .flowmap-trash in this folder.',
      yes: 'Delete',
      no: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    const r = await deleteDiagram(file);
    if (r.ok) setListing((cur) => (cur ? { ...cur, diagrams: cur.diagrams.filter((f) => f !== file) } : cur));
    else store.toast(`Couldn’t delete ${baseNameOf(file)}: ${r.error}`);
  };

  const handleMove = async (file: string, to: string) => {
    if (folderOf(file) === to) return;
    const r = await moveDiagram(file, to);
    if (r.ok) {
      setListing((cur) => (cur ? { ...cur, diagrams: cur.diagrams.filter((f) => f !== file) } : cur));
      const links = linkRewriteMessage(r.rewrittenLinks);
      if (links) store.toast(`Moved. ${links}`, 'info');
    } else store.toast(`Couldn’t move ${baseNameOf(file)}: ${r.error}`);
  };

  const handleDeleteFolder = async (folder: string) => {
    const ok = await store.confirm({
      message: `Delete folder ${baseNameOf(folder)}?`,
      detail: 'Only works while the folder is empty.',
      yes: 'Delete',
      no: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    const r = await deleteFolder(folder);
    if (r.ok) setListing((cur) => (cur ? { ...cur, folders: cur.folders.filter((f) => f !== folder) } : cur));
    else store.toast(r.error);
  };

  const handleRenameFolder = async (folder: string, name: string) => {
    const r = await renameFolder(folder, name);
    if (r.ok) {
      reload();
      const links = linkRewriteMessage(r.rewrittenLinks);
      if (links) store.toast(`Renamed. ${links}`, 'info');
    } else store.toast(r.error);
    return r;
  };

  return (
    <div className="fm-app">
      <header className="fm-topbar">
        <div className="fm-topbar-left">
          <a className="fm-home" href="/" title="All diagrams">
            <Logo />
          </a>
          <div className="fm-docname">
            <span className="fm-docname-title">flowmap</span>
          </div>
        </div>
        <div />
        <div className="fm-topbar-right">
          <ThemeToggle />
        </div>
      </header>
      <main className="fm-homepage">
        <div className="fm-home-card">
          <Breadcrumbs dir={dir} onDropOn={(to, file) => void handleMove(file, to)} />
          <div className="fm-home-head">
            <h1>Diagrams</h1>
            <div className="fm-home-head-actions">
              <NewFolder dir={dir} taken={listing?.folders.map(baseNameOf) ?? []} onCreated={reload} />
              <NewDiagram dir={dir} taken={listing?.diagrams ?? []} />
            </div>
          </div>
          {error ? <p className="fm-error-text">Couldn’t list this folder: {error}</p> : null}
          {listing === null && !error ? <p className="fm-muted">Loading…</p> : null}
          {listing && listing.folders.length === 0 && listing.diagrams.length === 0 ? (
            <p className="fm-muted">Nothing here yet. Start a diagram, or add a folder.</p>
          ) : null}

          {listing && listing.folders.length > 0 ? (
            <ul data-testid="folder-list" className="fm-diagram-list fm-folder-list">
              {listing.folders.map((f) => (
                <FolderRow
                  key={f}
                  folder={f}
                  onDelete={() => void handleDeleteFolder(f)}
                  onRename={(name) => handleRenameFolder(f, name)}
                  onDropDiagram={(file) => void handleMove(file, f)}
                />
              ))}
            </ul>
          ) : null}

          {listing && listing.diagrams.length > 0 ? (
            <ul data-testid="diagram-list" className="fm-diagram-list">
              {listing.diagrams.map((f) => (
                <DiagramRow
                  key={f}
                  file={f}
                  onDelete={() => void handleDeleteDiagram(f)}
                  onMoveTo={() => setMoveTarget(f)}
                />
              ))}
            </ul>
          ) : null}
        </div>
      </main>
      {moveTarget ? (
        <MoveToDialog
          file={moveTarget}
          onClose={() => setMoveTarget(null)}
          onMoved={(rewrittenLinks) => {
            setListing((cur) => (cur ? { ...cur, diagrams: cur.diagrams.filter((f) => f !== moveTarget) } : cur));
            const links = linkRewriteMessage(rewrittenLinks);
            if (links) store.toast(`Moved. ${links}`, 'info');
            setMoveTarget(null);
          }}
        />
      ) : null}
      <ConfirmDialog />
      <Notices />
    </div>
  );
}

function Breadcrumbs({ dir, onDropOn }: { dir: string; onDropOn: (to: string, file: string) => void }) {
  const items = crumbs(dir);
  return (
    <nav data-testid="breadcrumbs" className="fm-breadcrumbs" aria-label="Folder">
      <Crumb label="Root" dir="" current={dir === ''} onDropOn={onDropOn} />
      {items.map((c, i) => (
        <span key={c.dir} className="fm-crumb-group">
          <span className="fm-crumb-sep" aria-hidden="true">/</span>
          <Crumb label={c.label} dir={c.dir} current={i === items.length - 1} onDropOn={onDropOn} />
        </span>
      ))}
    </nav>
  );
}

function Crumb({ label, dir, current, onDropOn }: { label: string; dir: string; current: boolean; onDropOn: (to: string, file: string) => void }) {
  const [over, setOver] = useState(false);
  return (
    <a
      href={homeHref(dir)}
      data-testid="breadcrumb"
      data-dir={dir}
      className={`fm-crumb${current ? ' fm-crumb-current' : ''}${over ? ' fm-drop-target' : ''}`}
      aria-current={current ? 'page' : undefined}
      onClick={(e) => {
        if (current) e.preventDefault(); // already here: don't reload for nothing
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.getData(DRAG_MIME);
        if (file) onDropOn(dir, file);
      }}
    >
      {label}
    </a>
  );
}

function NewFolder({ dir, taken, onCreated }: { dir: string; taken: readonly string[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    if (taken.includes(trimmed)) {
      setError(`"${trimmed}" already exists`);
      return;
    }
    setBusy(true);
    const r = await createFolder(dir, trimmed);
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      setName('');
      onCreated();
    } else {
      setError(r.error);
    }
  };
  if (!open) {
    return (
      <button type="button" className="fm-btn" data-testid="new-folder" onClick={() => setOpen(true)}>
        New folder
      </button>
    );
  }
  return (
    <form
      className="fm-new-folder"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setOpen(false);
          setName('');
          setError(null);
        }
      }}
    >
      <input
        autoFocus
        className="fm-new-diagram-input"
        data-testid="new-folder-input"
        placeholder="Folder name"
        aria-label="New folder name"
        value={name}
        spellCheck={false}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
      />
      <button type="submit" className="fm-btn fm-btn-primary" disabled={!name.trim() || busy}>
        Create
      </button>
      {error ? <div className="fm-new-diagram-note fm-error-text">{error}</div> : null}
    </form>
  );
}

function FolderRow({
  folder, onDelete, onRename, onDropDiagram,
}: {
  folder: string;
  onDelete: () => void;
  onRename: (name: string) => Promise<{ ok: boolean; error?: string }>;
  onDropDiagram: (file: string) => void;
}) {
  const name = baseNameOf(folder);
  const [over, setOver] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);

  if (renaming) {
    return (
      <li className="fm-diagram-row fm-folder-row">
        <form
          className="fm-folder-rename"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await onRename(value.trim());
            if (r.ok) setRenaming(false);
            else setError(r.error ?? 'Couldn’t rename');
          }}
        >
          <input
            autoFocus
            data-testid="folder-rename-input"
            className="fm-new-diagram-input"
            value={value}
            spellCheck={false}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
          <button type="submit" className="fm-btn fm-btn-primary">Rename</button>
          <button type="button" className="fm-btn" onClick={() => setRenaming(false)}>Cancel</button>
          {error ? <div className="fm-error-text">{error}</div> : null}
        </form>
      </li>
    );
  }

  return (
    <li className="fm-diagram-row fm-folder-row">
      <a
        href={homeHref(folder)}
        data-testid="folder-link"
        data-folder={folder}
        className={over ? 'fm-drop-target' : ''}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.getData(DRAG_MIME);
          if (file) onDropDiagram(file);
        }}
      >
        <span className="fm-diagram-name">
          <FolderIcon /> {name}
        </span>
      </a>
      <RowMenu
        testid="folder-menu"
        target={folder}
        items={[
          { testid: 'folder-rename', label: 'Rename', onClick: () => setRenaming(true) },
          { testid: 'folder-delete', label: 'Delete', danger: true, onClick: onDelete },
        ]}
      />
    </li>
  );
}

function DiagramRow({ file, onDelete, onMoveTo }: { file: string; onDelete: () => void; onMoveTo: () => void }) {
  const name = baseNameOf(file).replace(/\.mmd$/i, '');
  return (
    <li className="fm-diagram-row">
      <a
        data-file={file}
        href={`/?file=${encodeURIComponent(file)}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_MIME, file);
          e.dataTransfer.setData('text/plain', file);
          e.dataTransfer.effectAllowed = 'move';
        }}
      >
        <span className="fm-diagram-name">{name}</span>
        <span className="fm-diagram-file">{baseNameOf(file)}</span>
      </a>
      <RowMenu
        testid="diagram-menu"
        target={file}
        items={[
          { testid: 'diagram-move-to', label: 'Move to…', onClick: onMoveTo },
          { testid: 'diagram-delete', label: 'Delete', danger: true, onClick: onDelete },
        ]}
      />
    </li>
  );
}

interface MenuItemDef {
  testid: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

/** A small "…" menu opener plus a fixed-position popover (the same pattern as the canvas's lane menu, scaled down
 *  for a plain scrolling list: no canvas pan/zoom to track, so the popover just anchors under the opener). Used by
 *  both diagram rows (Move to…, Delete) and folder rows (Rename, Delete) — "the existing delete-diagram menu is the
 *  pattern" the brief for this feature points at. */
function RowMenu({ testid, target, items }: { testid: string; target: string; items: MenuItemDef[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(8, r.right - 180), top: r.bottom + 6 });
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.(`.fm-row-popover, [data-testid="${testid}"][data-row-target="${CSS.escape(target)}"]`)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, testid, target]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`fm-diagram-delete-btn fm-row-menu-btn${open ? ' fm-open' : ''}`}
        data-testid={testid}
        data-row-target={target}
        title="Options"
        aria-label="Options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
      >
        <DotsIcon />
      </button>
      {open && pos ? (
        <div
          ref={popRef}
          className="fm-lane-popover fm-row-popover"
          role="menu"
          style={{ left: pos.left, top: pos.top, width: 180 }}
        >
          {items.map((it) => (
            <button
              key={it.testid}
              type="button"
              role="menuitem"
              className={`fm-menu-item${it.danger ? ' fm-danger' : ''}`}
              data-testid={it.testid}
              data-diagram-file={target}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              <span className="fm-menu-label">{it.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** The file name for a new diagram's name: lowercase words joined by `-` (`Purchase approval` → `purchase-approval.mmd`). */
function diagramFileName(name: string): string | null {
  const slug = name.trim().toLowerCase().replace(/\.mmd$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? `${slug}.mmd` : null;
}

/** What a new diagram starts as (amendment A4). Both write the same empty `.mmd`; the choice only shapes the first steps. */
type NewMode = 'flowchart' | 'swimlanes';

const NEW_MODES: { mode: NewMode; label: string; note: string }[] = [
  { mode: 'flowchart', label: 'Flowchart', note: 'Blocks and lines, no lanes' },
  { mode: 'swimlanes', label: 'Swimlanes', note: 'A lane for each role or team' },
];

/**
 * Name a new diagram, choose Flowchart (no lanes) or Swimlanes, create its empty `.mmd` in the current folder
 * (design.md A16), and open it. The choice is a UI convenience (A4): the file is the same `flowchart LR` either
 * way, and the editor's first-steps hint follows the choice (`&new=` on the editor's address).
 */
function NewDiagram({ dir, taken }: { dir: string; taken: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<NewMode>('flowchart');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bareFile = diagramFileName(name);
  const file = bareFile ? joinDir(dir, bareFile) : null;
  const submit = async () => {
    if (!file || busy) return;
    if (taken.includes(file)) {
      setError(`${baseNameOf(file)} already exists`);
      return;
    }
    setBusy(true);
    const r = await createDiagram(file);
    setBusy(false);
    if (r.ok) location.href = `/?file=${encodeURIComponent(file)}&new=${mode}`;
    else setError(r.error);
  };
  const cancel = () => {
    setOpen(false);
    setName('');
    setError(null);
  };
  if (!open) {
    return (
      <button type="button" className="fm-btn fm-btn-primary" onClick={() => setOpen(true)}>
        New diagram
      </button>
    );
  }
  return (
    <form
      className="fm-new-diagram"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') cancel();
      }}
    >
      <input
        autoFocus
        className="fm-new-diagram-input"
        placeholder="Name, e.g. Purchase approval"
        aria-label="New diagram name"
        value={name}
        spellCheck={false}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
      />
      <button type="submit" className="fm-btn fm-btn-primary" disabled={!file || busy}>
        Create
      </button>
      <div className="fm-new-diagram-kind" role="radiogroup" aria-label="Kind of diagram">
        {NEW_MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={mode === m.mode}
            data-mode={m.mode}
            className={`fm-new-diagram-choice${mode === m.mode ? ' fm-active' : ''}`}
            onClick={() => setMode(m.mode)}
          >
            <KindIcon mode={m.mode} />
            <span className="fm-new-diagram-choice-text">
              <span className="fm-new-diagram-choice-label">{m.label}</span>
              <span className="fm-new-diagram-choice-note">{m.note}</span>
            </span>
          </button>
        ))}
      </div>
      <div className={error ? 'fm-new-diagram-note fm-error-text' : 'fm-new-diagram-note'}>
        {error ?? (file ? `Creates ${file}` : 'Enter to create, Esc to cancel')}
      </div>
    </form>
  );
}

/** A tiny picture of each kind of diagram: three linked boxes, bare or in two lanes. */
function KindIcon({ mode }: { mode: NewMode }) {
  return (
    <svg width="34" height="24" viewBox="0 0 34 24" aria-hidden="true" className="fm-new-diagram-icon">
      {mode === 'swimlanes' ? (
        <>
          <rect x="0.5" y="0.5" width="33" height="11.5" rx="2" fill="none" stroke="currentColor" strokeOpacity="0.45" />
          <rect x="0.5" y="12" width="33" height="11.5" rx="2" fill="none" stroke="currentColor" strokeOpacity="0.45" />
          <rect x="4" y="3.5" width="8" height="5.5" rx="1" fill="currentColor" />
          <rect x="22" y="15" width="8" height="5.5" rx="1" fill="currentColor" />
          <path d="M12 6.25h5v11.5h5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </>
      ) : (
        <>
          <rect x="1" y="9" width="8" height="6" rx="1" fill="currentColor" />
          <path d="M17 6l4.5 6-4.5 6-4.5-6z" fill="currentColor" />
          <rect x="25" y="9" width="8" height="6" rx="1" fill="currentColor" />
          <path d="M9 12h3.5M21.5 12H25" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </>
      )}
    </svg>
  );
}

/** The "Move to…" menu item's dialog: a tiny folder browser (breadcrumbs + subfolders of wherever it's looking),
 *  with a "Move here" button that moves the diagram into the folder currently shown (design.md A16). */
function MoveToDialog({
  file, onClose, onMoved,
}: {
  file: string;
  onClose: () => void;
  onMoved: (rewrittenLinks?: LinkRewrite[]) => void;
}) {
  const [dir, setDir] = useState(folderOf(file));
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setListing(null);
    listFolder(dir).then(setListing, (e: Error) => setError(e.message));
  }, [dir]);

  const move = async () => {
    setBusy(true);
    const r = await moveDiagram(file, dir);
    setBusy(false);
    if (r.ok) onMoved(r.rewrittenLinks);
    else setError(r.error);
  };

  const items = crumbs(dir);
  const here = folderOf(file) === dir;

  return (
    <div className="fm-modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="fm-modal fm-move-dialog"
        data-testid="move-to-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Move ${baseNameOf(file)}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="fm-modal-message">Move {baseNameOf(file).replace(/\.mmd$/i, '')}</div>
        <nav className="fm-move-crumbs" aria-label="Destination folder">
          <button type="button" className="fm-crumb" data-testid="move-to-crumb" data-dir="" onClick={() => setDir('')}>
            Root
          </button>
          {items.map((c) => (
            <span key={c.dir}>
              <span className="fm-crumb-sep" aria-hidden="true">/</span>
              <button type="button" className="fm-crumb" data-testid="move-to-crumb" data-dir={c.dir} onClick={() => setDir(c.dir)}>
                {c.label}
              </button>
            </span>
          ))}
        </nav>
        <ul className="fm-move-folder-list" data-testid="move-to-folders">
          {listing?.folders.map((f) => (
            <li key={f}>
              <button type="button" className="fm-btn fm-move-folder-btn" data-testid="move-to-folder" data-folder={f} onClick={() => setDir(f)}>
                <FolderIcon /> {baseNameOf(f)}
              </button>
            </li>
          ))}
          {listing && listing.folders.length === 0 ? <li className="fm-muted">No subfolders here</li> : null}
        </ul>
        {error ? <p className="fm-error-text">{error}</p> : null}
        <div className="fm-modal-actions">
          <button type="button" className="fm-btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="fm-btn fm-btn-primary"
            data-testid="move-to-here"
            disabled={busy || here}
            title={here ? 'Already here' : undefined}
            onClick={() => void move()}
          >
            Move here
          </button>
        </div>
      </div>
    </div>
  );
}

function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.4" fill="currentColor" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.4" fill="currentColor" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 2 }}>
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h9A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  );
}
