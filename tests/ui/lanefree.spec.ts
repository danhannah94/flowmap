// Amendment A4, diagrams without lanes: (a) a `.mmd` with no subgraphs draws as a plain flowchart; (b) adding blocks
// to it; (c) in a diagram with lanes, a block dropped below every lane moves to Unassigned, pinned at the drop (v1.1:
// before or after the lanes along the flow it stays in the lane under it, and above them it joins the first lane);
// (d) the home page's Flowchart / Swimlanes choice. Plus style badges, which must never cover a block's label.
// Driven through the §8.3 attributes; edits are checked on disk.
import { expect, test, type Page } from '@playwright/test';
import { format, parse } from '../../src/core/mmd';
import {
  attrs, declaredLane, Diagram, dragBy, dragFromTo, eventually, expectMatchesCli, lane, makeDiagram, node, open, pins,
  saved, type Files,
} from './helpers';

const canon = (text: string) => format(parse(text).diagram);

const FLOWCHART: Files = {
  mmd: canon(`flowchart LR
  start(["Order received"])
  check["Check stock"]
  inStock{"In stock?"}
  ship["Ship the order"]
  reorder["Reorder from the supplier"]
  wait@{ shape: delay, label: "Wait for the delivery" }
  done(["Done"])
  start --> check
  check --> inStock
  inStock -->|yes| ship
  inStock -->|no| reorder
  reorder --> wait
  wait --> ship
  ship --> done
`),
  config: null,
  layout: null,
};

const LANES: Files = {
  mmd: canon(`flowchart LR
  subgraph alpha [Alpha]
    a1["First"]
    a2["Second"]
  end
  subgraph beta [Beta]
    b1["Third"]
    b2["Fourth"]
  end
  a1 --> a2
  a2 --> b1
  b1 --> b2
`),
  config: null,
  layout: null,
};

/** Screen <-> world (layout coordinates) from a block's on-screen box and its data-x/y. */
async function viewTransform(page: Page, refId: string) {
  const a = await attrs(node(page, refId));
  const box = (await node(page, refId).boundingBox())!;
  const z = box.width / a.width;
  const ox = box.x - a.x * z;
  const oy = box.y - a.y * z;
  return {
    z,
    toWorld: (p: { x: number; y: number }) => ({ x: (p.x - ox) / z, y: (p.y - oy) / z }),
    toScreen: (p: { x: number; y: number }) => ({ x: ox + p.x * z, y: oy + p.y * z }),
  };
}

async function onDisk(d: Diagram, check: (f: Files) => boolean): Promise<Files> {
  return eventually(() => d.read(), check, 2000);
}

async function canvasBox(page: Page) {
  return (await page.getByTestId('canvas').boundingBox())!;
}

const inside = (p: { x: number; y: number }, r: { x: number; y: number; width: number; height: number }) =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

// ---- (a) Rendering without lanes ----------------------------------------------------------------------------------

test('A4a: a diagram without subgraphs draws no lane band or header, and matches flowmap layout', async ({ page }, info) => {
  const d = makeDiagram(info, FLOWCHART);
  await open(page, d);
  // The one lane keeps its data-lane-id, with no header and nothing drawn.
  await expect(page.locator('[data-lane-id]')).toHaveCount(1);
  const unassigned = lane(page, '_unassigned');
  await expect(unassigned).toHaveCount(1);
  await expect(page.locator('[data-lane-header]')).toHaveCount(0);
  const look = await unassigned.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, shadow: cs.boxShadow, children: el.children.length, text: el.textContent };
  });
  expect(look).toEqual({ bg: 'rgba(0, 0, 0, 0)', shadow: 'none', children: 0, text: '' });
  // Unlaned is the point of a flowchart: no "not in any subgraph" warning per block (validate still reports it).
  await expect(page.getByTestId('errors')).toHaveCount(0);
  // No strip reserved for a lane label: the first column starts before where a 40 px header would end.
  const cli = d.cliLayout();
  expect(cli.lanes.map((l) => l.id)).toEqual(['_unassigned']);
  expect(Math.min(...cli.nodes.map((n) => n.x))).toBeLessThan(40);
  await expectMatchesCli(page, d);
  // Clicking the empty canvas selects nothing (there is no lane to select).
  const canvas = await canvasBox(page);
  const cell = cli.nodes.find((n) => n.id === 'start')!;
  const t = await viewTransform(page, 'start');
  const empty = t.toScreen({ x: cell.x + cell.width / 2, y: cli.height - 8 });
  if (inside(empty, canvas)) {
    await page.mouse.click(empty.x, empty.y);
    await expect(unassigned).toHaveAttribute('data-selected', 'false');
  }
  // Top to bottom too.
  await page.getByTestId('direction-toggle').click();
  await onDisk(d, (f) => f.mmd.startsWith('flowchart TB'));
  await saved(page);
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-direction', 'TB');
  await expect(page.locator('[data-lane-header]')).toHaveCount(0);
  const tb = d.cliLayout();
  expect(Math.min(...tb.nodes.map((n) => n.y))).toBeLessThan(40);
  await expectMatchesCli(page, d);
});

test('A4a: with lanes, every lane (Unassigned included) still has its band and header', async ({ page }, info) => {
  const d = makeDiagram(info, { ...LANES, mmd: canon(LANES.mmd + '  loose["Loose end"]\n') });
  await open(page, d);
  for (const id of ['alpha', 'beta', '_unassigned']) await expect(page.locator(`[data-lane-header="${id}"]`)).toHaveCount(1);
  // In a swimlane diagram a block outside every lane is still worth a warning.
  await expect(page.getByTestId('errors').locator('[data-code="W-no-lane"]')).toHaveCount(1);
  await expectMatchesCli(page, d);
});

// ---- (b) Adding without lanes -------------------------------------------------------------------------------------

test('A4b: clicking a palette shape adds an unlaned, unpinned block at once, in view and in label editing', async ({ page }, info) => {
  const d = makeDiagram(info, FLOWCHART);
  await open(page, d);
  await page.getByTestId('palette').locator('[data-shape="decision"]').click();
  const editor = page.getByTestId('label-editor');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue('New decision');
  await editor.fill('Paid in full?');
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  const files = await onDisk(d, (f) => f.mmd.includes('n1{"Paid in full?"}'));
  expect(declaredLane(files.mmd, 'n1')).toBe('_unassigned');
  expect(parse(files.mmd).diagram.lanes).toEqual([]);
  expect(pins(files.layout).n1).toBeUndefined();
  await expect(node(page, 'n1')).toHaveAttribute('data-lane', '_unassigned');
  await expect(node(page, 'n1')).toHaveAttribute('data-pinned', 'false');
  // Scrolled into view: the whole block is on the canvas.
  const box = (await node(page, 'n1').boundingBox())!;
  const canvas = await canvasBox(page);
  expect(box.x).toBeGreaterThanOrEqual(canvas.x);
  expect(box.y).toBeGreaterThanOrEqual(canvas.y);
  expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  expect(box.y + box.height).toBeLessThanOrEqual(canvas.y + canvas.height);
  await saved(page);
  await expectMatchesCli(page, d);
  // Every other shape the same way, each its own block.
  const shapes = ['step', 'terminal', 'subprocess', 'database', 'io', 'document', 'delay'] as const;
  for (const [i, shape] of shapes.entries()) {
    await page.getByTestId('palette').locator(`[data-shape="${shape}"]`).click();
    await expect(editor).toBeVisible();
    await editor.press('Enter');
    await expect(node(page, `n${i + 2}`)).toHaveAttribute('data-kind', shape);
    await expect(node(page, `n${i + 2}`)).toHaveAttribute('data-lane', '_unassigned');
  }
  const after = await onDisk(d, (f) => f.mmd.includes('n8@{'));
  for (let i = 2; i <= 8; i++) expect(declaredLane(after.mmd, `n${i}`)).toBe('_unassigned');
  expect(Object.keys(pins(after.layout))).toEqual([]);
  await saved(page);
  await expectMatchesCli(page, d);
});

test('A4b: dragging a shape from the palette onto the canvas adds it pinned at the drop point', async ({ page }, info) => {
  const d = makeDiagram(info, FLOWCHART);
  await open(page, d);
  const t = await viewTransform(page, 'start');
  const cli = d.cliLayout();
  // Below the whole flowchart: empty canvas, outside the diagram's current extent.
  const target = t.toScreen({ x: 260, y: cli.height + 90 });
  const canvas = await canvasBox(page);
  expect(inside(target, canvas)).toBe(true);
  const world = t.toWorld(target);
  const btn = (await page.getByTestId('palette').locator('[data-shape="io"]').boundingBox())!;
  await dragFromTo(page, { x: btn.x + btn.width / 2, y: btn.y + btn.height / 2 }, target);
  await expect(page.getByTestId('label-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  const files = await onDisk(d, (f) => !!pins(f.layout).n1);
  expect(declaredLane(files.mmd, 'n1')).toBe('_unassigned');
  expect(parse(files.mmd).diagram.lanes).toEqual([]);
  await saved(page);
  const n1 = await attrs(node(page, 'n1'));
  expect(n1.pinned).toBe(true);
  expect(n1.lane).toBe('_unassigned');
  // Centred where it was dropped (the lane starts at 0, so the pin is the position).
  expect(Math.abs(n1.x + n1.width / 2 - world.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(n1.y + n1.height / 2 - world.y)).toBeLessThanOrEqual(1);
  expect(pins(files.layout).n1).toEqual({ lane: '_unassigned', along: n1.x, across: n1.y });
  await expectMatchesCli(page, d);
});

test('A4b: dragging a block in a lane-free diagram pins it where dropped, still unlaned', async ({ page }, info) => {
  const d = makeDiagram(info, FLOWCHART);
  await open(page, d);
  const before = await attrs(node(page, 'reorder'));
  const t = await viewTransform(page, 'reorder');
  await dragBy(page, node(page, 'reorder'), 0, 140 * t.z, { alt: true });
  const files = await onDisk(d, (f) => !!pins(f.layout).reorder);
  expect(declaredLane(files.mmd, 'reorder')).toBe('_unassigned');
  await saved(page);
  const after = await attrs(node(page, 'reorder'));
  expect(after.pinned).toBe(true);
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.y - (before.y + 140))).toBeLessThanOrEqual(1);
  expect(pins(files.layout).reorder).toEqual({ lane: '_unassigned', along: after.x, across: after.y });
  await expectMatchesCli(page, d);
});

// ---- (c) Dropping outside lanes ------------------------------------------------------------------------------------

test('A4c: a block dropped below the last lane moves to Unassigned, pinned at the drop, with a highlight while dragging', async ({ page }, info) => {
  const d = makeDiagram(info, LANES);
  await open(page, d);
  await expect(lane(page, '_unassigned')).toHaveCount(0);
  const a2 = await attrs(node(page, 'a2'));
  const t = await viewTransform(page, 'a2');
  const cli = d.cliLayout();
  // Centre 60 px (world) below the bottom of the last lane.
  const dropWorld = { x: a2.x + a2.width / 2 + 30, y: cli.height + 60 };
  const from = t.toScreen({ x: a2.x + a2.width / 2, y: a2.y + a2.height / 2 });
  const to = t.toScreen(dropWorld);
  expect(inside(to, await canvasBox(page))).toBe(true);
  await page.keyboard.down('Alt'); // exactly where dropped: no snapping (UI39)
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  // The "outside lanes" highlight: where the Unassigned lane will appear. No lane is highlighted.
  await expect(page.locator('[data-drop-preview="_unassigned"]')).toBeVisible();
  await expect(page.locator('[data-drop-target="true"]')).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(page.locator('[data-drop-preview]')).toHaveCount(0);
  const files = await onDisk(d, (f) => declaredLane(f.mmd, 'a2') === '_unassigned');
  expect(declaredLane(files.mmd, 'a2')).toBe('_unassigned');
  await saved(page);
  const moved = await attrs(node(page, 'a2'));
  expect(moved.lane).toBe('_unassigned');
  expect(moved.pinned).toBe(true);
  // Exactly where it was dropped, though the Unassigned lane only appeared with it.
  expect(Math.abs(moved.x + moved.width / 2 - dropWorld.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(moved.y + moved.height / 2 - dropWorld.y)).toBeLessThanOrEqual(1);
  const un = d.cliLayout().lanes.find((l) => l.id === '_unassigned')!;
  expect(pins(files.layout).a2).toEqual({ lane: '_unassigned', along: moved.x, across: moved.y - un.y });
  await expect(page.locator('[data-lane-header="_unassigned"]')).toHaveCount(1);
  await expectMatchesCli(page, d);
  // One undo step restores all three files.
  await page.getByTestId('undo').click();
  expect(await onDisk(d, (f) => f.mmd === LANES.mmd && f.layout === null)).toEqual(LANES);
});

test('v1.1: a block dropped beyond the lanes along the flow stays in the lane under it, exactly where dropped', async ({ page }, info) => {
  const d = makeDiagram(info, LANES);
  await open(page, d);
  const b1 = await attrs(node(page, 'b1'));
  const t = await viewTransform(page, 'b1');
  const cli = d.cliLayout();
  // Same height (inside Beta's band), but past the end of the lanes: lanes reach as far along the flow as needed.
  const dropWorld = { x: cli.width + 120, y: b1.y + b1.height / 2 };
  const to = t.toScreen(dropWorld);
  expect(inside(to, await canvasBox(page))).toBe(true);
  const from = t.toScreen({ x: b1.x + b1.width / 2, y: b1.y + b1.height / 2 });
  await dragFromTo(page, from, to, { alt: true });
  const files = await onDisk(d, (f) => !!pins(f.layout).b1);
  expect(declaredLane(files.mmd, 'b1')).toBe('beta');
  await saved(page);
  const moved = await attrs(node(page, 'b1'));
  expect(moved.lane).toBe('beta');
  expect(moved.pinned).toBe(true);
  expect(Math.abs(moved.x + moved.width / 2 - dropWorld.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(moved.y + moved.height / 2 - dropWorld.y)).toBeLessThanOrEqual(1);
  const beta = d.cliLayout().lanes.find((l) => l.id === 'beta')!;
  expect(pins(files.layout).b1).toEqual({ lane: 'beta', along: moved.x, across: moved.y - beta.y });
  await expectMatchesCli(page, d);
});

test('A4c: with Unassigned showing, dropping outside the lanes highlights it and lands there', async ({ page }, info) => {
  const d = makeDiagram(info, { ...LANES, mmd: canon(LANES.mmd + '  loose["Loose end"]\n') });
  await open(page, d);
  const a1 = await attrs(node(page, 'a1'));
  const t = await viewTransform(page, 'a1');
  const cli = d.cliLayout();
  const dropWorld = { x: a1.x + a1.width / 2, y: cli.height + 70 };
  const from = t.toScreen({ x: a1.x + a1.width / 2, y: a1.y + a1.height / 2 });
  const to = t.toScreen(dropWorld);
  expect(inside(to, await canvasBox(page))).toBe(true);
  await page.keyboard.down('Alt'); // exactly where dropped: no snapping (UI39)
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await expect(lane(page, '_unassigned')).toHaveAttribute('data-drop-target', 'true');
  await expect(page.locator('[data-drop-target="true"]')).toHaveCount(1);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const files = await onDisk(d, (f) => declaredLane(f.mmd, 'a1') === '_unassigned');
  await saved(page);
  const moved = await attrs(node(page, 'a1'));
  expect(moved.lane).toBe('_unassigned');
  expect(Math.abs(moved.x + moved.width / 2 - dropWorld.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(moved.y + moved.height / 2 - dropWorld.y)).toBeLessThanOrEqual(1);
  expect(pins(files.layout).a1?.lane).toBe('_unassigned');
  await expectMatchesCli(page, d);
});

test('A4c: a multi-block drag applies the rule per block: outside every lane to Unassigned, the rest by lane', async ({ page }, info) => {
  const d = makeDiagram(info, LANES);
  await open(page, d);
  const cli = d.cliLayout();
  const alpha = cli.lanes.find((l) => l.id === 'alpha')!;
  const beta = cli.lanes.find((l) => l.id === 'beta')!;
  const a1 = await attrs(node(page, 'a1'));
  const b2 = await attrs(node(page, 'b2'));
  // Move both down by Alpha's thickness: a1 lands in Beta, b2 below the last lane.
  const dy = alpha.height;
  expect(a1.y + a1.height / 2 + dy).toBeLessThan(beta.y + beta.height);
  expect(b2.y + b2.height / 2 + dy).toBeGreaterThan(beta.y + beta.height);
  const t = await viewTransform(page, 'a1');
  await node(page, 'a1').click();
  await node(page, 'b2').click({ modifiers: ['Shift'] });
  await expect(node(page, 'b2')).toHaveAttribute('data-selected', 'true');
  const from = t.toScreen({ x: a1.x + a1.width / 2, y: a1.y + a1.height / 2 });
  const to = t.toScreen({ x: a1.x + a1.width / 2, y: a1.y + a1.height / 2 + dy });
  expect(inside(t.toScreen({ x: b2.x, y: b2.y + b2.height + dy }), await canvasBox(page))).toBe(true);
  await dragFromTo(page, from, to, { alt: true });
  const files = await onDisk(d, (f) => declaredLane(f.mmd, 'b2') === '_unassigned' && declaredLane(f.mmd, 'a1') === 'beta');
  expect(declaredLane(files.mmd, 'a1')).toBe('beta');
  expect(declaredLane(files.mmd, 'b2')).toBe('_unassigned');
  expect(pins(files.layout).a1?.lane).toBe('beta');
  expect(pins(files.layout).b2?.lane).toBe('_unassigned');
  await saved(page);
  const b2m = await attrs(node(page, 'b2'));
  expect(Math.abs(b2m.x - b2.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(b2m.y - (b2.y + dy))).toBeLessThanOrEqual(1);
  await expectMatchesCli(page, d);
  // One drag, one undo step.
  await page.getByTestId('undo').click();
  expect(await onDisk(d, (f) => f.mmd === LANES.mmd && f.layout === null)).toEqual(LANES);
});

// ---- (d) New diagram: Flowchart or Swimlanes -------------------------------------------------------------------------

test('A4d: New diagram offers Flowchart (the default) and Swimlanes; Flowchart makes a lane-free diagram', async ({ page }, info) => {
  const name = `Flow ${info.workerIndex} ${Date.now() % 100000}`;
  const file = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.mmd`;
  await page.goto('/');
  await expect(page.getByTestId('diagram-list')).toBeVisible();
  await page.getByRole('button', { name: 'New diagram' }).click();
  await expect(page.getByRole('radio', { name: /Flowchart/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: /Swimlanes/ })).toHaveAttribute('aria-checked', 'false');
  await page.getByLabel('New diagram name').fill(name);
  await page.getByRole('radio', { name: /Swimlanes/ }).click();
  await page.getByRole('radio', { name: /Flowchart/ }).click();
  await expect(page.getByRole('radio', { name: /Flowchart/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(`**/?file=${file}&new=flowchart`);
  const d = new Diagram(file.replace(/\.mmd$/, ''));
  expect(d.read()).toEqual({ mmd: 'flowchart LR\n', config: null, layout: null });
  expect(parse(d.read().mmd).problems.errors).toEqual([]);
  // The hint fits a flowchart: click a shape; no lane nudge.
  const hint = page.locator('.fm-empty-hint');
  await expect(hint).toContainText('Click a shape in the palette to add a block');
  await expect(hint.getByRole('button', { name: 'Add a lane' })).toHaveCount(0);
  await expect(hint).not.toContainText('lane');
  await page.getByTestId('palette').locator('[data-shape="terminal"]').click();
  const editor = page.getByTestId('label-editor');
  await expect(editor).toBeVisible();
  await editor.fill('Start');
  await editor.press('Enter');
  await expect(hint).toHaveCount(0);
  const files = await onDisk(d, (f) => f.mmd.includes('Start'));
  expect(files.mmd).toBe(canon('flowchart LR\n  n1(["Start"])\n'));
  expect(files.layout).toBeNull();
  await expect(page.locator('[data-lane-header]')).toHaveCount(0);
  await expect(node(page, 'n1')).toHaveAttribute('data-lane', '_unassigned');
});

test('A4d: an existing lane-free file opened directly also gets the flowchart hint', async ({ page }, info) => {
  const d = makeDiagram(info, { mmd: 'flowchart TB\n', config: null, layout: null });
  await page.goto(`/?file=${encodeURIComponent(d.file)}`);
  await expect(page.getByTestId('canvas')).toBeVisible();
  const hint = page.locator('.fm-empty-hint');
  await expect(hint).toContainText('Click a shape in the palette to add a block');
  await expect(hint.getByRole('button', { name: 'Add a lane' })).toHaveCount(0);
  // Dragging a shape onto the empty canvas adds it pinned there.
  const canvas = await canvasBox(page);
  const btn = (await page.getByTestId('palette').locator('[data-shape="step"]').boundingBox())!;
  await dragFromTo(page, { x: btn.x + btn.width / 2, y: btn.y + btn.height / 2 }, { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 });
  await expect(page.getByTestId('label-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  const files = await onDisk(d, (f) => !!pins(f.layout).n1);
  expect(declaredLane(files.mmd, 'n1')).toBe('_unassigned');
  expect(pins(files.layout).n1!.lane).toBe('_unassigned');
  await saved(page);
  await expectMatchesCli(page, d);
});

// ---- Style badges never cover the label ------------------------------------------------------------------------------

const BADGED: Files = {
  mmd: canon(`flowchart LR
  a["Go"]
  b{"Extra vendor discount needed?"}
  c(["Vendor rep agrees a discount"])
  d[["Run the monthly vendor reconciliation"]]
  e[("ERP")]
  f[/"Customer purchase order form"/]
  g@{ shape: doc, label: "Vendor quote with the negotiated price" }
  h@{ shape: delay, label: "Vendor rep agrees a discount (portal rarely updated same day)" }
  i["Wait for the vendor to confirm the negotiated discount on every line of the quote before anything is ordered"]
  a --> b
  b -->|yes| c
  c --> d
  d --> e
  e --> f
  f --> g
  g --> h
  h --> i
`),
  config: `version: 1
styles:
  - legend: Waiting on someone
    match: {}
    style:
      badge: wait
  - match:
      id: i
    style:
      badge: needs a second review
`,
  layout: null,
};

for (const theme of ['light', 'dark'] as const) {
  test(`style badges sit clear of every block's label, on all eight shapes (${theme})`, async ({ page }, info) => {
    const d = makeDiagram(info, BADGED);
    await open(page, d);
    if ((await page.getByTestId('canvas').getAttribute('data-theme')) !== theme) await page.getByTestId('theme-toggle').click();
    await expect(page.getByTestId('canvas')).toHaveAttribute('data-theme', theme);
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    await expect(page.locator('[data-role="badge"]')).toHaveCount(ids.length);
    for (const id of ids) {
      const n = node(page, id);
      const badge = n.locator('[data-role="badge"]');
      await expect(badge).toHaveText(id === 'i' ? 'needs a second review' : 'wait');
      const bb = (await badge.boundingBox())!;
      // The label's text as drawn (each line's glyph box), and the label element itself.
      const boxes = await n.locator('[data-role="label"]').evaluate((el) => {
        const out = [el.getBoundingClientRect()];
        for (const line of el.querySelectorAll('.fm-line')) out.push(...Array.from(line.getClientRects()));
        return out.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
      });
      for (const lb of boxes) {
        const hit = bb.x < lb.x + lb.width && lb.x < bb.x + bb.width && bb.y < lb.y + lb.height && lb.y < bb.y + bb.height;
        expect(hit, `${id}: badge ${JSON.stringify(bb)} overlaps label box ${JSON.stringify(lb)}`).toBe(false);
      }
      // The badge text fits its tag.
      const fits = await badge.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(fits, `${id}: badge text overflows`).toBe(true);
      // U10 still holds: the label lies inside the block.
      const nb = (await n.boundingBox())!;
      const lb = boxes[0]!;
      expect(lb.x).toBeGreaterThanOrEqual(nb.x - 0.5);
      expect(lb.y).toBeGreaterThanOrEqual(nb.y - 0.5);
      expect(lb.x + lb.width).toBeLessThanOrEqual(nb.x + nb.width + 0.5);
      expect(lb.y + lb.height).toBeLessThanOrEqual(nb.y + nb.height + 0.5);
    }
    await expectMatchesCli(page, d);
  });
}
