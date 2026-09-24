// UI34 resize after amendment A6 (ruling R13): every resize pins the block at its top-left as drawn before the resize
// (moved by the handle for top and left handles), and the opposite edge or corner stays fixed even when narrowing from
// a top handle raises the label's height need past a later lane's start edge. Parity with a hand edit is checked the
// way §10 Part 3 does (positions read off the layout JSON, stored in the layout file's frame).
import { loadDocument } from '../document';
import { resizeNode, type Files, type ResizeHandle } from './index';
import { editJson, expectParity, ok, PR } from './testkit';
import { handPoint, layoutOf, SHAPE } from './testkit-v11';

const drawnBox = (files: Files, id: string) => {
  const n = loadDocument(files.mmd, files.config, files.layout, 'x.mmd').layout!.result.nodes.find((x) => x.id === id)!;
  return { x: n.x, y: n.y, width: n.width, height: n.height, pinned: n.pinned };
};

describe('A6: every resize pins the block', () => {
  // `b` placed automatically (its pin removed): the case that jumped on release before A6.
  const FREE_B: Files = { ...SHAPE, layout: editJson(SHAPE.layout, (js) => { delete js.nodes.b; }) };
  const out = layoutOf(FREE_B);
  const b = out.result.nodes.find((n) => n.id === 'b')!;

  test('the fixture: b is placed automatically', () => {
    expect(b.pinned).toBe(false);
  });

  const CASES: [ResizeHandle, number, number, (w: number, h: number) => { x: number; y: number }][] = [
    ['e', 25, 0, () => ({ x: b.x, y: b.y })],
    ['s', 0, 18, () => ({ x: b.x, y: b.y })],
    ['se', 25, 18, () => ({ x: b.x, y: b.y })],
    // Corners with a top or left part: that edge moves, so the pin does too.
    ['ne', 25, -6, (_w, h) => ({ x: b.x, y: b.y + b.height - h })],
    ['sw', -10, 18, (w) => ({ x: b.x + b.width - w, y: b.y })],
  ];
  for (const [handle, dx, dy, corner] of CASES) {
    test(`${handle}: writes the size and a pin at the block's top-left; the block doesn't move on release`, () => {
      const r = resizeNode(FREE_B, out, 'b', handle, { dx, dy });
      const { width, height } = ok(r).size;
      const at = corner(width, height);
      const pin = handPoint(out, at.x, at.y);
      expectParity(r, FREE_B, {
        layout: editJson(FREE_B.layout, (js) => { js.nodes.b = { ...pin, width, height }; }),
      });
      // Drawn exactly where the resize left it (L4), pinned.
      expect(drawnBox(ok(r).files, 'b')).toEqual({ ...at, width, height, pinned: true });
    });
  }

  test('a block already pinned keeps the same pin from a right or bottom handle', () => {
    const r = resizeNode(SHAPE, layoutOf(SHAPE), 'c', 'se', { dx: 10, dy: 10 });
    expectParity(r, SHAPE, { layout: editJson(SHAPE.layout, (js) => { js.nodes.c.width = 130; js.nodes.c.height = 62; }) });
  });

  test('a stale pin (another lane) is replaced by a pin in the block\'s own lane', () => {
    const stale: Files = { ...SHAPE, layout: editJson(SHAPE.layout, (js) => { js.nodes.b = { lane: 'bottom', along: 5, across: 5 }; }) };
    const sOut = layoutOf(stale);
    const sb = sOut.result.nodes.find((n) => n.id === 'b')!;
    expect(sb.pinned).toBe(false);
    const r = resizeNode(stale, sOut, 'b', 'e', { dx: 20, dy: 0 });
    const pin = handPoint(sOut, sb.x, sb.y);
    expect(pin.lane).toBe('top');
    expectParity(r, stale, {
      layout: editJson(stale.layout, (js) => { js.nodes.b = { ...pin, width: sb.width + 20, height: sb.height }; }),
    });
  });

  test('TB: a bottom handle pins at the top-left too (along is y, across is x from the lane start)', () => {
    const tb: Files = { ...FREE_B, mmd: FREE_B.mmd.replace('flowchart LR', 'flowchart TB') };
    const tOut = layoutOf(tb);
    const tbB = tOut.result.nodes.find((n) => n.id === 'b')!;
    const r = resizeNode(tb, tOut, 'b', 's', { dx: 0, dy: 12 });
    const pin = handPoint(tOut, tbB.x, tbB.y);
    expectParity(r, tb, {
      layout: editJson(tb.layout, (js) => { js.nodes.b = { ...pin, width: tbB.width, height: tbB.height + 12 }; }),
    });
  });
});

describe('the opposite edge stays when narrowing from a top handle raises the height need past the lane start', () => {
  test('nw resize of p07 (purchasing lane) keeps the bottom-right corner fixed', () => {
    const out = loadDocument(PR.mmd, PR.config, PR.layout, 'x.mmd').layout!;
    const before = out.result.nodes.find((n) => n.id === 'p07')!; // x 2524, y 238, 120 × 52; purchasing starts at y 212
    const r = resizeNode(PR, out, 'p07', 'nw', { dx: 140, dy: -9 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = loadDocument(r.files.mmd, r.files.config, r.files.layout, 'x.mmd').layout!.result.nodes.find((n) => n.id === 'p07')!;
    expect(after.x + after.width).toBe(before.x + before.width);
    expect(after.y + after.height).toBe(before.y + before.height);
    // The width stopped narrowing where the need still fits between the lane's start edge and the bottom edge.
    const lane = out.result.lanes.find((l) => l.id === before.lane)!;
    expect(after.y).toBeGreaterThanOrEqual(lane.y);
    expect(after.width).toBeLessThanOrEqual(before.width);
  });

  test('every top handle, hard narrowing, in every later lane of the fixture: the bottom edge stays', () => {
    const out = loadDocument(PR.mmd, PR.config, PR.layout, 'x.mmd').layout!;
    const first = out.result.lanes[0]!.id;
    for (const n of out.result.nodes.filter((x) => x.lane !== first && x.lane !== '_unassigned')) {
      for (const [handle, dx] of [['nw', 400], ['ne', -400], ['n', 0]] as const) {
        const r = ok(resizeNode(PR, out, n.id, handle, { dx, dy: -400 }));
        const after = loadDocument(r.files.mmd, r.files.config, r.files.layout, 'x.mmd').layout!.result.nodes.find((x) => x.id === n.id)!;
        expect(after.y + after.height, `${n.id} ${handle}`).toBe(n.y + n.height);
        if (handle === 'nw') expect(after.x + after.width, `${n.id} ${handle}`).toBe(n.x + n.width);
        if (handle === 'ne') expect(after.x, `${n.id} ${handle}`).toBe(n.x);
      }
    }
  });
});
