// Amendment A19, §7.1: each group is a `<g data-group-id>` with its box and its label, after the lanes and before the
// nodes; a diagram without groups has none.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDocument } from '../document';
import { renderSvg } from './index';

const ROOT = join(import.meta.dirname, '../../..');

function svgOf(mmd: string): string {
  const doc = loadDocument(mmd, null, null, 'x.mmd');
  return renderSvg({ title: doc.title, graph: doc.graph, layout: doc.layout!.result, styles: doc.styles, legend: doc.legend, theme: 'light' });
}

describe('A19 SVG export: groups', () => {
  const mmd = readFileSync(join(ROOT, 'fixtures/syntax/groups.canonical.mmd'), 'utf8');
  const svg = svgOf(mmd);
  const doc = loadDocument(mmd, null, null, 'x.mmd');

  it('draws every group as <g data-group-id> holding its box (as in the layout) and its label', () => {
    for (const g of doc.layout!.result.groups!) {
      const m = new RegExp(`<g data-group-id="${g.id}"><rect x="(\\d+)" y="(\\d+)" width="(\\d+)" height="(\\d+)"[^>]*/><text[^>]*>([^<]*)</text></g>`).exec(svg);
      expect(m).not.toBeNull();
      expect(m!.slice(1, 5).map(Number)).toEqual([g.x, g.y, g.width, g.height]);
      expect(m![5]).toBe(g.label);
    }
  });

  it('puts groups after the lanes and before the nodes, outer before inner', () => {
    const lastLane = svg.lastIndexOf('data-lane-id=');
    const firstNode = svg.indexOf('data-node-id=');
    const order = ['net', 'sub-a', 'sub-b', 'empty'].map((id) => svg.indexOf(`data-group-id="${id}"`));
    expect(order.every((i) => i > lastLane && i < firstNode)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('a diagram without groups has no group element', () => {
    expect(svgOf('flowchart LR\n  subgraph a [A]\n    x["X"]\n  end\n')).not.toContain('data-group-id');
  });
});
