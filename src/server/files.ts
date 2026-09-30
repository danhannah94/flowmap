// Reading, writing and validating the three files beside a `.mmd` (design.md §2, §8.2, amendment A16). No parsing
// of their contents happens here — the server treats `.mmd`/`.flow.yaml`/`.layout.json` as opaque text; only the
// CLI's `src/core` parses them. Node built-ins only.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';

import { contentHash } from './hash.js';

export type FileKey = 'mmd' | 'config' | 'layout';

export interface DiagramFiles {
  mmd: string | null;
  config: string | null;
  layout: string | null;
}

export interface DiagramVersions {
  mmd: string | null;
  config: string | null;
  layout: string | null;
}

export interface DiagramSnapshot {
  files: DiagramFiles;
  versions: DiagramVersions;
}

/** A PUT's desired end state for the three files: each a string to write, or `null` to delete. */
export type FilesPatch = Record<FileKey, string | null>;

/** Folders the tree never shows or lets an operation reach into (design.md §8.2 A16: "ignore dot-folders,
 *  node_modules and the `exports` folder"). A dot-folder is any segment starting with `.` (this also covers
 *  `.flowmap-trash`, which must never be browsed or written to through these paths). */
function isReservedSegment(seg: string): boolean {
  return seg.startsWith('.') || seg === 'node_modules' || seg === 'exports';
}

/**
 * Splits a root-relative posix path into segments, rejecting a leading slash, a backslash (Windows separator or an
 * escape attempt), and any segment that is empty, `.`, `..`, or contains `..` (design.md §8.2: "reject `..`,
 * absolute paths"). Doesn't touch the filesystem or apply the reserved-name rule above — see `isValidDirPath`,
 * `isValidMmdName` and `resolveInRoot`, which do.
 */
function splitRelPath(path: string): string[] | null {
  if (path.includes('\\') || path.startsWith('/')) return null;
  const segments = path.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..' || seg.includes('..')) return null;
  }
  return segments;
}

/**
 * True for a root-relative folder path (design.md §8.2, A16): every segment valid (see `splitRelPath`) and none of
 * them a dot-folder, `node_modules` or `exports`. `''` (the served root itself) is valid.
 */
export function isValidDirPath(dir: string | null | undefined): dir is string {
  if (dir === null || dir === undefined) return false;
  if (dir === '') return true;
  const segments = splitRelPath(dir);
  return !!segments && segments.every((seg) => !isReservedSegment(seg));
}

/** True for a single folder name with no separators (what "create folder" and "rename folder" take). */
export function isValidFolderName(name: string | null | undefined): name is string {
  if (!name) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name === '.' || name === '..' || name.includes('..')) return false;
  return !isReservedSegment(name);
}

/**
 * True for a `.mmd` path relative to the served directory: any number of folder segments (design.md §8.2, A16: "a
 * diagram's id/path becomes its root-relative path without extension"), none of them a dot-folder, `node_modules`
 * or `exports`, then a bare file name that isn't itself a dot-file. A bare `<name>.mmd` (no folder) still works, so
 * existing flat directories keep working unchanged.
 */
export function isValidMmdName(file: string | null | undefined): file is string {
  if (!file) return false;
  if (!/\.mmd$/i.test(file)) return false;
  const segments = splitRelPath(file);
  if (!segments) return false;
  const name = segments[segments.length - 1]!;
  if (name === '.mmd' || name.startsWith('.')) return false;
  return segments.slice(0, -1).every((seg) => !isReservedSegment(seg));
}

/** The folder part of a root-relative path (`''` when it has none), and the bare file/folder name at its end. */
export function folderOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? '' : relPath.slice(0, idx);
}
export function baseNameOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx === -1 ? relPath : relPath.slice(idx + 1);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}

/** Thrown by `resolveInRoot` when a path (its own segments valid, but a symlink among its ancestors) would land
 *  outside the served root. */
export class PathTraversalError extends Error {
  constructor(relPath: string) {
    super(`"${relPath}" would escape the served directory`);
    this.name = 'PathTraversalError';
  }
}

/**
 * Resolves a root-relative path to an absolute one and refuses it if it (or, for a path that doesn't exist yet, its
 * nearest existing ancestor) resolves through a symlink to somewhere outside `root` (design.md §8.2: "reject …
 * symlinks escaping the root"). Callers still validate the path's own segments first (`isValidDirPath`/
 * `isValidMmdName`/`isValidFolderName`, which reject `..` and absolute paths); this is the filesystem-level check
 * those can't do on their own, since a segment can look innocent and still be a symlink.
 */
export async function resolveInRoot(root: string, relPath: string): Promise<string> {
  const target = join(root, relPath);
  const rootReal = await realpath(root);
  const tail: string[] = [];
  let dir = target;
  let real: string;
  for (;;) {
    try {
      real = await realpath(dir);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      const parent = dirname(dir);
      if (parent === dir) throw new PathTraversalError(relPath); // reached the filesystem root without a hit
      tail.unshift(basename(dir));
      dir = parent;
    }
  }
  const resolved = tail.length ? join(real, ...tail) : real;
  if (resolved !== rootReal && !resolved.startsWith(rootReal + sep)) {
    throw new PathTraversalError(relPath);
  }
  return target;
}

/** The config and layout file names beside a `.mmd` file, by base name (design.md §2). */
export function diagramFileNames(mmdFile: string): { mmd: string; config: string; layout: string } {
  const base = mmdFile.replace(/\.mmd$/i, '');
  return { mmd: mmdFile, config: `${base}.flow.yaml`, layout: `${base}.layout.json` };
}

export async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/** How deep `listMmdFiles` walks below the served root (design.md §8.2 A16: "sensible depth limit"). Generous for
 *  any real project tree; a stop against a runaway symlink loop or an accidentally-served huge directory. */
export const MAX_FOLDER_DEPTH = 12;

/** Every `.mmd` file under `dir`, recursively (design.md §8.2 A16: "list diagrams recursively"), as root-relative
 *  posix paths (`"a.mmd"`, `"brehob/stage-2.mmd"`), sorted. Skips dot-folders (so `.flowmap-trash` and any other
 *  hidden folder are invisible here), `node_modules` and `exports`, and stops descending past `MAX_FOLDER_DEPTH`. */
export async function listMmdFiles(dir: string, maxDepth = MAX_FOLDER_DEPTH): Promise<string[]> {
  const out: string[] = [];
  async function walk(rel: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(join(dir, rel), { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return;
      throw e;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (isReservedSegment(e.name) || depth >= maxDepth) continue;
        await walk(rel ? `${rel}/${e.name}` : e.name, depth + 1);
      } else if (e.isFile() && /\.mmd$/i.test(e.name) && !e.name.startsWith('.')) {
        out.push(rel ? `${rel}/${e.name}` : e.name);
      }
    }
  }
  await walk('', 0);
  return out.sort((a, b) => a.localeCompare(b));
}

export interface FolderListing {
  /** Immediate subfolders of the requested folder, as root-relative posix paths, sorted. */
  folders: string[];
  /** `.mmd` files directly inside the requested folder (not its subfolders), as root-relative posix paths, sorted. */
  diagrams: string[];
}

/** One folder's immediate contents (design.md §8.2 A16: the home screen's "current folder"), so an empty folder is
 *  still discoverable (unlike `listMmdFiles`, which only sees folders holding at least one diagram). `relDir` is
 *  `''` for the served root. Reserved folders (dot-folders, `node_modules`, `exports`) are left out, same as above. */
export async function listFolder(dir: string, relDir: string): Promise<FolderListing> {
  const target = join(dir, relDir);
  let entries;
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { folders: [], diagrams: [] };
    throw e;
  }
  const folders: string[] = [];
  const diagrams: string[] = [];
  for (const e of entries) {
    const relPath = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!isReservedSegment(e.name)) folders.push(relPath);
    } else if (e.isFile() && /\.mmd$/i.test(e.name) && !e.name.startsWith('.')) {
      diagrams.push(relPath);
    }
  }
  folders.sort((a, b) => a.localeCompare(b));
  diagrams.sort((a, b) => a.localeCompare(b));
  return { folders, diagrams };
}

export interface FolderOpResult {
  ok: boolean;
  error?: string;
  code?: 'not-found' | 'not-empty' | 'exists';
}

/** Creates a folder (design.md §8.2 A16). Refused if something is already there. */
export async function createFolder(dir: string, relDir: string): Promise<FolderOpResult> {
  const target = join(dir, relDir);
  if (await pathExists(target)) return { ok: false, code: 'exists', error: `"${baseNameOf(relDir)}" already exists` };
  await mkdir(target, { recursive: true });
  return { ok: true };
}

/** Renames a folder's last path segment, keeping it in the same parent (design.md §8.2 A16). Everything inside
 *  moves with it (a single directory rename), diagrams included; their ids (root-relative paths) change, which is
 *  why moving/renaming and `link:` rewriting are the same concern (see `moveDiagram`). */
export async function renameFolder(dir: string, relDir: string, newName: string): Promise<FolderOpResult> {
  const parent = folderOf(relDir);
  const from = join(dir, relDir);
  const to = join(dir, parent ? `${parent}/${newName}` : newName);
  if (!(await pathExists(from))) return { ok: false, code: 'not-found', error: `"${relDir}" does not exist` };
  if (from !== to && (await pathExists(to))) return { ok: false, code: 'exists', error: `"${newName}" already exists` };
  await rename(from, to);
  return { ok: true };
}

/** Deletes a folder, refusing (design.md §8.2 A16) unless it's empty. A stray `.DS_Store` (macOS) doesn't count as
 *  content and is removed along with the folder. */
export async function deleteFolder(dir: string, relDir: string): Promise<FolderOpResult> {
  const target = join(dir, relDir);
  let entries: string[];
  try {
    entries = await readdir(target);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, code: 'not-found', error: `"${relDir}" does not exist` };
    throw e;
  }
  const real = entries.filter((n) => n !== '.DS_Store');
  if (real.length > 0) {
    return { ok: false, code: 'not-empty', error: `"${baseNameOf(relDir) || relDir}" isn't empty: move or delete what's in it first` };
  }
  await deleteIfExists(join(target, '.DS_Store'));
  await rmdir(target);
  return { ok: true };
}

export interface MoveDiagramResult {
  ok: boolean;
  /** The diagram's new root-relative `.mmd` path, when `ok` is true. */
  file?: string;
  error?: string;
  code?: 'not-found' | 'exists';
}

/**
 * Moves a diagram's files — its `.mmd`, `.flow.yaml` and `.layout.json` (whichever exist), plus anything else beside
 * it that shares its base name (design.md §8.2 A16) — into `toDir` (root-relative, `''` for the served root),
 * keeping their file names. Exposed as this one function so a future step can rewrite `link:` values that point at
 * the diagram's old path (not implemented here; see the amendment). Refused if the diagram doesn't exist, if it's
 * already in `toDir`, or if a file with the same name already exists there.
 */
export async function moveDiagram(dir: string, mmdFile: string, toDir: string): Promise<MoveDiagramResult> {
  const fromDir = folderOf(mmdFile);
  const base = baseNameOf(mmdFile).replace(/\.mmd$/i, '');
  const fromDirAbs = join(dir, fromDir);
  const toDirAbs = join(dir, toDir);
  if (fromDir === toDir) return { ok: false, error: `"${mmdFile}" is already in that folder` };
  if (!(await pathExists(join(fromDirAbs, `${base}.mmd`)))) {
    return { ok: false, code: 'not-found', error: `"${mmdFile}" does not exist` };
  }
  let entries: string[];
  try {
    entries = (await readdir(fromDirAbs, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.startsWith(`${base}.`))
      .map((e) => e.name);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') entries = [];
    else throw e;
  }
  await mkdir(toDirAbs, { recursive: true });
  for (const name of entries) {
    if (await pathExists(join(toDirAbs, name))) {
      return { ok: false, code: 'exists', error: `"${name}" already exists in the destination folder` };
    }
  }
  for (const name of entries) {
    await rename(join(fromDirAbs, name), join(toDirAbs, name));
  }
  return { ok: true, file: toDir ? `${toDir}/${base}.mmd` : `${base}.mmd` };
}

export async function readDiagram(dir: string, mmdFile: string): Promise<DiagramSnapshot> {
  const names = diagramFileNames(mmdFile);
  const [mmd, config, layout] = await Promise.all([
    readOptional(join(dir, names.mmd)),
    readOptional(join(dir, names.config)),
    readOptional(join(dir, names.layout)),
  ]);
  return {
    files: { mmd, config, layout },
    versions: {
      mmd: mmd === null ? null : contentHash(mmd),
      config: config === null ? null : contentHash(config),
      layout: layout === null ? null : contentHash(layout),
    },
  };
}

/** Atomic write (design.md UI30): a temp file in the same directory, then rename. */
export async function writeAtomic(path: string, data: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, path);
}

export async function deleteIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
}

export function versionsEqual(a: DiagramVersions, b: DiagramVersions): boolean {
  return a.mmd === b.mmd && a.config === b.config && a.layout === b.layout;
}

export interface PutResult {
  /** True when the disk didn't match `base` ("disk wins", design.md §8.2): nothing was written. */
  conflict: boolean;
  /** The current snapshot: the pre-write disk state on conflict, the post-write state otherwise. */
  snapshot: DiagramSnapshot;
}

/** The file operations `applyPut` uses (a seam for tests that check their order). */
export interface PutIo {
  write(path: string, data: string): Promise<void>;
  remove(path: string): Promise<void>;
}

const DISK_IO: PutIo = { write: writeAtomic, remove: deleteIfExists };

/**
 * The order a PUT changes the three files in: the config and layout file first, the `.mmd` last. A reader or watcher
 * that keys off the `.mmd` (the UI's own tests, an editor, another tool) sees the `.mmd` change only once its
 * companions are already in their new state, so it never pairs a new `.mmd` with an old layout or config. A deleted
 * file follows the same order: companions first, the `.mmd` last.
 */
export const PUT_ORDER: readonly FileKey[] = ['config', 'layout', 'mmd'];

/** The folder, directly inside the served directory, that "deleted" diagrams move into (never listed, §8.2). */
export const TRASH_DIR_NAME = '.flowmap-trash';

export interface DeleteResult {
  ok: boolean;
  /** The folder (relative to the served directory) the files were moved into, when `ok` is true. */
  trashPath?: string;
  error?: string;
}

/**
 * "Deletes" a diagram by moving its files (the `.mmd`, and the `.flow.yaml`/`.layout.json` beside it, whichever
 * exist) into `.flowmap-trash/<timestamp>-<name>/` inside the served directory, so a misclick is recoverable by
 * hand. Never touches `exports/`. `ok: false` when the `.mmd` doesn't exist.
 */
export async function deleteDiagram(dir: string, mmdFile: string): Promise<DeleteResult> {
  const names = diagramFileNames(mmdFile);
  if ((await readOptional(join(dir, names.mmd))) === null) {
    return { ok: false, error: `"${mmdFile}" does not exist` };
  }

  const base = mmdFile.replace(/\.mmd$/i, '');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // A diagram in a folder trashes flat (its base name with '/' turned into '-'), not nested to match its old
  // folder: nothing else here needs to recurse into .flowmap-trash, and the folder it came from still reads in the
  // name.
  const trashPath = join(TRASH_DIR_NAME, `${stamp}-${base.replace(/\//g, '-')}`);
  const trashDir = join(dir, trashPath);
  await mkdir(trashDir, { recursive: true });

  // Companions first, the `.mmd` last (the same order and reasoning as `PUT_ORDER` above): a reader keyed off the
  // `.mmd` never sees it disappear while a companion is still around under the old name.
  for (const key of PUT_ORDER) {
    try {
      await rename(join(dir, names[key]), join(trashDir, names[key]));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; // config/layout may not exist; the .mmd must
    }
  }
  return { ok: true, trashPath };
}

/**
 * Applies a PUT. If the current on-disk versions don't match `base`, nothing is written and `conflict` is true
 * ("disk wins"). Otherwise writes only the files whose content actually changed and deletes those set to `null`,
 * each atomically (a temp file, then rename), in `PUT_ORDER`, then returns the new snapshot.
 */
export async function applyPut(
  dir: string, mmdFile: string, base: DiagramVersions, patch: FilesPatch, io: PutIo = DISK_IO,
): Promise<PutResult> {
  const names = diagramFileNames(mmdFile);
  const current = await readDiagram(dir, mmdFile);
  if (!versionsEqual(current.versions, base)) {
    return { conflict: true, snapshot: current };
  }

  const paths: Record<FileKey, string> = {
    mmd: join(dir, names.mmd),
    config: join(dir, names.config),
    layout: join(dir, names.layout),
  };
  for (const key of PUT_ORDER) {
    const value = patch[key];
    if (value === null) {
      if (current.files[key] !== null) await io.remove(paths[key]);
    } else if (value !== current.files[key]) {
      await io.write(paths[key], value);
    }
  }

  // Built from `patch`, not a fresh disk re-read: the conflict check above already proved the pre-write disk state
  // matched `base`, and the loop above just wrote exactly `patch` (or left a file alone because it already matched).
  // A second read here would risk picking up a *different*, genuinely external write that lands in the instant
  // between our last write and that read, and reporting it back to this PUT's caller as if it were this PUT's own
  // result — which would then have the watcher (see watcher.ts endWrite) silently adopt that external content as
  // "ours" and never broadcast it.
  const files: DiagramFiles = { mmd: patch.mmd, config: patch.config, layout: patch.layout };
  const versions: DiagramVersions = {
    mmd: files.mmd === null ? null : contentHash(files.mmd),
    config: files.config === null ? null : contentHash(files.config),
    layout: files.layout === null ? null : contentHash(files.layout),
  };
  return { conflict: false, snapshot: { files, versions } };
}
