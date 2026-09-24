// The SVG export for amendment A4 (a diagram without subgraphs draws no lane band or header) and for style badges
// (a badge never covers its node's label). Real measure and layout modules, unlike index.test.ts.
import { describe, expect, it } from 'vitest';
import { loadDocument } from '../document';
import { LABEL_FONT, badgeBox, textArea, textWidth } from '../measure';
import { SHAPE_KINDS } from '../types';
import { renderSvg } from './index';
import { findAll, findOne, parseXml, textContent, type XmlNode } from './xmlParser';

function exportSvg(mmd: string, config: string | null, theme: 'light' | 'dark' = 'light') {
  const doc = loadDocument(mmd, config, null, 'test');
  const layout = doc.layout!.result;
  const svg = renderSvg({ title: doc.title, graph: doc.graph, layout, styles: doc.styles, legend: doc.legend, theme });
  return { root: parseXml(svg), layout };
}

type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const num = (n: XmlNode, k: string) => Number(n.attrs[k]);

const LANE_FREE = `flowchart LR
  a(["Start"])
  b["Check the request"]
  c{"Approved?"}
  d["Order it"]
  a --> b
  b --> c
  c -->|yes| d
  c -->|no| b
`;

describe('SVG export of a diagram without lanes (A4)', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: draws no lane band or header, but keeps the lane's group (hidden label) for §7.1`, () => {
      const { root, layout } = exportSvg(LANE_FREE, null, theme);
      expect(layout.lanes.map((l) => l.id)).toEqual(['_unassigned']);
      const lanes = findAll(root, (n) => n.tag === 'g' && n.attrs['data-lane-id'] !== undefined);
      expect(lanes.map((g) => g.attrs['data-lane-id'])).toEqual(['_unassigned']);
      const g = lanes[0]!;
      expect(findAll(g, (n) => n.tag === 'rect' || n.tag === 'path' || n.tag === 'polygon')).toEqual([]);
      const texts = findAll(g, (n) => n.tag === 'text');
      expect(texts.map(textContent)).toEqual(['Unassigned']);
      expect(texts.every((t) => t.attrs.visibility === 'hidden')).toBe(true);
      // Every node and edge is still there.
      expect(findAll(root, (n) => n.attrs['data-node-id'] !== undefined)).toHaveLength(4);
      expect(findAll(root, (n) => n.attrs['data-edge-id'] !== undefined)).toHaveLength(4);
    });
  }
  it('no room is reserved for a lane label: the first block starts before where a header would end', () => {
    const { layout } = exportSvg(LANE_FREE, null);
    expect(Math.min(...layout.nodes.map((n) => n.x))).toBeLessThan(40);
  });
  it('a diagram with lanes still draws bands and headers, Unassigned included', () => {
    const { root } = exportSvg('flowchart LR\n  subgraph s [Sales]\n    a["A"]\n  end\n  b["B"]\n  a --> b\n', null);
    for (const id of ['s', '_unassigned']) {
      const g = findOne(root, (n) => n.tag === 'g' && n.attrs['data-lane-id'] === id)!;
      expect(findAll(g, (n) => n.tag === 'rect')).toHaveLength(1);
      const label = findOne(g, (n) => n.tag === 'text')!;
      expect(label.attrs.visibility).toBeUndefined();
    }
  });
});

// Labels of every length on every shape, each with a badge (a real export had "wait" over a delay's words).
const LABELS = [
  'Go',
  'Vendor rep agrees a discount (portal rarely updated same day)',
  'Wait for the vendor to confirm the negotiated discount on every line of the quote before anything is ordered',
  'Supercalifragilisticexpialidocious',
];
const BADGES = ['wait', 'needs review', '!'];

describe('style badges never cover the label', () => {
  const decls: string[] = [];
  let k = 0;
  for (const kind of SHAPE_KINDS) {
    for (const label of LABELS) {
      const open = { step: '["', decision: '{"', terminal: '(["', subprocess: '[["', database: '[("', io: '[/"', document: '', delay: '' }[kind];
      const close = { step: '"]', decision: '"}', terminal: '"])', subprocess: '"]]', database: '")]', io: '"/]', document: '', delay: '' }[kind];
      const decl = open ? `  n${k}${open}${label}${close}` : `  n${k}@{ shape: ${kind === 'document' ? 'doc' : 'delay'}, label: "${label}" }`;
      decls.push(decl);
      k++;
    }
  }
  const mmd = `flowchart LR\n${decls.join('\n')}\n`;
  for (const badge of BADGES) {
    it(`badge "${badge}" sits clear of the text area on all eight shapes`, () => {
      const config = `version: 1\nstyles:\n  - match: {}\n    style:\n      badge: "${badge}"\n`;
      const { root, layout } = exportSvg(mmd, config);
      expect(layout.nodes).toHaveLength(SHAPE_KINDS.length * LABELS.length);
      for (const node of layout.nodes) {
        const g = findOne(root, (n) => n.tag === 'g' && n.attrs['data-node-id'] === node.id)!;
        const text = findOne(g, (n) => n.attrs['data-role'] === 'badge')!;
        expect(textContent(text)).toBe(badge);
        // The tag behind the badge text: the rect just before it.
        const tag = g.children[g.children.indexOf(text) - 1]!;
        expect(tag.tag).toBe('rect');
        const b = { x: num(tag, 'x'), y: num(tag, 'y'), w: num(tag, 'width'), h: num(tag, 'height') };
        const area = textArea(node.kind, node.width, node.height);
        const areaBox = { x: node.x + area.x, y: node.y + area.y, w: area.width, h: area.height };
        expect(overlaps(b, areaBox), `${node.id} (${node.kind}) badge ${JSON.stringify(b)} over text area ${JSON.stringify(areaBox)}`).toBe(false);
        // And against each drawn label line's box (baseline at 0.72 of the line height).
        for (const line of findAll(g, (n) => n.attrs['data-role'] === 'label')) {
          const w = textWidth(textContent(line));
          const lb = { x: num(line, 'x') - w / 2, y: num(line, 'y') - LABEL_FONT.lineHeight * 0.72, w, h: LABEL_FONT.lineHeight };
          expect(overlaps(b, lb), `${node.id} badge over "${textContent(line)}"`).toBe(false);
        }
        // The badge text fits its tag, and the tag the shared geometry the UI uses.
        expect(b).toEqual((({ x, y, width, height }) => ({ x: node.x + x, y: node.y + y, w: width, h: height }))(badgeBox(node.kind, node.width, node.height, badge)));
        expect(textWidth(badge) * (10 / 13)).toBeLessThanOrEqual(b.w - 8);
        // The tag stays close to its node: it touches the box and stands out at most 10 px above it.
        expect(b.y).toBeGreaterThanOrEqual(node.y - 10);
        expect(b.y + b.h).toBeGreaterThan(node.y);
      }
    });
  }
});
