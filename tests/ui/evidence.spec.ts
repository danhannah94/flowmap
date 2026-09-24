// Evidence and styles (UI24–UI27, design.md §10 Part 2 U5 and Part 3 P15–P19, P20). Like the acceptance suite, each
// test drives the UI only through the §8.3 attributes and checks the files on disk: the config as parsed YAML with
// every untouched line byte-identical to the same hand edit, the layout file as parsed JSON (ignoring `hints`), the
// `.mmd` byte for byte after `fmt`. Every operation is then undone and redone (UI28).
import { expect, test, type Locator, type Page } from '@playwright/test';
import { parseDocument } from 'yaml';
import { lineDiff } from '../../src/core/config/testkit';
import { canon, edit, RICH } from '../../src/core/ops/testkit';
import { declaredLane, makeDiagram, node, open, PR, saved, settled, type Diagram, type Files } from './helpers';

const C = PR.config!;
const NODES_END = '    quote: "three-way match, when the receipt shows up"\n';
const R01_END = '    quote: "the form is a spreadsheet somebody made in 2014"\n';

// ---- helpers ----------------------------------------------------------------------------------------------------

const yamlJs = (text: string) => {
  const doc = parseDocument(text);
  if (doc.errors.length) throw new Error(`invalid YAML:\n${text}`);
  return doc.toJS();
};

const sameFiles = (a: Files, b: Files) => a.mmd === b.mmd && a.config === b.config && a.layout === b.layout;

/** Wait until the files on disk differ from `prev` and the UI says saved; return them. */
async function settle(page: Page, d: Diagram, prev: Files): Promise<Files> {
  await settled(page, d, (f) => !sameFiles(f, prev), 3000);
  await saved(page);
  return d.read();
}

/** Nothing changes on disk (a refusal, or a no-op). */
async function unchanged(page: Page, d: Diagram, prev: Files): Promise<void> {
  await page.waitForTimeout(250);
  await saved(page);
  expect(d.read()).toEqual(prev);
}

/** The parity check for the config (§10 Part 3): same parsed YAML as the hand edit, same original lines removed. */
function expectConfig(after: string | null, before: string, hand: string): void {
  expect(after).not.toBeNull();
  expect(yamlJs(after!)).toEqual(yamlJs(hand));
  expect(lineDiff(before, after!).removed.sort()).toEqual(lineDiff(before, hand).removed.sort());
}

/** One edit, checked on disk against the hand edit of the config, then undone and redone (UI28). */
async function step(page: Page, d: Diagram, action: () => Promise<void>, hand: (before: Files) => string): Promise<Files> {
  const before = d.read();
  await action();
  const after = await settle(page, d, before);
  expectConfig(after.config, before.config!, hand(before));
  expect(after.mmd).toBe(before.mmd);
  expect(after.layout).toBe(before.layout);
  await undoRedo(page, d, before, after);
  return after;
}

async function undoRedo(page: Page, d: Diagram, before: Files, after: Files): Promise<void> {
  // The UI's own saves never come back as an external change (which would clear the history).
  await expect(page.getByTestId('history-cleared')).toHaveCount(0);
  await page.getByTestId('undo').click();
  await settled(page, d, (f) => sameFiles(f, before), 3000);
  await saved(page);
  expect(d.read()).toEqual(before);
  await page.getByTestId('redo').click();
  await settled(page, d, (f) => sameFiles(f, after), 3000);
  await saved(page);
  expect(d.read()).toEqual(after);
}

async function select(page: Page, ...ids: string[]): Promise<Locator> {
  await node(page, ids[0]!).click();
  for (const id of ids.slice(1)) await node(page, id).click({ modifiers: ['Shift'] });
  const inspector = page.getByTestId('inspector');
  await expect(inspector).toBeVisible();
  return inspector;
}

const field = (inspector: Locator, key: string) => inspector.locator(`[data-field="meta.${key}"]`);

async function fillForm(page: Page, key: string, type: 'text' | 'list' | 'map' | 'yaml', value: string): Promise<void> {
  await page.getByTestId('field-key').fill(key);
  await page.getByTestId('field-type').selectOption(type);
  await page.getByTestId('field-value').fill(value);
}

async function openStyles(page: Page): Promise<Locator> {
  await page.getByTestId('styles-toggle').click();
  const styles = page.getByTestId('styles');
  await expect(styles).toBeVisible();
  return styles;
}

const rule = (page: Page, i: number) => page.getByTestId('style-rule').nth(i);

// ---- UI24 Inspector ---------------------------------------------------------------------------------------------

test('inspector: built-in fields and every metadata field, as §8.3 formats them', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await expect(page.getByTestId('inspector')).toHaveCount(0);
  const ins = await select(page, 'p05');
  await expect(ins).not.toHaveAttribute('data-count');
  await expect(ins.locator('[data-field="id"]')).toHaveText('p05');
  await expect(ins.locator('[data-field="lane"]')).toHaveText('purchasing');
  await expect(ins.locator('[data-field="kind"]')).toHaveText('step');
  await expect(ins.locator('[data-field="label"]')).toHaveText('Get three quotes');
  await expect(ins.getByTestId('lane-select')).toHaveValue('purchasing');
  await expect(ins.getByTestId('lane-select').locator('option')).toHaveText(['Requester', 'Manager', 'Purchasing', 'Finance', 'Vendor', 'Unassigned']);
  expect(await ins.getByTestId('lane-select').locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)))
    .toEqual(['requester', 'manager', 'purchasing', 'finance', 'vendor', '_unassigned']);
  // Metadata in file order: scalars as their YAML string, lists joined with ", ", maps as compact JSON.
  await expect(ins.locator('[data-field^="meta."]')).toHaveCount(5);
  await expect(field(ins, 'kind')).toHaveText('wait');
  await expect(field(ins, 'confidence')).toHaveText('single-source');
  await expect(field(ins, 'source')).toHaveText('pat-09-04');
  await expect(field(ins, 'open_question')).toHaveText('Are three quotes required, or just the habit?');
  await expect(field(ins, 'variants')).toHaveText('{"main plant":"three quotes over $1,000","warehouse":"one quote is fine under $5,000"}');
  for (const k of ['kind', 'confidence', 'source', 'open_question', 'variants']) {
    await expect(field(ins, k).getByTestId('field-edit')).toHaveCount(1);
    await expect(field(ins, k).getByTestId('field-delete')).toHaveCount(1);
  }
  // A list of several, and a block with no metadata.
  await select(page, 'r01');
  await expect(field(page.getByTestId('inspector'), 'source')).toHaveText('sam-09-01, lee-09-03');
  await select(page, 'p02');
  await expect(page.getByTestId('inspector').locator('[data-field^="meta."]')).toHaveCount(0);
  await expect(page.getByTestId('node-yaml')).toHaveValue('');
});

test('P15 text field: add to a block with no entry and to an existing entry; edit; a value that reads as a number', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const ins = await select(page, 'p02');
  // New entry, appended at the end of nodes.
  let files = await step(page, d, async () => {
    await ins.getByTestId('add-field').click();
    await fillForm(page, 'owner', 'text', 'Pat');
    await page.getByTestId('field-save').click();
  }, () => edit(C, [NODES_END, `${NODES_END}  p02:\n    owner: Pat\n`]));
  await expect(field(ins, 'owner')).toHaveText('Pat');
  await expect(page.getByTestId('field-key')).toHaveCount(0); // the form closes after a save
  // New field at the end of an existing entry; a value with ": " is quoted.
  await select(page, 'r01');
  files = await step(page, d, async () => {
    await page.getByTestId('add-field').click();
    await fillForm(page, 'owner', 'text', 'Kim: ops');
    await page.getByTestId('field-save').click();
  }, (b) => edit(b.config!, [R01_END, `${R01_END}    owner: "Kim: ops"\n`]));
  // Edit: the form opens with the value; Enter saves a text value.
  await step(page, d, async () => {
    await field(page.getByTestId('inspector'), 'system').getByTestId('field-edit').click();
    await expect(page.getByTestId('field-key')).toHaveValue('system');
    await expect(page.getByTestId('field-type')).toHaveValue('text');
    await expect(page.getByTestId('field-value')).toHaveValue('excel');
    await page.getByTestId('field-value').fill('erp');
    await page.getByTestId('field-value').press('Enter');
  }, (b) => edit(b.config!, ['  r01:\n    system: excel\n', '  r01:\n    system: erp\n']));
  await expect(field(page.getByTestId('inspector'), 'system')).toHaveText('erp');
  // A typed "2" is written as the string "2" (§4).
  await step(page, d, async () => {
    await field(page.getByTestId('inspector'), 'system').getByTestId('field-edit').click();
    await page.getByTestId('field-value').fill('2');
    await page.getByTestId('field-save').click();
  }, (b) => edit(b.config!, ['  r01:\n    system: erp\n', '  r01:\n    system: "2"\n']));
  expect(files).toBeTruthy();
});

test('P15 list, map and YAML fields: add and edit', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const ins = await select(page, 'p04');
  // List: edit an existing list (one item per line).
  await step(page, d, async () => {
    await field(ins, 'source').getByTestId('field-edit').click();
    await expect(page.getByTestId('field-type')).toHaveValue('list');
    await expect(page.getByTestId('field-value')).toHaveValue('pat-09-04');
    await page.getByTestId('field-value').fill('pat-09-04\nkim-09-05\n2');
    await page.getByTestId('field-save').click();
  }, (b) => edit(b.config!, ['    source: [pat-09-04]\n    open_question: Is', '    source: [pat-09-04, kim-09-05, "2"]\n    open_question: Is']));
  await expect(field(ins, 'source')).toHaveText('pat-09-04, kim-09-05, 2');
  // List: add.
  await step(page, d, async () => {
    await ins.getByTestId('add-field').click();
    await fillForm(page, 'tags', 'list', 'erp\n\nurgent');
    await page.getByTestId('field-save').click();
  }, (b) => edit(b.config!, ['    open_question: Is the threshold $1,000 everywhere, or only at the main plant?\n',
    '    open_question: Is the threshold $1,000 everywhere, or only at the main plant?\n    tags: [erp, urgent]\n']));
  // Map: edit (split at the first ": "; a line ending in ":" is an empty value).
  await select(page, 'p05');
  await step(page, d, async () => {
    await field(page.getByTestId('inspector'), 'variants').getByTestId('field-edit').click();
    await expect(page.getByTestId('field-type')).toHaveValue('map');
    await expect(page.getByTestId('field-value')).toHaveValue('main plant: three quotes over $1,000\nwarehouse: one quote is fine under $5,000');
    await page.getByTestId('field-value').fill('all: one quote: always\nnone:');
    await page.getByTestId('field-save').click();
  }, (b) => edit(b.config!, ['      main plant: three quotes over $1,000\n      warehouse: one quote is fine under $5,000\n', '      all: "one quote: always"\n      none: ""\n']));
  await expect(field(page.getByTestId('inspector'), 'variants')).toHaveText('{"all":"one quote: always","none":""}');
  // Map: a line without ": " is refused with a message (R5.14); nothing is written.
  const before = d.read();
  await page.getByTestId('inspector').getByTestId('add-field').click();
  await fillForm(page, 'split', 'map', 'no separator here');
  await page.getByTestId('field-save').click();
  await expect(page.getByTestId('inspector')).toContainText('Each map line must be');
  await unchanged(page, d, before);
  // Map: add.
  await step(page, d, async () => {
    await fillForm(page, 'split', 'map', 'plant: yes\nwarehouse: no');
    await page.getByTestId('field-save').click();
  }, (b) => edit(b.config!, ['      none: ""\n', '      none: ""\n    split:\n      plant: "yes"\n      warehouse: "no"\n']));
  // YAML: deeper structures.
  await step(page, d, async () => {
    await page.getByTestId('inspector').getByTestId('add-field').click();
    await fillForm(page, 'extra', 'yaml', 'a: [1, 2]\nb: {c: d}');
    await page.getByTestId('field-save').click();
  }, (b) => edit(b.config!, ['      warehouse: "no"\n', '      warehouse: "no"\n    extra:\n      a: [1, 2]\n      b: {c: d}\n']));
  await expect(field(page.getByTestId('inspector'), 'extra')).toHaveText('{"a":[1,2],"b":{"c":"d"}}');
  // YAML: an existing nested value opens as YAML and saves back unchanged (no write).
  const now = d.read();
  await field(page.getByTestId('inspector'), 'extra').getByTestId('field-edit').click();
  await expect(page.getByTestId('field-type')).toHaveValue('yaml');
  await page.getByTestId('field-save').click();
  await unchanged(page, d, now);
  // YAML: invalid YAML is refused.
  await page.getByTestId('inspector').getByTestId('add-field').click();
  await fillForm(page, 'bad', 'yaml', 'a: [');
  await page.getByTestId('field-save').click();
  await expect(page.getByTestId('inspector')).toContainText('not valid YAML');
  await unchanged(page, d, now);
});

test('P15 delete a field; deleting the last one removes the entry', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const ins = await select(page, 'r01');
  await step(page, d, () => field(ins, 'quote').getByTestId('field-delete').click(), (b) => edit(b.config!, [R01_END, '']));
  await expect(field(ins, 'quote')).toHaveCount(0);
  await select(page, 'r02');
  await step(page, d, () => field(page.getByTestId('inspector'), 'confidence').getByTestId('field-delete').click(),
    (b) => edit(b.config!, ['  r02:\n    confidence: inferred\n', '']));
});

test('suggestions: values the rules match on plus values on other nodes, one click sets the field', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const ins = await select(page, 'p02');
  await ins.getByTestId('add-field').click();
  // A key no rule matches on: no suggestions.
  await page.getByTestId('field-key').fill('owner');
  await expect(page.getByTestId('field-suggestion')).toHaveCount(0);
  // A key rules match on: the rules' values, then values on other nodes.
  await page.getByTestId('field-key').fill('system');
  await expect(page.getByTestId('field-suggestion')).toHaveText(['erp', 'excel', 'email']);
  await page.getByTestId('field-key').fill('confidence');
  await expect(page.getByTestId('field-suggestion')).toHaveText(['confirmed', 'single-source', 'inferred']);
  // One click writes it (one undo step); save then just closes the form.
  const before = d.read();
  await page.getByTestId('field-suggestion').filter({ hasText: 'inferred' }).click();
  const after = await settle(page, d, before);
  expectConfig(after.config, C, edit(C, [NODES_END, `${NODES_END}  p02:\n    confidence: inferred\n`]));
  await expect(field(ins, 'confidence')).toHaveText('inferred');
  await page.getByTestId('field-save').click();
  await expect(page.getByTestId('field-key')).toHaveCount(0);
  await unchanged(page, d, after);
  await undoRedo(page, d, before, after);
  // The quick-add for a common evidence field opens the form with that key: one more click sets the value.
  await select(page, 'p06');
  await page.getByTestId('inspector').getByRole('button', { name: '+ confidence' }).click();
  await expect(page.getByTestId('field-key')).toHaveValue('confidence');
  await step(page, d, () => page.getByTestId('field-suggestion').filter({ hasText: 'single-source' }).click(),
    (b) => edit(b.config!, ['  p02:\n    confidence: inferred\n', '  p02:\n    confidence: inferred\n  p06:\n    confidence: single-source\n']));
});

test('several blocks: the field form sets a field on all of them in file order; field-remove-all removes it', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  // Selected out of file order on purpose.
  const ins = await select(page, 'p06', 'r01', 'p02');
  await expect(ins).toHaveAttribute('data-count', '3');
  await expect(ins.locator('[data-field]')).toHaveCount(0);
  await expect(page.getByTestId('node-yaml')).toHaveCount(0);
  await expect(page.getByTestId('lane-select')).toHaveCount(0);
  await expect(ins.getByTestId('field-remove-all')).toBeVisible();
  const set = await step(page, d, async () => {
    await fillForm(page, 'owner', 'text', 'Pat');
    await page.getByTestId('field-save').click();
  }, () => edit(C, [R01_END, `${R01_END}    owner: Pat\n`], [NODES_END, `${NODES_END}  p02:\n    owner: Pat\n  p06:\n    owner: Pat\n`]));
  expect(set.config!.indexOf('  p02:')).toBeLessThan(set.config!.indexOf('  p06:'));
  // Suggestions work for several blocks too.
  await page.getByTestId('field-key').fill('confidence');
  await expect(page.getByTestId('field-suggestion')).toHaveText(['confirmed', 'single-source', 'inferred']);
  // Remove the field named in field-key from all of them: entries left empty are removed.
  await page.getByTestId('field-key').fill('owner');
  const removed = await step(page, d, () => ins.getByTestId('field-remove-all').click(), () => C);
  expect(removed.config).toBe(C);
});

test('P16 node YAML: replace an entry, empty removes it, a non-map is refused', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  const ins = await select(page, 'r01');
  await expect(page.getByTestId('node-yaml')).toHaveValue('system: excel\nconfidence: confirmed\nsource: [sam-09-01, lee-09-03]\nquote: "the form is a spreadsheet somebody made in 2014"\n');
  // Refusals leave the file alone and say why.
  const start = d.read();
  await page.getByTestId('node-yaml').fill('[1, 2]');
  await page.getByTestId('node-yaml-apply').click();
  await expect(page.getByTestId('yaml-error')).toContainText('map');
  await page.getByTestId('node-yaml').fill('a: [');
  await page.getByTestId('node-yaml-apply').click();
  await expect(page.getByTestId('yaml-error')).toContainText('YAML');
  await unchanged(page, d, start);
  // Replace.
  await step(page, d, async () => {
    await page.getByTestId('node-yaml').fill('system: erp\nowner: kim\nsource: [a, b]\n');
    await page.getByTestId('node-yaml-apply').click();
  }, (b) => edit(b.config!, [`    system: excel\n    confidence: confirmed\n    source: [sam-09-01, lee-09-03]\n${R01_END}`, '    system: erp\n    owner: kim\n    source: [a, b]\n']));
  await expect(page.getByTestId('yaml-error')).toHaveCount(0);
  await expect(field(ins, 'owner')).toHaveText('kim');
  // A new entry for a block with none, appended at the end.
  await select(page, 'p02');
  await step(page, d, async () => {
    await page.getByTestId('node-yaml').fill('seen: never');
    await page.getByTestId('node-yaml-apply').click();
  }, (b) => edit(b.config!, [NODES_END, `${NODES_END}  p02:\n    seen: never\n`]));
  // Empty removes the entry.
  await select(page, 'm03');
  await step(page, d, async () => {
    await page.getByTestId('node-yaml').fill('');
    await page.getByTestId('node-yaml-apply').click();
  }, (b) => edit(b.config!, ['  m03:\n    confidence: inferred\n    source: [sam-09-01]\n', '']));
});

test('lane select moves the block (pins dropped), including to Unassigned; id-edit renames it', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  let ins = await select(page, 'r01');
  const before = d.read();
  await ins.getByTestId('lane-select').selectOption('manager');
  let after = await settle(page, d, before);
  expect(after.mmd).toBe(canon(edit(PR.mmd, ['    r01["Fill the purchase request form"]\n', ''],
    ['    m03["Tell the requester why not"]\n', '    m03["Tell the requester why not"]\n    r01["Fill the purchase request form"]\n'])));
  expect(after.config).toBe(C);
  await expect(ins.locator('[data-field="lane"]')).toHaveText('manager');
  await undoRedo(page, d, before, after);
  // Unassigned (always offered), for a pinned block: its pin is dropped.
  ins = await select(page, 'closed');
  const b2 = d.read();
  await ins.getByTestId('lane-select').selectOption('_unassigned');
  after = await settle(page, d, b2);
  expect(declaredLane(after.mmd, 'closed')).toBe('_unassigned');
  expect(JSON.parse(after.layout!).nodes).toEqual({});
  await expect(page.getByTestId('inspector').locator('[data-field="lane"]')).toHaveText('_unassigned');
  await undoRedo(page, d, b2, after);
  // Rename the id from the inspector: refused ids show id-error; the config key moves with it.
  ins = await select(page, 'p05');
  await ins.getByTestId('id-edit').click();
  const editor = page.getByTestId('id-editor');
  await editor.fill('p06');
  await editor.press('Enter');
  await expect(page.getByTestId('id-error')).toBeVisible();
  const b3 = d.read();
  await editor.fill('p5x');
  await editor.press('Enter');
  after = await settle(page, d, b3);
  expect(after.mmd).toBe(canon(b3.mmd.replace(/\bp05\b/g, 'p5x')));
  expectConfig(after.config, b3.config!, edit(b3.config!, ['  p05:\n', '  p5x:\n']));
  await expect(page.getByTestId('inspector').locator('[data-field="id"]')).toHaveText('p5x');
});

test('no config file: the first field creates it with version 1; undo deletes it again', async ({ page }, info) => {
  const d = makeDiagram(info, { mmd: PR.mmd, config: null, layout: null });
  await open(page, d);
  const ins = await select(page, 'p02');
  await expect(page.getByTestId('node-yaml')).toHaveValue('');
  const before = d.read();
  await ins.getByTestId('add-field').click();
  await fillForm(page, 'owner', 'text', 'Pat');
  await page.getByTestId('field-save').click();
  const after = await settle(page, d, before);
  expect(after.config).toBe('version: 1\nnodes:\n  p02:\n    owner: Pat\n');
  await undoRedo(page, d, before, after);
  expect(before.config).toBeNull();
});

// ---- UI25 Styles panel ------------------------------------------------------------------------------------------

test('styles panel: rules in order with swatches; add, reorder and delete rules', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await expect(page.getByTestId('styles')).toHaveCount(0);
  await openStyles(page);
  await expect(page.getByTestId('style-rule')).toHaveCount(7);
  const legends = await page.getByTestId('rule-legend').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(legends).toEqual(['Confirmed by two or more people', 'One source only', 'Inferred, nobody said it directly', 'Done in the ERP', 'Done in a spreadsheet', 'Waiting on someone', 'Open question']);
  await expect(page.getByTestId('legend-item')).toHaveCount(7);
  const R0 = '  - legend: Confirmed by two or more people\n    match: {confidence: confirmed}\n    style: {border_style: solid, border_width: 2}\n';
  const R1 = '  - legend: One source only\n    match: {confidence: single-source}\n    style: {border_style: dashed, border_width: 1}\n';
  const R6 = '  - legend: Open question\n    match: {open_question: present}\n    style: {border_color: {light: "#b85450", dark: "#f08080"}}\n';
  // Add: {match: {}, style: {}} at the end; it isn't in the legend until it has legend text.
  await step(page, d, () => page.getByTestId('rule-add').click(), (b) => edit(b.config!, [R6, `${R6}  - match: {}\n    style: {}\n`]));
  await expect(page.getByTestId('style-rule')).toHaveCount(8);
  await expect(page.getByTestId('legend-item')).toHaveCount(7);
  await page.getByTestId('undo').click();
  await saved(page);
  // Move down, move up; up on the first rule changes nothing.
  await step(page, d, () => rule(page, 0).getByTestId('rule-down').click(), (b) => edit(b.config!, [R0 + R1, R1 + R0]));
  await expect(rule(page, 0).getByTestId('rule-legend')).toHaveValue('One source only');
  await step(page, d, () => rule(page, 1).getByTestId('rule-up').click(), (b) => edit(b.config!, [R1 + R0, R0 + R1]));
  const now = d.read();
  expect(now.config).toBe(C);
  await rule(page, 0).getByTestId('rule-up').click();
  await rule(page, 6).getByTestId('rule-down').click();
  await unchanged(page, d, now);
  // Delete.
  await step(page, d, () => rule(page, 6).getByTestId('rule-delete').click(), (b) => edit(b.config!, [R6, '']));
  await expect(page.getByTestId('style-rule')).toHaveCount(6);
  await expect(page.getByTestId('legend-item')).toHaveCount(6);
});

test('rule legend: set, change and clear (Enter and blur commit)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await openStyles(page);
  await step(page, d, async () => {
    await rule(page, 0).getByTestId('rule-legend').fill('Confirmed: 2+');
    await rule(page, 0).getByTestId('rule-legend').press('Enter');
  }, (b) => edit(b.config!, ['  - legend: Confirmed by two or more people\n', '  - legend: "Confirmed: 2+"\n']));
  await expect(page.getByTestId('legend-item').first()).toContainText('Confirmed: 2+');
  // Blur commits too; empty removes the key and the legend item.
  await step(page, d, async () => {
    await rule(page, 0).getByTestId('rule-legend').fill('');
    await rule(page, 0).getByTestId('rule-legend').blur();
  }, (b) => edit(b.config!, ['  - legend: "Confirmed: 2+"\n    match: {confidence: confirmed}', '  - match: {confidence: confirmed}']));
  await expect(page.getByTestId('legend-item')).toHaveCount(6);
  // A new rule's legend.
  await page.getByTestId('rule-add').click();
  await saved(page);
  await step(page, d, async () => {
    await rule(page, 7).getByTestId('rule-legend').fill('Everything');
    await rule(page, 7).getByTestId('rule-legend').press('Enter');
  }, (b) => edit(b.config!, ['  - match: {}\n    style: {}\n', '  - match: {}\n    style: {}\n    legend: Everything\n']));
  await expect(page.getByTestId('legend-item')).toHaveCount(7);
});

test('match conditions: add (equals, present), change the test, edit value and field, delete', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await openStyles(page);
  // Add an equals condition: one edit, written once the value is in.
  await step(page, d, async () => {
    await rule(page, 3).getByTestId('match-add').click();
    const row = rule(page, 3).getByTestId('match-row').last();
    await row.getByTestId('match-field').fill('kind');
    await row.getByTestId('match-op').selectOption('equals');
    await row.getByTestId('match-value').fill('wait');
    await row.getByTestId('match-value').press('Enter');
  }, (b) => edit(b.config!, ['match: {system: erp}', 'match: {system: erp, kind: wait}']));
  await expect(rule(page, 3).getByTestId('match-row')).toHaveCount(2);
  // Add a present condition.
  await step(page, d, async () => {
    await rule(page, 4).getByTestId('match-add').click();
    const row = rule(page, 4).getByTestId('match-row').last();
    await row.getByTestId('match-field').fill('open_question');
    await row.getByTestId('match-op').selectOption('present');
  }, (b) => edit(b.config!, ['match: {system: excel}', 'match: {system: excel, open_question: present}']));
  // Change a test to absent, and back to equals with a value.
  const r5 = () => rule(page, 5).getByTestId('match-row').first();
  await step(page, d, async () => { await r5().getByTestId('match-op').selectOption('absent'); }, (b) => edit(b.config!, ['match: {kind: wait}', 'match: {kind: absent}']));
  await step(page, d, async () => {
    await r5().getByTestId('match-op').selectOption('equals');
    await r5().getByTestId('match-value').fill('delay');
    await r5().getByTestId('match-value').press('Enter');
  }, (b) => edit(b.config!, ['match: {kind: absent}', 'match: {kind: delay}']));
  // Edit a value; a typed number is written as a string.
  await step(page, d, async () => {
    await r5().getByTestId('match-value').fill('2');
    await r5().getByTestId('match-value').blur();
  }, (b) => edit(b.config!, ['match: {kind: delay}', 'match: {kind: "2"}']));
  // Rename the field in place.
  await step(page, d, async () => {
    await rule(page, 1).getByTestId('match-field').first().fill('level');
    await rule(page, 1).getByTestId('match-field').first().press('Enter');
  }, (b) => edit(b.config!, ['match: {confidence: single-source}', 'match: {level: single-source}']));
  // Delete.
  await step(page, d, () => rule(page, 6).getByTestId('match-delete').click(), (b) => edit(b.config!, ['match: {open_question: present}', 'match: {}']));
  await expect(rule(page, 6).getByTestId('match-row')).toHaveCount(0);
});

test('style properties: selects, number, badge (empty clears each)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await openStyles(page);
  const r1 = () => rule(page, 1);
  const S = 'style: {border_style: dashed, border_width: 1}';
  const prop = (p: string) => r1().locator(`[data-prop="${p}"]`);
  await step(page, d, async () => { await prop('border_style').selectOption('dotted'); }, (b) => edit(b.config!, [S, 'style: {border_style: dotted, border_width: 1}']));
  await step(page, d, async () => { await prop('border_style').selectOption(''); }, (b) => edit(b.config!, ['style: {border_style: dotted, border_width: 1}', 'style: {border_width: 1}']));
  await step(page, d, async () => {
    await prop('border_width').fill('3');
    await prop('border_width').press('Enter');
  }, (b) => edit(b.config!, ['style: {border_width: 1}', 'style: {border_width: 3}']));
  await step(page, d, async () => {
    await prop('font_style').selectOption('italic');
  }, (b) => edit(b.config!, ['style: {border_width: 3}', 'style: {border_width: 3, font_style: italic}']));
  await step(page, d, async () => {
    await prop('badge').fill('2');
    await prop('badge').press('Enter');
  }, (b) => edit(b.config!, ['style: {border_width: 3, font_style: italic}', 'style: {border_width: 3, font_style: italic, badge: "2"}']));
  await step(page, d, async () => {
    await prop('badge').fill('');
    await prop('badge').blur();
  }, (b) => edit(b.config!, ['style: {border_width: 3, font_style: italic, badge: "2"}', 'style: {border_width: 3, font_style: italic}']));
  await step(page, d, async () => {
    await prop('border_width').fill('');
    await prop('border_width').press('Enter');
  }, (b) => edit(b.config!, ['style: {border_width: 3, font_style: italic}', 'style: {font_style: italic}']));
  // Out of range: refused with a message, nothing written.
  const now = d.read();
  await prop('border_width').fill('5');
  await prop('border_width').press('Enter');
  await expect(page.getByTestId('toast')).toContainText('1 to 4');
  await unchanged(page, d, now);
  await expect(prop('border_width')).toHaveValue('');
});

test('colours: light and dark values, single colour when dark is empty or equal, empty light clears (R5.11)', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await openStyles(page);
  const color = (i: number, p: string, v: 'light' | 'dark') => rule(page, i).locator(`[data-prop="${p}"] [data-variant="${v}"]`);
  const S1 = 'style: {border_style: dashed, border_width: 1}';
  // A new single colour, written lowercase as entered.
  await step(page, d, async () => {
    await color(1, 'fill', 'light').fill('#ABC');
    await color(1, 'fill', 'light').press('Enter');
  }, (b) => edit(b.config!, [S1, 'style: {border_style: dashed, border_width: 1, fill: "#abc"}']));
  await expect(color(1, 'fill', 'light')).toHaveValue('#abc');
  await expect(color(1, 'fill', 'dark')).toHaveValue('');
  // Adding a dark value makes it {light, dark}.
  await step(page, d, async () => {
    await color(1, 'fill', 'dark').fill('#123');
    await color(1, 'fill', 'dark').press('Enter');
  }, (b) => edit(b.config!, ['fill: "#abc"}', 'fill: {light: "#abc", dark: "#123"}}']));
  // An existing themed colour: change dark; dark equal to light writes one colour; empty dark writes one colour.
  const F = 'style: {fill: {light: "#dae8fc", dark: "#1e3a5f"}}';
  await expect(color(3, 'fill', 'light')).toHaveValue('#dae8fc');
  await expect(color(3, 'fill', 'dark')).toHaveValue('#1e3a5f');
  await step(page, d, async () => {
    await color(3, 'fill', 'dark').fill('#000');
    await color(3, 'fill', 'dark').blur();
  }, (b) => edit(b.config!, [F, 'style: {fill: {light: "#dae8fc", dark: "#000"}}']));
  await step(page, d, async () => {
    await color(3, 'fill', 'dark').fill('#DAE8FC');
    await color(3, 'fill', 'dark').press('Enter');
  }, (b) => edit(b.config!, ['style: {fill: {light: "#dae8fc", dark: "#000"}}', 'style: {fill: "#dae8fc"}']));
  await step(page, d, async () => {
    await color(4, 'fill', 'dark').fill('');
    await color(4, 'fill', 'dark').press('Enter');
  }, (b) => edit(b.config!, ['style: {fill: {light: "#d5e8d4", dark: "#1f4a2c"}}', 'style: {fill: "#d5e8d4"}']));
  // Emptying the light value clears the whole property, dark included.
  await step(page, d, async () => {
    await color(6, 'border_color', 'light').fill('');
    await color(6, 'border_color', 'light').press('Enter');
  }, (b) => edit(b.config!, ['style: {border_color: {light: "#b85450", dark: "#f08080"}}', 'style: {}']));
  // Text colour and border colour together on a new property.
  await step(page, d, async () => {
    await color(0, 'text_color', 'light').fill('#333333');
    await color(0, 'text_color', 'light').press('Enter');
  }, (b) => edit(b.config!, ['style: {border_style: solid, border_width: 2}', 'style: {border_style: solid, border_width: 2, text_color: "#333333"}']));
  // Refusals: not a colour; a dark colour with no light one.
  const now = d.read();
  await color(0, 'border_color', 'light').fill('red');
  await color(0, 'border_color', 'light').press('Enter');
  await expect(page.getByTestId('toast').last()).toContainText('not a colour');
  await color(0, 'border_color', 'dark').fill('#000');
  await color(0, 'border_color', 'dark').press('Enter');
  await expect(page.getByTestId('toast').last()).toContainText('light colour');
  await unchanged(page, d, now);
  await expect(color(0, 'border_color', 'light')).toHaveValue('');
  // The native colour picker commits when it closes.
  await step(page, d, async () => {
    await rule(page, 2).locator('[data-prop="fill"] input[type="color"]').first().evaluate((el: HTMLInputElement) => {
      el.value = '#ff8800';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }, (b) => edit(b.config!, ['style: {border_style: dotted, font_style: italic}', 'style: {border_style: dotted, font_style: italic, fill: "#ff8800"}']));
});

test('P18 styles YAML: replace the whole list; anything but a list of rules is refused', async ({ page }, info) => {
  const d = makeDiagram(info);
  await open(page, d);
  await openStyles(page);
  const RULES = C.slice(C.indexOf('  - legend: Confirmed by two'), C.indexOf('nodes:\n'));
  await expect(page.getByTestId('styles-yaml')).toHaveValue(/^- legend: Confirmed by two or more people\n {2}match: \{confidence: confirmed\}/);
  const start = d.read();
  for (const [bad, msg] of [['a: b', 'list of rules'], ['- legend: x\n', 'match'], ['- [\n', 'YAML']] as const) {
    await page.getByTestId('styles-yaml').fill(bad);
    await page.getByTestId('styles-yaml-apply').click();
    await expect(page.getByTestId('yaml-error')).toContainText(msg);
  }
  await unchanged(page, d, start);
  await step(page, d, async () => {
    await page.getByTestId('styles-yaml').fill('- legend: Only one\n  match: {system: erp}\n  style: {fill: "#dae8fc"}\n');
    await page.getByTestId('styles-yaml-apply').click();
  }, (b) => edit(b.config!, [RULES, '  - legend: Only one\n    match: {system: erp}\n    style: {fill: "#dae8fc"}\n']));
  await expect(page.getByTestId('yaml-error')).toHaveCount(0);
  await expect(page.getByTestId('style-rule')).toHaveCount(1);
  await expect(page.getByTestId('legend-item')).toHaveText(['Only one']);
  await step(page, d, async () => {
    await page.getByTestId('styles-yaml').fill('[]');
    await page.getByTestId('styles-yaml-apply').click();
  }, (b) => edit(b.config!, ['styles:\n  - legend: Only one\n    match: {system: erp}\n    style: {fill: "#dae8fc"}\n', 'styles: []\n']));
});

// ---- UI26 config with errors, UI27 orphans ----------------------------------------------------------------------

test('a config with errors turns config editing off (with a message); the diagram stays editable', async ({ page }, info) => {
  const broken = 'version: 1\nstyles: [this is: not: valid\n';
  const d = makeDiagram(info, { ...PR, config: broken });
  await open(page, d);
  await expect(page.getByTestId('errors').locator('[data-code="E-config"]')).toBeVisible();
  const ins = await select(page, 'r01');
  await expect(ins).toContainText('config file (.flow.yaml) has errors');
  await expect(ins.getByTestId('add-field')).toBeDisabled();
  await expect(page.getByTestId('node-yaml')).toBeDisabled();
  await expect(page.getByTestId('node-yaml-apply')).toBeDisabled();
  await openStyles(page);
  await expect(page.getByTestId('rule-add')).toBeDisabled();
  await expect(page.getByTestId('styles-yaml')).toBeDisabled();
  await expect(page.getByTestId('styles-yaml-apply')).toBeDisabled();
  await expect(page.getByTestId('styles')).toContainText('has errors');
  // The diagram is still editable, and the broken config is never touched.
  const before = d.read();
  await ins.getByTestId('lane-select').selectOption('manager');
  const after = await settle(page, d, before);
  expect(declaredLane(after.mmd, 'r01')).toBe('manager');
  expect(after.config).toBe(broken);
  // Fixed on disk: editing comes back.
  d.write({ config: C });
  await expect(page.getByTestId('rule-add')).toBeEnabled();
  await expect(page.getByTestId('inspector').getByTestId('add-field')).toBeEnabled();
});

test('P19 orphans: delete a config node entry, a config lanes entry and a pin from the warnings list', async ({ page }, info) => {
  const d = makeDiagram(info, RICH);
  await open(page, d);
  const errors = page.getByTestId('errors');
  const orphan = (code: string) => errors.locator(`[data-code="${code}"]`);
  await expect(orphan('W-config-unknown-node')).toHaveCount(1);
  await expect(orphan('W-config-unknown-lane')).toHaveCount(1);
  await expect(orphan('W-layout-unknown-node')).toHaveCount(1);
  for (const code of ['W-config-unknown-node', 'W-config-unknown-lane', 'W-layout-unknown-node']) {
    await expect(orphan(code).getByTestId('orphan-delete')).toHaveCount(1);
  }
  // A node entry (the .mmd is written in canonical form, as `fmt` would).
  let before = d.read();
  await orphan('W-config-unknown-node').getByTestId('orphan-delete').click();
  let after = await settle(page, d, before);
  expectConfig(after.config, RICH.config!, edit(RICH.config!, ['  n1:                 # orphan: no such block\n    note: gone from the diagram\n', '']));
  expect(after.mmd).toBe(canon(RICH.mmd));
  await expect(orphan('W-config-unknown-node')).toHaveCount(0);
  await undoRedo(page, d, before, after);
  // A lanes entry.
  before = d.read();
  await orphan('W-config-unknown-lane').getByTestId('orphan-delete').click();
  after = await settle(page, d, before);
  expectConfig(after.config, before.config!, edit(before.config!, ['  - id: archive        # stale: no such lane\n', '']));
  await expect(orphan('W-config-unknown-lane')).toHaveCount(0);
  await undoRedo(page, d, before, after);
  // A pin (compared as parsed JSON, ignoring hints).
  before = d.read();
  await orphan('W-layout-unknown-node').getByTestId('orphan-delete').click();
  after = await settle(page, d, before);
  const nodes = (text: string | null) => (JSON.parse(text!) as { nodes: Record<string, unknown> }).nodes;
  const want = { ...nodes(RICH.layout) };
  delete want.n2;
  expect(nodes(after.layout)).toEqual(want);
  expect(after.config).toBe(before.config);
  await expect(orphan('W-layout-unknown-node')).toHaveCount(0);
  await undoRedo(page, d, before, after);
});
