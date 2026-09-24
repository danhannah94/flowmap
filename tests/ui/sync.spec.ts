// Sync and safety (UI28–UI31; U6, U7): external edits, the disk winning, autosave status, files with errors.
import { expect, test, type Page } from '@playwright/test';
import { attrs, dragBy, eventually, expectMatchesCli, makeDiagram, node, open, pins, PR, saved } from './helpers';

const worldTransform = (page: Page) => page.locator('.fm-world').evaluate((el) => (el as HTMLElement).style.transform);

test('an external edit shows within 1 s, keeps the view and selection, and clears the history', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  // A UI edit first, so there is history to clear.
  await dragBy(page, node(page, 'p01'), 30, 0);
  await eventually(() => d.read().layout, (l) => !!pins(l).p01);
  await saved(page);
  await expect(page.getByTestId('undo')).toBeEnabled();
  await node(page, 'r01').click();
  const view = await worldTransform(page);
  // The AI renames a step and adds one.
  const t0 = Date.now();
  d.write({ mmd: PR.mmd.replace('Fill the purchase request form', 'Fill in the request').replace('    r02[', '    r03["Chase the delivery"]\n    r02[') });
  await expect(node(page, 'r01').locator('[data-role="label"]')).toHaveText('Fill in the request', { timeout: 1000 });
  expect(Date.now() - t0).toBeLessThan(1000);
  await expect(node(page, 'r03')).toBeVisible();
  await expect(page.getByTestId('history-cleared')).toBeVisible();
  await expect(page.getByTestId('edit-dropped')).toHaveCount(0);
  await expect(page.getByTestId('undo')).toBeDisabled();
  expect(await worldTransform(page)).toBe(view);
  await expect(node(page, 'r01')).toHaveAttribute('data-selected', 'true');
  // Undo can't overwrite the AI's edit.
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(300);
  expect(d.read().mmd).toContain('Fill in the request');
  await expectMatchesCli(page, d);
  // External edits to the other two files show too.
  d.write({ layout: '{\n  "version": 1,\n  "nodes": {}\n}\n' });
  await expect(node(page, 'p01')).toHaveAttribute('data-pinned', 'false', { timeout: 1000 });
  d.write({ config: PR.config!.replace('title: Purchase request approval (current state, synthetic)', 'title: Renamed by the AI') });
  await expect(page.getByTestId('title')).toHaveText('Renamed by the AI', { timeout: 1000 });
});

test('the UI’s own saves never cause a reload or clear the history', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await dragBy(page, node(page, 'p01'), 30, 0);
  await saved(page);
  await page.waitForTimeout(400);
  await expect(page.getByTestId('history-cleared')).toHaveCount(0);
  await expect(page.getByTestId('undo')).toBeEnabled();
});

test('the disk wins over an unsaved edit, and the UI says its edit was dropped', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  // Hold the PUT until the "AI" has written the file.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/diagram?**', async (route) => {
    if (route.request().method() === 'PUT') await held;
    await route.continue();
  });
  await dragBy(page, node(page, 'p01'), 30, 0);
  await expect(page.getByTestId('save-status')).toHaveText('saving');
  const external = PR.mmd.replace('Check the request is complete', 'Checked by the AI');
  d.write({ mmd: external });
  await page.waitForTimeout(150);
  release();
  await expect(page.getByTestId('edit-dropped')).toBeVisible();
  await expect(page.getByTestId('history-cleared')).toBeVisible();
  await expect(node(page, 'p01').locator('[data-role="label"]')).toHaveText('Checked by the AI');
  await expect(node(page, 'p01')).toHaveAttribute('data-pinned', 'false');
  await saved(page);
  expect(d.read()).toEqual({ ...PR, mmd: external });
});

test('the save indicator shows saving, then saved, or error when a save fails', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await expect(page.getByTestId('save-status')).toHaveText('saved');
  let fail = true;
  await page.route('**/api/diagram?**', async (route) => {
    if (route.request().method() === 'PUT' && fail) await route.fulfill({ status: 500, body: 'disk full' });
    else await route.continue();
  });
  await dragBy(page, node(page, 'p01'), 30, 0);
  await expect(page.getByTestId('save-status')).toHaveText('error');
  expect(pins(d.read().layout).p01).toBeUndefined();
  fail = false; // it retries by itself
  await expect(page.getByTestId('save-status')).toHaveText('saved', { timeout: 4000 });
  expect(pins(d.read().layout).p01).toBeDefined();
});

test('a broken .mmd shows its errors, makes the diagram read-only, and is never overwritten', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await node(page, 'p01').click();
  const broken = PR.mmd.replace('  p01 --> p02\n', '  p01 --> p02\n  p02 ==> p03\n  this is not mermaid\n');
  d.write({ mmd: broken });
  await expect(page.locator('[data-testid="errors"] [data-code="E-edge"]')).toBeVisible({ timeout: 1000 });
  await expect(page.locator('[data-testid="errors"] [data-code="E-syntax"]')).toBeVisible();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-readonly', 'true');
  // Try every edit path in scope: drag, nudge, label edit, palette, undo.
  await dragBy(page, node(page, 'r01'), 60, 20);
  await page.keyboard.press('ArrowRight');
  await node(page, 'r01').dblclick();
  await expect(page.getByTestId('label-editor')).toHaveCount(0);
  await expect(page.getByTestId('palette').locator('[data-shape="step"]')).toBeDisabled();
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(1200);
  expect(d.read()).toEqual({ ...PR, mmd: broken });
  // Fixed on disk: editable again.
  d.write({ mmd: PR.mmd });
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-readonly', 'false', { timeout: 1000 });
  await expect(page.getByTestId('errors')).toHaveCount(0);
});

test('a diagram whose .mmd is broken from the start opens read-only with its errors', async ({ page }, info) => {
  const mmd = 'flowchart XY\n  a["A"] --> b["B"]\n';
  const d = makeDiagram(info, { mmd, config: null, layout: null });
  await page.goto(`/?file=${d.file}`);
  const err = page.locator('[data-testid="errors"] [data-code="E-header"]');
  await expect(err).toBeVisible();
  await expect(err).toContainText('line 1');
  await expect(page.getByTestId('palette').locator('[data-shape="step"]')).toBeDisabled();
  await page.waitForTimeout(600);
  expect(d.read()).toEqual({ mmd, config: null, layout: null });
});

test('E-config: default styles, the diagram stays editable, the config is untouched', async ({ page }, info) => {
  const config = 'version: 1\nstyles: [unclosed\n';
  const d = makeDiagram(info, { ...PR, config });
  await open(page, d);
  await expect(page.locator('[data-testid="errors"] [data-code="E-config"]')).toBeVisible();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-readonly', 'false');
  // Default styles: no dashed borders.
  expect(await node(page, 'p03').locator('svg > :not(.fm-node-halo)').first().getAttribute('stroke-dasharray')).toBeNull();
  const before = await attrs(node(page, 'p01'));
  await dragBy(page, node(page, 'p01'), 40, 0);
  const files = await eventually(() => d.read(), (f) => !!pins(f.layout).p01);
  expect(pins(files.layout).p01!.along).toBeGreaterThan(before.x);
  expect(files.config).toBe(config);
  await saved(page);
  await expectMatchesCli(page, d);
});

test('E-layout: drawn without pins; dragging and nudging are off; the layout file is untouched', async ({ page }, info) => {
  const layout = '{"version": 1, "nodes": {"closed": {"lane": "requester", "along": -5, "across": 40}}}\n';
  const d = makeDiagram(info, { ...PR, layout });
  await open(page, d);
  await expect(page.locator('[data-testid="errors"] [data-code="E-layout"]')).toBeVisible();
  await expect(node(page, 'closed')).toHaveAttribute('data-pinned', 'false');
  const before = (await node(page, 'p01').boundingBox())!;
  await dragBy(page, node(page, 'p01'), 60, 0);
  await node(page, 'p01').click();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1200);
  expect(d.read()).toEqual({ ...PR, layout });
  expect((await node(page, 'p01').boundingBox())!.x).toBeCloseTo(before.x, 0);
  // Other edits still work.
  await node(page, 'p01').dblclick();
  await page.getByTestId('label-editor').fill('Check it');
  await page.keyboard.press('Enter');
  const files = await eventually(() => d.read(), (f) => f.mmd.includes('p01["Check it"]'));
  expect(files.layout).toBe(layout);
});
