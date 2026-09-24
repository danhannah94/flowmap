// The local server's JSON API and push channel (src/server). The UI never touches files except through here.
import type { Files } from '../core/ops';

/** Each file's version (a sha1 of its content), or null when the file doesn't exist. */
export interface Versions {
  mmd: string | null;
  config: string | null;
  layout: string | null;
}

export interface Snapshot {
  files: Files;
  versions: Versions;
}

export type PutOutcome =
  | { kind: 'saved'; versions: Versions }
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

export async function listDiagrams(): Promise<string[]> {
  const res = await fetch('/api/diagrams');
  if (!res.ok) throw new Error(await failure(res));
  const js = (await res.json()) as unknown;
  // Accept a bare list or {diagrams: [...]}, of names or {file|name} objects.
  const list = Array.isArray(js) ? js : ((js as { diagrams?: unknown[]; files?: unknown[] }).diagrams ?? (js as { files?: unknown[] }).files ?? []);
  return list.map((d) => (typeof d === 'string' ? d : String((d as { file?: string; name?: string }).file ?? (d as { name?: string }).name)));
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
  const js = (await res.json()) as { versions: Versions };
  return { kind: 'saved', versions: js.versions };
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

export function sameVersions(a: Versions, b: Versions): boolean {
  return a.mmd === b.mmd && a.config === b.config && a.layout === b.layout;
}
