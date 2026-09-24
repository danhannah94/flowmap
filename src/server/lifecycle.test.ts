import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { serve, type ServeHandle } from './index.js';
import { captureSse, makeTempDiagramDir, removeTempDir, sleep } from './test-support.js';

describe('flowmap server: lifecycle', () => {
  let dir: string;
  let handle: ServeHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    if (dir) await removeTempDir(dir);
  });

  it('close() releases the port so it can be bound again immediately', async () => {
    dir = await makeTempDiagramDir();
    handle = await serve({ dir, port: 0 });
    const port = handle.port;

    await handle.close();
    handle = undefined;

    // If the port weren't released, this bind would fail with EADDRINUSE.
    await new Promise<void>((resolvePromise, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => {
        probe.close(() => resolvePromise());
      });
    });
  });

  it('close() ends SSE connections and stops the directory watcher (no lingering handles)', async () => {
    dir = await makeTempDiagramDir();
    handle = await serve({ dir, port: 0, watchDebounceMs: 20 });
    const base = `http://127.0.0.1:${handle.port}`;

    const capture = captureSse(`${base}/api/events?file=purchase-request.mmd`);
    await sleep(50);

    await handle.close();
    handle = undefined;

    await Promise.race([
      capture.finished,
      new Promise((_, reject) => setTimeout(() => reject(new Error('SSE stream did not end after close()')), 1000)),
    ]);

    // The HTTP port is gone too.
    await expect(fetch(`${base}/api/diagrams`)).rejects.toBeTruthy();
  });

  it('a second call to close() does not throw', async () => {
    dir = await makeTempDiagramDir();
    handle = await serve({ dir, port: 0 });
    await handle.close();
    await expect(handle.close()).resolves.toBeUndefined();
    handle = undefined;
  });
});
