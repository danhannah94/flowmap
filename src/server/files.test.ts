import { readFile, readdir, watch } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { diagramFileNames, isValidMmdName, writeAtomic } from './files.js';
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
