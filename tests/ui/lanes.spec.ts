// Lanes, title, direction, export and keyboard (UI18–UI23, UI32, UI33; §10 U4, U8, P12–P14, P20). Like the
// acceptance suite, these drive the UI only through the §8.3 attributes and compare the files on disk with the same
// change made by hand (then `fmt` on the `.mmd`): the `.mmd` byte for byte, the config byte for byte, the layout file
// as parsed JSON without `hints`. Undo and redo must restore each state byte for byte.
import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { format, parse } from '../../src/core/mmd';
import { dragFromTo, lane, makeDiagram, node, open, PR, saved, settled, type Diagram, type Files } from './helpers';

const fmt = (text: string) => format(parse(text).diagram);

/** A hand edit: each [from, to] replaces exactly one occurrence (and must find it). */
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

/** Wait until the files on disk match `want` (the layout compared without hints) and the UI says saved. */
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

/** Nothing changes on disk (give a would-be save time to land). */
async function expectUnchanged(page: Page, d: Diagram, want: Files): Promise<void> {
  await page.waitForTimeout(350);
  await saved(page);
  expect(d.read()).toEqual(want);
}

/** P20: undo restores `before` byte for byte (a created file is deleted again); redo restores `after` byte for byte. */
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

async function laneOrder(page: Page): Promise<string[]> {
  return page.locator('[data-lane-id]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.laneId!));
}

async function openLaneMenu(page: Page, id: string): Promise<void> {
  await header(page, id).getByTestId('lane-menu').click();
}

const VENDOR_BLOCK = '  subgraph vendor [Vendor]\n    v01@{ shape: doc, label: "Send a quote" }\n    v02["Ship the order"]\n  end\n\n';
const FINANCE_BLOCK = '  subgraph finance [Finance]\n    f01{"Budget available?"}\n    f02["Move budget or defer to next quarter"]\n'
  + '    f03["Match the invoice to the PO and the receipt"]\n    f04(["Vendor paid"])\n  end\n\n';
const FILE_COMMENT = '%% Purchase request approval at a small manufacturer: a synthetic process for testing flowmap.\n';
const LANES_LIST = '  - id: requester\n  - id: manager\n  - id: purchasing\n  - id: finance\n  - id: vendor\n';

// ---- UI18 add a lane -------------------------------------------------------------------------------------------

test('add a lane: the toolbar prompt, appended to the .mmd and the config lanes list; undo and redo', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await page.getByTestId('add-lane').click();
  const editor = page.getByTestId('label-editor');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue('');
  await editor.fill('Quality & Safety');
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  const want: Files = {
    mmd: fmt(edit(PR.mmd, ['    v02["Ship the order"]\n  end\n', '    v02["Ship the order"]\n  end\n  subgraph quality-safety ["Quality & Safety"]\n  end\n'])),
    config: edit(PR.config!, ['  - id: vendor\n', '  - id: vendor\n  - id: quality-safety\n']),
    layout: PR.layout,
  };
  const after = await expectFiles(page, d, want);
  await expect(lane(page, 'quality-safety')).toBeVisible();
  await expect(header(page, 'quality-safety')).toContainText('Quality & Safety');
  // The new lane is selected, ready for a palette shape.
  await expect(lane(page, 'quality-safety')).toHaveAttribute('data-selected', 'true');
  expect(await laneOrder(page)).toEqual(['requester', 'manager', 'purchasing', 'finance', 'vendor', 'quality-safety']);
  await expectUndoRedo(page, d, PR, after);
});

test('add a lane: Escape or an empty label adds nothing; a taken id gets -2', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const editor = page.getByTestId('label-editor');
  await page.getByTestId('add-lane').click();
  await editor.fill('Nope');
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  await page.getByTestId('add-lane').click();
  await editor.fill('   ');
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  await expectUnchanged(page, d, PR);
  // "Vendor" slugs to `vendor`, which is taken.
  await page.getByTestId('add-lane').click();
  await editor.fill('Vendor');
  await editor.press('Enter');
  await expectFiles(page, d, {
    mmd: fmt(edit(PR.mmd, ['    v02["Ship the order"]\n  end\n', '    v02["Ship the order"]\n  end\n  subgraph vendor-2 [Vendor]\n  end\n'])),
    config: edit(PR.config!, ['  - id: vendor\n', '  - id: vendor\n  - id: vendor-2\n']),
    layout: PR.layout,
  });
  await expect(lane(page, 'vendor-2')).toBeVisible();
});

// ---- UI19 rename a lane ----------------------------------------------------------------------------------------

test('rename a lane label: double-click its header; Escape cancels; empty is refused; undo and redo', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const editor = page.getByTestId('label-editor');
  await header(page, 'finance').dblclick();
  await expect(editor).toHaveValue('Finance');
  await editor.fill('Something else');
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  // Empty is refused, with a message; the old label stays.
  await header(page, 'finance').dblclick();
  await editor.fill('');
  await editor.press('Enter');
  await expect(page.getByTestId('toast')).toBeVisible();
  await expectUnchanged(page, d, PR);
  // A label that needs quoting.
  await header(page, 'finance').dblclick();
  await editor.fill('Money & "time"');
  await editor.press('Enter');
  const after = await expectFiles(page, d, {
    mmd: fmt(edit(PR.mmd, ['  subgraph finance [Finance]', '  subgraph finance ["Money & #quot;time#quot;"]'])),
    config: PR.config,
    layout: PR.layout,
  });
  await expect(header(page, 'finance')).toContainText('Money & "time"');
  await expectUndoRedo(page, d, PR, after);
});

test('rename a lane id from the lane menu: refusals show id-error; every reference follows; undo and redo', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await openLaneMenu(page, 'requester');
  await page.getByTestId('lane-rename-id').click();
  const editor = page.getByTestId('id-editor');
  await expect(editor).toHaveValue('requester');
  for (const bad of ['end', 'manager', 'a--b', '1st', 'p01', '_unassigned']) {
    await editor.fill(bad);
    await editor.press('Enter');
    await expect(page.getByTestId('id-error')).toBeVisible();
    await expect(editor).toBeVisible();
  }
  await expectUnchanged(page, d, PR);
  await editor.fill('req');
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  // The subgraph, the config lanes entry (in place) and the lane of the pin in it (`closed`).
  const after = await expectFiles(page, d, {
    mmd: edit(PR.mmd, ['  subgraph requester [Requester]', '  subgraph req [Requester]']),
    config: edit(PR.config!, ['  - id: requester\n', '  - id: req\n']),
    layout: edit(PR.layout!, ['"lane": "requester"', '"lane": "req"']),
  });
  await expect(lane(page, 'req')).toBeVisible();
  await expect(node(page, 'closed')).toHaveAttribute('data-lane', 'req');
  await expect(node(page, 'closed')).toHaveAttribute('data-pinned', 'true');
  await expectUndoRedo(page, d, PR, after);
});

// ---- UI20 reorder lanes ----------------------------------------------------------------------------------------

test('reorder lanes with Move up / Move down; the ends change nothing; undo and redo', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  // First up and last down: no change.
  await openLaneMenu(page, 'requester');
  await page.getByTestId('lane-up').click();
  await openLaneMenu(page, 'vendor');
  await page.getByTestId('lane-down').click();
  await expectUnchanged(page, d, PR);
  await expect(page.getByTestId('undo')).toBeDisabled();
  // Finance up: swaps with purchasing in the config; the .mmd is untouched.
  await openLaneMenu(page, 'finance');
  await page.getByTestId('lane-up').click();
  const up = await expectFiles(page, d, {
    mmd: PR.mmd,
    config: edit(PR.config!, ['  - id: purchasing\n  - id: finance\n', '  - id: finance\n  - id: purchasing\n']),
    layout: PR.layout,
  });
  expect(await laneOrder(page)).toEqual(['requester', 'manager', 'finance', 'purchasing', 'vendor']);
  // Requester down.
  await openLaneMenu(page, 'requester');
  await page.getByTestId('lane-down').click();
  const down = await expectFiles(page, d, {
    mmd: PR.mmd,
    config: edit(PR.config!, [LANES_LIST, '  - id: manager\n  - id: requester\n  - id: finance\n  - id: purchasing\n  - id: vendor\n']),
    layout: PR.layout,
  });
  expect(await laneOrder(page)).toEqual(['manager', 'requester', 'finance', 'purchasing', 'vendor']);
  await expectUndoRedo(page, d, up, down);
});

test('reorder lanes by dragging a header, with a drop indicator; a short drag changes nothing', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  // A tiny header drag neither reorders nor pans.
  const before = (await node(page, 'p01').boundingBox())!;
  const hv = (await header(page, 'vendor').boundingBox())!;
  const centre = { x: hv.x + hv.width / 2, y: hv.y + hv.height / 2 };
  await dragFromTo(page, centre, { x: centre.x + 6, y: centre.y + 10 });
  await expectUnchanged(page, d, PR);
  expect((await node(page, 'p01').boundingBox())!).toEqual(before);
  // Drag vendor above requester, checking the indicator while the button is down.
  const req = (await lane(page, 'requester').boundingBox())!;
  const target = { x: centre.x, y: req.y + req.height * 0.25 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(centre.x, centre.y + ((target.y - centre.y) * i) / 10);
  await expect(page.getByTestId('lane-drop-indicator')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId('lane-drop-indicator')).toHaveCount(0);
  const after = await expectFiles(page, d, {
    mmd: PR.mmd,
    config: edit(PR.config!, [LANES_LIST, '  - id: vendor\n  - id: requester\n  - id: manager\n  - id: purchasing\n  - id: finance\n']),
    layout: PR.layout,
  });
  expect(await laneOrder(page)).toEqual(['vendor', 'requester', 'manager', 'purchasing', 'finance']);
  await expectUndoRedo(page, d, PR, after);
});

test('Unassigned’s menu only renames it (A7); it can’t be dragged, and always stays last', async ({ page }, info) => {
  const start: Files = { ...PR, mmd: fmt(edit(PR.mmd, [FILE_COMMENT, `${FILE_COMMENT}  loose["Loose end"]\n`])) };
  const d = makeDiagram(info, start);
  await open(page, d);
  await expect(lane(page, '_unassigned')).toBeVisible();
  await openLaneMenu(page, '_unassigned');
  await expect(page.getByTestId('lane-rename-label')).toBeVisible();
  for (const item of ['lane-rename-id', 'lane-up', 'lane-down', 'lane-delete']) await expect(page.getByTestId(item)).toHaveCount(0);
  await page.keyboard.press('Escape');
  // A double-click opens the label editor; Escape leaves everything as it was.
  await header(page, '_unassigned').dblclick();
  await expect(page.getByTestId('label-editor')).toHaveValue('Unassigned');
  await page.getByTestId('label-editor').press('Escape');
  await expect(page.getByTestId('label-editor')).toHaveCount(0);
  // Dragging Unassigned's header pans; it doesn't reorder.
  const hu = (await header(page, '_unassigned').boundingBox())!;
  const top = (await lane(page, 'requester').boundingBox())!;
  await dragFromTo(page, { x: hu.x + hu.width / 2, y: hu.y + hu.height / 2 }, { x: hu.x + hu.width / 2, y: top.y + 5 });
  await expectUnchanged(page, d, start);
  // Requester dropped below Unassigned lands last among the real lanes.
  const hr = (await header(page, 'requester').boundingBox())!;
  const un = (await lane(page, '_unassigned').boundingBox())!;
  await dragFromTo(page, { x: hr.x + hr.width / 2, y: hr.y + hr.height / 2 }, { x: hr.x + hr.width / 2, y: un.y + un.height - 4 });
  await expectFiles(page, d, {
    ...start,
    config: edit(PR.config!, [LANES_LIST, '  - id: manager\n  - id: purchasing\n  - id: finance\n  - id: vendor\n  - id: requester\n']),
  });
  expect(await laneOrder(page)).toEqual(['manager', 'purchasing', 'finance', 'vendor', 'requester', '_unassigned']);
});

test('top-to-bottom: lanes are columns; drag a header left to reorder', async ({ page }, info) => {
  const start: Files = { ...PR, mmd: edit(PR.mmd, ['flowchart LR', 'flowchart TB']) };
  const d = makeDiagram(info, start);
  await open(page, d);
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-direction', 'TB');
  const hf = (await header(page, 'finance').boundingBox())!;
  const mgr = (await lane(page, 'manager').boundingBox())!;
  await dragFromTo(page, { x: hf.x + hf.width / 2, y: hf.y + hf.height / 2 }, { x: mgr.x + mgr.width * 0.3, y: hf.y + hf.height / 2 });
  await expectFiles(page, d, {
    ...start,
    config: edit(PR.config!, [LANES_LIST, '  - id: requester\n  - id: finance\n  - id: manager\n  - id: purchasing\n  - id: vendor\n']),
  });
  // The menu says left / right here, with the same test ids.
  await openLaneMenu(page, 'finance');
  await expect(page.getByTestId('lane-up')).toContainText('Move left');
  await page.getByTestId('lane-down').click();
  await expectFiles(page, d, {
    ...start,
    config: edit(PR.config!, [LANES_LIST, '  - id: requester\n  - id: manager\n  - id: finance\n  - id: purchasing\n  - id: vendor\n']),
  });
});

// ---- UI21 delete a lane ----------------------------------------------------------------------------------------

test('delete an empty lane: straight away, with its config entry; undo and redo', async ({ page }, info) => {
  const start: Files = {
    mmd: edit(PR.mmd, ['    v02["Ship the order"]\n  end\n', '    v02["Ship the order"]\n  end\n\n  subgraph qa [QA]\n  end\n']),
    config: edit(PR.config!, ['  - id: vendor\n', '  - id: vendor\n  - id: qa\n']),
    layout: PR.layout,
  };
  expect(fmt(start.mmd)).toBe(start.mmd);
  const d = makeDiagram(info, start);
  await open(page, d);
  await openLaneMenu(page, 'qa');
  await page.getByTestId('lane-delete').click();
  await expect(page.getByTestId('lane-delete-dialog')).toHaveCount(0);
  const after = await expectFiles(page, d, PR);
  expect(after).toEqual(PR);
  await expect(lane(page, 'qa')).toHaveCount(0);
  await expectUndoRedo(page, d, start, PR);
});

test('delete a lane with blocks: the dialog; cancel; move its blocks to another lane', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await openLaneMenu(page, 'vendor');
  await page.getByTestId('lane-delete').click();
  const dialog = page.getByTestId('lane-delete-dialog');
  await expect(dialog).toBeVisible();
  const options = await dialog.getByTestId('lane-target').locator('option').evaluateAll((els) => els.map((o) => (o as HTMLOptionElement).value));
  expect(options.sort()).toEqual(['_unassigned', 'finance', 'manager', 'purchasing', 'requester']);
  await dialog.getByTestId('confirm-no').click();
  await expect(dialog).toHaveCount(0);
  await expectUnchanged(page, d, PR);
  await openLaneMenu(page, 'vendor');
  await page.getByTestId('lane-delete').click();
  await dialog.getByTestId('lane-target').selectOption('purchasing');
  await dialog.getByTestId('lane-move-blocks').click();
  await expect(dialog).toHaveCount(0);
  const after = await expectFiles(page, d, {
    mmd: fmt(edit(PR.mmd, [VENDOR_BLOCK, ''], ['    p07["Create the PO in the ERP"]\n',
      '    p07["Create the PO in the ERP"]\n    v01@{ shape: doc, label: "Send a quote" }\n    v02["Ship the order"]\n'])),
    config: edit(PR.config!, ['  - id: vendor\n', '']),
    layout: PR.layout,
  });
  await expect(lane(page, 'vendor')).toHaveCount(0);
  await expect(node(page, 'v01')).toHaveAttribute('data-lane', 'purchasing');
  await expectUndoRedo(page, d, PR, after);
});

test('delete a lane moving its blocks to Unassigned (pins dropped)', async ({ page }, info) => {
  // Pin f02 so the move has a pin to drop.
  const start: Files = { ...PR, layout: '{"version": 1, "nodes": {"closed": {"lane": "requester", "along": 1400, "across": 40}, "f02": {"lane": "finance", "along": 900, "across": 30}}}\n' };
  const d = makeDiagram(info, start);
  await open(page, d);
  await expect(node(page, 'f02')).toHaveAttribute('data-pinned', 'true');
  await openLaneMenu(page, 'finance');
  await page.getByTestId('lane-delete').click();
  await page.getByTestId('lane-target').selectOption('_unassigned');
  await page.getByTestId('lane-move-blocks').click();
  const unlaned = '  f01{"Budget available?"}\n  f02["Move budget or defer to next quarter"]\n  f03["Match the invoice to the PO and the receipt"]\n  f04(["Vendor paid"])\n';
  const after = await expectFiles(page, d, {
    mmd: fmt(edit(PR.mmd, [FINANCE_BLOCK, ''], [FILE_COMMENT, `${FILE_COMMENT}\n${unlaned}`])),
    config: edit(PR.config!, ['  - id: finance\n', '']),
    layout: PR.layout,
  });
  await expect(lane(page, '_unassigned')).toBeVisible();
  await expect(node(page, 'f02')).toHaveAttribute('data-lane', '_unassigned');
  await expect(node(page, 'f02')).toHaveAttribute('data-pinned', 'false');
  await expectUndoRedo(page, d, start, after);
});

test('delete a lane with its blocks: their edges go, their config metadata stays', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await openLaneMenu(page, 'vendor');
  await page.getByTestId('lane-delete').click();
  await page.getByTestId('lane-delete-blocks').click();
  const after = await expectFiles(page, d, {
    mmd: fmt(edit(PR.mmd, [VENDOR_BLOCK, ''], ['  p05 --> v01\n  v01 --> p06\n', ''], ['  p07 --> v02\n  v02 --> r02\n', ''])),
    config: edit(PR.config!, ['  - id: vendor\n', '']),
    layout: PR.layout,
  });
  expect(after.config).toContain('  v01:\n');
  await expect(node(page, 'v01')).toHaveCount(0);
  await expectUndoRedo(page, d, PR, after);
});

// ---- UI22 title, UI23 direction ----------------------------------------------------------------------------------

test('title: double-click to edit; Escape cancels; set, clear; undo and redo', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const title = page.getByTestId('title');
  await expect(title).toHaveText('Purchase request approval (current state, synthetic)');
  const editor = page.getByTestId('title-editor');
  await title.dblclick();
  await expect(editor).toHaveValue('Purchase request approval (current state, synthetic)');
  await editor.fill('Nope');
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  await expectUnchanged(page, d, PR);
  await title.dblclick();
  await editor.fill('Purchasing: as-is');
  await editor.press('Enter');
  const set = await expectFiles(page, d, {
    ...PR,
    config: edit(PR.config!, ['title: Purchase request approval (current state, synthetic)', 'title: "Purchasing: as-is"']),
  });
  await expect(title).toHaveText('Purchasing: as-is');
  await expectUndoRedo(page, d, PR, set);
  // Empty removes the key (the title falls back to the file's name).
  await title.dblclick();
  await editor.fill('');
  await editor.press('Enter');
  await expectFiles(page, d, { ...PR, config: edit(PR.config!, ['title: Purchase request approval (current state, synthetic)\n', '']) });
  await expect(title).toHaveText(d.base);
});

test('title without a config file: creates it; undo deletes it again', async ({ page }, info) => {
  const start: Files = { mmd: PR.mmd, config: null, layout: null };
  const d = makeDiagram(info, start);
  await open(page, d);
  await expect(page.getByTestId('title')).toHaveText(d.base);
  await page.getByTestId('title').dblclick();
  await page.getByTestId('title-editor').fill('My map');
  await page.keyboard.press('Enter');
  const after = await expectFiles(page, d, { ...start, config: 'version: 1\ntitle: My map\n' });
  await expectUndoRedo(page, d, start, after);
});

test('direction: the toggle flips LR and TB both ways, pins kept; undo and redo', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const canvas = page.getByTestId('canvas');
  await expect(canvas).toHaveAttribute('data-direction', 'LR');
  await page.getByTestId('direction-toggle').click();
  const tb = await expectFiles(page, d, { ...PR, mmd: edit(PR.mmd, ['flowchart LR', 'flowchart TB']) });
  expect(tb.layout).toBe(PR.layout);
  await expect(canvas).toHaveAttribute('data-direction', 'TB');
  await expect(node(page, 'closed')).toHaveAttribute('data-pinned', 'true');
  await expect(node(page, 'closed')).toHaveAttribute('data-y', '1400');
  await expectUndoRedo(page, d, PR, tb);
  await page.getByTestId('direction-toggle').click();
  await expectFiles(page, d, PR);
  await expect(canvas).toHaveAttribute('data-direction', 'LR');
});

// ---- UI32 export ---------------------------------------------------------------------------------------------------

test('export SVG and PNG: files written beside the .mmd, path shown', async ({ page }, info) => {
  test.setTimeout(60_000);
  const d = makeDiagram(info);
  await open(page, d);
  await page.getByTestId('export-svg').click();
  const pathEl = page.getByTestId('export-path');
  await expect(pathEl).toHaveText(new RegExp(`exports/${d.base}\\.svg$`), { timeout: 15_000 });
  const svgPath = (await pathEl.textContent())!;
  expect(existsSync(svgPath)).toBe(true);
  const svg = readFileSync(svgPath, 'utf8');
  expect(svg).toContain('<svg');
  expect(svg).toContain('data-lane-id="finance"');
  expect(svg).toContain('Purchase request approval');
  await page.getByTestId('export-png').click();
  await expect(pathEl).toHaveText(new RegExp(`exports/${d.base}\\.png$`), { timeout: 45_000 });
  const pngPath = (await pathEl.textContent())!;
  const png = readFileSync(pngPath);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  // Exporting never touches the diagram's files.
  expect(d.read()).toEqual(PR);
});

test('export saves an unsaved edit first, so the picture matches the screen', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await page.getByTestId('title').dblclick();
  await page.getByTestId('title-editor').fill('Fresh title');
  await page.keyboard.press('Enter');
  await page.getByTestId('export-svg').click();
  const pathEl = page.getByTestId('export-path');
  await expect(pathEl).toHaveText(/\.svg$/, { timeout: 15_000 });
  expect(readFileSync((await pathEl.textContent())!, 'utf8')).toContain('Fresh title');
});

// ---- UI33 keyboard -------------------------------------------------------------------------------------------------

test('? shows the shortcut list (from the registry); ? again, Escape or × hides it', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const list = page.getByTestId('shortcuts');
  await expect(list).toHaveCount(0);
  await node(page, 'p01').click();
  await page.keyboard.press('?');
  await expect(list).toBeVisible();
  for (const text of ['Undo', 'Redo', 'Select everything', 'Cancel / clear the selection', 'Edit the selected block’s label', 'Nudge the selection', 'Show or hide this list']) {
    await expect(list).toContainText(text);
  }
  // v1.1: notes and the title (Enter, arrows), double-click on a note, right-click menus, Alt to skip snapping.
  const rows = list.locator('.fm-shortcut-row');
  const row = (text: string) => rows.filter({ has: page.locator('dt', { hasText: text }) });
  await expect(row('Edit the selected note or the title')).toContainText('Enter');
  await expect(row('Move the selected note or the title 10 px')).toContainText('←');
  await expect(row('Edit a block, a note,')).toContainText('Double-click');
  await expect(row('The menu for a block, line, lane, note, the title or the canvas')).toContainText('Right-click');
  await expect(row('Move without snapping')).toContainText(/Alt|⌥/);
  await expect(row('Delete the selected blocks and lines, or the selected note')).toContainText('Delete');
  await page.keyboard.press('?');
  await expect(list).toHaveCount(0);
  await page.keyboard.press('?');
  await expect(list).toBeVisible();
  // Escape closes the list first, before clearing the selection.
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(node(page, 'p01')).toHaveAttribute('data-selected', 'true');
  await page.getByTestId('shortcuts-toggle').click();
  await expect(list).toBeVisible();
  await list.getByRole('button', { name: 'Close' }).click();
  await expect(list).toHaveCount(0);
});

test('undo and redo shortcuts work on lane edits; no shortcut fires while typing in an editor', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await page.getByTestId('direction-toggle').click();
  const tb: Files = { ...PR, mmd: edit(PR.mmd, ['flowchart LR', 'flowchart TB']) };
  await expectFiles(page, d, tb);

  // In the title editor: ?, Cmd/Ctrl+Z, Cmd/Ctrl+A and the arrows all stay in the text field.
  await page.getByTestId('title').dblclick();
  const editor = page.getByTestId('title-editor');
  await editor.fill('Draft');
  await page.keyboard.press('?');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByTestId('shortcuts')).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(page.locator('[data-node-id][data-selected="true"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expectUnchanged(page, d, tb);

  // In the add-lane prompt and the id editor too.
  await page.getByTestId('add-lane').click();
  await page.keyboard.type('Ops?');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('label-editor')).toBeVisible();
  await expect(page.getByTestId('shortcuts')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await openLaneMenu(page, 'finance');
  await page.getByTestId('lane-rename-id').click();
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('?');
  await expect(page.getByTestId('id-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expectUnchanged(page, d, tb);

  // With the lane delete dialog open, shortcuts are held too.
  await openLaneMenu(page, 'vendor');
  await page.getByTestId('lane-delete').click();
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('?');
  await expect(page.getByTestId('shortcuts')).toHaveCount(0);
  await page.getByTestId('confirm-no').click();
  await expectUnchanged(page, d, tb);

  // Outside an editor: Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z redoes, byte for byte.
  await page.keyboard.press('ControlOrMeta+z');
  await settled(page, d, (f) => f.mmd === PR.mmd, 3000);
  await saved(page);
  expect(d.read()).toEqual(PR);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await settled(page, d, (f) => f.mmd === tb.mmd, 3000);
  await saved(page);
  expect(d.read()).toEqual(tb);
});

test('the lane menu works from the keyboard and keeps arrow keys to itself', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await node(page, 'p01').click();
  await openLaneMenu(page, 'manager');
  // Arrows move between items (not a nudge); Enter picks one.
  await page.keyboard.press('ArrowDown'); // Change id…
  await page.keyboard.press('ArrowDown'); // Move up
  await page.keyboard.press('ArrowDown'); // Move down
  await page.keyboard.press('Enter');
  await expectFiles(page, d, {
    ...PR,
    config: edit(PR.config!, ['  - id: manager\n  - id: purchasing\n', '  - id: purchasing\n  - id: manager\n']),
  });
  // Escape closes the menu.
  await openLaneMenu(page, 'manager');
  await expect(page.getByTestId('lane-delete')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('lane-delete')).toHaveCount(0);
});
