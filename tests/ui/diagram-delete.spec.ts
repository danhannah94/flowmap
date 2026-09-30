// Deleting a diagram from the home page's list (design.md amendment A10): a delete control on each row, a
// confirmation, the files moved into .flowmap-trash (not removed outright), and another open tab on the same
// diagram told it's gone instead of crashing.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_DIR } from './env';
import { makeDiagram, open } from './helpers';

/** The `.flowmap-trash/<timestamp>-<base>` folders for one diagram's base name (there should be exactly one). */
function trashFoldersFor(base: string): string[] {
  const trashDir = join(E2E_DIR, '.flowmap-trash');
  if (!existsSync(trashDir)) return [];
  return readdirSync(trashDir).filter((n) => n.endsWith(`-${base}`));
}

test('the delete control is reachable by keyboard and asks before deleting', async ({ page }, info) => {
  const d = makeDiagram(info);
  await page.goto('/');
  const opener = page.getByTestId('diagram-list').locator(`[data-testid="diagram-menu"][data-row-target="${d.file}"]`);
  await expect(opener).toHaveCount(1);

  // Tab reaches the opener (a plain <button>, so it's in the tab order without extra work) and Enter opens the menu.
  await opener.focus();
  await opener.press('Enter');
  const del = page.locator(`[data-testid="diagram-delete"][data-diagram-file="${d.file}"]`);
  await del.press('Enter');
  const dialog = page.getByTestId('confirm');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(d.file);
  await expect(dialog).toContainText('.flowmap-trash');

  // Cancel: the dialog closes, nothing is touched.
  await dialog.getByTestId('confirm-no').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('diagram-list').locator(`[data-file="${d.file}"]`)).toBeVisible();
  expect(existsSync(d.path('mmd'))).toBe(true);
});

test('deleting a diagram moves its files to .flowmap-trash and the row disappears', async ({ page }, info) => {
  const d = makeDiagram(info);
  const before = d.read();
  await page.goto('/');
  const list = page.getByTestId('diagram-list');
  await expect(list.locator(`[data-file="${d.file}"]`)).toBeVisible();

  await list.locator(`[data-testid="diagram-menu"][data-row-target="${d.file}"]`).click();
  await page.locator(`[data-testid="diagram-delete"][data-diagram-file="${d.file}"]`).click();
  await page.getByTestId('confirm-yes').click();

  await expect(list.locator(`[data-file="${d.file}"]`)).toHaveCount(0);
  expect(existsSync(d.path('mmd'))).toBe(false);
  expect(existsSync(d.path('config'))).toBe(false);
  expect(existsSync(d.path('layout'))).toBe(false);

  const folders = trashFoldersFor(d.base);
  expect(folders).toHaveLength(1);
  const trashed = join(E2E_DIR, '.flowmap-trash', folders[0]!);
  expect(readFileSync(join(trashed, d.file), 'utf8')).toBe(before.mmd);
  expect(readFileSync(join(trashed, `${d.base}.flow.yaml`), 'utf8')).toBe(before.config);
  expect(readFileSync(join(trashed, `${d.base}.layout.json`), 'utf8')).toBe(before.layout);

  // It stays gone from the list across a reload (the trashed files aren't `.mmd`s at the top level any more).
  await page.reload();
  await expect(page.getByTestId('diagram-list').locator(`[data-file="${d.file}"]`)).toHaveCount(0);
});

test('a tab with the diagram open is told it was deleted, not crashed', async ({ page, browser }, info) => {
  const d = makeDiagram(info);
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await open(other, d);

  await page.goto('/');
  const list = page.getByTestId('diagram-list');
  await list.locator(`[data-testid="diagram-menu"][data-row-target="${d.file}"]`).click();
  await page.locator(`[data-testid="diagram-delete"][data-diagram-file="${d.file}"]`).click();
  await page.getByTestId('confirm-yes').click();
  await expect(list.locator(`[data-file="${d.file}"]`)).toHaveCount(0);

  // The other tab's live SSE connection hears about it and shows a plain "gone" screen, not a crash.
  await expect(other.locator('h1')).toContainText(d.file, { timeout: 2000 });
  await expect(other.getByText(/was deleted/)).toBeVisible();
  await expect(other.getByRole('link', { name: 'All diagrams' })).toBeVisible();
  await ctx.close();
});
