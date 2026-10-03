// Amendment A22 on the canvas: picking a point along a side while connecting or reconnecting (`nearestPort`), and the
// shaping previews of lines whose ends sit at offsets (stored, or spread with `spread_ends`) drawing exactly what the
// operations and the layout produce.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDocument, type FlowDocument } from '../../core/document';
import { endAtPort } from '../../core/layout';
import { dragBend, dragSegment, makeManual, type Files } from '../../core/ops';
import type { LayoutResult } from '../../core/types';
import { bendDragPreview, dedupe, lineModel, nearestPort, segmentDragPreview, type XY } from './lineGeometry';

type NodeBox = LayoutResult['nodes'][number];
const box = (kind: NodeBox['kind'] = 'step'): NodeBox => ({
  id: 'n', lane: 'l', kind, label: 'N', x: 100, y: 50, width: 160, height: 60, pinned: false,
});

describe('nearestPort: where a dragged end attaches (UI38, A22)', () => {
  const snap = 12;
  const side = 6;
  const along = 8;
  it('near a side\'s midline port: on it, at 0.5 (as in v1.1)', () => {
    expect(nearestPort(box(), { x: 181, y: 52 }, snap, side, along)).toEqual({ side: 'top', at: [180, 50], on: true, frac: 0.5 });
  });
  it('along a side: on it, at the point it is level with, snapped to 0.25 / 0.75 when close', () => {
    expect(nearestPort(box(), { x: 143, y: 47 }, snap, side, along)).toEqual({ side: 'top', at: [140, 50], on: true, frac: 0.25 });
    expect(nearestPort(box(), { x: 262, y: 94 }, snap, side, along)).toEqual({ side: 'right', at: [260, 95], on: true, frac: 0.75 });
    // Between the snap points: rounded to two decimals.
    expect(nearestPort(box(), { x: 100 + 0.62 * 160, y: 112 }, snap, side, along)).toMatchObject({ side: 'bottom', on: true, frac: 0.62 });
  });
  it('with snapping off (Alt), the exact point', () => {
    expect(nearestPort(box(), { x: 143, y: 47 }, snap, side, 0)).toMatchObject({ side: 'top', on: true, frac: 0.27 });
  });
  it('near a side but not at its outline (more than the side distance in): elsewhere on the block, as in v1.1', () => {
    expect(nearestPort(box(), { x: 236, y: 101 }, snap, side, along)).toMatchObject({ on: false });
    expect(nearestPort(box(), { x: 236, y: 101 }, snap, 0, along)).toMatchObject({ on: false });
    expect(nearestPort(box(), { x: 236, y: 106 }, snap, side, along)).toMatchObject({ side: 'bottom', on: true, frac: 0.85 });
  });
  it('in the middle of the block: not on a connection point (the layout chooses the side)', () => {
    expect(nearestPort(box(), { x: 180, y: 80 }, snap, side, along)).toMatchObject({ on: false, frac: 0.5 });
  });
  it('a diamond: along its face', () => {
    const p = nearestPort(box('decision'), { x: 141, y: 65 }, snap, side, along);
    expect(p).toEqual({ side: 'top', at: [140, 65], on: true, frac: 0.25 });
  });
});

// The purchase-request fixture with every line connected at offsets along its sides, and the same with spreading on.
const FIX = join(import.meta.dirname, '../../../fixtures/purchase-request');
const PR: Files = {
  mmd: readFileSync(join(FIX, 'purchase-request.mmd'), 'utf8'),
  config: readFileSync(join(FIX, 'purchase-request.flow.yaml'), 'utf8'),
  layout: readFileSync(join(FIX, 'purchase-request.layout.json'), 'utf8'),
};
const load = (f: Files) => loadDocument(f.mmd, f.config, f.layout, 'purchase-request.mmd');

function withOffsets(spread: boolean): Files {
  const doc = load(PR);
  const js = JSON.parse(PR.layout!);
  js.edges ??= {};
  doc.layout!.result.edges.forEach((e, k) => {
    if (k % 2) return; // half of them, so spreading has some unpinned ends to spread
    js.edges[e.id] = { ...(js.edges[e.id] ?? {}), source_side: e.source_side, source_at: 0.3, target_side: e.target_side, target_at: 0.7 };
  });
  if (spread) js.spread_ends = true;
  return { ...PR, layout: JSON.stringify(js, null, 2) };
}

const drawnOf = (doc: FlowDocument, id: string): XY[] =>
  doc.layout!.result.edges.find((e) => e.id === id)!.points.map((p): XY => [p[0], p[1]]);
const model = (doc: FlowDocument, id: string) => lineModel(doc.layout!, doc.edgeEntries[id], id)!;

describe.each([['stored offsets', false], ['stored offsets and spread_ends', true]] as const)('previews match the result (%s)', (_what, spread) => {
  const files = withOffsets(spread);
  const doc = load(files);
  const ids = doc.layout!.result.edges.map((e) => e.id);

  it('the files are what the test assumes', () => {
    expect(doc.problems.errors).toEqual([]);
    expect(doc.layout!.result.edges.filter((e) => e.source_at === 0.3).length).toBeGreaterThan(3);
  });

  it('a segment drag previews exactly the line the op and the layout draw', () => {
    let checked = 0;
    for (const id of ids) {
      const m = model(doc, id);
      m.segments.forEach((s, i) => {
        for (const d of [37, -26]) {
          const delta = s.horizontal ? { dx: 5, dy: d } : { dx: d, dy: -5 };
          const preview = segmentDragPreview(m, i, delta);
          const r = dragSegment(files, doc.layout!, id, i, delta);
          if (!r.ok || !preview) continue;
          expect(dedupe(drawnOf(load(r.files), id)), `${id} segment ${i} by ${d}`).toEqual(dedupe(preview));
          checked++;
        }
      });
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('a bend drag previews exactly the line the op and the layout draw, on automatic and manual lines', () => {
    let checked = 0;
    let unmoved = 0;
    for (const id of ids) {
      const made = makeManual(files, doc.layout!, id);
      if (!made.ok) continue;
      // Becoming manual doesn't move a line whose ends are at their ports, offsets included (an automatic end spread
      // off its port the v1.1 way still becomes a bend point, UI36).
      if (endAtPort(doc.layout!.result, id, 'source') && endAtPort(doc.layout!.result, id, 'target')) {
        expect(dedupe(drawnOf(load(made.files), id)), id).toEqual(dedupe(drawnOf(doc, id)));
        unmoved++;
      }
      for (const f of [files, made.files]) {
        const d = load(f);
        const m = model(d, id);
        m.bends.forEach((p, k) => {
          const to = { x: p[0] + 23, y: p[1] - 41 };
          const r = dragBend(f, d.layout!, id, k, to);
          if (!r.ok) return;
          const after = load(r.files);
          // A drop above or left of everything moves the frame (§6, UI43: the view pans with it): not this test's subject.
          if (JSON.stringify(after.layout!.translation) !== JSON.stringify(d.layout!.translation)) return;
          expect(dedupe(drawnOf(after, id)), `${id} bend ${k}`).toEqual(dedupe(bendDragPreview(m, k, to)));
          checked++;
        });
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(unmoved).toBeGreaterThan(spread ? 6 : 3);
  });
});
