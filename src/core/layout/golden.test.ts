// v1.0 compatibility golden (v1.1 §5: every v1.1 key is optional): a layout file with no v1.1 keys lays out exactly as
// the v1.0 engine did. The golden was captured from the v1.0 engine (commit 76a398d) and holds, per case, the layout
// JSON (every v1.0 field, in v1.0 key order) and the hints. v1.1 adds `manual`, `source_side` and `target_side` to
// edges; they are stripped before comparing, so everything else must be byte-identical.
//
// Regenerate (only when a v1.0 layout change is intended): UPDATE_GOLDEN=1 pnpm exec vitest run src/core/layout/golden
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { loadDocument } from '../document';
import type { Graph, LayoutResult } from '../types';
import { layout } from './index';
import { randomGraph, randomPins } from './testkit';

const ROOT = join(__dirname, '..', '..', '..');
const GOLDEN = join(__dirname, 'golden-v10.json');

/** The v1.0 fields only, in v1.0 key order. */
function v10(result: LayoutResult): unknown {
  return {
    direction: result.direction,
    width: result.width,
    height: result.height,
    lanes: result.lanes,
    nodes: result.nodes,
    edges: result.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target, label: e.label, points: e.points, label_pos: e.label_pos,
    })),
  };
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function fixtureFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(dir, name.name);
      if (name.isDirectory()) walk(p);
      else if (name.name.endsWith('.mmd')) out.push(p);
    }
  };
  walk(join(ROOT, 'fixtures'));
  return out;
}

function readOpt(p: string): string | null {
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

/** Every case: [name, json of the v1.0 fields, json of the hints]. */
function cases(): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const file of fixtureFiles()) {
    const mmd = readFileSync(file, 'utf8');
    const base = file.slice(0, -'.mmd'.length);
    for (const dir of ['LR', 'TB'] as const) {
      const text = mmd.replace(/^flowchart (LR|TB|TD)/m, `flowchart ${dir}`);
      const doc = loadDocument(text, readOpt(`${base}.flow.yaml`), readOpt(`${base}.layout.json`), file);
      if (!doc.layout) continue;
      const name = `${file.slice(ROOT.length + 1)} ${dir}`;
      out.push([name, JSON.stringify(v10(doc.layout.result)), JSON.stringify(doc.layout.hints)]);
      // Laid out again from its own hints, as the UI does after every edit.
      const again = layout(doc.graph, doc.pins, doc.layout.hints);
      out.push([`${name} +hints`, JSON.stringify(v10(again.result)), JSON.stringify(again.hints)]);
    }
  }
  for (const [seed, n] of [[1, 12], [2, 30], [3, 60], [4, 100], [5, 150], [6, 45]] as const) {
    for (const dir of ['LR', 'TB'] as const) {
      const g: Graph = randomGraph(seed, { nodes: n, direction: dir });
      const pins = seed % 2 ? randomPins(seed, g, 0.2) : {};
      const r = layout(g, pins);
      out.push([`random ${seed}/${n} ${dir}`, JSON.stringify(v10(r.result)), JSON.stringify(r.hints)]);
    }
  }
  return out;
}

describe('v1.0 files lay out byte-identically to the v1.0 engine', () => {
  const now = cases();
  if (process.env.UPDATE_GOLDEN) {
    const golden: Record<string, { layout: string; hints: string }> = {};
    for (const [name, lay, hints] of now) golden[name] = { layout: sha(lay), hints: sha(hints) };
    writeFileSync(GOLDEN, JSON.stringify(golden, null, 1) + '\n');
  }
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, { layout: string; hints: string }>;
  test('the golden covers every case', () => {
    expect(Object.keys(golden).sort()).toEqual(now.map(([n]) => n).sort());
    expect(now.length).toBeGreaterThan(20);
  });
  for (const [name, lay, hints] of now) {
    test(name, () => {
      expect(sha(lay)).toBe(golden[name]?.layout);
      expect(sha(hints)).toBe(golden[name]?.hints);
    });
  }
});
