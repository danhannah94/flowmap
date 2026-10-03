// v1.0 files behave exactly as before v1.1 (CHANGES-v1.1.md): for every fixture and a set of v1.0-shaped cases, the
// validate output (every problem, in order) and the document output this module owns (config as v1.0 knew it, pins,
// graph, styles, legend, title) are identical to what the v1.0 code produced. The golden was captured from the
// pre-v1.1 code; regenerate only on purpose with UPDATE_GOLDEN=1 (and say why in the change).
//
// The computed layout itself is not in this golden: the layout engine is owned elsewhere and gains v1.1 fields.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadDocument } from './document';

const ROOT = join(import.meta.dirname, '../..');
const GOLDEN = join(import.meta.dirname, 'document.golden.json');

interface Case { name: string; mmd: string; config: string | null; layout: string | null; mmdName: string }

function fixtureCases(): Case[] {
  const out: Case[] = [];
  for (const dir of ['fixtures/purchase-request', 'fixtures/syntax', 'fixtures/errors']) {
    // Amendment A19's group fixtures post-date v1.0 (a v1.0 file can't have groups); groups.test.ts files cover them.
    for (const f of readdirSync(join(ROOT, dir)).filter((x) => x.endsWith('.mmd') && !x.startsWith('groups')).sort()) {
      const base = join(ROOT, dir, f.replace(/\.mmd$/, ''));
      const opt = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
      out.push({ name: `${dir}/${f}`, mmd: readFileSync(join(ROOT, dir, f), 'utf8'), config: opt(`${base}.flow.yaml`), layout: opt(`${base}.layout.json`), mmdName: f });
    }
  }
  return out;
}

const PR_MMD = readFileSync(join(ROOT, 'fixtures/purchase-request/purchase-request.mmd'), 'utf8');
const PR_CFG = readFileSync(join(ROOT, 'fixtures/purchase-request/purchase-request.flow.yaml'), 'utf8');
const LANES = 'flowchart LR\n  u1["Loose"]\n\n  subgraph l1 [One]\n    a["A"]\n    b{"B?"}\n  end\n\n  subgraph l2 [Two]\n    c(["C"])\n  end\n\n  a --> b\n  b -->|yes| c\n  b -->|no| a\n  a --> c\n  a --> c\n';
const FREE = 'flowchart TB\n  a["A"]\n  b["B"]\n  a --> b\n';

const synthetic: Case[] = [
  { name: 'pr: no config, no layout', mmd: PR_MMD, config: null, layout: null, mmdName: 'purchase-request.mmd' },
  { name: 'pr: unknown and stale pins', mmd: PR_MMD, config: PR_CFG, mmdName: 'pr.mmd',
    layout: '{"version": 1, "nodes": {"ghost": {"lane": "requester", "along": 1, "across": 2}, "closed": {"lane": "finance", "along": 10, "across": 20}, "m01": {"lane": "manager", "along": 300, "across": 12}}, "hints": {"x": 1}}' },
  { name: 'lanes: negative pins in the first lane', mmd: LANES, config: null, mmdName: 'lanes.mmd',
    layout: '{"version": 1, "nodes": {"a": {"lane": "l1", "along": -40, "across": -30}, "c": {"lane": "l2", "along": -5, "across": 0}}}' },
  { name: 'lanes: negative across outside the first lane', mmd: LANES, config: null, mmdName: 'lanes.mmd',
    layout: '{"version": 1, "nodes": {"c": {"lane": "l2", "along": 5, "across": -1}}}' },
  { name: 'lanes: config lane order makes l2 first', mmd: LANES, config: 'lanes:\n  - id: l2\n', mmdName: 'lanes.mmd',
    layout: '{"version": 1, "nodes": {"c": {"lane": "l2", "along": 5, "across": -1}}}' },
  { name: 'layout: invalid JSON', mmd: LANES, config: null, layout: '{"version": 1,', mmdName: 'x.mmd' },
  { name: 'layout: unknown key', mmd: LANES, config: null, layout: '{"version": 1, "nodes": {}, "extra": true}', mmdName: 'x.mmd' },
  { name: 'layout: bad pins', mmd: LANES, config: null, mmdName: 'x.mmd',
    layout: '{"version": 1, "nodes": {"a": {"lane": "l1", "along": 1.5, "across": 0}, "b": {"lane": "l1", "along": 1, "across": 0, "x": 2}, "c": 3}}' },
  { name: 'layout: missing nodes, version 2', mmd: LANES, config: null, layout: '{"version": 2}', mmdName: 'x.mmd' },
  { name: 'config: warnings of every v1.0 kind', mmd: LANES, mmdName: 'x.mmd', layout: null,
    config: [
      'version: 1', 'title: Warnings', 'extra_top: 1',
      'lanes:', '  - id: l2', '    colour: red', '  - id: nope', '  - id: _unassigned',
      'styles:',
      '  - legend: Bad props', '    match: {}', '    style: {border_width: 5, border_style: wavy, fill: red, glow: 1, badge: ""}',
      '    note: hi',
      '  - legend: Dark only', '    match: {kind: decision}', '    style: {fill: {dark: "#000"}, text_color: {light: "#ABC", dark: "#123456"}}',
      '  - match: {lane: l1, id: a}', '    style: {border_color: "#F96", font_style: italic, border_width: 3, badge: 2}',
      '  - legend: Listed', '    match: {tags: x, missing: absent, owner: present}', '    style: {border_style: dotted}',
      'nodes:', '  a:', '    tags: [x, y]', '    owner: sam', '  ghost:', '    kind: wait', '  b:', '    kind: wait', '',
    ].join('\n') },
  { name: 'config: E-config wrong types', mmd: LANES, mmdName: 'x.mmd', layout: null, config: 'version: 1\nlanes: {a: 1}\nnodes: []\nstyles:\n  - match: {a: [1]}\n' },
  { name: 'config: invalid YAML', mmd: LANES, mmdName: 'x.mmd', layout: null, config: 'styles: [oops\n' },
  { name: 'config: version string', mmd: LANES, mmdName: 'x.mmd', layout: null, config: 'version: "1"\n' },
  { name: 'config: null keys and entries', mmd: LANES, mmdName: 'x.mmd', layout: null, config: 'version: 1\ntitle:\nlanes:\nnodes:\n  a:\n' },
  { name: 'lane-free diagram with a pin', mmd: FREE, config: 'title: Free\n', mmdName: 'free.mmd',
    layout: '{"version": 1, "nodes": {"a": {"lane": "_unassigned", "along": -10, "across": -20}}}' },
];

function snapshot(c: Case): unknown {
  const doc = loadDocument(c.mmd, c.config, c.layout, c.mmdName);
  const cfg = doc.config && { version: doc.config.version, title: doc.config.title, lanes: doc.config.lanes, styles: doc.config.styles, nodes: doc.config.nodes };
  return {
    problems: doc.problems,
    config: cfg,
    pins: doc.pins,
    graph: doc.graph,
    styles: doc.styles,
    legend: doc.legend,
    title: doc.title,
    laidOut: doc.layout !== null,
  };
}

const cases = [...fixtureCases(), ...synthetic];

if (process.env.UPDATE_GOLDEN === '1') {
  const all: Record<string, unknown> = {};
  for (const c of cases) all[c.name] = snapshot(c);
  writeFileSync(GOLDEN, JSON.stringify(all, null, 1) + '\n');
}

describe('v1.0 files behave exactly as before (golden captured from the v1.0 code)', () => {
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, unknown>;
  test('the golden covers every case', () => {
    expect(Object.keys(golden).sort()).toEqual(cases.map((c) => c.name).sort());
  });
  test.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(JSON.parse(JSON.stringify(snapshot(c)))).toEqual(golden[c.name]);
  });
  test('fixture names are stable', () => {
    expect(fixtureCases().map((c) => basename(c.name))).toContain('purchase-request.mmd');
  });
});
