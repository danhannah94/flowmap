// The SVG export's v1.1 additions (§7.1), drawn from a real layout: notes, a hidden or moved title, resized blocks,
// manual lines, labels at `label_at`, and a fill on every label <text>.
import { describe, expect, it } from 'vitest';
import type { Graph, LayoutFile, NoteInput } from '../types';
import { UNASSIGNED } from '../types';
import { layoutDiagram } from '../layout';
import { renderSvg } from './index';
import { findAll, findOne, parseXml, textContent, type XmlNode } from './xmlParser';

const graph: Graph = {
  direction: 'LR',
  lanes: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }],
  nodes: [
    { id: 'n1', label: 'Receive request', kind: 'step', lane: 'a' },
    { id: 'n2', label: 'Complete?', kind: 'decision', lane: 'a' },
    { id: 'n3', label: 'Enter form', kind: 'io', lane: 'b' },
  ],
  edges: [
    { id: 'n1->n2', source: 'n1', target: 'n2', label: null },
    { id: 'n2->n3', source: 'n2', target: 'n3', label: 'yes' },
  ],
};
const notes: NoteInput[] = [
  { id: 'note1', text: 'Freight is the long pole', font_size: 14, bold: false },
  { id: 'note2', text: 'Two lines\n\nwith a gap', font_size: 22, bold: true, color: { light: '#B85450', dark: '#f08080' } },
];
const file: LayoutFile = {
  version: 1,
  nodes: { n1: { width: 260, height: 90 }, n3: { lane: 'b', along: -40, across: 20 } },
  edges: {
    'n2->n3': { source_side: 'bottom', target_side: 'right', points: [{ lane: 'b', along: 600, across: 70 }], label_at: 0.5 },
  },
  notes: { note2: { x: -120, y: -90 } },
};

function render(title: string | null, theme: 'light' | 'dark' = 'light') {
  const out = layoutDiagram({ graph, file, notes, title });
  const svg = renderSvg({ title: title ?? 'unused', notes, graph, layout: out.result, styles: {}, legend: [], theme });
  return { svg, root: parseXml(svg), layout: out.result };
}

const byAttr = (root: XmlNode, attr: string, value: string) => findOne(root, (n) => n.attrs[attr] === value)!;

describe('SVG v1.1', () => {
  it('each note is a <g data-note-id> with one <text> per line: font-size, fill, bold only when bold', () => {
    const { root } = render('Purchase request');
    const n1 = byAttr(root, 'data-note-id', 'note1');
    const t1 = findAll(n1, (n) => n.tag === 'text');
    expect(t1.map(textContent)).toEqual(['Freight is the long pole']);
    expect(t1[0]!.attrs['font-size']).toBe('14');
    expect(t1[0]!.attrs.fill).toMatch(/^#[0-9a-f]{6}$/);
    expect(t1[0]!.attrs['font-weight']).toBeUndefined();
    const t2 = findAll(byAttr(root, 'data-note-id', 'note2'), (n) => n.tag === 'text');
    expect(t2.map(textContent)).toEqual(['Two lines', '', 'with a gap']);
    for (const t of t2) {
      expect(t.attrs['font-size']).toBe('22');
      expect(t.attrs['font-weight']).toBe('bold');
      expect(t.attrs.fill).toBe('#b85450');
    }
    expect(findAll(byAttr(render('x', 'dark').root, 'data-note-id', 'note2'), (n) => n.tag === 'text')[0]!.attrs.fill).toBe('#f08080');
  });

  it('a hidden title is left out; a shown one is drawn at its box', () => {
    expect(findOne(render(null).root, (n) => n.attrs['data-role'] === 'title')).toBeUndefined();
    const { root, layout } = render('Purchase request');
    const t = byAttr(root, 'data-role', 'title');
    expect(textContent(t)).toBe('Purchase request');
    expect(Number(t.attrs.x)).toBe(layout.title!.x);
  });

  it('draws what the layout produced: resized blocks, the manual line and its label at label_at', () => {
    const { root, layout } = render('T');
    const n1 = byAttr(root, 'data-node-id', 'n1');
    const rect = n1.children.find((c) => c.tag === 'rect')!;
    expect([Number(rect.attrs.width), Number(rect.attrs.height)]).toEqual([260, 90]);
    const e = layout.edges.find((x) => x.id === 'n2->n3')!;
    expect(e.manual).toBe(true);
    const line = findOne(byAttr(root, 'data-edge-id', 'n2->n3'), (n) => n.tag === 'polyline')!;
    expect(line.attrs.points).toBe(e.points.map((p) => p.join(',')).join(' '));
    const label = findAll(byAttr(root, 'data-edge-id', 'n2->n3'), (n) => n.tag === 'text')[0]!;
    expect(Number(label.attrs.x)).toBe(e.label_pos![0]);
  });

  it('every label <text> carries a #rrggbb fill', () => {
    for (const theme of ['light', 'dark'] as const) {
      const { root } = render('T', theme);
      const texts = findAll(root, (n) => n.tag === 'text');
      expect(texts.length).toBeGreaterThan(5);
      for (const t of texts) expect(t.attrs.fill).toMatch(/^#[0-9a-f]{6}$/);
    }
    // Lane-free diagrams keep a hidden lane label: it has a fill too.
    const free: Graph = { ...graph, lanes: [{ id: UNASSIGNED, label: 'Unassigned' }], nodes: graph.nodes.map((n) => ({ ...n, lane: UNASSIGNED })) };
    const out = layoutDiagram({ graph: free, file: null, title: 'T', notes: [] });
    const svg = parseXml(renderSvg({ title: 'T', graph: free, layout: out.result, styles: {}, legend: [], theme: 'light' }));
    for (const t of findAll(svg, (n) => n.tag === 'text')) expect(t.attrs.fill).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('everything placed at negative coordinates is inside the picture', () => {
    const { root, layout } = render('T');
    const g = root.children.find((c) => c.tag === 'g' && c.attrs.transform)!;
    const [ox, oy] = /translate\(([-\d.]+), ([-\d.]+)\)/.exec(g.attrs.transform!)!.slice(1).map(Number);
    const note2 = layout.notes!.find((n) => n.id === 'note2')!;
    expect(note2.x + ox!).toBeGreaterThanOrEqual(0);
    expect(note2.y + oy!).toBeGreaterThanOrEqual(0);
    expect(layout.title!.y + oy!).toBeGreaterThanOrEqual(0);
    expect(Number(root.attrs.width)).toBeGreaterThanOrEqual(layout.width + ox!);
  });

  it('a v1.0-style layout (no title key) still draws the title, above the top-left corner', () => {
    const out = layoutDiagram({ graph, file: null });
    const root = parseXml(renderSvg({ title: 'Old style', graph, layout: out.result, styles: {}, legend: [], theme: 'light' }));
    expect(textContent(byAttr(root, 'data-role', 'title'))).toBe('Old style');
    expect(findAll(root, (n) => n.attrs['data-note-id'] !== undefined)).toEqual([]);
  });
});
