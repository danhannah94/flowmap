// Folders on the home screen (design.md §8.2 amendment A16): create, breadcrumb navigation, moving a diagram in by
// drag and by "Move to…", opening a diagram inside a folder and returning to that folder, and deleting an empty
// folder.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_DIR } from './env';
import { makeDiagram, makeDiagramIn, uniqueFolderName } from './helpers';

test('creates a folder from the home page, and it shows up in the list', async ({ page }, info) => {
  const name = uniqueFolderName(info);
  await page.goto('/');
  await page.getByTestId('new-folder').click();
  await page.getByTestId('new-folder-input').fill(name);
  await page.getByTestId('new-folder-input').press('Enter');

  const row = page.getByTestId('folder-list').locator(`[data-testid="folder-link"][data-folder="${name}"]`);
  await expect(row).toBeVisible();
  expect(existsSync(join(E2E_DIR, name))).toBe(true);
});

test('navigates into a folder via breadcrumbs, and Back returns to the root', async ({ page }, info) => {
  const name = uniqueFolderName(info);
  const d = makeDiagramIn(info, name);
  await page.goto('/');

  await page.getByTestId('folder-list').locator(`[data-folder="${name}"]`).click();
  await expect(page).toHaveURL(new RegExp(`\\?dir=${name}$`));
  await expect(page.getByTestId('diagram-list').locator(`[data-file="${d.file}"]`)).toBeVisible();
  await expect(page.getByTestId('breadcrumb').filter({ hasText: name })).toBeVisible();

  // The root crumb takes you back up: the folder's diagram is no longer shown, and the folder itself is (root
  // lists it as a subfolder again).
  await page.getByTestId('breadcrumb').filter({ hasText: 'Root' }).click();
  await expect(page).not.toHaveURL(/\?dir=/);
  await expect(page.getByTestId('folder-list').locator(`[data-folder="${name}"]`)).toBeVisible();

  // Browser Back returns to the folder view.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`\\?dir=${name}$`));
  await expect(page.getByTestId('diagram-list').locator(`[data-file="${d.file}"]`)).toBeVisible();
});

test('moves a diagram into a folder by dragging it there', async ({ page }, info) => {
  // A container folder of its own, so the two rows this test drags between are the only ones in the list: the
  // shared served directory holds hundreds of other tests' root-level diagrams, and a drag between two rows far
  // apart in that long list (one needing a scroll the other doesn't) isn't what this test is checking.
  const container = uniqueFolderName(info);
  const d = makeDiagramIn(info, container);
  const targetName = `${uniqueFolderName(info)}-target`;
  mkdirSync(join(E2E_DIR, container, targetName), { recursive: true });
  const target = `${container}/${targetName}`;

  await page.goto(`/?dir=${container}`);
  const diagramRow = page.getByTestId('diagram-list').locator(`[data-file="${d.file}"]`);
  const folderRow = page.getByTestId('folder-list').locator(`[data-folder="${target}"]`);
  await expect(diagramRow).toBeVisible();
  await expect(folderRow).toBeVisible();

  await diagramRow.dragTo(folderRow);

  await expect(page.getByTestId('diagram-list').locator(`[data-file="${d.file}"]`)).toHaveCount(0);
  expect(existsSync(join(E2E_DIR, d.file))).toBe(false);
  expect(existsSync(join(E2E_DIR, target, `${d.base.split('/').pop()}.mmd`))).toBe(true);
});

test('moves a diagram into a folder via the "Move to…" menu item', async ({ page }, info) => {
  const d = makeDiagram(info);
  const name = uniqueFolderName(info);
  mkdirSync(join(E2E_DIR, name), { recursive: true });

  await page.goto('/');
  await page.locator(`[data-testid="diagram-menu"][data-row-target="${d.file}"]`).click();
  await page.locator(`[data-testid="diagram-move-to"][data-diagram-file="${d.file}"]`).click();

  const dialog = page.getByTestId('move-to-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator(`[data-testid="move-to-folder"][data-folder="${name}"]`).click();
  await dialog.getByTestId('move-to-here').click();
  await expect(dialog).toHaveCount(0);

  await expect(page.getByTestId('diagram-list').locator(`[data-file="${d.file}"]`)).toHaveCount(0);
  expect(existsSync(join(E2E_DIR, name, `${d.base}.mmd`))).toBe(true);
});

test('opening a diagram inside a folder and returning to the list goes back to that folder', async ({ page }, info) => {
  const name = uniqueFolderName(info);
  const d = makeDiagramIn(info, name);
  await page.goto(`/?dir=${name}`);
  await expect(page.getByTestId('diagram-list').locator(`[data-file="${d.file}"]`)).toBeVisible();

  await page.getByTestId('diagram-list').locator(`[data-file="${d.file}"]`).click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('file')).toBe(d.file);

  // "All diagrams" (the home logo) goes back to the diagram's own folder, not the served root.
  await page.locator('a.fm-home').click();
  expect(new URL(page.url()).searchParams.get('dir')).toBe(name);
  await expect(page.getByTestId('diagram-list').locator(`[data-file="${d.file}"]`)).toBeVisible();
});

test('deletes an empty folder', async ({ page }, info) => {
  const name = uniqueFolderName(info);
  mkdirSync(join(E2E_DIR, name), { recursive: true });
  await page.goto('/');

  const row = page.getByTestId('folder-list').locator('li').filter({ has: page.locator(`[data-folder="${name}"]`) });
  await row.locator(`[data-testid="folder-menu"][data-row-target="${name}"]`).click();
  await page.locator(`[data-testid="folder-delete"][data-diagram-file="${name}"]`).click();
  await page.getByTestId('confirm-yes').click();

  await expect(page.getByTestId('folder-list').locator(`[data-folder="${name}"]`)).toHaveCount(0);
  expect(existsSync(join(E2E_DIR, name))).toBe(false);
});

test('refuses to delete a non-empty folder, with a clear message', async ({ page }, info) => {
  const name = uniqueFolderName(info);
  makeDiagramIn(info, name);
  await page.goto('/');

  const row = page.getByTestId('folder-list').locator('li').filter({ has: page.locator(`[data-folder="${name}"]`) });
  await row.locator(`[data-testid="folder-menu"][data-row-target="${name}"]`).click();
  await page.locator(`[data-testid="folder-delete"][data-diagram-file="${name}"]`).click();
  await page.getByTestId('confirm-yes').click();

  // Still there: the server refused (409, "isn't empty"), and the toast says so.
  await expect(page.getByTestId('folder-list').locator(`[data-folder="${name}"]`)).toBeVisible();
  expect(readdirSync(join(E2E_DIR, name)).length).toBeGreaterThan(0);
});
