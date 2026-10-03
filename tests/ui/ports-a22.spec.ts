// Amendment A22: more connection points per block side. A line's end can be dragged along the side it is on (it snaps
// at 0.25, 0.5 and 0.75; Alt turns that off), a new line can be dropped anywhere along the target's side, and the
// canvas context menu's `spread-ends` spreads the ends that share a side. Driven through §8.3's attributes plus A22's
// (`data-port-tick`, `data-port-drop`, `data-menu-item="spread-ends"`); every result is checked on disk, against
// `flowmap layout`, after a reload, and through undo and redo.
import { expect, test, type Page } from '@playwright/test';
import { makeDiagram, node, open, saved, settled, type Diagram, type Files } from './helpers';

/** A sequence-style exchange: a client and an authorization server send numbered messages back and forth. */
const MMD = `flowchart LR

  subgraph flow [Flow]
    client["Client"]
    server["Authorization server"]
  end

  client -->|1 authorize| server
  server -->|2 code| client
  client -->|3 token| server
`;

const LAYOUT = `{
  "version": 1,
  "nodes": {
    "client": { "lane": "flow", "along": 40, "across": 40, "width": 160, "height": 120 },
    "server": { "lane": "flow", "along": 520, "across": 40, "width": 160, "height": 120 }
  },
  "edges": {
    "client->server": { "source_side": "right", "target_side": "left" },
    "server->client": { "source_side": "left", "target_side": "right" },
    "client->server#2": { "source_side": "right", "target_side": "left" }
  }
}
`;

const FILES: Files = { mmd: MMD, config: null, layout: LAYOUT };

type Json = Record<string, any>;
const layoutJs = (text: string | null): Json | null => {
  if (text === null) return null;
  const { hints: _h, ...rest } = JSON.parse(text) as Json;
  return rest;
};
const edge = (page: Page, id: string) => page.locator(`[data-edge-id="${id}"]`);

/** A block's box in diagram coordinates (`data-x/y/width/height`) and on screen. */
async function boxOf(page: Page, id: string) {
  const n = node(page, id);
  const a = await n.evaluate((el) => {
    const d = (el as HTMLElement).dataset;
    return { x: Number(d.x), y: Number(d.y), w: Number(d.width), h: Number(d.height) };
  });
  const b = (await n.boundingBox())!;
  const z = b.width / a.w;
  return { ...a, z, screen: (x: number, y: number) => ({ x: b.x + (x - a.x) * z, y: b.y + (y - a.y) * z }) };
}

/** The drawn line (`data-points`) as a list of points. */
async function pointsOf(page: Page, id: string): Promise<number[][]> {
  const s = await edge(page, id).getAttribute('data-points');
  return s!.split(' ').map((p) => p.split(',').map(Number));
}

/** Select a line by clicking a point of its own path (as lines.spec.ts). */
async function selectLine(page: Page, id: string): Promise<void> {
  const p = await page.evaluate((id) => {
    const g = document.querySelector(`[data-edge-id="${CSS.escape(id)}"]`)!;
    const path = g.querySelector('path')!;
    const len = path.getTotalLength();
    const m = path.getScreenCTM()!;
    for (const f of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const q = path.getPointAtLength(len * f);
      const x = q.x * m.a + q.y * m.c + m.e;
      const y = q.x * m.b + q.y * m.d + m.f;
      if (document.elementFromPoint(x, y)?.closest('[data-edge-id]') === g) return { x, y };
    }
    throw new Error(`no clickable point on ${id}`);
  }, id);
  await page.mouse.click(p.x, p.y);
  await expect(edge(page, id)).toHaveAttribute('data-selected', 'true');
}

/** Zoom in (wheel, UI3) around a block so drags are a person's size. */
async function zoomIn(page: Page, id: string): Promise<void> {
  const b = (await node(page, id).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  const z0 = (await boxOf(page, id)).z;
  for (let i = 0; i < 2; i++) await page.mouse.wheel(0, -200);
  await expect.poll(async () => (await boxOf(page, id)).z).toBeGreaterThan(z0 * 1.3);
}

/** UI and `flowmap layout` agree on every drawn line (U13). */
async function expectLinesMatchCli(page: Page, d: Diagram): Promise<void> {
  const cli = d.cliLayout();
  for (const e of cli.edges) {
    await expect(edge(page, e.id)).toHaveAttribute('data-points', e.points.map((p) => p.join(',')).join(' '));
  }
}

/** Press on `from`, move like a person through `via` to `to`, and (unless `hold`) release. */
async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, opts: { alt?: boolean } = {}) {
  if (opts.alt) await page.keyboard.down('Alt');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
  await page.mouse.move(to.x, to.y, { steps: 3 });
}

test('drag a line end along the side it is on: it snaps at 0.25, writes target_at, and keeps it after a reload', async ({ page }, info) => {
  const d = makeDiagram(info, FILES);
  await open(page, d);
  await zoomIn(page, 'server');
  // All three lines arrive on the server's left side at its midline: they overlap.
  const server = await boxOf(page, 'server');
  const mid = [server.x, server.y + Math.floor(server.h / 2)];
  expect((await pointsOf(page, 'client->server')).at(-1)).toEqual(mid);
  expect((await pointsOf(page, 'client->server#2')).at(-1)).toEqual(mid);

  await selectLine(page, 'client->server#2');
  const grip = (await page.locator('[data-edge-id="client->server#2"] [data-edge-end="target"]').boundingBox())!;
  // A little below a quarter of the way down the left side: within the snap distance of 0.25 on screen.
  const target = server.screen(server.x, server.y + 0.25 * server.h + 3 / server.z);
  await dragTo(page, { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }, target);
  // The connection points show, with the snap ticks; the drop marker sits at 0.25 on the left side.
  await expect(node(page, 'server').locator('[data-port-target]')).toHaveCount(4);
  await expect(node(page, 'server').locator('[data-port-tick]')).toHaveCount(8);
  const drop = node(page, 'server').locator('[data-port-drop]');
  await expect(drop).toHaveAttribute('data-side', 'left');
  await expect(drop).toHaveAttribute('data-at', '0.25');
  await expect(node(page, 'server').locator('[data-port-tick="left"][data-at="0.25"]')).toHaveAttribute('data-active', 'true');
  await page.mouse.up();
  await expect(page.locator('[data-port-drop]')).toHaveCount(0);

  const after = await settled(page, d, (f) => layoutJs(f.layout)?.edges?.['client->server#2']?.target_at !== undefined);
  expect(after.mmd).toBe(MMD); // the id and the line's place in the file stay
  expect(layoutJs(after.layout)!.edges).toEqual({
    'client->server': { source_side: 'right', target_side: 'left' },
    'server->client': { source_side: 'left', target_side: 'right' },
    'client->server#2': { source_side: 'right', target_side: 'left', target_at: 0.25 },
  });
  const quarter = [server.x, server.y + Math.floor(0.25 * server.h)];
  await expect.poll(async () => (await pointsOf(page, 'client->server#2')).at(-1)).toEqual(quarter);
  await expect(edge(page, 'client->server#2')).toHaveAttribute('data-selected', 'true');
  await expectLinesMatchCli(page, d);

  // Reload: the end stays where it was put.
  await page.reload();
  await expect(edge(page, 'client->server#2')).toBeVisible();
  expect((await pointsOf(page, 'client->server#2')).at(-1)).toEqual(quarter);
  expect((await pointsOf(page, 'client->server')).at(-1)).toEqual(mid);
  expect(d.read().layout).toBe(after.layout);

  // Back along the side to the midline: the offset is removed, so the file is what it was.
  await zoomIn(page, 'server');
  const again = await boxOf(page, 'server');
  await selectLine(page, 'client->server#2');
  const grip2 = (await page.locator('[data-edge-id="client->server#2"] [data-edge-end="target"]').boundingBox())!;
  await dragTo(page, { x: grip2.x + grip2.width / 2, y: grip2.y + grip2.height / 2 }, again.screen(again.x, again.y + again.h / 2 + 2 / again.z));
  await expect(node(page, 'server').locator('[data-port-target="left"]')).toHaveAttribute('data-active', 'true');
  await page.mouse.up();
  const back = await settled(page, d, (f) => layoutJs(f.layout)?.edges?.['client->server#2']?.target_at === undefined);
  expect(layoutJs(back.layout)).toEqual(layoutJs(LAYOUT));

  // Undo puts the offset back (UI28), redo removes it again.
  await saved(page);
  await page.getByTestId('undo').click();
  expect((await settled(page, d, (f) => f.layout === after.layout)).layout).toBe(after.layout);
  await saved(page);
  await page.getByTestId('redo').click();
  expect((await settled(page, d, (f) => f.layout === back.layout)).layout).toBe(back.layout);
});

test('connect from a handle and drop along the target\'s side; with Alt it doesn\'t snap', async ({ page }, info) => {
  const d = makeDiagram(info, { ...FILES, layout: LAYOUT.replace(/,\n  "edges": \{[^]*?\n  \}\n/, '\n') });
  await open(page, d);
  await zoomIn(page, 'server');
  await node(page, 'client').hover();
  const handle = (await node(page, 'client').locator('[data-handle="source"][data-port="bottom"]').boundingBox())!;
  const server = await boxOf(page, 'server');
  // The server's bottom side at 62% of its width, not near a snap point.
  const target = server.screen(server.x + 0.62 * server.w, server.y + server.h - 2 / server.z);
  await dragTo(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, target, { alt: true });
  const drop = node(page, 'server').locator('[data-port-drop]');
  await expect(drop).toHaveAttribute('data-side', 'bottom');
  const at = Number(await drop.getAttribute('data-at'));
  expect(Math.abs(at - 0.62)).toBeLessThanOrEqual(0.02);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const files = await settled(page, d, (f) => f.mmd.includes('client --> server') && layoutJs(f.layout)?.edges !== undefined);
  expect(files.mmd).toBe(`${MMD}  client --> server\n`);
  expect(layoutJs(files.layout)!.edges).toEqual({ 'client->server#3': { source_side: 'bottom', target_side: 'bottom', target_at: at } });
  await expect.poll(async () => (await pointsOf(page, 'client->server#3')).at(-1))
    .toEqual([server.x + Math.floor((Math.round(at * 100) * server.w) / 100), server.y + server.h]);
  await expectLinesMatchCli(page, d);
});

test('spread-ends in the canvas context menu spreads the line ends that share a side; reload keeps it', async ({ page }, info) => {
  const d = makeDiagram(info, FILES);
  await open(page, d);
  const outs = async () => new Set((await Promise.all(['client->server', 'client->server#2'].map((id) => pointsOf(page, id)))).map((p) => p[0]!.join(',')));
  expect((await outs()).size).toBe(1);

  // Right-click the empty canvas below the blocks.
  const client = (await node(page, 'client').boundingBox())!;
  const at = { x: client.x + client.width / 2, y: client.y + client.height + 80 };
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu).toBeVisible();
  const item = menu.locator('[data-menu-item="spread-ends"]');
  await expect(item).toHaveAttribute('aria-checked', 'false');
  await item.click();
  const on = await settled(page, d, (f) => layoutJs(f.layout)?.spread_ends === true);
  expect(layoutJs(on.layout)).toEqual({ ...layoutJs(LAYOUT), spread_ends: true });
  // The client's right side holds three ends (two requests leaving, the answer arriving): each gets its own point.
  const box = await boxOf(page, 'client');
  const right = box.x + box.w;
  await expect.poll(async () => (await outs()).size).toBe(2);
  const ys = [
    (await pointsOf(page, 'client->server'))[0]!,
    (await pointsOf(page, 'server->client')).at(-1)!,
    (await pointsOf(page, 'client->server#2'))[0]!,
  ];
  for (const p of ys) expect(p[0]).toBe(right);
  expect(new Set(ys.map((p) => p[1])).size).toBe(3);
  await expectLinesMatchCli(page, d);

  await page.reload();
  await expect(edge(page, 'client->server')).toBeVisible();
  expect((await outs()).size).toBe(2);

  // Off again: the key is removed.
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(menu.locator('[data-menu-item="spread-ends"]')).toHaveAttribute('aria-checked', 'true');
  await menu.locator('[data-menu-item="spread-ends"]').click();
  const off = await settled(page, d, (f) => layoutJs(f.layout)?.spread_ends === undefined);
  expect(layoutJs(off.layout)).toEqual(layoutJs(LAYOUT));
  await expect.poll(async () => (await outs()).size).toBe(1);
});
