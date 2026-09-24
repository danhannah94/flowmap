// Editing (UI6, UI8, UI10, UI11, UI28): every edit is checked on disk, as the acceptance suite does.
import { expect, test } from '@playwright/test';
import { parse } from '../../src/core/mmd';
import {
  attrs, declaredLane, dragBy, dragFromTo, emptyPointInLane, eventually, expectMatchesCli, lane, makeDiagram, node,
  open, pins, PR, saved, zoomOf,
} from './helpers';

const labelOf = (mmd: string, id: string) => {
  const d = parse(mmd).diagram;
  for (const list of [d.unlaned, ...d.lanes.map((l) => l.nodes)]) {
    const n = list.find((x) => x.id === id);
    if (n) return n.label;
  }
  return undefined;
};

test('dragging a block pins it where it is dropped, on disk within 1 s', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const before = await attrs(node(page, 'r01'));
  const cli = d.cliLayout();
  const laneY = cli.lanes.find((l) => l.id === 'requester')!.y;
  const z = await zoomOf(page, 'r01');
  await dragBy(page, node(page, 'r01'), 90, 0);
  const t0 = Date.now();
  const layout = await eventually(() => d.read().layout, (l) => !!pins(l).r01);
  expect(Date.now() - t0).toBeLessThan(1000);
  const pin = pins(layout).r01!;
  expect(pin.lane).toBe('requester');
  expect(Math.abs(pin.along - (before.x + 90 / z))).toBeLessThanOrEqual(1);
  expect(pin.across).toBe(Math.max(12, before.y - laneY));
  await saved(page);
  const after = await attrs(node(page, 'r01'));
  expect(after.pinned).toBe(true);
  expect(after.x).toBe(pin.along);
  // The .mmd and config are untouched; the UI still equals the CLI.
  expect(d.read().mmd).toBe(PR.mmd);
  expect(d.read().config).toBe(PR.config);
  await expectMatchesCli(page, d);
});

test('Shift-click selects several blocks; dragging one moves and pins them all as one undo step', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await node(page, 'p05').click();
  await node(page, 'p06').click({ modifiers: ['Shift'] });
  await expect(node(page, 'p05')).toHaveAttribute('data-selected', 'true');
  await expect(node(page, 'p06')).toHaveAttribute('data-selected', 'true');
  const a5 = await attrs(node(page, 'p05'));
  const a6 = await attrs(node(page, 'p06'));
  const z = await zoomOf(page, 'p05');
  await dragBy(page, node(page, 'p05'), 50, 0);
  const layout = await eventually(() => d.read().layout, (l) => !!pins(l).p05 && !!pins(l).p06);
  const p = pins(layout);
  expect(Math.abs(p.p05!.along - (a5.x + 50 / z))).toBeLessThanOrEqual(1);
  expect(Math.abs(p.p06!.along - (a6.x + 50 / z))).toBeLessThanOrEqual(1);
  // Shift-click again removes one from the selection.
  await node(page, 'p06').click({ modifiers: ['Shift'] });
  await expect(node(page, 'p06')).toHaveAttribute('data-selected', 'false');
  await expect(node(page, 'p05')).toHaveAttribute('data-selected', 'true');
  // One undo step restores the layout file byte for byte.
  await saved(page);
  await page.getByTestId('undo').click();
  await eventually(() => d.read().layout, (l) => l === PR.layout);
  expect(d.read()).toEqual(PR);
});

test('a block dropped with its centre in another lane moves there, pinned at the drop', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const src = (await node(page, 'm03').boundingBox())!;
  const target = await emptyPointInLane(page, 'finance');
  await dragFromTo(page, { x: src.x + src.width / 2, y: src.y + src.height / 2 }, target);
  const files = await eventually(() => d.read(), (f) => declaredLane(f.mmd, 'm03') === 'finance');
  expect(declaredLane(files.mmd, 'm03')).toBe('finance');
  expect(pins(files.layout).m03?.lane).toBe('finance');
  // Canonical: appended as the last declaration of the finance subgraph.
  const fin = parse(files.mmd).diagram.lanes.find((l) => l.id === 'finance')!;
  expect(fin.nodes.at(-1)!.id).toBe('m03');
  await saved(page);
  await expect(node(page, 'm03')).toHaveAttribute('data-lane', 'finance');
  await expectMatchesCli(page, d);
});

test('add a block: click a shape, then click in a lane', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await page.getByTestId('palette').locator('[data-shape="decision"]').click();
  const p = await emptyPointInLane(page, 'finance');
  await page.mouse.click(p.x, p.y);
  const editor = page.getByTestId('label-editor');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue('New decision');
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  const files = await eventually(() => d.read(), (f) => f.mmd.includes('n1{"New decision"}'));
  expect(declaredLane(files.mmd, 'n1')).toBe('finance');
  expect(pins(files.layout).n1).toBeUndefined();
  await expect(node(page, 'n1')).toHaveAttribute('data-kind', 'decision');
  await expect(node(page, 'n1')).toHaveAttribute('data-pinned', 'false');
});

test('add a block: select a lane, then click a shape; type its label', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const p = await emptyPointInLane(page, 'vendor');
  await page.mouse.click(p.x, p.y);
  await expect(lane(page, 'vendor')).toHaveAttribute('data-selected', 'true');
  await expect(lane(page, 'finance')).toHaveAttribute('data-selected', 'false');
  await page.getByTestId('palette').locator('[data-shape="database"]').click();
  const editor = page.getByTestId('label-editor');
  await expect(editor).toHaveValue('New system');
  await editor.fill('Vendor portal');
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  const files = await eventually(() => d.read(), (f) => f.mmd.includes('n1[("Vendor portal")]'));
  expect(declaredLane(files.mmd, 'n1')).toBe('vendor');
  await expect(node(page, 'n1').locator('[data-role="label"]')).toHaveText('Vendor portal');
});

test('add a block: drag a shape from the palette into a lane; it lands pinned', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const btn = (await page.getByTestId('palette').locator('[data-shape="document"]').boundingBox())!;
  const drop = await emptyPointInLane(page, 'manager');
  // Screen -> world, from a block that stays put.
  const ref = await attrs(node(page, 'm01'));
  const refBox = (await node(page, 'm01').boundingBox())!;
  const z = refBox.width / ref.width;
  const world = { x: ref.x + (drop.x - refBox.x) / z, y: ref.y + (drop.y - refBox.y) / z };
  const laneY = d.cliLayout().lanes.find((l) => l.id === 'manager')!.y;
  await dragFromTo(page, { x: btn.x + btn.width / 2, y: btn.y + btn.height / 2 }, drop);
  await expect(page.getByTestId('label-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  const files = await eventually(() => d.read(), (f) => !!pins(f.layout).n1);
  expect(files.mmd).toContain('n1@{ shape: doc, label: "New document" }');
  expect(declaredLane(files.mmd, 'n1')).toBe('manager');
  await saved(page);
  // Pinned with its centre where it was dropped.
  const n1 = await attrs(node(page, 'n1'));
  const pin = pins(files.layout).n1!;
  expect(pin.lane).toBe('manager');
  expect(Math.abs(pin.along - (world.x - n1.width / 2))).toBeLessThanOrEqual(1);
  // (`across` is saved as at least 12, UI10.)
  expect(Math.abs(pin.across - Math.max(12, world.y - n1.height / 2 - laneY))).toBeLessThanOrEqual(1);
  await expect(node(page, 'n1')).toHaveAttribute('data-pinned', 'true');
  await expectMatchesCli(page, d);
});

test('edit a label: double-click, Enter commits, Escape cancels, empty is refused', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const editor = page.getByTestId('label-editor');
  // Escape cancels.
  await node(page, 'r01').dblclick();
  await expect(editor).toHaveValue('Fill the purchase request form');
  await editor.fill('Something else');
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  // Enter commits, with characters that need escaping.
  await node(page, 'r01').dblclick();
  await editor.fill('Fill the "new" form #quot; & send');
  await editor.press('Enter');
  const files = await eventually(() => d.read(), (f) => f.mmd !== PR.mmd);
  expect(labelOf(files.mmd, 'r01')).toBe('Fill the "new" form #quot; & send');
  await expect(node(page, 'r01').locator('[data-role="label"]')).toHaveText('Fill the "new" form #quot; & send');
  // Enter on a selected block opens the editor; an empty label is refused and the old one stays.
  await node(page, 'p01').click();
  await page.keyboard.press('Enter');
  await editor.fill('');
  await editor.press('Enter');
  await expect(page.getByTestId('toast')).toBeVisible();
  await saved(page);
  expect(labelOf(d.read().mmd, 'p01')).toBe('Check the request is complete');
  await expectMatchesCli(page, d);
});

test('selection: Shift-drag box, Cmd/Ctrl+A, Escape; arrow keys nudge by 10 and pin', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  // A box around r01 and intake (both in the requester lane), drawn from empty space.
  const a = (await node(page, 'intake').boundingBox())!;
  const b = (await node(page, 'r01').boundingBox())!;
  const from = { x: Math.min(a.x, b.x) - 8, y: Math.min(a.y, b.y) - 8 };
  const to = { x: Math.max(a.x + a.width, b.x + b.width) + 8, y: Math.max(a.y + a.height, b.y + b.height) + 8 };
  await dragFromTo(page, from, to, { shift: true });
  await expect(node(page, 'intake')).toHaveAttribute('data-selected', 'true');
  await expect(node(page, 'r01')).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('[data-node-id][data-selected="true"]')).toHaveCount(2);
  // Nudge right twice and down once: pinned at +20 along, +10 across.
  const i0 = await attrs(node(page, 'intake'));
  const r0 = await attrs(node(page, 'r01'));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  const cliLane = d.cliLayout().lanes.find((l) => l.id === 'requester')!;
  const layout = await eventually(() => d.read().layout, (l) => pins(l).r01?.along === r0.x + 20 && pins(l).r01?.across === r0.y - cliLane.y + 10);
  expect(pins(layout).intake).toEqual({ lane: 'requester', along: i0.x + 20, across: i0.y - cliLane.y + 10 });
  expect(pins(layout).r01).toEqual({ lane: 'requester', along: r0.x + 20, across: r0.y - cliLane.y + 10 });
  // Cmd/Ctrl+A selects everything; Escape clears.
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.locator('[data-node-id][data-selected="false"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-node-id][data-selected="true"]')).toHaveCount(0);
  await saved(page);
  await expectMatchesCli(page, d);
});

test('undo and redo restore all three files byte for byte, including a created file', async ({ page }, info) => {
  const start = { mmd: PR.mmd, config: null, layout: null };
  const d = makeDiagram(info, start);
  await open(page, d);
  await expect(page.getByTestId('undo')).toBeDisabled();
  // Edit 1: a drag creates the layout file.
  await dragBy(page, node(page, 'p01'), 40, 0);
  await saved(page);
  const s1 = d.read();
  expect(s1.layout).not.toBeNull();
  // Edit 2: a label.
  await node(page, 'f02').dblclick();
  await page.getByTestId('label-editor').fill('Move budget');
  await page.keyboard.press('Enter');
  await saved(page);
  const s2 = d.read();
  expect(s2.mmd).toContain('f02["Move budget"]');
  // Undo twice (keyboard, then button): back to the start, the created layout file deleted again. (Byte-exactness
  // is the point here; the 1 s save budget is checked by the drag test.)
  await page.keyboard.press('ControlOrMeta+z');
  await saved(page);
  expect(d.read()).toEqual(s1);
  await page.getByTestId('undo').click();
  await saved(page);
  expect(d.read()).toEqual(start);
  await expect(page.getByTestId('undo')).toBeDisabled();
  // Redo twice (keyboard, then button).
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await saved(page);
  expect(d.read()).toEqual(s1);
  await page.getByTestId('redo').click();
  await saved(page);
  expect(d.read()).toEqual(s2);
  await expect(page.getByTestId('redo')).toBeDisabled();
  await expectMatchesCli(page, d);
});
