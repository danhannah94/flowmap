// A20: preset packs through the document (loadDocument), the config reader and the edit operation (design.md §4.1).
import { describe, expect, test } from 'vitest';
import { parseConfig } from '../config';
import { loadDocument } from '../document';
import { setPreset } from '../ops';
import { edit, expectParity, ok, PR, refused } from '../ops/testkit';

const MMD = 'flowchart LR\n  subgraph l [Lane]\n    a["Orders"]\n    b["Jobs"]\n    c["Other"]\n  end\n  a --> b\n  b --> c\n';
const load = (config: string | null, files?: Record<string, string | null>) => loadDocument(MMD, config, null, 'x.mmd', files);
const codes = (doc: ReturnType<typeof load>) => doc.problems.warnings.map((w) => w.code);

describe('config: the preset key', () => {
  test('reads as trimmed text; absent is null', () => {
    expect(parseConfig('preset: " cloud "\n').config!.preset).toBe('cloud');
    expect(parseConfig('title: x\n').config!.preset).toBeNull();
    expect(parseConfig('preset:\n').config!.preset).toBeNull();
  });

  test('anything but text is E-config, and preset is a known top-level key (no W-config-key)', () => {
    for (const bad of ['preset: [cloud]', 'preset: {a: 1}', 'preset: 5', 'preset: ""', 'preset: true']) {
      expect(parseConfig(`${bad}\n`).problems.errors.map((e) => e.code), bad).toEqual(['E-config']);
    }
    expect(parseConfig('preset: cloud\n').problems.warnings).toEqual([]);
  });
});

describe('loadDocument with a built-in preset', () => {
  const cfg = 'preset: cloud\nnodes:\n  a: {kind: database}\n  b: {kind: queue}\n';

  test('gives icons, pack styles and legend entries (only for kinds in use)', () => {
    const doc = load(cfg);
    expect(doc.problems.warnings).toEqual([]);
    expect(doc.preset).toEqual({ ref: 'cloud', name: 'Cloud architecture' });
    expect(Object.keys(doc.icons).sort()).toEqual(['a', 'b']);
    expect(doc.icons.a!.name).toBe('database');
    expect(doc.styles.a!.fill).toEqual({ light: '#def5ea', dark: '#17402f' });
    expect(doc.styles.c).toEqual({});
    expect(doc.legend.map((l) => l.text)).toEqual(['Database', 'Queue']);
  });

  test('the pack is the lowest layer: a rule, then the block\'s own style, override it; the diagram\'s legend follows the pack\'s', () => {
    const doc = load(
      [
        'preset: cloud',
        'styles:',
        '  - legend: Mine',
        '    match: {kind: database}',
        '    style: {fill: "#111111", badge: db}',
        'nodes:',
        '  a: {kind: database}',
        '  b: {kind: queue, style: {border_color: "#222222"}}',
        '',
      ].join('\n'),
    );
    expect(doc.styles.a).toMatchObject({ fill: '#111111', badge: 'db', border_color: { light: '#2f9e6d' } });
    expect(doc.styles.b).toMatchObject({ border_color: '#222222', fill: { light: '#fff0d6' } });
    expect(doc.legend.map((l) => l.text)).toEqual(['Database', 'Queue', 'Mine']);
  });

  test('does not change where anything is laid out', () => {
    const plain = load('nodes:\n  a: {kind: database}\n  b: {kind: queue}\n');
    const withPack = load(cfg);
    expect(withPack.layout!.result).toEqual(plain.layout!.result);
  });

  test('an unknown pack is W-preset-unknown and the diagram draws as if it had none', () => {
    const doc = load('preset: kloud\nnodes:\n  a: {kind: database}\n');
    expect(codes(doc)).toEqual(['W-preset-unknown']);
    expect(doc.problems.errors).toEqual([]);
    expect(doc.preset).toBeNull();
    expect(doc.icons).toEqual({});
    expect(doc.legend).toEqual([]);
    expect(doc.layout).not.toBeNull();
  });

  test('a kind the pack does not have is W-preset-kind (once per kind), and the known blocks still get theirs', () => {
    const doc = load('preset: cloud\nnodes:\n  a: {kind: database}\n  b: {kind: widget}\n  c: {kind: widget}\n');
    expect(codes(doc)).toEqual(['W-preset-kind']);
    expect(doc.problems.warnings[0]!.message).toContain('"widget"');
    expect(Object.keys(doc.icons)).toEqual(['a']);
  });

  test('a config with E-config errors uses no pack (default styles, as for any rule)', () => {
    const doc = load('preset: cloud\nnodes: []\n');
    expect(doc.config).toBeNull();
    expect(doc.preset).toBeNull();
    expect(doc.icons).toEqual({});
  });

  test('no preset key: the document has no icons and no preset', () => {
    const doc = load('nodes:\n  a: {kind: database}\n');
    expect(doc.icons).toEqual({});
    expect(doc.preset).toBeNull();
  });
});

describe('loadDocument with a preset file', () => {
  const pack = 'name: Team\nkinds:\n  job:\n    label: Background job\n    icon: queue\n    style: {fill: "#abcdef"}\n';
  const cfg = 'preset: packs/team.yaml\nnodes:\n  a: {kind: job}\n';

  test('uses the text the host read, keyed by the reference as written', () => {
    const doc = load(cfg, { 'packs/team.yaml': pack });
    expect(doc.problems.warnings).toEqual([]);
    expect(doc.preset).toEqual({ ref: 'packs/team.yaml', name: 'Team' });
    expect(doc.icons.a!.name).toBe('queue');
    expect(doc.styles.a).toEqual({ fill: '#abcdef' });
    expect(doc.legend.map((l) => l.text)).toEqual(['Background job']);
  });

  test('a file the host could not read is W-preset-unknown; a broken file is W-preset-invalid', () => {
    expect(codes(load(cfg, { 'packs/team.yaml': null }))).toEqual(['W-preset-unknown']);
    expect(codes(load(cfg, { 'packs/team.yaml': 'kinds: [oops\n' }))).toEqual(['W-preset-invalid']);
  });

  test('a file nobody has read yet draws plain, with no warning (the editor between naming a file and fetching it)', () => {
    const doc = load(cfg);
    expect(doc.problems.warnings).toEqual([]);
    expect(doc.icons).toEqual({});
  });
});

describe('setPreset (the Styles panel field)', () => {
  test('writes the key at the end of a config, in place when it exists, and removes it when emptied', () => {
    expectParity(setPreset(PR, 'cloud'), PR, { config: PR.config!.replace(/\n*$/, '\n') + 'preset: cloud\n' });
    const withPreset = ok(setPreset(PR, 'cloud')).files;
    expectParity(setPreset(withPreset, 'packs/team.yaml'), withPreset, {
      config: edit(withPreset.config!, ['preset: cloud', 'preset: packs/team.yaml']),
    });
    expect(ok(setPreset(withPreset, null)).files.config).toBe(PR.config!.replace(/\n*$/, '\n'));
    expect(ok(setPreset(withPreset, '  ')).files.config).toBe(PR.config!.replace(/\n*$/, '\n'));
  });

  test('with no config file it creates one with only the new key', () => {
    const r = ok(setPreset({ mmd: MMD, config: null, layout: null }, 'cloud'));
    expect(r.files.config).toBe('version: 1\npreset: cloud\n');
  });

  test('is refused while the config has errors', () => {
    expect(refused(setPreset({ mmd: MMD, config: 'nodes: []\n', layout: null }, 'cloud'))).toBeTruthy();
  });
});
