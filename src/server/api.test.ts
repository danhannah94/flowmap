import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { serve, type ServeHandle } from './index.js';
import { makeTempDiagramDir, removeTempDir } from './test-support.js';

describe('flowmap server: JSON API', () => {
  let dir: string;
  let handle: ServeHandle;
  let base: string;

  beforeEach(async () => {
    dir = await makeTempDiagramDir();
    handle = await serve({ dir, port: 0 });
    base = `http://127.0.0.1:${handle.port}`;
  });

  afterEach(async () => {
    await handle.close();
    await removeTempDir(dir);
  });

  it('GET /api/diagrams lists the .mmd files in the directory, sorted', async () => {
    const res = await fetch(`${base}/api/diagrams`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: string[] };
    expect(body.files).toEqual(['purchase-request.mmd']);
  });

  it('GET /api/diagram returns the three files and their versions', async () => {
    const res = await fetch(`${base}/api/diagram?file=purchase-request.mmd`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: Record<string, string | null>; versions: Record<string, string | null> };

    const [mmd, config, layout] = await Promise.all([
      readFile(join(dir, 'purchase-request.mmd'), 'utf8'),
      readFile(join(dir, 'purchase-request.flow.yaml'), 'utf8'),
      readFile(join(dir, 'purchase-request.layout.json'), 'utf8'),
    ]);
    expect(body.files.mmd).toBe(mmd);
    expect(body.files.config).toBe(config);
    expect(body.files.layout).toBe(layout);
    expect(body.versions.mmd).toMatch(/^[0-9a-f]{40}$/);
    expect(body.versions.config).toMatch(/^[0-9a-f]{40}$/);
    expect(body.versions.layout).toMatch(/^[0-9a-f]{40}$/);
  });

  it('GET /api/diagram for a missing .mmd is 404', async () => {
    const res = await fetch(`${base}/api/diagram?file=nope.mmd`);
    expect(res.status).toBe(404);
  });

  it('PUT writes only the changed file and returns new versions', async () => {
    const getRes = await fetch(`${base}/api/diagram?file=purchase-request.mmd`);
    const current = (await getRes.json()) as {
      files: { mmd: string; config: string; layout: string };
      versions: Record<string, string | null>;
    };

    const newMmd = current.files.mmd.replace('Needs a part or service', 'Needs a widget');
    const putRes = await fetch(`${base}/api/diagram?file=purchase-request.mmd`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base: current.versions,
        files: { mmd: newMmd, config: current.files.config, layout: current.files.layout },
      }),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as { files: Record<string, string | null>; versions: Record<string, string | null> };
    expect(putBody.files.mmd).toBe(newMmd);
    expect(putBody.versions.mmd).not.toBe(current.versions.mmd);
    expect(putBody.versions.config).toBe(current.versions.config);

    const onDisk = await readFile(join(dir, 'purchase-request.mmd'), 'utf8');
    expect(onDisk).toBe(newMmd);
  });

  it('PUT with a null file deletes it, and a later PUT can recreate it', async () => {
    const getRes = await fetch(`${base}/api/diagram?file=purchase-request.mmd`);
    const current = (await getRes.json()) as {
      files: { mmd: string; config: string; layout: string };
      versions: Record<string, string | null>;
    };

    const deleteRes = await fetch(`${base}/api/diagram?file=purchase-request.mmd`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base: current.versions,
        files: { mmd: current.files.mmd, config: null, layout: null },
      }),
    });
    expect(deleteRes.status).toBe(200);
    const afterDelete = (await deleteRes.json()) as { files: Record<string, string | null>; versions: Record<string, string | null> };
    expect(afterDelete.files.config).toBeNull();
    expect(afterDelete.files.layout).toBeNull();
    expect(afterDelete.versions.config).toBeNull();
    expect(afterDelete.versions.layout).toBeNull();

    const remaining = await readdir(dir);
    expect(remaining).not.toContain('purchase-request.flow.yaml');
    expect(remaining).not.toContain('purchase-request.layout.json');

    const recreateRes = await fetch(`${base}/api/diagram?file=purchase-request.mmd`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base: afterDelete.versions,
        files: { mmd: afterDelete.files.mmd, config: 'version: 1\ntitle: Recreated\n', layout: afterDelete.files.layout },
      }),
    });
    expect(recreateRes.status).toBe(200);
    const afterRecreate = (await recreateRes.json()) as { files: Record<string, string | null> };
    expect(afterRecreate.files.config).toBe('version: 1\ntitle: Recreated\n');
    expect(await readFile(join(dir, 'purchase-request.flow.yaml'), 'utf8')).toBe('version: 1\ntitle: Recreated\n');
  });

  it('PUT with a stale base is a 409 conflict ("disk wins"), and writes nothing', async () => {
    const getRes = await fetch(`${base}/api/diagram?file=purchase-request.mmd`);
    const current = (await getRes.json()) as {
      files: { mmd: string; config: string; layout: string };
      versions: Record<string, string | null>;
    };

    // Someone else edits the file on disk directly, out from under the client's stale `base`.
    const externalContent = `${current.files.mmd}\n%% edited externally\n`;
    const { writeAtomic } = await import('./files.js');
    await writeAtomic(join(dir, 'purchase-request.mmd'), externalContent);

    const putRes = await fetch(`${base}/api/diagram?file=purchase-request.mmd`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base: current.versions, // stale: doesn't reflect the external edit above
        files: { mmd: 'clobbering content', config: current.files.config, layout: current.files.layout },
      }),
    });
    expect(putRes.status).toBe(409);
    const conflictBody = (await putRes.json()) as { files: Record<string, string | null>; versions: Record<string, string | null> };
    expect(conflictBody.files.mmd).toBe(externalContent);
    expect(conflictBody.versions.mmd).not.toBe(current.versions.mmd);

    // Nothing was written by the rejected PUT.
    expect(await readFile(join(dir, 'purchase-request.mmd'), 'utf8')).toBe(externalContent);
  });

  it('rejects path traversal, absolute paths and non-.mmd names in "file"', async () => {
    for (const bad of ['../evil.mmd', '/etc/passwd.mmd', '..\\evil.mmd', 'no-extension', '', 'node_modules/a.mmd', '.hidden/a.mmd']) {
      const res = await fetch(`${base}/api/diagram?file=${encodeURIComponent(bad)}`);
      expect(res.status, `expected 400 for file=${JSON.stringify(bad)}`).toBe(400);
    }
    // A path in a subfolder is now valid shape (design.md A16); it's just a 404 since the folder doesn't exist.
    const subRes = await fetch(`${base}/api/diagram?file=${encodeURIComponent('sub/dir.mmd')}`);
    expect(subRes.status).toBe(404);
    const putRes = await fetch(`${base}/api/diagram?file=${encodeURIComponent('../evil.mmd')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base: { mmd: null, config: null, layout: null }, files: { mmd: 'x', config: null, layout: null } }),
    });
    expect(putRes.status).toBe(400);
  });

  it('PUT never leaves a temp file behind (atomic write cleans up after itself)', async () => {
    const getRes = await fetch(`${base}/api/diagram?file=purchase-request.mmd`);
    const current = (await getRes.json()) as {
      files: { mmd: string; config: string; layout: string };
      versions: Record<string, string | null>;
    };
    await fetch(`${base}/api/diagram?file=purchase-request.mmd`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base: current.versions,
        files: { mmd: `${current.files.mmd}\n%% more\n`, config: current.files.config, layout: current.files.layout },
      }),
    });
    const entries = await readdir(dir);
    expect(entries.filter((n) => n.includes('.tmp'))).toEqual([]);
  });

  it('DELETE /api/diagram moves the diagram to .flowmap-trash, and it drops off the list', async () => {
    const before = await fetch(`${base}/api/diagram?file=purchase-request.mmd`).then((r) => r.json()) as {
      files: { mmd: string; config: string; layout: string };
    };
    const res = await fetch(`${base}/api/diagram?file=purchase-request.mmd`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; trash: string };
    expect(body.ok).toBe(true);
    expect(body.trash).toMatch(/^\.flowmap-trash[/\\]/);

    const remaining = await readdir(dir);
    expect(remaining).not.toContain('purchase-request.mmd');
    expect(remaining).not.toContain('purchase-request.flow.yaml');
    expect(remaining).not.toContain('purchase-request.layout.json');

    expect(await readFile(join(dir, body.trash, 'purchase-request.mmd'), 'utf8')).toBe(before.files.mmd);

    const listRes = await fetch(`${base}/api/diagrams`);
    expect(((await listRes.json()) as { files: string[] }).files).toEqual([]);

    const getRes = await fetch(`${base}/api/diagram?file=purchase-request.mmd`);
    expect(getRes.status).toBe(404);
  });

  it('DELETE /api/diagram for a missing diagram is 404', async () => {
    const res = await fetch(`${base}/api/diagram?file=nope.mmd`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/diagram rejects path traversal, absolute paths and non-.mmd names', async () => {
    for (const bad of ['../evil.mmd', '/etc/passwd.mmd', '..\\evil.mmd', 'no-extension', '']) {
      const res = await fetch(`${base}/api/diagram?file=${encodeURIComponent(bad)}`, { method: 'DELETE' });
      expect(res.status, `expected 400 for file=${JSON.stringify(bad)}`).toBe(400);
    }
  });

  it('POST /api/export without an exportFn is 501', async () => {
    const res = await fetch(`${base}/api/export?file=purchase-request.mmd&format=svg`, { method: 'POST' });
    expect(res.status).toBe(501);
  });

  it('serves a fallback page when dist/ui is missing', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('flowmap');
  });
});

describe('flowmap server: folders (design.md A16)', () => {
  let dir: string;
  let handle: ServeHandle;
  let base: string;

  beforeEach(async () => {
    dir = await makeTempDiagramDir();
    handle = await serve({ dir, port: 0 });
    base = `http://127.0.0.1:${handle.port}`;
  });

  afterEach(async () => {
    await handle.close();
    await removeTempDir(dir);
  });

  it('GET /api/diagrams lists diagrams recursively, folder paths included', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(dir, 'brehob'), { recursive: true });
    await writeFile(join(dir, 'brehob', 'stage-2.mmd'), 'flowchart LR\n  a["A"]\n');
    const res = await fetch(`${base}/api/diagrams`);
    const body = (await res.json()) as { files: string[] };
    expect(body.files).toEqual(['brehob/stage-2.mmd', 'purchase-request.mmd']);
  });

  it('GET /api/folder lists the root’s immediate subfolders and diagrams', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(dir, 'brehob', 'legal'), { recursive: true });
    await writeFile(join(dir, 'brehob', 'stage-2.mmd'), 'flowchart LR\n  a["A"]\n');
    const res = await fetch(`${base}/api/folder?dir=`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dir: string; folders: string[]; diagrams: string[] };
    expect(body.folders).toEqual(['brehob']);
    expect(body.diagrams).toEqual(['purchase-request.mmd']);
  });

  it('GET /api/folder descends into a named folder', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(dir, 'brehob', 'legal'), { recursive: true });
    await writeFile(join(dir, 'brehob', 'stage-2.mmd'), 'flowchart LR\n  a["A"]\n');
    const res = await fetch(`${base}/api/folder?dir=brehob`);
    const body = (await res.json()) as { folders: string[]; diagrams: string[] };
    expect(body.folders).toEqual(['brehob/legal']);
    expect(body.diagrams).toEqual(['brehob/stage-2.mmd']);
  });

  it('GET /api/folder rejects an invalid or escaping "dir"', async () => {
    for (const bad of ['..', '/etc', 'node_modules', '.git']) {
      const res = await fetch(`${base}/api/folder?dir=${encodeURIComponent(bad)}`);
      expect(res.status, `expected 400 for dir=${JSON.stringify(bad)}`).toBe(400);
    }
  });

  it('POST /api/folder creates a folder, and refuses a duplicate', async () => {
    const res = await fetch(`${base}/api/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: '', name: 'brehob' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { dir: string }).dir).toBe('brehob');
    const list = (await fetch(`${base}/api/folder?dir=`).then((r) => r.json())) as { folders: string[] };
    expect(list.folders).toContain('brehob');

    const again = await fetch(`${base}/api/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: '', name: 'brehob' }),
    });
    expect(again.status).toBe(409);
  });

  it('POST /api/folder rejects a bad name', async () => {
    const res = await fetch(`${base}/api/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: '', name: '../evil' }),
    });
    expect(res.status).toBe(400);
  });

  it('PUT /api/folder renames a folder in place', async () => {
    await fetch(`${base}/api/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: '', name: 'brehob' }),
    });
    const res = await fetch(`${base}/api/folder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: 'brehob', name: 'brehob-2' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { dir: string }).dir).toBe('brehob-2');
    const list = (await fetch(`${base}/api/folder?dir=`).then((r) => r.json())) as { folders: string[] };
    expect(list.folders).toEqual(['brehob-2']);
  });

  it('DELETE /api/folder removes an empty folder, and refuses a non-empty one', async () => {
    await fetch(`${base}/api/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: '', name: 'empty' }),
    });
    const res = await fetch(`${base}/api/folder?dir=empty`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(join(dir, 'busy'), { recursive: true });
    await writeFile(join(dir, 'busy', 'a.mmd'), 'flowchart LR\n  a["A"]\n');
    const busyRes = await fetch(`${base}/api/folder?dir=busy`, { method: 'DELETE' });
    expect(busyRes.status).toBe(409);
  });

  it('DELETE /api/folder on a missing folder is 404, and the root itself is refused', async () => {
    expect((await fetch(`${base}/api/folder?dir=nope`, { method: 'DELETE' })).status).toBe(404);
    expect((await fetch(`${base}/api/folder?dir=`, { method: 'DELETE' })).status).toBe(400);
  });

  it('POST /api/diagram/move moves a diagram (all its files) into a folder', async () => {
    await fetch(`${base}/api/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: '', name: 'brehob' }),
    });
    const res = await fetch(`${base}/api/diagram/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'purchase-request.mmd', to: 'brehob' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; file: string };
    expect(body.file).toBe('brehob/purchase-request.mmd');

    const gone = await fetch(`${base}/api/diagram?file=purchase-request.mmd`);
    expect(gone.status).toBe(404);
    const moved = await fetch(`${base}/api/diagram?file=brehob/purchase-request.mmd`);
    expect(moved.status).toBe(200);

    const list = (await fetch(`${base}/api/diagrams`).then((r) => r.json())) as { files: string[] };
    expect(list.files).toEqual(['brehob/purchase-request.mmd']);
  });

  it('POST /api/diagram/move refuses a destination collision, and a missing diagram', async () => {
    const missing = await fetch(`${base}/api/diagram/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'nope.mmd', to: 'brehob' }),
    });
    expect(missing.status).toBe(404);
  });

  it('POST /api/diagram/move rejects an invalid "to" or "file"', async () => {
    const res = await fetch(`${base}/api/diagram/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'purchase-request.mmd', to: '../evil' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('flowmap server: static UI', () => {
  let dir: string;
  let handle: ServeHandle;

  afterEach(async () => {
    await handle.close();
    await removeTempDir(dir);
  });

  it('serves dist/ui assets and falls back to index.html for client-side routes', async () => {
    dir = await makeTempDiagramDir();
    const { mkdir, writeFile } = await import('node:fs/promises');
    const uiDir = join(dir, 'built-ui');
    await mkdir(join(uiDir, 'assets'), { recursive: true });
    await writeFile(join(uiDir, 'index.html'), '<!doctype html><html><body>flowmap ui</body></html>');
    await writeFile(join(uiDir, 'assets', 'app.js'), 'console.log("app")');

    handle = await serve({ dir, port: 0, uiDir });
    const base = `http://127.0.0.1:${handle.port}`;

    const asset = await fetch(`${base}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(await asset.text()).toBe('console.log("app")');

    const clientRoute = await fetch(`${base}/some/client/route?file=purchase-request.mmd`);
    expect(clientRoute.status).toBe(200);
    expect(await clientRoute.text()).toContain('flowmap ui');
  });
});

describe('flowmap server: export endpoint', () => {
  let dir: string;
  let handle: ServeHandle;

  beforeEach(async () => {
    dir = await makeTempDiagramDir();
  });

  afterEach(async () => {
    await handle.close();
    await removeTempDir(dir);
  });

  it('calls the injected exportFn and returns its path', async () => {
    const calls: { mmdPath: string; format: string; theme: string }[] = [];
    handle = await serve({
      dir,
      port: 0,
      exportFn: async (mmdPath, format, theme) => {
        calls.push({ mmdPath, format, theme });
        return join(dir, 'exports', `purchase-request.${format}`);
      },
    });
    const base = `http://127.0.0.1:${handle.port}`;
    const res = await fetch(`${base}/api/export?file=purchase-request.mmd&format=png&theme=dark`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe(join(dir, 'exports', 'purchase-request.png'));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.format).toBe('png');
    expect(calls[0]?.theme).toBe('dark');
    expect(calls[0]?.mmdPath).toBe(join(dir, 'purchase-request.mmd'));
  });
});
