// Polish pass: double-click editing next to the side column and under the shape picker (the acceptance suite's P3.03),
// the canvas ending at the side column, readable in-place editors at low zoom, and handles and grips with a usable
// on-screen size. Driven through the §8.3 attributes; edits are checked on disk.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { format, parse } from '../../src/core/mmd';
import { formatNodeDecl } from '../../src/core/mmd/format';
import { Diagram, eventually, makeDiagram, node, open, PR, saved, zoomOf, type Files } from './helpers';

const canon = (text: string) => format(parse(text).diagram);

/** Six steps in a row, then one block of each shape in the last column: at fit they sit at the canvas's right edge. */
const EDGE_OF_CANVAS = canon(`flowchart LR
  subgraph work [Work]
    s1["One"]
    s2["Two"]
    s3["Three"]
    s4["Four"]
    s5["Five"]
    s6["Six"]
    a["A step"]
    b{"Decide"}
    c(["The end"])
    d[["Subprocess"]]
    e[("ERP")]
    g[/"The form"/]
    f@{ shape: doc, label: "Vendor quote" }
    h@{ shape: delay, label: "Wait for it" }
  end
  s1 --> s2
  s2 --> s3
  s3 --> s4
  s4 --> s5
  s5 --> s6
  s6 --> a
  s6 --> b
  s6 --> c
  s6 --> d
  s6 --> e
  s6 --> g
  s6 --> f
  s6 --> h
`);
const SHAPES = ['a', 'b', 'c', 'd', 'e', 'g', 'f', 'h'];

async function box(loc: Locator) {
  const b = (await loc.boundingBox())!;
  return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height, width: b.width, height: b.height };
}

const overlaps = (a: Awaited<ReturnType<typeof box>>, b: Awaited<ReturnType<typeof box>>) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** The on-screen font size of an element, in px. */
const fontPx = (loc: Locator) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

async function onDisk(d: Diagram, check: (f: Files) => boolean): Promise<Files> {
  return eventually(() => d.read(), check, 2000);
}

async function clearSelection(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('inspector')).toHaveCount(0);
}

// ---- P3.03: double-click a block whose first click opens the side column over it ---------------------------------

test('double-click opens the label editor on every shape at the canvas’s right edge, at fit and at 100% (P3.03)', async ({ page }, info) => {
  const d = makeDiagram(info, { mmd: EDGE_OF_CANVAS, config: null, layout: null });
  await open(page, d);
  const canvas = await box(page.getByTestId('canvas'));
  // At fit, the last column is where the side column opens.
  expect((await box(node(page, 'f'))).right).toBeGreaterThan(canvas.right - 340);
  const editor = page.getByTestId('label-editor');
  for (const at100 of [false, true]) {
    if (at100) {
      await clearSelection(page);
      await page.locator('.fm-zoom-level').click();
      await expect.poll(() => zoomOf(page, 'a')).toBeCloseTo(1, 2);
    }
    for (const id of SHAPES) {
      const b = await box(node(page, id));
      const c = await box(page.getByTestId('canvas'));
      if (b.left < c.left || b.right > c.right || b.top < c.top || b.bottom > c.bottom) continue; // off screen at 100%
      await clearSelection(page);
      await node(page, id).dblclick();
      await expect(editor, `${id} (${at100 ? '100%' : 'fit'})`).toBeVisible();
      await expect(editor).toHaveValue((await node(page, id).locator('[data-role="label"]').textContent())!);
      await page.keyboard.press('Escape');
      await expect(editor).toHaveCount(0);
    }
  }
  // Once the side column has opened, the block is still in view, left of it.
  await clearSelection(page);
  await page.getByTestId('fit').click();
  await node(page, 'f').click();
  const panel = await box(page.getByTestId('inspector'));
  const f = await box(node(page, 'f'));
  expect(f.right).toBeLessThanOrEqual(panel.left);
  expect(f.left).toBeGreaterThanOrEqual(canvas.left);
});

test('a document block label with a backslash and quotes round-trips; undo and redo (P3.03, P20)', async ({ page }, info) => {
  const d = makeDiagram(info, { mmd: EDGE_OF_CANVAS, config: null, layout: null });
  await open(page, d);
  const label = 'Scan \\ "copy"';
  await node(page, 'f').dblclick();
  const editor = page.getByTestId('label-editor');
  await expect(editor).toHaveValue('Vendor quote');
  await editor.fill(label);
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  const line = formatNodeDecl({ id: 'f', shape: 'document', label, className: null });
  const want = canon(EDGE_OF_CANVAS.replace('f@{ shape: doc, label: "Vendor quote" }', line));
  expect(want).toContain(`    ${line}\n`);
  expect((await onDisk(d, (x) => x.mmd === want)).mmd).toBe(want);
  expect(parse(want).diagram.lanes[0]!.nodes.find((n) => n.id === 'f')!.label).toBe(label);
  await expect(node(page, 'f').locator('[data-role="label"]')).toHaveText(label);
  await expect(node(page, 'f')).toHaveAttribute('data-kind', 'document');
  // The editor shows it back exactly.
  await node(page, 'f').dblclick();
  await expect(editor).toHaveValue(label);
  await editor.press('Escape');
  // Undo and redo, byte for byte.
  await saved(page);
  await page.getByTestId('undo').click();
  expect((await onDisk(d, (x) => x.mmd === EDGE_OF_CANVAS)).mmd).toBe(EDGE_OF_CANVAS);
  await saved(page);
  await page.getByTestId('redo').click();
  expect((await onDisk(d, (x) => x.mmd === want)).mmd).toBe(want);
  await saved(page);
});

test('a block under the shape picker’s spot: the picker docks at the bottom and double-click still edits', async ({ page }, info) => {
  const d = makeDiagram(info, { mmd: EDGE_OF_CANVAS, config: null, layout: null });
  await open(page, d);
  await page.locator('.fm-zoom-level').click();
  await expect.poll(() => zoomOf(page, 's3')).toBeCloseTo(1, 2);
  // Alt-drag pans from anywhere: bring s3 to the top centre of the canvas.
  const c = await box(page.getByTestId('canvas'));
  const b = await box(node(page, 's3'));
  await page.keyboard.down('Alt');
  await page.mouse.move(b.left + b.width / 2, b.top + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.left + c.width / 2, c.top + 20 + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const moved = await box(node(page, 's3'));
  expect(moved.top).toBeLessThan(c.top + 40);
  await node(page, 's3').dblclick();
  await expect(page.getByTestId('label-editor')).toBeVisible();
  const picker = await box(page.getByTestId('shape-picker'));
  expect(overlaps(picker, await box(node(page, 's3')))).toBe(false);
  expect(picker.top).toBeGreaterThan(c.top + c.height / 2);
  await page.keyboard.press('Escape');
  // A block elsewhere gets the picker back at the top.
  await clearSelection(page);
  await node(page, 's5').click();
  await expect.poll(async () => (await box(page.getByTestId('shape-picker'))).top).toBeLessThan(c.top + 60);
});

// ---- the canvas ends at the side column -------------------------------------------------------------------------

test('with the inspector or the styles panel open, fit leaves no block behind the panel', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const ids = await page.locator('[data-node-id]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.nodeId!));
  const expectAllLeftOf = async (panel: Locator) => {
    const p = await box(panel);
    const c = await box(page.getByTestId('canvas'));
    expect(c.right).toBeLessThanOrEqual(p.left + 1);
    for (const id of ids) {
      const n = await box(node(page, id));
      expect(n.right, id).toBeLessThanOrEqual(p.left);
      expect(n.left, id).toBeGreaterThanOrEqual(c.left);
    }
  };
  await page.getByTestId('styles-toggle').click();
  await expect(page.getByTestId('styles')).toBeVisible();
  await expect(page.getByTestId('styles-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('fit').click();
  await expectAllLeftOf(page.getByTestId('styles'));
  await page.getByTestId('styles-toggle').click();
  await expect(page.getByTestId('styles')).toHaveCount(0);
  // The rightmost block: selecting it opens the inspector and keeps it in view.
  await page.getByTestId('fit').click();
  await node(page, 'f04').click();
  const inspector = page.getByTestId('inspector');
  await expect(inspector).toBeVisible();
  const f04 = await box(node(page, 'f04'));
  expect(f04.right).toBeLessThanOrEqual((await box(inspector)).left);
  await page.getByTestId('fit').click();
  await expectAllLeftOf(inspector);
});

test('zoom buttons keep the selected block in place', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await node(page, 'p05').click();
  await expect(page.getByTestId('inspector')).toBeVisible();
  const before = await box(node(page, 'p05'));
  await page.locator('.fm-zoom-level').click();
  await expect.poll(() => zoomOf(page, 'p05')).toBeCloseTo(1, 2);
  const after = await box(node(page, 'p05'));
  expect(Math.abs(after.left + after.width / 2 - (before.left + before.width / 2))).toBeLessThan(2);
  expect(Math.abs(after.top + after.height / 2 - (before.top + before.height / 2))).toBeLessThan(2);
});

// ---- readable in-place editors at low zoom -----------------------------------------------------------------------

test('in-place editors are readable at fit zoom, anchored to their target, and grow with the text', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  expect(await zoomOf(page, 'r01')).toBeLessThan(0.5);
  const canvas = await box(page.getByTestId('canvas'));
  const label = page.getByTestId('label-editor');

  // A block.
  await node(page, 'r01').dblclick();
  await expect(label).toBeVisible();
  expect(await fontPx(label)).toBeGreaterThanOrEqual(13);
  const n = await box(node(page, 'r01'));
  let e = await box(label);
  expect(e.left).toBeLessThanOrEqual(n.left + n.width / 2);
  expect(e.right).toBeGreaterThanOrEqual(n.left + n.width / 2);
  expect(Math.abs(e.top + e.height / 2 - (n.top + n.height / 2))).toBeLessThan(4);
  const narrow = e.width;
  await label.fill('Fill the purchase request form and attach the three quotes from the approved vendor list');
  e = await box(label);
  expect(e.width).toBeGreaterThan(narrow + 100);
  expect(e.left).toBeGreaterThanOrEqual(canvas.left);
  expect(e.right).toBeLessThanOrEqual(canvas.right);
  await label.press('Escape');

  // A line (UI17).
  await page.locator('[data-edge-id="p02->p03"] .fm-edge-label').dblclick();
  await expect(label).toHaveValue('no');
  expect(await fontPx(label)).toBeGreaterThanOrEqual(13);
  await label.press('Escape');

  // A lane header (UI19) and the title (UI22): in place too, not a centred prompt.
  await page.locator('[data-lane-header="finance"]').dblclick();
  await expect(label).toHaveValue('Finance');
  expect(await fontPx(label)).toBeGreaterThanOrEqual(13);
  await expect(page.locator('.fm-prompt-backdrop')).toHaveCount(0);
  const header = await box(page.locator('[data-lane-header="finance"]'));
  e = await box(label);
  expect(e.top).toBeLessThan(header.bottom);
  expect(e.bottom).toBeGreaterThan(header.top);
  await label.press('Escape');
  await page.getByTestId('title').dblclick();
  const title = page.getByTestId('title-editor');
  await expect(title).toBeVisible();
  expect(await fontPx(title)).toBeGreaterThanOrEqual(13);
  await expect(page.locator('.fm-prompt-backdrop')).toHaveCount(0);
  await title.press('Escape');
  await saved(page);
  expect(d.read()).toEqual(PR);
});

// ---- handles and grips at low zoom -------------------------------------------------------------------------------

test('handles and line-end grips keep a usable size at fit zoom; handles show on hover and on the selected block', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  expect(await zoomOf(page, 'p01')).toBeLessThan(0.5);
  const handle = (id: string, h: 'source' | 'target') => node(page, id).locator(`[data-handle="${h}"]`);
  const opacity = (loc: Locator) => loc.evaluate((el) => Number(getComputedStyle(el).opacity));
  // Hidden until hover or selection.
  await expect.poll(() => opacity(handle('p01', 'source'))).toBe(0);
  await node(page, 'p01').hover();
  await expect.poll(() => opacity(handle('p01', 'source'))).toBe(1);
  await node(page, 'p05').click();
  await page.mouse.move(5, 300);
  await expect.poll(() => opacity(handle('p05', 'target'))).toBe(1);
  for (const [id, h] of [['p01', 'source'], ['p01', 'target'], ['p05', 'source']] as const) {
    const hb = await box(handle(id, h));
    expect(hb.width, `${id} ${h} width`).toBeGreaterThanOrEqual(10);
    expect(hb.height, `${id} ${h} height`).toBeGreaterThanOrEqual(10);
    // On the block's side (§8.3: inside the node element), reaching only a little way outside it; a press on the
    // side's midpoint lands on the handle.
    const nb = await box(node(page, id));
    const side = h === 'source' ? nb.right : nb.left;
    expect(hb.left).toBeLessThan(side);
    expect(hb.right).toBeGreaterThan(side);
    expect(h === 'source' ? hb.right - side : side - hb.left).toBeLessThan(4);
    const onSide = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.getAttribute('data-handle'), [side + (h === 'source' ? -1 : 1), nb.top + nb.height / 2]);
    expect(onSide).toBe(h);
  }
  // Connect at fit zoom by dragging a handle.
  await handle('intake', 'source').dragTo(node(page, 'p05'));
  const want = canon(`${PR.mmd}  intake --> p05\n`);
  expect((await onDisk(d, (f) => f.mmd === want)).mmd).toBe(want);
  await expect(page.locator('[data-edge-id="intake->p05"]')).toHaveAttribute('data-selected', 'true');
  // With that line selected, the same handle still starts another (a duplicate, P5).
  await handle('intake', 'source').dragTo(node(page, 'p05'));
  const dup = canon(`${want}  intake --> p05\n`);
  expect((await onDisk(d, (f) => f.mmd === dup)).mmd).toBe(dup);
  // The new line is selected; its end grips are big enough to grab.
  const line = page.locator('[data-edge-id="intake->p05#2"]');
  await expect(line).toHaveAttribute('data-selected', 'true');
  for (const end of ['source', 'target']) {
    const gb = await box(line.locator(`[data-edge-end="${end}"]`));
    expect(gb.width, `${end} grip`).toBeGreaterThanOrEqual(10);
  }
  // Grips aren't under the blocks' handles: dragging the target grip reconnects.
  await line.locator('[data-edge-end="target"]').dragTo(node(page, 'p06'));
  const moved = canon(`${want}  intake --> p06\n`);
  expect((await onDisk(d, (f) => f.mmd === moved)).mmd).toBe(moved);
});

// ---- UX sweep: dragging across lanes, a map from scratch ---------------------------------------------------------

test('while a block is dragged into another lane, that lane is highlighted', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const from = await box(node(page, 'r01'));
  const to = await box(page.locator('[data-lane-id="manager"]'));
  const x = from.left + from.width / 2;
  const y = from.top + from.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 10, y + 5, { steps: 3 });
  await expect(page.locator('[data-drop-target="true"]')).toHaveCount(0); // still in its own lane
  await page.mouse.move(x + 10, to.top + to.height / 2, { steps: 6 });
  await expect(page.locator('[data-lane-id="manager"]')).toHaveAttribute('data-drop-target', 'true');
  await expect(page.locator('[data-drop-target="true"]')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('[data-drop-target="true"]')).toHaveCount(0);
  await expect(node(page, 'r01')).toHaveAttribute('data-lane', 'manager');
});

test('a new diagram from the home page: create it, then the first-steps hint adds a lane', async ({ page }, info) => {
  const name = `New map ${info.workerIndex} ${Date.now() % 100000}`;
  const file = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.mmd`;
  await page.goto('/');
  await expect(page.getByTestId('diagram-list')).toBeVisible();
  await page.getByRole('button', { name: 'New diagram' }).click();
  await page.getByLabel('New diagram name').fill(name);
  await expect(page.getByText(`Creates ${file}`)).toBeVisible();
  await page.getByLabel('New diagram name').press('Enter');
  await page.waitForURL(`**/?file=${file}`);
  await expect(page.getByTestId('canvas')).toBeVisible();
  const d = new Diagram(file.replace(/\.mmd$/, ''));
  expect(d.read()).toEqual({ mmd: 'flowchart LR\n', config: null, layout: null });
  await page.locator('.fm-empty-hint').getByRole('button', { name: 'Add a lane' }).click();
  const editor = page.getByTestId('label-editor');
  await editor.fill('Requester');
  await editor.press('Enter');
  await expect(page.locator('[data-lane-id="requester"]')).toBeVisible();
  await expect(page.locator('.fm-empty-hint')).toContainText('Click a shape in the palette to add a block to Requester');
  await page.getByTestId('palette').locator('[data-shape="step"]').click();
  await expect(editor).toBeVisible();
  await editor.fill('Fill the form');
  await editor.press('Enter');
  await expect(page.locator('.fm-empty-hint')).toHaveCount(0);
  expect((await onDisk(d, (f) => f.mmd.includes('Fill the form'))).mmd).toBe(
    canon('flowchart LR\n  subgraph requester [Requester]\n    n1["Fill the form"]\n  end\n'),
  );
  // An existing name is refused, and nothing is overwritten.
  await page.goto('/');
  await page.getByRole('button', { name: 'New diagram' }).click();
  await page.getByLabel('New diagram name').fill(name);
  await page.getByLabel('New diagram name').press('Enter');
  await expect(page.getByText(`${file} already exists`)).toBeVisible();
});
