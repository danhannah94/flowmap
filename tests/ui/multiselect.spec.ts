// A11 multi-select: Shift- and Cmd/Ctrl-click toggle, a drag on the background draws a selection box (Shift adds),
// dragging a selected block moves the group (each block to the lane under its own centre), arrow keys nudge the
// group, Delete removes it, each as one undo step; Cmd/Ctrl+A selects every block; Space+drag pans.
import { expect, test, type Page } from '@playwright/test';
import { attrs, declaredLane, dragFromTo, emptyPointInLane, lane, makeDiagram, node, open, pins, saved, settled, type Diagram, type Files } from './helpers';

const MULTI: Files = {
  mmd: `flowchart LR

  subgraph top [Top]
    a["Alpha"]
    b["Beta"]
  end

  subgraph bottom [Bottom]
    c["Gamma"]
    d{"Delta?"}
  end

  a -->|go| b
  a --> c
  b --> d
  c --> d
`,
  config: 'version: 1\ntitle: Multi\nnodes:\n  a:\n    owner: sam\n',
  layout: `${JSON.stringify({
    version: 1,
    nodes: {
      a: { lane: 'top', along: 120, across: 40 },
      b: { lane: 'top', along: 420, across: 40 },
      c: { lane: 'bottom', along: 120, across: 40 },
      d: { lane: 'bottom', along: 420, across: 40 },
    },
  }, null, 2)}\n`,
};

const selected = (page: Page) => page.locator('[data-node-id][data-selected="true"]');
const selectedIds = (page: Page) => selected(page).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.nodeId!).sort());
const sameFiles = (a: Files, b: Files) => a.mmd === b.mmd && a.config === b.config && a.layout === b.layout;

async function box(page: Page, id: string) {
  return (await node(page, id).boundingBox())!;
}

/** Zoom to 100% so screen pixels are diagram pixels. */
async function zoom100(page: Page): Promise<void> {
  await page.locator('.fm-zoom-level').click();
  await expect.poll(async () => (await box(page, 'a')).width / (await attrs(node(page, 'a'))).width).toBeCloseTo(1, 2);
}

async function undoTo(page: Page, d: Diagram, want: Files): Promise<void> {
  await saved(page);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await settled(page, d, (f) => sameFiles(f, want))).toEqual(want);
}

test('click selects one; Shift-click and Cmd/Ctrl-click add and remove; the inspector says how many', async ({ page }, info) => {
  const d = makeDiagram(info, MULTI);
  await open(page, d);
  await node(page, 'a').click();
  expect(await selectedIds(page)).toEqual(['a']);
  await node(page, 'b').click({ modifiers: ['Shift'] });
  await node(page, 'c').click({ modifiers: ['ControlOrMeta'] });
  expect(await selectedIds(page)).toEqual(['a', 'b', 'c']);
  await expect(page.getByTestId('inspector')).toHaveAttribute('data-count', '3');
  await expect(page.getByTestId('selection-count')).toHaveText('3 blocks selected');
  // Cmd/Ctrl-click and Shift-click on a selected block take it out.
  await node(page, 'b').click({ modifiers: ['ControlOrMeta'] });
  expect(await selectedIds(page)).toEqual(['a', 'c']);
  await node(page, 'a').click({ modifiers: ['Shift'] });
  expect(await selectedIds(page)).toEqual(['c']);
  // The single-block inspector is back for one block.
  await expect(page.getByTestId('inspector')).not.toHaveAttribute('data-count', /.*/);
  await expect(page.getByTestId('inspector').locator('[data-field="id"]')).toHaveText('c');
  // A plain click selects just that block.
  await node(page, 'b').click({ modifiers: ['Shift'] });
  await node(page, 'd').click();
  expect(await selectedIds(page)).toEqual(['d']);
  // A Shift-click on the background keeps the selection; a plain click clears it; nothing on disk changed.
  const bg = await emptyPointInLane(page, 'top');
  await page.keyboard.down('Shift');
  await page.mouse.click(bg.x, bg.y);
  await page.keyboard.up('Shift');
  expect(await selectedIds(page)).toEqual(['d']);
  await page.mouse.click(bg.x, bg.y);
  expect(await selectedIds(page)).toEqual([]);
  expect(d.read()).toEqual(MULTI);
});

test('a drag on the background draws a selection box (it no longer pans); Shift+drag adds to the selection', async ({ page }, info) => {
  const d = makeDiagram(info, MULTI);
  await open(page, d);
  await node(page, 'd').click();
  const a = await box(page, 'a');
  const b = await box(page, 'b');
  // Around a and b (both wholly inside), from the empty top-left of a.
  await dragFromTo(page, { x: a.x - 12, y: a.y - 12 }, { x: b.x + b.width + 12, y: b.y + b.height + 12 });
  expect(await selectedIds(page)).toEqual(['a', 'b']);
  // The view didn't move.
  expect(await box(page, 'a')).toEqual(a);
  // A box that only touches c selects nothing more (blocks must be wholly inside); Shift adds.
  const c = await box(page, 'c');
  await dragFromTo(page, { x: c.x - 12, y: c.y - 12 }, { x: c.x + c.width / 2, y: c.y + c.height + 12 }, { shift: true });
  expect(await selectedIds(page)).toEqual(['a', 'b']);
  await dragFromTo(page, { x: c.x - 12, y: c.y - 12 }, { x: c.x + c.width + 12, y: c.y + c.height + 12 }, { shift: true });
  expect(await selectedIds(page)).toEqual(['a', 'b', 'c']);
  // Without Shift a new box replaces the selection.
  await dragFromTo(page, { x: c.x - 12, y: c.y - 12 }, { x: c.x + c.width + 12, y: c.y + c.height + 12 });
  expect(await selectedIds(page)).toEqual(['c']);
  // Cmd/Ctrl+A selects every block (and no line); Escape clears.
  await page.keyboard.press('ControlOrMeta+a');
  expect(await selectedIds(page)).toEqual(['a', 'b', 'c', 'd']);
  await expect(page.locator('[data-edge-id][data-selected="true"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(await selectedIds(page)).toEqual([]);
  expect(d.read()).toEqual(MULTI);
});

test('Space+drag pans from anywhere, even over a block; the middle button pans too', async ({ page }, info) => {
  const d = makeDiagram(info, MULTI);
  await open(page, d);
  const a0 = await box(page, 'a');
  await page.mouse.move(a0.x + a0.width / 2, a0.y + a0.height / 2);
  await page.keyboard.down(' ');
  await page.mouse.down();
  await page.mouse.move(a0.x + a0.width / 2 + 50, a0.y + a0.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  const a1 = await box(page, 'a');
  expect(Math.round(a1.x - a0.x)).toBe(50);
  expect(Math.round(a1.y - a0.y)).toBe(20);
  const bg = (await lane(page, 'bottom').boundingBox())!;
  await page.mouse.move(bg.x + bg.width - 40, bg.y + bg.height / 2);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(bg.x + bg.width - 70, bg.y + bg.height / 2, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  expect(Math.round((await box(page, 'a')).x - a1.x)).toBe(-30);
  expect(await selectedIds(page)).toEqual([]);
  expect(d.read()).toEqual(MULTI); // the view moved, not the blocks
});

test('dragging a selected block moves the whole group, keeping offsets; one undo step', async ({ page }, info) => {
  const d = makeDiagram(info, MULTI);
  await open(page, d);
  await zoom100(page);
  await node(page, 'a').click();
  await node(page, 'b').click({ modifiers: ['Shift'] });
  const a = await box(page, 'a');
  // Alt: no snapping (UI39), so the drop is exactly where the pointer put it.
  await dragFromTo(page, { x: a.x + a.width / 2, y: a.y + a.height / 2 }, { x: a.x + a.width / 2 + 60, y: a.y + a.height / 2 + 10 }, { alt: true });
  const f = await settled(page, d, (x) => pins(x.layout).a?.along === 180);
  expect(pins(f.layout).a).toEqual({ lane: 'top', along: 180, across: 50 });
  expect(pins(f.layout).b).toEqual({ lane: 'top', along: 480, across: 50 });
  expect(f.mmd).toBe(MULTI.mmd);
  expect(await selectedIds(page)).toEqual(['a', 'b']);
  await undoTo(page, d, MULTI);
});

test('a group drag across lanes: each block lands in the lane under its own centre', async ({ page }, info) => {
  const d = makeDiagram(info, MULTI);
  await open(page, d);
  await zoom100(page);
  await node(page, 'a').click();
  await node(page, 'c').click({ modifiers: ['Shift'] });
  const a = await box(page, 'a');
  const top = (await lane(page, 'top').boundingBox())!;
  const bottom = (await lane(page, 'bottom').boundingBox())!;
  const dy = bottom.y - top.y; // a moves into the bottom lane; c, one lane lower, goes below every lane
  await dragFromTo(page, { x: a.x + a.width / 2, y: a.y + a.height / 2 }, { x: a.x + a.width / 2, y: a.y + a.height / 2 + dy }, { alt: true });
  const f = await settled(page, d, (x) => pins(x.layout).a?.lane === 'bottom' && pins(x.layout).c?.lane === '_unassigned');
  expect(declaredLane(f.mmd, 'a')).toBe('bottom');
  expect(declaredLane(f.mmd, 'c')).toBe('_unassigned');
  expect(pins(f.layout).a).toEqual({ lane: 'bottom', along: 120, across: 40 });
  await expect(node(page, 'a')).toHaveAttribute('data-lane', 'bottom');
  await expect(node(page, 'c')).toHaveAttribute('data-lane', '_unassigned');
  await undoTo(page, d, MULTI);
});

test('arrow keys nudge the whole group 10 px; Delete removes the group with its lines; each is one undo step', async ({ page }, info) => {
  const d = makeDiagram(info, MULTI);
  await open(page, d);
  await node(page, 'a').click();
  await node(page, 'b').click({ modifiers: ['ControlOrMeta'] });
  await page.keyboard.press('ArrowDown');
  const nudged = await settled(page, d, (x) => pins(x.layout).a?.across === 50 && pins(x.layout).b?.across === 50);
  expect(pins(nudged.layout).a).toEqual({ lane: 'top', along: 120, across: 50 });
  expect(pins(nudged.layout).b).toEqual({ lane: 'top', along: 420, across: 50 });
  await undoTo(page, d, MULTI);
  // Delete: both blocks, every line touching them, their pins; metadata stays (UI14).
  expect(await selectedIds(page)).toEqual(['a', 'b']);
  await page.keyboard.press('Delete');
  const gone = await settled(page, d, (x) => !x.mmd.includes('a["Alpha"]') && !x.mmd.includes('b["Beta"]'));
  expect(gone.mmd).toBe('flowchart LR\n\n  subgraph top [Top]\n  end\n\n  subgraph bottom [Bottom]\n    c["Gamma"]\n    d{"Delta?"}\n  end\n\n  c --> d\n');
  expect(gone.config).toBe(MULTI.config);
  expect(Object.keys(pins(gone.layout))).toEqual(['c', 'd']);
  await expect(node(page, 'a')).toHaveCount(0);
  await expect(page.locator('[data-edge-id]')).toHaveCount(1);
  await undoTo(page, d, MULTI);
  await expect(node(page, 'a')).toHaveCount(1);
});
