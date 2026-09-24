// The UI's frame (§6 Frame) must be the layout's own: T and U count bend points as well as pins. A manual line whose
// bend point is stored before the flow's start (a negative `along`) or above the first lane (a negative `across`)
// moves the whole output, and every screen <-> stored conversion (drops, nudges, new notes, the pan when the frame
// changes) has to use that same frame, or the block a person drops lands somewhere else.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { loadDocument } from '../../core/document';
import { parseLayoutFile } from '../../core/layoutfile';
import { canon } from '../../core/ops/testkit';
import type { Files } from '../../core/ops';
import { UNASSIGNED } from '../../core/types';
import { dropNodes, nudgeSelection } from '../actions';
import { derive, originMove, translationOf } from './derive';
import { Store } from './store';

const MMD = canon(`flowchart LR
  a["Alpha"]
  b["Beta"]
  c["Gamma"]
  a --> b
  b --> c
`);

/**
 * Every block pinned (so only the frame can move them): `a` at (100, 40), `b` at (400, 200), `c` at (700, 40); the line
 * a->b bent through a point stored at along -80, across -30 (before and above everything).
 */
const BENT: Files = {
  mmd: MMD,
  config: null,
  layout: JSON.stringify({
    version: 1,
    nodes: {
      a: { lane: UNASSIGNED, along: 100, across: 40 },
      b: { lane: UNASSIGNED, along: 400, across: 200 },
      c: { lane: UNASSIGNED, along: 700, across: 40 },
    },
    edges: { 'a->b': { points: [{ lane: UNASSIGNED, along: -80, across: -30 }] } },
  }),
};

function storeFor(files: Files, viewport = { x: 200, y: 150, zoom: 0.75 }): Store {
  const store = new Store();
  const d = derive(files, 't.mmd');
  store.set({ status: 'ready', file: 't.mmd', files, derived: d, shown: d, viewport, viewportSize: { width: 1400, height: 900 } });
  return store;
}

type Box = { x: number; y: number };
function onScreen(store: Store): Map<string, Box> {
  const { viewport: v } = store.getState();
  return new Map(store.layout!.nodes.map((n) => [n.id, { x: n.x * v.zoom + v.x, y: n.y * v.zoom + v.y }]));
}
const pinsOnDisk = (store: Store) => parseLayoutFile(store.getState().files!.layout).file!.nodes;
const close = (a: number, b: number) => Math.abs(a - b) <= 1;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the frame counts bend points (§6 Frame)', () => {
  test('translationOf is the layout function\'s own translation, bend points included', () => {
    const d = derive(BENT, 't.mmd');
    expect(d.doc.layout!.translation).toEqual({ along: 80, across: 30 });
    expect(translationOf(d)).toEqual({ along: 80, across: 30 });
    // Pins alone would say "no frame" (a is at 100, 40): the bug this guards against.
    const pinsOnly = JSON.parse(BENT.layout!) as { edges?: unknown };
    delete pinsOnly.edges;
    const noBend = derive({ ...BENT, layout: JSON.stringify(pinsOnly) }, 't.mmd');
    expect(translationOf(noBend)).toEqual({ along: 0, across: 0 });
    // The frame moved the output by exactly (T, U): a is drawn at its pin plus the frame.
    const a = d.layout!.nodes.find((n) => n.id === 'a')!;
    expect([a.x, a.y]).toEqual([100 + 80, 40 + 30]);
  });

  test('no layout (an .mmd with errors) means no frame', () => {
    expect(translationOf(derive({ mmd: 'nonsense', config: null, layout: null }, 't.mmd'))).toEqual({ along: 0, across: 0 });
    expect(translationOf(null)).toEqual({ along: 0, across: 0 });
  });

  test('originMove pans by the change of a frame set by a bend point', () => {
    const pinsOnly = JSON.parse(BENT.layout!) as { edges?: unknown };
    delete pinsOnly.edges;
    const before = derive({ ...BENT, layout: JSON.stringify(pinsOnly) }, 't.mmd');
    const after = derive(BENT, 't.mmd');
    expect(originMove(before, after)).toEqual({ x: 80, y: 30 });
    expect(originMove(after, before)).toEqual({ x: -80, y: -30 });
  });

  test('a drop stores exactly the dropped position, and nothing else moves on screen', () => {
    const store = storeFor(BENT);
    const before = onScreen(store);
    dropNodes(store, ['a'], 50, 20);
    expect(pinsOnDisk(store).a).toEqual({ lane: UNASSIGNED, along: 150, across: 60 });
    const after = onScreen(store);
    const z = store.getState().viewport.zoom;
    expect(close(after.get('a')!.x, before.get('a')!.x + 50 * z) && close(after.get('a')!.y, before.get('a')!.y + 20 * z)).toBe(true);
    for (const id of ['b', 'c']) {
      expect(close(after.get(id)!.x, before.get(id)!.x) && close(after.get(id)!.y, before.get(id)!.y), `${id} moved`).toBe(true);
    }
  });

  test('a nudge moves by exactly 10 px, stored relative to the bend point\'s frame', () => {
    const store = storeFor(BENT);
    store.select({ nodes: ['a'] });
    const before = onScreen(store).get('a')!;
    nudgeSelection(store, 10, 0);
    expect(pinsOnDisk(store).a).toEqual({ lane: UNASSIGNED, along: 110, across: 40 });
    const after = onScreen(store).get('a')!;
    const z = store.getState().viewport.zoom;
    expect(close(after.x, before.x + 10 * z) && close(after.y, before.y)).toBe(true);
  });

  test('a drop further out than the bend point grows the frame; the view pans by the change only', () => {
    const store = storeFor(BENT);
    const before = onScreen(store);
    const a = store.layout!.nodes.find((n) => n.id === 'a')!;
    // Drop a 300 px left of where it is: world x 180 - 300 = -120, i.e. stored along -200 (T grows from 80 to 200).
    dropNodes(store, ['a'], -300, 0);
    expect(pinsOnDisk(store).a).toEqual({ lane: UNASSIGNED, along: a.x - 300 - 80, across: 40 });
    expect(translationOf(store.getState().derived).along).toBe(200);
    const after = onScreen(store);
    const z = store.getState().viewport.zoom;
    expect(close(after.get('a')!.x, before.get('a')!.x - 300 * z)).toBe(true);
    for (const id of ['b', 'c']) {
      expect(close(after.get(id)!.x, before.get(id)!.x) && close(after.get(id)!.y, before.get(id)!.y), `${id} moved`).toBe(true);
    }
    // And a reload lays out the same as the screen shows.
    const f = store.getState().files!;
    expect(loadDocument(f.mmd, f.config, f.layout, 't.mmd').layout!.result).toEqual(store.layout);
  });
});
