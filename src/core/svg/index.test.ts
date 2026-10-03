import { describe, expect, it, vi } from 'vitest';
import type { Graph, LayoutResult, LegendItem, ResolvedStyle, ShapeKind } from '../types';

// measure.ts (label wrapping / text areas) is another engineer's work in progress and currently
// throws "not implemented yet". renderSvg calls the real module in production; here we swap in a
// small deterministic stand-in so these tests don't depend on that module's completion or exact
// wrapping behaviour (only this module's own contract — see the task brief).
function stubTextWidth(text: string): number {
  return text.length * 7;
}
function stubWrapLabel(label: string, maxWidth: number): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && stubTextWidth(candidate) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}
function stubTextArea(_kind: ShapeKind, width: number, height: number) {
  const padding = 10;
  return { x: padding, y: padding, width: Math.max(width - padding * 2, 1), height: Math.max(height - padding * 2, 1) };
}
function stubNodeSize(label: string, _kind: ShapeKind) {
  return { width: Math.max(120, stubTextWidth(label) + 40), height: 60 };
}

vi.mock('../measure', () => ({
  LABEL_FONT: { family: 'Inter', size: 13, lineHeight: 18, weight: 400 },
  // shapes.ts imports this too, to stay in lockstep with textArea()'s geometry model.
  SHAPE_GEOMETRY: { subprocessBar: 10, databaseRy: 8, ioSkew: 14, documentWave: 6, roundMax: 28 },
  roundRadius: (height: number) => Math.min(height / 2, 28),
  textWidth: stubTextWidth,
  wrapLabel: stubWrapLabel,
  textArea: stubTextArea,
  nodeSize: stubNodeSize,
  BADGE_FONT: { size: 10, weight: 600, height: 16, padX: 6 },
  TITLE_FONT: { size: 20, lineHeight: 28, weight: 700 },
  titleSize: (text: string) => ({ width: stubTextWidth(text) * 2, height: 28 }),
  noteLines: (text: string) => text.split('\n'),
  noteLineHeight: (size: number) => Math.round(size * 1.4),
  badgeBox: (_kind: ShapeKind, width: number, _height: number, text: string) => {
    const w = stubTextWidth(text) + 12;
    return { x: width - 10 - w, y: -10, width: w, height: 16 };
  },
}));

const { renderSvg } = await import('./index');
const { parseXml, findAll, findOne, textContent } = await import('./xmlParser');

// --- a hand-built fixture covering all eight shapes, several style combinations, labelled and
// unlabelled edges, a legend, and a title with `&` and `"` in it -----------------------------------

const TITLE = 'Approvals & "Review"';

const graph: Graph = {
  direction: 'LR',
  lanes: [
    { id: 'intake', label: 'Intake' },
    { id: 'process', label: 'Process & Review' },
  ],
  nodes: [
    { id: 'n1', label: 'Receive request', kind: 'step', lane: 'intake' },
    { id: 'n2', label: 'Complete?', kind: 'decision', lane: 'intake' },
    { id: 'n3', label: 'Start', kind: 'terminal', lane: 'intake' },
    { id: 'n4', label: 'Run sub-process', kind: 'subprocess', lane: 'intake' },
    { id: 'n5', label: 'ERP', kind: 'database', lane: 'process' },
    { id: 'n6', label: 'Enter form', kind: 'io', lane: 'process' },
    { id: 'n7', label: 'Match receipt to purchase order', kind: 'document', lane: 'process' },
    { id: 'n8', label: 'Wait for freight quote', kind: 'delay', lane: 'process' },
  ],
  edges: [
    { id: 'n1->n2', source: 'n1', target: 'n2', label: 'Yes' },
    { id: 'n2->n3', source: 'n2', target: 'n3', label: null },
    { id: 'n3->n4', source: 'n3', target: 'n4', label: 'Escalate & notify "boss"' },
    { id: 'n4->n5', source: 'n4', target: 'n5', label: null },
    { id: 'n5->n6', source: 'n5', target: 'n6', label: 'Sync' },
    { id: 'n6->n7', source: 'n6', target: 'n7', label: null },
    { id: 'n7->n8', source: 'n7', target: 'n8', label: 'Send' },
  ],
};

const layout: LayoutResult = {
  direction: 'LR',
  width: 900,
  height: 400,
  lanes: [
    { id: 'intake', label: 'Intake', x: 0, y: 0, width: 900, height: 200 },
    { id: 'process', label: 'Process & Review', x: 0, y: 200, width: 900, height: 200 },
  ],
  nodes: [
    { id: 'n1', lane: 'intake', kind: 'step', label: 'Receive request', x: 40, y: 40, width: 140, height: 60, pinned: false },
    { id: 'n2', lane: 'intake', kind: 'decision', label: 'Complete?', x: 220, y: 30, width: 140, height: 80, pinned: false },
    { id: 'n3', lane: 'intake', kind: 'terminal', label: 'Start', x: 420, y: 40, width: 140, height: 60, pinned: false },
    { id: 'n4', lane: 'intake', kind: 'subprocess', label: 'Run sub-process', x: 620, y: 40, width: 160, height: 60, pinned: false },
    { id: 'n5', lane: 'process', kind: 'database', label: 'ERP', x: 40, y: 240, width: 140, height: 70, pinned: false },
    { id: 'n6', lane: 'process', kind: 'io', label: 'Enter form', x: 220, y: 240, width: 150, height: 60, pinned: false },
    { id: 'n7', lane: 'process', kind: 'document', label: 'Match receipt to purchase order', x: 420, y: 240, width: 150, height: 70, pinned: false },
    { id: 'n8', lane: 'process', kind: 'delay', label: 'Wait for freight quote', x: 620, y: 240, width: 150, height: 60, pinned: false },
  ],
  edges: [
    { id: 'n1->n2', source: 'n1', target: 'n2', label: 'Yes', points: [[180, 70], [220, 70]], label_pos: [200, 60], manual: false, source_side: 'right', target_side: 'left' },
    { id: 'n2->n3', source: 'n2', target: 'n3', label: null, points: [[360, 90], [420, 90]], label_pos: null, manual: false, source_side: 'right', target_side: 'left' },
    { id: 'n3->n4', source: 'n3', target: 'n4', label: 'Escalate & notify "boss"', points: [[560, 70], [620, 70]], label_pos: [590, 50], manual: false, source_side: 'right', target_side: 'left' },
    { id: 'n4->n5', source: 'n4', target: 'n5', label: null, points: [[700, 100], [700, 240]], label_pos: null, manual: false, source_side: 'right', target_side: 'left' },
    { id: 'n5->n6', source: 'n5', target: 'n6', label: 'Sync', points: [[180, 275], [220, 275]], label_pos: [200, 260], manual: false, source_side: 'right', target_side: 'left' },
    { id: 'n6->n7', source: 'n6', target: 'n7', label: null, points: [[370, 270], [420, 270]], label_pos: null, manual: false, source_side: 'right', target_side: 'left' },
    { id: 'n7->n8', source: 'n7', target: 'n8', label: 'Send', points: [[570, 275], [620, 275]], label_pos: [600, 260], manual: false, source_side: 'right', target_side: 'left' },
  ],
};

const styles: Record<string, ResolvedStyle> = {
  n1: { border_style: 'dashed', border_width: 2 },
  n2: { border_style: 'dotted', font_style: 'italic' },
  n3: { font_style: 'bold' },
  n4: { badge: 'wait', fill: { light: '#fff2cc', dark: '#4a3f12' } },
  n5: { border_color: { light: '#b85450', dark: '#f08080' }, border_width: 4 },
  n6: { text_color: '#3730a3' },
  // n7: deliberately no style -> should use theme defaults.
  n8: { border_style: 'dashed', font_style: 'bold', badge: 'wait', fill: { light: '#dae8fc', dark: '#1e3a5f' }, border_color: '#f96' },
};

const legend: LegendItem[] = [
  { text: 'Confirmed by two or more people', style: { border_style: 'solid', border_width: 2 } },
  { text: 'One source only', style: { border_style: 'dashed' } },
  { text: 'Inferred, nobody said it directly', style: { border_style: 'dotted', font_style: 'italic' } },
  { text: 'Waiting on someone', style: { fill: { light: '#fff2cc', dark: '#4a3f12' }, badge: 'wait' } },
];

function renderFixture(theme: 'light' | 'dark') {
  const svg = renderSvg({ title: TITLE, graph, layout, styles, legend, theme });
  return { svg, root: parseXml(svg) };
}

// --- structural contract (design.md §7.1) -----------------------------------------------------

describe('renderSvg: §7.1 structure', () => {
  it('produces well-formed, parseable XML rooted at <svg>', () => {
    const { root } = renderFixture('light');
    expect(root.tag).toBe('svg');
    expect(root.attrs.xmlns).toBe('http://www.w3.org/2000/svg');
  });

  it('title is a <text data-role="title"> with the exact (unescaped-on-read) title text', () => {
    const { root } = renderFixture('light');
    const title = findOne(root, (n) => n.tag === 'text' && n.attrs['data-role'] === 'title');
    expect(title).toBeDefined();
    expect(textContent(title!)).toBe(TITLE);
  });

  it('each lane is a <g data-lane-id> containing a <text> with the lane label', () => {
    const { root } = renderFixture('light');
    for (const lane of graph.lanes) {
      const g = findOne(root, (n) => n.tag === 'g' && n.attrs['data-lane-id'] === lane.id);
      expect(g).toBeDefined();
      const text = findOne(g!, (n) => n.tag === 'text');
      expect(text).toBeDefined();
      expect(textContent(text!)).toBe(lane.label);
    }
  });

  it('each node is a <g data-node-id data-kind> whose first shape child carries fill/stroke/width/dash', () => {
    const { root } = renderFixture('light');
    for (const node of layout.nodes) {
      const g = findOne(root, (n) => n.tag === 'g' && n.attrs['data-node-id'] === node.id);
      expect(g).toBeDefined();
      expect(g!.attrs['data-kind']).toBe(node.kind);

      const shapeChild = g!.children.find((c) => c.tag === 'rect' || c.tag === 'polygon' || c.tag === 'path');
      expect(shapeChild, `node ${node.id} has a shape child`).toBeDefined();
      expect(shapeChild!.attrs.fill).toMatch(/^#[0-9a-f]{6}$/);
      expect(shapeChild!.attrs.stroke).toMatch(/^#[0-9a-f]{6}$/);
      expect(shapeChild!.attrs['stroke-width']).toBeDefined();
    }
  });

  it('a solid border has no stroke-dasharray; dashed is "6 4"; dotted is "2 3"', () => {
    const { root } = renderFixture('light');
    const firstShapeOf = (id: string) => {
      const g = findOne(root, (n) => n.tag === 'g' && n.attrs['data-node-id'] === id)!;
      return g.children.find((c) => c.tag === 'rect' || c.tag === 'polygon' || c.tag === 'path')!;
    };
    expect(firstShapeOf('n1').attrs['stroke-dasharray']).toBe('6 4'); // n1: dashed
    expect(firstShapeOf('n2').attrs['stroke-dasharray']).toBe('2 3'); // n2: dotted
    expect(firstShapeOf('n7').attrs['stroke-dasharray']).toBeUndefined(); // n7: unstyled -> solid
  });

  it('#rgb colours are normalised to lowercase #rrggbb (n8 border_color: "#f96")', () => {
    const { root } = renderFixture('light');
    const g = findOne(root, (n) => n.tag === 'g' && n.attrs['data-node-id'] === 'n8')!;
    const shape = g.children.find((c) => c.tag === 'rect' || c.tag === 'polygon' || c.tag === 'path')!;
    expect(shape.attrs.stroke).toBe('#ff9966');
  });

  it('italic and bold font_style carry through to the label text element', () => {
    const { root } = renderFixture('light');
    const labelsOf = (id: string) => findAll(findOne(root, (n) => n.tag === 'g' && n.attrs['data-node-id'] === id)!, (n) => n.attrs['data-role'] === 'label');
    expect(labelsOf('n2').every((t) => t.attrs['font-style'] === 'italic')).toBe(true); // n2: italic
    expect(labelsOf('n3').every((t) => t.attrs['font-weight'] === 'bold')).toBe(true); // n3: bold
    expect(labelsOf('n7').every((t) => t.attrs['font-style'] === undefined && t.attrs['font-weight'] === undefined)).toBe(true); // n7: normal
  });

  it('a badge is a <text data-role="badge">', () => {
    const { root } = renderFixture('light');
    const g4 = findOne(root, (n) => n.tag === 'g' && n.attrs['data-node-id'] === 'n4')!;
    const badge = findOne(g4, (n) => n.attrs['data-role'] === 'badge');
    expect(badge).toBeDefined();
    expect(textContent(badge!)).toBe('wait');

    const g7 = findOne(root, (n) => n.tag === 'g' && n.attrs['data-node-id'] === 'n7')!;
    expect(findOne(g7, (n) => n.attrs['data-role'] === 'badge')).toBeUndefined();
  });

  it("the node's full, unwrapped label is in a <title> child of its <g>, even when the on-screen label wraps", () => {
    const { root } = renderFixture('light');
    for (const node of layout.nodes) {
      const g = findOne(root, (n) => n.tag === 'g' && n.attrs['data-node-id'] === node.id)!;
      const title = findOne(g, (n) => n.tag === 'title');
      expect(title).toBeDefined();
      expect(textContent(title!)).toBe(node.label);

      // The visible label (however many lines it wrapped into) reproduces the same words.
      const labelWords = findAll(g, (n) => n.attrs['data-role'] === 'label')
        .map((t) => textContent(t))
        .join(' ')
        .split(/\s+/)
        .filter(Boolean);
      expect(labelWords).toEqual(node.label.split(/\s+/).filter(Boolean));
    }
  });

  it('each edge is a <g data-edge-id> with a path/polyline, and a <title> only when it has a label', () => {
    const { root } = renderFixture('light');
    for (const edge of layout.edges) {
      const g = findOne(root, (n) => n.tag === 'g' && n.attrs['data-edge-id'] === edge.id);
      expect(g).toBeDefined();
      const line = g!.children.find((c) => c.tag === 'path' || c.tag === 'polyline');
      expect(line, `edge ${edge.id} has a path or polyline`).toBeDefined();

      const title = findOne(g!, (n) => n.tag === 'title');
      if (edge.label) {
        expect(title).toBeDefined();
        expect(textContent(title!)).toBe(edge.label);
      } else {
        expect(title).toBeUndefined();
      }
    }
  });

  it('an edge label with `&` and `"` round-trips exactly through the title and the visible label', () => {
    const { root } = renderFixture('light');
    const g = findOne(root, (n) => n.tag === 'g' && n.attrs['data-edge-id'] === 'n3->n4')!;
    const title = findOne(g, (n) => n.tag === 'title')!;
    expect(textContent(title)).toBe('Escalate & notify "boss"');
    const visibleLabel = findOne(g, (n) => n.tag === 'text')!;
    expect(textContent(visibleLabel)).toBe('Escalate & notify "boss"');
  });

  it('the legend is a <g data-testid="legend"> with one <g data-testid="legend-item"> per rule, in order, each with a styled swatch', () => {
    const { root } = renderFixture('light');
    const legendGroup = findOne(root, (n) => n.tag === 'g' && n.attrs['data-testid'] === 'legend');
    expect(legendGroup).toBeDefined();
    const items = findAll(legendGroup!, (n) => n.attrs['data-testid'] === 'legend-item');
    expect(items).toHaveLength(legend.length);
    items.forEach((item, i) => {
      expect(textContent(item)).toContain(legend[i]!.text);
      const swatch = item.children.find((c) => c.tag === 'rect' || c.tag === 'polygon' || c.tag === 'path');
      expect(swatch).toBeDefined();
      expect(swatch!.attrs.fill).toMatch(/^#[0-9a-f]{6}$/);
      expect(swatch!.attrs.stroke).toMatch(/^#[0-9a-f]{6}$/);
    });
    // Dash patterns propagate to the swatch too (2nd rule is dashed, 3rd is dotted).
    const swatchOf = (i: number) => items[i]!.children.find((c) => c.tag === 'rect' || c.tag === 'polygon' || c.tag === 'path')!;
    expect(swatchOf(1).attrs['stroke-dasharray']).toBe('6 4');
    expect(swatchOf(2).attrs['stroke-dasharray']).toBe('2 3');
  });
});

// --- C6: the export contains every label somewhere, and legend text ---------------------------

describe('renderSvg: C6 completeness', () => {
  it('contains the title, every lane label, every node label and edge label, and every legend text', () => {
    const { svg } = renderFixture('light');
    expect(svg).toContain('Approvals'); // title (escaped inline, checked exactly above)
    for (const lane of graph.lanes) expect(svg).toContain(escapeForSubstringCheck(lane.label));
    for (const node of graph.nodes) {
      // Labels may wrap across several <text> elements, but the title always carries the full text.
      expect(svg).toContain(`<title>${escapeForSubstringCheck(node.label)}</title>`);
    }
    for (const edge of graph.edges) {
      if (edge.label) expect(svg).toContain(`<title>${escapeForSubstringCheck(edge.label)}</title>`);
    }
    for (const item of legend) expect(svg).toContain(escapeForSubstringCheck(item.text));
  });
});

function escapeForSubstringCheck(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- both themes -------------------------------------------------------------------------------

describe('renderSvg: themes', () => {
  it('sets data-theme and produces different, both-valid colours for light and dark', () => {
    const light = renderFixture('light');
    const dark = renderFixture('dark');
    expect(light.root.attrs['data-theme']).toBe('light');
    expect(dark.root.attrs['data-theme']).toBe('dark');

    const bgOf = (root: (typeof light)['root']) => root.children.find((c) => c.tag === 'rect')!.attrs.fill;
    expect(bgOf(light.root)).not.toBe(bgOf(dark.root));

    // n4's fill is a themed colour ({light: "#fff2cc", dark: "#4a3f12"}) and must pick the right one.
    const fillOf = (root: (typeof light)['root']) => {
      const g = findOne(root, (n) => n.tag === 'g' && n.attrs['data-node-id'] === 'n4')!;
      return g.children.find((c) => c.tag === 'rect' || c.tag === 'polygon' || c.tag === 'path')!.attrs.fill;
    };
    expect(fillOf(light.root)).toBe('#fff2cc');
    expect(fillOf(dark.root)).toBe('#4a3f12');
  });
});

// --- A15: linked blocks (design.md §7.1) -------------------------------------------------------

describe('renderSvg: links (A15)', () => {
  it('wraps a linked block in <a href> with the href it is given, leaving its <g> untouched', () => {
    const svg = renderSvg({ title: TITLE, graph, layout, styles, legend, theme: 'light', linkHrefs: { n1: '../services/exports/other-diagram.svg' } });
    const root = parseXml(svg);
    const a = findOne(root, (n) => n.tag === 'a' && n.attrs.href === '../services/exports/other-diagram.svg');
    expect(a).toBeDefined();
    const g = a!.children.find((c) => c.tag === 'g' && c.attrs['data-node-id'] === 'n1');
    expect(g).toBeDefined();
    // An unlinked node isn't wrapped.
    const n2 = findOne(root, (n) => n.tag === 'g' && n.attrs['data-node-id'] === 'n2');
    expect(n2).toBeDefined();
    expect(findOne(root, (n) => n.tag === 'a')).toBe(a); // exactly one <a>, the one just checked
  });

  it('without `linkHrefs`, nothing is wrapped', () => {
    const { root } = renderFixture('light');
    expect(findOne(root, (n) => n.tag === 'a')).toBeUndefined();
  });
});
