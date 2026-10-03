// The local server's JSON API and push channel (src/server). The UI never touches files except through here.
import type { Files } from '../core/ops';
import type { PresetFiles } from '../core/preset';

/** Each file's version (a sha1 of its content), or null when the file doesn't exist. */
export interface Versions {
  mmd: string | null;
  config: string | null;
  layout: string | null;
  /** A20: a hash of the preset pack file the config names (null: unreadable); absent while it names none. Not part of
   *  a save's conflict check; it only tells a viewer that the pack changed. */
  preset?: string | null;
}

export interface Snapshot {
  files: Files;
  versions: Versions;
  /** A20: the text of the pack file the config's `preset:` names, keyed as written (null: could not be read). */
  presets?: PresetFiles;
}

export type PutOutcome =
  | { kind: 'saved'; versions: Versions; presets?: PresetFiles }
  | { kind: 'conflict'; snapshot: Snapshot }
  | { kind: 'error'; message: string };

const q = (file: string) => `file=${encodeURIComponent(file)}`;

async function failure(res: Response): Promise<string> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  return `${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`;
}

/** Every diagram in the served directory, recursively, as root-relative `.mmd` paths (design.md §8.2 A16: e.g.
 *  `"sales/stage-2.mmd"`, same as a bare `"a.mmd"` for one with no folder). */
export async function listDiagrams(): Promise<string[]> {
  const res = await fetch('/api/diagrams');
  if (!res.ok) throw new Error(await failure(res));
  const js = (await res.json()) as unknown;
  // Accept a bare list or {diagrams: [...]}, of names or {file|name} objects.
  const list = Array.isArray(js) ? js : ((js as { diagrams?: unknown[]; files?: unknown[] }).diagrams ?? (js as { files?: unknown[] }).files ?? []);
  return list.map((d) => (typeof d === 'string' ? d : String((d as { file?: string; name?: string }).file ?? (d as { name?: string }).name)));
}

export interface FolderListing {
  dir: string;
  /** Immediate subfolders of `dir`, as root-relative paths. */
  folders: string[];
  /** `.mmd` diagrams directly inside `dir` (not its subfolders), as root-relative paths. */
  diagrams: string[];
}

/** One folder's immediate contents (design.md §8.2 A16: the home screen's current folder), so an empty subfolder
 *  still shows up even though it holds no diagram. `dir` is `''` for the served root. */
export async function listFolder(dir: string): Promise<FolderListing> {
  const res = await fetch(`/api/folder?dir=${encodeURIComponent(dir)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await failure(res));
  return (await res.json()) as FolderListing;
}

/** A17 (design.md §12): one `.flow.yaml` a move or folder rename rewrote, and how many `link:` values it changed. */
export interface LinkRewrite {
  file: string;
  count: number;
}

export type FolderOutcome =
  | { ok: true; dir: string; rewrittenLinks?: LinkRewrite[] }
  | { ok: false; error: string };

async function folderResult(res: Response): Promise<FolderOutcome> {
  if (res.ok) {
    const body = (await res.json()) as { dir: string; rewrittenLinks?: LinkRewrite[] };
    return { ok: true, dir: body.dir, rewrittenLinks: body.rewrittenLinks };
  }
  let error = await failure(res);
  try {
    const body = (await res.clone().json()) as { error?: string };
    if (body.error) error = body.error;
  } catch {
    /* keep the status-line message */
  }
  return { ok: false, error };
}

/** Creates a folder (design.md §8.2 A16). `parent` is `''` for the served root. */
export async function createFolder(parent: string, name: string): Promise<FolderOutcome> {
  const res = await fetch('/api/folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir: parent, name }),
  });
  return folderResult(res);
}

/** Renames a folder's last path segment, keeping it in its parent (design.md §8.2 A16). */
export async function renameFolder(dir: string, name: string): Promise<FolderOutcome> {
  const res = await fetch('/api/folder', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir, name }),
  });
  return folderResult(res);
}

/** Deletes an empty folder (design.md §8.2 A16); refused (with a message) if it isn't empty. */
export async function deleteFolder(dir: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`/api/folder?dir=${encodeURIComponent(dir)}`, { method: 'DELETE' });
  if (res.ok) return { ok: true };
  let error = await failure(res);
  try {
    const body = (await res.clone().json()) as { error?: string };
    if (body.error) error = body.error;
  } catch {
    /* keep the status-line message */
  }
  return { ok: false, error };
}

/**
 * Moves a diagram (its `.mmd`, `.flow.yaml`, `.layout.json` and anything else sharing its base name, §8.2 A16) into
 * folder `to` (`''` for the served root). Returns the diagram's new root-relative `.mmd` path, and (A17, §12) every
 * `.flow.yaml` elsewhere whose `link:` was rewritten to follow it.
 */
export async function moveDiagram(
  file: string, to: string,
): Promise<{ ok: true; file: string; rewrittenLinks?: LinkRewrite[] } | { ok: false; error: string }> {
  const res = await fetch('/api/diagram/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file, to }),
  });
  if (res.ok) {
    const body = (await res.json()) as { file: string; rewrittenLinks?: LinkRewrite[] };
    return { ok: true, file: body.file, rewrittenLinks: body.rewrittenLinks };
  }
  let error = await failure(res);
  try {
    const body = (await res.clone().json()) as { error?: string };
    if (body.error) error = body.error;
  } catch {
    /* keep the status-line message */
  }
  return { ok: false, error };
}

export async function fetchDiagram(file: string): Promise<Snapshot> {
  const res = await fetch(`/api/diagram?${q(file)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(await failure(res));
  const js = (await res.json()) as Snapshot;
  if (js.files.mmd === null) throw new Error(`${file} doesn't exist`);
  return js;
}

export async function putDiagram(file: string, base: Versions, files: Files): Promise<PutOutcome> {
  let res: Response;
  try {
    res = await fetch(`/api/diagram?${q(file)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base, files }),
    });
  } catch (e) {
    return { kind: 'error', message: (e as Error).message };
  }
  if (res.status === 409) return { kind: 'conflict', snapshot: (await res.json()) as Snapshot };
  if (!res.ok) return { kind: 'error', message: await failure(res) };
  const js = (await res.json()) as { versions: Versions; presets?: PresetFiles };
  return { kind: 'saved', versions: js.versions, presets: js.presets };
}

/**
 * Create a new, empty diagram (`flowchart LR`, no config or layout file). Refused if a diagram with that name exists:
 * the PUT is based on "no files", so an existing file is a conflict and nothing is written.
 */
export async function createDiagram(file: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const none: Versions = { mmd: null, config: null, layout: null };
  const out = await putDiagram(file, none, { mmd: 'flowchart LR\n', config: null, layout: null });
  if (out.kind === 'saved') return { ok: true };
  if (out.kind === 'conflict') return { ok: false, error: `${file} already exists` };
  return { ok: false, error: out.message };
}

/**
 * Deletes a diagram (moves its files into `.flowmap-trash` on the server, §8.2). Refused (404) if it doesn't exist,
 * e.g. another tab already deleted it.
 */
export async function deleteDiagram(file: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`/api/diagram?${q(file)}`, { method: 'DELETE' });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!res.ok) return { ok: false, error: await failure(res) };
  return { ok: true };
}

export async function requestExport(file: string, format: 'svg' | 'png', theme: 'light' | 'dark'): Promise<string> {
  const res = await fetch(`/api/export?${q(file)}&format=${format}&theme=${theme}`, { method: 'POST' });
  if (!res.ok) throw new Error(await failure(res));
  return ((await res.json()) as { path: string }).path;
}

/**
 * Subscribe to external changes of one diagram (server-sent events, `event: changed`). `onReconnect` fires when the
 * channel comes back after a drop, when an event may have been missed.
 */
export function subscribeChanges(
  file: string,
  onChanged: (snap: Snapshot) => void,
  onReconnect: () => void,
): () => void {
  const es = new EventSource(`/api/events?${q(file)}`);
  let dropped = false;
  es.addEventListener('changed', (ev) => {
    try {
      onChanged(JSON.parse((ev as MessageEvent<string>).data) as Snapshot);
    } catch (e) {
      console.error('flowmap: bad change event', e);
    }
  });
  es.addEventListener('error', () => {
    dropped = true;
  });
  es.addEventListener('open', () => {
    if (dropped) {
      dropped = false;
      onReconnect();
    }
  });
  return () => es.close();
}

/** The three files match (the disk has nothing new for the files the person is editing). */
export function sameVersions(a: Versions, b: Versions): boolean {
  return a.mmd === b.mmd && a.config === b.config && a.layout === b.layout;
}

/** A20: the preset pack file matches too (a pack file edited elsewhere changes this and nothing in `sameVersions`). */
export function samePreset(a: Versions, b: Versions): boolean {
  return (a.preset ?? null) === (b.preset ?? null);
}
