// v1.1 shaping by hand (§5, §6): sizes (L4), sides and ports (L12), manual lines (L11), `label_at` (L8), the frame
// with bend points, notes and the title; plus the geometry helpers the UI and ops share.
import { describe, expect, it } from 'vitest';
import type { Graph, LayoutFile, LayoutInput, LayoutResult, NoteInput, Pin, ShapeKind, Side } from '../types';
import { SHAPE_KINDS, SIDES, UNASSIGNED } from '../types';
import { labelNeeds, nodeSize, noteSize, textArea, titleSize, wrapLabel } from '../measure';
import { portPoint } from '../shapes';
import { layout, layoutDiagram, TITLE_GAP, NOTE_GAP } from './index';
import {
  endAtPort, laneAt, mergePolyline, nodePort, pointAtFraction, pointFromStored, projectOntoPolyline, storedFromPoint,
} from './geometry';
import { checkLayout, expectedPort, randomGraph, randomShaping, rng } from './testkit';

const run = (input: LayoutInput) => layoutDiagram(input);
const node = (r: LayoutResult, id: string) => r.nodes.find((n) => n.id === id)!;
const edge = (r: LayoutResult, id: string) => r.edges.find((e) => e.id === id)!;
const lane = (r: LayoutResult, id: string) => r.lanes.find((l) => l.id === id)!;

const LANES: Graph = {
  direction: 'LR',
  lanes: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }],
  nodes: [
    { id: 'a1', label: 'Fill the purchase request form', kind: 'step', lane: 'a' },
    { id: 'a2', label: 'Approved?', kind: 'decision', lane: 'a' },
    { id: 'b1', label: 'Send the quote', kind: 'io', lane: 'b' },
    { id: 'b2', label: 'Quote', kind: 'document', lane: 'b' },
    { id: 'c1', label: 'Done', kind: 'terminal', lane: 'c' },
  ],
  edges: [
    { id: 'a1->a2', source: 'a1', target: 'a2', label: null },
    { id: 'a2->b1', source: 'a2', target: 'b1', label: 'yes' },
    { id: 'a2->c1', source: 'a2', target: 'c1', label: 'no' },
    { id: 'b1->b2', source: 'b1', target: 'b2', label: null },
    { id: 'b2->c1', source: 'b2', target: 'c1', label: 'filed' },
  ],
};
const tb = (g: Graph): Graph => ({ ...g, direction: 'TB' });
const file = (f: Partial<LayoutFile>): LayoutFile => ({ version: 1, nodes: {}, ...f });

describe('a v1.0-style input gives v1.0 output plus the v1.1 edge fields', () => {
  it('no notes or title keys unless asked for; every edge reports its sides; nothing manual', () => {
    const r = layout(LANES, {}).result;
    expect('notes' in r).toBe(false);
    expect('title' in r).toBe(false);
    for (const e of r.edges) {
      expect(e.manual).toBe(false);
      expect(SIDES).toContain(e.source_side);
      expect(SIDES).toContain(e.target_side);
    }
    expect(checkLayout(LANES, {}, r, { strict: true, file: null })).toEqual([]);
  });
});

describe('L4 sizes: max(stored, need)', () => {
  for (const g of [LANES, tb(LANES)]) {
    it(`${g.direction}: a smaller stored size is kept down to what the label needs; a larger one exactly`, () => {
      const f = file({ nodes: { a1: { width: 40, height: 40 }, b1: { width: 300, height: 140 }, c1: { lane: 'c', along: 500, across: 20, width: 41, height: 200 } } });
      const r = run({ graph: g, file: f }).result;
      expect(checkLayout(g, { c1: { lane: 'c', along: 500, across: 20 } }, r, { strict: true, file: f })).toEqual([]);
      const need = labelNeeds('Fill the purchase request form', 'step', 40);
      expect([node(r, 'a1').width, node(r, 'a1').height]).toEqual([need.minWidth, labelNeeds('Fill the purchase request form', 'step', need.minWidth).height]);
      expect(node(r, 'a1').width).toBeLessThan(nodeSize('Fill the purchase request form', 'step').width);
      expect([node(r, 'b1').width, node(r, 'b1').height]).toEqual([300, 140]);
      expect(node(r, 'c1').height).toBe(200);
    });
  }
});

describe('labelNeeds (§6 L9 "needs")', () => {
  it('narrowest width: the longest word fits; never below 40; the height grows as the width shrinks', () => {
    for (const kind of SHAPE_KINDS) {
      const label = 'Match the invoice to the purchase order';
      const n = labelNeeds(label, kind, 400);
      expect(n.minWidth).toBeGreaterThanOrEqual(40);
      const narrow = labelNeeds(label, kind, n.minWidth);
      expect(narrow.height).toBeGreaterThanOrEqual(n.height);
      // One pixel narrower, the longest word no longer fits (or 40 is the floor).
      expect(labelNeeds(label, kind, 10).minWidth).toBe(n.minWidth);
    }
    expect(labelNeeds('', 'step', 10)).toEqual({ minWidth: 40, height: labelNeeds('x', 'step', 100).height });
  });
  it('an automatically sized block never needs more than its size (round ends: the need holds for every taller box)', () => {
    const r = rng(9);
    for (let k = 0; k < 200; k++) {
      const kind = SHAPE_KINDS[k % 8]!;
      const label = Array.from({ length: 1 + Math.floor(r() * 12) }, () => ['send', 'the', 'quote', 'Supercalifragilistic', 'a', 'purchase'][Math.floor(r() * 6)]).join(' ');
      const auto = nodeSize(label, kind);
      const need = labelNeeds(label, kind, auto.width);
      if (!label.includes('Supercalifragilistic')) expect(need.minWidth).toBeLessThanOrEqual(auto.width);
      // A round end's radius grows with the height (up to ROUND_MAX), narrowing the text area: an automatic height can
      // sit just below a band of taller heights that don't fit, and the need is past that band.
      if (kind !== 'terminal' && kind !== 'delay') expect(need.height).toBeLessThanOrEqual(auto.height);
      for (let h = need.height; h < need.height + 80; h += 7) {
        const a = textArea(kind, auto.width, h);
        expect(wrapLabel(label, a.width).length * 18).toBeLessThanOrEqual(a.height);
      }
    }
  });
});

describe('L12 ports: per shape, per side, both directions', () => {
  for (const dir of ['LR', 'TB'] as const) {
    for (const kind of SHAPE_KINDS) {
      it(`${dir} ${kind}: automatic lines with set sides end at the port, every side, both ends`, () => {
        // One block of this kind in the middle, four neighbours; lines leave from and arrive at each side.
        const nodes = [
          { id: 'x', label: 'The block under test', kind, lane: UNASSIGNED },
          ...['p', 'q', 'r', 's'].map((id) => ({ id, label: id.toUpperCase(), kind: 'step' as ShapeKind, lane: UNASSIGNED })),
        ];
        const g: Graph = {
          direction: dir, lanes: [{ id: UNASSIGNED, label: 'Unassigned' }], nodes,
          edges: [
            ...SIDES.map((side, k) => ({ id: `x->${'pqrs'[k]}`, source: 'x', target: 'pqrs'[k]!, label: null })),
            ...SIDES.map((side, k) => ({ id: `${'pqrs'[k]}->x`, source: 'pqrs'[k]!, target: 'x', label: null })),
          ],
        };
        const pins: Record<string, Pin> = {
          x: { lane: UNASSIGNED, along: 400, across: 300 },
          p: { lane: UNASSIGNED, along: 400, across: 20 },
          q: { lane: UNASSIGNED, along: 800, across: 300 },
          r: { lane: UNASSIGNED, along: 400, across: 600 },
          s: { lane: UNASSIGNED, along: 20, across: 300 },
        };
        const edges: LayoutFile['edges'] = {};
        SIDES.forEach((side, k) => {
          edges[`x->${'pqrs'[k]}`] = { source_side: side };
          edges[`${'pqrs'[k]}->x`] = { target_side: SIDES[(k + 1) % 4]! };
        });
        const f = file({ nodes: pins, edges });
        const res = run({ graph: g, file: f }).result;
        expect(checkLayout(g, pins, res, { file: f })).toEqual([]);
        const x = node(res, 'x');
        SIDES.forEach((side, k) => {
          const out = edge(res, `x->${'pqrs'[k]}`);
          expect(out.source_side).toBe(side);
          expect(out.points[0]).toEqual(portPoint(kind, x, side));
          const into = edge(res, `${'pqrs'[k]}->x`);
          expect(into.target_side).toBe(SIDES[(k + 1) % 4]);
          expect(into.points[into.points.length - 1]).toEqual(portPoint(kind, x, SIDES[(k + 1) % 4]!));
          expect(endAtPort(res, out.id, 'source')).toBe(true);
        });
      });
    }
  }
  it('ports sit on the drawn outline: box edge, slanted and wavy sides inside, diamonds at their vertices', () => {
    const b = { x: 100, y: 50, width: 160, height: 60 };
    expect(portPoint('step', b, 'left')).toEqual([100, 80]);
    expect(portPoint('io', b, 'left')).toEqual([107, 80]);
    expect(portPoint('io', b, 'right')).toEqual([253, 80]);
    expect(portPoint('io', b, 'top')).toEqual([180, 50]);
    expect(portPoint('document', b, 'bottom')).toEqual([180, 104]);
    expect(portPoint('database', b, 'top')).toEqual([180, 50]);
    expect(portPoint('terminal', b, 'right')).toEqual([260, 80]);
    expect(portPoint('decision', b, 'top')).toEqual([180, 50]);
    expect(portPoint('decision', b, 'left')).toEqual([100, 80]);
    for (const kind of SHAPE_KINDS) for (const side of SIDES) {
      const p = portPoint(kind, b, side);
      const q = expectedPort(kind, b, side);
      expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThanOrEqual(2);
    }
  });
  it('an unset side is chosen by the layout, and reported', () => {
    const r = layout(LANES, {}).result;
    const e = edge(r, 'a1->a2');
    expect([e.source_side, e.target_side]).toEqual(['right', 'left']);
  });
  it('a set side facing out of the diagram still routes (outside the lanes if it must)', () => {
    const g: Graph = { direction: 'LR', lanes: [{ id: UNASSIGNED, label: 'U' }], nodes: [
      { id: 'a', label: 'A', kind: 'step', lane: UNASSIGNED }, { id: 'b', label: 'B', kind: 'step', lane: UNASSIGNED },
    ], edges: [{ id: 'a->b', source: 'a', target: 'b', label: null }] };
    const pins = { a: { lane: UNASSIGNED, along: 0, across: 0 } };
    const f = file({ nodes: pins, edges: { 'a->b': { source_side: 'left' } } });
    const r = run({ graph: g, file: f }).result;
    expect(checkLayout(g, pins, r, { file: f })).toEqual([]);
    expect(edge(r, 'a->b').points[0]).toEqual([0, node(r, 'a').y + Math.floor(node(r, 'a').height / 2)]);
  });
});

describe('L11 manual lines', () => {
  it('LR: port → elbow perpendicular to the side → bend points (along the flow first) → arriving perpendicular', () => {
    const pins = { a1: { lane: 'a', along: 100, across: 30 }, c1: { lane: 'c', along: 700, across: 30 } };
    const f = file({ nodes: pins, edges: { 'a2->c1': { source_side: 'bottom', target_side: 'top', points: [
      { lane: 'b', along: 400, across: 40 }, { lane: 'b', along: 600, across: 80 },
    ] } } });
    const res = run({ graph: LANES, file: f }).result;
    expect(checkLayout(LANES, pins, res, { file: f })).toEqual([]);
    const e = edge(res, 'a2->c1');
    const a2 = node(res, 'a2');
    const c1 = node(res, 'c1');
    const by = lane(res, 'b').y;
    const s = portPoint('decision', a2, 'bottom');
    const t = portPoint('terminal', c1, 'top');
    expect(e.manual).toBe(true);
    expect(e.points).toEqual([
      s, [s[0], by + 40], [400, by + 40], // out of the bottom port: vertical first
      [600, by + 40], [600, by + 80], // along the flow first
      [t[0], by + 80], t, // into the top port: arrive vertically
    ]);
  });
  it('TB: along the flow first is vertical', () => {
    const g = tb(LANES);
    const f = file({ edges: { 'a1->a2': { source_side: 'right', target_side: 'left', points: [
      { lane: 'b', along: 100, across: 20 }, { lane: 'b', along: 300, across: 60 },
    ] } } });
    const res = run({ graph: g, file: f }).result;
    expect(checkLayout(g, {}, res, { file: f })).toEqual([]);
    const pts = edge(res, 'a1->a2').points;
    const bx = lane(res, 'b').x;
    // Between the two bend points: vertical (the flow axis) first, then across.
    const i = pts.findIndex(([x, y]) => x === bx + 20 && y === 100);
    expect(pts.slice(i, i + 3)).toEqual([[bx + 20, 100], [bx + 20, 300], [bx + 60, 300]]);
  });
  it('unset sides face the first and last bend points; bend points stay put when blocks move', () => {
    const f = file({ edges: { 'a1->a2': { points: [{ lane: 'c', along: 300, across: 50 }] } } });
    const res = run({ graph: LANES, file: f }).result;
    const e = edge(res, 'a1->a2');
    expect([e.source_side, e.target_side]).toEqual(['bottom', 'bottom']);
    const moved = run({ graph: LANES, file: { ...f, nodes: { a1: { lane: 'a', along: 60, across: 10 } } } }).result;
    const cy = lane(moved, 'c').y;
    expect(edge(moved, 'a1->a2').points).toContainEqual([300, cy + 50]);
  });
  it('a point in a lane that no longer exists: the whole set is ignored and the line is automatic', () => {
    const f = file({ edges: { 'a1->a2': { points: [{ lane: 'b', along: 300, across: 50 }, { lane: 'gone', along: 1, across: 1 }] } } });
    const res = run({ graph: LANES, file: f }).result;
    expect(edge(res, 'a1->a2').manual).toBe(false);
    expect(edge(res, 'a1->a2').points).toEqual(edge(layout(LANES, {}).result, 'a1->a2').points);
  });
  it('automatic lines still avoid every block and don\'t run along manual lines', () => {
    const f = file({ edges: { 'a1->a2': { points: [{ lane: 'b', along: 250, across: 30 }] } } });
    const res = run({ graph: LANES, file: f }).result;
    expect(checkLayout(LANES, {}, res, { file: f, strict: true })).toEqual([]);
  });
});

describe('L8 label_at', () => {
  for (const g of [LANES, tb(LANES)]) {
    it(`${g.direction}: the label's centre is at that fraction of the drawn line, automatic or manual`, () => {
      const f = file({ edges: {
        'a2->b1': { label_at: 0.5 },
        'b2->c1': { label_at: 1, points: [{ lane: 'b', along: 900, across: 70 }] },
        'a2->c1': { label_at: 0 },
        'a1->a2': { label_at: 0.3 }, // no label: kept, no effect
      } });
      const res = run({ graph: g, file: f }).result;
      expect(checkLayout(g, {}, res, { file: f })).toEqual([]);
      const e = edge(res, 'a2->b1');
      const [x, y] = pointAtFraction(e.points, 0.5);
      expect(Math.hypot(e.label_pos![0] - x, e.label_pos![1] - y)).toBeLessThanOrEqual(1);
      expect(edge(res, 'a2->c1').label_pos).toEqual(edge(res, 'a2->c1').points[0]);
      expect(edge(res, 'b2->c1').label_pos).toEqual(edge(res, 'b2->c1').points.at(-1));
      expect(edge(res, 'a1->a2').label_pos).toBeNull();
    });
  }
});

describe('the frame with bend points (§6 Frame)', () => {
  for (const g of [LANES, tb(LANES)]) {
    it(`${g.direction}: a bend point before the flow's start and before the first lane shifts everything`, () => {
      const A = (p: { x: number; y: number }) => (g.direction === 'LR' ? p.x : p.y);
      const C = (p: { x: number; y: number }) => (g.direction === 'LR' ? p.y : p.x);
      const base = run({ graph: g, file: file({ nodes: { b1: { lane: 'b', along: 500, across: 30 } } }), title: 'T', notes: [] });
      const pts = [{ lane: 'a', along: -80, across: -50 }];
      const f = file({ nodes: { b1: { lane: 'b', along: 500, across: 30 } }, edges: { 'a1->a2': { points: pts } }, hints: base.hints });
      const moved = run({ graph: g, file: f, title: 'T', notes: [] });
      expect(moved.translation).toEqual({ along: 80, across: 50 });
      expect(checkLayout(g, { b1: { lane: 'b', along: 500, across: 30 } }, moved.result, { file: f, title: 'T', notes: [] })).toEqual([]);
      // The bend point is at the frame's origin; every block moved by exactly (80, 50).
      expect(edge(moved.result, 'a1->a2').points).toContainEqual(g.direction === 'LR' ? [0, 0] : [0, 0]);
      const b0 = run({ graph: g, file: file({ nodes: { b1: { lane: 'b', along: 500, across: 30 } }, hints: base.hints }) }).result;
      for (const n of b0.nodes) {
        expect([A(node(moved.result, n.id)), C(node(moved.result, n.id))]).toEqual([A(n) + 80, C(n) + 50]);
      }
      expect(C(lane(moved.result, 'a'))).toBe(0);
      const t = moved.result.title!;
      expect([A(t), C(t)]).toEqual([A(base.result.title!) + 80, C(base.result.title!) + 50]);
      expect(pointFromStored(moved.result, moved.translation, pts[0]!)).toEqual([0, 0]);
    });
  }
  it('an ignored point set doesn\'t count', () => {
    const f = file({ edges: { 'a1->a2': { points: [{ lane: 'a', along: -80, across: -50 }, { lane: 'gone', along: 0, across: 0 }] } } });
    expect(run({ graph: LANES, file: f }).translation).toEqual({ along: 0, across: 0 });
  });
  it('a bend point deep in a lane grows that lane', () => {
    const f = file({ edges: { 'a1->a2': { points: [{ lane: 'b', along: 300, across: 700 }] } } });
    const r = run({ graph: LANES, file: f }).result;
    expect(lane(r, 'b').height).toBeGreaterThan(700);
    expect(laneAt(r, 300, lane(r, 'b').y + 700)).toBe('b');
  });
});

describe('notes and the title', () => {
  const notes: NoteInput[] = [
    { id: 'note1', text: 'Freight is the long pole', font_size: 14, bold: false },
    { id: 'note2', text: 'Two lines\nof text', font_size: 20, bold: true },
    { id: 'note3', text: 'Placed', font_size: 10, bold: false },
  ];
  it('boxes from text, font size and bold; unplaced notes in a row below the diagram; the title above', () => {
    const f = file({ notes: { note3: { x: -40, y: -60 } } });
    const r = run({ graph: LANES, file: f, notes, title: 'Purchase request' }).result;
    expect(checkLayout(LANES, {}, r, { file: f, notes, title: 'Purchase request' })).toEqual([]);
    expect(r.notes!.map((n) => n.id)).toEqual(['note1', 'note2', 'note3']);
    const [n1, n2, n3] = r.notes!;
    expect([n1!.width, n1!.height]).toEqual([noteSize(notes[0]!.text, 14, false).width, 20]);
    expect(n2!.height).toBe(2 * 28);
    expect(n2!.width).toBeGreaterThan(noteSize('Two lines', 20, false).width);
    expect([n1!.x, n1!.y]).toEqual([0, r.height + NOTE_GAP]);
    expect([n2!.x, n2!.y]).toEqual([n1!.width + NOTE_GAP, r.height + NOTE_GAP]);
    expect([n3!.x, n3!.y]).toEqual([-40, -60]);
    expect(r.title).toEqual({ text: 'Purchase request', x: 0, y: -(28 + TITLE_GAP), ...titleSize('Purchase request') });
  });
  it('a hidden title is null; a stored one is where it was put', () => {
    expect(run({ graph: LANES, file: null, title: null }).result.title).toBeNull();
    const r = run({ graph: LANES, file: file({ title: { x: 300, y: -90 } }), title: 'X' }).result;
    expect([r.title!.x, r.title!.y]).toEqual([300, -90]);
  });
});

describe('geometry helpers', () => {
  it('projectOntoPolyline: the nearest point, as a fraction rounded to 2 decimals', () => {
    const pts: [number, number][] = [[0, 0], [100, 0], [100, 100]];
    expect(projectOntoPolyline(pts, [50, -20])).toBe(0.25);
    expect(projectOntoPolyline(pts, [130, 60])).toBe(0.8);
    expect(projectOntoPolyline(pts, [-50, 0])).toBe(0);
    expect(projectOntoPolyline(pts, [100, 400])).toBe(1);
    expect(projectOntoPolyline(pts, [33.3, 1])).toBe(0.17);
    expect(projectOntoPolyline([[5, 5]], [0, 0])).toBe(0);
  });
  it('mergePolyline: drops zero-length segments and merges straight runs, keeps turns and turnbacks', () => {
    expect(mergePolyline([[0, 0], [0, 0], [10, 0], [20, 0], [20, 5], [20, 5], [20, 30], [40, 30]])).toEqual([[0, 0], [20, 0], [20, 30], [40, 30]]);
    expect(mergePolyline([[0, 0], [30, 0], [10, 0]])).toEqual([[0, 0], [30, 0], [10, 0]]);
    expect(mergePolyline([[1, 1]])).toEqual([[1, 1]]);
  });
  it('laneAt: half-open bands; before the first lane → first; after the last → last', () => {
    const r = layout(LANES, {}).result;
    const [a, b, c] = r.lanes;
    expect(laneAt(r, 10, -500)).toBe('a');
    expect(laneAt(r, 10, a!.y)).toBe('a');
    expect(laneAt(r, 10, b!.y - 1)).toBe('a');
    expect(laneAt(r, 10, b!.y)).toBe('b');
    expect(laneAt(r, 10, c!.y + c!.height)).toBe('c');
    expect(laneAt(r, 10, 99999)).toBe('c');
    expect(laneAt({ direction: 'LR', lanes: [] }, 0, 0)).toBeNull();
    const t = layout(tb(LANES), {}).result;
    expect(laneAt(t, t.lanes[1]!.x, -5)).toBe('b');
  });
  it('storedFromPoint and pointFromStored round-trip in the frame (first lane may go negative, others clamp to 0)', () => {
    const out = run({ graph: LANES, file: file({ nodes: { a1: { lane: 'a', along: -30, across: -20 } } }) });
    const r = out.result;
    const f = out.translation;
    expect(f).toEqual({ along: 30, across: 20 });
    for (const p of [{ lane: 'a', along: -30, across: -20 }, { lane: 'b', along: 400, across: 17 }, { lane: 'c', along: 0, across: 0 }]) {
      const [x, y] = pointFromStored(r, f, p)!;
      expect(storedFromPoint(r, f, x, y)).toEqual(p);
    }
    expect(storedFromPoint(r, f, 0, -10)).toEqual({ lane: 'a', along: -30, across: -30 });
    expect(nodePort(node(r, 'a1'), 'top')).toEqual(portPoint('step', node(r, 'a1'), 'top'));
  });
  it('endAtPort: an automatic end on a side midline is at its port; one spread along the side isn\'t', () => {
    const r = layout(LANES, {}).result;
    for (const e of r.edges) {
      for (const end of ['source', 'target'] as const) {
        const n = node(r, end === 'source' ? e.source : e.target);
        const p = end === 'source' ? e.points[0]! : e.points.at(-1)!;
        const q = nodePort(n, end === 'source' ? e.source_side : e.target_side);
        expect(endAtPort(r, e.id, end)).toBe(Math.hypot(p[0] - q[0], p[1] - q[1]) <= 2);
      }
    }
  });
});

// The main feedback loop for v1.1: random graphs with random sizes, sides, manual lines (random points in random lanes,
// including the first lane with a negative `across`), `label_at`, notes and the title. Every one must satisfy the
// checker (L1–L12, the frame, notes and title) and be deterministic.
describe('random graphs with shaping by hand satisfy §6 and are deterministic', () => {
  const COUNT = Number(process.env.FLOWMAP_RANDOM_V11 ?? 120);
  const r = rng(1101);
  const cases = Array.from({ length: COUNT }, (_, k) => {
    const nodes = 8 + Math.floor(r() * 110);
    return { seed: 7000 + k, nodes, dir: k % 2 ? 'TB' : 'LR', lanes: k % 5 === 0 ? 0 : undefined } as const;
  });
  it.each(cases)('seed $seed: $nodes nodes $dir', ({ seed, nodes, dir, lanes }) => {
    const g = randomGraph(seed, { nodes, direction: dir, lanes });
    const s = randomShaping(seed, g);
    const input: LayoutInput = { graph: g, file: s.file, notes: s.notes, title: s.title };
    const a = run(input);
    expect(checkLayout(g, s.pins, a.result, { file: s.file, notes: s.notes, title: s.title })).toEqual([]);
    if (seed % 3 === 0) expect(run(input).result).toEqual(a.result); // L10
    if (seed % 5 === 0) {
      // The hints stay a fixpoint with shaping too.
      const again = run({ ...input, file: { ...s.file, hints: a.hints } });
      expect(run({ ...input, file: { ...s.file, hints: again.hints } }).result).toEqual(again.result);
    }
  }, 20000);
});

describe('determinism (L10)', () => {
  it('the same input always gives the same output, byte for byte', () => {
    for (const seed of [1, 2, 3]) {
      const g = randomGraph(seed, { nodes: 60, direction: seed % 2 ? 'LR' : 'TB' });
      const s = randomShaping(seed, g, { manual: 0.3, sided: 0.5 });
      const input: LayoutInput = { graph: g, file: s.file, notes: s.notes, title: s.title };
      const a = JSON.stringify(run(input));
      expect(JSON.stringify(run(JSON.parse(JSON.stringify(input))))).toBe(a);
    }
  });
});

describe('performance (C7 with v1.1 shaping)', () => {
  it('150 nodes with 30 manual lines lay out in under 2 s', () => {
    let worst = 0;
    for (const seed of [21, 22, 23]) {
      for (const dir of ['LR', 'TB'] as const) {
        const g = randomGraph(seed, { nodes: 150, direction: dir });
        const s = randomShaping(seed, g, { manualCount: 30 });
        expect(Object.values(s.file.edges ?? {}).filter((e) => e.points).length).toBe(30);
        const input: LayoutInput = { graph: g, file: s.file, notes: s.notes, title: s.title };
        const t0 = performance.now();
        const out = run(input);
        worst = Math.max(worst, performance.now() - t0);
        expect(checkLayout(g, s.pins, out.result, { file: s.file })).toEqual([]);
      }
    }
    console.log(`v1.1 150 nodes + 30 manual lines: worst ${worst.toFixed(0)} ms`);
    expect(worst).toBeLessThan(2000);
  }, 60000);
});

// Unused-import guard for helpers exercised only through types.
void ({} as Side);
