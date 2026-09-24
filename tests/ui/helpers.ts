// Helpers for the UI tests. Like the acceptance suite, the tests drive the UI only through the §8.3 DOM attributes
// and check the files on disk.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { LayoutResult } from '../../src/core/types';
import { E2E_DIR } from './env';

const ROOT = join(import.meta.dirname, '../..');
const FIXTURE = join(ROOT, 'fixtures/purchase-request');

export interface Files {
  mmd: string;
  config: string | null;
  layout: string | null;
}

export const PR: Files = {
  mmd: readFileSync(join(FIXTURE, 'purchase-request.mmd'), 'utf8'),
  config: readFileSync(join(FIXTURE, 'purchase-request.flow.yaml'), 'utf8'),
  layout: readFileSync(join(FIXTURE, 'purchase-request.layout.json'), 'utf8'),
};

/** A diagram of its own for one test, written into the served directory. */
export class Diagram {
  readonly base: string;
  constructor(base: string) {
    this.base = base;
  }
  get file(): string {
    return `${this.base}.mmd`;
  }
  path(kind: keyof Files): string {
    const ext = kind === 'mmd' ? '.mmd' : kind === 'config' ? '.flow.yaml' : '.layout.json';
    return join(E2E_DIR, this.base + ext);
  }
  read(): Files {
    const get = (k: keyof Files) => (existsSync(this.path(k)) ? readFileSync(this.path(k), 'utf8') : null);
    return { mmd: get('mmd')!, config: get('config'), layout: get('layout') };
  }
  /** Write (or delete, for null) files on disk, as another author would. */
  write(files: Partial<Files>): void {
    for (const k of ['mmd', 'config', 'layout'] as const) {
      if (!(k in files)) continue;
      const v = files[k];
      if (v === null || v === undefined) rmSync(this.path(k), { force: true });
      else writeFileSync(this.path(k), v);
    }
  }
  /** `flowmap layout --json` on the files as they are on disk. */
  cliLayout(): LayoutResult {
    const r = spawnSync(process.execPath, [join(ROOT, 'dist/cli.js'), 'layout', this.path('mmd'), '--json'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`flowmap layout failed: ${r.stderr}`);
    return JSON.parse(r.stdout) as LayoutResult;
  }
}

let seq = 0;

export function makeDiagram(info: TestInfo, files: Files = PR): Diagram {
  const slug = info.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const d = new Diagram(`t-${slug}-${info.workerIndex}-${++seq}`);
  d.write(files);
  if (files.config === null) d.write({ config: null });
  if (files.layout === null) d.write({ layout: null });
  return d;
}

export async function open(page: Page, d: Diagram): Promise<void> {
  await page.goto(`/?file=${encodeURIComponent(d.file)}`);
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.locator('[data-node-id]').first()).toBeVisible();
}

export const node = (page: Page, id: string): Locator => page.locator(`[data-node-id="${id}"]`);
export const lane = (page: Page, id: string): Locator => page.locator(`[data-lane-id="${id}"]`);

export async function attrs(loc: Locator) {
  return loc.evaluate((el: Element) => {
    const d = (el as HTMLElement).dataset;
    return {
      kind: d.kind!, lane: d.lane!, pinned: d.pinned === 'true', selected: d.selected === 'true',
      x: Number(d.x), y: Number(d.y), width: Number(d.width), height: Number(d.height),
    };
  });
}

/** The canvas zoom, measured from a node's on-screen width. */
export async function zoomOf(page: Page, id: string): Promise<number> {
  const a = await attrs(node(page, id));
  const box = (await node(page, id).boundingBox())!;
  return box.width / a.width;
}

/**
 * Mouse drag options: `shift` held throughout; `alt` held throughout (v1.1: a block drag with Alt doesn't snap, UI39,
 * so a test that checks the exact drop position holds it, as §10 Part 3 says).
 */
export interface DragOpts {
  shift?: boolean;
  alt?: boolean;
}

/** Drag with the mouse from the centre of `loc` by (dx, dy) screen px, in small steps like a person. */
export async function dragBy(page: Page, loc: Locator, dx: number, dy: number, opts: DragOpts = {}): Promise<void> {
  const box = (await loc.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await dragFromTo(page, { x, y }, { x: x + dx, y: y + dy }, opts);
}

export async function dragFromTo(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: DragOpts = {},
): Promise<void> {
  if (opts.shift) await page.keyboard.down('Shift');
  if (opts.alt) await page.keyboard.down('Alt');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up('Alt');
  if (opts.shift) await page.keyboard.up('Shift');
}

/** Poll the disk until `check` passes (default: within 1 s, UI30). */
export async function eventually<T>(read: () => T, check: (v: T) => boolean, timeout = 1000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = read();
    if (check(v)) return v;
    if (Date.now() - start > timeout) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
}

export async function saved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-status')).toHaveText('saved');
}

/** Every node, lane and edge in the UI equals `flowmap layout` output for the files on disk (U9). */
export async function expectMatchesCli(page: Page, d: Diagram): Promise<void> {
  const cli = d.cliLayout();
  await expect(page.locator('[data-node-id]')).toHaveCount(cli.nodes.length);
  const ui = await page.locator('[data-node-id]').evaluateAll((els) =>
    els.map((el) => {
      const s = (el as HTMLElement).dataset;
      return { id: s.nodeId, kind: s.kind, lane: s.lane, pinned: s.pinned === 'true', x: Number(s.x), y: Number(s.y), width: Number(s.width), height: Number(s.height) };
    }),
  );
  const want = cli.nodes.map((n) => ({ id: n.id, kind: n.kind, lane: n.lane, pinned: n.pinned, x: n.x, y: n.y, width: n.width, height: n.height }));
  expect(sortById(ui)).toEqual(sortById(want));
  const lanes = await page.locator('[data-lane-id]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.laneId));
  expect(lanes).toEqual(cli.lanes.map((l) => l.id));
  const edges = await page.locator('[data-edge-id]').evaluateAll((els) =>
    els.map((el) => {
      const s = (el as SVGElement).dataset;
      return { id: s.edgeId, source: s.source, target: s.target };
    }),
  );
  expect(sortById(edges)).toEqual(sortById(cli.edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))));
}

function sortById<T extends { id?: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => (a.id! < b.id! ? -1 : a.id! > b.id! ? 1 : 0));
}

/** The pins in a layout file's text. */
export function pins(layout: string | null): Record<string, { lane: string; along: number; across: number }> {
  return layout ? (JSON.parse(layout) as { nodes: Record<string, { lane: string; along: number; across: number }> }).nodes : {};
}

/** The lane a node is declared in, read from `.mmd` text (canonical form: `  subgraph <id> …` blocks). */
export function declaredLane(mmd: string, id: string): string | null {
  let current: string | null = null;
  for (const line of mmd.split('\n')) {
    const sg = /^\s*subgraph\s+([A-Za-z_][\w-]*)/.exec(line);
    if (sg) current = sg[1]!;
    else if (/^\s*end\s*$/.test(line)) current = null;
    else if (new RegExp(`^\\s*${id}(\\[|\\{|\\(|@)`).test(line)) return current ?? '_unassigned';
  }
  return null;
}

/** A point inside a lane's band that no node covers (for "click a lane's empty area"). */
export async function emptyPointInLane(page: Page, laneId: string): Promise<{ x: number; y: number }> {
  return page.evaluate((id) => {
    const laneEl = document.querySelector(`[data-lane-id="${id}"]`)!;
    const r = laneEl.getBoundingClientRect();
    for (let fx = 0.3; fx < 0.99; fx += 0.03) {
      for (const fy of [0.5, 0.3, 0.7, 0.2, 0.8]) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit && hit.closest('[data-lane-id]') === laneEl && !hit.closest('[data-node-id], [data-edge-id], [data-lane-header]')) {
          return { x, y };
        }
      }
    }
    throw new Error(`no empty point in lane ${id}`);
  }, laneId);
}
