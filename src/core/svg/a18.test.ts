// Amendment A18: dashed, thick and bidirectional lines through layout and the SVG export (design.md §6, §7, §7.1).
// Golden SVGs: `tests/golden/edge-styles/<name>.svg` is exactly what `flowmap export` writes for `<name>.mmd` in the light
// theme (the export is pure text). Regenerate on purpose with UPDATE_GOLDEN=1 and say why in the change.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDocument } from '../document';
import { format, parse } from '../mmd';
import type { EdgeStyle } from '../types';
import { renderSvg } from './index';
import { findAll, findOne, parseXml, type XmlNode } from './xmlParser';

const DIR = join(import.meta.dirname, '../../../tests/golden/edge-styles');

function doc(name: string) {
  const mmd = readFileSync(join(DIR, `${name}.mmd`), 'utf8');
  const d = loadDocument(mmd, null, null, `${name}.mmd`);
  expect(d.problems.errors).toEqual([]);
  return d;
}

function svgOf(name: string, theme: 'light' | 'dark' = 'light'): string {
  const d = doc(name);
  return renderSvg({ title: d.title, graph: d.graph, layout: d.layout!.result, styles: d.styles, legend: d.legend, notes: d.notes, theme });
}

const GOLDENS = ['dashed', 'thick', 'bidirectional', 'mixed'];

describe('golden SVGs (one per form, and one with all of them)', () => {
  it.each(GOLDENS)('%s.svg is exactly what the export writes', (name) => {
    const svg = svgOf(name);
    if (process.env.UPDATE_GOLDEN === '1') writeFileSync(join(DIR, `${name}.svg`), `${svg}\n`);
    expect(`${svg}\n`).toBe(readFileSync(join(DIR, `${name}.svg`), 'utf8'));
  });
});

const edgeGroup = (root: XmlNode, id: string): XmlNode => {
  const g = findOne(root, (n) => n.tag === 'g' && n.attrs['data-edge-id'] === id);
  if (!g) throw new Error(`no edge ${id}`);
  return g;
};
const lineOf = (root: XmlNode, id: string): XmlNode => findOne(edgeGroup(root, id), (n) => n.tag === 'polyline')!;

describe('how each style is drawn (§7.1)', () => {
  const root = parseXml(svgOf('mixed'));
  const expectLine = (id: string, want: { style?: EdgeStyle; width: string; dash: string | undefined; start: string | undefined; end: string }) => {
    const g = edgeGroup(root, id);
    expect(g.attrs['data-edge-style']).toBe(want.style);
    const line = lineOf(root, id);
    expect(line.attrs['stroke-width']).toBe(want.width);
    expect(line.attrs['stroke-dasharray']).toBe(want.dash);
    expect(line.attrs['marker-start']).toBe(want.start);
    expect(line.attrs['marker-end']).toBe(want.end);
  };

  it('solid (-->) is drawn as before: no dash, one head, no style attribute', () => {
    expectLine('client->api', { width: '1.5', dash: undefined, start: undefined, end: 'url(#arrowhead)' });
  });
  it('dashed (-.->) has stroke-dasharray 6 4 and one head', () => {
    expectLine('api->audit', { style: 'dashed', width: '1.5', dash: '6 4', start: undefined, end: 'url(#arrowhead)' });
    expectLine('model->audit', { style: 'dashed', width: '1.5', dash: '6 4', start: undefined, end: 'url(#arrowhead)' });
  });
  it('thick (==>) is twice as wide, with its own head', () => {
    expectLine('api->model', { style: 'thick', width: '3', dash: undefined, start: undefined, end: 'url(#arrowhead-thick)' });
  });
  it('bidirectional (<-->) has a head at each end', () => {
    expectLine('model->cache', { style: 'bidirectional', width: '1.5', dash: undefined, start: 'url(#arrowhead)', end: 'url(#arrowhead)' });
  });

  it('a label is drawn the same way for every style', () => {
    const g = edgeGroup(root, 'api->model');
    expect(findOne(g, (n) => n.tag === 'title')!.text).toBe('critical path');
    expect(findAll(g, (n) => n.tag === 'text').map((t) => t.text)).toEqual(['critical path']);
    expect(findAll(edgeGroup(root, 'cache->audit'), (n) => n.tag === 'text').map((t) => t.text)).toEqual(['replicate']);
  });

  it('the thick marker is defined only in a diagram that has a thick line', () => {
    const ids = (r: XmlNode) => findAll(r, (n) => n.tag === 'marker').map((m) => m.attrs.id);
    expect(ids(root)).toEqual(['arrowhead', 'arrowhead-thick']);
    expect(ids(parseXml(svgOf('dashed')))).toEqual(['arrowhead']);
    expect(ids(parseXml(svgOf('bidirectional')))).toEqual(['arrowhead']);
  });

  it('dark theme: the same structure, with the theme\'s edge colour', () => {
    const dark = parseXml(svgOf('mixed', 'dark'));
    expect(lineOf(dark, 'api->audit').attrs['stroke-dasharray']).toBe('6 4');
    expect(lineOf(dark, 'api->audit').attrs.stroke).toBe('#94a3b8');
  });
});

describe('the layout treats every style like -->', () => {
  const geometry = (name: string, restyle?: (mmd: string) => string) => {
    const mmd = readFileSync(join(DIR, `${name}.mmd`), 'utf8');
    const d = loadDocument(restyle ? restyle(mmd) : mmd, null, null, `${name}.mmd`);
    return d.layout!.result;
  };
  /** The same diagram with every line solid (the long text-label forms included). */
  const plain = (mmd: string) => {
    const d = parse(mmd).diagram;
    for (const e of d.edges) delete e.style;
    return format(d);
  };

  it.each(['dashed', 'thick', 'bidirectional', 'mixed'])('%s: same boxes, points, sides and label positions as with -->', (name) => {
    const styled = geometry(name);
    const solid = geometry(name, plain);
    expect(styled.nodes).toEqual(solid.nodes);
    expect(styled.lanes).toEqual(solid.lanes);
    expect(styled.edges.map(({ style: _style, ...rest }) => rest)).toEqual(solid.edges);
    expect([styled.width, styled.height]).toEqual([solid.width, solid.height]);
  });

  it('layout --json carries the style on non-solid edges only', () => {
    const edges = geometry('mixed').edges;
    expect(edges.map((e) => [e.id, e.style])).toEqual([
      ['client->api', undefined],
      ['api->model', 'thick'],
      ['model->cache', 'bidirectional'],
      ['api->audit', 'dashed'],
      ['model->audit', 'dashed'],
      ['cache->audit', 'bidirectional'],
    ]);
    expect(Object.keys(edges[0]!)).not.toContain('style');
  });
});
