// The watcher must never report the server's own write as an external change (UI28–UI30), even when a directory
// check runs while a PUT is still writing (the fs event of the first file written can fire the debounced check before
// the PUT has recorded its new versions). Found by the evidence UI tests under load: the UI's own save came back as
// `changed`, which cleared the undo history.
import type { ServerResponse } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDiagram } from './files.js';
import { makeTempDiagramDir, removeTempDir, sleep } from './test-support.js';
import { DiagramWatcher } from './watcher.js';

const MMD = 'purchase-request.mmd';
const CONFIG = 'purchase-request.flow.yaml';

function fakeResponse(): { res: ServerResponse; events: string[] } {
  const events: string[] = [];
  const res = { write: (chunk: string) => { events.push(chunk); return true; }, end: () => undefined } as unknown as ServerResponse;
  return { res, events };
}

describe('DiagramWatcher: own writes never echo', () => {
  let dir: string;
  let watcher: DiagramWatcher;

  beforeEach(async () => {
    dir = await makeTempDiagramDir();
    watcher = new DiagramWatcher(dir, 5);
    watcher.start();
  });

  afterEach(async () => {
    watcher.stop();
    await removeTempDir(dir);
  });

  it('a check that runs in the middle of a write is deferred until the write has recorded its versions', async () => {
    const { res, events } = fakeResponse();
    await watcher.ensureTracked(MMD);
    watcher.subscribe(MMD, res);
    watcher.beginWrite(MMD);
    const text = await readFile(join(dir, CONFIG), 'utf8');
    await writeFile(join(dir, CONFIG), `${text}# written by the UI\n`);
    await sleep(120); // the debounced check fires while the write is still in progress
    expect(events).toHaveLength(0);
    watcher.endWrite(MMD, (await readDiagram(dir, MMD)).versions);
    await sleep(120);
    expect(events).toHaveLength(0);
  });

  it('an external change made during a write is still reported after it', async () => {
    const { res, events } = fakeResponse();
    await watcher.ensureTracked(MMD);
    watcher.subscribe(MMD, res);
    watcher.beginWrite(MMD);
    const ours = (await readDiagram(dir, MMD)).versions; // the write changed nothing, say
    const text = await readFile(join(dir, CONFIG), 'utf8');
    await writeFile(join(dir, CONFIG), `${text}# written by the AI\n`);
    await sleep(60);
    expect(events).toHaveLength(0);
    watcher.endWrite(MMD, ours);
    await sleep(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toContain('written by the AI');
  });

  it('a refused write (no versions) leaves the baseline alone', async () => {
    const { res, events } = fakeResponse();
    await watcher.ensureTracked(MMD);
    watcher.subscribe(MMD, res);
    watcher.beginWrite(MMD);
    watcher.endWrite(MMD);
    await sleep(60);
    expect(events).toHaveLength(0);
  });
});
