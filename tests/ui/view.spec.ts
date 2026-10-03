// Viewing (UI1–UI5; U1, U9, U10).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { attrs, expectMatchesCli, makeDiagram, node, open, PR, zoomOf } from './helpers';

const SHOTS = join(import.meta.dirname, '../../test-results/screenshots');

test('home page lists the diagrams and opens one', async ({ page }, info) => {
  const d = makeDiagram(info);
  await page.goto('/');
  const list = page.getByTestId('diagram-list');
  await expect(list.locator('[data-file="purchase-request.mmd"]')).toBeVisible();
  await list.locator(`[data-file="${d.file}"]`).click();
  await expect(page).toHaveURL(new RegExp(`\\?file=${d.file}`));
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(node(page, 'r01')).toBeVisible();
});

test('renders title, lanes, nodes, edges and legend with the CLI layout to the pixel', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const canvas = page.getByTestId('canvas');
  await expect(canvas).toHaveAttribute('data-direction', 'LR');
  await expect(canvas).toHaveAttribute('data-theme', /^(light|dark)$/);
  await expect(page.getByTestId('title')).toHaveText('Purchase request approval (current state, synthetic)');
  await expectMatchesCli(page, d);
  for (const id of ['requester', 'manager', 'purchasing', 'finance', 'vendor']) {
    await expect(page.locator(`[data-lane-id="${id}"] [data-lane-header="${id}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-lane-header="purchasing"]')).toHaveText('Purchasing');
  expect((await attrs(node(page, 'closed'))).pinned).toBe(true);
  expect((await attrs(node(page, 'intake'))).pinned).toBe(false);
  // Edge labels are inside their edge element.
  await expect(page.locator('[data-edge-id="p02->p03"]')).toContainText('no');
  // Legend: one item per rule with legend text, in rule order.
  await expect(page.getByTestId('legend').getByTestId('legend-item')).toHaveCount(7);
  await expect(page.getByTestId('legend-item').first()).toContainText('Confirmed by two or more people');
  // Handles and labels.
  // v1.1 (UI38): four connection handles, top, right, bottom, left; no target handle.
  expect(await node(page, 'r01').locator('[data-handle="source"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.port))).toEqual(['top', 'right', 'bottom', 'left']);
  await expect(node(page, 'r01').locator('[data-handle="target"]')).toHaveCount(0);
  await expect(node(page, 'r01').locator('[data-role="label"]')).toHaveText('Fill the purchase request form');
  await expect(page.getByTestId('save-status')).toHaveText('saved');
});

test('every label box lies inside its node box (U10), and all eight shapes render', async ({ page }, info) => {
  const d = makeDiagram(info, {
    mmd: `flowchart LR
  subgraph a [All shapes]
    s1["A step with a fairly long label that has to wrap onto several lines"]
    s2{"Is this a long question that wraps?"}
    s3(["Start or end"])
    s4[["A subprocess mapped elsewhere"]]
    s5[("ERP system")]
    s6[/"Input or output"/]
    s7@{ shape: doc, label: "A document with a long name" }
    s8@{ shape: delay, label: "Waiting on the vendor for a while" }
    s9["Supercalifragilisticexpialidocious-and-then-some-more"]
  end
  s1 --> s2
  s2 -->|yes| s3
  s2 -->|no| s4
  s4 --> s5 --> s6 --> s7 --> s8 --> s9
`,
    config: 'version: 1\nstyles:\n  - match: {id: s3}\n    style: {font_style: bold}\n  - match: {id: s4}\n    style: {font_style: italic}\n',
    layout: null,
  });
  await open(page, d);
  for (const kind of ['step', 'decision', 'terminal', 'subprocess', 'database', 'io', 'document', 'delay']) {
    await expect(page.locator(`[data-kind="${kind}"]`).first()).toBeVisible();
  }
  // Check at the fit zoom and at 100%.
  for (const zoomTo100 of [false, true]) {
    if (zoomTo100) await page.locator('.fm-zoom-level').click();
    const boxes = await page.locator('[data-node-id]').evaluateAll((els) =>
      els.map((el) => {
        const n = el.getBoundingClientRect();
        const l = el.querySelector('[data-role="label"]')!.getBoundingClientRect();
        return { id: (el as HTMLElement).dataset.nodeId, n: [n.left, n.top, n.right, n.bottom] as const, l: [l.left, l.top, l.right, l.bottom] as const };
      }),
    );
    for (const b of boxes) {
      const eps = 0.5;
      expect(b.l[0], `${b.id} left`).toBeGreaterThanOrEqual(b.n[0] - eps);
      expect(b.l[1], `${b.id} top`).toBeGreaterThanOrEqual(b.n[1] - eps);
      expect(b.l[2], `${b.id} right`).toBeLessThanOrEqual(b.n[2] + eps);
      expect(b.l[3], `${b.id} bottom`).toBeLessThanOrEqual(b.n[3] + eps);
    }
  }
  await expect(node(page, 's9').locator('[data-role="label"]')).toHaveText('Supercalifragilisticexpialidocious-and-then-some-more');
  await expectMatchesCli(page, d);
});

test('theme follows the system, and the toggle switches data-theme', async ({ browser }, info) => {
  const d = makeDiagram(info);
  mkdirSync(SHOTS, { recursive: true });
  for (const scheme of ['dark', 'light'] as const) {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await open(page, d);
    const canvas = page.getByTestId('canvas');
    await expect(canvas).toHaveAttribute('data-theme', scheme);
    await page.screenshot({ path: join(SHOTS, `editor-${scheme}.png`) });
    // A closer look: select a block and zoom to 100% around it.
    await node(page, 'p02').click();
    await page.locator('.fm-zoom-level').click();
    const box = (await node(page, 'p02').boundingBox())!;
    await page.mouse.move(box.x, box.y);
    await page.screenshot({ path: join(SHOTS, `editor-${scheme}-100.png`) });
    await page.getByTestId('theme-toggle').click();
    const other = scheme === 'dark' ? 'light' : 'dark';
    await expect(canvas).toHaveAttribute('data-theme', other);
    // The override sticks across a reload.
    await page.reload();
    await expect(page.getByTestId('canvas')).toHaveAttribute('data-theme', other);
    await ctx.close();
  }
});

test('config colours follow the theme ({light, dark})', async ({ browser }, info) => {
  const d = makeDiagram(info);
  const ctx = await browser.newContext({ colorScheme: 'light' });
  const page = await ctx.newPage();
  await open(page, d);
  const fill = () => node(page, 'p07').locator('svg rect, svg polygon, svg path').first().getAttribute('fill');
  expect(await fill()).toBe('#dae8fc');
  await page.getByTestId('theme-toggle').click();
  expect(await fill()).toBe('#1e3a5f');
  await ctx.close();
});

// A11: a plain drag on the background draws a selection box (multiselect.spec.ts); Space+drag pans, from anywhere.
// A14: a trackpad's two-finger scroll pans too (trackpad-nav.spec.ts has the classifier's edge cases).
test('pan with Space+drag, zoom with the wheel, fit', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const z0 = await zoomOf(page, 'r01');
  const b0 = (await node(page, 'r01').boundingBox())!;
  // Pan: hold Space and drag an empty spot of the canvas.
  const canvas = (await page.getByTestId('canvas').boundingBox())!;
  const from = { x: canvas.x + canvas.width - 150, y: canvas.y + 40 };
  await page.mouse.move(from.x, from.y);
  await page.keyboard.down(' ');
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-space-pan', 'true');
  await page.mouse.down();
  await page.mouse.move(from.x - 60, from.y + 30, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  await expect(page.getByTestId('canvas')).not.toHaveAttribute('data-space-pan', 'true');
  const b1 = (await node(page, 'r01').boundingBox())!;
  expect(Math.round(b1.x - b0.x)).toBe(-60);
  expect(Math.round(b1.y - b0.y)).toBe(30);
  // Zoom in with the wheel.
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => zoomOf(page, 'r01')).toBeGreaterThan(z0 * 1.2);
  // Pinch (Ctrl+wheel) zooms too.
  const z1 = await zoomOf(page, 'r01');
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 40);
  await page.keyboard.up('Control');
  await expect.poll(() => zoomOf(page, 'r01')).toBeLessThan(z1);
  // A14: a trackpad's two-finger scroll (sideways motion in pixel mode) pans instead, leaving the scale alone.
  const z2 = await zoomOf(page, 'r01');
  const b2 = (await node(page, 'r01').boundingBox())!;
  await page.mouse.wheel(20, -15);
  const b3 = (await node(page, 'r01').boundingBox())!;
  expect(Math.round(b3.x - b2.x)).toBe(-20);
  expect(Math.round(b3.y - b2.y)).toBe(15);
  expect(await zoomOf(page, 'r01')).toBeCloseTo(z2, 5);
  // Fit brings the whole diagram back into view.
  await page.getByTestId('fit').click();
  await expect.poll(() => zoomOf(page, 'r01')).toBeCloseTo(z0, 3);
  for (const id of ['intake', 'f04', 'v02']) {
    const b = (await node(page, id).boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(canvas.x);
    expect(b.x + b.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  }
  // Nothing on disk changed.
  expect(d.read()).toEqual(PR);
});

test('a 100-node diagram opens in under 2 s', async ({ page }, info) => {
  const lanes = ['sales', 'ops', 'finance', 'it', 'legal'];
  const shapes = [(i: string, l: string) => `${i}["${l}"]`, (i: string, l: string) => `${i}{"${l}?"}`, (i: string, l: string) => `${i}(["${l}"])`, (i: string, l: string) => `${i}[("${l}")]`];
  const words = ['check', 'the', 'order', 'send', 'quote', 'approve', 'invoice', 'ship', 'review', 'contract', 'update', 'ERP'];
  let mmd = 'flowchart LR\n';
  const nodesByLane = new Map<string, string[]>();
  for (let i = 0; i < 100; i++) {
    const l = lanes[(i * 7 + (i >> 2)) % lanes.length]!;
    const label = Array.from({ length: 2 + (i % 5) }, (_, k) => words[(i * 3 + k * 5) % words.length]).join(' ');
    nodesByLane.set(l, [...(nodesByLane.get(l) ?? []), shapes[i % shapes.length]!(`n${i}`, label)]);
  }
  for (const l of lanes) mmd += `\n  subgraph ${l} [${l.toUpperCase()}]\n${nodesByLane.get(l)!.map((s) => `    ${s}`).join('\n')}\n  end\n`;
  mmd += '\n';
  for (let i = 1; i < 100; i++) mmd += `  n${Math.max(0, i - 1 - (i % 3 === 0 ? 2 : 0))} --> n${i}\n`;
  const d = makeDiagram(info, { mmd, config: null, layout: null });
  const t0 = Date.now();
  await page.goto(`/?file=${d.file}`);
  await expect(page.locator('[data-node-id]')).toHaveCount(100);
  const elapsed = Date.now() - t0;
  info.annotations.push({ type: 'open-100-ms', description: String(elapsed) });
  expect(elapsed).toBeLessThan(2000);
  await expectMatchesCli(page, d);
  // Dragging stays smooth (UI5): with every block selected, each pointer move is handled well inside a frame.
  await page.keyboard.press('ControlOrMeta+a');
  const box = (await page.locator('[data-node-id="n50"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2);
  const frames = await page.evaluate(async () => {
    const times: number[] = [];
    let last = performance.now();
    await new Promise<void>((done) => {
      const tick = (t: number) => {
        times.push(t - last);
        last = t;
        if (times.length < 30) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    return times;
  });
  const t1 = Date.now();
  for (let i = 1; i <= 30; i++) await page.mouse.move(box.x + box.width / 2 + 5 + i * 4, box.y + box.height / 2 + i);
  const perMove = (Date.now() - t1) / 30;
  await page.mouse.up();
  info.annotations.push({ type: 'drag-100-ms-per-move', description: perMove.toFixed(1) });
  expect(frames.length).toBe(30);
  expect(perMove).toBeLessThan(40);
});

// UI2: a long legend wraps into rows under the diagram (as the export's does), so it stays in view after Fit; a diagram
// with no legend entries draws no legend at all.
test('a long legend wraps under the diagram and Fit brings all of it into view; no entries, no legend', async ({ page }, info) => {
  const rules = Array.from({ length: 14 }, (_, i) => `  - match: {id: a}\n    legend: "Legend entry number ${i}"\n    style: {fill: "#ffeeaa"}`).join('\n');
  const d = makeDiagram(info, { mmd: 'flowchart LR\n  a["A"] --> b["B"]\n', config: `version: 1\nstyles:\n${rules}\n`, layout: null });
  await open(page, d);
  const items = page.getByTestId('legend-item');
  await expect(items).toHaveCount(14);
  const canvas = (await page.getByTestId('canvas').boundingBox())!;
  const boxes = await items.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
  const lanes = (await page.locator('[data-node-id="b"]').boundingBox())!;
  // More than one row, and no entry runs past the diagram's right-hand side by more than one entry's width.
  expect(new Set(boxes.map((b) => Math.round(b.top))).size).toBeGreaterThan(1);
  for (const b of boxes) {
    expect(b.left).toBeGreaterThanOrEqual(canvas.x);
    expect(b.right).toBeLessThanOrEqual(canvas.x + canvas.width);
    expect(b.bottom).toBeLessThanOrEqual(canvas.y + canvas.height);
  }
  expect(Math.max(...boxes.map((b) => b.right))).toBeLessThan(lanes.x + lanes.width + 400);

  const empty = makeDiagram(info, { mmd: 'flowchart LR\n  a["A"] --> b["B"]\n', config: null, layout: null });
  await open(page, empty);
  await expect(page.getByTestId('legend')).toHaveCount(0);
});

// A11: Space+drag pans from anywhere, also when the press lands on a handle that takes its own drags (a lane's size or
// length handle, a block's resize handle); nothing is resized and no file changes.
test('Space+drag starting on a lane size, lane length or block resize handle pans instead of resizing', async ({ page }, info) => {
  const d = makeDiagram(info);
  const before = d.read();
  await open(page, d);
  const handles = [
    page.locator('[data-lane-resize="requester"]'),
    page.locator('[data-lane-length-resize]'),
    node(page, 'r01').locator('[data-resize="se"]'), // shown once the block is selected (below)
  ];
  for (const h of handles) {
    // The block's resize handles show once it's selected (last, as the inspector then covers the right-hand side).
    if (h === handles[2]) await node(page, 'r01').click();
    await expect(h).toHaveCount(1);
    const box = (await h.boundingBox())!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const n0 = (await node(page, 'r01').boundingBox())!;
    await page.mouse.move(from.x, from.y);
    await page.keyboard.down(' ');
    await expect(page.getByTestId('canvas')).toHaveAttribute('data-space-pan', 'true');
    await page.mouse.down();
    await page.mouse.move(from.x - 40, from.y - 30, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up(' ');
    const n1 = (await node(page, 'r01').boundingBox())!;
    expect(Math.round(n1.x - n0.x)).toBe(-40);
    expect(Math.round(n1.y - n0.y)).toBe(-30);
    expect(Math.round(n1.width)).toBe(Math.round(n0.width)); // not resized
    expect(Math.round(n1.height)).toBe(Math.round(n0.height));
  }
  await page.waitForTimeout(400); // a resize would have been written by now
  expect(d.read()).toEqual(before);
});
