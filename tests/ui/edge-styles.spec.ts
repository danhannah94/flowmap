// Amendment A18 / UI44: dashed, thick and bidirectional lines in the editor, driven through §8.3 only:
// `data-edge-style` on every line, the picker (`edge-style-picker`, `data-edge-style` options), the line context menu's
// `line-style` item, and the click-path connect. Every change is checked on disk (the `.mmd` byte for byte) and
// against `flowmap layout`.
import { expect, test, type Page } from '@playwright/test';
import { makeDiagram, node, open, saved, settled, type Diagram, type Files } from './helpers';

const MMD = `flowchart LR

  a["Stream service"]
  b["Model gateway"]
  c[("Audit store")]
  d["Cache"]

  a --> b
  b -.->|event| c
  c ==> d
  d <-->|sync| a
`;
const FILES: Files = { mmd: MMD, config: null, layout: null };

const edge = (page: Page, id: string) => page.locator(`[data-edge-id="${id}"]`);
const picker = (page: Page) => page.getByTestId('edge-style-picker');
const option = (page: Page, style: string) => picker(page).locator(`[data-edge-style="${style}"]`);

/** Select a line by clicking a point of its own path. */
async function selectLine(page: Page, id: string, extend = false): Promise<void> {
  const p = await page.evaluate((id) => {
    const g = document.querySelector(`[data-edge-id="${CSS.escape(id)}"]`)!;
    const path = g.querySelector('path.fm-edge-line') as SVGPathElement;
    const len = path.getTotalLength();
    const m = path.getScreenCTM()!;
    for (const f of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const q = path.getPointAtLength(len * f);
      const x = q.x * m.a + q.y * m.c + m.e;
      const y = q.x * m.b + q.y * m.d + m.f;
      if (document.elementFromPoint(x, y)?.closest('[data-edge-id]') === g) return { x, y };
    }
    throw new Error(`no clickable point on ${id}`);
  }, id);
  if (extend) await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  if (extend) await page.keyboard.up('Shift');
  await expect(edge(page, id)).toHaveAttribute('data-selected', 'true');
}

/** How a drawn line looks, from the browser's computed style. */
async function look(page: Page, id: string) {
  return edge(page, id).evaluate((g) => {
    const line = getComputedStyle(g.querySelector('.fm-edge-line')!);
    return {
      dash: line.strokeDasharray,
      width: line.strokeWidth,
      heads: g.querySelectorAll('.fm-edge-arrow').length,
    };
  });
}

/** The style `flowmap layout` reports for each line (absent = solid). */
function cliStyles(d: Diagram): Record<string, string> {
  return Object.fromEntries(d.cliLayout().edges.map((e) => [e.id, e.style ?? 'solid']));
}

test('lines are drawn in their style: dashed, thick, two heads (and data-edge-style says which)', async ({ page }, info) => {
  const d = makeDiagram(info, FILES);
  await open(page, d);
  for (const [id, style] of [['a->b', 'solid'], ['b->c', 'dashed'], ['c->d', 'thick'], ['d->a', 'bidirectional']]) {
    await expect(edge(page, id!)).toHaveAttribute('data-edge-style', style!);
  }
  expect(await look(page, 'a->b')).toEqual({ dash: 'none', width: '1.5px', heads: 1 });
  expect(await look(page, 'b->c')).toMatchObject({ dash: '6px, 4px', width: '1.5px', heads: 1 });
  expect(await look(page, 'c->d')).toMatchObject({ dash: 'none', width: '3px', heads: 1 });
  expect(await look(page, 'd->a')).toMatchObject({ dash: 'none', width: '1.5px', heads: 2 });
  // The label of a styled line still shows, and the UI agrees with the CLI.
  await expect(edge(page, 'b->c')).toContainText('event');
  expect(cliStyles(d)).toEqual({ 'a->b': 'solid', 'b->c': 'dashed', 'c->d': 'thick', 'd->a': 'bidirectional' });
});

test('the picker shows while a line is selected, marks its style, and changes it (one undo step each)', async ({ page }, info) => {
  const d = makeDiagram(info, FILES);
  await open(page, d);
  await expect(picker(page)).toHaveCount(0);
  await selectLine(page, 'a->b');
  await expect(picker(page)).toBeVisible();
  await expect(option(page, 'solid')).toHaveAttribute('aria-pressed', 'true');
  await expect(option(page, 'dashed')).toHaveAttribute('aria-pressed', 'false');

  const steps: [string, string, string][] = [
    ['dashed', 'a --> b', 'a -.-> b'],
    ['thick', 'a -.-> b', 'a ==> b'],
    ['bidirectional', 'a ==> b', 'a <--> b'],
    ['solid', 'a <--> b', 'a --> b'],
  ];
  let text = MMD;
  const history: string[] = [MMD];
  for (const [style, from, to] of steps) {
    await option(page, style).click();
    text = text.replace(from, to);
    const f = await settled(page, d, (x) => x.mmd === text);
    expect(f).toEqual({ ...FILES, mmd: text });
    await expect(edge(page, 'a->b')).toHaveAttribute('data-edge-style', style);
    await expect(option(page, style)).toHaveAttribute('aria-pressed', 'true');
    expect(cliStyles(d)['a->b']).toBe(style);
    await saved(page);
    history.push(text);
  }
  // Each choice was its own undo step, and the line stays selected.
  for (let i = history.length - 2; i >= 0; i--) {
    await page.getByTestId('undo').click();
    await settled(page, d, (x) => x.mmd === history[i]);
    await saved(page);
  }
  await expect(edge(page, 'a->b')).toHaveAttribute('data-edge-style', 'solid');
  // Choosing the style a line already has writes nothing and adds no undo step.
  await option(page, 'solid').click();
  await page.waitForTimeout(300);
  expect(d.read().mmd).toBe(MMD);
});

test('a styled line keeps its label, comment and place when its style changes', async ({ page }, info) => {
  const d = makeDiagram(info, FILES);
  await open(page, d);
  await selectLine(page, 'b->c');
  await option(page, 'thick').click();
  const f = await settled(page, d, (x) => x.mmd.includes('b ==>|event| c'));
  expect(f.mmd).toBe(MMD.replace('b -.->|event| c', 'b ==>|event| c'));
  await expect(edge(page, 'b->c')).toContainText('event');
});

test('creating a line: connect, then choose its style; it is written with that arrow', async ({ page }, info) => {
  const d = makeDiagram(info, FILES);
  await open(page, d);
  const connect = page.getByTestId('connect');
  await node(page, 'a').click();
  await connect.click();
  await node(page, 'c').click();
  // The new line is selected, so the picker is there to style it straight away.
  await expect(edge(page, 'a->c')).toHaveAttribute('data-selected', 'true');
  await expect(option(page, 'solid')).toHaveAttribute('aria-pressed', 'true');
  await option(page, 'dashed').click();
  const want = `${MMD}  a -.-> c\n`;
  const f = await settled(page, d, (x) => x.mmd === want);
  expect(f.mmd).toBe(want);
  await expect(edge(page, 'a->c')).toHaveAttribute('data-edge-style', 'dashed');
  expect(cliStyles(d)['a->c']).toBe('dashed');
});

test('several lines selected: the picker styles them all in one step; mixed styles press nothing', async ({ page }, info) => {
  const d = makeDiagram(info, FILES);
  await open(page, d);
  await selectLine(page, 'a->b');
  await selectLine(page, 'c->d', true);
  await expect(picker(page)).toBeVisible();
  for (const s of ['solid', 'dashed', 'thick', 'bidirectional']) {
    await expect(option(page, s)).toHaveAttribute('aria-pressed', 'false');
  }
  await option(page, 'dashed').click();
  const want = MMD.replace('a --> b', 'a -.-> b').replace('c ==> d', 'c -.-> d');
  const f = await settled(page, d, (x) => x.mmd === want);
  expect(f.mmd).toBe(want);
  await expect(option(page, 'dashed')).toHaveAttribute('aria-pressed', 'true');
  await saved(page);
  await page.getByTestId('undo').click();
  expect((await settled(page, d, (x) => x.mmd === MMD)).mmd).toBe(MMD);
});

test('the picker is not there when a block is selected, or when nothing is', async ({ page }, info) => {
  const d = makeDiagram(info, FILES);
  await open(page, d);
  await node(page, 'a').click();
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByTestId('shape-picker')).toBeVisible();
  await selectLine(page, 'a->b');
  await expect(page.getByTestId('shape-picker')).toHaveCount(0);
  await expect(picker(page)).toBeVisible();
});

test('the line context menu has a Line style item with the four styles', async ({ page }, info) => {
  const d = makeDiagram(info, FILES);
  await open(page, d);
  const p = await edge(page, 'c->d').evaluate((g) => {
    const path = g.querySelector('path.fm-edge-line') as SVGPathElement;
    const q = path.getPointAtLength(path.getTotalLength() / 2);
    const m = path.getScreenCTM()!;
    return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f };
  });
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  await menu.locator('[data-menu-item="line-style"]').click();
  const options = menu.locator('[data-edge-style]');
  await expect(options).toHaveCount(4);
  await expect(menu.locator('[data-edge-style="thick"]')).toHaveAttribute('aria-checked', 'true');
  await menu.locator('[data-edge-style="bidirectional"]').click();
  await expect(menu).toHaveCount(0);
  const want = MMD.replace('c ==> d', 'c <--> d');
  expect((await settled(page, d, (x) => x.mmd === want)).mmd).toBe(want);
  await expect(edge(page, 'c->d')).toHaveAttribute('data-edge-style', 'bidirectional');
});

test('an edit to the file by hand (or the AI) shows up in the editor with the right style', async ({ page }, info) => {
  const d = makeDiagram(info, FILES);
  await open(page, d);
  d.write({ mmd: MMD.replace('a --> b', 'a -. async .-> b') });
  await expect(edge(page, 'a->b')).toHaveAttribute('data-edge-style', 'dashed');
  await expect(edge(page, 'a->b')).toContainText('async');
});

test('copy and paste keep a line\'s style', async ({ page }, info) => {
  const d = makeDiagram(info, FILES);
  await open(page, d);
  await node(page, 'b').click();
  await node(page, 'c').click({ modifiers: ['Shift'] });
  await page.keyboard.press('ControlOrMeta+d'); // duplicate: the lines between the copies come along (A12)
  const f = await settled(page, d, (x) => /b-2 -\.->\|event\| c-2/.test(x.mmd));
  expect(f.mmd).toContain('b-2 -.->|event| c-2');
  await expect(edge(page, 'b-2->c-2')).toHaveAttribute('data-edge-style', 'dashed');
});
