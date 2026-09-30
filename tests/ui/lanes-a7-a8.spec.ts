// Amendments A7 (renaming the Unassigned lane makes it a real lane) and A8 (lane sizes: a handle on each lane's far
// edge across the flow). Like the other lane tests, these drive the UI through DOM attributes only and compare the
// files on disk with the same change made by hand (then `fmt` on the `.mmd`): the `.mmd` and config byte for byte, the
// layout file as parsed JSON without `hints`. Undo and redo must restore each state byte for byte.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { format, parse } from '../../src/core/mmd';
import { attrs, dragFromTo, lane, makeDiagram, node, open, PR, saved, settled, zoomOf, type Diagram, type Files } from './helpers';

const fmt = (text: string) => format(parse(text).diagram);

function edit(text: string, ...pairs: [string, string][]): string {
  let out = text;
  for (const [from, to] of pairs) {
    const at = out.indexOf(from);
    if (at < 0) throw new Error(`hand edit: ${JSON.stringify(from)} not found`);
    out = out.slice(0, at) + to + out.slice(at + from.length);
  }
  return out;
}

const withoutHints = (layout: string | null) => {
  if (layout === null) return null;
  const js = JSON.parse(layout) as Record<string, unknown>;
  delete js.hints;
  return js;
};

async function expectFiles(page: Page, d: Diagram, want: Files): Promise<Files> {
  const same = (f: Files) => f.mmd === want.mmd && f.config === want.config
    && JSON.stringify(withoutHints(f.layout)) === JSON.stringify(withoutHints(want.layout));
  const got = await settled(page, d, same, 3000);
  expect(got.mmd).toBe(want.mmd);
  expect(got.config).toBe(want.config);
  expect(withoutHints(got.layout)).toEqual(withoutHints(want.layout));
  await saved(page);
  return d.read();
}

async function expectUndoRedo(page: Page, d: Diagram, before: Files, after: Files): Promise<void> {
  await page.getByTestId('undo').click();
  await settled(page, d, (f) => f.mmd === before.mmd && f.config === before.config && f.layout === before.layout, 3000);
  await saved(page);
  expect(d.read()).toEqual(before);
  await page.getByTestId('redo').click();
  await settled(page, d, (f) => f.mmd === after.mmd && f.config === after.config && f.layout === after.layout, 3000);
  await saved(page);
  expect(d.read()).toEqual(after);
}

const header = (page: Page, id: string) => page.locator(`[data-lane-header="${id}"]`);
const handle = (page: Page, id: string) => page.locator(`[data-lane-resize="${id}"]`);

/** An element's box relative to the canvas element's top-left corner (screen px). */
async function onCanvas(page: Page, loc: Locator) {
  const c = (await page.getByTestId('canvas').boundingBox())!;
  const b = (await loc.boundingBox())!;
  return { x: b.x - c.x, y: b.y - c.y, width: b.width, height: b.height };
}

async function laneOrder(page: Page): Promise<string[]> {
  return page.locator('[data-lane-id]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.laneId!));
}

const FILE_COMMENT = '%% Purchase request approval at a small manufacturer: a synthetic process for testing flowmap.\n';
const VENDOR_END = '    v02["Ship the order"]\n  end\n';

/** The purchase-request map with an unlaned block `loose`, pinned in Unassigned, and an unlaned `stray`. */
const UNLANED: Files = {
  mmd: fmt(edit(PR.mmd, [FILE_COMMENT, `${FILE_COMMENT}\n  %% not placed yet\n  loose["Loose end"]\n  stray{"Stray?"}\n`])),
  config: PR.config,
  layout: JSON.stringify({ version: 1, nodes: {
    closed: { lane: 'requester', along: 1400, across: 40 }, loose: { lane: '_unassigned', along: 600, across: 30 },
  } }, null, 2),
};

/** The same change by hand: the unlaned blocks (and their comment) move into a new last subgraph. */
function promoted(id: string, label: string): Files {
  return {
    mmd: fmt(edit(UNLANED.mmd, ['  %% not placed yet\n  loose["Loose end"]\n  stray{"Stray?"}\n', ''],
      [VENDOR_END, `${VENDOR_END}  subgraph ${id} [${label}]\n    %% not placed yet\n    loose["Loose end"]\n    stray{"Stray?"}\n  end\n`])),
    config: edit(PR.config!, ['  - id: vendor\n', `  - id: vendor\n  - id: ${id}\n`]),
    layout: JSON.stringify({ version: 1, nodes: {
      closed: { lane: 'requester', along: 1400, across: 40 }, loose: { lane: id, along: 600, across: 30 },
    } }),
  };
}

// ---- A7 ------------------------------------------------------------------------------------------------------------

test('A7: double-click the Unassigned header and rename it: it becomes a real lane, nothing moves; undo and redo', async ({ page }, info) => {
  const d = makeDiagram(info, UNLANED);
  await open(page, d);
  const before = { loose: await attrs(node(page, 'loose')), stray: await attrs(node(page, 'stray')) };
  await header(page, '_unassigned').dblclick();
  const editor = page.getByTestId('label-editor');
  await expect(editor).toHaveValue('Unassigned');
  // (Measured with the editor open, which may pan the view to show it, and from the canvas's corner: the warnings
  // about unlaned blocks go away, and the canvas with them may move on the page.)
  const band = await onCanvas(page, lane(page, '_unassigned'));
  await editor.fill('Loose ends');
  await editor.press('Enter');
  const after = await expectFiles(page, d, promoted('loose-ends', 'Loose ends'));
  // The Unassigned lane is gone; the new lane shows where it was, and its blocks where they were.
  await expect(lane(page, '_unassigned')).toHaveCount(0);
  expect(await laneOrder(page)).toEqual(['requester', 'manager', 'purchasing', 'finance', 'vendor', 'loose-ends']);
  await expect(header(page, 'loose-ends')).toContainText('Loose ends');
  expect(await onCanvas(page, lane(page, 'loose-ends'))).toEqual(band);
  for (const id of ['loose', 'stray'] as const) {
    await expect(node(page, id)).toHaveAttribute('data-lane', 'loose-ends');
    expect({ ...(await attrs(node(page, id))), lane: '_unassigned' }).toEqual(before[id]);
  }
  await expect(node(page, 'loose')).toHaveAttribute('data-pinned', 'true');
  await expectUndoRedo(page, d, UNLANED, after);
});

test('A7: the Unassigned lane menu has Rename, which does the same', async ({ page }, info) => {
  const d = makeDiagram(info, UNLANED);
  await open(page, d);
  await header(page, '_unassigned').getByTestId('lane-menu').click();
  await page.getByTestId('lane-rename-label').click();
  const editor = page.getByTestId('label-editor');
  await expect(editor).toBeVisible();
  await editor.fill('Vendor');
  await editor.press('Enter');
  // "Vendor" slugs to `vendor`, which is taken (UI18).
  await expectFiles(page, d, promoted('vendor-2', 'Vendor'));
  await expect(lane(page, '_unassigned')).toHaveCount(0);
  await expect(lane(page, 'vendor-2')).toBeVisible();
});

// ---- A8 ------------------------------------------------------------------------------------------------------------

/** Drag a lane's resize handle by `d` screen px across the flow. */
async function dragHandle(page: Page, h: Locator, dir: 'LR' | 'TB', d: number): Promise<void> {
  const box = (await h.boundingBox())!;
  const from = { x: box.x + Math.min(box.width / 2, 300), y: box.y + Math.min(box.height / 2, 300) };
  const to = dir === 'TB' ? { x: from.x + d, y: from.y } : { x: from.x, y: from.y + d };
  await dragFromTo(page, from, to);
}

test('A8: drag a lane’s bottom edge to make it taller; it stops at what its blocks need; double-click resets', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const cli0 = d.cliLayout();
  const manager0 = cli0.lanes.find((l) => l.id === 'manager')!;
  const vendor0 = cli0.lanes.find((l) => l.id === 'vendor')!;
  const f01 = await attrs(node(page, 'f01'));
  const m01 = await attrs(node(page, 'm01'));
  const z = await zoomOf(page, 'm01');
  await expect(handle(page, 'manager')).toHaveCount(1);

  // Taller by 90 layout px.
  await dragHandle(page, handle(page, 'manager'), 'LR', 90 * z);
  const sized = await settled(page, d, (f) => !!f.layout && 'lanes' in JSON.parse(f.layout));
  const size = (JSON.parse(sized.layout!) as { lanes: { manager: { size: number } } }).lanes.manager.size;
  expect(Math.abs(size - (manager0.height + 90))).toBeLessThanOrEqual(1);
  const after = await expectFiles(page, d, {
    ...PR,
    layout: JSON.stringify({ version: 1, nodes: { closed: { lane: 'requester', along: 1400, across: 40 } }, lanes: { manager: { size } } }),
  });
  // The lane is that size; later lanes and their blocks move down by the difference; its own blocks stay.
  const cli = d.cliLayout();
  expect(cli.lanes.find((l) => l.id === 'manager')!.height).toBe(size);
  expect(cli.lanes.find((l) => l.id === 'vendor')!.y).toBe(vendor0.y + size - manager0.height);
  await expect(node(page, 'f01')).toHaveAttribute('data-y', String(f01.y + size - manager0.height));
  await expect(node(page, 'm01')).toHaveAttribute('data-y', String(m01.y));
  await expectUndoRedo(page, d, PR, after);

  // Dragging up past what the blocks need stops there, which removes the stored size.
  await dragHandle(page, handle(page, 'manager'), 'LR', -(size + 200) * z);
  await expectFiles(page, d, PR);
  expect(d.cliLayout().lanes.find((l) => l.id === 'manager')!.height).toBe(manager0.height);

  // Sized again; the lane menu offers Reset size, and a double-click on the handle does the same.
  await dragHandle(page, handle(page, 'manager'), 'LR', 60 * z);
  await settled(page, d, (f) => !!f.layout && 'lanes' in JSON.parse(f.layout));
  await header(page, 'manager').getByTestId('lane-menu').click();
  await expect(page.getByTestId('lane-reset-size')).toBeVisible();
  await page.keyboard.press('Escape');
  await handle(page, 'manager').dblclick();
  await expectFiles(page, d, PR);
  await header(page, 'manager').getByTestId('lane-menu').click();
  await expect(page.getByTestId('lane-reset-size')).toHaveCount(0);
});

test('A8: top-to-bottom, the handle is the right edge; Unassigned has one; the direction toggle keeps sizes', async ({ page }, info) => {
  const start: Files = { ...UNLANED, mmd: edit(UNLANED.mmd, ['flowchart LR', 'flowchart TB']) };
  const d = makeDiagram(info, start);
  await open(page, d);
  await expect(handle(page, '_unassigned')).toHaveCount(1);
  const u0 = d.cliLayout().lanes.find((l) => l.id === '_unassigned')!;
  const z = await zoomOf(page, 'loose');
  await dragHandle(page, handle(page, '_unassigned'), 'TB', 70 * z);
  const sized = await settled(page, d, (f) => !!f.layout && 'lanes' in JSON.parse(f.layout));
  const size = (JSON.parse(sized.layout!) as { lanes: { _unassigned: { size: number } } }).lanes._unassigned.size;
  expect(Math.abs(size - (u0.width + 70))).toBeLessThanOrEqual(1);
  await saved(page);
  expect(d.cliLayout().lanes.find((l) => l.id === '_unassigned')!.width).toBe(size);
  // A7 carries the size over to the new lane.
  await header(page, '_unassigned').dblclick();
  await page.getByTestId('label-editor').fill('Later');
  await page.getByTestId('label-editor').press('Enter');
  const later = await settled(page, d, (f) => f.mmd.includes('subgraph later'));
  expect((JSON.parse(later.layout!) as { lanes: unknown }).lanes).toEqual({ later: { size } });
  await page.getByTestId('direction-toggle').click();
  await settled(page, d, (f) => f.mmd.startsWith('flowchart LR'));
  await saved(page);
  expect((JSON.parse(d.read().layout!) as { lanes: unknown }).lanes).toEqual({ later: { size } });
  expect(d.cliLayout().lanes.find((l) => l.id === 'later')!.height).toBe(size);
});
