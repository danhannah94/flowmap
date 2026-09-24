import { readFile, readdir, watch } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyPut, deleteIfExists, diagramFileNames, isValidMmdName, readDiagram, readOptional, writeAtomic, type PutIo,
} from './files.js';
import { makeTempDiagramDir, removeTempDir } from './test-support.js';

describe('isValidMmdName', () => {
  it('accepts a bare *.mmd name', () => {
    expect(isValidMmdName('purchase-request.mmd')).toBe(true);
  });

  it.each(['../evil.mmd', 'a/b.mmd', 'a\\b.mmd', '/etc/passwd.mmd', 'no-ext', '', null, undefined, '..mmd'])(
    'rejects %j',
    (bad) => {
      expect(isValidMmdName(bad as string | null)).toBe(false);
    },
  );
});

describe('diagramFileNames', () => {
  it('derives the config and layout names beside the .mmd', () => {
    expect(diagramFileNames('a.mmd')).toEqual({ mmd: 'a.mmd', config: 'a.flow.yaml', layout: 'a.layout.json' });
  });
});

describe('writeAtomic', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDiagramDir();
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it('writes via a temp file in the same directory, then renames it into place, leaving nothing behind', async () => {
    const target = join(dir, 'purchase-request.mmd');
    const seenNames: string[] = [];
    const ac = new AbortController();
    const watchLoop = (async () => {
      try {
        for await (const event of watch(dir, { signal: ac.signal })) {
          if (event.filename) seenNames.push(event.filename);
        }
      } catch {
        // aborted
      }
    })();

    await new Promise((r) => setTimeout(r, 20)); // let the watch loop actually start listening before we write
    const newContent = 'flowchart LR\n  a["Rewritten"]\n'.repeat(1000);
    await writeAtomic(target, newContent);
    await new Promise((r) => setTimeout(r, 200)); // generous margin under load (unrelated to the watcher's own debounce)
    ac.abort();
    await watchLoop;

    expect(seenNames.some((n) => n.includes('.tmp'))).toBe(true);
    expect(await readFile(target, 'utf8')).toBe(newContent);
    const remaining = await readdir(dir);
    expect(remaining.filter((n) => n.includes('.tmp'))).toEqual([]);
  });

  it('overwrites atomically: a concurrent reader never observes a partial or empty file', async () => {
    const target = join(dir, 'purchase-request.mmd');
    const before = await readFile(target, 'utf8');
    const after = 'x'.repeat(200_000);

    const observedLengths = new Set<number>();
    let polling = true;
    const poll = (async () => {
      while (polling) {
        try {
          const content = await readFile(target, 'utf8');
          observedLengths.add(content.length);
        } catch {
          // a transient ENOENT during rename is acceptable, not a partial file
        }
        await new Promise((r) => setImmediate(r));
      }
    })();

    await writeAtomic(target, after);
    polling = false;
    await poll;

    for (const len of observedLengths) {
      expect(len === before.length || len === after.length).toBe(true);
    }
  });

  it('also writes new files (config/layout creation) atomically', async () => {
    const target = join(dir, 'brand-new.flow.yaml');
    await writeAtomic(target, 'version: 1\n');
    expect(await readFile(target, 'utf8')).toBe('version: 1\n');
  });
});

describe('applyPut: the config and layout file first, the .mmd last', () => {
  let dir: string;
  const MMD = 'purchase-request.mmd';

  beforeEach(async () => {
    dir = await makeTempDiagramDir();
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  /** The disk io, recording what it does in order. */
  function recording(): { io: PutIo; log: string[] } {
    const log: string[] = [];
    return {
      log,
      io: {
        write: async (path, data) => {
          log.push(`write ${basename(path)}`);
          await writeAtomic(path, data);
        },
        remove: async (path) => {
          log.push(`remove ${basename(path)}`);
          await deleteIfExists(path);
        },
      },
    };
  }

  it('writes the config, then the layout file, then the .mmd', async () => {
    const { files, versions } = await readDiagram(dir, MMD);
    const { io, log } = recording();
    const patch = { mmd: `${files.mmd}%% edited\n`, config: `${files.config}# edited\n`, layout: '{"version": 1, "nodes": {}}\n' };
    const r = await applyPut(dir, MMD, versions, patch, io);
    expect(r.conflict).toBe(false);
    expect(log).toEqual(['write purchase-request.flow.yaml', 'write purchase-request.layout.json', 'write purchase-request.mmd']);
    expect((await readDiagram(dir, MMD)).files).toEqual(patch);
  });

  it('deletions follow the same order: companions first, the .mmd last; unchanged files are not touched', async () => {
    const { files, versions } = await readDiagram(dir, MMD);
    const first = recording();
    await applyPut(dir, MMD, versions, { mmd: `${files.mmd}%% edited\n`, config: null, layout: null }, first.io);
    expect(first.log).toEqual(['remove purchase-request.flow.yaml', 'remove purchase-request.layout.json', 'write purchase-request.mmd']);
    const now = await readDiagram(dir, MMD);
    const second = recording();
    await applyPut(dir, MMD, now.versions, { mmd: null, config: 'version: 1\n', layout: null }, second.io);
    expect(second.log).toEqual(['write purchase-request.flow.yaml', 'remove purchase-request.mmd']);
    const only = recording();
    const after = await readDiagram(dir, MMD);
    await applyPut(dir, MMD, after.versions, { mmd: null, config: 'version: 1\n', layout: '{"version": 1, "nodes": {}}\n' }, only.io);
    expect(only.log).toEqual(['write purchase-request.layout.json']);
  });

  it('a reader that waits for the .mmd to change then reads the others always sees the new set', async () => {
    for (let round = 0; round < 20; round++) {
      const { files, versions } = await readDiagram(dir, MMD);
      const patch = {
        mmd: `${files.mmd}%% round ${round}\n`,
        config: `${files.config}# round ${round}\n`,
        layout: `{"version": 1, "nodes": {}, "hints": {"round": ${round}}}\n`,
      };
      let seen: { config: string | null; layout: string | null } | null = null;
      let polling = true;
      const poll = (async () => {
        while (polling && !seen) {
          const mmd = await readOptional(join(dir, MMD));
          if (mmd === patch.mmd) {
            seen = {
              config: await readOptional(join(dir, 'purchase-request.flow.yaml')),
              layout: await readOptional(join(dir, 'purchase-request.layout.json')),
            };
          }
          await new Promise((r) => setImmediate(r));
        }
      })();
      await applyPut(dir, MMD, versions, patch);
      polling = false;
      await poll;
      if (seen) expect(seen, `round ${round}`).toEqual({ config: patch.config, layout: patch.layout });
    }
  });
});
