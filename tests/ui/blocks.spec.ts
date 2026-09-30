// Blocks and lines (UI7, UI9, UI12–UI17; U2, U3; parity P2, P4–P8, P10, P11; undo P20; keyboard UI33).
// Driven through the §8.3 attributes; every edit is checked on disk. Parity is checked the way the acceptance suite
// does (§10 Part 3): the same change made by hand (then `fmt` on the `.mmd`) must give the same `.mmd` bytes, the same
// config as parsed YAML with untouched lines byte-identical, and the same layout file as parsed JSON (ignoring hints).
import { expect, test, type Page } from '@playwright/test';
import { parseDocument } from 'yaml';
import { format, parse } from '../../src/core/mmd';
import { attrs, dragFromTo, emptyPointInLane, expectMatchesCli, makeDiagram, node, open, pins, PR, saved, settled, type Diagram, type Files } from './helpers';

// ---- parity helpers ----------------------------------------------------------------------------------------------

/** Replace each `find` (which must occur exactly once) with its replacement: a hand edit. */
function edit(text: string, ...pairs: [string, string][]): string {
  let out = text;
  for (const [find, replace] of pairs) {
    const at = out.indexOf(find);
    if (at < 0) throw new Error(`hand edit: "${find}" not found`);
    if (out.indexOf(find, at + 1) >= 0) throw new Error(`hand edit: "${find}" occurs more than once`);
    out = out.slice(0, at) + replace + out.slice(at + find.length);
  }
  return out;
}

/** `flowmap fmt` on hand-edited text. */
function canon(text: string): string {
  const { diagram, problems } = parse(text);
  if (problems.errors.length) throw new Error(`hand edit has errors: ${JSON.stringify(problems.errors)}`);
  return format(diagram);
}

const yamlJs = (text: string | null) => (text === null ? null : parseDocument(text).toJS());

/** The layout file as parsed JSON, without `hints` (builder-defined; the acceptance suite ignores it). */
function layoutJs(text: string | null): unknown {
  if (text === null) return null;
  const { hints: _hints, ...rest } = JSON.parse(text) as Record<string, unknown>;
  return rest;
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

/** Wait (up to 2 s) until the files on disk satisfy `check`, then return them. */
/** The files once the action has landed and the page has saved (helpers `settled`). */
const onDisk = (page: Page, d: Diagram, check: (f: Files) => boolean): Promise<Files> => settled(page, d, check);

/** Undo restores `before` byte for byte; redo re-applies `after` byte for byte (UI28, P20). */
async function expectUndoRedo(page: Page, d: Diagram, before: Files, after: Files): Promise<void> {
  await saved(page);
  await page.getByTestId('undo').click();
  expect(await onDisk(page, d, (f) => sameFiles(f, before))).toEqual(before);
  await saved(page);
  await page.getByTestId('redo').click();
  expect(await onDisk(page, d, (f) => sameFiles(f, after))).toEqual(after);
  await saved(page);
}

const sameFiles = (a: Files, b: Files) => a.mmd === b.mmd && a.config === b.config && a.layout === b.layout;

// ---- canvas helpers ------------------------------------------------------------------------------------------------

/** A screen point on an edge's own line, where a click reaches the edge (not a block, label or other edge). */
async function edgePoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  return page.evaluate((id) => {
    const g = document.querySelector(`[data-edge-id="${CSS.escape(id)}"]`);
    if (!g) throw new Error(`no edge ${id}`);
    const path = g.querySelector('path')!;
    const len = path.getTotalLength();
    const m = path.getScreenCTM()!;
    for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
      const p = path.getPointAtLength(len * f);
      const x = p.x * m.a + p.y * m.c + m.e;
      const y = p.x * m.b + p.y * m.d + m.f;
      if (document.elementFromPoint(x, y)?.closest('[data-edge-id]') === g) return { x, y };
    }
    throw new Error(`no clickable point on edge ${id}`);
  }, id);
}

async function selectEdge(page: Page, id: string, opts: { shift?: boolean } = {}): Promise<void> {
  const p = await edgePoint(page, id);
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  if (opts.shift) await page.keyboard.up('Shift');
  await expect(page.locator(`[data-edge-id="${id}"]`)).toHaveAttribute('data-selected', 'true');
}

async function centreOf(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const b = (await page.locator(selector).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

const edge = (page: Page, id: string) => page.locator(`[data-edge-id="${id}"]`);
const picker = (page: Page) => page.getByTestId('shape-picker');

// The declarations of the fixture blocks used below (canonical form).
const P03 = '    p03["Send it back with what is missing"]';
const DECL: Record<string, (id: string, label: string) => string> = {
  step: (id, l) => `${id}["${l}"]`,
  decision: (id, l) => `${id}{"${l}"}`,
  terminal: (id, l) => `${id}(["${l}"])`,
  subprocess: (id, l) => `${id}[["${l}"]]`,
  database: (id, l) => `${id}[("${l}")]`,
  io: (id, l) => `${id}[/"${l}"/]`,
  document: (id, l) => `${id}@{ shape: doc, label: "${l}" }`,
  delay: (id, l) => `${id}@{ shape: delay, label: "${l}" }`,
};

// ---- UI7 change shape ----------------------------------------------------------------------------------------------

test('shape picker: shown for exactly one selected block; every shape rewrites the declaration in place', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await expect(picker(page)).toHaveCount(0);
  await node(page, 'p03').click();
  await expect(picker(page)).toBeVisible();
  await expect(picker(page).locator('[data-shape]')).toHaveCount(8);
  // Two blocks selected: no picker.
  await node(page, 'p01').click({ modifiers: ['Shift'] });
  await expect(picker(page)).toHaveCount(0);
  await node(page, 'p03').click();
  await expect(picker(page)).toBeVisible();

  // Every shape, in turn (P2), each one undo step. Same id, label, lane, position in the file; config untouched.
  const label = 'Send it back with what is missing';
  const states: Files[] = [PR];
  for (const shape of ['decision', 'terminal', 'subprocess', 'database', 'io', 'document', 'delay', 'step']) {
    await picker(page).locator(`[data-shape="${shape}"]`).click();
    const want = canon(edit(PR.mmd, [P03, `    ${DECL[shape]!('p03', label)}`]));
    const files = await onDisk(page, d, (f) => f.mmd === want);
    expect(files.mmd).toBe(want);
    expect(files.config).toBe(PR.config);
    expect(files.layout).toBe(PR.layout);
    await expect(node(page, 'p03')).toHaveAttribute('data-kind', shape);
    await expect(node(page, 'p03')).toHaveAttribute('data-selected', 'true');
    states.push(files);
    await saved(page);
  }
  // Undo walks back through every shape byte for byte; redo walks forward again.
  for (let i = states.length - 2; i >= 0; i--) {
    await page.getByTestId('undo').click();
    expect(await onDisk(page, d, (f) => sameFiles(f, states[i]!))).toEqual(states[i]);
    await saved(page);
  }
  for (let i = 1; i < states.length; i++) {
    await page.getByTestId('redo').click();
    expect(await onDisk(page, d, (f) => sameFiles(f, states[i]!))).toEqual(states[i]);
    await saved(page);
  }
  await expectMatchesCli(page, d);
});

test('shape picker: changing to document or delay drops a class suffix (P2)', async ({ page }, info) => {
  const mmd = edit(PR.mmd, ['  f03 --> f04\n', '  f03 --> f04\n\n  class p03 hot\n']).replace(P03, `${P03}:::hot`);
  const start: Files = { ...PR, mmd: canon(mmd) };
  const d = makeDiagram(info, start);
  await open(page, d);
  await node(page, 'p03').click();
  await picker(page).locator('[data-shape="io"]').click();
  const io = canon(edit(start.mmd, [`${P03}:::hot`, '    p03[/"Send it back with what is missing"/]:::hot']));
  await onDisk(page, d, (f) => f.mmd === io);
  expect(d.read().mmd).toBe(io);
  await picker(page).locator('[data-shape="document"]').click();
  const doc = canon(edit(start.mmd, [`${P03}:::hot`, '    p03@{ shape: doc, label: "Send it back with what is missing" }']));
  expect((await onDisk(page, d, (f) => f.mmd === doc)).mmd).toBe(doc);
  // The pass-through `class` line is text-only and stays.
  expect(doc).toContain('  class p03 hot');
});

// ---- UI9 rename id -------------------------------------------------------------------------------------------------

test('rename id: refusals show id-error and change nothing; a good id renames every reference (P4)', async ({ page }, info) => {
  // r01 has edges, metadata, a pin and a style rule that matches its id.
  const config = edit(PR.config!, ['nodes:\n', '  - legend: The form\n    match: {id: r01}\n    style: {border_style: dashed}\nnodes:\n']);
  const layout = '{\n  "version": 1,\n  "nodes": {\n    "r01": { "lane": "requester", "along": 260, "across": 30 },\n    "closed": { "lane": "requester", "along": 1400, "across": 40 }\n  }\n}\n';
  const start: Files = { mmd: PR.mmd, config, layout };
  const d = makeDiagram(info, start);
  await open(page, d);
  await node(page, 'r01').click();
  await page.keyboard.press('F2');
  const editor = page.getByTestId('id-editor');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue('r01');

  // Taken, reserved, bad form: refused with a message; the editor stays open; nothing is written.
  for (const bad of ['m01', 'end', 'end_x', '9lives', 'a--b', 'trailing-', 'has space', 'purchasing']) {
    await editor.fill(bad);
    await editor.press('Enter');
    await expect(page.getByTestId('id-error')).toContainText(`"${bad}"`);
    await expect(editor).toBeVisible();
  }
  // Typing in the editor never fires shortcuts (Backspace/Delete don't delete the block, mod+D doesn't duplicate).
  await editor.fill('request');
  await editor.press('Backspace');
  await editor.press('ControlOrMeta+d');
  await expect(editor).toHaveValue('reques');
  await expect(node(page, 'r01')).toHaveCount(1);
  // Escape cancels.
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  await saved(page);
  expect(d.read()).toEqual(start);

  // The picker's id chip opens the same editor; Enter commits.
  await picker(page).getByRole('button', { name: /Rename id r01/ }).click();
  await expect(editor).toHaveValue('r01');
  await editor.fill('request_form');
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);

  const hand = {
    mmd: canon(start.mmd.replace(/\br01\b/g, 'request_form')),
    config: edit(config, ['  r01:\n', '  request_form:\n'], ['{id: r01}', '{id: request_form}']),
    layout: start.layout!.replace('"r01"', '"request_form"'),
  };
  const files = await onDisk(page, d, (f) => f.mmd === hand.mmd && f.config !== config && f.layout !== layout);
  expect(files.mmd).toBe(hand.mmd);
  expect(yamlJs(files.config)).toEqual(yamlJs(hand.config));
  expectLinesKept(files.config!, config.split('\n').filter((l) => !/\br01\b/.test(l)));
  expect(layoutJs(files.layout)).toEqual(layoutJs(hand.layout));
  // The renamed pin keeps its place (first).
  expect(Object.keys(pins(files.layout))).toEqual(['request_form', 'closed']);
  await expect(node(page, 'request_form')).toHaveAttribute('data-selected', 'true');
  await expect(node(page, 'request_form')).toHaveAttribute('data-pinned', 'true');
  await expect(edge(page, 'intake->request_form')).toHaveCount(1);
  await expectUndoRedo(page, d, start, files);
  await expectMatchesCli(page, d);
});

// ---- UI12 unpin, re-layout all -------------------------------------------------------------------------------------

test('unpin the selected blocks; enabled only for pinned blocks (P10)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await node(page, 'r01').click();
  await expect(page.getByTestId('unpin')).toBeDisabled();
  await node(page, 'closed').click();
  await expect(node(page, 'closed')).toHaveAttribute('data-pinned', 'true');
  await expect(page.getByTestId('unpin')).toBeEnabled();
  await page.getByTestId('unpin').click();
  const files = await onDisk(page, d, (f) => f.layout !== PR.layout);
  expect(layoutJs(files.layout)).toEqual({ version: 1, nodes: {} });
  expect(files.mmd).toBe(PR.mmd);
  expect(files.config).toBe(PR.config);
  await expect(node(page, 'closed')).toHaveAttribute('data-pinned', 'false');
  await expect(page.getByTestId('unpin')).toBeDisabled();
  await expectUndoRedo(page, d, PR, files);
  await expectMatchesCli(page, d);
});

test('re-layout all asks first, then clears every pin and keeps hints (P10)', async ({ page }, info) => {
  const layout = '{\n  "version": 1,\n  "nodes": {\n    "r01": { "lane": "requester", "along": 260, "across": 30 },\n    "closed": { "lane": "requester", "along": 1400, "across": 40 }\n  }\n}\n';
  const start: Files = { ...PR, layout };
  const d = makeDiagram(info, start);
  await open(page, d);
  // No: nothing changes.
  await page.getByTestId('relayout-all').click();
  await expect(page.getByTestId('confirm')).toBeVisible();
  await page.getByTestId('confirm-no').click();
  await expect(page.getByTestId('confirm')).toHaveCount(0);
  await saved(page);
  expect(d.read()).toEqual(start);
  // Yes: the layout file becomes {"version": 1, "nodes": {}}.
  await page.getByTestId('relayout-all').click();
  await page.getByTestId('confirm-yes').click();
  const files = await onDisk(page, d, (f) => f.layout !== layout);
  expect(layoutJs(files.layout)).toEqual({ version: 1, nodes: {} });
  expect(files.mmd).toBe(PR.mmd);
  expect(files.config).toBe(PR.config);
  await expect(page.locator('[data-node-id][data-pinned="true"]')).toHaveCount(0);
  await expect(page.getByTestId('relayout-all')).toBeDisabled();
  await expectUndoRedo(page, d, start, files);
  await expectMatchesCli(page, d);
});

// ---- UI13 duplicate ------------------------------------------------------------------------------------------------

// A12 amends UI13: the copy's id derives from the original's (r01 -> r01-2), it is pinned 40/40 away (the paste step),
// and lines between duplicated blocks are copied too (copypaste.spec.ts).
test('duplicate (button): a copy with its metadata, pinned 40/40 from the original, becomes the selection (P11)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const cli = d.cliLayout();
  const r01 = cli.nodes.find((n) => n.id === 'r01')!;
  const laneY = cli.lanes.find((l) => l.id === 'requester')!.y;
  await node(page, 'r01').click();
  await page.getByTestId('duplicate').click();
  const files = await onDisk(page, d, (f) => f.mmd !== PR.mmd && f.config !== PR.config && f.layout !== PR.layout);
  // The copy is the last declaration of its lane.
  expect(files.mmd).toBe(canon(edit(PR.mmd, ['    closed(["Request closed"])\n', '    closed(["Request closed"])\n    r01-2["Fill the purchase request form"]\n'])));
  // Its metadata is copied under the new id, appended at the end of `nodes`; every original line is kept.
  const want = yamlJs(PR.config) as { nodes: Record<string, unknown> };
  want.nodes['r01-2'] = structuredClone(want.nodes.r01);
  expect(yamlJs(files.config)).toEqual(want);
  expectLinesKept(files.config!, PR.config!.split('\n'));
  expect(Object.keys((yamlJs(files.config) as { nodes: object }).nodes).at(-1)).toBe('r01-2');
  // Pinned 40 px along and 40 px across from the original.
  expect(pins(files.layout)['r01-2']).toEqual({ lane: 'requester', along: r01.x + 40, across: r01.y - laneY + 40 });
  // The copy is the selection.
  await expect(node(page, 'r01-2')).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('[data-node-id][data-selected="true"]')).toHaveCount(1);
  await expect(node(page, 'r01-2')).toHaveAttribute('data-kind', 'step');
  await expectUndoRedo(page, d, PR, files);
  await expectMatchesCli(page, d);
});

test('duplicate (Cmd/Ctrl+D) several blocks: new ids and declarations in file order', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  // Selected in reverse file order; handled in declaration order (§8.2 Order): r02 first, then p05.
  await node(page, 'p05').click();
  await node(page, 'r02').click({ modifiers: ['Shift'] });
  await page.keyboard.press('ControlOrMeta+d');
  const files = await onDisk(page, d, (f) => f.mmd.includes('p05-2') && !!f.config?.includes('  p05-2:') && !!pins(f.layout)['p05-2']);
  expect(files.mmd).toBe(canon(edit(PR.mmd,
    ['    closed(["Request closed"])\n', '    closed(["Request closed"])\n    r02-2["Receive the delivery and sign for it"]\n'],
    ['    p07["Create the PO in the ERP"]\n', '    p07["Create the PO in the ERP"]\n    p05-2["Get three quotes"]\n'])));
  const nodes = (yamlJs(files.config) as { nodes: Record<string, unknown> }).nodes;
  expect(Object.keys(nodes).slice(-2)).toEqual(['r02-2', 'p05-2']);
  expect(nodes['r02-2']).toEqual(nodes.r02);
  expect(nodes['p05-2']).toEqual(nodes.p05);
  expect(Object.keys(pins(files.layout))).toEqual(['closed', 'r02-2', 'p05-2']);
  await expect(page.locator('[data-node-id][data-selected="true"]')).toHaveCount(2);
  await expect(node(page, 'r02-2')).toHaveAttribute('data-selected', 'true');
  await expect(node(page, 'p05-2')).toHaveAttribute('data-selected', 'true');
  await expectUndoRedo(page, d, PR, files);
});

// ---- UI14 delete ---------------------------------------------------------------------------------------------------

test('delete a block (Delete key): its edges, attached comments and pin go; its metadata stays (P8)', async ({ page }, info) => {
  const mmd = canon(edit(PR.mmd,
    ['    closed(["Request closed"])\n', '    %% the end of the line\n    closed(["Request closed"])\n'],
    ['  m03 --> closed\n', '  %% tell them, then close\n  m03 --> closed\n']));
  const start: Files = { ...PR, mmd };
  const d = makeDiagram(info, start);
  await open(page, d);
  await node(page, 'closed').click();
  await page.keyboard.press('Delete');
  const hand = canon(edit(mmd,
    ['    %% the end of the line\n    closed(["Request closed"])\n', ''],
    ['  %% tell them, then close\n  m03 --> closed\n', '']));
  const files = await onDisk(page, d, (f) => f.mmd === hand && f.layout !== PR.layout);
  expect(files.mmd).toBe(hand);
  expect(files.config).toBe(PR.config);
  expect(layoutJs(files.layout)).toEqual({ version: 1, nodes: {} });
  await expect(node(page, 'closed')).toHaveCount(0);
  await expect(edge(page, 'm03->closed')).toHaveCount(0);
  await expectUndoRedo(page, d, start, files);
  await expectMatchesCli(page, d);
});

test('delete an edge (button), and blocks with edges together (Backspace) (P8)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await selectEdge(page, 'p03->r01');
  await page.getByTestId('delete').click();
  const one = canon(edit(PR.mmd, ['  p03 --> r01\n', '']));
  const files1 = await onDisk(page, d, (f) => f.mmd === one);
  expect(files1).toEqual({ ...PR, mmd: one });
  await expect(edge(page, 'p03->r01')).toHaveCount(0);
  await saved(page);

  // A block and an unrelated edge in one go. (The edge first: selecting a block opens the inspector, which narrows the
  // canvas and can cover this edge at the right-hand side.)
  await selectEdge(page, 'v02->r02');
  await node(page, 'm03').click({ modifiers: ['Shift'] });
  await expect(node(page, 'm03')).toHaveAttribute('data-selected', 'true');
  await expect(edge(page, 'v02->r02')).toHaveAttribute('data-selected', 'true');
  await page.keyboard.press('Backspace');
  const two = canon(edit(one,
    ['    m03["Tell the requester why not"]\n', ''],
    ['  m02 -->|no| m03\n', ''],
    ['  m03 --> closed\n', ''],
    ['  v02 --> r02\n', '']));
  const files2 = await onDisk(page, d, (f) => f.mmd === two);
  expect(files2).toEqual({ ...PR, mmd: two });
  await expectUndoRedo(page, d, files1, files2);
  await expectMatchesCli(page, d);
});

// ---- UI15 connect --------------------------------------------------------------------------------------------------

test('connect by dragging from a source handle onto anywhere on the target block, with a live preview (P5)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  // v1.1 (UI38): the right-hand one of the four handles; it writes `source_side` (see lines.spec.ts for every side).
  // (v1.1: a block's connection handles show, and take the pointer, while it is hovered or selected.)
  await node(page, 'p06').hover();
  const from = await centreOf(page, '[data-node-id="p06"] [data-handle="source"][data-port="right"]');
  const target = (await node(page, 'r02').boundingBox())!;
  // Drop near a corner of the target, not its centre: anywhere on the block counts.
  const to = { x: target.x + target.width * 0.85, y: target.y + target.height * 0.8 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 20, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await expect(page.locator('.fm-connect-preview')).toBeVisible(); // (the preview is not part of §8.3)
  await page.mouse.up();
  await expect(page.locator('.fm-connect-preview')).toHaveCount(0);
  const want = canon(`${PR.mmd}  p06 --> r02\n`);
  const files = await onDisk(page, d, (f) => f.mmd === want && f.layout !== PR.layout);
  expect(files.mmd).toBe(want);
  expect(files.config).toBe(PR.config);
  // Dropped away from the target's connection points: only the source side is written (UI38).
  expect(layoutJs(files.layout)).toEqual({ ...(layoutJs(PR.layout) as object), edges: { 'p06->r02': { source_side: 'right' } } });
  await expect(edge(page, 'p06->r02')).toHaveAttribute('data-selected', 'true');
  await expectUndoRedo(page, d, PR, files);
  await expectMatchesCli(page, d);
});

test('connect with locator.dragTo, a duplicate edge, a drag from another side, and cancelled drops', async ({ page }, info) => {
  // v1.1: there is no target handle (UI38), so the v1.0 "reversed drag from a target handle" is now a drag from the
  // left-hand handle: the block it starts from is always the source.
  const d = makeDiagram(info);
  await open(page, d);
  // An edge that already exists: a second one is appended (`#2`).
  // (v1.1: a block's connection handles show, and take the pointer, while it is hovered or selected.)
  await node(page, 'intake').hover();
  await node(page, 'intake').locator('[data-handle="source"][data-port="right"]').dragTo(node(page, 'r01'));
  const dup = canon(`${PR.mmd}  intake --> r01\n`);
  await onDisk(page, d, (f) => f.mmd === dup);
  expect(d.read().mmd).toBe(dup);
  await expect(edge(page, 'intake->r01#2')).toHaveCount(1);
  // From the left-hand handle of f04 onto m01: f04 is the source, leaving from its left side.
  await node(page, 'f04').hover();
  await node(page, 'f04').locator('[data-handle="source"][data-port="left"]').dragTo(node(page, 'm01'));
  const rev = canon(`${dup}  f04 --> m01\n`);
  await onDisk(page, d, (f) => f.mmd === rev);
  expect(d.read().mmd).toBe(rev);
  expect((layoutJs(d.read().layout) as { edges: unknown }).edges).toEqual({
    'intake->r01#2': { source_side: 'right' },
    'f04->m01': { source_side: 'left' },
  });
  await saved(page);
  // Dropped on empty lane space, or back on its own block: nothing happens.
  const h = await centreOf(page, '[data-node-id="p01"] [data-handle="source"][data-port="right"]');
  const before = d.read();
  const empty = await emptyPointInLane(page, 'finance');
  await node(page, 'p01').hover();
  await dragFromTo(page, h, empty);
  await node(page, 'p01').hover();
  await dragFromTo(page, h, await centreOf(page, '[data-node-id="p01"]'));
  await saved(page);
  expect(d.read()).toEqual(before);
  // A click on a handle just selects its block.
  await node(page, 'p01').hover();
  await node(page, 'p01').locator('[data-handle="source"][data-port="right"]').click();
  await expect(node(page, 'p01')).toHaveAttribute('data-selected', 'true');
});

test('connect by the click path: select the source, press connect, click the target; Escape cancels (P5)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const connect = page.getByTestId('connect');
  await node(page, 'f02').click();
  await connect.click();
  await expect(connect).toHaveAttribute('aria-pressed', 'true');
  // Escape cancels and keeps the selection.
  await page.keyboard.press('Escape');
  await expect(connect).toHaveAttribute('aria-pressed', 'false');
  await expect(node(page, 'f02')).toHaveAttribute('data-selected', 'true');
  await connect.click();
  await node(page, 'f03').click();
  const want = canon(`${PR.mmd}  f02 --> f03\n`);
  const files = await onDisk(page, d, (f) => f.mmd === want);
  expect(files).toEqual({ ...PR, mmd: want });
  await expect(connect).toHaveAttribute('aria-pressed', 'false');
  await expect(edge(page, 'f02->f03')).toHaveAttribute('data-selected', 'true');
  await expectUndoRedo(page, d, PR, files);

  // With nothing selected, connect waits for the source, then the target.
  await page.keyboard.press('Escape');
  await connect.click();
  await node(page, 'v02').click();
  await expect(connect).toHaveAttribute('aria-pressed', 'true');
  await node(page, 'f04').click();
  const next = canon(`${want}  v02 --> f04\n`);
  expect((await onDisk(page, d, (f) => f.mmd === next)).mmd).toBe(next);
  // Clicking empty canvas cancels an armed connect.
  await node(page, 'p01').click();
  await connect.click();
  const empty = await emptyPointInLane(page, 'vendor');
  await page.mouse.click(empty.x, empty.y);
  await expect(connect).toHaveAttribute('aria-pressed', 'false');
  await node(page, 'p07').click();
  await saved(page);
  expect(d.read().mmd).toBe(next);
});

// ---- UI16 reconnect ------------------------------------------------------------------------------------------------

test('reconnect an edge’s source, then its target; it keeps its place, label and comment (P6)', async ({ page }, info) => {
  const mmd = canon(edit(PR.mmd, ['  p02 -->|no| p03\n', '  %% bounce it back\n  p02 -->|no| p03\n']));
  const start: Files = { ...PR, mmd };
  const d = makeDiagram(info, start);
  await open(page, d);
  await expect(page.locator('[data-edge-end]')).toHaveCount(0);
  await selectEdge(page, 'p02->p03');
  await expect(edge(page, 'p02->p03').locator('[data-edge-end]')).toHaveCount(2);
  // Source end onto p04.
  await dragFromTo(page, await centreOf(page, '[data-edge-id="p02->p03"] [data-edge-end="source"]'), await centreOf(page, '[data-node-id="p04"]'));
  const src = canon(edit(mmd, ['  p02 -->|no| p03\n', '  p04 -->|no| p03\n']));
  const files1 = await onDisk(page, d, (f) => f.mmd === src);
  expect(files1).toEqual({ ...PR, mmd: src });
  expect(src).toContain('  %% bounce it back\n  p04 -->|no| p03\n');
  await expect(edge(page, 'p04->p03')).toHaveAttribute('data-selected', 'true');
  await expect(edge(page, 'p04->p03')).toHaveAttribute('data-source', 'p04');
  // Target end onto m01 (with Playwright's dragTo).
  await edge(page, 'p04->p03').locator('[data-edge-end="target"]').dragTo(node(page, 'm01'));
  const tgt = canon(edit(src, ['  p04 -->|no| p03\n', '  p04 -->|no| m01\n']));
  const files2 = await onDisk(page, d, (f) => f.mmd === tgt);
  expect(files2).toEqual({ ...PR, mmd: tgt });
  // The edge id follows the endpoints. It is earlier in the file than the existing `p04 -->|yes| m01`, so it is
  // `p04->m01` and that one becomes `p04->m01#2` (§3.4).
  await expect(edge(page, 'p04->m01')).toHaveAttribute('data-selected', 'true');
  await expect(edge(page, 'p04->m01')).toContainText('no');
  await expect(edge(page, 'p04->m01#2')).toContainText('yes');
  await expectUndoRedo(page, d, files1, files2);
  // Dropped nowhere: the edge snaps back.
  await selectEdge(page, 'p04->m01');
  await dragFromTo(page, await centreOf(page, '[data-edge-id="p04->m01"] [data-edge-end="source"]'), await emptyPointInLane(page, 'vendor'));
  await saved(page);
  expect(d.read()).toEqual(files2);
  await expectMatchesCli(page, d);
});

// ---- UI17 edge label -----------------------------------------------------------------------------------------------

test('edge label: double-click to set, change and clear; Escape cancels; Enter on a selected edge opens it (P7)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const editor = page.getByTestId('label-editor');
  // Set.
  let p = await edgePoint(page, 'm03->closed');
  await page.mouse.dblclick(p.x, p.y);
  await expect(editor).toHaveValue('');
  await editor.fill('done');
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  const set = canon(edit(PR.mmd, ['  m03 --> closed\n', '  m03 -->|done| closed\n']));
  const files1 = await onDisk(page, d, (f) => f.mmd === set);
  expect(files1).toEqual({ ...PR, mmd: set });
  await expect(edge(page, 'm03->closed')).toContainText('done');
  await expectUndoRedo(page, d, PR, files1);

  // Escape cancels.
  p = await edgePoint(page, 'm03->closed');
  await page.mouse.dblclick(p.x, p.y);
  await expect(editor).toHaveValue('done');
  await editor.fill('nope');
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);

  // Change, with characters that need quoting and escaping; typing Backspace/Delete in the editor deletes nothing.
  await selectEdge(page, 'm03->closed');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveValue('done');
  await editor.fill('said "no" #1x');
  await editor.press('Backspace');
  await editor.press('Delete');
  await editor.press('Enter');
  const changed = canon(edit(PR.mmd, ['  m03 --> closed\n', '  m03 -->|"said #quot;no#quot; #1"| closed\n']));
  const files2 = await onDisk(page, d, (f) => f.mmd === changed);
  expect(files2).toEqual({ ...PR, mmd: changed });
  await expect(edge(page, 'm03->closed')).toHaveCount(1);

  // Clear: an empty label removes it.
  await saved(page);
  p = await edgePoint(page, 'm03->closed');
  await page.mouse.dblclick(p.x, p.y);
  await editor.fill('   ');
  await editor.press('Enter');
  const files3 = await onDisk(page, d, (f) => f.mmd === PR.mmd);
  expect(files3).toEqual(PR);
  await expectUndoRedo(page, d, files2, files3);
  await expectMatchesCli(page, d);
});

// ---- keyboard and refusals -----------------------------------------------------------------------------------------

test('block shortcuts do nothing while typing in the label editor', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await node(page, 'r01').dblclick();
  const editor = page.getByTestId('label-editor');
  await expect(editor).toBeVisible();
  for (const key of ['Delete', 'Backspace', 'ControlOrMeta+d', 'F2']) await editor.press(key);
  await expect(page.getByTestId('id-editor')).toHaveCount(0);
  await editor.press('Escape');
  await expect(node(page, 'r01')).toHaveCount(1);
  await expect(page.locator('[data-node-id]')).toHaveCount(d.cliLayout().nodes.length);
  await saved(page);
  expect(d.read()).toEqual(PR);
  // Outside the editor the same keys work: F2 opens the id editor, Escape closes it, Delete deletes.
  await node(page, 'r01').click();
  await page.keyboard.press('F2');
  await expect(page.getByTestId('id-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  await expect(node(page, 'r01')).toHaveCount(0);
});

test('with .mmd errors, block and line editing is off (UI31 refusal)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await node(page, 'p01').click();
  await expect(page.getByTestId('duplicate')).toBeEnabled();
  d.write({ mmd: `${PR.mmd}  p01 --- p02\n` });
  await expect(page.getByTestId('errors').locator('[data-code="E-edge"]')).toBeVisible();
  await expect(page.getByTestId('delete')).toBeDisabled();
  await expect(page.getByTestId('duplicate')).toBeDisabled();
  await expect(page.getByTestId('connect')).toBeDisabled();
  await page.keyboard.press('Delete');
  await page.keyboard.press('ControlOrMeta+d');
  await expect(picker(page).locator('[data-shape="decision"]')).toBeDisabled();
  await page.waitForTimeout(300);
  expect(d.read().mmd).toBe(`${PR.mmd}  p01 --- p02\n`);
  expect((await attrs(node(page, 'p01'))).kind).toBe('step');
});

test('rename id through the inspector’s id-edit button (the §8.3 path)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await node(page, 'm02').click();
  await page.getByTestId('inspector').getByTestId('id-edit').click();
  const editor = page.getByTestId('id-editor');
  await expect(editor).toHaveValue('m02');
  await editor.fill('approved');
  await editor.press('Enter');
  const want = canon(PR.mmd.replace(/\bm02\b/g, 'approved'));
  const files = await onDisk(page, d, (f) => f.mmd === want);
  expect(files).toEqual({ ...PR, mmd: want });
  await expect(node(page, 'approved')).toHaveAttribute('data-selected', 'true');
  await expectUndoRedo(page, d, PR, files);
});
