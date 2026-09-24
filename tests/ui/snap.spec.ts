// UI39 snap and guides, through the §8.3 attributes only, checking the files on disk. Each test lays its blocks out
// with pins and sizes in the layout file (a lane-free diagram: `along` is x and `across` is y), so every alignment is
// known exactly. The diagrams are small, so the view opens at 100% (fit never zooms in past it): screen px = world px.
import { expect, test, type Page } from '@playwright/test';
import { format, parse } from '../../src/core/mmd';
import { attrs, eventually, makeDiagram, node, open, pins, saved, zoomOf, type Diagram, type Files } from './helpers';

type Box = [along: number, across: number, width: number, height: number];

function diagram(blocks: Record<string, Box>): Files {
  const ids = Object.keys(blocks);
  const mmd = format(parse(`flowchart LR\n${ids.map((id) => `  ${id}["${id.toUpperCase()}"]`).join('\n')}\n`).diagram);
  const nodes = Object.fromEntries(ids.map((id) => {
    const [along, across, width, height] = blocks[id]!;
    return [id, { lane: '_unassigned', along, across, width, height }];
  }));
  return { mmd, config: null, layout: JSON.stringify({ version: 1, nodes }, null, 2) };
}

async function openAt100(page: Page, d: Diagram, id: string): Promise<void> {
  await open(page, d);
  expect(await zoomOf(page, id)).toBeCloseTo(1, 6);
}

async function centreOf(page: Page, id: string) {
  const b = (await node(page, id).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * Press on `id` and move it by (dx, dy) world px (= screen px at 100%) in small steps, without releasing. Selecting
 * first (a click) opens the inspector, which may pan the view; the drag starts after that.
 */
async function pressAndMove(page: Page, id: string, dx: number, dy: number, opts: { alt?: boolean } = {}) {
  await node(page, id).click();
  await expect(node(page, id)).toHaveAttribute('data-selected', 'true');
  await page.waitForTimeout(400); // the side column opens after a short hold (Panels.tsx)
  const from = await centreOf(page, id);
  if (opts.alt) await page.keyboard.down('Alt');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + (dx * i) / 10, from.y + (dy * i) / 10);
  return { x: from.x + dx, y: from.y + dy };
}

async function release(page: Page, opts: { alt?: boolean } = {}) {
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up('Alt');
}

async function pinOnDisk(d: Diagram, id: string, along: number, across: number) {
  const layout = await eventually(() => d.read().layout, (l) => pins(l)[id]?.along === along && pins(l)[id]?.across === across);
  return pins(layout)[id];
}

const guide = (page: Page) => page.getByTestId('snap-guide');

test('a drop 4 px off alignment stores the exact aligned position, with a guide while snapped', async ({ page }, info) => {
  const d = makeDiagram(info, diagram({ a: [40, 40, 200, 60], b: [400, 300, 120, 60] }));
  await openAt100(page, d, 'b');
  // b's left edge 4 px right of a's left edge (40); nothing else is near.
  await pressAndMove(page, 'b', 40 + 4 - 400, 0);
  await expect(guide(page)).toBeVisible();
  await release(page);
  await expect(guide(page)).toHaveCount(0);
  expect(await pinOnDisk(d, 'b', 40, 300)).toEqual({ lane: '_unassigned', along: 40, across: 300, width: 120, height: 60 });
  await saved(page);
  expect((await attrs(node(page, 'b'))).x).toBe((await attrs(node(page, 'a'))).x);
});

test('with Alt held, snapping is off: stored as dropped, no guide', async ({ page }, info) => {
  const d = makeDiagram(info, diagram({ a: [40, 40, 200, 60], b: [400, 300, 120, 60] }));
  await openAt100(page, d, 'b');
  await pressAndMove(page, 'b', 40 + 4 - 400, 0, { alt: true });
  await expect(guide(page)).toHaveCount(0);
  await release(page, { alt: true });
  expect((await pinOnDisk(d, 'b', 44, 300))?.along).toBe(44);
});

test('beyond 6 px nothing snaps; the guide comes and goes as the drag passes an alignment', async ({ page }, info) => {
  const d = makeDiagram(info, diagram({ a: [40, 40, 200, 60], b: [400, 300, 120, 60] }));
  await openAt100(page, d, 'b');
  const at = await pressAndMove(page, 'b', 40 + 4 - 400, 0);
  await expect(guide(page)).toBeVisible();
  // On to 8 px off: out of reach, and the guide goes.
  await page.mouse.move(at.x + 4, at.y);
  await expect(guide(page)).toHaveCount(0);
  await release(page);
  expect((await pinOnDisk(d, 'b', 48, 300))?.along).toBe(48);
});

test('snaps on both axes on their own, one guide for each', async ({ page }, info) => {
  const d = makeDiagram(info, diagram({ a: [40, 40, 200, 60], c: [700, 400, 100, 60], b: [400, 250, 120, 60] }));
  await openAt100(page, d, 'b');
  // Left 4 px right of a's (40); top 5 px below c's (400): every line of b's is 5 px below c's, so centres win.
  await pressAndMove(page, 'b', 44 - 400, 405 - 250);
  await expect(guide(page)).toBeVisible();
  await release(page);
  expect(await pinOnDisk(d, 'b', 40, 400)).toMatchObject({ along: 40, across: 400 });
});

test('tie-break: a centre line wins over an edge equally close', async ({ page }, info) => {
  // a's centre is 140; c's left edge is 86. b (120 wide) dropped at 83: its centre (143) is 3 px from a's centre and
  // its left edge 3 px from c's. The centre wins: b lands at 80 (the edge would have put it at 86).
  const d = makeDiagram(info, diagram({ a: [40, 40, 200, 60], c: [86, 520, 100, 60], b: [400, 300, 120, 60] }));
  await openAt100(page, d, 'b');
  await pressAndMove(page, 'b', 83 - 400, 0);
  await expect(guide(page)).toBeVisible();
  await release(page);
  expect((await pinOnDisk(d, 'b', 80, 300))?.along).toBe(80);
});

test('tie-break: the left edge wins over the right edge equally close', async ({ page }, info) => {
  // b (120 wide) dropped at 123: its right edge (243) is 3 px from a's right edge (240) and its left edge 3 px from
  // c's left edge (126). Left wins: b lands at 126 (the right edge would have put it at 120).
  const d = makeDiagram(info, diagram({ a: [40, 40, 200, 60], c: [126, 520, 100, 60], b: [400, 300, 120, 60] }));
  await openAt100(page, d, 'b');
  await pressAndMove(page, 'b', 123 - 400, 0);
  await expect(guide(page)).toBeVisible();
  await release(page);
  expect((await pinOnDisk(d, 'b', 126, 300))?.along).toBe(126);
});

test('tie-break: the top edge wins over the bottom edge equally close', async ({ page }, info) => {
  // b (60 tall) dropped at y 203: its bottom (263) is 3 px from a's bottom (260), its top 3 px from c's top (206).
  const d = makeDiagram(info, diagram({ a: [40, 160, 100, 100], c: [700, 206, 100, 40], b: [400, 400, 120, 60] }));
  await openAt100(page, d, 'b');
  await pressAndMove(page, 'b', 0, 203 - 400);
  await expect(guide(page)).toBeVisible();
  await release(page);
  expect((await pinOnDisk(d, 'b', 400, 206))?.across).toBe(206);
});

test('several blocks: the one under the pointer decides the snap and the rest move with it', async ({ page }, info) => {
  // Dragging b and e by -356: b's left edge ends 4 px from a's (it snaps to 40); e's would be 2 px from f's left edge
  // (246), closer, but e isn't under the pointer, so it just moves with b: 600 - 356 - 4 = 240.
  const d = makeDiagram(info, diagram({
    a: [40, 40, 200, 60], f: [246, 540, 100, 60], b: [400, 300, 120, 60], e: [600, 420, 120, 60],
  }));
  await openAt100(page, d, 'b');
  await node(page, 'e').click();
  await page.waitForTimeout(400);
  await node(page, 'b').click({ modifiers: ['Shift'] });
  await expect(node(page, 'e')).toHaveAttribute('data-selected', 'true');
  await expect(node(page, 'b')).toHaveAttribute('data-selected', 'true');
  const from = await centreOf(page, 'b');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x - (356 * i) / 10, from.y);
  await expect(guide(page)).toBeVisible();
  await page.mouse.up();
  await pinOnDisk(d, 'e', 240, 420);
  const p = pins(d.read().layout);
  expect(p.b).toMatchObject({ along: 40, across: 300 });
  expect(p.e).toMatchObject({ along: 240, across: 420 });
  // One drag, one undo step.
  await saved(page);
  await page.getByTestId('undo').click();
  await eventually(() => d.read().layout, (l) => pins(l).b?.along === 400);
  expect(pins(d.read().layout)).toMatchObject({ b: { along: 400 }, e: { along: 600 } });
});

test('snapping works at other zooms: the reach is 6 screen px', async ({ page }, info) => {
  const d = makeDiagram(info, diagram({ a: [40, 40, 200, 60], b: [400, 300, 120, 60] }));
  await openAt100(page, d, 'b');
  // Zoom in to 200% around the middle of the canvas.
  await page.keyboard.press('ControlOrMeta+=');
  await page.keyboard.press('ControlOrMeta+=');
  await page.keyboard.press('ControlOrMeta+=');
  await page.keyboard.press('ControlOrMeta+=');
  const z = await zoomOf(page, 'b');
  expect(z).toBeGreaterThan(1.9);
  // 5 screen px off (2.4 world px at ~2x) snaps; the drag is in screen px.
  await node(page, 'b').click();
  await page.waitForTimeout(400);
  const from = await centreOf(page, 'b');
  const a = (await node(page, 'a').boundingBox())!;
  const b = (await node(page, 'b').boundingBox())!;
  const dx = a.x - b.x + 5;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + (dx * i) / 10, from.y);
  await expect(guide(page)).toBeVisible();
  await page.mouse.up();
  expect((await pinOnDisk(d, 'b', 40, 300))?.along).toBe(40);
});

test('nudging with the arrow keys never snaps', async ({ page }, info) => {
  // b's left edge is 5 px right of a's: a nudge left by 10 lands 5 px past it, as nudged.
  const d = makeDiagram(info, diagram({ a: [40, 40, 200, 60], b: [45, 300, 120, 60] }));
  await openAt100(page, d, 'b');
  await node(page, 'b').click();
  await page.keyboard.press('ArrowLeft');
  expect((await pinOnDisk(d, 'b', 35, 300))?.along).toBe(35);
});
