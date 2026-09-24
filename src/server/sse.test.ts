import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { serve, type ServeHandle } from './index.js';
import { captureSse, makeTempDiagramDir, removeTempDir, sleep, waitFor } from './test-support.js';

describe('flowmap server: SSE (design.md UI29)', () => {
  let dir: string;
  let handle: ServeHandle;
  let base: string;

  beforeEach(async () => {
    dir = await makeTempDiagramDir();
    handle = await serve({ dir, port: 0, watchDebounceMs: 20 });
    base = `http://127.0.0.1:${handle.port}`;
  });

  afterEach(async () => {
    await handle.close();
    await removeTempDir(dir);
  });

  it('an external write to the .mmd produces a "changed" event within 1s', async () => {
    const capture = captureSse(`${base}/api/events?file=purchase-request.mmd`);
    await sleep(50); // let the SSE connection open before the write

    const mmdPath = join(dir, 'purchase-request.mmd');
    const original = await readFile(mmdPath, 'utf8');
    await writeFile(mmdPath, `${original}\n%% external edit\n`, 'utf8');

    await waitFor(() => capture.events.some((e) => e.event === 'changed'), 1000);
    const event = capture.events.find((e) => e.event === 'changed')!;
    const payload = JSON.parse(event.data) as { files: { mmd: string } };
    expect(payload.files.mmd).toBe(`${original}\n%% external edit\n`);
    capture.stop();
  });

  it('an external write to the config or layout file also produces a "changed" event', async () => {
    const capture = captureSse(`${base}/api/events?file=purchase-request.mmd`);
    await sleep(50); // let the SSE connection open (and its baseline versions get established) before the write
    const layoutPath = join(dir, 'purchase-request.layout.json');
    await writeFile(layoutPath, '{"version":1,"nodes":{}}', 'utf8');
    await waitFor(() => capture.events.some((e) => e.event === 'changed'), 1000);
    capture.stop();
  });

  it('the server\'s own PUT produces no "changed" event ("the UI\'s own writes don\'t cause a visible reload")', async () => {
    const capture = captureSse(`${base}/api/events?file=purchase-request.mmd`);
    await sleep(50);

    const getRes = await fetch(`${base}/api/diagram?file=purchase-request.mmd`);
    const current = (await getRes.json()) as { files: { mmd: string; config: string; layout: string }; versions: Record<string, string | null> };
    const putRes = await fetch(`${base}/api/diagram?file=purchase-request.mmd`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base: current.versions,
        files: { mmd: `${current.files.mmd}\n%% from the ui\n`, config: current.files.config, layout: current.files.layout },
      }),
    });
    expect(putRes.status).toBe(200);

    // Give the (debounced) directory watcher plenty of time to have noticed the write, then check nothing fired.
    await new Promise((r) => setTimeout(r, 400));
    expect(capture.events).toEqual([]);
    capture.stop();
  });

  it('handles a rename-style save (write a temp file, then rename it over the .mmd)', async () => {
    const capture = captureSse(`${base}/api/events?file=purchase-request.mmd`);
    const mmdPath = join(dir, 'purchase-request.mmd');
    const tmpPath = join(dir, '.purchase-request.mmd.saving');
    const original = await readFile(mmdPath, 'utf8');
    const renamedContent = `${original}\n%% saved via rename\n`;
    await writeFile(tmpPath, renamedContent, 'utf8');
    await rename(tmpPath, mmdPath);

    await waitFor(() => capture.events.some((e) => e.event === 'changed'), 1000);
    const payload = JSON.parse(capture.events[capture.events.length - 1]!.data) as { files: { mmd: string } };
    expect(payload.files.mmd).toBe(renamedContent);
    capture.stop();
  });

  it('handles the .mmd being deleted and recreated', async () => {
    const capture = captureSse(`${base}/api/events?file=purchase-request.mmd`);
    await sleep(50); // let the SSE connection open (and its baseline versions get established) before the delete
    const mmdPath = join(dir, 'purchase-request.mmd');
    const { unlink } = await import('node:fs/promises');
    await unlink(mmdPath);
    await waitFor(() => capture.events.some((e) => JSON.parse(e.data).files.mmd === null), 1000);

    await writeFile(mmdPath, 'flowchart LR\n  a["Recreated"]\n', 'utf8');
    await waitFor(() => capture.events.some((e) => JSON.parse(e.data).files.mmd === 'flowchart LR\n  a["Recreated"]\n'), 1000);
    capture.stop();
  });

  it('sends a heartbeat comment at the configured interval', async () => {
    await handle.close();
    handle = await serve({ dir, port: 0, heartbeatMs: 50 });
    base = `http://127.0.0.1:${handle.port}`;
    const capture = captureSse(`${base}/api/events?file=purchase-request.mmd`);
    await waitFor(() => capture.comments.length >= 2, 1000);
    capture.stop();
  });

  it('close() ends open SSE connections', async () => {
    const capture = captureSse(`${base}/api/events?file=purchase-request.mmd`);
    await sleep(50);
    await handle.close();
    await Promise.race([
      capture.finished,
      new Promise((_, reject) => setTimeout(() => reject(new Error('SSE stream did not end after close()')), 1000)),
    ]);
  });
});
