// Reading, writing and validating the three files beside a `.mmd` (design.md §2, §8.2). No parsing of their
// contents happens here — the server treats `.mmd`/`.flow.yaml`/`.layout.json` as opaque text; only the CLI's
// `src/core` parses them. Node built-ins only.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

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

/**
 * True for a bare `<name>.mmd` file name with no path separators and no `..` segment, so it can't escape the
 * served directory (design.md §8.2: "reject `..`, slashes, absolute paths").
 */
export function isValidMmdName(file: string | null | undefined): file is string {
  if (!file) return false;
  if (file.includes('/') || file.includes('\\')) return false;
  if (file.includes('..')) return false;
  if (!/\.mmd$/i.test(file)) return false;
  if (file === '.mmd') return false;
  return true;
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

/** The `.mmd` files directly inside `dir` (non-recursive), sorted (design.md: `GET /api/diagrams`). */
export async function listMmdFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /\.mmd$/i.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
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

/**
 * Applies a PUT. If the current on-disk versions don't match `base`, nothing is written and `conflict` is true
 * ("disk wins"). Otherwise writes only the files whose content actually changed and deletes those set to `null`,
 * atomically, then returns the new snapshot.
 */
export async function applyPut(dir: string, mmdFile: string, base: DiagramVersions, patch: FilesPatch): Promise<PutResult> {
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
  for (const key of ['mmd', 'config', 'layout'] as const) {
    const value = patch[key];
    if (value === null) {
      await deleteIfExists(paths[key]);
    } else if (value !== current.files[key]) {
      await writeAtomic(paths[key], value);
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
