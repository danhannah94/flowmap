// UI34 resize and UI35 block colours (U11, U12; parity P21, P22 and their undo/redo in P30), through the §8.3
// attributes only (`data-resize`, `data-sized`, `block-colors`, `data-prop`/`data-variant`, `swatch`,
// `block-colors-reset`, and the `context-menu` items), checking the files on disk against the same change made by
// hand.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { parse as parseYaml } from 'yaml';
import { labelNeeds } from '../../src/core/measure';
import { format, parse } from '../../src/core/mmd';
import { E2E_DIR } from './env';
import {
  attrs, eventually, expectMatchesCli, makeDiagram, node, open, saved, zoomOf, type Diagram, type Files,
} from './helpers';

const canon = (text: string) => format(parse(text).diagram);

const CONFIG = `version: 1
title: Resize and colours
styles:
  - legend: Waiting on someone
    match: {kind: wait}
    style: {fill: {light: "#fff2cc", dark: "#4a3f12"}, badge: wait}
nodes:
  a1:
    confidence: confirmed   # said twice, keep this comment
  b2:
    kind: wait
`;

/** Two lanes; a1 and b2 pinned (so every handle's result is exact), a2 and b1 placed automatically. */
const RC: Files = {
  mmd: canon(`flowchart LR
  subgraph alpha [Alpha]
    a1["First step"]
    a2["Second step, with a label long enough to wrap"]
  end
  subgraph beta [Beta]
    b1{"Check it?"}
    b2["Wait for it"]
  end
  a1 --> a2
  a2 --> b1
  b1 -->|yes| b2
`),
  config: CONFIG,
  layout: `${JSON.stringify({ version: 1, nodes: { a1: { lane: 'alpha', along: 60, across: 40 }, b2: { lane: 'beta', along: 700, across: 20 } } }, null, 2)}\n`,
};

type Handle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
type Box = { x: number; y: number; width: number; height: number };
type LayoutFile = { version: 1; nodes: Record<string, Record<string, unknown>>; hints?: unknown };

/** Halves toward −∞ (UI34, UI10). */
const round = (v: number) => Math.ceil(v - 0.5) + 0;

const sameFiles = (a: Files, b: Files) => a.mmd === b.mmd && a.config === b.config && a.layout === b.layout;

async function onDisk(d: Diagram, check: (f: Files) => boolean): Promise<Files> {
  return eventually(() => d.read(), check, 2000);
}

/** The layout file as parsed, without `hints` (§10 Part 3 compares it that way). */
function layoutOf(text: string | null): LayoutFile | null {
  if (text === null) return null;
  const j = JSON.parse(text) as LayoutFile;
  delete j.hints;
  return j;
}

/** Undo restores `before` byte for byte; redo re-applies `after` byte for byte (UI28, P30). */
async function expectUndoRedo(page: Page, d: Diagram, before: Files, after: Files): Promise<void> {
  await saved(page);
  await page.getByTestId('undo').click();
  expect(await onDisk(d, (f) => sameFiles(f, before))).toEqual(before);
  await saved(page);
  await page.getByTestId('redo').click();
  expect(await onDisk(d, (f) => sameFiles(f, after))).toEqual(after);
  await saved(page);
}

/** `sub`'s lines appear in `text` in order (untouched config lines survive byte for byte). */
function expectLinesKept(text: string, sub: readonly string[]): void {
  const lines = text.split('\n');
  let i = 0;
  for (const line of sub) {
    while (i < lines.length && lines[i] !== line) i++;
    expect(i, `config line kept: ${JSON.stringify(line)}`).toBeLessThan(lines.length);
    i++;
  }
}

/** The config lines outside the entries of `ids` under `nodes:` (what a colour edit on those blocks must not touch). */
function linesOutside(config: string, ids: readonly string[]): string[] {
  const out: string[] = [];
  let skipping = false;
  for (const line of config.split('\n')) {
    const entry = /^ {2}([\w-]+):/.exec(line);
    if (entry) skipping = ids.includes(entry[1]!);
    else if (!line.startsWith('    ')) skipping = false;
    if (!skipping) out.push(line);
  }
  return out;
}

/** The config's `nodes` map as parsed. */
const nodesOf = (config: string | null) => ((config ? parseYaml(config) : {}) as { nodes?: Record<string, Record<string, unknown>> }).nodes ?? {};

/** Zoom in on the canvas (wheel at a block) so handles and drags are comfortably large. */
async function zoomInOn(page: Page, id: string, ticks = 4): Promise<void> {
  const b = (await node(page, id).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (let i = 0; i < ticks; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(150);
}

async function select(page: Page, id: string): Promise<void> {
  await node(page, id).click();
  await expect(node(page, id)).toHaveAttribute('data-selected', 'true');
  await expect(node(page, id).locator('[data-resize]')).toHaveCount(8);
}

/**
 * Drag a resize handle so the moved edge travels about (wdx, wdy) diagram px, by whole screen pixels. The screen
 * distance is nudged so the edge's new position isn't near a half pixel (where rounding could go either way on a
 * measurement error). Returns the diagram-px delta the UI saw.
 */
async function dragHandle(page: Page, id: string, handle: Handle, wdx: number, wdy: number): Promise<{ dx: number; dy: number; zoom: number }> {
  const zoom = await zoomOf(page, id);
  const a = await attrs(node(page, id));
  const hb = (await node(page, id).locator(`[data-resize="${handle}"]`).boundingBox())!;
  const from = { x: Math.round(hb.x + hb.width / 2), y: Math.round(hb.y + hb.height / 2) };
  const edgeX = handle.includes('e') ? a.x + a.width : a.x;
  const edgeY = handle.includes('s') ? a.y + a.height : a.y;
  const safe = (edge: number, d: number) => Math.abs(((edge + d) % 1 + 1) % 1 - 0.5) > 0.08;
  let sx = Math.round(wdx * zoom);
  let sy = Math.round(wdy * zoom);
  for (let k = 0; k < 20 && !safe(edgeX, sx / zoom); k++) sx += sx >= 0 ? 1 : -1;
  for (let k = 0; k < 20 && !safe(edgeY, sy / zoom); k++) sy += sy >= 0 ? 1 : -1;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 6;
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + (sx * i) / steps, from.y + (sy * i) / steps);
  await page.mouse.up();
  return { dx: sx / zoom, dy: sy / zoom, zoom };
}

/** Where a handle drag puts the box when nothing clamps it (UI34: only the moved edge is rounded). */
function grown(b: Box, handle: Handle, dx: number, dy: number): Box {
  let { x, y, width, height } = b;
  const right = b.x + b.width;
  const bottom = b.y + b.height;
  if (handle.includes('e')) width = round(right + dx) - b.x;
  if (handle.includes('w')) {
    x = round(b.x + dx);
    width = right - x;
  }
  if (handle.includes('s')) height = round(bottom + dy) - b.y;
  if (handle.includes('n')) {
    y = round(b.y + dy);
    height = bottom - y;
  }
  return { x, y, width, height };
}

/**
 * Outward: the direction that grows the block from each handle (plus a little sideways drift that a side ignores).
 * Small enough that a1 (pinned 60 along, 40 across in the first lane) never goes before the diagram's origin.
 */
const OUT: Record<Handle, [number, number]> = {
  n: [9, -10], ne: [26, -8], e: [30, 11], se: [34, 22], s: [-8, 24], sw: [-15, 16], w: [-15, -7], nw: [-10, -8],
};

const box = (a: Box): Box => ({ x: a.x, y: a.y, width: a.width, height: a.height });

// ---------------------------------------------------------------------------------------------------------------
// UI34 Resize

test('every handle resizes its side or corner: the opposite edge stays, width and height are written, top and left move the pin (U11, P21)', async ({ page }, info) => {
  const d = makeDiagram(info, RC);
  await open(page, d);
  await expect(node(page, 'a1')).toHaveAttribute('data-sized', 'false');
  await zoomInOn(page, 'a1');
  await select(page, 'a1');
  let files = d.read();
  for (const handle of ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'] as const) {
    const before = box(await attrs(node(page, 'a1')));
    const [wdx, wdy] = OUT[handle];
    const { dx, dy } = await dragHandle(page, 'a1', handle, wdx, wdy);
    const want = grown(before, handle, dx, dy);
    // The hand edit: a1's entry gets both sizes; its pin follows a moved top or left edge (a1 is in the first lane,
    // whose zero line is the diagram's top while nothing sits above it; along is x while nothing sits left of it).
    const hand = layoutOf(files.layout)!;
    hand.nodes.a1 = { lane: 'alpha', along: want.x, across: want.y, width: want.width, height: want.height };
    const after = await onDisk(d, (f) => JSON.stringify(layoutOf(f.layout)) === JSON.stringify(hand));
    expect(layoutOf(after.layout), `${handle}: layout file`).toEqual(hand);
    expect(after.mmd).toBe(files.mmd);
    expect(after.config).toBe(files.config);
    const now = await attrs(node(page, 'a1'));
    expect(box(now), `${handle}: on the canvas`).toEqual(want);
    // The opposite side or corner didn't move.
    if (!handle.includes('w')) expect(now.x, `${handle}: left edge`).toBe(before.x);
    if (!handle.includes('e')) expect(now.x + now.width, `${handle}: right edge`).toBe(before.x + before.width);
    if (!handle.includes('n')) expect(now.y, `${handle}: top edge`).toBe(before.y);
    if (!handle.includes('s')) expect(now.y + now.height, `${handle}: bottom edge`).toBe(before.y + before.height);
    await expect(node(page, 'a1')).toHaveAttribute('data-sized', 'true');
    await expect(node(page, 'a1')).toHaveAttribute('data-selected', 'true');
    files = after;
  }
  await saved(page);
  await expectMatchesCli(page, d);
});

test('a top or left handle pins a block that wasn’t pinned, in its own lane (P21 from the top-left)', async ({ page }, info) => {
  const d = makeDiagram(info, RC);
  await open(page, d);
  await zoomInOn(page, 'b1', 3);
  await expect(node(page, 'b1')).toHaveAttribute('data-pinned', 'false');
  await select(page, 'b1');
  const before = box(await attrs(node(page, 'b1')));
  // b2 is pinned 20 below beta's start edge: beta's zero line in diagram coordinates.
  const betaZero = (await attrs(node(page, 'b2'))).y - 20;
  const { dx, dy } = await dragHandle(page, 'b1', 'nw', -30, -6);
  const want = grown(before, 'nw', dx, dy);
  const hand = layoutOf(RC.layout)!;
  hand.nodes.b1 = { lane: 'beta', along: want.x, across: want.y - betaZero, width: want.width, height: want.height };
  const after = await onDisk(d, (f) => JSON.stringify(layoutOf(f.layout)) === JSON.stringify(hand));
  expect(layoutOf(after.layout)).toEqual(hand);
  await expect(node(page, 'b1')).toHaveAttribute('data-pinned', 'true');
  expect(box(await attrs(node(page, 'b1')))).toEqual(want);
  await expectUndoRedo(page, d, RC, after);
});

test('right and bottom handles write only the size of an unpinned block (no pin)', async ({ page }, info) => {
  const d = makeDiagram(info, RC);
  await open(page, d);
  await zoomInOn(page, 'a2', 3);
  await select(page, 'a2');
  const before = box(await attrs(node(page, 'a2')));
  const { dx, dy } = await dragHandle(page, 'a2', 'se', 40, 30);
  const want = grown(before, 'se', dx, dy);
  const hand = layoutOf(RC.layout)!;
  hand.nodes.a2 = { width: want.width, height: want.height };
  const after = await onDisk(d, (f) => JSON.stringify(layoutOf(f.layout)) === JSON.stringify(hand));
  expect(layoutOf(after.layout)).toEqual(hand);
  await expect(node(page, 'a2')).toHaveAttribute('data-pinned', 'false');
  const now = await attrs(node(page, 'a2'));
  expect({ width: now.width, height: now.height }).toEqual({ width: want.width, height: want.height });
});

test('the handles stop at the label’s needs: narrowest width, then the height it needs at that width (L9)', async ({ page }, info) => {
  const d = makeDiagram(info, RC);
  await open(page, d);
  await zoomInOn(page, 'a2', 3);
  await select(page, 'a2');
  const label = (await node(page, 'a2').locator('[data-role="label"]').textContent())!.replace(/\s+/g, ' ').trim();
  expect(label).toBe('Second step, with a label long enough to wrap');
  const before = box(await attrs(node(page, 'a2')));
  // Far past the block's own size: the bottom-right corner stops where the label still fits.
  await dragHandle(page, 'a2', 'se', -2000, -2000);
  const needs = labelNeeds(label, 'step', 1);
  const want = { width: needs.minWidth, height: labelNeeds(label, 'step', needs.minWidth).height };
  expect(want.width).toBeGreaterThanOrEqual(40);
  const hand = layoutOf(RC.layout)!;
  hand.nodes.a2 = { ...want };
  const after = await onDisk(d, (f) => JSON.stringify(layoutOf(f.layout)) === JSON.stringify(hand));
  expect(layoutOf(after.layout)).toEqual(hand);
  const now = await attrs(node(page, 'a2'));
  expect({ width: now.width, height: now.height }).toEqual(want);
  expect(now.height).toBeGreaterThan(before.height); // narrower, so the label wraps onto more lines
  // The wrapped label is still inside the block (U10).
  const nb = (await node(page, 'a2').boundingBox())!;
  const lb = (await node(page, 'a2').locator('[data-role="label"]').boundingBox())!;
  expect(lb.x).toBeGreaterThanOrEqual(nb.x - 0.5);
  expect(lb.y).toBeGreaterThanOrEqual(nb.y - 0.5);
  expect(lb.x + lb.width).toBeLessThanOrEqual(nb.x + nb.width + 0.5);
  expect(lb.y + lb.height).toBeLessThanOrEqual(nb.y + nb.height + 0.5);

  // From the top-left instead: the bottom-right corner stays where it is while the top-left stops at the need.
  await expect(node(page, 'a2').locator('[data-resize]')).toHaveCount(8);
  const b1 = box(await attrs(node(page, 'a2')));
  await dragHandle(page, 'a2', 'nw', 2000, 2000);
  const hand2 = layoutOf(after.layout)!;
  hand2.nodes.a2 = { lane: 'alpha', along: b1.x + b1.width - want.width, across: b1.y + b1.height - want.height, ...want };
  const after2 = await onDisk(d, (f) => JSON.stringify(layoutOf(f.layout)) === JSON.stringify(hand2));
  expect(layoutOf(after2.layout)).toEqual(hand2);
  const now2 = await attrs(node(page, 'a2'));
  expect(now2.x + now2.width).toBe(b1.x + b1.width);
  expect(now2.y + now2.height).toBe(b1.y + b1.height);
});

test('handles show on the one selected block only, and never while several are selected', async ({ page }, info) => {
  const d = makeDiagram(info, RC);
  await open(page, d);
  await expect(page.locator('[data-resize]')).toHaveCount(0);
  await node(page, 'a1').click();
  const names = await node(page, 'a1').locator('[data-resize]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.resize));
  expect(names).toEqual(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
  await expect(page.locator('[data-resize]')).toHaveCount(8);
  // Each is at least 10 px on screen at this zoom, with the cursor for its direction.
  for (const h of names) {
    const hb = (await node(page, 'a1').locator(`[data-resize="${h}"]`).boundingBox())!;
    expect(Math.min(hb.width, hb.height), `${h} size`).toBeGreaterThanOrEqual(9.5);
  }
  const cursors = await node(page, 'a1').locator('[data-resize]').evaluateAll((els) => els.map((el) => getComputedStyle(el).cursor));
  expect(cursors).toEqual(['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize']);
  await node(page, 'a2').click({ modifiers: ['Shift'] });
  await expect(page.locator('[data-resize]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-resize]')).toHaveCount(0);
});

test('Escape during a resize cancels it; a click on a handle writes nothing', async ({ page }, info) => {
  const d = makeDiagram(info, RC);
  await open(page, d);
  await zoomInOn(page, 'a1', 3);
  await select(page, 'a1');
  const before = box(await attrs(node(page, 'a1')));
  const hb = (await node(page, 'a1').locator('[data-resize="se"]').boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 60, hb.y + 40, { steps: 4 });
  // The live preview is drawn at the new size while dragging.
  expect((await attrs(node(page, 'a1'))).width).toBeGreaterThan(before.width);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(box(await attrs(node(page, 'a1')))).toEqual(before);
  await node(page, 'a1').locator('[data-resize="e"]').click();
  await page.waitForTimeout(300);
  await saved(page);
  expect(d.read()).toEqual(RC);
  await expect(node(page, 'a1')).toHaveAttribute('data-selected', 'true');
});

test('Reset size (context menu) removes the stored size and keeps the pin; it shows only on a sized block', async ({ page }, info) => {
  const withSizes: Files = {
    ...RC,
    layout: `${JSON.stringify({ version: 1, nodes: {
      a1: { lane: 'alpha', along: 60, across: 40, width: 200, height: 90 },
      a2: { width: 260, height: 80 },
      b2: { lane: 'beta', along: 700, across: 20 },
    } }, null, 2)}\n`,
  };
  const d = makeDiagram(info, withSizes);
  await open(page, d);
  const sized = await page.locator('[data-node-id]').evaluateAll((els) =>
    Object.fromEntries(els.map((el) => [(el as HTMLElement).dataset.nodeId, (el as HTMLElement).dataset.sized])));
  expect(sized).toEqual({ a1: 'true', a2: 'true', b1: 'false', b2: 'false' });
  // Not on a block without a stored size.
  await rightClick(page, node(page, 'b2'));
  await expect(menuItem(page, 'reset-size')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // On a1: its size goes, its pin stays.
  await rightClick(page, node(page, 'a1'));
  await menuItem(page, 'reset-size').click();
  const hand = layoutOf(withSizes.layout)!;
  hand.nodes.a1 = { lane: 'alpha', along: 60, across: 40 };
  const after = await onDisk(d, (f) => JSON.stringify(layoutOf(f.layout)) === JSON.stringify(hand));
  expect(layoutOf(after.layout)).toEqual(hand);
  await expect(node(page, 'a1')).toHaveAttribute('data-sized', 'false');
  await expect(node(page, 'a1')).toHaveAttribute('data-pinned', 'true');
  await expectUndoRedo(page, d, withSizes, after);
  // With several selected, it applies to every selected block with a size: a2's entry (size only) goes entirely.
  await node(page, 'a2').click();
  await node(page, 'b1').click({ modifiers: ['Shift'] });
  await rightClick(page, node(page, 'a2'));
  await menuItem(page, 'reset-size').click();
  const hand2 = layoutOf(after.layout)!;
  delete hand2.nodes.a2;
  const after2 = await onDisk(d, (f) => JSON.stringify(layoutOf(f.layout)) === JSON.stringify(hand2));
  expect(layoutOf(after2.layout)).toEqual(hand2);
  await expect(page.locator('[data-sized="true"]')).toHaveCount(0);
});

test('data-sized follows the layout file, including a size written by hand', async ({ page }, info) => {
  const d = makeDiagram(info, RC);
  await open(page, d);
  await expect(page.locator('[data-sized="true"]')).toHaveCount(0);
  await expect(page.locator('[data-sized="false"]')).toHaveCount(4);
  const layout = layoutOf(RC.layout)!;
  layout.nodes.b1 = { width: 180, height: 100 };
  d.write({ layout: `${JSON.stringify(layout, null, 2)}\n` });
  await expect(node(page, 'b1')).toHaveAttribute('data-sized', 'true');
  await expect(node(page, 'b1')).toHaveAttribute('data-width', '180');
  await expect(node(page, 'b1')).toHaveAttribute('data-height', '100');
  await expect(page.locator('[data-sized="true"]')).toHaveCount(1);
});

test('a resize that creates the layout file is undone by deleting it, and redone byte for byte', async ({ page }, info) => {
  const noLayout: Files = { ...RC, layout: null };
  const d = makeDiagram(info, noLayout);
  await open(page, d);
  await zoomInOn(page, 'a1', 3);
  await select(page, 'a1');
  await dragHandle(page, 'a1', 'se', 40, 20);
  const after = await onDisk(d, (f) => f.layout !== null);
  expect(Object.keys(layoutOf(after.layout)!.nodes)).toEqual(['a1']);
  await expectUndoRedo(page, d, noLayout, after);
});

// ---------------------------------------------------------------------------------------------------------------
// UI35 Block colours

const colors = (page: Page) => page.getByTestId('block-colors');
const colorInput = (scope: Locator, prop: string, variant: 'light' | 'dark') => scope.locator(`[data-prop="${prop}"] [data-variant="${variant}"]`);

async function typeColor(scope: Locator, prop: string, variant: 'light' | 'dark', value: string): Promise<void> {
  const input = colorInput(scope, prop, variant);
  await input.fill(value);
  await input.press('Enter');
}

test('the inspector sets fill, border and text colours, light and dark, as the node’s style (P22)', async ({ page }, info) => {
  const d = makeDiagram(info, RC);
  await open(page, d);
  await node(page, 'a1').click();
  await expect(colors(page)).toBeVisible();
  await typeColor(colors(page), 'fill', 'light', '#FFCC00');
  await onDisk(d, (f) => f.config !== RC.config);
  await typeColor(colors(page), 'fill', 'dark', '#553300');
  await typeColor(colors(page), 'border_color', 'light', '#b85450');
  await typeColor(colors(page), 'text_color', 'light', '#123');
  await typeColor(colors(page), 'text_color', 'dark', '#eeeeee');
  const want = { confidence: 'confirmed', style: { fill: { light: '#ffcc00', dark: '#553300' }, border_color: '#b85450', text_color: { light: '#123', dark: '#eeeeee' } } };
  const after = await onDisk(d, (f) => JSON.stringify(nodesOf(f.config).a1) === JSON.stringify(want));
  // The hand edit: a1 gets a `style` map; nothing else changes (the other lines byte for byte, comment included).
  const hand = parseYaml(RC.config!) as { nodes: Record<string, unknown> };
  hand.nodes.a1 = want;
  expect(parseYaml(after.config!)).toEqual(hand);
  expectLinesKept(after.config!, linesOutside(RC.config!, ['a1']));
  expect(after.config).toContain('confidence: confirmed   # said twice, keep this comment');
  expect(after.mmd).toBe(RC.mmd);
  expect(after.layout).toBe(RC.layout);
  // The inputs show what's written.
  await expect(colorInput(colors(page), 'fill', 'light')).toHaveValue('#ffcc00');
  await expect(colorInput(colors(page), 'border_color', 'dark')).toHaveValue('');
  // `style` is not a field row.
  await expect(page.locator('[data-field="meta.style"]')).toHaveCount(0);
  await expect(page.locator('[data-field="meta.confidence"]')).toHaveCount(1);
  // Emptying the light value clears the property (R5.11), leaving the others.
  await typeColor(colors(page), 'text_color', 'light', '');
  const cleared = await onDisk(d, (f) => !('text_color' in ((nodesOf(f.config).a1?.style as object) ?? {})));
  expect(nodesOf(cleared.config).a1).toEqual({ confidence: 'confirmed', style: { fill: { light: '#ffcc00', dark: '#553300' }, border_color: '#b85450' } });
  await expectUndoRedo(page, d, after, cleared);
});

test('a swatch sets only the fill, to its light and dark values; the others stay (P22)', async ({ page }, info) => {
  const d = makeDiagram(info, RC);
  await open(page, d);
  await node(page, 'b1').click();
  await typeColor(colors(page), 'border_color', 'light', '#334455');
  await onDisk(d, (f) => nodesOf(f.config).b1 !== undefined);
  const before = d.read();
  const swatches = colors(page).getByTestId('swatch');
  expect(await swatches.count()).toBeGreaterThanOrEqual(6);
  const sw = swatches.nth(2);
  const light = (await sw.getAttribute('data-color'))!;
  const dark = (await sw.getAttribute('data-color-dark'))!;
  expect(light).toMatch(/^#[0-9a-f]{6}$/);
  expect(dark).toMatch(/^#[0-9a-f]{6}$/);
  expect(light).not.toBe(dark);
  await sw.click();
  const want = { style: { border_color: '#334455', fill: { light, dark } } };
  const after = await onDisk(d, (f) => JSON.stringify(nodesOf(f.config).b1) === JSON.stringify(want));
  expect(nodesOf(after.config).b1).toEqual(want);
  expectLinesKept(after.config!, linesOutside(before.config!, ['b1']));
  await expect(sw).toHaveAttribute('aria-pressed', 'true');
  await expectUndoRedo(page, d, before, after);
  // Every swatch has a distinct pair of valid colours.
  const pairs = await swatches.evaluateAll((els) => els.map((el) => `${(el as HTMLElement).dataset.color}/${(el as HTMLElement).dataset.colorDark}`));
  expect(new Set(pairs).size).toBe(pairs.length);
});

test('with several blocks selected, the colours apply to all of them, in declaration order (R10.1, P22)', async ({ page }, info) => {
  const d = makeDiagram(info, RC);
  await open(page, d);
  await node(page, 'b2').click();
  await node(page, 'a2').click({ modifiers: ['Shift'] });
  await node(page, 'b1').click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-count', '3');
  await expect(page.getByTestId('field-key')).toBeVisible(); // the field form is still there
  await expect(colors(page)).toBeVisible();
  await colors(page).getByTestId('swatch').nth(1).click();
  const sw = colors(page).getByTestId('swatch').nth(1);
  const fill = { light: (await sw.getAttribute('data-color'))!, dark: (await sw.getAttribute('data-color-dark'))! };
  await onDisk(d, (f) => nodesOf(f.config).b1 !== undefined);
  await typeColor(colors(page), 'text_color', 'light', '#0000ff');
  const after = await onDisk(d, (f) => JSON.stringify(nodesOf(f.config).b1) === JSON.stringify({ style: { fill, text_color: '#0000ff' } }));
  const nodes = nodesOf(after.config);
  expect(nodes.a2).toEqual({ style: { fill, text_color: '#0000ff' } });
  expect(nodes.b1).toEqual({ style: { fill, text_color: '#0000ff' } });
  expect(nodes.b2).toEqual({ kind: 'wait', style: { fill, text_color: '#0000ff' } });
  expect(nodes.a1).toEqual({ confidence: 'confirmed' });
  // New entries go at the end of `nodes`, in file declaration order (§8.2 "Order"): a2 before b1.
  const keys = Object.keys(nodes);
  expect(keys.indexOf('a2')).toBeLessThan(keys.indexOf('b1'));
  // Mixed values show as mixed; reset clears all three blocks' colours (and a2's and b1's entries with them).
  await node(page, 'a1').click({ modifiers: ['Shift'] });
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-count', '4');
  await expect(colorInput(colors(page), 'fill', 'light')).toHaveAttribute('placeholder', 'mixed');
  await colors(page).getByTestId('block-colors-reset').click();
  const reset = await onDisk(d, (f) => nodesOf(f.config).b1 === undefined);
  expect(parseYaml(reset.config!)).toEqual(parseYaml(RC.config!));
  await expectUndoRedo(page, d, after, reset);
});

test('Reset colours removes only fill, border and text colour; other style properties written by hand stay (UI35)', async ({ page }, info) => {
  const handStyled: Files = {
    ...RC,
    config: CONFIG.replace('    kind: wait\n', '    kind: wait\n    style: {fill: "#fff2cc", border_style: dashed, text_color: {light: "#111", dark: "#eee"}, badge: late}\n'),
  };
  const d = makeDiagram(info, handStyled);
  await open(page, d);
  await node(page, 'b2').click();
  await expect(colorInput(colors(page), 'fill', 'light')).toHaveValue('#fff2cc');
  await expect(colorInput(colors(page), 'text_color', 'dark')).toHaveValue('#eee');
  await expect(page.locator('[data-field="meta.style"]')).toHaveCount(0);
  await colors(page).getByTestId('block-colors-reset').click();
  const after = await onDisk(d, (f) => f.config !== handStyled.config);
  expect(nodesOf(after.config).b2).toEqual({ kind: 'wait', style: { border_style: 'dashed', badge: 'late' } });
  expectLinesKept(after.config!, linesOutside(handStyled.config!, ['b2']));
  await expect(colors(page).getByTestId('block-colors-reset')).toBeDisabled();
  await expectUndoRedo(page, d, handStyled, after);
});

test('the field form refuses the key "style"; the node YAML still shows it', async ({ page }, info) => {
  const d = makeDiagram(info, RC);
  await open(page, d);
  await node(page, 'a1').click();
  await colors(page).getByTestId('swatch').first().click();
  const styled = await onDisk(d, (f) => f.config !== RC.config);
  await expect(page.getByTestId('node-yaml')).toHaveValue(/style:/);
  await page.getByTestId('add-field').click();
  await page.getByTestId('field-key').fill('style');
  await page.getByTestId('field-value').fill('red');
  await page.getByTestId('field-save').click();
  await expect(page.locator('.fm-ev-form-error')).toContainText('colours');
  await page.waitForTimeout(300);
  await saved(page);
  expect(d.read()).toEqual(styled);
});

test('the block context menu: colours inside the menu, swatches, reset colours only when there are colours (U12, UI40)', async ({ page }, info) => {
  const d = makeDiagram(info, RC);
  await open(page, d);
  await rightClick(page, node(page, 'a2'));
  await expect(menuItem(page, 'reset-colors')).toHaveCount(0);
  await menuItem(page, 'colors').click();
  const menu = page.getByTestId('context-menu');
  await typeColor(menu, 'fill', 'light', '#ddeeff');
  await typeColor(menu, 'fill', 'dark', '#223344');
  const after = await onDisk(d, (f) => JSON.stringify(nodesOf(f.config).a2) === JSON.stringify({ style: { fill: { light: '#ddeeff', dark: '#223344' } } }));
  expect(nodesOf(after.config).a2).toEqual({ style: { fill: { light: '#ddeeff', dark: '#223344' } } });
  // Swatches in the menu too.
  const sw = menu.getByTestId('swatch').last();
  const fill = { light: (await sw.getAttribute('data-color'))!, dark: (await sw.getAttribute('data-color-dark'))! };
  await sw.click();
  await onDisk(d, (f) => JSON.stringify(nodesOf(f.config).a2) === JSON.stringify({ style: { fill } }));
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  // Now reset-colors shows; on a1 and a2 selected together it resets both.
  await node(page, 'a1').click();
  await node(page, 'a2').click({ modifiers: ['Shift'] });
  await rightClick(page, node(page, 'a2'));
  await menuItem(page, 'reset-colors').click();
  const reset = await onDisk(d, (f) => nodesOf(f.config).a2 === undefined);
  expect(parseYaml(reset.config!)).toEqual(parseYaml(RC.config!));
});

test('block colours draw on the canvas in both themes and in the SVG export', async ({ page }, info) => {
  const d = makeDiagram(info, RC);
  await open(page, d);
  await node(page, 'a1').click();
  await typeColor(colors(page), 'fill', 'light', '#ffcc00');
  await typeColor(colors(page), 'fill', 'dark', '#553300');
  await typeColor(colors(page), 'border_color', 'light', '#ff0000');
  await typeColor(colors(page), 'text_color', 'light', '#00ff00');
  await typeColor(colors(page), 'text_color', 'dark', '#aabbcc');
  await onDisk(d, (f) => (nodesOf(f.config).a1?.style as Record<string, unknown> | undefined)?.text_color !== undefined);
  await saved(page);
  const paint = () => node(page, 'a1').evaluate((el) => {
    // The block's shape (not the selection halo, which has no fill).
    const shape = [...el.querySelectorAll('svg rect, svg polygon, svg path')].find((s) => s.getAttribute('fill') !== 'none')!;
    const label = el.querySelector('[data-role="label"]') as HTMLElement;
    return { fill: shape.getAttribute('fill'), stroke: shape.getAttribute('stroke'), text: getComputedStyle(label).color };
  });
  const theme = await page.getByTestId('canvas').getAttribute('data-theme');
  const lightPaint = { fill: '#ffcc00', stroke: '#ff0000', text: 'rgb(0, 255, 0)' };
  const darkPaint = { fill: '#553300', stroke: '#ff0000', text: 'rgb(170, 187, 204)' };
  expect(await paint()).toEqual(theme === 'dark' ? darkPaint : lightPaint);
  await page.getByTestId('theme-toggle').click();
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-theme', theme === 'dark' ? 'light' : 'dark');
  expect(await paint()).toEqual(theme === 'dark' ? lightPaint : darkPaint);
  // The export (light theme by default, UI32) carries them as §7.1 attributes.
  await page.getByTestId('export-svg').click();
  await expect(page.getByTestId('export-path')).toHaveText(new RegExp(`exports/${d.base}\\.svg$`), { timeout: 15_000 });
  const svg = readFileSync(join(E2E_DIR, 'exports', `${d.base}.svg`), 'utf8');
  const g = new RegExp(`<g[^>]*data-node-id="a1"[^>]*>([\\s\\S]*?)</g>`).exec(svg)?.[1] ?? '';
  expect(g).toMatch(/fill="#ffcc00"/);
  expect(g).toMatch(/stroke="#ff0000"/);
  expect(g).toMatch(/<text[^>]*fill="#00ff00"/);
});

// ---------------------------------------------------------------------------------------------------------------
// Context menu helpers

const menuItem = (page: Page, name: string) => page.getByTestId('context-menu').locator(`[data-menu-item="${name}"]`);

async function rightClick(page: Page, at: Locator): Promise<void> {
  const b = (await at.boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
}
