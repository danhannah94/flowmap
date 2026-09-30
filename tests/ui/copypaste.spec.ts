// A12 copy, cut, paste and duplicate: Cmd/Ctrl+C copies the selected blocks and the lines between them (in-app
// clipboard, plus Mermaid text on the system clipboard); Cmd/Ctrl+V pastes with ids derived from the originals, at the
// pointer when it is over the canvas, else one step (40 px) from the originals in their own lanes; Cmd/Ctrl+X cuts;
// Cmd/Ctrl+D duplicates. Each is one undo step and selects what it added. Nothing is intercepted inside an editor.
import { expect, test, type Page } from '@playwright/test';
import { parse } from '../../src/core/mmd';
import { attrs, declaredLane, emptyPointInLane, makeDiagram, node, open, pins, saved, settled, type Diagram, type Files } from './helpers';

const SRC: Files = {
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
  config: 'version: 1\ntitle: Source\nnodes:\n  a:\n    owner: sam\n',
  layout: `${JSON.stringify({
    version: 1,
    nodes: {
      a: { lane: 'top', along: 120, across: 40 },
      b: { lane: 'top', along: 420, across: 40, width: 180, height: 70 },
      c: { lane: 'bottom', along: 120, across: 40 },
      d: { lane: 'bottom', along: 420, across: 40 },
    },
  }, null, 2)}\n`,
};

const selectedIds = (page: Page) =>
  page.locator('[data-node-id][data-selected="true"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.nodeId!).sort());
const sameFiles = (a: Files, b: Files) => a.mmd === b.mmd && a.config === b.config && a.layout === b.layout;
const layoutNodes = (f: Files) => (f.layout ? (JSON.parse(f.layout) as { nodes: Record<string, Record<string, unknown>> }).nodes : {});

/** Move the pointer off the canvas (over the top bar), so a paste goes next to the originals. */
async function pointerOffCanvas(page: Page): Promise<void> {
  await page.mouse.move(4, 4);
}

async function undoTo(page: Page, d: Diagram, want: Files): Promise<void> {
  await saved(page);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await settled(page, d, (f) => sameFiles(f, want))).toEqual(want);
}

async function selectAB(page: Page): Promise<void> {
  await node(page, 'a').click();
  await node(page, 'b').click({ modifiers: ['Shift'] });
}

const clipStamp = (page: Page) => page.evaluate(() => {
  const raw = localStorage.getItem('flowmap.clipboard');
  return raw ? (JSON.parse(raw) as { stamp: string }).stamp : null;
});

test('copy and paste in the same diagram: new ids, same lanes, metadata, size and the line between them; repeats step on', async ({ page }, info) => {
  const d = makeDiagram(info, SRC);
  await open(page, d);
  await selectAB(page);
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => clipStamp(page)).not.toBeNull();
  await pointerOffCanvas(page);
  await page.keyboard.press('ControlOrMeta+v');
  const f1 = await settled(page, d, (f) => f.mmd.includes('b-2'));
  expect(f1.mmd).toBe(SRC.mmd
    .replace('    b["Beta"]\n', '    b["Beta"]\n    a-2["Alpha"]\n    b-2["Beta"]\n')
    .replace('  c --> d\n', '  c --> d\n  a-2 -->|go| b-2\n'));
  expect(f1.config).toBe(`${SRC.config}  a-2:\n    owner: sam\n`);
  expect(layoutNodes(f1)['a-2']).toEqual({ lane: 'top', along: 160, across: 80 });
  expect(layoutNodes(f1)['b-2']).toEqual({ lane: 'top', along: 460, across: 80, width: 180, height: 70 });
  expect(await selectedIds(page)).toEqual(['a-2', 'b-2']);
  // Again: the next ids, one more step away (the originals' positions + 80).
  await saved(page);
  await page.keyboard.press('ControlOrMeta+v');
  const f2 = await settled(page, d, (f) => f.mmd.includes('b-3'));
  expect(layoutNodes(f2)['a-3']).toEqual({ lane: 'top', along: 200, across: 120 });
  expect(f2.mmd).toContain('  a-3 -->|go| b-3\n');
  expect(await selectedIds(page)).toEqual(['a-3', 'b-3']);
  // Each paste is one undo step.
  await undoTo(page, d, f1);
  await undoTo(page, d, SRC);
});

test('paste at the pointer: the group\'s top-left lands where the pointer is, in the lane under each block', async ({ page }, info) => {
  const d = makeDiagram(info, SRC);
  await open(page, d);
  await selectAB(page);
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => clipStamp(page)).not.toBeNull();
  const at = await emptyPointInLane(page, 'bottom');
  const zoom = (await node(page, 'a').boundingBox())!.width / (await attrs(node(page, 'a'))).width;
  await page.mouse.move(at.x, at.y);
  await page.keyboard.press('ControlOrMeta+v');
  await settled(page, d, (f) => f.mmd.includes('b-2'));
  await expect(node(page, 'a-2')).toHaveAttribute('data-lane', 'bottom');
  const a2 = (await node(page, 'a-2').boundingBox())!;
  expect(Math.abs(a2.x - at.x)).toBeLessThanOrEqual(zoom + 1);
  expect(Math.abs(a2.y - at.y)).toBeLessThanOrEqual(zoom + 1);
  // b-2 keeps its offset from a-2.
  const b2 = (await node(page, 'b-2').boundingBox())!;
  const a = (await node(page, 'a').boundingBox())!;
  const b = (await node(page, 'b').boundingBox())!;
  expect(Math.abs((b2.x - a2.x) - (b.x - a.x))).toBeLessThanOrEqual(zoom + 1);
  expect(await selectedIds(page)).toEqual(['a-2', 'b-2']);
  await undoTo(page, d, SRC);
});

test('cut removes the blocks (and their lines); pasting gives them back under their own ids, metadata reused', async ({ page }, info) => {
  const d = makeDiagram(info, SRC);
  await open(page, d);
  await node(page, 'a').click();
  await page.keyboard.press('ControlOrMeta+x');
  const cut = await settled(page, d, (f) => !f.mmd.includes('a["Alpha"]'));
  expect(cut.mmd).not.toContain('a -->');
  expect(cut.config).toBe(SRC.config); // UI14: metadata stays
  await expect(node(page, 'a')).toHaveCount(0);
  await pointerOffCanvas(page);
  await saved(page);
  await page.keyboard.press('ControlOrMeta+v');
  const back = await settled(page, d, (f) => f.mmd.includes('a["Alpha"]'));
  expect(declaredLane(back.mmd, 'a')).toBe('top');
  expect(back.config).toBe(SRC.config); // the same entry, not a copy
  expect(layoutNodes(back).a).toEqual({ lane: 'top', along: 160, across: 80 });
  expect(await selectedIds(page)).toEqual(['a']);
  await undoTo(page, d, cut);
  await undoTo(page, d, SRC);
});

test('duplicate (Cmd/Ctrl+D) copies the selection and the lines between them, one step away, as one undo step', async ({ page }, info) => {
  const d = makeDiagram(info, SRC);
  await open(page, d);
  await node(page, 'a').click();
  await node(page, 'c').click({ modifiers: ['ControlOrMeta'] });
  await page.keyboard.press('ControlOrMeta+d');
  const f = await settled(page, d, (x) => x.mmd.includes('c-2'));
  expect(declaredLane(f.mmd, 'a-2')).toBe('top');
  expect(declaredLane(f.mmd, 'c-2')).toBe('bottom');
  expect(f.mmd).toContain('  a-2 --> c-2\n');
  expect(f.mmd).not.toContain('a-2 -->|go|'); // b wasn't duplicated
  expect(layoutNodes(f)['c-2']).toEqual({ lane: 'bottom', along: 160, across: 80 });
  expect(await selectedIds(page)).toEqual(['a-2', 'c-2']);
  // The duplicate didn't touch the clipboard.
  expect(await clipStamp(page)).toBeNull();
  await undoTo(page, d, SRC);
});

test('paste into a second diagram: lanes that exist are used, ids kept when free, metadata and lines come along', async ({ page }, info) => {
  const src = makeDiagram(info, SRC);
  const TARGET: Files = { mmd: 'flowchart LR\n\n  subgraph bottom [Bottom]\n    x["X"]\n  end\n', config: null, layout: null };
  const dst = makeDiagram(info, TARGET);
  await open(page, src);
  await node(page, 'a').click();
  await node(page, 'c').click({ modifiers: ['Shift'] });
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => clipStamp(page)).not.toBeNull();
  await open(page, dst);
  await pointerOffCanvas(page);
  await page.keyboard.press('ControlOrMeta+v');
  const f = await settled(page, dst, (x) => x.mmd.includes('c["Gamma"]'));
  // `top` doesn't exist here: a goes to the first lane; c keeps `bottom`.
  expect(f.mmd).toBe('flowchart LR\n\n  subgraph bottom [Bottom]\n    x["X"]\n    a["Alpha"]\n    c["Gamma"]\n  end\n\n  a --> c\n');
  expect(f.config).toBe('version: 1\nnodes:\n  a:\n    owner: sam\n');
  expect(pins(f.layout)).toEqual({ a: { lane: 'bottom', along: 160, across: 80 }, c: { lane: 'bottom', along: 160, across: 80 } });
  expect(await selectedIds(page)).toEqual(['a', 'c']);
  // Undo deletes the files the paste created.
  await undoTo(page, dst, TARGET);
  expect(src.read()).toEqual(SRC);
});

test('copy writes the fragment to the system clipboard as valid flowmap Mermaid', async ({ page, context }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const d = makeDiagram(info, SRC);
  await open(page, d);
  await selectAB(page);
  await page.keyboard.press('ControlOrMeta+c');
  const want = 'flowchart LR\n\n  subgraph top [Top]\n    a["Alpha"]\n    b["Beta"]\n  end\n\n  a -->|go| b\n';
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(want);
  expect(parse(want).problems.errors).toEqual([]);
});

test('no copy, cut or paste while editing a label: the editor gets the keys', async ({ page }, info) => {
  const d = makeDiagram(info, SRC);
  await open(page, d);
  await node(page, 'c').click();
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(() => clipStamp(page)).not.toBeNull();
  const stamp = await clipStamp(page);
  await node(page, 'a').dblclick();
  const editor = page.getByTestId('label-editor');
  await expect(editor).toBeVisible();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+x');
  await page.keyboard.press('ControlOrMeta+v');
  await page.keyboard.press('ControlOrMeta+d');
  await expect(editor).toBeVisible();
  expect(await clipStamp(page)).toBe(stamp); // the block clipboard is untouched
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(page.locator('[data-node-id]')).toHaveCount(4); // nothing pasted, cut or duplicated
  await saved(page);
  expect(d.read()).toEqual(SRC);
});

test('the shortcut list shows copy, cut, paste and duplicate, and the new mouse gestures', async ({ page }, info) => {
  const d = makeDiagram(info, SRC);
  await open(page, d);
  await page.keyboard.press('?');
  const list = page.getByTestId('shortcuts');
  await expect(list).toBeVisible();
  for (const text of ['Copy the selected blocks', 'Cut the selected blocks', 'Paste at the pointer', 'Duplicate the selected blocks', 'Select the blocks inside a box', 'Pan']) {
    await expect(list).toContainText(text);
  }
});
