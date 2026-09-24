// The canvas's shaping previews (lineGeometry.ts) must draw exactly what the core operation plus the layout produce
// after the drop (UI36: "the preview is drawn the way the final line will be"), and number handles as the ops do.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDocument, type FlowDocument } from '../../core/document';
import { mergePolyline } from '../../core/layout';
import { dragBend, dragSegment, makeManual, reconnect, setDirection, type Files } from '../../core/ops';
import { bendDragPreview, connectorPath, dedupe, lineModel, manualPath, segmentDragPreview, type XY } from './lineGeometry';

const FIX = join(import.meta.dirname, '../../../fixtures/purchase-request');
const PR: Files = {
  mmd: readFileSync(join(FIX, 'purchase-request.mmd'), 'utf8'),
  config: readFileSync(join(FIX, 'purchase-request.flow.yaml'), 'utf8'),
  layout: readFileSync(join(FIX, 'purchase-request.layout.json'), 'utf8'),
};

const load = (f: Files) => loadDocument(f.mmd, f.config, f.layout, 'purchase-request.mmd');
const drawnOf = (doc: FlowDocument, id: string): XY[] =>
  doc.layout!.result.edges.find((e) => e.id === id)!.points.map((p): XY => [p[0], p[1]]);
const model = (doc: FlowDocument, id: string) => lineModel(doc.layout!, doc.edgeEntries[id], id)!;

function tb(): Files {
  const r = setDirection(PR, 'TB');
  if (!r.ok) throw new Error(r.error);
  return r.files;
}

describe.each([['LR', PR], ['TB', tb()]] as const)('previews match the result (%s)', (_dir, files) => {
  const doc = load(files);
  const ids = doc.layout!.result.edges.map((e) => e.id);

  it('segment handles are the merged drawn line, as `dragSegment` counts them', () => {
    for (const id of ids) {
      const m = model(doc, id);
      expect(m.segments.length).toBe(mergePolyline(m.drawn).length - 1);
    }
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
    expect(checked).toBeGreaterThan(40);
  });

  it('a bend drag previews exactly the line the op and the layout draw, on automatic and manual lines', () => {
    let checked = 0;
    for (const id of ids) {
      // Automatic first, then the same line once it is manual.
      const made = makeManual(files, doc.layout!, id);
      if (!made.ok) continue;
      for (const f of [files, made.files]) {
        const d = load(f);
        const m = model(d, id);
        m.bends.forEach((p, k) => {
          const to = { x: p[0] + 23, y: p[1] - 41 };
          const r = dragBend(f, d.layout!, id, k, to);
          if (!r.ok) return;
          expect(dedupe(drawnOf(load(r.files), id)), `${id} bend ${k}`).toEqual(dedupe(bendDragPreview(m, k, to)));
          checked++;
        });
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('bend handles are the points the ops store: after becoming manual they are drawn where they were', () => {
    for (const id of ids) {
      const before = model(doc, id);
      const made = makeManual(files, doc.layout!, id);
      if (!made.ok) continue;
      const after = model(load(made.files), id);
      expect(after.manual).toBe(before.bends.length > 0); // a straight line port to port has nothing to store
      expect(after.bends).toEqual(before.bends);
    }
  });

  it('reconnecting a manual line to another side of its block keeps its points: L11 exactly', () => {
    let checked = 0;
    for (const id of ids) {
      const made = makeManual(files, doc.layout!, id);
      if (!made.ok) continue;
      const d = load(made.files);
      const m = model(d, id);
      if (!m.manual || m.edge.source === m.edge.target) continue;
      for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        const r = reconnect(made.files, id, 'target', m.edge.target, side);
        if (!r.ok) continue;
        const target = d.layout!.result.nodes.find((n) => n.id === m.edge.target)!;
        const port = portOf(target, side);
        const src = portOf(m.source, m.edge.source_side);
        const want = manualPath(src, m.edge.source_side, m.bends, port, side, d.layout!.result.direction);
        expect(dedupe(drawnOf(load(r.files), id)), `${id} → ${side}`).toEqual(dedupe(want));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });
});

import { nodePort } from '../../core/layout';
const portOf = (n: Parameters<typeof nodePort>[0], side: Parameters<typeof nodePort>[1]) => nodePort(n, side) as XY;

describe('connector preview', () => {
  const orth = (pts: XY[]) => pts.every((p, i) => i === 0 || p[0] === pts[i - 1]![0] || p[1] === pts[i - 1]![1]);
  it('is orthogonal, leaves square to its side and arrives square to the target side', () => {
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    const out = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] } as const;
    for (const sa of sides) {
      for (const sb of [...sides, null]) {
        for (const b of [[300, 40], [-200, 10], [5, 250], [40, -180]] as XY[]) {
          const pts = connectorPath([0, 0], sa, b, sb);
          expect(orth(pts), `${sa}→${sb} ${b}`).toBe(true);
          expect(pts[0]).toEqual([0, 0]);
          expect(pts[pts.length - 1]).toEqual(b);
          const first = pts[1]!;
          expect(Math.sign(first[0]) * out[sa][0] + Math.sign(first[1]) * out[sa][1], `${sa}→${sb} ${b} leaves`).toBe(1);
          if (sb) {
            const last = pts[pts.length - 2]!;
            const dx = Math.sign(last[0] - b[0]);
            const dy = Math.sign(last[1] - b[1]);
            expect(dx * out[sb][0] + dy * out[sb][1], `${sa}→${sb} ${b} arrives`).toBe(1);
          }
        }
      }
    }
  });
});
