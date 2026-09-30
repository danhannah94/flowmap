// Amendment A13: the lanes' length along the flow. One handle on the lanes' far end (the pool's right edge for LR, its
// bottom for TB, `data-lane-length-resize`), spanning every lane. Like the other lane tests, these drive the UI through
// DOM attributes only and compare the files on disk with the same change made by hand: the `.mmd` and config byte for
// byte, the layout file as parsed JSON without `hints`. Undo and redo must restore each state byte for byte.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadDocument } from '../../src/core/document';
import { attrs, lane, makeDiagram, node, open, PR, saved, settled, zoomOf, type Diagram, type Files } from './helpers';

const withoutHints = (layout: string | null) => {
  if (layout === null) return null;
  const js = JSON.parse(layout) as Record<string, unknown>;
  delete js.hints;
  return js;
};

async function expectFiles(page: Page, d: Diagram, want: Files): Promise<Files> {
  const same = (f: Files) => f.mmd === want.mmd && f.config === want.config
    && JSON.stringify(withoutHints(f.layout)) === JSON.stringify(withoutHints(want.layout));
  const got = await settled(page, d, same, 3000);
  expect(got.mmd).toBe(want.mmd);
  expect(got.config).toBe(want.config);
  expect(withoutHints(got.layout)).toEqual(withoutHints(want.layout));
  await saved(page);
  return d.read();
}

async function expectUndoRedo(page: Page, d: Diagram, before: Files, after: Files): Promise<void> {
  await page.getByTestId('undo').click();
  await settled(page, d, (f) => f.mmd === before.mmd && f.config === before.config && f.layout === before.layout, 3000);
  await saved(page);
  expect(d.read()).toEqual(before);
  await page.getByTestId('redo').click();
  await settled(page, d, (f) => f.mmd === after.mmd && f.config === after.config && f.layout === after.layout, 3000);
  await saved(page);
  expect(d.read()).toEqual(after);
}

const handle = (page: Page) => page.locator('[data-lane-length-resize]');
const preview = (page: Page) => page.locator('[data-lane-length-preview]');
const header = (page: Page, id: string) => page.locator(`[data-lane-header="${id}"]`);
const lengthIn = (f: Files): number | undefined => (f.layout ? (JSON.parse(f.layout) as { lane_length?: number }).lane_length : undefined);
const hasLength = (f: Files) => lengthIn(f) !== undefined;
/** The lanes' length along the flow what the content needs, for these files (the core's own answer). */
const needOf = (f: Files) => loadDocument(f.mmd, f.config, f.layout, 'x.mmd').layout!.laneLengthNeed;

/** The PR files with a lane length (key order as the editor writes it: after `nodes`). */
const withLength = (length: number): Files => ({
  ...PR,
  layout: JSON.stringify({ version: 1, nodes: { closed: { lane: 'requester', along: 1400, across: 40 } }, lane_length: length }),
});

/**
 * Press on the length handle and move by `d` screen px along the flow, in small steps like a person. With `hold`, the
 * button stays down so the preview can be checked; call `page.mouse.up()` after.
 */
async function dragLength(page: Page, dir: 'LR' | 'TB', d: number, opts: { hold?: boolean } = {}): Promise<void> {
  const box = (await handle(page).boundingBox())!;
  const from = dir === 'TB'
    ? { x: box.x + Math.min(box.width / 2, 300), y: box.y + box.height / 2 }
    : { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 300) };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    const s = (d * i) / 8;
    await page.mouse.move(dir === 'TB' ? from.x : from.x + s, dir === 'TB' ? from.y + s : from.y);
  }
  if (!opts.hold) await page.mouse.up();
}

/** Zoom the view out (wheel over the canvas, UI3) so the far end has room to move on screen. */
async function zoomOut(page: Page): Promise<void> {
  const c = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(c.x + c.width * 0.2, c.y + c.height * 0.2);
  await page.mouse.wheel(0, 200);
  // The zoom has landed once a block's on-screen size stops changing.
  let w = -1;
  await expect.poll(async () => {
    const now = (await page.locator('[data-node-id]').first().boundingBox())!.width;
    const same = now === w;
    w = now;
    return same;
  }).toBe(true);
}

async function laneSpan(loc: Locator, dir: 'LR' | 'TB') {
  const a = await loc.evaluate((el) => {
    const s = (el as HTMLElement).style;
    return { left: parseFloat(s.left), top: parseFloat(s.top), width: parseFloat(s.width), height: parseFloat(s.height) };
  });
  return dir === 'TB' ? a.height : a.width;
}

test('A13: drag the lanes’ right edge to lengthen them; the preview shows the length; nothing else moves; undo and redo', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await zoomOut(page);
  const cli0 = d.cliLayout();
  const need = cli0.width;
  const before = { r01: await attrs(node(page, 'r01')), f01: await attrs(node(page, 'f01')) };
  const z = await zoomOf(page, 'r01');
  await expect(handle(page)).toHaveCount(1);
  // The handle spans every lane, on the pool's far end.
  const h = (await handle(page).boundingBox())!;
  const first = (await lane(page, 'requester').boundingBox())!;
  const last = (await lane(page, 'vendor').boundingBox())!;
  expect(Math.abs(h.y - first.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(h.y + h.height - (last.y + last.height))).toBeLessThanOrEqual(1);
  expect(Math.abs(h.x + h.width / 2 - (first.x + first.width))).toBeLessThanOrEqual(1);

  // Longer by 150 layout px, with the new far end and the length shown while dragging.
  await dragLength(page, 'LR', 150 * z, { hold: true });
  await expect(preview(page)).toBeVisible();
  const shown = Number(await preview(page).textContent());
  expect(Math.abs(shown - (need + 150))).toBeLessThanOrEqual(1);
  await page.mouse.up();
  await expect(preview(page)).toHaveCount(0);
  const sized = await settled(page, d, hasLength);
  const length = lengthIn(sized)!;
  expect(length).toBe(shown);
  const after = await expectFiles(page, d, withLength(length));
  // Every lane is that long; the blocks and the lanes' thickness are as they were.
  const cli = d.cliLayout();
  expect(cli.width).toBe(length);
  for (const l of cli.lanes) expect(l.width).toBe(length);
  expect(cli.height).toBe(cli0.height);
  expect(cli.nodes).toEqual(cli0.nodes);
  expect(await laneSpan(lane(page, 'finance'), 'LR')).toBe(length);
  expect(await attrs(node(page, 'r01'))).toEqual(before.r01);
  expect(await attrs(node(page, 'f01'))).toEqual(before.f01);
  await expectUndoRedo(page, d, PR, after);
});

test('A13: the far end stops at what the content needs, which removes the stored length; Escape cancels', async ({ page }, info) => {
  const long = needOf(PR) + 600;
  const d = makeDiagram(info, withLength(long));
  await open(page, d);
  await zoomOut(page);
  const z = await zoomOf(page, 'r01');
  expect(d.cliLayout().width).toBe(long);
  // Escape mid-drag: nothing is written.
  await dragLength(page, 'LR', -200 * z, { hold: true });
  await expect(preview(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preview(page)).toHaveCount(0);
  await page.mouse.up();
  await saved(page);
  expect(lengthIn(d.read())).toBe(long);
  // Far past the content: it stops at what the content needs, and the layout file loses the value.
  await dragLength(page, 'LR', -(long - needOf(PR) + 400) * z, { hold: true });
  expect(Number(await preview(page).textContent())).toBe(needOf(PR));
  await page.mouse.up();
  await expectFiles(page, d, PR);
  expect(d.cliLayout().width).toBe(needOf(PR));
});

test('A13: Reset length in the lane menu, and a double-click on the handle, fit the lanes again', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  // No length: the menu has no Reset length.
  await header(page, 'manager').getByTestId('lane-menu').click();
  await expect(page.getByTestId('lane-rename-label')).toBeVisible();
  await expect(page.getByTestId('lane-reset-length')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // With one (written by the other author), every lane's menu offers it.
  d.write({ layout: withLength(needOf(PR) + 400).layout });
  await expect.poll(async () => laneSpan(lane(page, 'manager'), 'LR')).toBe(needOf(PR) + 400);
  await header(page, 'manager').getByTestId('lane-menu').click();
  await page.getByTestId('lane-reset-length').click();
  await expectFiles(page, d, PR);
  await expect.poll(async () => laneSpan(lane(page, 'manager'), 'LR')).toBe(needOf(PR));
  await header(page, 'vendor').getByTestId('lane-menu').click();
  await expect(page.getByTestId('lane-reset-length')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // A double-click on the handle does the same, as one undo step.
  d.write({ layout: withLength(needOf(PR) + 200).layout });
  await expect.poll(async () => laneSpan(lane(page, 'manager'), 'LR')).toBe(needOf(PR) + 200);
  const long = d.read();
  await handle(page).dblclick();
  const fit = await expectFiles(page, d, PR);
  await expect(page.getByTestId('label-editor')).toHaveCount(0);
  await expectUndoRedo(page, d, long, fit);
});

test('A13: top-to-bottom the handle is the bottom edge; the direction toggle keeps the length', async ({ page }, info) => {
  const start: Files = { ...PR, mmd: PR.mmd.replace('flowchart LR', 'flowchart TB') };
  const d = makeDiagram(info, start);
  await open(page, d);
  await zoomOut(page);
  const need = d.cliLayout().height;
  const z = await zoomOf(page, 'r01');
  const h = (await handle(page).boundingBox())!;
  const first = (await lane(page, 'requester').boundingBox())!;
  expect(Math.abs(h.y + h.height / 2 - (first.y + first.height))).toBeLessThanOrEqual(1);
  expect(h.width).toBeGreaterThan(h.height);

  await dragLength(page, 'TB', 120 * z);
  const sized = await settled(page, d, hasLength);
  const length = lengthIn(sized)!;
  expect(Math.abs(length - (need + 120))).toBeLessThanOrEqual(1);
  await saved(page);
  const cli = d.cliLayout();
  expect(cli.height).toBe(length);
  for (const l of cli.lanes) expect(l.height).toBe(length);

  // Left to right: the same stored value, now along x (at least what the content needs that way round).
  await page.getByTestId('direction-toggle').click();
  const lr = await settled(page, d, (f) => f.mmd.startsWith('flowchart LR'));
  await saved(page);
  expect(lengthIn(d.read())).toBe(length);
  const lrNeed = needOf({ ...lr, layout: JSON.stringify({ ...JSON.parse(lr.layout!), lane_length: undefined }) });
  expect(d.cliLayout().width).toBe(Math.max(length, lrNeed));
  await expect(handle(page)).toHaveCount(1);
  expect(await laneSpan(lane(page, 'finance'), 'LR')).toBe(Math.max(length, lrNeed));
  // And back: top to bottom again, the lanes are exactly as long as they were dragged.
  await page.getByTestId('direction-toggle').click();
  await settled(page, d, (f) => f.mmd.startsWith('flowchart TB'));
  await saved(page);
  expect(lengthIn(d.read())).toBe(length);
  expect(d.cliLayout().height).toBe(length);
  await expect.poll(async () => laneSpan(lane(page, 'finance'), 'TB')).toBe(length);
});

test('A13: a diagram without lanes has no length handle; the Unassigned lane of a swimlane map is spanned too', async ({ page }, info) => {
  const d = makeDiagram(info, { mmd: 'flowchart LR\n  a["Alpha"]\n  b["Beta"]\n  a --> b\n', config: null, layout: null });
  await open(page, d);
  await expect(node(page, 'a')).toBeVisible();
  await expect(handle(page)).toHaveCount(0);

  const u = makeDiagram(info, { ...PR, mmd: PR.mmd.replace('flowchart LR\n', 'flowchart LR\n  loose["Loose end"]\n') });
  await open(page, u);
  await expect(lane(page, '_unassigned')).toBeVisible();
  const h = (await handle(page).boundingBox())!;
  const ub = (await lane(page, '_unassigned').boundingBox())!;
  expect(Math.abs(h.y + h.height - (ub.y + ub.height))).toBeLessThanOrEqual(1);
});
