// A20: the preset pack file a diagram's config names (design.md §4.1): read from beside the diagram, kept inside the
// served folder, delivered with the snapshot, and watched.
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyPut, readDiagram, readPresetFiles } from './files.js';
import { serve, type ServeHandle } from './index.js';
import { captureSse, makeTempDiagramDir, removeTempDir, sleep, waitFor } from './test-support.js';

const PACK = 'kinds:\n  job: {label: Job, icon: queue}\n';
const CONFIG = (ref: string) => `preset: ${ref}\nnodes:\n  r01: {kind: job}\n`;

async function put(dir: string, rel: string, text: string): Promise<void> {
  await mkdir(dirname(join(dir, rel)), { recursive: true });
  await writeFile(join(dir, rel), text, 'utf8');
}

describe('readPresetFiles', () => {
  let dir: string;
  let outside: string;
  beforeEach(async () => {
    dir = await makeTempDiagramDir();
    outside = await makeTempDiagramDir();
  });
  afterEach(async () => {
    await removeTempDir(dir);
    await removeTempDir(outside);
  });
  const mmd = () => join(dir, 'sub', 'd.mmd');

  it('nothing to read: no config, no preset, a built-in name', async () => {
    expect(await readPresetFiles(dir, mmd(), null)).toBeUndefined();
    expect(await readPresetFiles(dir, mmd(), 'title: x\n')).toBeUndefined();
    expect(await readPresetFiles(dir, mmd(), 'preset: cloud\n')).toBeUndefined();
  });

  it('reads a pack file relative to the diagram, keyed as written', async () => {
    await put(dir, 'sub/packs/team.yaml', PACK);
    await put(dir, 'shared.yaml', PACK + '# shared\n');
    expect(await readPresetFiles(dir, mmd(), 'preset: ./packs/team.yaml\n')).toEqual({ './packs/team.yaml': PACK });
    expect(await readPresetFiles(dir, mmd(), 'preset: ../shared.yaml\n')).toEqual({ '../shared.yaml': PACK + '# shared\n' });
  });

  it('a missing file, or a directory, is null', async () => {
    await mkdir(join(dir, 'sub', 'adir.yaml'), { recursive: true });
    expect(await readPresetFiles(dir, mmd(), 'preset: nope.yaml\n')).toEqual({ 'nope.yaml': null });
    expect(await readPresetFiles(dir, mmd(), 'preset: adir.yaml\n')).toEqual({ 'adir.yaml': null });
  });

  it('a path that climbs out of the served folder is null, even if the file exists', async () => {
    await put(outside, 'secret.yaml', PACK);
    const up = `../../${outside.split('/').slice(-1)[0]}/secret.yaml`;
    expect(await readPresetFiles(dir, mmd(), `preset: ${up}\n`)).toEqual({ [up]: null });
    expect(await readPresetFiles(dir, mmd(), 'preset: ../../../../../../../../etc/hosts.yaml\n')).toEqual({
      '../../../../../../../../etc/hosts.yaml': null,
    });
  });

  it('a symlink that leads out of the served folder is null', async () => {
    await put(outside, 'secret.yaml', PACK);
    await symlink(join(outside, 'secret.yaml'), join(dir, 'link.yaml'));
    expect(await readPresetFiles(dir, mmd(), 'preset: ../link.yaml\n')).toEqual({ '../link.yaml': null });
  });

  it('a file over the size limit is null', async () => {
    await put(dir, 'sub/big.yaml', 'a: ' + 'x'.repeat(300 * 1024));
    expect(await readPresetFiles(dir, mmd(), 'preset: big.yaml\n')).toEqual({ 'big.yaml': null });
  });

  it('with no root (the command line) the path is trusted', async () => {
    await put(outside, 'secret.yaml', PACK);
    const abs = join(dir, 'sub', 'd.mmd');
    const up = `../../${outside.split('/').slice(-1)[0]}/secret.yaml`;
    expect(await readPresetFiles(null, abs, `preset: ${up}\n`)).toBeDefined();
  });
});

describe('snapshots carry the pack file', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await makeTempDiagramDir();
    await put(dir, 'packs/team.yaml', PACK);
    await writeFile(join(dir, 'purchase-request.flow.yaml'), CONFIG('packs/team.yaml'), 'utf8');
  });
  afterEach(async () => {
    await removeTempDir(dir);
  });

  it('readDiagram: presets and a preset version, which a pack edit changes without touching the three files', async () => {
    const a = await readDiagram(dir, 'purchase-request.mmd');
    expect(a.presets).toEqual({ 'packs/team.yaml': PACK });
    expect(a.versions.preset).toMatch(/^[0-9a-f]{40}$/);
    await put(dir, 'packs/team.yaml', PACK + '# edited\n');
    const b = await readDiagram(dir, 'purchase-request.mmd');
    expect(b.versions.preset).not.toBe(a.versions.preset);
    expect({ ...b.versions, preset: 0 }).toEqual({ ...a.versions, preset: 0 });
  });

  it('a diagram that names no pack file has neither', async () => {
    await writeFile(join(dir, 'purchase-request.flow.yaml'), 'preset: cloud\n', 'utf8');
    const s = await readDiagram(dir, 'purchase-request.mmd');
    expect(s.presets).toBeUndefined();
    expect('preset' in s.versions).toBe(false);
  });

  it('a PUT that names a pack gets the pack back, and its conflict check ignores the pack version', async () => {
    const cur = await readDiagram(dir, 'purchase-request.mmd');
    // The client's base carries a stale preset version: only the three files decide a conflict.
    const base = { ...cur.versions, preset: 'stale' };
    const next = CONFIG('packs/team.yaml') + '# more\n';
    const r = await applyPut(dir, 'purchase-request.mmd', base, { mmd: cur.files.mmd, config: next, layout: cur.files.layout });
    expect(r.conflict).toBe(false);
    expect(r.snapshot.presets).toEqual({ 'packs/team.yaml': PACK });
    expect(r.snapshot.versions.preset).toBe(cur.versions.preset);
  });
});

describe('the server watches the pack file', () => {
  let dir: string;
  let handle: ServeHandle;
  let base: string;
  beforeEach(async () => {
    dir = await makeTempDiagramDir();
    await put(dir, 'packs/team.yaml', PACK);
    await writeFile(join(dir, 'purchase-request.flow.yaml'), CONFIG('packs/team.yaml'), 'utf8');
    handle = await serve({ dir, port: 0, watchDebounceMs: 20 });
    base = `http://127.0.0.1:${handle.port}`;
  });
  afterEach(async () => {
    await handle.close();
    await removeTempDir(dir);
  });

  it('GET /api/diagram includes the pack', async () => {
    const body = (await (await fetch(`${base}/api/diagram?file=purchase-request.mmd`)).json()) as { presets: Record<string, string | null> };
    expect(body.presets).toEqual({ 'packs/team.yaml': PACK });
  });

  it('editing the pack file pushes a "changed" event carrying the new text', async () => {
    const capture = captureSse(`${base}/api/events?file=purchase-request.mmd`);
    await sleep(50);
    const edited = 'kinds:\n  job: {label: Background job, icon: queue}\n';
    await put(dir, 'packs/team.yaml', edited);
    await waitFor(() => capture.events.some((e) => e.event === 'changed'), 1500);
    const payload = JSON.parse(capture.events.find((e) => e.event === 'changed')!.data) as { presets: Record<string, string> };
    expect(payload.presets['packs/team.yaml']).toBe(edited);
    capture.stop();
  });

  it('the UI\'s own save of a diagram with a pack does not echo back as a change', async () => {
    const capture = captureSse(`${base}/api/events?file=purchase-request.mmd`);
    await sleep(50);
    const cur = (await (await fetch(`${base}/api/diagram?file=purchase-request.mmd`)).json()) as {
      files: { mmd: string; config: string; layout: string }; versions: Record<string, string | null>;
    };
    const res = await fetch(`${base}/api/diagram?file=purchase-request.mmd`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base: cur.versions, files: { ...cur.files, config: cur.files.config + '# note\n' } }),
    });
    expect(res.status).toBe(200);
    await sleep(400);
    expect(capture.events).toEqual([]);
    capture.stop();
  });
});
