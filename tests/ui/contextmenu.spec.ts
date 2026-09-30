// UI40 context menus, through the §8.3 attributes only (`context-menu`, `data-menu-item`, and the editors and
// controls they open), checking the files on disk. Items owned by features that may not have landed yet (colours,
// sizes, bend points, label positions, notes, the title's position and visibility) aren't expected to show here;
// every item's "shows when" rule, theirs included, is unit-tested in src/ui/contextmenu/items.test.ts.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { parse as parseYaml } from 'yaml';
import { format, parse } from '../../src/core/mmd';
import {
  attrs, declaredLane, emptyPointInLane, makeDiagram, node, open, pins, saved, settled, zoomOf, type Diagram, type Files,
} from './helpers';

const canon = (text: string) => format(parse(text).diagram);

const MENUS: Files = {
  mmd: canon(`flowchart LR
  subgraph alpha [Alpha]
    a1["First"]
    a2["Second"]
  end
  subgraph beta [Beta]
    b1{"Check?"}
  end
  subgraph gamma [Gamma]
    g1["Third"]
  end
  a1 --> a2
  a2 -->|yes| b1
  b1 --> g1
`),
  config: 'version: 1\ntitle: Menus\n',
  layout: JSON.stringify({ version: 1, nodes: { b1: { lane: 'beta', along: 420, across: 30 } } }),
};

const UI40_BLOCK = ['edit-label', 'rename-id', 'shape', 'colors', 'duplicate', 'unpin', 'reset-size', 'reset-colors', 'delete'];
const UI40_LINE = ['edit-label', 'add-bend', 'remove-bend', 'reset-line', 'reset-label', 'delete'];
const SHAPES = ['step', 'decision', 'terminal', 'subprocess', 'database', 'io', 'document', 'delay'];

const menu = (page: Page) => page.getByTestId('context-menu');
const item = (page: Page, name: string) => menu(page).locator(`[data-menu-item="${name}"]`);
const itemNames = (page: Page) =>
  menu(page).locator('[data-menu-item]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.menuItem!));

async function rightClick(page: Page, at: Locator | { x: number; y: number }): Promise<{ x: number; y: number }> {
  let p: { x: number; y: number };
  if ('x' in at) p = at;
  else {
    const b = (await at.boundingBox())!;
    p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(menu(page)).toBeVisible();
  return p;
}

/** A point halfway along a line's drawn path, in page coordinates. */
async function onLine(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page.locator(`[data-edge-id="${id}"] path`).first().evaluate((p) => {
    const path = p as SVGPathElement;
    const pt = path.getPointAtLength(path.getTotalLength() / 2);
    const m = path.getScreenCTM()!;
    return { x: pt.x * m.a + pt.y * m.c + m.e, y: pt.x * m.b + pt.y * m.d + m.f };
  });
}

/** The files once the action has landed and the page has saved (helpers `settled`). */
const onDisk = (page: Page, d: Diagram, check: (f: Files) => boolean): Promise<Files> => settled(page, d, check);

// ---- Opening, closing, placing -----------------------------------------------------------------------------------

test('a right-click on a block opens its menu at the pointer and selects it; Escape and a click elsewhere close it', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  const at = await rightClick(page, node(page, 'a1'));
  await expect(node(page, 'a1')).toHaveAttribute('data-selected', 'true');
  const box = (await menu(page).boundingBox())!;
  expect(Math.abs(box.x - at.x)).toBeLessThanOrEqual(4);
  expect(Math.abs(box.y - at.y)).toBeLessThanOrEqual(4);
  // Exactly UI40's block items: the always-shown ones; not unpin, reset-size or reset-colors (a1 has none of those).
  const names = await itemNames(page);
  for (const n of names) expect(UI40_BLOCK).toContain(n);
  for (const n of ['edit-label', 'rename-id', 'shape', 'duplicate', 'delete']) expect(names).toContain(n);
  for (const n of ['unpin', 'reset-size', 'reset-colors']) expect(names).not.toContain(n);
  // Escape closes the menu only: the selection stays.
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(node(page, 'a1')).toHaveAttribute('data-selected', 'true');
  // A click elsewhere closes it too.
  await rightClick(page, node(page, 'b1'));
  await expect(node(page, 'b1')).toHaveAttribute('data-selected', 'true');
  expect(await itemNames(page)).toContain('unpin'); // b1 is pinned
  const empty = await emptyPointInLane(page, 'gamma');
  await page.mouse.click(empty.x, empty.y);
  await expect(menu(page)).toHaveCount(0);
  // Nothing was written.
  expect(d.read()).toEqual(MENUS);
});

test('the menu stays inside the window near its edges', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  const c = (await page.getByTestId('canvas').boundingBox())!;
  await rightClick(page, { x: c.x + c.width - 120, y: c.y + c.height - 60 });
  const b = (await menu(page).boundingBox())!;
  const vp = page.viewportSize()!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
  expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
});

test('a right-click elsewhere moves the menu there, for what is under the pointer', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  await rightClick(page, node(page, 'a1'));
  expect(await itemNames(page)).toContain('shape');
  await rightClick(page, await emptyPointInLane(page, 'gamma'));
  await expect(menu(page)).toHaveCount(1);
  expect(await itemNames(page)).toContain('add-step');
  expect(await itemNames(page)).not.toContain('shape');
});

test('the keyboard: arrows move through the items without nudging, Enter runs one', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  await rightClick(page, node(page, 'a1'));
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'edit-label')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'rename-id')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(menu(page)).toHaveCount(0);
  await expect(page.getByTestId('label-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(d.read()).toEqual(MENUS); // the arrows didn't nudge a1 (no pin written)
});

// ---- Block items -------------------------------------------------------------------------------------------------

test('block edit-label opens the label editor; Enter writes the label', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  await rightClick(page, node(page, 'a1'));
  await item(page, 'edit-label').click();
  await expect(menu(page)).toHaveCount(0);
  const editor = page.getByTestId('label-editor');
  await expect(editor).toHaveValue('First');
  await editor.fill('Start here');
  await editor.press('Enter');
  const f = await onDisk(page, d, (x) => x.mmd.includes('a1["Start here"]'));
  expect(f.mmd).toBe(MENUS.mmd.replace('a1["First"]', 'a1["Start here"]'));
});

test('block rename-id opens the id editor; a refusal stays open with the reason; Enter renames every reference', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  await rightClick(page, node(page, 'a1'));
  await item(page, 'rename-id').click();
  const editor = page.getByTestId('id-editor');
  await expect(editor).toBeVisible();
  await editor.fill('a2');
  await editor.press('Enter');
  await expect(page.getByTestId('id-error')).toBeVisible();
  await editor.fill('start');
  await editor.press('Enter');
  const f = await onDisk(page, d, (x) => x.mmd.includes('start["First"]'));
  expect(f.mmd).toContain('start --> a2');
  await expect(node(page, 'start')).toHaveAttribute('data-selected', 'true');
});

test('block shape opens the shape options inside the menu; one click rewrites the declaration', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  await rightClick(page, node(page, 'a1'));
  await expect(menu(page).locator('[data-shape]')).toHaveCount(0);
  await item(page, 'shape').click();
  await expect(menu(page).locator('[data-shape]')).toHaveCount(8);
  await menu(page).locator('[data-shape="database"]').click();
  await expect(menu(page)).toHaveCount(0);
  const f = await onDisk(page, d, (x) => x.mmd.includes('a1[("First")]'));
  expect(f.mmd).toBe(MENUS.mmd.replace('a1["First"]', 'a1[("First")]'));
  await expect(node(page, 'a1')).toHaveAttribute('data-kind', 'database');
});

test('block duplicate copies it (pinned 40 px along and across, A12) and selects the copy', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  const b1 = await attrs(node(page, 'b1'));
  await rightClick(page, node(page, 'b1'));
  await item(page, 'duplicate').click();
  const f = await onDisk(page, d, (x) => x.mmd.includes('b1-2{"Check?"}'));
  expect(declaredLane(f.mmd, 'b1-2')).toBe('beta');
  expect(pins(f.layout)['b1-2']).toEqual({ lane: 'beta', along: 420 + 40, across: 30 + 40 });
  await expect(node(page, 'b1-2')).toHaveAttribute('data-selected', 'true');
  expect((await attrs(node(page, 'b1-2'))).x).toBe(b1.x + 40);
});

test('block unpin shows only on a pinned block and removes its pin', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  await rightClick(page, node(page, 'a2'));
  expect(await itemNames(page)).not.toContain('unpin');
  await page.keyboard.press('Escape');
  await rightClick(page, node(page, 'b1'));
  await item(page, 'unpin').click();
  const f = await onDisk(page, d, (x) => !pins(x.layout).b1);
  expect(pins(f.layout).b1).toBeUndefined();
  await expect(node(page, 'b1')).toHaveAttribute('data-pinned', 'false');
});

test('block delete removes it with its lines; undo brings everything back', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  await rightClick(page, node(page, 'b1'));
  await item(page, 'delete').click();
  const f = await onDisk(page, d, (x) => !x.mmd.includes('b1'));
  expect(f.mmd).not.toContain('a2 -->');
  expect(pins(f.layout).b1).toBeUndefined();
  await expect(node(page, 'b1')).toHaveCount(0);
  await saved(page);
  await page.getByTestId('undo').click();
  expect(await onDisk(page, d, (x) => x.mmd === MENUS.mmd && x.layout === MENUS.layout)).toEqual(MENUS);
});

// ---- The side column never hides a block (the acceptance suite's U14.08) -----------------------------------------
// At fit, the last column of blocks sits where the side column opens. Selecting a block (a right-click, or duplicate,
// which selects the copy) opens the column; every block must still be on screen and right-clickable at its centre.

/** Steps, then one block of each shape in the last column, at the canvas's right edge at fit (as polish.spec.ts). */
const LAST_COLUMN: Files = {
  mmd: canon(`flowchart LR
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
`),
  config: null,
  layout: null,
};

/**
 * A block's box once the view has settled. When a right-click opens the side column, the store keeps the diagram in
 * view only after the press ends (a task and a frame later: it never moves the world under a press); under load that
 * lands after the test's next step has already measured a block, so measure once two frames in a row agree.
 */
async function settledBox(page: Page, id: string) {
  let prev: { x: number; y: number; width: number; height: number } | null = null;
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    const b = await node(page, id).boundingBox();
    if (b && prev && b.x === prev.x && b.y === prev.y && b.width === prev.width && b.height === prev.height) return b;
    prev = b;
  }
  return prev;
}

/** Right-click a block's centre; it must open the block's own menu. On failure, says what covers the centre. */
async function rightClickBlock(page: Page, id: string): Promise<void> {
  const b = (await settledBox(page, id))!;
  const p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const under = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const n = el?.closest('[data-node-id]');
    return n ? `block ${n.getAttribute('data-node-id')}` : el ? `${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''}` : 'nothing (off screen)';
  }, p);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(menu(page), `right-clicking block ${id} did not open data-testid="context-menu" (UI40); under its centre: ${under}`).toBeVisible();
  await expect(node(page, id)).toHaveAttribute('data-selected', 'true');
}

const blockIds = (page: Page) =>
  page.locator('[data-node-id]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.nodeId!));

for (const first of ['s1', 's6', 'f', 'h']) {
  test(`block items with the side column open: duplicate ${first}, then every block's menu opens; delete f`, async ({ page }, info) => {
    const d = makeDiagram(info, LAST_COLUMN);
    await open(page, d);
    const ids = await blockIds(page);
    // At fit, f is where the side column opens.
    const canvas = (await page.getByTestId('canvas').boundingBox())!;
    const f0 = (await node(page, 'f').boundingBox())!;
    expect(f0.x + f0.width).toBeGreaterThan(canvas.x + canvas.width - 340);
    await rightClickBlock(page, first);
    await item(page, 'duplicate').click();
    const copy = `${first}-2`;
    await onDisk(page, d, (x) => x.mmd.includes(copy));
    await expect(node(page, copy)).toHaveAttribute('data-selected', 'true');
    await expect(page.getByTestId('inspector')).toBeVisible();
    // With the copy selected and the column open, every other block still opens its own menu at its centre.
    for (const id of ids) {
      if (id === first) continue; // the copy sits 40 px along and across, possibly over its original's centre
      await rightClickBlock(page, id);
      await page.keyboard.press('Escape');
      await expect(menu(page)).toHaveCount(0);
    }
    if (first === 'f') {
      const b = (await node(page, 'f').boundingBox())!;
      await page.mouse.click(b.x + 6, b.y + 6, { button: 'right' }); // f's corner, clear of the copy
      await expect(menu(page)).toBeVisible();
      await expect(node(page, 'f')).toHaveAttribute('data-selected', 'true');
    } else {
      await rightClickBlock(page, 'f');
    }
    await item(page, 'delete').click();
    const after = await onDisk(page, d, (x) => !/^\s+f@/m.test(x.mmd));
    expect(after.mmd).not.toContain('s6 --> f');
    await expect(node(page, 'f')).toHaveCount(0);
    await expect(node(page, copy)).toHaveCount(1);
  });
}

// A left click or drag never moves the view (only to keep the clicked block itself in view), so after one the column
// may cover the last column; the menu's own flow (right-click, then items) keeps everything reachable.
test('every block of every shape opens its menu at its centre: nothing selected, itself clicked, another right-clicked', async ({ page }, info) => {
  const d = makeDiagram(info, LAST_COLUMN);
  await open(page, d);
  const ids = await blockIds(page);
  for (const selected of ['none', 'self', 'other']) {
    for (const id of ids) {
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('inspector')).toHaveCount(0);
      await page.getByTestId('fit').click();
      if (selected === 'self') {
        const b = (await node(page, id).boundingBox())!;
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        await expect(page.getByTestId('inspector')).toBeVisible();
      } else if (selected === 'other') {
        await rightClickBlock(page, id === 's1' ? 's2' : 's1');
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('inspector')).toBeVisible();
      }
      await rightClickBlock(page, id);
    }
  }
});

// ---- Several blocks ----------------------------------------------------------------------------------------------

test('on a block that is one of several selected: only the items for all of them, applied to all', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  await node(page, 'a1').click();
  await node(page, 'b1').click({ modifiers: ['Shift'] });
  await node(page, 'g1').click({ modifiers: ['Shift'] });
  await rightClick(page, node(page, 'b1'));
  // The selection stays; the single-block items are left out; unpin shows because one of them (b1) is pinned.
  for (const id of ['a1', 'b1', 'g1']) await expect(node(page, id)).toHaveAttribute('data-selected', 'true');
  const names = await itemNames(page);
  for (const n of ['edit-label', 'rename-id', 'shape']) expect(names).not.toContain(n);
  for (const n of ['duplicate', 'unpin', 'delete']) expect(names).toContain(n);
  for (const n of names) expect(['colors', 'duplicate', 'unpin', 'reset-size', 'reset-colors', 'delete']).toContain(n);
  await item(page, 'duplicate').click();
  const copies = ['a1-2', 'b1-2', 'g1-2'];
  const f = await onDisk(page, d, (x) => copies.every((id) => x.mmd.includes(`${id}[`) || x.mmd.includes(`${id}{`)));
  // Each copy in its original's lane (A12 ids: the original's id and -2).
  expect(declaredLane(f.mmd, 'a1-2')).toBe('alpha');
  expect(declaredLane(f.mmd, 'b1-2')).toBe('beta');
  expect(declaredLane(f.mmd, 'g1-2')).toBe('gamma');
  for (const id of copies) await expect(node(page, id)).toHaveAttribute('data-selected', 'true');
  // Delete from the menu on one of the copies deletes all three copies.
  await saved(page);
  await rightClick(page, node(page, 'b1-2'));
  await item(page, 'delete').click();
  const g = await onDisk(page, d, (x) => copies.every((id) => !x.mmd.includes(id)));
  expect(g.mmd).toBe(MENUS.mmd);
});

test('on several selected blocks, unpin applies to every pinned one', async ({ page }, info) => {
  const layout = JSON.stringify({ version: 1, nodes: { a2: { lane: 'alpha', along: 300, across: 40 }, b1: { lane: 'beta', along: 420, across: 30 } } });
  const d = makeDiagram(info, { ...MENUS, layout });
  await open(page, d);
  await node(page, 'a1').click();
  await node(page, 'a2').click({ modifiers: ['Shift'] });
  await node(page, 'b1').click({ modifiers: ['Shift'] });
  await rightClick(page, node(page, 'a1'));
  await item(page, 'unpin').click();
  const f = await onDisk(page, d, (x) => Object.keys(pins(x.layout)).length === 0);
  expect(pins(f.layout)).toEqual({});
});

test('a right-click on a block outside the selection selects just that block', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  await node(page, 'a1').click();
  await node(page, 'a2').click({ modifiers: ['Shift'] });
  await rightClick(page, node(page, 'g1'));
  await expect(node(page, 'g1')).toHaveAttribute('data-selected', 'true');
  await expect(node(page, 'a1')).toHaveAttribute('data-selected', 'false');
  await expect(node(page, 'a2')).toHaveAttribute('data-selected', 'false');
  expect(await itemNames(page)).toContain('edit-label');
});

// ---- Lines -------------------------------------------------------------------------------------------------------

test('line: "Add label" when it has none, which opens the label editor and writes the label', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  await rightClick(page, await onLine(page, 'a1->a2'));
  await expect(page.locator('[data-edge-id="a1->a2"]')).toHaveAttribute('data-selected', 'true');
  const names = await itemNames(page);
  for (const n of names) expect(UI40_LINE).toContain(n);
  expect(names).toContain('delete');
  expect(names).not.toContain('remove-bend'); // not on a bend point
  expect(names).not.toContain('reset-line'); // automatic, no stored side
  expect(names).not.toContain('reset-label');
  await expect(item(page, 'edit-label')).toHaveText(/Add label/);
  await item(page, 'edit-label').click();
  const editor = page.getByTestId('label-editor');
  await expect(editor).toBeVisible();
  await editor.fill('go');
  await editor.press('Enter');
  const f = await onDisk(page, d, (x) => x.mmd.includes('a1 -->|go| a2'));
  expect(f.mmd).toBe(MENUS.mmd.replace('a1 --> a2', 'a1 -->|go| a2'));
});

test('line: "Edit label" on a labelled line; delete removes the line', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  await rightClick(page, page.locator('[data-edge-id="a2->b1"]').getByText('yes'));
  await expect(item(page, 'edit-label')).toHaveText(/Edit label/);
  await item(page, 'delete').click();
  const f = await onDisk(page, d, (x) => !x.mmd.includes('a2 -->|yes| b1'));
  expect(f.mmd).toBe(MENUS.mmd.replace('  a2 -->|yes| b1\n', ''));
  await expect(page.locator('[data-edge-id="a2->b1"]')).toHaveCount(0);
});

// ---- Title, lane header, canvas ----------------------------------------------------------------------------------

test('title: edit-title opens the title editor and writes the config title', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  await rightClick(page, page.getByTestId('title'));
  const names = await itemNames(page);
  expect(names).toContain('edit-title');
  for (const n of names) expect(['edit-title', 'reset-position', 'hide-title']).toContain(n);
  expect(names).not.toContain('reset-position'); // no stored position
  await item(page, 'edit-title').click();
  const editor = page.getByTestId('title-editor');
  await expect(editor).toHaveValue('Menus');
  await editor.fill('Menus, reviewed');
  await editor.press('Enter');
  const f = await onDisk(page, d, (x) => x.config?.includes('Menus, reviewed') ?? false);
  expect((parseYaml(f.config!) as { title: string }).title).toBe('Menus, reviewed');
});

test('lane header: its own menu renames and reorders the lane', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  await rightClick(page, page.locator('[data-lane-header="alpha"]'));
  const names = await itemNames(page);
  expect(names).toEqual(['edit-label', 'rename-id', 'move-down', 'delete']); // the first lane can't move up
  await item(page, 'move-down').click();
  const f = await onDisk(page, d, (x) => x.config?.includes('lanes') ?? false);
  expect((parseYaml(f.config!) as { lanes: { id: string }[] }).lanes.map((l) => l.id)).toEqual(['beta', 'alpha', 'gamma']);
  await rightClick(page, page.locator('[data-lane-header="gamma"]'));
  await item(page, 'edit-label').click();
  const editor = page.getByTestId('label-editor');
  await editor.fill('Gamma team');
  await editor.press('Enter');
  await onDisk(page, d, (x) => x.mmd.includes('subgraph gamma [Gamma team]'));
});

test('canvas: a block of each shape; add-<shape> puts its top-left at the click, pinned, in that lane, into label editing', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  const at = await rightClick(page, await emptyPointInLane(page, 'beta'));
  const names = await itemNames(page);
  for (const k of SHAPES) expect(names).toContain(`add-${k}`);
  expect(names).not.toContain('show-title'); // the title is showing
  for (const n of names) expect(['add-note', 'show-title', ...SHAPES.map((k) => `add-${k}`)]).toContain(n);
  // Where the click is in diagram coordinates, from a block's on-screen box and its data-x/y.
  const ref = await attrs(node(page, 'a1'));
  const rb = (await node(page, 'a1').boundingBox())!;
  const z = await zoomOf(page, 'a1');
  const world = { x: ref.x + (at.x - rb.x) / z, y: ref.y + (at.y - rb.y) / z };
  await item(page, 'add-decision').click();
  await expect(menu(page)).toHaveCount(0);
  const editor = page.getByTestId('label-editor');
  await expect(editor).toHaveValue('New decision');
  await editor.press('Escape');
  const f = await onDisk(page, d, (x) => x.mmd.includes('n1{"New decision"}'));
  expect(declaredLane(f.mmd, 'n1')).toBe('beta');
  const beta = d.cliLayout().lanes.find((l) => l.id === 'beta')!;
  const pin = pins(f.layout).n1!;
  expect(pin.lane).toBe('beta');
  expect(Math.abs(pin.along - world.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(pin.across - (world.y - beta.y))).toBeLessThanOrEqual(1);
  await saved(page);
  const n1 = await attrs(node(page, 'n1'));
  expect(n1.pinned).toBe(true);
  expect(n1.kind).toBe('decision');
  // On screen, its top-left corner is where the menu was opened.
  const nb = (await node(page, 'n1').boundingBox())!;
  expect(Math.abs(nb.x - at.x)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(nb.y - at.y)).toBeLessThanOrEqual(1.5);
});

test('canvas add: the block joins the lane its centre falls in (UI43), and Unassigned below every lane', async ({ page }, info) => {
  const d = makeDiagram(info, MENUS);
  await open(page, d);
  // Just above Beta's start edge: the top-left is in Alpha, the centre in Beta. Beta isn't the first lane, so the
  // block is stored at across 0, on Beta's start edge.
  const alpha = (await page.locator('[data-lane-id="alpha"]').boundingBox())!;
  const x = alpha.x + alpha.width * 0.75;
  await rightClick(page, { x, y: alpha.y + alpha.height - 6 });
  await item(page, 'add-step').click();
  await page.getByTestId('label-editor').press('Escape');
  const f = await onDisk(page, d, (v) => v.mmd.includes('n1["New step"]'));
  expect(declaredLane(f.mmd, 'n1')).toBe('beta');
  expect(pins(f.layout).n1).toMatchObject({ lane: 'beta', across: 0 });
  await saved(page);
  // Below the last lane: Unassigned (A4).
  const gamma = (await page.locator('[data-lane-id="gamma"]').boundingBox())!;
  await rightClick(page, { x, y: gamma.y + gamma.height + 40 });
  await item(page, 'add-terminal').click();
  await page.getByTestId('label-editor').press('Escape');
  const g = await onDisk(page, d, (v) => v.mmd.includes('n2(["New start or end"])'));
  expect(declaredLane(g.mmd, 'n2')).toBe('_unassigned');
  expect(pins(g.layout).n2?.lane).toBe('_unassigned');
  // One undo step each.
  await saved(page);
  await page.getByTestId('undo').click();
  await page.getByTestId('undo').click();
  expect(await onDisk(page, d, (v) => v.mmd === MENUS.mmd && v.layout === MENUS.layout)).toEqual(MENUS);
});

test('canvas add in a lane-free diagram: unlaned, pinned at the click', async ({ page }, info) => {
  const d = makeDiagram(info, { mmd: canon('flowchart LR\n  a["One"]\n  b["Two"]\n  a --> b\n'), config: null, layout: null });
  await open(page, d);
  const a = (await node(page, 'a').boundingBox())!;
  const at = await rightClick(page, { x: a.x, y: a.y + a.height + 90 });
  await item(page, 'add-io').click();
  await page.getByTestId('label-editor').press('Escape');
  const f = await onDisk(page, d, (v) => v.mmd.includes('n1[/"New input or output"/]'));
  expect(declaredLane(f.mmd, 'n1')).toBe('_unassigned');
  await saved(page);
  const nb = (await node(page, 'n1').boundingBox())!;
  expect(Math.abs(nb.x - at.x)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(nb.y - at.y)).toBeLessThanOrEqual(1.5);
});
