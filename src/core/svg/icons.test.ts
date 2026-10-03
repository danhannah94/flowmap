// A20: preset-pack icons in the SVG export (design.md §4.1, §7.1). Uses the real measure module (unlike index.test.ts,
// which stubs it), so what is checked is what `flowmap export` writes. The golden files are the fixture's whole
// export in both themes; regenerate on purpose with UPDATE_GOLDEN=1 and look at the pictures before committing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadDocument } from '../document';
import { renderSvg } from './index';
import { findAll, findOne, parseXml } from './xmlParser';

const ROOT = join(import.meta.dirname, '../../..');
const FIXTURE = join(ROOT, 'examples/cloud-architecture');
const GOLDEN = join(import.meta.dirname, 'golden');
const read = (name: string) => readFileSync(join(FIXTURE, name), 'utf8');

function exportFixture(theme: 'light' | 'dark', configText?: string): string {
  const doc = loadDocument(read('order-pipeline.mmd'), configText ?? read('order-pipeline.flow.yaml'), null, 'order-pipeline.mmd');
  return renderSvg({
    title: doc.title,
    graph: doc.graph,
    layout: doc.layout!.result,
    styles: doc.styles,
    icons: doc.icons,
    legend: doc.legend,
    notes: doc.notes,
    theme,
  });
}

describe('golden export of the cloud-architecture fixture', () => {
  for (const theme of ['light', 'dark'] as const) {
    const file = join(GOLDEN, `order-pipeline-${theme}.svg`);
    test(theme, () => {
      const svg = exportFixture(theme);
      if (process.env.UPDATE_GOLDEN === '1') {
        mkdirSync(GOLDEN, { recursive: true });
        writeFileSync(file, svg + '\n');
      }
      expect(existsSync(file), `${file} is missing: run with UPDATE_GOLDEN=1`).toBe(true);
      expect(svg + '\n').toBe(readFileSync(file, 'utf8'));
    });
  }
});

describe('icons in the export', () => {
  const svg = exportFixture('light');
  const root = parseXml(svg);
  const nodes = findAll(root, (n) => n.tag === 'g' && 'data-node-id' in n.attrs);
  const icon = (n: ReturnType<typeof findAll>[number]) => findOne(n, (c) => c.tag === 'g' && c.attrs['data-role'] === 'icon');

  test('every kinded block carries an icon inside its own group, after its outline', () => {
    expect(nodes).toHaveLength(11);
    const byId = Object.fromEntries(nodes.map((n) => [n.attrs['data-node-id']!, n]));
    const expected: Record<string, string> = {
      shopper: 'user', site: 'cdn', gateway: 'api-gateway', signin: 'identity', create: 'function', orders: 'queue',
      fulfil: 'service', pay: 'external-service', db: 'database', sessions: 'cache', receipts: 'object-storage',
    };
    for (const [id, glyph] of Object.entries(expected)) {
      const g = icon(byId[id]!);
      expect(g, id).toBeTruthy();
      expect(g!.attrs['data-icon'], id).toBe(glyph);
      // The first shape child is still the node's outline, which carries the style (§7.1).
      expect(['rect', 'polygon', 'path']).toContain(byId[id]!.children.find((c) => ['rect', 'polygon', 'path', 'circle'].includes(c.tag))!.tag);
    }
  });

  test('a block without a kind has no icon', () => {
    const cfg = read('order-pipeline.flow.yaml').replace('  shopper: {kind: user}\n', '');
    const plain = parseXml(exportFixture('light', cfg));
    const shopper = findAll(plain, (n) => n.tag === 'g' && n.attrs['data-node-id'] === 'shopper')[0]!;
    expect(icon(shopper)).toBeUndefined();
    expect(findAll(plain, (n) => n.attrs['data-role'] === 'icon' && n.tag === 'g').length).toBeGreaterThan(0);
  });

  test('the glyph is stroked in the block\'s own text colour, so it contrasts in either theme', () => {
    for (const [theme, text] of [['light', '#0f172a'], ['dark', '#f1f5f9']] as const) {
      const r = parseXml(exportFixture(theme));
      const g = icon(findAll(r, (n) => n.tag === 'g' && n.attrs['data-node-id'] === 'create')[0]!)!;
      const glyph = findOne(g, (n) => n.tag === 'g' && 'transform' in n.attrs)!;
      expect(glyph.attrs.stroke).toBe(text);
      expect(glyph.attrs.fill).toBe('none');
      expect(glyph.children.length).toBeGreaterThan(0);
    }
  });

  test('the chip takes the pack\'s fill for the theme', () => {
    const light = parseXml(exportFixture('light'));
    const dark = parseXml(exportFixture('dark'));
    const chipFill = (r: typeof light) =>
      findAll(icon(findAll(r, (n) => n.tag === 'g' && n.attrs['data-node-id'] === 'db')[0]!)!, (n) => n.tag === 'circle')[1]!.attrs.fill;
    expect(chipFill(light)).toBe('#def5ea');
    expect(chipFill(dark)).toBe('#17402f');
  });

  test('the legend lists the pack\'s kinds in use, each with its glyph on the swatch', () => {
    const items = findAll(root, (n) => n.attrs['data-testid'] === 'legend-item');
    const labels = items.map((i) => findOne(i, (n) => n.tag === 'text')!.text);
    expect(labels).toEqual([
      'Function', 'Service', 'Object storage', 'Database', 'Cache', 'Queue', 'API gateway', 'CDN', 'External service', 'User',
      'Identity and access',
    ]);
    for (const item of items) expect(findOne(item, (n) => n.attrs['data-role'] === 'icon')).toBeTruthy();
  });

  test('works offline: nothing in the file refers to anything outside it', () => {
    const outside = svg.match(/(href|src)="[^"]*"|url\((?!#)[^)]*\)|<image|<use|<script|@import/g);
    expect(outside).toBeNull();
    expect(svg.match(/https?:\/\/[^"]*/g)).toEqual(['http://www.w3.org/2000/svg']);
  });
});
