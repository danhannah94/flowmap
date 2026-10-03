// Dismissing warnings (UI31 amendment, A9): a × on each warning row and a "Dismiss all warnings" control hide
// warnings from the banner; errors never get a dismiss control. A dismissal is remembered per diagram (by file name)
// in localStorage, keyed by code+message rather than line, so it survives a reload and doesn't reappear just because
// the warning's line moved; but if the warning's cause is fixed (its key disappears) and the same problem is
// reintroduced later, it shows again rather than staying silently hidden.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { RICH } from '../../src/core/ops/testkit';
import { makeDiagram, open } from './helpers';

const errors = (page: Page): Locator => page.getByTestId('errors');
const row = (page: Page, code: string): Locator => errors(page).locator(`[data-code="${code}"]`);
const summary = (page: Page): Locator => page.locator('.fm-problems-summary');

test('a warning row has a working × that hides only that warning, keyboard included', async ({ page }, info) => {
  const d = makeDiagram(info, RICH);
  await open(page, d);
  await expect(errors(page).locator('.fm-problem')).toHaveCount(8);
  await expect(summary(page)).toContainText('8 warnings');

  // Errors get no dismiss control at all (RICH has none, so prove the point on a warning row's sibling controls
  // instead: every row rendered here is a warning and every one has exactly one dismiss button).
  await expect(errors(page).locator('[data-code="W-config-unknown-lane"] [data-testid="dismiss-warning"]')).toHaveCount(1);

  // Mouse: dismiss the W-config-unknown-lane row.
  await row(page, 'W-config-unknown-lane').getByTestId('dismiss-warning').click();
  await expect(row(page, 'W-config-unknown-lane')).toHaveCount(0);
  await expect(errors(page).locator('.fm-problem')).toHaveCount(7);
  await expect(summary(page)).toContainText('7 warnings');
  // Its orphan-delete sibling is unaffected: the underlying data is untouched by a dismiss.
  await expect(row(page, 'W-config-unknown-node').getByTestId('orphan-delete')).toHaveCount(1);

  // Keyboard: tab to a dismiss button and activate it with Enter.
  const target = row(page, 'W-layout-unknown-node').getByTestId('dismiss-warning');
  await target.focus();
  await expect(target).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(row(page, 'W-layout-unknown-node')).toHaveCount(0);
  await expect(errors(page).locator('.fm-problem')).toHaveCount(6);
});

test('Dismiss all warnings clears every warning row but never touches an error', async ({ page }, info) => {
  // A .mmd error alongside RICH's warnings: the error must survive "dismiss all". With an .mmd error present from
  // the start there's no prior valid layout to fall back on, so the canvas draws no nodes (UI31); check through
  // the banner only, as the "broken from the start" case does elsewhere in the suite.
  const mmd = RICH.mmd.replace('r01 --> m01\n', 'r01 --> m01\nm01 --- m02\n');
  const d = makeDiagram(info, { ...RICH, mmd });
  await page.goto(`/?file=${encodeURIComponent(d.file)}`);
  await expect(row(page, 'E-edge')).toBeVisible();
  const warningCountBefore = await errors(page).locator('.fm-problem.fm-warning').count();
  expect(warningCountBefore).toBeGreaterThan(1);

  await page.getByTestId('dismiss-all-warnings').click();
  await expect(errors(page).locator('.fm-problem.fm-warning')).toHaveCount(0);
  await expect(row(page, 'E-edge')).toBeVisible();
  await expect(summary(page)).not.toContainText('warning');
  // With no warnings left to dismiss, the control itself goes away.
  await expect(page.getByTestId('dismiss-all-warnings')).toHaveCount(0);
});

test('a dismissal survives a reload, keyed by code+message (not line, which shifts as the file is edited)', async ({ page }, info) => {
  const d = makeDiagram(info, RICH);
  await open(page, d);
  await row(page, 'W-config-key').first().getByTestId('dismiss-warning').click();
  await expect(errors(page).locator('[data-code="W-config-key"]')).toHaveCount(1); // the other W-config-key remains
  const before = await errors(page).locator('.fm-problem').count();

  // An external edit shifts every later line by one (a comment inserted right after the header): the W-no-lane
  // warnings' line numbers move, but they're keyed by code+message, so nothing dismissed reappears.
  d.write({ mmd: RICH.mmd.replace('flowchart LR\n', 'flowchart LR\n%% inserted note\n') });
  await expect(row(page, 'W-no-lane').first()).toContainText('line 7', { timeout: 1000 });
  await expect(errors(page).locator('.fm-problem')).toHaveCount(before);

  await page.reload();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(errors(page).locator('.fm-problem')).toHaveCount(before);
  await expect(errors(page).locator('[data-code="W-config-key"]')).toHaveCount(1);
});

test('fixing a warning\'s cause forgets its dismissal: reintroducing the same problem shows it again', async ({ page }, info) => {
  const d = makeDiagram(info, RICH);
  await open(page, d);
  await row(page, 'W-config-unknown-node').getByTestId('dismiss-warning').click();
  await expect(row(page, 'W-config-unknown-node')).toHaveCount(0);

  // Fix the cause: remove the orphan `n1` entry from the config on disk (as another author might).
  const fixedConfig = RICH.config!.replace(/  n1:.*\n {4}note: gone from the diagram\n/, '');
  d.write({ config: fixedConfig });
  await expect(row(page, 'W-config-unknown-node')).toHaveCount(0, { timeout: 1000 });
  // Give the dismissed set's own prune (a separate effect, reacting to the warning list) time to run and persist,
  // so the write below doesn't race it.
  await page.waitForTimeout(300);

  // Reintroduce the exact same problem: it is not remembered as dismissed, so it shows again.
  d.write({ config: RICH.config! });
  await expect(row(page, 'W-config-unknown-node')).toBeVisible({ timeout: 1000 });
  await expect(row(page, 'W-config-unknown-node').getByTestId('dismiss-warning')).toBeVisible();
});
