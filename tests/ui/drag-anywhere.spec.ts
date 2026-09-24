// UI10/UI11, drag anywhere (Dan's report: "the root node ... just goes back to the starting origin point when I
// release"). Every block, roots and sinks included, dragged with the mouse in every direction, including before and
// above everything: it ends where it was released (within 1 px on screen), the other blocks stay put, the pin on disk
// is exactly the drop (negative when before or above everything, v1.1 §5), `flowmap layout` agrees, and it stays
// there after a reload.
import { expect, test, type Page } from '@playwright/test';
import { format, parse } from '../../src/core/mmd';
import { attrs, dragFromTo, eventually, expectMatchesCli, makeDiagram, node, open, pins, saved, type Diagram, type Files } from './helpers';

const canon = (text: string) => format(parse(text).diagram);

// As made from scratch with "New diagram → Flowchart": no subgraphs.
const FLOW: Files = {
  mmd: canon(`flowchart LR
  n1["Step 1"]
  n2["Step 2"]
  n3{"Decision 1"}
  n4["Yes"]
  n5["No"]
  n1 --> n2
  n2 --> n3
  n3 -->|yes| n4
  n3 -->|no| n5
`),
  config: 'version: 1\ntitle: Test\n',
  layout: null,
};

const LANES: Files = {
  mmd: canon(`flowchart LR
  subgraph alpha [Alpha]
    a1(["Start"])
    a2["Check it"]
  end
  subgraph beta [Beta]
    b1{"OK?"}
    b2["Do it"]
  end
  a1 --> a2
  a2 --> b1
  b1 -->|yes| b2
`),
  config: null,
  layout: null,
};

type Pt = { x: number; y: number };

async function centreOf(page: Page, id: string): Promise<Pt> {
  const b = (await node(page, id).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function canvasBox(page: Page) {
  return (await page.getByTestId('canvas').boundingBox())!;
}

/**
 * Centres of every block on screen, relative to the canvas element (a notice banner can move the whole canvas, e.g.
 * the warning for a block outside every lane; that isn't the diagram moving).
 */
async function centres(page: Page): Promise<Map<string, Pt>> {
  const c = await canvasBox(page);
  const ids = await page.locator('[data-node-id]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.nodeId!));
  const out = new Map<string, Pt>();
  for (const id of ids) {
    const p = await centreOf(page, id);
    out.set(id, { x: p.x - c.x, y: p.y - c.y });
  }
  return out;
}

type Where = (canvas: { x: number; y: number; width: number; height: number }, at: Pt) => Pt | Promise<Pt>;

/**
 * Select `id` (the inspector opens and the canvas narrows, which may pan to keep it in view), then drag its centre to
 * `where` (a screen point), then check: it is there within 1 px; (with `still`) those blocks didn't move on screen;
 * the pin is on disk in `lane`, the UI matches `flowmap layout`; after a reload it keeps its world position.
 */
async function dragAndCheck(page: Page, d: Diagram, id: string, where: Where, opts: { lane: string; still?: (to: Pt, at: Map<string, Pt>) => string[] }): Promise<void> {
  await node(page, id).click();
  await expect(node(page, id)).toHaveAttribute('data-selected', 'true');
  await expect(page.getByRole('region', { name: 'Inspector' })).toBeVisible();
  const c0 = await canvasBox(page);
  const before = await centres(page);
  const from = { x: before.get(id)!.x + c0.x, y: before.get(id)!.y + c0.y };
  const to = await where(c0, from);
  const want = { x: to.x - c0.x, y: to.y - c0.y };
  const still = opts.still?.(want, before) ?? [];
  await dragFromTo(page, from, to, { alt: true }); // exactly where released: no snapping (UI39)
  const files = await eventually(() => d.read(), (f) => pins(f.layout)[id]?.lane === opts.lane);
  expect(pins(files.layout)[id]?.lane).toBe(opts.lane);
  await saved(page);
  const after = await centres(page);
  const got = after.get(id)!;
  expect(Math.abs(got.x - want.x), `${id} x: at ${got.x}, released at ${want.x}`).toBeLessThanOrEqual(1);
  expect(Math.abs(got.y - want.y), `${id} y: at ${got.y}, released at ${want.y}`).toBeLessThanOrEqual(1);
  for (const other of still) {
    const b = before.get(other)!;
    const a = after.get(other)!;
    expect(Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1, `${other} moved from ${b.x},${b.y} to ${a.x},${a.y}`).toBe(true);
  }
  const moved = await attrs(node(page, id));
  expect(moved.pinned).toBe(true);
  expect(moved.lane).toBe(opts.lane);
  await expectMatchesCli(page, d);
  // A reload lays out the same files: same world position, same place relative to the others.
  const world = await page.locator('[data-node-id]').evaluateAll((els) => els.map((el) => [(el as HTMLElement).dataset.nodeId, (el as HTMLElement).dataset.x, (el as HTMLElement).dataset.y]));
  await page.reload();
  await expect(node(page, id)).toBeVisible();
  const world2 = await page.locator('[data-node-id]').evaluateAll((els) => els.map((el) => [(el as HTMLElement).dataset.nodeId, (el as HTMLElement).dataset.x, (el as HTMLElement).dataset.y]));
  expect(world2).toEqual(world);
}

test.describe('lane-free flowchart: drag any block anywhere', () => {
  // Targets inside the canvas, clear of the palette (left) and the zoom controls (bottom right).
  const targets: [string, (c: { x: number; y: number; width: number; height: number }, at: Pt) => Pt][] = [
    ['right', (_c, at) => ({ x: at.x + 230, y: at.y })],
    ['down', (_c, at) => ({ x: at.x, y: at.y + 190 })],
    ['up, above everything', (c, at) => ({ x: at.x, y: c.y + 70 })],
    ['left, before everything', (c, at) => ({ x: c.x + 170, y: at.y })],
    ['far up-left', (c) => ({ x: c.x + 170, y: c.y + 70 })],
    ['far down-right', (c) => ({ x: c.x + c.width - 260, y: c.y + c.height - 120 })],
  ];
  for (const id of ['n1', 'n2', 'n3', 'n4', 'n5']) {
    for (const [name, where] of targets) {
      test(`${id} ${name}`, async ({ page }, info) => {
        const d = makeDiagram(info, FLOW);
        await open(page, d);
        // Blocks the drop lands near may make room (L3); the rest must stay put.
        const still = (to: Pt, at: Map<string, Pt>) => [...at.keys()]
          .filter((o) => o !== id && (Math.abs(at.get(o)!.x - to.x) > 200 || Math.abs(at.get(o)!.y - to.y) > 120));
        await dragAndCheck(page, d, id, where, { lane: '_unassigned', still });
      });
    }
  }

  test('Dan\'s report: the root dragged up and to the left is pinned exactly there (negative values)', async ({ page }, info) => {
    const d = makeDiagram(info, FLOW);
    await open(page, d);
    const n1 = await attrs(node(page, 'n1'));
    const box = (await node(page, 'n1').boundingBox())!;
    const zoom = box.width / n1.width;
    await dragAndCheck(page, d, 'n1', (_c, from) => ({ x: from.x - 110 * zoom, y: from.y - 80 * zoom }), {
      lane: '_unassigned', still: () => ['n2', 'n3', 'n4', 'n5'],
    });
    const pin = pins(d.read().layout).n1!;
    expect(Math.abs(pin.along - (n1.x - 110))).toBeLessThanOrEqual(1);
    expect(Math.abs(pin.across - (n1.y - 80))).toBeLessThanOrEqual(1);
    expect(pin.along).toBeLessThan(0);
    expect(pin.across).toBeLessThan(0);
    // `flowmap layout` still starts at 0: the translation puts n1 at the origin.
    const cli = d.cliLayout();
    expect(cli.nodes.find((n) => n.id === 'n1')).toMatchObject({ x: 0, y: 0 });
  });
});

test.describe('swimlanes: drag any block anywhere', () => {
  const cases: [string, string, (c: { x: number; y: number; width: number; height: number }, at: Pt, lanes: Map<string, { top: number; bottom: number }>) => Pt, string][] = [];
  for (const [id, lane] of [['a1', 'alpha'], ['a2', 'alpha'], ['b1', 'beta'], ['b2', 'beta']] as const) {
    const other = lane === 'alpha' ? 'beta' : 'alpha';
    cases.push([id, 'left, before the diagram, same lane', (c, at) => ({ x: c.x + 170, y: at.y }), lane]);
    cases.push([id, 'right, past the lanes, same lane', (c, at) => ({ x: Math.min(at.x + 420, c.x + c.width - 260), y: at.y }), lane]);
    cases.push([id, `into ${other}`, (_c, at, lanes) => ({ x: at.x + 60, y: lanes.get(other)!.top + 45 }), other]);
    cases.push([id, 'above every lane: joins the first lane', (_c, at, lanes) => ({ x: at.x + 40, y: lanes.get('alpha')!.top - 60 }), 'alpha']);
    // (Away from the canvas edges: the warning banner this drop raises narrows the canvas, which keeps the selected
    // block in view, UI behaviour this test isn't about.)
    cases.push([id, 'below every lane: Unassigned', (_c, at, lanes) => ({ x: at.x - 60, y: lanes.get('beta')!.bottom + 70 }), '_unassigned']);
  }
  for (const [id, name, where, into] of cases) {
    test(`${id} ${name}`, async ({ page }, info) => {
      const d = makeDiagram(info, LANES);
      await open(page, d);
      await dragAndCheck(page, d, id, async (c, at) => {
        const lanes = new Map<string, { top: number; bottom: number }>();
        for (const l of ['alpha', 'beta']) {
          const b = (await page.locator(`[data-lane-id="${l}"]`).boundingBox())!;
          lanes.set(l, { top: b.y, bottom: b.y + b.height });
        }
        return where(c, at, lanes);
      }, { lane: into });
    });
  }
});
