import { mkdir, readFile, readdir, symlink, watch, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyPut, baseNameOf, createFolder, deleteDiagram, deleteFolder, deleteIfExists, diagramFileNames, folderOf,
  isValidDirPath, isValidFolderName, isValidMmdName, listFolder, listMmdFiles, moveDiagram, PathTraversalError,
  readDiagram, readOptional, renameFolder, resolveInRoot, TRASH_DIR_NAME, writeAtomic, type PutIo,
} from './files.js';
import { makeTempDiagramDir, removeTempDir } from './test-support.js';

describe('isValidMmdName', () => {
  it('accepts a bare *.mmd name', () => {
    expect(isValidMmdName('purchase-request.mmd')).toBe(true);
  });

  it('accepts a path in a subfolder (design.md A16: folders are real subdirectories)', () => {
    expect(isValidMmdName('brehob/stage-2.mmd')).toBe(true);
    expect(isValidMmdName('a/b/c.mmd')).toBe(true);
  });

  it.each(['../evil.mmd', '../evil/x.mmd', 'a/../evil.mmd', 'a\\b.mmd', '/etc/passwd.mmd', 'no-ext', '', null, undefined, '..mmd'])(
    'rejects %j',
    (bad) => {
      expect(isValidMmdName(bad as string | null)).toBe(false);
    },
  );

  it.each(['.hidden/a.mmd', 'node_modules/a.mmd', 'exports/a.mmd', '.a.mmd'])('rejects reserved path %j', (bad) => {
    expect(isValidMmdName(bad)).toBe(false);
  });
});

describe('isValidDirPath', () => {
  it('accepts the root and nested folders', () => {
    expect(isValidDirPath('')).toBe(true);
    expect(isValidDirPath('brehob')).toBe(true);
    expect(isValidDirPath('brehob/legal')).toBe(true);
  });

  it.each(['..', '../x', '/etc', 'a/..', 'a\\b', '.git', 'node_modules', 'a/exports', '.flowmap-trash'])(
    'rejects %j',
    (bad) => {
      expect(isValidDirPath(bad)).toBe(false);
    },
  );
});

describe('isValidFolderName', () => {
  it('accepts a plain name', () => {
    expect(isValidFolderName('brehob')).toBe(true);
  });

  it.each(['', 'a/b', 'a\\b', '.', '..', '.hidden', 'node_modules', 'exports'])('rejects %j', (bad) => {
    expect(isValidFolderName(bad)).toBe(false);
  });
});

describe('folderOf / baseNameOf', () => {
  it('splits a root-relative path into its folder and its own name', () => {
    expect(folderOf('brehob/stage-2.mmd')).toBe('brehob');
    expect(baseNameOf('brehob/stage-2.mmd')).toBe('stage-2.mmd');
    expect(folderOf('a.mmd')).toBe('');
    expect(baseNameOf('a.mmd')).toBe('a.mmd');
  });
});

describe('resolveInRoot: the path-traversal guard', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDiagramDir();
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it('resolves a plain nested path that does not exist yet (about to be created)', async () => {
    const resolved = await resolveInRoot(dir, 'brehob/legal/new-diagram.mmd');
    expect(resolved).toBe(join(dir, 'brehob', 'legal', 'new-diagram.mmd'));
  });

  it('resolves an existing file', async () => {
    const resolved = await resolveInRoot(dir, 'purchase-request.mmd');
    expect(resolved).toBe(join(dir, 'purchase-request.mmd'));
  });

  it('rejects a symlinked folder that escapes the served root', async () => {
    const outside = await makeTempDiagramDir();
    try {
      await symlink(outside, join(dir, 'escape'), 'dir');
      await expect(resolveInRoot(dir, 'escape/purchase-request.mmd')).rejects.toBeInstanceOf(PathTraversalError);
      // Same for a path that doesn't exist yet under the symlink: the guard walks up to the symlinked ancestor.
      await expect(resolveInRoot(dir, 'escape/not-there-yet.mmd')).rejects.toBeInstanceOf(PathTraversalError);
    } finally {
      await removeTempDir(outside);
    }
  });

  it('rejects a symlinked file itself that escapes the served root', async () => {
    const outside = await makeTempDiagramDir();
    try {
      await symlink(join(outside, 'purchase-request.mmd'), join(dir, 'escape.mmd'));
      await expect(resolveInRoot(dir, 'escape.mmd')).rejects.toBeInstanceOf(PathTraversalError);
    } finally {
      await removeTempDir(outside);
    }
  });
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

describe('deleteDiagram', () => {
  let dir: string;
  const MMD = 'purchase-request.mmd';

  beforeEach(async () => {
    dir = await makeTempDiagramDir();
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it('moves all three files into .flowmap-trash/<timestamp>-<name>/, leaving none behind', async () => {
    const before = await readDiagram(dir, MMD);
    const r = await deleteDiagram(dir, MMD);
    expect(r.ok).toBe(true);
    const parts = r.trashPath!.split(/[/\\]/);
    expect(parts[0]).toBe(TRASH_DIR_NAME);
    expect(parts[1]).toMatch(/^.+-purchase-request$/);

    const remaining = await readdir(dir);
    expect(remaining).not.toContain('purchase-request.mmd');
    expect(remaining).not.toContain('purchase-request.flow.yaml');
    expect(remaining).not.toContain('purchase-request.layout.json');
    expect(remaining).toContain(TRASH_DIR_NAME);

    const trashed = await readdir(join(dir, r.trashPath!));
    expect(trashed.sort()).toEqual(['purchase-request.flow.yaml', 'purchase-request.layout.json', 'purchase-request.mmd'].sort());
    expect(await readFile(join(dir, r.trashPath!, 'purchase-request.mmd'), 'utf8')).toBe(before.files.mmd);
    expect(await readFile(join(dir, r.trashPath!, 'purchase-request.flow.yaml'), 'utf8')).toBe(before.files.config);
    expect(await readFile(join(dir, r.trashPath!, 'purchase-request.layout.json'), 'utf8')).toBe(before.files.layout);
  });

  it('moves only the files that exist, when the config or layout file is missing', async () => {
    await deleteIfExists(join(dir, 'purchase-request.layout.json'));
    const r = await deleteDiagram(dir, MMD);
    expect(r.ok).toBe(true);
    const trashed = await readdir(join(dir, r.trashPath!));
    expect(trashed.sort()).toEqual(['purchase-request.flow.yaml', 'purchase-request.mmd'].sort());
  });

  it('is ok: false for a diagram that does not exist, and touches nothing', async () => {
    const r = await deleteDiagram(dir, 'nope.mmd');
    expect(r).toEqual({ ok: false, error: '"nope.mmd" does not exist' });
    const remaining = await readdir(dir);
    expect(remaining).not.toContain(TRASH_DIR_NAME);
  });

  it('never touches exports/', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, 'exports'), { recursive: true });
    await writeFile(join(dir, 'exports', 'purchase-request.svg'), '<svg/>');
    await deleteDiagram(dir, MMD);
    expect(await readFile(join(dir, 'exports', 'purchase-request.svg'), 'utf8')).toBe('<svg/>');
  });

  it('two deletes of different diagrams land in different trash folders', async () => {
    await writeFile(join(dir, 'second.mmd'), 'flowchart LR\n  a["A"]\n');
    const r1 = await deleteDiagram(dir, MMD);
    const r2 = await deleteDiagram(dir, 'second.mmd');
    expect(r1.trashPath).not.toBe(r2.trashPath);
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

describe('listMmdFiles: recursive listing (design.md A16)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDiagramDir();
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it('finds diagrams nested in folders, sorted, alongside the root ones', async () => {
    await mkdir(join(dir, 'brehob'), { recursive: true });
    await writeFile(join(dir, 'brehob', 'stage-2.mmd'), 'flowchart LR\n  a["A"]\n');
    await mkdir(join(dir, 'brehob', 'legal'), { recursive: true });
    await writeFile(join(dir, 'brehob', 'legal', 'nda.mmd'), 'flowchart LR\n  a["A"]\n');

    expect(await listMmdFiles(dir)).toEqual(['brehob/legal/nda.mmd', 'brehob/stage-2.mmd', 'purchase-request.mmd']);
  });

  it('ignores dot-folders, node_modules and exports', async () => {
    for (const hidden of ['.flowmap-trash', '.git', 'node_modules', 'exports']) {
      await mkdir(join(dir, hidden), { recursive: true });
      await writeFile(join(dir, hidden, 'sneaky.mmd'), 'flowchart LR\n  a["A"]\n');
    }
    expect(await listMmdFiles(dir)).toEqual(['purchase-request.mmd']);
  });

  it('stops descending past the depth limit', async () => {
    let rel = '';
    for (let i = 0; i < 20; i++) {
      rel = rel ? `${rel}/d${i}` : `d${i}`;
      await mkdir(join(dir, rel), { recursive: true });
    }
    await writeFile(join(dir, rel, 'too-deep.mmd'), 'flowchart LR\n  a["A"]\n');
    const files = await listMmdFiles(dir);
    expect(files.some((f) => f.endsWith('too-deep.mmd'))).toBe(false);
    expect(files).toContain('purchase-request.mmd');
  });
});

describe('listFolder: one folder’s immediate contents', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDiagramDir();
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it('lists immediate subfolders and diagrams of the root, not deeper ones', async () => {
    await mkdir(join(dir, 'brehob', 'legal'), { recursive: true });
    await writeFile(join(dir, 'brehob', 'stage-2.mmd'), 'flowchart LR\n  a["A"]\n');
    const listing = await listFolder(dir, '');
    expect(listing.folders).toEqual(['brehob']);
    expect(listing.diagrams).toEqual(['purchase-request.mmd']);
  });

  it('shows an empty subfolder (with no diagrams) too', async () => {
    await mkdir(join(dir, 'empty-one'), { recursive: true });
    const listing = await listFolder(dir, '');
    expect(listing.folders).toContain('empty-one');
  });

  it('descends into a named folder for its own immediate contents', async () => {
    await mkdir(join(dir, 'brehob', 'legal'), { recursive: true });
    await writeFile(join(dir, 'brehob', 'stage-2.mmd'), 'flowchart LR\n  a["A"]\n');
    const listing = await listFolder(dir, 'brehob');
    expect(listing.folders).toEqual(['brehob/legal']);
    expect(listing.diagrams).toEqual(['brehob/stage-2.mmd']);
  });

  it('excludes node_modules, exports and dot-folders from the subfolder list', async () => {
    for (const hidden of ['.flowmap-trash', 'node_modules', 'exports']) await mkdir(join(dir, hidden));
    const listing = await listFolder(dir, '');
    expect(listing.folders).toEqual([]);
  });
});

describe('folder CRUD (design.md A16)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeTempDiagramDir();
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it('createFolder makes a folder, refusing if something is already there', async () => {
    expect((await createFolder(dir, 'brehob')).ok).toBe(true);
    expect((await readdir(dir)).sort()).toContain('brehob');
    const again = await createFolder(dir, 'brehob');
    expect(again).toEqual({ ok: false, code: 'exists', error: expect.any(String) });
  });

  it('renameFolder keeps a folder in its parent and moves everything inside it', async () => {
    await mkdir(join(dir, 'brehob'), { recursive: true });
    await writeFile(join(dir, 'brehob', 'stage-2.mmd'), 'flowchart LR\n  a["A"]\n');
    const r = await renameFolder(dir, 'brehob', 'brehob-2');
    expect(r.ok).toBe(true);
    expect(await readdir(dir)).toContain('brehob-2');
    expect(await readdir(join(dir, 'brehob-2'))).toContain('stage-2.mmd');
  });

  it('renameFolder refuses a name that already exists, and a missing folder', async () => {
    await mkdir(join(dir, 'a'), { recursive: true });
    await mkdir(join(dir, 'b'), { recursive: true });
    expect((await renameFolder(dir, 'a', 'b')).code).toBe('exists');
    expect((await renameFolder(dir, 'nope', 'x')).code).toBe('not-found');
  });

  it('deleteFolder removes an empty folder', async () => {
    await mkdir(join(dir, 'empty'), { recursive: true });
    const r = await deleteFolder(dir, 'empty');
    expect(r.ok).toBe(true);
    expect(await readdir(dir)).not.toContain('empty');
  });

  it('deleteFolder refuses a folder holding a diagram or another folder', async () => {
    await mkdir(join(dir, 'busy'), { recursive: true });
    await writeFile(join(dir, 'busy', 'a.mmd'), 'flowchart LR\n  a["A"]\n');
    const r = await deleteFolder(dir, 'busy');
    expect(r).toEqual({ ok: false, code: 'not-empty', error: expect.any(String) });
    expect(await readdir(dir)).toContain('busy');
  });

  it('deleteFolder tolerates (and removes) a stray .DS_Store', async () => {
    await mkdir(join(dir, 'mac'), { recursive: true });
    await writeFile(join(dir, 'mac', '.DS_Store'), 'x');
    expect((await deleteFolder(dir, 'mac')).ok).toBe(true);
  });

  it('deleteFolder on a folder that does not exist is not-found', async () => {
    expect((await deleteFolder(dir, 'nope')).code).toBe('not-found');
  });
});

describe('moveDiagram: moving all of a diagram’s companion files (design.md A16)', () => {
  let dir: string;
  const MMD = 'purchase-request.mmd';

  beforeEach(async () => {
    dir = await makeTempDiagramDir();
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it('moves the .mmd, .flow.yaml and .layout.json into the target folder', async () => {
    const before = await readDiagram(dir, MMD);
    const r = await moveDiagram(dir, MMD, 'brehob');
    expect(r).toEqual({ ok: true, file: 'brehob/purchase-request.mmd' });
    expect(await readdir(dir)).not.toContain(MMD);
    const moved = await readDiagram(dir, 'brehob/purchase-request.mmd');
    expect(moved.files).toEqual(before.files);
  });

  it('moves anything else beside it that shares its base name', async () => {
    await writeFile(join(dir, 'purchase-request.extra.txt'), 'notes');
    const r = await moveDiagram(dir, MMD, 'brehob');
    expect(r.ok).toBe(true);
    expect(await readdir(join(dir, 'brehob'))).toContain('purchase-request.extra.txt');
  });

  it('moves into the root folder ("") too', async () => {
    await mkdir(join(dir, 'brehob'), { recursive: true });
    await rename_(dir, MMD, 'brehob');
    const r = await moveDiagram(dir, 'brehob/purchase-request.mmd', '');
    expect(r).toEqual({ ok: true, file: 'purchase-request.mmd' });
  });

  it('refuses when the destination already has a file with the same name', async () => {
    await mkdir(join(dir, 'brehob'), { recursive: true });
    await writeFile(join(dir, 'brehob', 'purchase-request.mmd'), 'flowchart LR\n  a["A"]\n');
    const r = await moveDiagram(dir, MMD, 'brehob');
    expect(r).toEqual({ ok: false, code: 'exists', error: expect.any(String) });
    // Nothing was moved: the source is untouched.
    expect(await readOptional(join(dir, MMD))).not.toBeNull();
  });

  it('refuses to move a diagram that does not exist', async () => {
    const r = await moveDiagram(dir, 'nope.mmd', 'brehob');
    expect(r).toEqual({ ok: false, code: 'not-found', error: expect.any(String) });
  });

  it('refuses a move to the folder the diagram is already in', async () => {
    const r = await moveDiagram(dir, MMD, '');
    expect(r.ok).toBe(false);
  });
});

/** A tiny helper the "moves into the root folder" test above uses to get a diagram into a subfolder first. */
async function rename_(dir: string, mmdFile: string, toDir: string): Promise<void> {
  const r = await moveDiagram(dir, mmdFile, toDir);
  if (!r.ok) throw new Error(r.error);
}
