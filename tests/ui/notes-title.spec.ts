// Notes (UI41) and the movable, hideable title (UI42), with UI43's "anywhere" for both and the frame (§6) that a
// negative bend point sets. Driven through the §8.3 attributes only (`data-note-id` with integer `data-x`/`data-y`,
// `add-note`, `note-editor`, `title` with `data-x`/`data-y`, `context-menu` items and the controls inside it), checking
// the files on disk against the same change made by hand (§10 Part 3, P26, P27, P29): the config as parsed YAML with
// every untouched line byte-identical, the layout file as parsed JSON (ignoring `hints`); and undo/redo byte for byte.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { parse as parseYaml } from 'yaml';
import { format, parse } from '../../src/core/mmd';
import { attrs, eventually, makeDiagram, node, open, pins, saved, type Diagram, type Files } from './helpers';

const canon = (text: string) => format(parse(text).diagram);

/** A lane-free flowchart with every block pinned, so everything on screen is known exactly. */
const MMD = canon(`flowchart LR
  a["Alpha"]
  b["Beta"]
  a --> b
`);

const CONFIG = 'version: 1\ntitle: Notes and title   # hand-written comment\n';

const LAYOUT = JSON.stringify({
  version: 1,
  nodes: {
    a: { lane: '_unassigned', along: 40, across: 40 },
    b: { lane: '_unassigned', along: 400, across: 40 },
  },
}, null, 2);

const PLAIN: Files = { mmd: MMD, config: CONFIG, layout: LAYOUT };

/** PLAIN plus one hand-written note, placed, with a comment next to it. */
const NOTED: Files = {
  mmd: MMD,
  config: `${CONFIG}notes:\n  note1:\n    text: Freight is the long pole   # from ops\n`,
  layout: editJson(LAYOUT, (js) => { js.notes = { note1: { x: 60, y: 200 } }; }),
};

// ---- Helpers ---------------------------------------------------------------------------------------------------

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function editJson(text: string, fn: (js: Json) => void): string {
  const js = JSON.parse(text) as Json;
  fn(js);
  return JSON.stringify(js, null, 2);
}

const note = (page: Page, id: string) => page.locator(`[data-note-id="${id}"]`);
const title = (page: Page) => page.getByTestId('title');
const editor = (page: Page) => page.getByTestId('note-editor');
const menu = (page: Page) => page.getByTestId('context-menu');
const menuItem = (page: Page, name: string) => menu(page).locator(`[data-menu-item="${name}"]`);

async function xy(loc: Locator): Promise<{ x: number; y: number }> {
  return loc.evaluate((el) => {
    const d = (el as HTMLElement).dataset;
    return { x: Number(d.x), y: Number(d.y) };
  });
}

/** The world (diagram) -> screen mapping, measured from a block's `data-x`/`data-width` and its box on screen. */
async function view(page: Page) {
  const a = await attrs(node(page, 'a'));
  const box = (await node(page, 'a').boundingBox())!;
  const z = box.width / a.width;
  const ox = box.x - a.x * z;
  const oy = box.y - a.y * z;
  return {
    z,
    screen: (p: { x: number; y: number }) => ({ x: p.x * z + ox, y: p.y * z + oy }),
    world: (p: { x: number; y: number }) => ({ x: (p.x - ox) / z, y: (p.y - oy) / z }),
  };
}

/** UI10: rounding a dropped corner to whole pixels, halves toward −∞. */
const round = (v: number) => Math.ceil(v - 0.5);

/** The layout file as parsed, without `hints` (§10 Part 3). */
function layoutOf(text: string | null): Json | null {
  if (text === null) return null;
  const js = JSON.parse(text) as Json;
  delete js.hints;
  return js;
}

/**
 * The files match a hand edit: the `.mmd` byte for byte, the config as parsed YAML with every untouched line
 * byte-identical (the lines the hand edit kept from the original appear, in order), the layout as parsed JSON.
 */
function expectHandEdit(actual: Files, expected: Files, original: Files): void {
  expect(actual.mmd).toBe(expected.mmd);
  if (expected.config === null) expect(actual.config).toBeNull();
  else {
    expect(actual.config).not.toBeNull();
    expect(parseYaml(actual.config!)).toEqual(parseYaml(expected.config));
    const before = new Set((original.config ?? '').split('\n'));
    const kept = expected.config.split('\n').filter((l) => l !== '' && before.has(l));
    const lines = actual.config!.split('\n');
    let at = 0;
    for (const line of kept) {
      const i = lines.indexOf(line, at);
      expect(i, `untouched line kept byte for byte: ${JSON.stringify(line)}`).toBeGreaterThanOrEqual(0);
      at = i + 1;
    }
  }
  expect(layoutOf(actual.layout)).toEqual(layoutOf(expected.layout));
}

/** Wait until the files on disk match the hand edit, then check them properly. */
async function expectFiles(page: Page, d: Diagram, expected: Files, original: Files): Promise<Files> {
  const same = (f: Files) => {
    try {
      expectHandEdit(f, expected, original);
      return true;
    } catch {
      return false;
    }
  };
  const files = await eventually(() => d.read(), same, 3000);
  expectHandEdit(files, expected, original);
  await saved(page);
  return d.read();
}

/** Undo restores all three files byte for byte; redo re-applies the edit byte for byte (UI28). */
async function expectUndoRedo(page: Page, d: Diagram, before: Files, after: Files): Promise<void> {
  await page.getByTestId('undo').click();
  const undone = await eventually(() => d.read(), (f) => f.mmd === before.mmd && f.config === before.config && f.layout === before.layout, 3000);
  expect(undone).toEqual(before);
  await saved(page);
  await page.getByTestId('redo').click();
  const redone = await eventually(() => d.read(), (f) => f.mmd === after.mmd && f.config === after.config && f.layout === after.layout, 3000);
  expect(redone).toEqual(after);
  await saved(page);
}

/** The note's text exactly, line breaks included (the element's text, §8.3). */
const textOf = (loc: Locator) => loc.evaluate((el) => el.textContent);

/** An empty spot on the canvas (nothing drawn under it), in screen px, near a preferred point. */
async function emptySpot(page: Page, near: { x: number; y: number }): Promise<{ x: number; y: number }> {
  return page.evaluate(({ x, y }) => {
    for (let r = 0; r < 400; r += 12) {
      for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) {
        const el = document.elementFromPoint(x + dx!, y + dy!);
        if (!el || !el.closest('[data-testid="canvas"]')) continue;
        if (el.closest('[data-node-id], [data-edge-id], [data-note-id], [data-testid="title"], [data-testid="legend"], [data-canvas-control], button')) continue;
        return { x: x + dx!, y: y + dy! };
      }
    }
    throw new Error('no empty spot');
  }, near);
}

async function rightClick(page: Page, p: { x: number; y: number }): Promise<void> {
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(menu(page)).toBeVisible();
}

async function rightClickOn(page: Page, loc: Locator): Promise<void> {
  const b = (await loc.boundingBox())!;
  await rightClick(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
}

/** Drag `loc` from its centre by (dx, dy) screen px in small steps, Alt held so snapping can't change the result. */
async function dragBy(page: Page, loc: Locator, dx: number, dy: number, opts: { alt?: boolean } = { alt: true }) {
  const b = (await loc.boundingBox())!;
  const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  if (opts.alt) await page.keyboard.down('Alt');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + (dx * i) / 10, from.y + (dy * i) / 10);
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up('Alt');
}

/** Type text in the note editor: `\n` is Enter (a new line, UI41). */
async function typeNote(page: Page, text: string): Promise<void> {
  const parts = text.split('\n');
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) await page.keyboard.press('Enter');
    if (parts[i]) await page.keyboard.type(parts[i]!);
  }
}

const commitKey = 'ControlOrMeta+Enter';

// ---- Notes: add (UI41, P26) ----------------------------------------------------------------------------------

test('add a note from the toolbar: nothing is written until a commit with text, which is one step', async ({ page }, info) => {
  const d = makeDiagram(info, PLAIN);
  await open(page, d);
  const v = await view(page);

  // Escape: nothing.
  await page.getByTestId('add-note').click();
  await expect(editor(page)).toBeFocused();
  await typeNote(page, 'never mind');
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  // Blank text committed: nothing.
  await page.getByTestId('add-note').click();
  await typeNote(page, '   \n  ');
  await page.keyboard.press(commitKey);
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator('[data-note-id]')).toHaveCount(0);
  await page.waitForTimeout(300);
  await saved(page);
  expect(d.read()).toEqual(PLAIN);
  await expect(page.getByTestId('undo')).toBeDisabled();

  // Enter adds a line; Cmd/Ctrl+Enter commits; the trailing line break isn't written.
  await page.getByTestId('add-note').click();
  const editorBox = (await editor(page).boundingBox())!;
  await typeNote(page, 'Freight is\nthe long pole\n');
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press(commitKey);
  await expect(editor(page)).toHaveCount(0);
  await expect(note(page, 'note1')).toBeVisible();
  expect(await textOf(note(page, 'note1'))).toBe('Freight is\nthe long pole');

  // At the centre of the view: the note's top-left is the canvas's centre, in diagram coordinates.
  const at = await xy(note(page, 'note1'));
  const canvas = (await page.getByTestId('canvas').boundingBox())!;
  const centre = v.world({ x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 });
  expect(Math.abs(at.x - centre.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(at.y - centre.y)).toBeLessThanOrEqual(1);
  expect(Number.isInteger(at.x) && Number.isInteger(at.y)).toBe(true);
  // The editor was where the note now is (it opens in place).
  const noteBox = (await note(page, 'note1').boundingBox())!;
  expect(Math.abs(noteBox.x - editorBox.x)).toBeLessThan(20);
  expect(Math.abs(noteBox.y - editorBox.y)).toBeLessThan(20);

  const after = await expectFiles(page, d, {
    mmd: MMD,
    config: `${CONFIG}notes:\n  note1:\n    text: "Freight is\\nthe long pole"\n`,
    layout: editJson(LAYOUT, (js) => { js.notes = { note1: at }; }),
  }, PLAIN);
  // One step: a single undo takes away the text and the position together.
  await expectUndoRedo(page, d, PLAIN, after);
  await page.getByTestId('undo').click();
  await eventually(() => d.read(), (f) => f.config === PLAIN.config);
  await expect(page.getByTestId('undo')).toBeDisabled();
});

test('add a note from the canvas menu at the clicked spot; clicking away commits', async ({ page }, info) => {
  const d = makeDiagram(info, PLAIN);
  await open(page, d);
  const v = await view(page);
  const bBox = (await node(page, 'b').boundingBox())!;
  const spot = await emptySpot(page, { x: bBox.x + 40, y: bBox.y + bBox.height + 120 });
  await rightClick(page, spot);
  await menuItem(page, 'add-note').click();
  await expect(menu(page)).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  await typeNote(page, 'Ask finance');
  // Click away (empty canvas elsewhere): commits.
  await page.mouse.click(spot.x - 200, spot.y + 150);
  await expect(editor(page)).toHaveCount(0);
  await expect(note(page, 'note1')).toHaveText('Ask finance');

  const want = v.world(spot);
  const at = await xy(note(page, 'note1'));
  expect(at).toEqual({ x: round(want.x), y: round(want.y) });
  const after = await expectFiles(page, d, {
    mmd: MMD,
    config: `${CONFIG}notes:\n  note1:\n    text: Ask finance\n`,
    layout: editJson(LAYOUT, (js) => { js.notes = { note1: at }; }),
  }, PLAIN);
  await expectUndoRedo(page, d, PLAIN, after);

  // The menu's add-note on a canvas that already has a note: the next free id.
  await rightClick(page, await emptySpot(page, { x: spot.x + 250, y: spot.y }));
  await menuItem(page, 'add-note').click();
  await typeNote(page, 'Second');
  await page.keyboard.press(commitKey);
  await expect(note(page, 'note2')).toHaveText('Second');
});

test('a note dropped or added left of and above everything stores negative values (UI43, P29)', async ({ page }, info) => {
  const d = makeDiagram(info, PLAIN);
  await open(page, d);
  const v = await view(page);
  // Above and left of the title, which sits above the diagram's top-left corner.
  const t = (await title(page).boundingBox())!;
  const spot = await emptySpot(page, { x: t.x - 60, y: t.y - 50 });
  await rightClick(page, spot);
  await menuItem(page, 'add-note').click();
  await typeNote(page, 'Up here');
  await page.keyboard.press(commitKey);
  const at = await xy(note(page, 'note1'));
  const want = v.world(spot);
  expect(at).toEqual({ x: round(want.x), y: round(want.y) });
  expect(at.x).toBeLessThan(0);
  expect(at.y).toBeLessThan(0);
  const added = await expectFiles(page, d, {
    mmd: MMD,
    config: `${CONFIG}notes:\n  note1:\n    text: Up here\n`,
    layout: editJson(LAYOUT, (js) => { js.notes = { note1: at }; }),
  }, PLAIN);

  // Drag it further up-left: stored exactly as dropped; nothing else moves on screen (notes set no frame).
  const aBefore = (await node(page, 'a').boundingBox())!;
  await dragBy(page, note(page, 'note1'), -70 * v.z, -40 * v.z);
  await expect.poll(async () => xy(note(page, 'note1'))).toEqual({ x: at.x - 70, y: at.y - 40 });
  const after = await expectFiles(page, d, {
    ...added,
    layout: editJson(LAYOUT, (js) => { js.notes = { note1: { x: at.x - 70, y: at.y - 40 } }; }),
  }, added);
  expect((await node(page, 'a').boundingBox())).toEqual(aBefore);
  await expectUndoRedo(page, d, added, after);
});

// ---- Notes: edit, move, style, delete (UI41, P26) ------------------------------------------------------------

test('double-click edits a note in place: multi-line text; Escape keeps it; blank deletes it', async ({ page }, info) => {
  const d = makeDiagram(info, NOTED);
  await open(page, d);
  await expect(note(page, 'note1')).toHaveText('Freight is the long pole');
  expect(await xy(note(page, 'note1'))).toEqual({ x: 60, y: 200 });

  // Escape: unchanged.
  await note(page, 'note1').dblclick();
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue('Freight is the long pole');
  await page.keyboard.press('ControlOrMeta+a');
  await typeNote(page, 'scrap this');
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(d.read()).toEqual(NOTED);

  // New text over two lines, committed with Cmd/Ctrl+Enter.
  await note(page, 'note1').dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await typeNote(page, 'Freight takes\n3 to 5 days');
  await page.keyboard.press(commitKey);
  expect(await textOf(note(page, 'note1'))).toBe('Freight takes\n3 to 5 days');
  const edited = await expectFiles(page, d, {
    ...NOTED,
    config: `${CONFIG}notes:\n  note1:\n    text: "Freight takes\\n3 to 5 days"\n`,
  }, NOTED);
  await expectUndoRedo(page, d, NOTED, edited);

  // Blank text deletes the note: its config entry (and the emptied `notes`) and its position.
  await note(page, 'note1').dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.press(commitKey);
  await expect(note(page, 'note1')).toHaveCount(0);
  const gone = await expectFiles(page, d, PLAIN, edited);
  await expectUndoRedo(page, d, edited, gone);
});

test('drag a note to move it: one step; snapping to a block, and Alt turns it off', async ({ page }, info) => {
  const d = makeDiagram(info, NOTED);
  await open(page, d);
  const v = await view(page);
  const a = await attrs(node(page, 'a'));

  // Alt held: exactly as dropped.
  await dragBy(page, note(page, 'note1'), 33 * v.z, -21 * v.z);
  await expect.poll(async () => xy(note(page, 'note1'))).toEqual({ x: 93, y: 179 });
  const moved = await expectFiles(page, d, {
    ...NOTED,
    layout: editJson(LAYOUT, (js) => { js.notes = { note1: { x: 93, y: 179 } }; }),
  }, NOTED);
  await expectUndoRedo(page, d, NOTED, moved);

  // Without Alt: dropped 3 px right of block a's left edge, it snaps onto it (UI39).
  const cur = await xy(note(page, 'note1'));
  await dragBy(page, note(page, 'note1'), (a.x + 3 - cur.x) * v.z, 30 * v.z, { alt: false });
  await expect.poll(async () => (await xy(note(page, 'note1'))).x).toBe(a.x);
  await expectFiles(page, d, {
    ...NOTED,
    layout: editJson(LAYOUT, (js) => { js.notes = { note1: { x: a.x, y: cur.y + 30 } }; }),
  }, moved);
});

test('a note is selected on its own; Delete removes it; the arrow keys move it', async ({ page }, info) => {
  const d = makeDiagram(info, NOTED);
  await open(page, d);
  await node(page, 'a').click();
  await expect(node(page, 'a')).toHaveAttribute('data-selected', 'true');
  await note(page, 'note1').click();
  await expect(note(page, 'note1')).toHaveAttribute('data-selected', 'true');
  await expect(node(page, 'a')).toHaveAttribute('data-selected', 'false');

  // An arrow key moves the note 10 px (and never a block, since none is selected).
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => xy(note(page, 'note1'))).toEqual({ x: 70, y: 200 });
  const nudged = await expectFiles(page, d, {
    ...NOTED,
    layout: editJson(LAYOUT, (js) => { js.notes = { note1: { x: 70, y: 200 } }; }),
  }, NOTED);
  expect(pins(nudged.layout)).toEqual(pins(NOTED.layout));

  await page.keyboard.press('Delete');
  await expect(note(page, 'note1')).toHaveCount(0);
  const gone = await expectFiles(page, d, PLAIN, nudged);
  await expectUndoRedo(page, d, nudged, gone);

  // Selecting a block drops the note's selection.
  await page.getByTestId('undo').click();
  await expect(note(page, 'note1')).toBeVisible();
  await note(page, 'note1').click();
  await node(page, 'b').click();
  await expect(note(page, 'note1')).toHaveAttribute('data-selected', 'false');
});

test('the note menu: edit, font size, bold and colour; defaults remove their keys; delete', async ({ page }, info) => {
  const d = makeDiagram(info, NOTED);
  await open(page, d);

  await rightClickOn(page, note(page, 'note1'));
  const names = await menu(page).locator('[data-menu-item]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.menuItem));
  expect(names).toEqual(['edit-note', 'font-size', 'bold', 'color', 'delete']);

  // edit-note opens the editor.
  await menuItem(page, 'edit-note').click();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('Escape');

  // Font size 20, then bold, then a light and dark colour: each its own step.
  await rightClickOn(page, note(page, 'note1'));
  await menuItem(page, 'font-size').click();
  const size = menu(page).locator('[data-prop="font_size"]');
  await size.fill('20');
  await size.press('Enter');
  const sized = await expectFiles(page, d, {
    ...NOTED,
    config: `${CONFIG}notes:\n  note1:\n    text: Freight is the long pole   # from ops\n    font_size: 20\n`,
  }, NOTED);
  await page.keyboard.press('Escape');
  await expectUndoRedo(page, d, NOTED, sized);

  await rightClickOn(page, note(page, 'note1'));
  await menuItem(page, 'bold').click();
  const bold = await expectFiles(page, d, {
    ...NOTED,
    config: `${CONFIG}notes:\n  note1:\n    text: Freight is the long pole   # from ops\n    font_size: 20\n    bold: true\n`,
  }, sized);

  await rightClickOn(page, note(page, 'note1'));
  await expect(menuItem(page, 'bold')).toHaveAttribute('aria-checked', 'true');
  await menuItem(page, 'color').click();
  const light = menu(page).locator('[data-prop="color"] [data-variant="light"]');
  await light.fill('#B85450');
  await light.press('Enter');
  const dark = menu(page).locator('[data-prop="color"] [data-variant="dark"]');
  await dark.fill('#f08080');
  await dark.press('Enter');
  const coloured = await expectFiles(page, d, {
    ...NOTED,
    config: `${CONFIG}notes:\n  note1:\n    text: Freight is the long pole   # from ops\n    font_size: 20\n    bold: true\n    color: {light: "#b85450", dark: "#f08080"}\n`,
  }, bold);
  await page.keyboard.press('Escape');

  // The defaults remove their keys: 14 px, not bold, no colour (an emptied light value clears it).
  await rightClickOn(page, note(page, 'note1'));
  await menuItem(page, 'font-size').click();
  await menu(page).locator('[data-prop="font_size"]').fill('14');
  await menu(page).locator('[data-prop="font_size"]').press('Enter');
  await page.keyboard.press('Escape');
  await rightClickOn(page, note(page, 'note1'));
  await menuItem(page, 'bold').click();
  await rightClickOn(page, note(page, 'note1'));
  await menuItem(page, 'color').click();
  await menu(page).locator('[data-prop="color"] [data-variant="light"]').fill('');
  await menu(page).locator('[data-prop="color"] [data-variant="light"]').press('Enter');
  const plain = await expectFiles(page, d, NOTED, coloured);
  expect(plain.config).toBe(NOTED.config); // back to the original bytes
  await page.keyboard.press('Escape');

  // Out of range is refused (§4: 10 to 48), and nothing is written.
  await rightClickOn(page, note(page, 'note1'));
  await menuItem(page, 'font-size').click();
  await menu(page).locator('[data-prop="font_size"]').fill('49');
  await menu(page).locator('[data-prop="font_size"]').press('Enter');
  await page.waitForTimeout(300);
  expect(d.read().config).toBe(NOTED.config);
  await page.keyboard.press('Escape');

  // Delete.
  await rightClickOn(page, note(page, 'note1'));
  await menuItem(page, 'delete').click();
  await expect(note(page, 'note1')).toHaveCount(0);
  const gone = await expectFiles(page, d, PLAIN, plain);
  await expectUndoRedo(page, d, plain, gone);
});

// ---- The title (UI42, P27) -----------------------------------------------------------------------------------

test('the title: drag it, reset its position, hide it and show it again; double-click still edits it', async ({ page }, info) => {
  const d = makeDiagram(info, PLAIN);
  await open(page, d);
  const v = await view(page);
  await expect(title(page)).toHaveText('Notes and title');
  const start = await xy(title(page));
  expect(Number.isInteger(start.x) && Number.isInteger(start.y)).toBe(true);

  // No stored position: no reset-position item.
  await rightClickOn(page, title(page));
  const names = await menu(page).locator('[data-menu-item]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.menuItem));
  expect(names).toEqual(['edit-title', 'hide-title']);
  await page.keyboard.press('Escape');

  // Drag it (Alt: exactly as dropped), including above and left of everything.
  await dragBy(page, title(page), -50 * v.z, -30 * v.z);
  const at = { x: start.x - 50, y: start.y - 30 };
  await expect.poll(async () => xy(title(page))).toEqual(at);
  expect(at.x).toBeLessThan(0);
  const moved = await expectFiles(page, d, { ...PLAIN, layout: editJson(LAYOUT, (js) => { js.title = at; }) }, PLAIN);
  await expectUndoRedo(page, d, PLAIN, moved);

  // Double-click still edits it (UI22), where it now is.
  await title(page).dblclick();
  const te = page.getByTestId('title-editor');
  await expect(te).toBeFocused();
  const teBox = (await te.boundingBox())!;
  const tBox = (await title(page).boundingBox())!;
  expect(Math.abs(teBox.y + teBox.height / 2 - (tBox.y + tBox.height / 2))).toBeLessThan(12);
  await page.keyboard.press('Escape');

  // Reset its position.
  await rightClickOn(page, title(page));
  await menuItem(page, 'reset-position').click();
  await expect.poll(async () => xy(title(page))).toEqual(start);
  const reset = await expectFiles(page, d, PLAIN, moved);
  await expectUndoRedo(page, d, moved, reset);

  // Hide it: `show_title: false`, and it's gone from the canvas.
  await rightClickOn(page, title(page));
  await menuItem(page, 'hide-title').click();
  await expect(title(page)).toHaveCount(0);
  const hidden = await expectFiles(page, d, { ...reset, config: `${CONFIG}show_title: false\n` }, reset);
  await expectUndoRedo(page, d, reset, hidden);

  // Show it again from the canvas menu (only offered while hidden): the key goes, bytes as before.
  await rightClick(page, await emptySpot(page, { x: 700, y: 700 }));
  await menuItem(page, 'show-title').click();
  await expect(title(page)).toBeVisible();
  const shown = await expectFiles(page, d, reset, hidden);
  expect(shown.config).toBe(reset.config);
  await expectUndoRedo(page, d, hidden, shown);
  await rightClick(page, await emptySpot(page, { x: 700, y: 700 }));
  await expect(menuItem(page, 'add-note')).toBeVisible();
  await expect(menuItem(page, 'show-title')).toHaveCount(0);
});

// ---- The frame: a negative bend point (§6 Frame) -------------------------------------------------------------

/** A line bent through a point stored before the flow's start and above the first lane: T = 80, U = 30. */
const BENT: Files = {
  mmd: MMD,
  config: `${CONFIG}notes:\n  note1:\n    text: Pinned note\n`,
  layout: editJson(LAYOUT, (js) => {
    js.edges = { 'a->b': { points: [{ lane: '_unassigned', along: -80, across: -30 }] } };
    js.notes = { note1: { x: 60, y: 200 } };
  }),
};

test('a negative bend point shifts the frame: drops, nudges and new notes still land exactly, nothing jumps', async ({ page }, info) => {
  const d = makeDiagram(info, BENT);
  await open(page, d);
  // Drawn at stored + frame (T = 80 along = x, U = 30 across = y in a lane-free LR diagram).
  expect((await attrs(node(page, 'a'))).x).toBe(40 + 80);
  expect((await attrs(node(page, 'a'))).y).toBe(40 + 30);
  expect(await xy(note(page, 'note1'))).toEqual({ x: 60 + 80, y: 200 + 30 });
  const v = await view(page);

  // Nudge a block: its pin moves by exactly 10, and nothing else moves on screen. (Selecting it opens the side
  // column, which may pan the view; measure after that.)
  await node(page, 'a').click();
  await page.waitForTimeout(500);
  const aBefore = (await node(page, 'a').boundingBox())!;
  const bSel = (await node(page, 'b').boundingBox())!;
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => pins((d.read()).layout).a?.along).toBe(50);
  expect(pins(d.read().layout).a).toEqual({ lane: '_unassigned', along: 50, across: 40 });
  await saved(page);
  const aAfter = (await node(page, 'a').boundingBox())!;
  expect(Math.abs(aAfter.x - (aBefore.x + 10 * v.z))).toBeLessThanOrEqual(1);
  expect(Math.abs(aAfter.y - aBefore.y)).toBeLessThanOrEqual(1);
  expect((await node(page, 'b').boundingBox())).toEqual(bSel);

  // Drag the (still selected) block further left than the bend point (T grows from 80 to 150): stored exactly as
  // dropped, and the view pans by the change, so the other block, the note and the dropped block itself are where
  // they should be on screen.
  const v2 = await view(page);
  const bScreen = (await node(page, 'b').boundingBox())!;
  const noteScreen = (await note(page, 'note1').boundingBox())!;
  const aScreen = (await node(page, 'a').boundingBox())!;
  await dragBy(page, node(page, 'a'), -(50 + 150) * v2.z, 0); // along 50 -> -150
  await expect.poll(async () => pins(d.read().layout).a?.along).toBe(-150);
  expect(pins(d.read().layout).a).toEqual({ lane: '_unassigned', along: -150, across: 40 });
  await saved(page);
  expect((await attrs(node(page, 'a'))).x).toBe(0); // T is now 150: the output still starts at 0
  const aLanded = (await node(page, 'a').boundingBox())!;
  expect(Math.abs(aLanded.x - (aScreen.x - 200 * v2.z))).toBeLessThanOrEqual(1);
  expect(Math.abs(aLanded.y - aScreen.y)).toBeLessThanOrEqual(1);
  const bNow = (await node(page, 'b').boundingBox())!;
  expect(Math.abs(bNow.x - bScreen.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(bNow.y - bScreen.y)).toBeLessThanOrEqual(1);
  const noteNow = (await note(page, 'note1').boundingBox())!;
  expect(Math.abs(noteNow.x - noteScreen.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(noteNow.y - noteScreen.y)).toBeLessThanOrEqual(1);

  // Move the note and add one: each is stored relative to the frame, and shows where it was put.
  const v3 = await view(page);
  const n0 = await xy(note(page, 'note1'));
  await dragBy(page, note(page, 'note1'), 25 * v3.z, 15 * v3.z);
  await expect.poll(async () => xy(note(page, 'note1'))).toEqual({ x: n0.x + 25, y: n0.y + 15 });
  await expect.poll(() => (JSON.parse(d.read().layout!) as Json).notes.note1).toEqual({ x: 60 + 25, y: 200 + 15 });

  const spot = await emptySpot(page, { x: noteNow.x + 40, y: noteNow.y + 120 });
  await rightClick(page, spot);
  await menuItem(page, 'add-note').click();
  await typeNote(page, 'Here');
  await page.keyboard.press(commitKey);
  await expect(note(page, 'note2')).toBeVisible();
  const added = (await note(page, 'note2').boundingBox())!;
  expect(Math.abs(added.x - spot.x)).toBeLessThanOrEqual(1.5 * v3.z + 0.5);
  expect(Math.abs(added.y - spot.y)).toBeLessThanOrEqual(1.5 * v3.z + 0.5);
  const drawn = await xy(note(page, 'note2'));
  // T = 150 and U = 30 now: the file holds the drawn position less the frame.
  await expect.poll(() => (JSON.parse(d.read().layout!) as Json).notes.note2).toEqual({ x: drawn.x - 150, y: drawn.y - 30 });
});
