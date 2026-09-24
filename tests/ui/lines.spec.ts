// Lines by hand (design.md §8.2 UI36–UI38; §10 U13, P23–P25, and their undo in P30), driven only through the §8.3
// attributes: `data-segment`, `data-bend`, `data-edge-end`, `data-role="edge-label"`, `data-manual`, `data-points`,
// `data-handle="source"` with `data-port`, `data-port-target`, the context menu's `data-menu-item`s, and each node's
// `data-x/y/width/height` (which also give the canvas's zoom and pan). Every change is checked on disk against the same
// change made by hand: the `.mmd` byte for byte, the config untouched, the layout file as parsed JSON (ignoring hints).
// Drags that must land exactly hold Alt, so snapping (UI39) can't move them (§10 Part 3).
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { format, parse } from '../../src/core/mmd';
import type { LayoutResult } from '../../src/core/types';
import { makeDiagram, node, open, PR, saved, settled, type Diagram, type Files } from './helpers';

// ---- files ---------------------------------------------------------------------------------------------------------

const ROOT = join(import.meta.dirname, '../..');
/** The CLI the served build came from (a private build can point the tests at its own). */
const CLI = process.env.FLOWMAP_E2E_CLI ?? join(ROOT, 'dist/cli.js');

function cliLayout(d: Diagram): LayoutResult {
  const r = spawnSync(process.execPath, [CLI, 'layout', d.path('mmd'), '--json'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`flowmap layout failed: ${r.stderr}`);
  return JSON.parse(r.stdout) as LayoutResult;
}

/** `flowmap fmt` on hand-edited text. */
function canon(text: string): string {
  const { diagram, problems } = parse(text);
  if (problems.errors.length) throw new Error(`hand edit has errors: ${JSON.stringify(problems.errors)}`);
  return format(diagram);
}

type Json = Record<string, unknown>;
type Pin = { lane: string; along: number; across: number };
type EdgeEntry = { source_side?: string; target_side?: string; points?: Pin[]; label_at?: number };

/** The layout file as parsed JSON, without `hints`. */
function layoutJs(text: string | null): Json | null {
  if (text === null) return null;
  const { hints: _h, ...rest } = JSON.parse(text) as Json;
  return rest;
}

/** The fixture's layout file with `edges` set by hand (an empty map is left out, §5). */
function withEdges(edges: Record<string, EdgeEntry>, base: string | null = PR.layout): Json {
  const js = { ...(layoutJs(base) ?? { version: 1, nodes: {} }) };
  if (Object.keys(edges).length) js.edges = edges;
  else delete js.edges;
  return js;
}

/** The files once the action has landed and the page has saved (helpers `settled`). */
const onDisk = (page: Page, d: Diagram, check: (f: Files) => boolean): Promise<Files> => settled(page, d, check);

const sameFiles = (a: Files, b: Files) => a.mmd === b.mmd && a.config === b.config && a.layout === b.layout;

/** The files on disk, once the layout file's content (ignoring hints) is `layout` and the `.mmd` is `mmd`. */
async function expectFiles(page: Page, d: Diagram, mmd: string, layout: Json): Promise<Files> {
  const f = await onDisk(page, d, (x) => x.mmd === mmd && JSON.stringify(layoutJs(x.layout)) === JSON.stringify(layout));
  expect(f.mmd).toBe(mmd);
  expect(f.config).toBe(PR.config); // untouched, byte for byte
  expect(layoutJs(f.layout)).toEqual(layout);
  return f;
}

/** Undo restores `before` byte for byte; redo re-applies `after` byte for byte (UI28, P30). */
async function expectUndoRedo(page: Page, d: Diagram, before: Files, after: Files): Promise<void> {
  await saved(page);
  await page.getByTestId('undo').click();
  expect(await onDisk(page, d, (f) => sameFiles(f, before))).toEqual(before);
  await saved(page);
  await page.getByTestId('redo').click();
  expect(await onDisk(page, d, (f) => sameFiles(f, after))).toEqual(after);
  await saved(page);
}

/** UI and `flowmap layout` agree on every drawn line (`data-points`, `data-manual`, U13). */
async function expectLinesMatchCli(page: Page, d: Diagram): Promise<void> {
  const cli = cliLayout(d);
  const ui = await page.locator('[data-edge-id]').evaluateAll((els) =>
    els.map((el) => {
      const s = (el as SVGElement).dataset;
      return { id: s.edgeId!, points: s.points!, manual: s.manual! };
    }),
  );
  const want = cli.edges.map((e) => ({ id: e.id, points: e.points.map((p) => p.join(',')).join(' '), manual: String(e.manual) }));
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1);
  expect(ui.sort(byId)).toEqual(want.sort(byId));
}

// ---- the canvas, through §8.3 only -----------------------------------------------------------------------------------

/** Where diagram coordinates are on screen, from a node's `data-x/y/width` and its box. */
async function view(page: Page): Promise<{ z: number; toScreen: (x: number, y: number) => { x: number; y: number } }> {
  const n = node(page, 'p01');
  const box = (await n.boundingBox())!;
  const a = await n.evaluate((el) => ({ x: Number((el as HTMLElement).dataset.x), y: Number((el as HTMLElement).dataset.y), w: Number((el as HTMLElement).dataset.width) }));
  const z = box.width / a.w;
  const ox = box.x - a.x * z;
  const oy = box.y - a.y * z;
  return { z, toScreen: (x, y) => ({ x: ox + x * z, y: oy + y * z }) };
}

/** Zoom in (wheel, UI3) around a block so drags are a person's size. */
async function zoomTo(page: Page, id: string, steps = 3): Promise<void> {
  const z0 = (await view(page)).z;
  const b = (await node(page, id).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (let i = 0; i < steps; i++) await page.mouse.wheel(0, -200);
  await expect.poll(async () => (await view(page)).z).toBeGreaterThan(z0 * 1.2 ** steps);
}

/** UI10 rounding (halves toward −∞), as the ops round a dragged position. */
const roundPx = (v: number) => Math.ceil(v - 0.5) + 0;

/**
 * A screen distance (whole px) for a drag of about `d` diagram px at zoom `z`, and the diagram distance it stores. A
 * distance whose diagram value is near a rounding boundary is nudged by a pixel, so the expectation is exact.
 */
function screenFor(d: number, z: number): { s: number; world: number } {
  let s = Math.round(d * z);
  const frac = (v: number) => v - Math.floor(v);
  if (Math.abs(frac(s / z) - 0.5) < 0.15) s += 1;
  return { s, world: roundPx(s / z) };
}

async function centre(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const b = (await page.locator(selector).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Press at `from`, move like a person, release at `from + (dx, dy)` (screen px). */
async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number, opts: { alt?: boolean } = {}): Promise<void> {
  if (opts.alt) await page.keyboard.down('Alt');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (dx * i) / 8, from.y + (dy * i) / 8);
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up('Alt');
}

const edge = (page: Page, id: string) => page.locator(`[data-edge-id="${id}"]`);

/** Select a line by clicking a point of its own path. */
async function selectLine(page: Page, id: string): Promise<void> {
  const p = await page.evaluate((id) => {
    const g = document.querySelector(`[data-edge-id="${CSS.escape(id)}"]`)!;
    const path = g.querySelector('path')!;
    const len = path.getTotalLength();
    const m = path.getScreenCTM()!;
    for (const f of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const q = path.getPointAtLength(len * f);
      const x = q.x * m.a + q.y * m.c + m.e;
      const y = q.x * m.b + q.y * m.d + m.f;
      if (document.elementFromPoint(x, y)?.closest('[data-edge-id]') === g) return { x, y };
    }
    throw new Error(`no clickable point on ${id}`);
  }, id);
  await page.mouse.click(p.x, p.y);
  await expect(edge(page, id)).toHaveAttribute('data-selected', 'true');
}

async function menuItem(page: Page, name: string): Promise<void> {
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  await menu.locator(`[data-menu-item="${name}"]`).click();
  await expect(menu).toHaveCount(0);
}

/** A bend point `{lane, along, across}` for diagram point (x, y) in the fixture (LR, no negative values): §5 by hand. */
function pin(cli: LayoutResult, x: number, y: number): Pin {
  const lane = cli.lanes.find((l) => y >= l.y && y < l.y + l.height) ?? cli.lanes[cli.lanes.length - 1]!;
  return { lane: lane.id, along: x, across: y - lane.y };
}

// ---- UI36: becoming manual, bend drag -----------------------------------------------------------------------------

test('bend drag on an automatic line: it becomes manual, storing its corners, the end off its port and its sides (P23)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const cli = cliLayout(d);
  // m02 -> p05 is drawn (1479,188) (1479,248) (1616,248): it leaves m02's bottom vertex, but reaches p05's left side
  // above its port (1616,264), so that end is a bend point too once the line is manual.
  expect(cli.edges.find((e) => e.id === 'm02->p05')!.points).toEqual([[1479, 188], [1479, 248], [1616, 248]]);
  await zoomTo(page, 'm02');
  await expect(edge(page, 'm02->p05')).toHaveAttribute('data-manual', 'false');
  await selectLine(page, 'm02->p05');
  const line = edge(page, 'm02->p05');
  await expect(line.locator('[data-bend]')).toHaveCount(2);
  await expect(line.locator('[data-segment]')).toHaveCount(2);
  const { z } = await view(page);
  const up = screenFor(-18, z);
  await drag(page, await centre(page, '[data-edge-id="m02->p05"] [data-bend="0"]'), 0, up.s, { alt: true });
  const want = withEdges({
    'm02->p05': { source_side: 'bottom', target_side: 'left', points: [pin(cli, 1479, 248 + up.world), pin(cli, 1616, 248)] },
  });
  const files = await expectFiles(page, d, PR.mmd, want);
  await expect(line).toHaveAttribute('data-manual', 'true');
  await expect(line).toHaveAttribute('data-selected', 'true');
  await expectLinesMatchCli(page, d);
  await expectUndoRedo(page, d, PR, files);
});

// ---- UI36: segment drags ----------------------------------------------------------------------------------------------

test('segment drag in the middle slides it sideways; both corners move (P23)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const cli = cliLayout(d);
  // p05 -> v01: (1756,264) (1820,264) (1820,566) (1828,566); segment 1 is the vertical one at x = 1820.
  await zoomTo(page, 'p05');
  await selectLine(page, 'p05->v01');
  const line = edge(page, 'p05->v01');
  await expect(line.locator('[data-segment]')).toHaveCount(3);
  const { z } = await view(page);
  const right = screenFor(40, z);
  // The segment only moves square to itself: the vertical part of the drag is ignored.
  await drag(page, await centre(page, '[data-edge-id="p05->v01"] [data-segment="1"]'), right.s, 17);
  const x = 1820 + right.world;
  const want = withEdges({ 'p05->v01': { source_side: 'right', target_side: 'left', points: [pin(cli, x, 264), pin(cli, x, 566)] } });
  const files = await expectFiles(page, d, PR.mmd, want);
  await expect(line).toHaveAttribute('data-points', `1756,264 ${x},264 ${x},566 1828,566`);
  await expect(line).toHaveAttribute('data-manual', 'true');
  await expectLinesMatchCli(page, d);
  await expectUndoRedo(page, d, PR, files);
});

test('segment drag attached to ports gets a 20 px stub at each end; dragging it back into line tidies every point away (P23)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const cli = cliLayout(d);
  // p01 -> p02 is one straight segment from p01's right port (686,264) to p02's left vertex (758,264).
  await zoomTo(page, 'p01');
  await selectLine(page, 'p01->p02');
  const line = edge(page, 'p01->p02');
  await expect(line.locator('[data-segment]')).toHaveCount(1);
  await expect(line.locator('[data-bend]')).toHaveCount(0);
  const { z } = await view(page);
  const down = screenFor(30, z);
  await drag(page, await centre(page, '[data-edge-id="p01->p02"] [data-segment="0"]'), 0, down.s);
  const y = 264 + down.world;
  const stubbed = withEdges({
    'p01->p02': {
      source_side: 'right', target_side: 'left',
      points: [pin(cli, 706, 264), pin(cli, 706, y), pin(cli, 738, y), pin(cli, 738, 264)],
    },
  });
  const files1 = await expectFiles(page, d, PR.mmd, stubbed);
  await expect(line).toHaveAttribute('data-points', `686,264 706,264 706,${y} 738,${y} 738,264 758,264`);
  await expect(line.locator('[data-segment]')).toHaveCount(5);
  await expect(line.locator('[data-bend]')).toHaveCount(4);
  await expectUndoRedo(page, d, PR, files1);

  // Tidy: the middle segment dragged back onto the ports' line. Every point is then in a straight row or on top of a
  // neighbour, so `points` goes and the line is automatic again; its sides stay.
  await drag(page, await centre(page, '[data-edge-id="p01->p02"] [data-segment="2"]'), 0, -down.s);
  const files2 = await expectFiles(page, d, PR.mmd, withEdges({ 'p01->p02': { source_side: 'right', target_side: 'left' } }));
  await expect(line).toHaveAttribute('data-manual', 'false');
  await expect(line).toHaveAttribute('data-points', '686,264 758,264');
  await expectLinesMatchCli(page, d);
  await expectUndoRedo(page, d, files1, files2);
});

test('while a segment or bend point is dragged, the line is drawn live in its new shape, orthogonal', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await zoomTo(page, 'p05');
  await selectLine(page, 'p05->v01');
  const from = await centre(page, '[data-edge-id="p05->v01"] [data-segment="1"]');
  const line = edge(page, 'p05->v01');
  // The preview isn't part of §8.3: read the line's own drawing (its paths) while dragging.
  const drawing = () => line.locator('path').evaluateAll((els) => els.map((e) => e.getAttribute('d') ?? '').join(' | '));
  const before = await drawing();
  const points = await line.getAttribute('data-points');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y, { steps: 4 });
  await page.mouse.move(from.x + 45, from.y, { steps: 4 });
  const during = await drawing();
  expect(during).not.toBe(before);
  // Straight runs and quarter-circle corners only: no curves across the canvas.
  expect(during).not.toMatch(/[CcSsAa]/);
  await page.keyboard.press('Escape'); // cancels: nothing written
  await page.mouse.up();
  await saved(page);
  expect(d.read()).toEqual(PR);
  await expect(line).toHaveAttribute('data-points', points!);
});

// ---- UI36: context menu: add, remove, reset ------------------------------------------------------------------------

test('add a bend point where the line was right-clicked, remove one, reset the line (P23)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const cli = cliLayout(d);
  await zoomTo(page, 'p05');
  const v = await view(page);
  // Right-click the vertical segment of p05 -> v01 near (1820, 415), in the finance lane. Pointer events come in whole
  // screen px, so click a whole pixel on the line and work out the diagram point it is.
  const at = v.toScreen(1820, 415);
  let sy = Math.round(at.y);
  const wy = (y: number) => (y - v.toScreen(0, 0).y) / v.z;
  if (Math.abs(wy(sy) - Math.floor(wy(sy)) - 0.5) < 0.15) sy += 1;
  const y415 = roundPx(wy(sy));
  expect(Math.abs(y415 - 415)).toBeLessThanOrEqual(2);
  await page.mouse.click(at.x, sy, { button: 'right' });
  const names = await page.getByTestId('context-menu').locator('[data-menu-item]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.menuItem));
  expect(names).toContain('add-bend');
  expect(names).not.toContain('remove-bend');
  expect(names).not.toContain('reset-line'); // automatic, no stored side
  await menuItem(page, 'add-bend');
  // Inserted in path order and kept although it lies in a straight row; the line becomes manual (its corners and
  // sides are stored).
  const added = withEdges({
    'p05->v01': { source_side: 'right', target_side: 'left', points: [pin(cli, 1820, 264), pin(cli, 1820, y415), pin(cli, 1820, 566)] },
  });
  expect(pin(cli, 1820, y415)).toEqual({ lane: 'finance', along: 1820, across: y415 - 412 });
  const files1 = await expectFiles(page, d, PR.mmd, added);
  const line = edge(page, 'p05->v01');
  await expect(line).toHaveAttribute('data-selected', 'true');
  await expect(line.locator('[data-bend]')).toHaveCount(3);
  await expectUndoRedo(page, d, PR, files1);

  // Remove bend point 0 (the corner at (1820, 264)) from its own context menu.
  await line.locator('[data-bend="0"]').click({ button: 'right' });
  const onBend = await page.getByTestId('context-menu').locator('[data-menu-item]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.menuItem));
  expect(onBend).toContain('remove-bend');
  expect(onBend).not.toContain('add-bend');
  expect(onBend).toContain('reset-line'); // manual now
  await menuItem(page, 'remove-bend');
  const removed = withEdges({ 'p05->v01': { source_side: 'right', target_side: 'left', points: [pin(cli, 1820, y415), pin(cli, 1820, 566)] } });
  const files2 = await expectFiles(page, d, PR.mmd, removed);
  await expectLinesMatchCli(page, d);
  await expectUndoRedo(page, d, files1, files2);

  // Reset line: points and both sides go; the entry is empty, so it goes too.
  await selectLine(page, 'p05->v01');
  const mid = await page.evaluate(() => {
    const g = document.querySelector('[data-edge-id="p05->v01"]')!;
    const path = g.querySelector('path')!;
    const m = path.getScreenCTM()!;
    const q = path.getPointAtLength(path.getTotalLength() * 0.3);
    return { x: q.x * m.a + m.e, y: q.y * m.d + m.f };
  });
  await page.mouse.click(mid.x, mid.y, { button: 'right' });
  await menuItem(page, 'reset-line');
  const files3 = await expectFiles(page, d, PR.mmd, withEdges({}));
  await expect(line).toHaveAttribute('data-manual', 'false');
  await expectLinesMatchCli(page, d);
  await expectUndoRedo(page, d, files2, files3);
});

// ---- UI37: labels ----------------------------------------------------------------------------------------------------

/** Where a point projects onto a polyline, as a fraction of its length rounded to two decimals (UI37), by hand. */
function project(points: [number, number][], p: { x: number; y: number }): number {
  let total = 0;
  for (let k = 1; k < points.length; k++) total += Math.hypot(points[k]![0] - points[k - 1]![0], points[k]![1] - points[k - 1]![1]);
  let best = Infinity;
  let at = 0;
  let before = 0;
  for (let k = 1; k < points.length; k++) {
    const [ax, ay] = points[k - 1]!;
    const [bx, by] = points[k]!;
    const len = Math.hypot(bx - ax, by - ay);
    const t = len === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / (len * len)));
    const dist = Math.hypot(ax + t * (bx - ax) - p.x, ay + t * (by - ay) - p.y);
    if (dist < best - 1e-9) {
      best = dist;
      at = before + t * len;
    }
    before += len;
  }
  return Math.round((at / total) * 100) / 100;
}

test('drag a line’s label along its line: label_at is its projected centre, rounded to two decimals; reset it (P24)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const cli = cliLayout(d);
  const e = cli.edges.find((x) => x.id === 'p02->p03')!;
  // (823,292) (823,362) (970,362), label "no" centred at (841,305).
  await zoomTo(page, 'p02');
  const label = edge(page, 'p02->p03').locator('[data-role="edge-label"]');
  await expect(label).toHaveText('no');
  const { z } = await view(page);
  const dx = screenFor(70, z).s;
  const dy = screenFor(55, z).s;
  await drag(page, await centre(page, '[data-edge-id="p02->p03"] [data-role="edge-label"]'), dx, dy);
  const labelAt = project(e.points, { x: e.label_pos![0] + dx / z, y: e.label_pos![1] + dy / z });
  expect(labelAt).toBeGreaterThan(0.4);
  expect(labelAt).toBeLessThan(0.9);
  const files1 = await expectFiles(page, d, PR.mmd, withEdges({ 'p02->p03': { label_at: labelAt } }));
  // The label is drawn there: its centre at that fraction of the line (L8, within 2 px), and the line is unchanged.
  const after = cliLayout(d).edges.find((x) => x.id === 'p02->p03')!;
  expect(after.points).toEqual(e.points);
  await expect(edge(page, 'p02->p03')).toHaveAttribute('data-manual', 'false');
  const lb = (await label.boundingBox())!;
  const v = await view(page);
  const c = v.toScreen(after.label_pos![0], after.label_pos![1]);
  expect(Math.abs(lb.x + lb.width / 2 - c.x)).toBeLessThan(3);
  expect(Math.abs(lb.y + lb.height / 2 - c.y)).toBeLessThan(3);
  await expectUndoRedo(page, d, PR, files1);

  // A click on the label still selects the line, and a double-click still edits its text (UI17).
  await label.click();
  await expect(edge(page, 'p02->p03')).toHaveAttribute('data-selected', 'true');
  await label.dblclick();
  await expect(page.getByTestId('label-editor')).toBeVisible();
  await page.keyboard.press('Escape');

  // Reset label position (context menu), shown only while it has label_at.
  await label.click({ button: 'right' });
  await menuItem(page, 'reset-label');
  const files2 = await expectFiles(page, d, PR.mmd, withEdges({}));
  await expectUndoRedo(page, d, files1, files2);
  await label.click({ button: 'right' });
  const names = await page.getByTestId('context-menu').locator('[data-menu-item]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.menuItem));
  expect(names).not.toContain('reset-label');
  await page.keyboard.press('Escape');
});

// ---- UI38: connection handles and sides ------------------------------------------------------------------------------

test('every block has four connection handles, top, right, bottom, left, on its ports; no target handle', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  for (const id of ['p06', 'f01', 'v01', 'intake']) {
    const ports = await node(page, id).locator('[data-handle]').evaluateAll((els) => els.map((e) => [(e as HTMLElement).dataset.handle, (e as HTMLElement).dataset.port]));
    expect(ports).toEqual([['source', 'top'], ['source', 'right'], ['source', 'bottom'], ['source', 'left']]);
  }
  await expect(page.locator('[data-handle="target"]')).toHaveCount(0);
  await expect(page.locator('[data-port-target]')).toHaveCount(0);
  // In line with each port (a diamond's vertices), just outside the box.
  await zoomTo(page, 'f01');
  const v = await view(page);
  for (const [id, ports] of [
    ['p06', { top: [2085, 238], right: [2150, 264], bottom: [2085, 290], left: [2020, 264] }],
    ['f01', { top: [2327, 436], right: [2432, 464], bottom: [2327, 492], left: [2222, 464] }],
  ] as const) {
    await node(page, id).hover();
    for (const [side, [x, y]] of Object.entries(ports)) {
      const c = await centre(page, `[data-node-id="${id}"] [data-port="${side}"]`);
      const p = v.toScreen(x, y);
      const out = side === 'top' ? p.y - c.y : side === 'bottom' ? c.y - p.y : side === 'left' ? p.x - c.x : c.x - p.x;
      const along = side === 'top' || side === 'bottom' ? c.x - p.x : c.y - p.y;
      expect(Math.abs(along), `${id} ${side} in line with its port`).toBeLessThan(1.5);
      expect(out, `${id} ${side} just outside`).toBeGreaterThan(8);
      expect(out, `${id} ${side} just outside`).toBeLessThan(30);
    }
  }
});

test('connection handles never cover a lane header or a neighbouring block, hidden or shown', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const portAt = (x: number, y: number) =>
    page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x!, y!);
      return { port: el?.closest<HTMLElement>('[data-port]') ? `${el.closest<HTMLElement>('[data-node-id]')!.dataset.nodeId}:${el.closest<HTMLElement>('[data-port]')!.dataset.port}` : null, node: el?.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ?? null };
    }, [x, y]);
  const closedClear = async (label: string) => {
    // Hidden: a handle takes no pointer events at all.
    await page.mouse.move(5, 300);
    const closed = (await node(page, 'closed').boundingBox())!;
    for (const fy of [0.5, 0.8, 0.95]) {
      expect((await portAt(closed.x + closed.width / 2, closed.y + closed.height * fy)).node, `${label}: closed ${fy}`).toBe('closed');
    }
    // Shown (m02 hovered: its top handle points at `closed`, pinned 40 px above it): still clear of `closed`.
    await node(page, 'm02').hover();
    for (const fy of [0.5, 0.8, 0.99]) {
      expect((await portAt(closed.x + closed.width / 2, closed.y + closed.height * fy)).node, `${label}: closed ${fy}, m02 hovered`).toBe('closed');
    }
  };
  const headerClear = async (label: string) => {
    // The lane header strip beside a first-column block, with the block hovered.
    await node(page, 'intake').hover();
    const header = (await page.locator('[data-lane-header="requester"]').boundingBox())!;
    const intake = (await node(page, 'intake').boundingBox())!;
    const y = intake.y + intake.height / 2;
    for (let fx = 0.05; fx < 1; fx += 0.15) {
      expect((await portAt(header.x + header.width * fx, y)).port, `${label}: header at ${fx}`).toBeNull();
    }
    expect((await portAt(header.x + header.width - 1, y)).port, `${label}: header's end`).toBeNull();
  };
  await closedClear('fit');
  await headerClear('fit');
  await zoomTo(page, 'm02');
  await closedClear('zoomed');
  await page.getByTestId('fit').click();
  await zoomTo(page, 'intake');
  await headerClear('zoomed');
  // And a click on `closed` selects it.
  await node(page, 'closed').click();
  await expect(node(page, 'closed')).toHaveAttribute('data-selected', 'true');
});

test('connection handles and resize handles are both clickable on a selected block', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await zoomTo(page, 'p06');
  await node(page, 'p06').click();
  await expect(node(page, 'p06')).toHaveAttribute('data-selected', 'true');
  const hitAt = (p: { x: number; y: number }) =>
    page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x!, y!);
      return {
        port: el?.closest<HTMLElement>('[data-port]')?.dataset.port ?? null,
        resize: el?.closest<HTMLElement>('[data-resize]')?.dataset.resize ?? null,
      };
    }, [p.x, p.y]);
  for (const side of ['top', 'right', 'bottom', 'left']) {
    expect((await hitAt(await centre(page, `[data-node-id="p06"] [data-port="${side}"]`))).port, side).toBe(side);
  }
  const resize = node(page, 'p06').locator('[data-resize]');
  const n = await resize.count();
  test.info().annotations.push({ type: 'resize handles', description: String(n) });
  for (let i = 0; i < n; i++) {
    const name = await resize.nth(i).getAttribute('data-resize');
    const b = (await resize.nth(i).boundingBox())!;
    expect((await hitAt({ x: b.x + b.width / 2, y: b.y + b.height / 2 })).resize, `resize ${name}`).toBe(name);
  }
});

/** Drag from one of a block's connection handles and drop at `to` (screen). */
async function connectFrom(page: Page, id: string, side: string, to: { x: number; y: number }): Promise<void> {
  await node(page, id).hover();
  const from = await centre(page, `[data-node-id="${id}"] [data-port="${side}"]`);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
  await page.mouse.up();
}

test('connect from each side of a step: source_side is written, a drop elsewhere on the target leaves its side to the layout (P25)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await zoomTo(page, 'p06', 2);
  let mmd = PR.mmd;
  const entries: Record<string, EdgeEntry> = {};
  let before = PR;
  for (const [side, target] of [['top', 'm03'], ['right', 'p07'], ['bottom', 'f02'], ['left', 'p05']] as const) {
    await connectFrom(page, 'p06', side, await centre(page, `[data-node-id="${target}"]`));
    mmd = canon(`${mmd}  p06 --> ${target}\n`);
    entries[`p06->${target}`] = { source_side: side };
    const files = await expectFiles(page, d, mmd, withEdges(entries));
    await expect(edge(page, `p06->${target}`)).toHaveAttribute('data-selected', 'true');
    const drawn = cliLayout(d).edges.find((e) => e.id === `p06->${target}`)!;
    expect(drawn.source_side).toBe(side);
    await expectUndoRedo(page, d, before, files);
    before = files;
  }
  await expectLinesMatchCli(page, d);
});

test('connect from each vertex of a diamond (P25)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await zoomTo(page, 'f01', 2);
  let mmd = PR.mmd;
  const entries: Record<string, EdgeEntry> = {};
  const ids: Record<string, string> = { top: 'f01->p07#2', right: 'f01->f02#2', bottom: 'f01->v02', left: 'f01->v01' };
  let before = PR;
  for (const [side, target] of [['top', 'p07'], ['right', 'f02'], ['bottom', 'v02'], ['left', 'v01']] as const) {
    await connectFrom(page, 'f01', side, await centre(page, `[data-node-id="${target}"]`));
    mmd = canon(`${mmd}  f01 --> ${target}\n`);
    entries[ids[side]!] = { source_side: side };
    const files = await expectFiles(page, d, mmd, withEdges(entries));
    // The line leaves from the vertex (§6 L12: diamonds at their vertices).
    const drawn = cliLayout(d).edges.find((e) => e.id === ids[side])!;
    const vertex = { top: [2327, 436], right: [2432, 464], bottom: [2327, 492], left: [2222, 464] }[side];
    expect(drawn.points[0]).toEqual(vertex);
    await expectUndoRedo(page, d, before, files);
    before = files;
  }
});

test('while connecting, the block under the pointer shows its connection points; a drop on one writes target_side (P25)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await zoomTo(page, 'p06', 2);
  await node(page, 'p06').hover();
  const from = await centre(page, '[data-node-id="p06"] [data-port="bottom"]');
  const v02 = await centre(page, '[data-node-id="v02"]');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + ((v02.x - from.x) * i) / 10, from.y + ((v02.y - from.y) * i) / 10);
  const points = node(page, 'v02').locator('[data-port-target]');
  await expect(points).toHaveCount(4);
  expect(await points.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.portTarget))).toEqual(['top', 'right', 'bottom', 'left']);
  await expect(page.locator('[data-port-target]')).toHaveCount(4); // only on the block under the pointer
  const top = await centre(page, '[data-node-id="v02"] [data-port-target="top"]');
  await page.mouse.move(top.x + 2, top.y + 1, { steps: 4 });
  await expect(node(page, 'v02').locator('[data-port-target="top"]')).toHaveAttribute('data-active', 'true');
  await page.mouse.up();
  await expect(page.locator('[data-port-target]')).toHaveCount(0);
  const mmd = canon(`${PR.mmd}  p06 --> v02\n`);
  const files = await expectFiles(page, d, mmd, withEdges({ 'p06->v02': { source_side: 'bottom', target_side: 'top' } }));
  const drawn = cliLayout(d).edges.find((e) => e.id === 'p06->v02')!;
  expect(drawn.points[drawn.points.length - 1]).toEqual([2796, 540]); // v02's top port
  await expectLinesMatchCli(page, d);
  await expectUndoRedo(page, d, PR, files);
});

test('reconnect an end onto another connection point of the same block: only its side changes (P25)', async ({ page }, info) => {
  // A manual line with a label position, written by hand.
  const start: Files = {
    ...PR,
    layout: `${JSON.stringify(withEdges({ 'p02->p03': { points: [{ lane: 'purchasing', along: 823, across: 150 }], label_at: 0.3 } }), null, 2)}\n`,
  };
  const d = makeDiagram(info, start);
  await open(page, d);
  await expect(edge(page, 'p02->p03')).toHaveAttribute('data-manual', 'true');
  await zoomTo(page, 'p03');
  await selectLine(page, 'p02->p03');
  const grip = await centre(page, '[data-edge-id="p02->p03"] [data-edge-end="target"]');
  const p03 = await centre(page, '[data-node-id="p03"]');
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(grip.x + ((p03.x - grip.x) * i) / 6, grip.y + ((p03.y - grip.y) * i) / 6);
  await expect(node(page, 'p03').locator('[data-port-target]')).toHaveCount(4);
  const bottom = await centre(page, '[data-node-id="p03"] [data-port-target="bottom"]');
  await page.mouse.move(bottom.x, bottom.y, { steps: 4 });
  await expect(node(page, 'p03').locator('[data-port-target="bottom"]')).toHaveAttribute('data-active', 'true');
  await page.mouse.up();
  const files1 = await expectFiles(page, d, PR.mmd, withEdges({
    'p02->p03': { points: [{ lane: 'purchasing', along: 823, across: 150 }], label_at: 0.3, target_side: 'bottom' },
  }));
  await expect(edge(page, 'p02->p03')).toHaveAttribute('data-selected', 'true');
  await expect(edge(page, 'p02->p03')).toHaveAttribute('data-manual', 'true');
  await expectLinesMatchCli(page, d);
  await expectUndoRedo(page, d, start, files1);

  // The source end onto a connection point of another block: its id follows, its points go, the moved end's side is
  // written, the other side and label_at stay (§8.2 "Keeping the layout file in step").
  await selectLine(page, 'p02->p03');
  const src = await centre(page, '[data-edge-id="p02->p03"] [data-edge-end="source"]');
  const p04 = await centre(page, '[data-node-id="p04"]');
  await page.mouse.move(src.x, src.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(src.x + ((p04.x - src.x) * i) / 6, src.y + ((p04.y - src.y) * i) / 6);
  const p04bottom = await centre(page, '[data-node-id="p04"] [data-port-target="bottom"]');
  await page.mouse.move(p04bottom.x, p04bottom.y, { steps: 4 });
  await page.mouse.up();
  const mmd = canon(PR.mmd.replace('  p02 -->|no| p03\n', '  p04 -->|no| p03\n'));
  const files2 = await expectFiles(page, d, mmd, withEdges({ 'p04->p03': { label_at: 0.3, target_side: 'bottom', source_side: 'bottom' } }));
  await expect(edge(page, 'p04->p03')).toHaveAttribute('data-selected', 'true');
  await expectLinesMatchCli(page, d);
  await expectUndoRedo(page, d, files1, files2);
});

test('the reconnect preview is orthogonal, not a curve', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await zoomTo(page, 'p03');
  await selectLine(page, 'p02->p03');
  const grip = await centre(page, '[data-edge-id="p02->p03"] [data-edge-end="target"]');
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(grip.x + 60, grip.y + 90, { steps: 6 });
  // The preview isn't part of §8.3; read its path's commands: straight runs and rounded corners only.
  const d1 = await page.locator('.fm-connect-line').getAttribute('d');
  expect(d1).toBeTruthy();
  expect(d1).not.toMatch(/[CcSsAa]/);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await saved(page);
  expect(d.read()).toEqual(PR);
});
