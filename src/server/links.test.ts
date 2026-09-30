// A17 (design.md §12): rewriting `link:` values across the served directory after a diagram move or a folder
// rename. `rewriteLinksAcrossDir` is tested directly here, against hand-built directory trees and a `remap`
// function (the pure `movedLinkTarget`/`renamedFolderLinkTarget` helpers, `src/core/config/links.ts`, already have
// their own unit tests); the end-to-end wiring through `POST /api/diagram/move` and `PUT /api/folder` is covered by
// `src/server/api.test.ts`.
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { movedLinkTarget, renamedFolderLinkTarget } from '../core/config/links.js';
import { rewriteLinksAcrossDir } from './links.js';
import { removeTempDir } from './test-support.js';

async function makeEmptyTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'flowmap-links-test-'));
}

/** Writes a minimal `.mmd` and, if given, its `.flow.yaml` beside it, creating folders as needed. */
async function writeDiagram(dir: string, relMmd: string, config?: string): Promise<void> {
  const mmdPath = join(dir, relMmd);
  await mkdir(dirname(mmdPath), { recursive: true });
  await writeFile(mmdPath, 'flowchart LR\n  a["A"]\n');
  if (config !== undefined) await writeFile(mmdPath.replace(/\.mmd$/, '.flow.yaml'), config);
}

const readConfig = (dir: string, relMmd: string) => readFile(join(dir, relMmd.replace(/\.mmd$/, '.flow.yaml')), 'utf8');

describe('rewriteLinksAcrossDir (A17, §12)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await makeEmptyTempDir();
  });

  afterEach(async () => {
    await removeTempDir(dir);
  });

  it('rewrites every config whose link matches (a move: an exact-id remap), reporting file + count', async () => {
    await writeDiagram(dir, 'a.mmd', 'nodes:\n  n1:\n    link: b\n');
    await writeDiagram(dir, 'b.mmd', 'nodes:\n  n1:\n    kind: step\n');
    await writeDiagram(dir, 'c.mmd', 'nodes:\n  n1:\n    link: b\n  n2:\n    link: other\n');

    const result = await rewriteLinksAcrossDir(dir, (t) => movedLinkTarget(t, 'b', 'hub/b'));

    expect(result.skipped).toEqual([]);
    expect([...result.rewritten].sort((x, y) => x.file.localeCompare(y.file))).toEqual([
      { file: 'a.mmd', count: 1 },
      { file: 'c.mmd', count: 1 },
    ]);
    expect(await readConfig(dir, 'a.mmd')).toContain('link: hub/b');
    const cText = await readConfig(dir, 'c.mmd');
    expect(cText).toContain('link: hub/b');
    expect(cText).toContain('link: other'); // a different target: untouched
  });

  it('a diagram with no matching link is neither rewritten nor reported', async () => {
    await writeDiagram(dir, 'a.mmd', 'nodes:\n  n1:\n    link: unrelated\n');
    const before = await readConfig(dir, 'a.mmd');
    const result = await rewriteLinksAcrossDir(dir, (t) => movedLinkTarget(t, 'b', 'hub/b'));
    expect(result).toEqual({ rewritten: [], skipped: [] });
    expect(await readConfig(dir, 'a.mmd')).toBe(before); // untouched, byte for byte
  });

  it('a diagram with no config at all is skipped silently (nothing to rewrite, not an error)', async () => {
    await writeDiagram(dir, 'bare.mmd');
    const result = await rewriteLinksAcrossDir(dir, () => 'x');
    expect(result).toEqual({ rewritten: [], skipped: [] });
  });

  it('a config that fails to parse is left untouched and reported in `skipped`, not corrupted', async () => {
    await writeDiagram(dir, 'broken.mmd', 'nodes: [this is: not valid\n');
    const before = await readConfig(dir, 'broken.mmd');
    const result = await rewriteLinksAcrossDir(dir, () => 'x');
    expect(result.rewritten).toEqual([]);
    expect(result.skipped).toEqual(['broken.mmd']);
    expect(await readConfig(dir, 'broken.mmd')).toBe(before);
  });

  it('one bad config does not stop the sweep: a later, valid, matching diagram still gets rewritten', async () => {
    await writeDiagram(dir, 'broken.mmd', 'nodes: [not: valid\n');
    await writeDiagram(dir, 'z-good.mmd', 'nodes:\n  n1:\n    link: b\n'); // sorts after "broken" (listMmdFiles is sorted)
    const result = await rewriteLinksAcrossDir(dir, (t) => movedLinkTarget(t, 'b', 'hub/b'));
    expect(result.skipped).toEqual(['broken.mmd']);
    expect(result.rewritten).toEqual([{ file: 'z-good.mmd', count: 1 }]);
  });

  it('folder-rename remap: prefix-safe, nested links keep their tail, same-prefixed siblings are untouched', async () => {
    await writeDiagram(dir, 'brehob/stage-1.mmd', 'nodes:\n  n1:\n    link: brehob/stage-2\n');
    await writeDiagram(dir, 'brehob/hub/stage-3.mmd', 'nodes:\n  n1:\n    link: brehob/stage-2\n');
    await writeDiagram(dir, 'brehob-other/x.mmd', 'nodes:\n  n1:\n    link: brehob/stage-2\n'); // points inside brehob: still moves
    await writeDiagram(dir, 'sibling/y.mmd', 'nodes:\n  n1:\n    link: brehobx/z\n'); // not inside brehob at all: untouched

    const result = await rewriteLinksAcrossDir(dir, (t) => renamedFolderLinkTarget(t, 'brehob', 'brehob-bc'));

    expect([...result.rewritten].sort((x, y) => x.file.localeCompare(y.file))).toEqual([
      { file: 'brehob-other/x.mmd', count: 1 },
      { file: 'brehob/hub/stage-3.mmd', count: 1 },
      { file: 'brehob/stage-1.mmd', count: 1 },
    ]);
    expect(await readConfig(dir, 'brehob/stage-1.mmd')).toContain('link: brehob-bc/stage-2');
    expect(await readConfig(dir, 'brehob/hub/stage-3.mmd')).toContain('link: brehob-bc/stage-2');
    expect(await readConfig(dir, 'brehob-other/x.mmd')).toContain('link: brehob-bc/stage-2');
    expect(await readConfig(dir, 'sibling/y.mmd')).toContain('link: brehobx/z'); // unchanged
  });

  it('no diagrams at all: an empty, safe result', async () => {
    expect(await rewriteLinksAcrossDir(dir, () => 'x')).toEqual({ rewritten: [], skipped: [] });
  });
});
