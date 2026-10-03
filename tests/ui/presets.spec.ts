// A20: preset packs (design.md §4.1). A diagram that names a pack gets an icon tag and the pack's looks on every block
// whose metadata `kind` the pack knows, and legend entries for the kinds in use; all of it drawn in the browser from
// inline SVG (no network), in both themes, and carried into the SVG export. Through the §8.3 attributes plus the
// presets' own: `node-icon` (`data-icon`), `legend-item` (`data-icon`), `preset-input`.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_DIR } from './env';
import { makeDiagram, node, open, settled, type Files } from './helpers';

const MMD = [
  'flowchart LR',
  '  subgraph edge [Edge]',
  '    gw["Public API"]',
  '    fn["Create order"]',
  '  end',
  '  subgraph data [Data]',
  '    db["Orders"]',
  '    plain["Not typed"]',
  '  end',
  '  gw --> fn',
  '  fn --> db',
  '  fn --> plain',
  '',
].join('\n');
const NODES = 'nodes:\n  gw: {kind: api-gateway}\n  fn: {kind: function}\n  db: {kind: database}\n';
const BUILTIN: Files = { mmd: MMD, config: `version: 1\npreset: cloud\n${NODES}`, layout: null };

const icon = (page: Page, id: string) => node(page, id).getByTestId('node-icon');
const legendItems = (page: Page) => page.getByTestId('legend').getByTestId('legend-item');

test('a built-in pack puts an icon on each typed block and a legend entry per kind in use', async ({ page }, info) => {
  const d = makeDiagram(info, BUILTIN);
  await open(page, d);
  await expect(icon(page, 'gw')).toHaveAttribute('data-icon', 'api-gateway');
  await expect(icon(page, 'fn')).toHaveAttribute('data-icon', 'function');
  await expect(icon(page, 'db')).toHaveAttribute('data-icon', 'database');
  await expect(icon(page, 'plain')).toHaveCount(0);
  await expect(page.getByTestId('node-icon')).toHaveCount(3);
  // Each is a real drawing: visible, sized, with strokes in it.
  for (const id of ['gw', 'fn', 'db']) {
    const box = (await icon(page, id).boundingBox())!;
    expect(box.width).toBeGreaterThan(15);
    expect(await icon(page, id).locator('path').count()).toBeGreaterThan(0);
  }
  // The legend: the pack's entries for the kinds in use, in pack order.
  await expect(legendItems(page)).toHaveText(['Function', 'Database', 'API gateway']);
  await expect(legendItems(page).first()).toHaveAttribute('data-icon', 'function');
  // The pack's look: the typed blocks are tinted, the untyped one is not.
  const fill = (id: string) => node(page, id).locator('.fm-node-svg').locator('rect, path, polygon').first().evaluate((el) => getComputedStyle(el).fill);
  expect(await fill('db')).not.toBe(await fill('plain'));
  // Nothing was written by looking at it.
  expect(d.read().config).toBe(BUILTIN.config);
});

test('the icons need no network: every request the page makes goes to the local server', async ({ page }, info) => {
  const d = makeDiagram(info, BUILTIN);
  const hosts = new Set<string>();
  page.on('request', (r) => {
    if (!r.url().startsWith('data:') && !r.url().startsWith('blob:')) hosts.add(new URL(r.url()).host);
  });
  await open(page, d);
  await expect(page.getByTestId('node-icon')).toHaveCount(3);
  expect([...hosts]).toEqual([new URL(page.url()).host]);
});

test('icons read in both themes: the tag takes the pack\'s fill for the theme and the glyph the block\'s text colour', async ({ page }, info) => {
  const d = makeDiagram(info, BUILTIN);
  await open(page, d);
  const canvas = page.getByTestId('canvas');
  const read = () =>
    icon(page, 'db').evaluate((svg) => {
      const chip = svg.querySelectorAll('circle')[1]!;
      const glyph = svg.querySelector('g')!;
      return { fill: chip.getAttribute('fill'), stroke: glyph.getAttribute('stroke') };
    });
  const theme = await canvas.getAttribute('data-theme');
  const lightWant = { fill: '#def5ea', stroke: '#0f172a' };
  const darkWant = { fill: '#17402f', stroke: '#f1f5f9' };
  expect(await read()).toEqual(theme === 'dark' ? darkWant : lightWant);
  await page.getByTestId('theme-toggle').click();
  await expect(canvas).toHaveAttribute('data-theme', theme === 'dark' ? 'light' : 'dark');
  expect(await read()).toEqual(theme === 'dark' ? lightWant : darkWant);
  await expect(icon(page, 'db')).toBeVisible();
});

test('the icons are in the SVG export', async ({ page }, info) => {
  const d = makeDiagram(info, BUILTIN);
  await open(page, d);
  await page.getByTestId('export-svg').click();
  await expect(page.getByTestId('export-path')).toHaveText(new RegExp(`exports/${d.base}\\.svg$`), { timeout: 15_000 });
  const svg = readFileSync(join(E2E_DIR, 'exports', `${d.base}.svg`), 'utf8');
  for (const glyph of ['api-gateway', 'function', 'database']) {
    expect(svg.match(new RegExp(`data-icon="${glyph}"`, 'g'))).toHaveLength(2); // on the block and in the legend
  }
  expect(svg).toContain('>API gateway</text>');
});

test('the Styles panel sets and clears the pack (one config edit, undoable)', async ({ page }, info) => {
  const d = makeDiagram(info, { mmd: MMD, config: `version: 1\n${NODES}`, layout: null });
  await open(page, d);
  await expect(page.getByTestId('node-icon')).toHaveCount(0);
  await page.getByTestId('styles-toggle').click();
  await expect(page.getByTestId('preset-field')).toBeVisible();
  // A built-in offered as a chip.
  await page.getByTestId('preset-suggestion').filter({ hasText: 'cloud' }).click();
  await expect(page.getByTestId('node-icon')).toHaveCount(3);
  await expect(page.getByTestId('preset-using')).toHaveText('Using Cloud architecture');
  await settled(page, d, (f) => !!f.config?.includes('preset: cloud'));
  expect(d.read().config).toBe(`version: 1\n${NODES}preset: cloud\n`);
  // Undo takes it back, redo returns it.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('node-icon')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.getByTestId('node-icon')).toHaveCount(3);
  // Clear removes the key.
  await page.getByTestId('preset-clear').click();
  await expect(page.getByTestId('node-icon')).toHaveCount(0);
  const after = await settled(page, d, (f) => !f.config?.includes('preset'));
  expect(after.config).toBe(`version: 1\n${NODES}`);
});

test('an unknown pack and an unknown kind are warnings in the banner; the diagram still draws', async ({ page }, info) => {
  const d = makeDiagram(info, { mmd: MMD, config: `version: 1\npreset: kloud\n${NODES}`, layout: null });
  await open(page, d);
  await expect(page.getByTestId('errors').locator('[data-code="W-preset-unknown"]')).toHaveCount(1);
  await expect(page.getByTestId('node-icon')).toHaveCount(0);
  await expect(node(page, 'db')).toBeVisible();
  // Fix the name, break a kind.
  d.write({ config: `version: 1\npreset: cloud\nnodes:\n  db: {kind: databse}\n  fn: {kind: function}\n` });
  await expect(page.getByTestId('errors').locator('[data-code="W-preset-kind"]')).toHaveCount(1);
  await expect(page.getByTestId('errors').locator('[data-code="W-preset-unknown"]')).toHaveCount(0);
  await expect(page.getByTestId('errors').locator('[data-code="W-preset-kind"]')).toContainText('databse');
  await expect(page.getByTestId('node-icon')).toHaveCount(1);
});

test.describe('a pack file beside the diagram', () => {
  const packName = (base: string) => `${base}-pack.yaml`;
  const pack = (label: string) =>
    ['name: Team pack', 'kinds:', '  job:', `    label: ${label}`, '    icon: {paths: ["M4 4h16v16H4z", "M8 12h8"]}', '    style: {fill: {light: "#fde7c8", dark: "#5a3a10"}}', ''].join('\n');
  const files = (ref: string): Files => ({
    mmd: 'flowchart LR\n  a["Nightly sync"]\n  b["Other"]\n  a --> b\n',
    config: `version: 1\npreset: ${ref}\nnodes:\n  a: {kind: job}\n`,
    layout: null,
  });

  test('is drawn with its own paths, and edits to the pack file show live', async ({ page }, info) => {
    const d = makeDiagram(info, files('placeholder'));
    const name = packName(d.base);
    writeFileSync(join(E2E_DIR, name), pack('Background job'));
    d.write({ config: files(`./${name}`).config });
    await open(page, d);
    await expect(icon(page, 'a')).toHaveAttribute('data-icon', 'custom');
    await expect(icon(page, 'a').locator('path')).toHaveCount(2);
    await expect(legendItems(page)).toHaveText(['Background job']);
    expect(await page.getByTestId('errors').count()).toBe(0);
    // The AI edits the pack file: the editor follows without a reload, and nothing the person holds is lost.
    writeFileSync(join(E2E_DIR, name), pack('Scheduled job'));
    await expect(legendItems(page)).toHaveText(['Scheduled job']);
    await expect(page.getByTestId('history-cleared')).toHaveCount(0);
  });

  test('naming a pack file in the Styles panel loads it after the save', async ({ page }, info) => {
    const d = makeDiagram(info, { ...files('x'), config: 'version: 1\nnodes:\n  a: {kind: job}\n' });
    const name = packName(d.base);
    writeFileSync(join(E2E_DIR, name), pack('Background job'));
    await open(page, d);
    await expect(page.getByTestId('node-icon')).toHaveCount(0);
    await page.getByTestId('styles-toggle').click();
    const input = page.getByTestId('preset-input');
    await input.fill(name);
    await input.press('Enter');
    await expect(icon(page, 'a')).toHaveAttribute('data-icon', 'custom');
    await expect(legendItems(page)).toHaveText(['Background job']);
    await expect(page.getByTestId('errors')).toHaveCount(0);
  });

  test('a missing pack file is W-preset-unknown, and creating it fixes the diagram', async ({ page }, info) => {
    const d = makeDiagram(info, files('placeholder'));
    const name = packName(d.base);
    d.write({ config: files(name).config });
    await open(page, d);
    await expect(page.getByTestId('errors').locator('[data-code="W-preset-unknown"]')).toHaveCount(1);
    writeFileSync(join(E2E_DIR, name), pack('Background job'));
    await expect(icon(page, 'a')).toHaveAttribute('data-icon', 'custom');
    await expect(page.getByTestId('errors').locator('[data-code="W-preset-unknown"]')).toHaveCount(0);
  });

  test('a path out of the served folder is refused (W-preset-unknown)', async ({ page }, info) => {
    const d = makeDiagram(info, files('../../../../etc/hosts.yaml'));
    await open(page, d);
    await expect(page.getByTestId('errors').locator('[data-code="W-preset-unknown"]')).toHaveCount(1);
    await expect(page.getByTestId('node-icon')).toHaveCount(0);
  });
});
