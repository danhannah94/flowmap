// UI34: the live preview (`resizeBox`) is exactly what `resizeNode` writes, and, since every resize pins the block
// (A6), exactly where the layout then draws it (L4) from every handle, allowing for the frame moving when a first-lane
// block grows above everything (§6: the UI pans by that, so nothing moves on screen).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadDocument } from '../../core/document';
import { resizeNode, type Files } from '../../core/ops';
import { canon } from '../../core/ops/testkit';
import { RESIZE_HANDLES, resizeBox, resizeFloor } from './resize';

const FIXTURE = join(import.meta.dirname, '../../../fixtures/purchase-request');
const PR: Files = {
  mmd: readFileSync(join(FIXTURE, 'purchase-request.mmd'), 'utf8'),
  config: readFileSync(join(FIXTURE, 'purchase-request.flow.yaml'), 'utf8'),
  layout: readFileSync(join(FIXTURE, 'purchase-request.layout.json'), 'utf8'),
};
const TB: Files = { ...PR, mmd: PR.mmd.replace('flowchart LR', 'flowchart TB') };
const FREE: Files = {
  mmd: canon(`flowchart LR
  a["Start here"]
  b{"A decision with a longer label?"}
  c[("Records")]
  a --> b
  b --> c
`),
  config: null,
  layout: null,
};

const doc = (f: Files) => loadDocument(f.mmd, f.config, f.layout, 'x.mmd');

// A spread of drags: grow, shrink hard (into the clamp), fractional (rounding, halves), and tiny.
const DELTAS: [number, number][] = [
  [37.5, 21.5], [-300, -300], [-12.25, 8.5], [0.5, -0.5], [140, -9], [-2.5, 60], [-0.5, 0.5],
];

describe.each([
  ['LR, lanes', PR, ['intake', 'm02', 'p05', 'f04', 'v01', 'closed', 'p07']],
  ['TB, lanes', TB, ['intake', 'm02', 'f02', 'v01', 'closed']],
  ['lane-free', FREE, ['a', 'b', 'c']],
])('%s', (_name, files, ids) => {
  const before = doc(files);
  const out = before.layout!;
  const LR = out.result.direction !== 'TB';
  for (const id of ids) {
    for (const handle of RESIZE_HANDLES) {
      test(`${id} ${handle}`, () => {
        const node = out.result.nodes.find((n) => n.id === id)!;
        const floor = resizeFloor(out.result, node.lane);
        for (const [dx, dy] of DELTAS) {
          const box = resizeBox(node, handle, dx, dy, LR, floor);
          const r = resizeNode(files, out, id, handle, { dx, dy });
          expect(r.ok, `${dx},${dy}`).toBe(true);
          if (!r.ok) return;
          expect(r.size, `size after ${dx},${dy}`).toEqual({ width: box.width, height: box.height });
          const after = doc(r.files);
          const drawn = after.layout!.result.nodes.find((n) => n.id === id)!;
          expect({ width: drawn.width, height: drawn.height }, `drawn size after ${dx},${dy}`).toEqual({ width: box.width, height: box.height });
          expect(drawn.pinned, `pinned after ${dx},${dy}`).toBe(true);
          // The frame can move (a first-lane block grown above everything): the whole diagram shifts with it.
          const t0 = out.translation;
          const t1 = after.layout!.translation;
          const shift = LR
            ? { x: t1.along - t0.along, y: t1.across - t0.across }
            : { x: t1.across - t0.across, y: t1.along - t0.along };
          expect({ x: drawn.x, y: drawn.y }, `position after ${dx},${dy}`).toEqual({ x: box.x + shift.x, y: box.y + shift.y });
          // The opposite edges stay where they were drawn (on screen, i.e. less the frame's shift).
          if (!handle.includes('e')) expect(drawn.x + drawn.width - shift.x, `right edge after ${dx},${dy}`).toBe(node.x + node.width);
          if (!handle.includes('w')) expect(drawn.x - shift.x, `left edge after ${dx},${dy}`).toBe(node.x);
          if (!handle.includes('n') && !handle.includes('s')) {
            // A width-only drag may grow the height downward to what the label needs; the top stays.
            expect(drawn.y - shift.y, `top edge after ${dx},${dy}`).toBe(node.y);
          } else if (!handle.includes('s')) {
            expect(drawn.y + drawn.height - shift.y, `bottom edge after ${dx},${dy}`).toBe(node.y + node.height);
          } else {
            expect(drawn.y - shift.y, `top edge after ${dx},${dy}`).toBe(node.y);
          }
        }
      });
    }
  }
});

test('the opposite edge stays put and the size never goes below the label’s needs', () => {
  const out = doc(PR).layout!;
  const node = out.result.nodes.find((n) => n.id === 'p05')!;
  const se = resizeBox(node, 'se', -500, -500, true, -Infinity);
  expect(se.x).toBe(node.x);
  expect(se.y).toBe(node.y);
  expect(se.width).toBeGreaterThanOrEqual(40);
  expect(se.height).toBeGreaterThanOrEqual(40);
  const nw = resizeBox(node, 'nw', 500, 500, true, -Infinity);
  expect(nw.x + nw.width).toBe(node.x + node.width);
  expect(nw.y + nw.height).toBe(node.y + node.height);
  expect(nw.width).toBe(se.width);
  expect(nw.height).toBe(se.height);
});
