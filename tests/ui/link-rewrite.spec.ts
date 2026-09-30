// A17 (design.md §12): moving a diagram, or renaming its folder, rewrites every `link:` value elsewhere that
// pointed at it, so a link a person set up (A15) keeps working across a reorganisation (A16). Through the §8.3
// attributes and the home screen's own move/rename controls, same as folders.spec.ts and links.spec.ts.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DIR } from './env';
import { eventually, makeDiagram, node, open, uniqueFolderName, type Diagram } from './helpers';

/** Cmd on Mac, Ctrl elsewhere (same heuristic links.spec.ts uses, matching the app's own IS_MAC check). */
async function linkModifier(page: Page): Promise<'Meta' | 'Control'> {
  return page.evaluate(() => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'Meta' : 'Control'));
}

async function setLinkFromInspector(page: Page, d: Diagram, id: string, target: string): Promise<void> {
  await node(page, id).click();
  const input = page.getByTestId('link-input');
  await expect(input).toBeVisible();
  await input.fill(target);
  await input.press('Enter');
  await eventually(() => d.read(), (f) => !!f.config?.includes(`link: ${target}`));
}

test('moving the linked diagram rewrites the link: Cmd/Ctrl+click still lands on it in its new folder', async ({ page }, info) => {
  const a = makeDiagram(info);
  const b = makeDiagram(info);
  const name = uniqueFolderName(info);
  mkdirSync(join(E2E_DIR, name), { recursive: true });

  await open(page, a);
  await setLinkFromInspector(page, a, 'intake', b.base);

  // Move b into the new folder via the home page's "Move to…" dialog (design.md A16).
  await page.goto('/');
  await page.locator(`[data-testid="diagram-menu"][data-row-target="${b.file}"]`).click();
  await page.locator(`[data-testid="diagram-move-to"][data-diagram-file="${b.file}"]`).click();
  const dialog = page.getByTestId('move-to-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator(`[data-testid="move-to-folder"][data-folder="${name}"]`).click();
  await dialog.getByTestId('move-to-here').click();
  await expect(dialog).toHaveCount(0);

  // A17's confirmation toast on the home screen.
  await expect(page.getByTestId('toast')).toContainText('Updated 1 link in 1 diagram.');

  // A's link is rewritten on disk to b's new id.
  const movedBase = `${name}/${b.base}`;
  const after = await eventually(() => a.read(), (f) => !!f.config?.includes(`link: ${movedBase}`));
  expect(after.config).toContain(`link: ${movedBase}`);

  // Open A fresh and follow the link: it lands on B in its new folder, not the "couldn't open" screen a stale link
  // would show.
  await open(page, a);
  const modifier = await linkModifier(page);
  await node(page, 'intake').click({ modifiers: [modifier] });
  await expect(page).toHaveURL(new RegExp(`file=${encodeURIComponent(`${movedBase}.mmd`)}`));
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.locator('[data-node-id]').first()).toBeVisible();
});

test('a diagram left open in a tab picks up its rewritten link through the live file watcher, no reload', async ({ page }, info) => {
  const a = makeDiagram(info);
  const b = makeDiagram(info);
  const name = uniqueFolderName(info);
  mkdirSync(join(E2E_DIR, name), { recursive: true });

  await open(page, a);
  await setLinkFromInspector(page, a, 'intake', b.base);
  const badge = node(page, 'intake').locator('[data-testid="link-badge"]');
  await expect(badge).toHaveAttribute('data-link-target', b.base);

  // Move b from a second tab, so A's own tab is never navigated or reloaded.
  const homePage = await page.context().newPage();
  await homePage.goto('/');
  await homePage.locator(`[data-testid="diagram-menu"][data-row-target="${b.file}"]`).click();
  await homePage.locator(`[data-testid="diagram-move-to"][data-diagram-file="${b.file}"]`).click();
  const dialog = homePage.getByTestId('move-to-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator(`[data-testid="move-to-folder"][data-folder="${name}"]`).click();
  await dialog.getByTestId('move-to-here').click();
  await expect(dialog).toHaveCount(0);
  await homePage.close();

  // A's still-open tab updates the badge's target via SSE (design.md UI29), without a reload.
  const movedBase = `${name}/${b.base}`;
  await expect(badge).toHaveAttribute('data-link-target', movedBase, { timeout: 5000 });
});
