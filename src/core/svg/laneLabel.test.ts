// The export's lane label is horizontal at the lane's top-left, beyond the layout's header strip, so a block's icon
// tag (A20, on the block's top edge) or the block itself can sit where it is. Such a label is drawn again on top of
// the blocks with a halo in the lane's colour; the lane's own <g data-lane-id> keeps it, hidden (§7.1 unchanged).
// Real measure module, so this is what `flowmap export` writes; the golden is regenerated with UPDATE_GOLDEN=1.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadDocument } from '../document';
import { renderSvg } from './index';
import { findAll, findOne, parseXml, textContent } from './xmlParser';

const GOLDEN = join(import.meta.dirname, 'golden');

const MMD = `flowchart LR
  subgraph a [Row A]
    k1["function"]
    k2["service"]
  end
  subgraph d [Aliases and negatives]
    al1["alias serverless"]
    al2["alias db"]
  end
  k1 --> k2
  al1 --> al2
`;
const CONFIG = `preset: cloud
nodes:
  k1: {kind: function}
  k2: {kind: service}
  al1: {kind: serverless}
  al2: {kind: db}
`;

function exportSvg(mmd: string, config: string | null, theme: 'light' | 'dark' = 'light'): string {
  const doc = loadDocument(mmd, config, null, 'x.mmd');
  return renderSvg({
    title: doc.title, graph: doc.graph, layout: doc.layout!.result, styles: doc.styles, icons: doc.icons,
    legend: doc.legend, notes: doc.notes, theme,
  });
}

describe('a lane label an icon tag would cover is drawn on top', () => {
  const svg = exportSvg(MMD, CONFIG);
  const root = parseXml(svg);
  const laneText = (id: string) => findOne(findOne(root, (n) => n.attrs['data-lane-id'] === id)!, (n) => n.tag === 'text')!;
  const onTop = findAll(root, (n) => n.tag === 'g' && n.attrs['data-role'] === 'lane-label');

  test('only the covered lane gets an on-top label, with the same text in the same place', () => {
    expect(onTop.map((g) => g.attrs['data-lane'])).toEqual(['d']);
    const top = findOne(onTop[0]!, (n) => n.tag === 'text')!;
    expect(textContent(top)).toBe('Aliases and negatives');
    const own = laneText('d');
    expect([top.attrs.x, top.attrs.y]).toEqual([own.attrs.x, own.attrs.y]);
    expect(top.attrs['paint-order']).toBe('stroke'); // the halo
  });

  test('the lane keeps its label in its own <g> (§7.1), hidden only where it is drawn on top', () => {
    expect(textContent(laneText('d'))).toBe('Aliases and negatives');
    expect(laneText('d').attrs.visibility).toBe('hidden');
    expect(laneText('a').attrs.visibility).toBeUndefined();
  });

  test('the on-top label comes after every block and line (painted over them), before the title', () => {
    expect(svg.indexOf('data-role="lane-label"')).toBeGreaterThan(svg.lastIndexOf('data-node-id='));
    expect(svg.indexOf('data-role="lane-label"')).toBeGreaterThan(svg.lastIndexOf('data-edge-id='));
    expect(svg.indexOf('data-role="lane-label"')).toBeLessThan(svg.indexOf('data-role="title"'));
  });

  test('the layout is untouched: the same diagram without icons lays out identically', () => {
    const withIcons = loadDocument(MMD, CONFIG, null, 'x.mmd').layout!.result;
    const without = loadDocument(MMD, null, null, 'x.mmd').layout!.result;
    expect(withIcons.nodes.map(({ x, y, width, height }) => [x, y, width, height]))
      .toEqual(without.nodes.map(({ x, y, width, height }) => [x, y, width, height]));
  });

  test('without icons nothing covers the labels, so there is no on-top label', () => {
    expect(exportSvg(MMD, null)).not.toContain('data-role="lane-label"');
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`golden (${theme})`, () => {
      const file = join(GOLDEN, `lane-label-over-icon-${theme}.svg`);
      const out = exportSvg(MMD, CONFIG, theme) + '\n';
      if (process.env.UPDATE_GOLDEN === '1') {
        mkdirSync(GOLDEN, { recursive: true });
        writeFileSync(file, out);
      }
      expect(existsSync(file), `${file} is missing: run with UPDATE_GOLDEN=1`).toBe(true);
      expect(out).toBe(readFileSync(file, 'utf8'));
    });
  }
});
