import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkReferences, parseConfig } from './index';
import { RICH } from './testkit';

const FIX = join(__dirname, '../../../fixtures');
const read = (p: string) => readFileSync(join(FIX, p), 'utf8');
const codes = (text: string | null) => {
  const { problems } = parseConfig(text);
  return { errors: problems.errors.map((p) => p.code), warnings: problems.warnings.map((p) => p.code) };
};

describe('parseConfig', () => {
  test('no file: an empty config, no problems', () => {
    const r = parseConfig(null);
    expect(r.config).toEqual({ version: 1, title: null, lanes: null, styles: [], nodes: {}, nodeStyles: {}, notes: {}, showTitle: true, preset: null });
    expect(r.problems).toEqual({ errors: [], warnings: [] });
  });

  test('purchase-request fixture parses cleanly', () => {
    const { config, problems } = parseConfig(read('purchase-request/purchase-request.flow.yaml'));
    expect(problems).toEqual({ errors: [], warnings: [] });
    expect(config!.title).toBe('Purchase request approval (current state, synthetic)');
    expect(config!.lanes!.map((l) => l.id)).toEqual(['requester', 'manager', 'purchasing', 'finance', 'vendor']);
    expect(config!.styles).toHaveLength(7);
    expect(config!.styles[3]!.style).toEqual({ fill: { light: '#dae8fc', dark: '#1e3a5f' } });
    expect(config!.styles[6]!.match).toEqual([{ field: 'open_question', op: 'present', value: 'present' }]);
    expect(config!.nodes.p05!.variants).toEqual({ 'main plant': 'three quotes over $1,000', warehouse: 'one quote is fine under $5,000' });
  });

  test('E-config fixture: invalid YAML, line null', () => {
    const { config, problems } = parseConfig(read('errors/E-config.flow.yaml'));
    expect(config).toBeNull();
    expect(problems.errors.length).toBeGreaterThan(0);
    expect(problems.errors.every((p) => p.code === 'E-config' && p.line === null)).toBe(true);
  });

  test.each([
    ['invalid YAML', 'a: [1\n'],
    ['duplicate key', 'title: a\ntitle: b\n'],
    ['two documents', 'title: a\n---\ntitle: b\n'],
    ['top level is a list', '- a\n'],
    ['top level is a scalar', 'hello\n'],
    ['version 2', 'version: 2\n'],
    ['version as text', 'version: "1"\n'],
    ['lanes not a list', 'lanes: {a: 1}\n'],
    ['lane entry not a map', 'lanes: [requester]\n'],
    ['lane entry without id', 'lanes: [{label: x}]\n'],
    ['styles not a list', 'styles: {match: {}, style: {}}\n'],
    ['rule without match', 'styles: [{style: {}}]\n'],
    ['rule without style', 'styles: [{match: {}}]\n'],
    ['rule match not a map', 'styles: [{match: [a], style: {}}]\n'],
    ['match value a list', 'styles: [{match: {source: [a]}, style: {}}]\n'],
    ['match value a map', 'styles: [{match: {x: {a: 1}}, style: {}}]\n'],
    ['nodes not a map', 'nodes: [a]\n'],
    ['node entry not a map', 'nodes: {n1: hello}\n'],
    ['title a map', 'title: {a: 1}\n'],
    ['undefined alias', 'title: *nope\n'],
  ])('E-config: %s', (_name, text) => {
    const r = parseConfig(text);
    expect(r.config).toBeNull();
    expect(codes(text).errors).toContain('E-config');
    expect(r.problems.errors.every((p) => p.line === null)).toBe(true);
  });

  test('missing version means 1; null top-level keys and null node entries are empty', () => {
    const r = parseConfig('title:\nlanes:\nstyles:\nnodes:\n  n1:\n');
    expect(r.problems.errors).toEqual([]);
    expect(r.config).toEqual({ version: 1, title: null, lanes: null, styles: [], nodes: { n1: {} }, nodeStyles: {}, notes: {}, showTitle: true, preset: null });
    expect(parseConfig('').config).not.toBeNull();
    expect(parseConfig('# only a comment\n').config).not.toBeNull();
  });

  test('W-config-key for unknown top-level, rule and lane keys (kept, not errors)', () => {
    const r = parseConfig('owner: x\nlanes: [{id: a, colour: blue}]\nstyles: [{match: {}, style: {}, note: hi}]\n');
    expect(r.problems.errors).toEqual([]);
    expect(r.problems.warnings.map((w) => w.code)).toEqual(['W-config-key', 'W-config-key', 'W-config-key']);
    expect(r.problems.warnings.every((w) => w.line === null)).toBe(true);
    expect(r.config!.lanes).toEqual([{ id: 'a', extra: { colour: 'blue' } }]);
  });

  test('W-style for unknown properties and bad values; the property is ignored', () => {
    const text = `styles:
  - match: {}
    style:
      fill: red
      border_color: "#12"
      text_color: {light: "#fff", dusk: "#000"}
      border_style: wavy
      border_width: 5
      font_style: underline
      badge: [a]
      glow: yes
      stroke: 2
  - match: {}
    style: {border_width: 0}
  - match: {}
    style: {border_width: 2.5, fill: {dark: "#000"}}
  - match: {}
    style: {border_width: "2"}
`;
    const r = parseConfig(text);
    expect(r.problems.errors).toEqual([]);
    expect(r.problems.warnings.map((w) => w.code)).toEqual(new Array(13).fill('W-style'));
    expect(r.config!.styles.map((s) => s.style)).toEqual([{}, {}, {}, {}]);
    expect(r.config!.styles[0]!.rawStyle.glow).toBe('yes');
  });

  test('valid style values are read and colours normalised to lowercase #rrggbb', () => {
    const text = `styles:
  - match: {}
    style: {fill: "#F96", border_color: {light: "#ABCDEF", dark: "#000"}, text_color: {light: "#111"},
            border_style: dotted, border_width: 4, font_style: bold, badge: 12}
`;
    const r = parseConfig(text);
    expect(r.problems).toEqual({ errors: [], warnings: [] });
    expect(r.config!.styles[0]!.style).toEqual({
      fill: '#ff9966', border_color: { light: '#abcdef', dark: '#000000' }, text_color: { light: '#111111' },
      border_style: 'dotted', border_width: 4, font_style: 'bold', badge: '12',
    });
  });

  test('match conditions: values as strings, present/absent ops', () => {
    const r = parseConfig('styles: [{match: {a: 2, b: true, c: present, d: absent, e: null}, style: {}}]\n');
    expect(r.config!.styles[0]!.match).toEqual([
      { field: 'a', op: 'equals', value: '2' },
      { field: 'b', op: 'equals', value: 'true' },
      { field: 'c', op: 'present', value: 'present' },
      { field: 'd', op: 'absent', value: 'absent' },
      { field: 'e', op: 'equals', value: 'null' },
    ]);
  });

  test('the comment-rich test config parses (one W-config-key)', () => {
    const r = parseConfig(RICH);
    expect(r.problems.errors).toEqual([]);
    expect(r.problems.warnings.map((w) => w.code)).toEqual(['W-config-key', 'W-config-key']);
  });
});

describe('checkReferences', () => {
  test('unknown nodes and lanes, including _unassigned', () => {
    const { config } = parseConfig('lanes: [{id: a}, {id: gone}, {id: _unassigned}, {id: gone}]\nnodes: {n1: {x: 1}, old: {x: 2}}\n');
    const w = checkReferences(config, ['n1', 'n2'], ['a', 'b']);
    expect(w.map((p) => [p.code, p.line])).toEqual([
      ['W-config-unknown-node', null],
      ['W-config-unknown-lane', null],
      ['W-config-unknown-lane', null],
    ]);
    expect(w[0]!.message).toContain('old');
    expect(w[1]!.message).toContain('gone');
    expect(w[2]!.message).toContain('_unassigned');
  });
  test('_unassigned warns even if the caller lists it as a lane; null config gives nothing', () => {
    const { config } = parseConfig('lanes: [{id: _unassigned}]\n');
    expect(checkReferences(config, [], ['_unassigned']).map((p) => p.code)).toEqual(['W-config-unknown-lane']);
    expect(checkReferences(null, [], [])).toEqual([]);
  });
  test('the fixture config against the fixture diagram ids is clean', () => {
    const { config } = parseConfig(read('purchase-request/purchase-request.flow.yaml'));
    const ids = Object.keys(config!.nodes);
    expect(checkReferences(config, ids, ['requester', 'manager', 'purchasing', 'finance', 'vendor'])).toEqual([]);
  });
});
