// A15: a block's link to another diagram (design.md §4 "A block can link to another diagram"). Through the §8.3
// attributes only: set a link from the Inspector, see the badge, Cmd/Ctrl+click navigates, Back returns, a plain
// click still selects (no navigation), and a missing target shows the warning.
import { expect, test, type Page } from '@playwright/test';
import { makeDiagram, node, open, settled, type Diagram } from './helpers';

/** Cmd on Mac, Ctrl elsewhere — read from the page itself so the test matches whatever host it runs on, exactly as
 *  the app's own IS_MAC check does (gestures.ts). */
async function linkModifier(page: Page): Promise<'Meta' | 'Control'> {
  return page.evaluate(() => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Meta' : 'Control'));
}

/** Select a block and read its config text back off disk once the link field has landed. */
async function setLinkFromInspector(page: Page, d: Diagram, id: string, target: string): Promise<void> {
  await node(page, id).click();
  const input = page.getByTestId('link-input');
  await expect(input).toBeVisible();
  await input.fill(target);
  await input.press('Enter');
  await settled(page, d, (f) => !!f.config && f.config.includes(`link: ${target}`));
}

test('setting a link shows the badge, Cmd/Ctrl+click navigates, Back returns, a plain click still selects', async ({ page }, info) => {
  const a = makeDiagram(info);
  const b = makeDiagram(info);
  await open(page, a);

  const id = 'intake'; // the purchase-request fixture's first block
  await setLinkFromInspector(page, a, id, b.base);

  // The badge shows on the linked block, with the target as its title (hover text).
  const badge = node(page, id).locator('[data-testid="link-badge"]');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('data-link-target', b.base);

  // A plain click still selects — editing (selection) doesn't change because the block has a link. A centred click
  // (the locator default) lands well clear of the small corner badge.
  await node(page, id).click();
  await expect(node(page, id)).toHaveAttribute('data-selected', 'true');
  expect(page.url()).toContain(encodeURIComponent(a.file));

  // Cmd/Ctrl+click follows the link (the app's own navigation, so Back works).
  const modifier = await linkModifier(page);
  await node(page, id).click({ modifiers: [modifier] });
  await expect(page).toHaveURL(new RegExp(`file=${encodeURIComponent(b.file)}`));
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.locator('[data-node-id]').first()).toBeVisible();

  // Back returns to the previous diagram.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`file=${encodeURIComponent(a.file)}`));
  await expect(node(page, id)).toBeVisible();
});

test('the link badge itself follows the link on a plain click', async ({ page }, info) => {
  const a = makeDiagram(info);
  const b = makeDiagram(info);
  await open(page, a);
  await setLinkFromInspector(page, a, 'intake', b.base);

  await node(page, 'intake').locator('[data-testid="link-badge"]').click();
  await expect(page).toHaveURL(new RegExp(`file=${encodeURIComponent(b.file)}`));
});

test('a link to a diagram that does not exist shows W-link-missing', async ({ page }, info) => {
  const a = makeDiagram(info);
  await open(page, a);
  await setLinkFromInspector(page, a, 'intake', 'does-not-exist');

  const problem = page.getByTestId('errors').locator('[data-code="W-link-missing"]');
  await expect(problem).toBeVisible();
});

test('clearing a link removes the field and the badge', async ({ page }, info) => {
  const a = makeDiagram(info);
  const b = makeDiagram(info);
  await open(page, a);
  await setLinkFromInspector(page, a, 'intake', b.base);
  await expect(node(page, 'intake').locator('[data-testid="link-badge"]')).toBeVisible();

  await page.getByTestId('link-clear').click();
  await settled(page, a, (f) => !f.config || !f.config.includes('link:'));
  await expect(node(page, 'intake').locator('[data-testid="link-badge"]')).toHaveCount(0);
  await expect(page.getByTestId('link-input')).toHaveValue('');
});

test('the picker suggests the diagrams the server lists', async ({ page }, info) => {
  const a = makeDiagram(info);
  const b = makeDiagram(info);
  await open(page, a);
  await node(page, 'intake').click();
  await expect(page.getByTestId('link-input')).toBeVisible();
  // The suggestion list is populated from GET /api/diagrams (reused from the home page); it may take a moment.
  await expect(page.locator('[data-testid="link-suggestion"]', { hasText: b.base })).toBeVisible({ timeout: 5000 });
});

// A15 viewport cache (viewportCache.ts): a remembered pan/zoom is applied only through the history (Back/Forward),
// and a restore from the back/forward cache discards it, so an ordinary open never reuses a stale view.
const zoomLabel = (page: Page) => page.locator('.fm-zoom-level').innerText();

test('Back restores the view; a later open from the home list fits instead of reusing it', async ({ page }, info) => {
  const a = makeDiagram(info);
  const b = makeDiagram(info);
  await open(page, a);
  const fit = await zoomLabel(page);
  await setLinkFromInspector(page, a, 'intake', b.base);
  await page.locator('.fm-zoom-level').click(); // 100%, not the fit zoom
  await expect(page.locator('.fm-zoom-level')).toHaveText('100%');
  expect(fit).not.toBe('100%');

  await node(page, 'intake').locator('[data-testid="link-badge"]').click();
  await expect(page).toHaveURL(new RegExp(`file=${encodeURIComponent(b.file)}`));
  await expect(page.locator('[data-node-id]').first()).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`file=${encodeURIComponent(a.file)}`));
  await expect(page.locator('.fm-zoom-level')).toHaveText('100%'); // restored (from the bfcache or the entry)

  // Home, then open A from the list: an ordinary open fits.
  await page.goto('/');
  await page.locator(`a[data-file="${a.file}"]`).click();
  await expect(page.locator('[data-node-id]').first()).toBeVisible();
  await expect(page.locator('.fm-zoom-level')).toHaveText(fit);
  expect(await page.evaluate((f) => JSON.parse(sessionStorage.getItem('flowmap.viewport') ?? '{}')[f] ?? null, a.file)).toBeNull();
});

test('a stale remembered view is never applied to an ordinary open, and is consumed by it', async ({ page }, info) => {
  const a = makeDiagram(info);
  await open(page, a);
  const fit = await zoomLabel(page);
  await page.goto('/');
  await page.evaluate((f) => sessionStorage.setItem('flowmap.viewport', JSON.stringify({ [f]: { x: -4000, y: -3000, zoom: 3 } })), a.file);
  await page.locator(`a[data-file="${a.file}"]`).click();
  await expect(page.locator('[data-node-id]').first()).toBeVisible();
  await expect(page.locator('.fm-zoom-level')).toHaveText(fit);
  expect(await page.evaluate(() => sessionStorage.getItem('flowmap.viewport'))).toBe('{}');
});

test('a restore from the back/forward cache discards the open diagram\'s remembered view', async ({ page }, info) => {
  const a = makeDiagram(info);
  await open(page, a);
  const left = await page.evaluate((f) => {
    sessionStorage.setItem('flowmap.viewport', JSON.stringify({ [f]: { x: 1, y: 2, zoom: 1 } }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    return sessionStorage.getItem('flowmap.viewport');
  }, a.file);
  expect(left).toBe('{}');
});
