// A14: trackpad-friendly navigation. A trackpad's two-finger scroll (pixel-mode wheel with sideways motion) pans the
// canvas in both axes; a mouse's scroll wheel (line-mode, or a whole-pixel delta with no sideways motion) and
// Cmd/Ctrl+wheel still zoom around the cursor, classified by `classifyWheel` (src/ui/canvas/wheel-intent.ts). The
// controls legend (a small chip beside the `?` button) lists these plus the selection and editing gestures, and
// holds the "Scroll to" override.
import { expect, test } from '@playwright/test';
import { makeDiagram, node, open, zoomOf } from './helpers';

test('a synthetic Ctrl+wheel zooms around the cursor', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const z0 = await zoomOf(page, 'r01');
  const canvas = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(() => zoomOf(page, 'r01')).toBeGreaterThan(z0 * 1.05);
});

test('a pixel-mode wheel with sideways motion pans (both axes); the scale is unchanged', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const z0 = await zoomOf(page, 'r01');
  const b0 = (await node(page, 'r01').boundingBox())!;
  const canvas = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  // A trackpad's two-finger scroll: non-zero deltaX, pixel deltaMode (what Playwright's mouse.wheel always sends).
  await page.mouse.wheel(40, 25);
  const b1 = (await node(page, 'r01').boundingBox())!;
  // The viewport's translate is added in already-scaled (screen) space (viewport.ts `toScreen`), so a pan moves
  // every rendered point by exactly its screen-pixel delta, whatever the current zoom.
  expect(Math.round(b1.x - b0.x)).toBe(-40);
  expect(Math.round(b1.y - b0.y)).toBe(-25);
  expect(await zoomOf(page, 'r01')).toBeCloseTo(z0, 5);
});

test('a line-mode wheel (deltaMode 1) zooms, even with no deltaX', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const z0 = await zoomOf(page, 'r01');
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="canvas"]') as HTMLElement;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -3,
        deltaMode: 1,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect.poll(() => zoomOf(page, 'r01')).toBeGreaterThan(z0 * 1.05);
});

test('the controls legend opens beside the ? button, lists the real gestures, and closes', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const legend = page.getByTestId('controls-legend');
  await expect(legend).toBeHidden();
  await page.getByTestId('controls-legend-toggle').click();
  await expect(legend).toBeVisible();
  await expect(legend).toContainText('Pan');
  await expect(legend).toContainText('Zoom');
  await expect(legend).toContainText('Select');
  await expect(legend).toContainText('Edit');
  await expect(legend).toContainText('Two-finger scroll');
  await expect(legend).toContainText('Scroll to');
  await expect(legend.getByTestId('scroll-preference')).toBeVisible();
  // Closing, then reopening (a fresh page load), remembers it was collapsed.
  await legend.locator('.fm-notice-close').click();
  await expect(legend).toBeHidden();
  await page.reload();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.getByTestId('controls-legend')).toBeHidden();
});

test('the "Scroll to: Zoom" override makes a trackpad-shaped wheel zoom instead of pan', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await page.getByTestId('controls-legend-toggle').click();
  await page.getByTestId('scroll-preference').selectOption('zoom');
  const z0 = await zoomOf(page, 'r01');
  const b0 = (await node(page, 'r01').boundingBox())!;
  const canvas = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  // Trackpad-shaped (sideways motion): would pan under "Auto", but the override forces zoom.
  await page.mouse.wheel(40, -25);
  await expect.poll(() => zoomOf(page, 'r01')).toBeGreaterThan(z0 * 1.02);
  const b1 = (await node(page, 'r01').boundingBox())!;
  expect(b1.x).not.toBeCloseTo(b0.x - 40, 0);
  // The choice survives a reload (close the legend first so reopening it after the reload is one click, not two).
  await page.getByTestId('controls-legend').locator('.fm-notice-close').click();
  await page.reload();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('controls-legend-toggle').click();
  await expect(page.getByTestId('scroll-preference')).toHaveValue('zoom');
});
