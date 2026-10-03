// Amendment A19: groups (subgraphs inside lanes). Drawn from the layout (the same boxes as `flowmap layout`), and a
// block moves into, out of and between groups by dragging (UI11 with groups) or with the inspector's group select.
// Each move rewrites the `.mmd` to exactly the hand edit after `fmt`, pins the block with its group (§5), and undoes
// and redoes byte for byte.
import { expect, test, type Page } from '@playwright/test';
import { findNode, format, parse } from '../../src/core/mmd';
import { attrs, dragFromTo, expectMatchesCli, makeDiagram, node, open, saved, settled, type Diagram, type Files } from './helpers';

const MMD = `flowchart LR

  subgraph acct [Account]
    gw["Gateway"]
    subgraph net [Network]
      lb["Load balancer"]
      subgraph sub-a [Subnet A]
        %% the app tier
        app["App server"]
      end
      subgraph sub-b [Subnet B]
        db[("Database")]
      end
    end
  end

  subgraph ops [Operations]
    oncall(["On call"])
  end

  gw --> lb
  lb --> app
  app --> db
  db --> oncall
`;
const FILES: Files = { mmd: MMD, config: null, layout: null };

const fmt = (text: string) => format(parse(text).diagram);
const groupOf = (mmd: string, id: string) => findNode(parse(mmd).diagram, id)?.group ?? null;
const group = (page: Page, id: string) => page.locator(`[data-group-id="${id}"]`);
const pinOf = (f: Files, id: string) => (f.layout ? JSON.parse(f.layout).nodes[id] : undefined);

/** A point inside a group's box on screen (fractions of its box), away from its label. */
async function inGroup(page: Page, id: string, fx = 0.5, fy = 0.75): Promise<{ x: number; y: number }> {
  const b = (await group(page, id).boundingBox())!;
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}

async function centreOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  const b = (await node(page, id).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function expectUndoRedo(page: Page, d: Diagram, before: Files, after: Files): Promise<void> {
  await page.getByTestId('undo').click();
  await settled(page, d, (f) => f.mmd === before.mmd && f.layout === before.layout, 3000);
  expect(d.read()).toEqual(before);
  await page.getByTestId('redo').click();
  await settled(page, d, (f) => f.mmd === after.mmd && f.layout === after.layout, 3000);
  expect(d.read()).toEqual(after);
}

test('groups are drawn as their layout boxes, with labels; grouped blocks carry data-group (A19)', async ({ page }, info) => {
  const d = makeDiagram(info, FILES);
  await open(page, d);
  const cli = d.cliLayout();
  expect(cli.groups!.map((g) => g.id)).toEqual(['net', 'sub-a', 'sub-b']);
  for (const g of cli.groups!) {
    const el = group(page, g.id);
    await expect(el).toHaveAttribute('data-lane', g.lane);
    if (g.parent) await expect(el).toHaveAttribute('data-parent-group', g.parent);
    else await expect(el).not.toHaveAttribute('data-parent-group');
    const box = await el.evaluate((e) => {
      const s = (e as HTMLElement).dataset;
      return [Number(s.x), Number(s.y), Number(s.width), Number(s.height)];
    });
    expect(box).toEqual([g.x, g.y, g.width, g.height]);
    await expect(el.locator('[data-role="group-label"]')).toHaveText(g.label);
  }
  await expect(node(page, 'app')).toHaveAttribute('data-group', 'sub-a');
  await expect(node(page, 'lb')).toHaveAttribute('data-group', 'net');
  await expect(node(page, 'gw')).not.toHaveAttribute('data-group');
  await expectMatchesCli(page, d);
  // Every grouped block is drawn inside its group's box.
  for (const id of ['app', 'lb', 'db']) {
    const n = await attrs(node(page, id));
    const gid = (await node(page, id).getAttribute('data-group'))!;
    const g = cli.groups!.find((x) => x.id === gid)!;
    expect(n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height).toBe(true);
  }
});

test('drag a block from one group into another: the .mmd moves it, the pin records the group; undo and redo', async ({ page }, info) => {
  const d = makeDiagram(info, FILES);
  await open(page, d);
  const before = d.read();
  const from = await centreOf(page, 'app');
  const to = await inGroup(page, 'sub-b', 0.5, 0.5);
  // While dragging, the group it would join is highlighted.
  await page.keyboard.down('Alt');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await expect(group(page, 'sub-b')).toHaveAttribute('data-drop-target', 'true');
  await expect(group(page, 'sub-a')).not.toHaveAttribute('data-drop-target');
  await page.mouse.up();
  await page.keyboard.up('Alt');

  const want = fmt(MMD.replace('        %% the app tier\n        app["App server"]\n', '')
    .replace('        db[("Database")]\n', '        db[("Database")]\n        %% the app tier\n        app["App server"]\n'));
  const after = await settled(page, d, (f) => f.mmd === want && !!pinOf(f, 'app'));
  expect(after.mmd).toBe(want);
  expect(groupOf(after.mmd, 'app')).toBe('sub-b');
  expect(pinOf(after, 'app')).toMatchObject({ lane: 'acct', group: 'sub-b' });
  await saved(page);
  await expect(node(page, 'app')).toHaveAttribute('data-group', 'sub-b');
  await expect(node(page, 'app')).toHaveAttribute('data-pinned', 'true');
  // It is drawn where it was dropped, inside its new group.
  const n = await attrs(node(page, 'app'));
  const g = d.cliLayout().groups!.find((x) => x.id === 'sub-b')!;
  expect(n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height).toBe(true);
  await expectMatchesCli(page, d);
  await expectUndoRedo(page, d, before, d.read());
});

test('drag a block out of its group into its lane, and a top-level block into a group', async ({ page }, info) => {
  const d = makeDiagram(info, FILES);
  await open(page, d);
  // Out: drop `app` on the lane below every group box (the lane's own area after its groups).
  const lane = (await page.locator('[data-lane-id="acct"]').boundingBox())!;
  const net = (await group(page, 'net').boundingBox())!;
  const below = { x: net.x + net.width / 2, y: (net.y + net.height + lane.y + lane.height) / 2 };
  await dragFromTo(page, await centreOf(page, 'app'), below, { alt: true });
  const out = await settled(page, d, (f) => groupOf(f.mmd, 'app') === null && !!pinOf(f, 'app'));
  expect(groupOf(out.mmd, 'app')).toBeNull();
  expect(findNode(parse(out.mmd).diagram, 'app')?.lane).toBe('acct');
  expect(out.mmd).toContain('    gw["Gateway"]\n    %% the app tier\n    app["App server"]\n    subgraph net');
  expect(pinOf(out, 'app')).not.toHaveProperty('group');
  await saved(page);

  // In: drop `gw` (top level of acct) into Network, away from its subnets.
  await expect(group(page, 'net')).toBeVisible();
  const netBox = (await group(page, 'net').boundingBox())!;
  const lbBox = (await node(page, 'lb').boundingBox())!;
  const target = { x: (lbBox.x + lbBox.width + netBox.x + netBox.width) / 2, y: lbBox.y + lbBox.height / 2 };
  await dragFromTo(page, await centreOf(page, 'gw'), target, { alt: true });
  const inn = await settled(page, d, (f) => groupOf(f.mmd, 'gw') === 'net');
  expect(groupOf(inn.mmd, 'gw')).toBe('net');
  expect(pinOf(inn, 'gw')).toMatchObject({ lane: 'acct', group: 'net' });
  await saved(page);
  await expectMatchesCli(page, d);
});

test('the inspector\'s group select moves a block between groups (pin dropped) and back to none', async ({ page }, info) => {
  const d = makeDiagram(info, FILES);
  await open(page, d);
  await node(page, 'db').click();
  const inspector = page.getByTestId('inspector');
  await expect(inspector.locator('[data-field="group"]')).toHaveText('sub-b');
  const select = inspector.getByTestId('group-select');
  await select.selectOption('sub-a');
  const moved = await settled(page, d, (f) => groupOf(f.mmd, 'db') === 'sub-a');
  expect(moved.mmd).toContain('        app["App server"]\n        db[("Database")]\n      end\n      subgraph sub-b [Subnet B]\n      end');
  await expect(inspector.locator('[data-field="group"]')).toHaveText('sub-a');
  await select.selectOption('');
  const none = await settled(page, d, (f) => groupOf(f.mmd, 'db') === null);
  expect(findNode(parse(none.mmd).diagram, 'db')?.lane).toBe('acct');
  expect(pinOf(none, 'db')).toBeUndefined();
  // A block in a lane without groups shows no group row.
  await node(page, 'oncall').click();
  await expect(inspector.getByTestId('group-select')).toHaveCount(0);
});
