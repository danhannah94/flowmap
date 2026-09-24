// UI10/UI11 through the real UI path: `dropNodes` (and nudges, and palette drops) on a live `Store`, checked on screen
// (world × zoom + pan). Every block (roots and sinks included) is dropped in every direction, including before, after
// and above everything; it must land exactly where it was released (within 1 px) and stay there after a reload. In a
// lane-free diagram, blocks nobody touched must not move on screen either (the layout translates for negative pins
// and the view pans with it, v1.1 §5–§6).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { loadDocument } from '../core/document';
import { parseLayoutFile } from '../core/layoutfile';
import { pinTranslation } from '../core/layout';
import { canon } from '../core/ops/testkit';
import { clearAllPins, type Files } from '../core/ops';
import { UNASSIGNED, type LayoutResult } from '../core/types';
import { addBlock, dropNodes, nudgeSelection } from './actions';
import { derive } from './store/derive';
import { Store } from './store/store';

const FLOW = canon(`flowchart LR
  n1["Step 1"]
  n2["Step 2 - This is the second step in the process"]
  n3{"Decision 1"}
  n4["Yes"]
  n5["No"]
  n1 --> n2
  n2 --> n3
  n3 -->|yes| n4
  n3 -->|no| n5
`);

const LANES = canon(`flowchart LR
  subgraph alpha [Alpha]
    a1(["Start"])
    a2["Check the request"]
  end
  subgraph beta [Beta]
    b1{"Approve?"}
    b2["Order it"]
  end
  subgraph gamma [Gamma]
    c1(["Done"])
  end
  a1 --> a2
  a2 --> b1
  b1 -->|yes| b2
  b1 -->|no| c1
  b2 --> c1
`);

type Box = { x: number; y: number; width: number; height: number };

function storeFor(files: Files, viewport = { x: 180, y: 140, zoom: 0.8 }): Store {
  const store = new Store();
  const d = derive(files, 't.mmd');
  store.set({ status: 'ready', file: 't.mmd', files, derived: d, shown: d, viewport, viewportSize: { width: 1400, height: 900 } });
  return store;
}

/** Every block's box on screen. */
function screen(store: Store): Map<string, Box> {
  const { viewport: v } = store.getState();
  return new Map(store.layout!.nodes.map((n) => [n.id, { x: n.x * v.zoom + v.x, y: n.y * v.zoom + v.y, width: n.width * v.zoom, height: n.height * v.zoom }]));
}

/** The layout a fresh load of the saved files gives (a reload, or `flowmap layout`). */
function reloaded(store: Store): LayoutResult {
  const f = store.getState().files!;
  return loadDocument(f.mmd, f.config, f.layout, 't.mmd').layout!.result;
}

const pinsOnDisk = (store: Store) => parseLayoutFile(store.getState().files!.layout).file!.nodes;
const near = (a: number, b: number) => Math.abs(a - b) <= 1;
const gap = (a: Box, b: Box, m: number) => a.x >= b.x + b.width + m || b.x >= a.x + a.width + m || a.y >= b.y + b.height + m || b.y >= a.y + a.height + m;

/**
 * Drop `id` moved by (dx, dy) world px and check it landed exactly there on screen, and that a reload (the files on
 * disk) gives the same layout. With `others`, also check that every other block kept its place on screen when the
 * drop lands clear of them (so nothing had to make room).
 */
function dropAndCheck(store: Store, id: string, dx: number, dy: number, opts: { others?: boolean; lane?: string } = {}): void {
  const z = store.getState().viewport.zoom;
  const before = screen(store);
  const beforeWorld = store.layout!;
  dropNodes(store, [id], dx, dy);
  const after = screen(store);
  const b = before.get(id)!;
  const a = after.get(id)!;
  expect(near(a.x, b.x + dx * z) && near(a.y, b.y + dy * z), `${id} by (${dx}, ${dy}): at ${a.x},${a.y}, wanted ${b.x + dx * z},${b.y + dy * z}`).toBe(true);
  const n = store.layout!.nodes.find((x) => x.id === id)!;
  expect(n.pinned).toBe(true);
  if (opts.lane) expect(n.lane).toBe(opts.lane);
  expect(reloaded(store)).toEqual(store.layout);
  // `flowmap layout` output still starts at 0.
  expect(Math.min(...store.layout!.nodes.map((x) => x.x))).toBeGreaterThanOrEqual(0);
  expect(Math.min(...store.layout!.nodes.map((x) => x.y))).toBeGreaterThanOrEqual(0);
  if (!opts.others) return;
  const moved = beforeWorld.nodes.find((x) => x.id === id)!;
  const landed = { x: moved.x + dx, y: moved.y + dy, width: moved.width, height: moved.height };
  if (!beforeWorld.nodes.every((x) => x.id === id || gap(landed, x, 40))) return;
  for (const [other, ob] of before) {
    if (other === id) continue;
    const oa = after.get(other)!;
    expect(near(oa.x, ob.x) && near(oa.y, ob.y), `${other} moved from ${ob.x},${ob.y} to ${oa.x},${oa.y}`).toBe(true);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('lane-free flowchart (amendment A4): drag any block anywhere', () => {
  const ids = ['n1', 'n2', 'n3', 'n4', 'n5'];
  const moves: [string, number, number][] = [
    ['right', 260, 0], ['down', 0, 170], ['up', 0, -150], ['left', -260, 0],
    ['far up-left', -900, -700], ['far down-right', 1400, 900], ['up-right', 300, -220], ['down-left', -300, 220],
  ];
  for (const dir of ['LR', 'TB'] as const) {
    for (const id of ids) {
      for (const [name, dx, dy] of moves) {
        test(`${dir}: ${id} ${name}`, () => {
          const store = storeFor({ mmd: FLOW.replace('flowchart LR', `flowchart ${dir}`), config: null, layout: null });
          dropAndCheck(store, id, dx, dy, { others: true, lane: UNASSIGNED });
        });
      }
    }
  }

  test('Dan\'s report: the root dragged up and left stays where it is released; the pin is exactly the drop', () => {
    const store = storeFor({ mmd: FLOW, config: 'version: 1\ntitle: Test\n', layout: null }, { x: 250, y: 200, zoom: 1 });
    const start = store.layout!.nodes.find((n) => n.id === 'n1')!;
    dropAndCheck(store, 'n1', -120, -90, { others: true });
    // Stored exactly where it was dropped (negative), nothing else rewritten.
    expect(pinsOnDisk(store)).toEqual({ n1: { lane: UNASSIGNED, along: start.x - 120, across: start.y - 90 } });
    dropAndCheck(store, 'n1', -200, 0, { others: true });
    dropAndCheck(store, 'n5', -500, -300, { others: true });
    expect(pinsOnDisk(store)).toEqual({
      n1: { lane: UNASSIGNED, along: start.x - 320, across: start.y - 90 },
      n5: expect.objectContaining({ lane: UNASSIGNED }),
    });
    // Dragged back where they started: every value is back to ≥ 0 and the translation to none.
    const fresh = derive({ mmd: FLOW, config: null, layout: null }, 't.mmd').layout!;
    const s5 = fresh.nodes.find((n) => n.id === 'n5')!;
    const t = () => pinTranslation(Object.values(store.getState().derived!.doc.pins), UNASSIGNED);
    const at = (id: string) => store.layout!.nodes.find((n) => n.id === id)!;
    dropAndCheck(store, 'n5', s5.x + t().along - at('n5').x, s5.y + t().across - at('n5').y, { others: true });
    dropAndCheck(store, 'n1', start.x + t().along - at('n1').x, start.y + t().across - at('n1').y, { others: true });
    expect(pinsOnDisk(store)).toEqual({
      n1: { lane: UNASSIGNED, along: start.x, across: start.y },
      n5: { lane: UNASSIGNED, along: s5.x, across: s5.y },
    });
    expect(t()).toEqual({ along: 0, across: 0 });
  });

  test('a multi-block drag before everything keeps the blocks together, one undo step restores the view', () => {
    const files: Files = { mmd: FLOW, config: null, layout: null };
    const store = storeFor(files);
    const before = screen(store);
    dropNodes(store, ['n1', 'n2'], -300, -200);
    const after = screen(store);
    const z = store.getState().viewport.zoom;
    for (const id of ['n1', 'n2']) {
      expect(near(after.get(id)!.x, before.get(id)!.x - 300 * z)).toBe(true);
      expect(near(after.get(id)!.y, before.get(id)!.y - 200 * z)).toBe(true);
    }
    for (const id of ['n3', 'n4', 'n5']) {
      expect(near(after.get(id)!.x, before.get(id)!.x) && near(after.get(id)!.y, before.get(id)!.y)).toBe(true);
    }
    expect(store.getState().undoStack).toHaveLength(1);
    store.undo();
    expect(store.getState().files).toEqual(files);
    const undone = screen(store);
    for (const [id, b] of before) expect(near(undone.get(id)!.x, b.x) && near(undone.get(id)!.y, b.y)).toBe(true);
    store.redo();
    const redone = screen(store);
    for (const [id, a] of after) expect(near(redone.get(id)!.x, a.x) && near(redone.get(id)!.y, a.y)).toBe(true);
  });

  test('arrow-key nudges past the top-left edge keep going', () => {
    const store = storeFor({ mmd: FLOW, config: null, layout: null });
    const b = screen(store).get('n1')!;
    store.select({ nodes: ['n1'] });
    for (let i = 0; i < 6; i++) nudgeSelection(store, -10, -10);
    const a = screen(store).get('n1')!;
    const z = store.getState().viewport.zoom;
    expect(near(a.x, b.x - 60 * z) && near(a.y, b.y - 60 * z)).toBe(true);
  });

  test('a shape dragged from the palette above and left of everything lands where dropped', () => {
    const store = storeFor({ mmd: FLOW, config: null, layout: null }, { x: 600, y: 450, zoom: 0.8 });
    const before = screen(store);
    const { viewport: v } = store.getState();
    const world = { x: -300, y: -250 }; // on screen: (360, 250), clear of the palette
    expect(addBlock(store, 'step', UNASSIGNED, world)).toBe(true);
    const added = store.layout!.nodes.find((n) => !before.has(n.id))!;
    const v2 = store.getState().viewport;
    const cx = (added.x + added.width / 2) * v2.zoom + v2.x;
    const cy = (added.y + added.height / 2) * v2.zoom + v2.y;
    expect(near(cx, world.x * v.zoom + v.x) && near(cy, world.y * v.zoom + v.y), `${cx},${cy}`).toBe(true);
    const after = screen(store);
    for (const [id, b] of before) expect(near(after.get(id)!.x, b.x) && near(after.get(id)!.y, b.y)).toBe(true);
    expect(reloaded(store)).toEqual(store.layout);
  });

  test('"Re-layout all" after a drop before everything leaves no empty room', () => {
    const files: Files = { mmd: FLOW, config: null, layout: null };
    const store = storeFor(files);
    dropNodes(store, ['n1'], -300, -200);
    store.apply(clearAllPins);
    const fresh = derive(files, 't.mmd').layout!;
    const min = (l: LayoutResult) => [Math.min(...l.nodes.map((n) => n.x)), Math.min(...l.nodes.map((n) => n.y))];
    expect(min(store.layout!)).toEqual(min(fresh));
  });
});

describe('with lanes: drag any block anywhere', () => {
  for (const dir of ['LR', 'TB'] as const) {
    const mmd = LANES.replace('flowchart LR', `flowchart ${dir}`);
    const base = derive({ mmd, config: null, layout: null }, 't.mmd').layout!;
    const tb = dir === 'TB';
    // Along (x for LR) and across (y for LR) moves, as world (dx, dy).
    const xy = (along: number, across: number): [number, number] => (tb ? [across, along] : [along, across]);
    const A = (b: Box) => (tb ? b.y : b.x);
    const C = (b: Box) => (tb ? b.x : b.y);
    const SC = (b: Box) => (tb ? b.width : b.height);
    const start = (l: Box) => (tb ? l.x : l.y);
    const size = (l: Box) => (tb ? l.width : l.height);
    const first = base.lanes[0]!;
    const last = base.lanes[base.lanes.length - 1]!;
    for (const n of base.nodes) {
      const lane = base.lanes.find((l) => l.id === n.lane)!;
      const cases: [string, number, number, string][] = [
        ['forward, past the end of the lanes', ...xy((tb ? base.height : base.width) + 200 - A(n), 0), n.lane],
        ['back before the diagram start', ...xy(-A(n) - 300, 0), n.lane],
        ['back a little', ...xy(-Math.min(20, A(n)), 0), n.lane],
        // Its box starts above its lane's start edge (centre still inside). The first lane grows toward its start
        // (exact); any later lane can't (§5 Values), so the block lands on its start edge (`edge`).
        ['poking above its lane start', ...xy(60, start(lane) - SC(n) / 3 - C(n)), n.lane],
        // Above every lane: joins the first lane, with a negative across.
        ['above every lane', ...xy(80, start(first) - 150 - C(n)), first.id],
        ['far before and above everything', ...xy(-A(n) - 600, start(first) - 400 - C(n)), first.id],
        // Below the last lane: Unassigned (A4), pinned at the drop.
        ['below the last lane', ...xy(40, start(last) + size(last) + 70 - C(n)), UNASSIGNED],
      ];
      // Into every other lane, 30 px inside its start edge.
      for (const other of base.lanes) {
        if (other.id !== lane.id) cases.push([`into ${other.id}`, ...xy(160, start(other) + 30 - C(n)), other.id]);
      }
      for (const [name, dx, dy, into] of cases) {
        const onEdge = name.startsWith('poking') && lane.id !== first.id;
        test(`${dir}: ${n.id} ${name}${onEdge ? ' (a later lane: lands on its start edge)' : ''}`, () => {
          const store = storeFor({ mmd, config: null, layout: null });
          if (!onEdge) {
            dropAndCheck(store, n.id, dx, dy, { lane: into });
            return;
          }
          // Dropped poking above the edge: along the flow exactly at the drop; across, on the lane's start edge
          // (stored across 0); nothing else moves on screen.
          const z = store.getState().viewport.zoom;
          const before = screen(store);
          dropNodes(store, [n.id], dx, dy);
          const after = screen(store);
          const moved = store.layout!.nodes.find((x) => x.id === n.id)!;
          const band = store.layout!.lanes.find((l) => l.id === lane.id)!;
          expect(moved.lane).toBe(lane.id);
          expect(pinsOnDisk(store)[n.id]!.across).toBe(0);
          expect(C(moved)).toBe(start(band));
          const b = before.get(n.id)!;
          const a = after.get(n.id)!;
          expect(near(tb ? a.y : a.x, (tb ? b.y : b.x) + (tb ? dy : dx) * z)).toBe(true);
          expect(near(C(a), C(before.get(n.id)!) + (start(lane) - C(n)) * z)).toBe(true);
          for (const other of base.lanes.filter((l) => l.id !== lane.id).flatMap((l) => base.nodes.filter((x) => x.lane === l.id))) {
            if (C(other) > C(lane)) continue; // lanes after it may move with its thickness
            const ob = before.get(other.id)!;
            const oa = after.get(other.id)!;
            expect(near(oa.x, ob.x) && near(oa.y, ob.y), other.id).toBe(true);
          }
          expect(reloaded(store)).toEqual(store.layout);
        });
      }
    }
  }

  test('dropped above the first lane: every block keeps its place on screen; one undo restores the files', () => {
    const files: Files = { mmd: LANES, config: null, layout: null };
    const store = storeFor(files);
    const before = screen(store);
    const b2 = store.layout!.nodes.find((n) => n.id === 'b2')!;
    dropNodes(store, ['b2'], 300, -b2.y - 120);
    const after = screen(store);
    expect(store.layout!.nodes.find((n) => n.id === 'b2')!.lane).toBe('alpha');
    for (const id of ['a1', 'a2', 'c1']) {
      expect(near(after.get(id)!.x, before.get(id)!.x) && near(after.get(id)!.y, before.get(id)!.y), id).toBe(true);
    }
    expect(pinsOnDisk(store).b2!.across).toBeLessThan(0);
    store.undo();
    expect(store.getState().files).toEqual(files);
  });
});
