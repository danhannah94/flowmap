// The inspector's value text (§8.3) and the field form round trip (UI24): an existing value opened in the form and
// saved untouched writes the same value back.
import { fieldValueFromForm, fieldValueToJs, parseConfig } from '../../../core/config';
import { PR } from '../../../core/ops/testkit';
import { convertForm, describeMatch, fieldText, formFor, knownKeys, orphanId, ruleKeys, usualType } from './format';

const cfg = parseConfig(PR.config).config!;

describe('fieldText (§8.3 Inspector)', () => {
  test('scalars as their YAML string, lists joined with ", ", maps as compact JSON', () => {
    expect(fieldText('single-source')).toBe('single-source');
    expect(fieldText(2)).toBe('2');
    expect(fieldText(true)).toBe('true');
    expect(fieldText(null)).toBe('null');
    expect(fieldText(['a', 'b', 3])).toBe('a, b, 3');
    expect(fieldText({ 'main plant': 'three', warehouse: '' })).toBe('{"main plant":"three","warehouse":""}');
    expect(fieldText({ a: [1, 2], b: { c: 'd' } })).toBe('{"a":[1,2],"b":{"c":"d"}}');
  });
});

describe('formFor: the type that writes the value back unchanged', () => {
  const roundTrip = (v: unknown) => {
    const f = formFor(v);
    const fv = fieldValueFromForm(f.type, f.text);
    if ('error' in fv) throw new Error(fv.error);
    return { type: f.type, back: fieldValueToJs(fv) };
  };

  test.each([
    ['text', 'the form is a spreadsheet'],
    ['text', 'two\nlines'],
    ['list', ['sam-09-01', 'lee-09-03']],
    ['map', { 'main plant': 'three quotes over $1,000', warehouse: '' }],
    ['yaml', 2],
    ['yaml', true],
    ['yaml', null],
    ['yaml', []],
    ['yaml', ['a', 2]],
    ['yaml', ['', 'x']],
    ['yaml', { 'a: b': 'c' }],
    ['yaml', { a: [1, 2], b: { c: 'd' } }],
  ] as const)('%s for %j', (type, v) => {
    const r = roundTrip(v);
    expect(r.type).toBe(type);
    expect(r.back).toEqual(v);
  });

  test('switching type on an untouched value converts it when it can', () => {
    expect(convertForm(['a', 'b'], 'yaml')).toBe('- a\n- b');
    expect(convertForm(['a', 'b'], 'text')).toBeNull();
    expect(convertForm(2, 'text')).toBe('2');
    expect(convertForm({ k: 'v' }, 'map')).toBe('k: v');
  });
});

describe('suggestion and key helpers', () => {
  test('keys the rules match on, and the known keys (common evidence fields first)', () => {
    expect([...ruleKeys(cfg)]).toEqual(['confidence', 'system', 'kind', 'open_question']);
    expect(knownKeys(cfg).slice(0, 6)).toEqual(['source', 'confidence', 'quote', 'open_question', 'system', 'kind']);
    expect(knownKeys(cfg)).toContain('variants');
    expect(usualType(cfg, 'source')).toBe('list');
    expect(usualType(cfg, 'quote')).toBe('text');
    expect(usualType(cfg, 'nope')).toBeNull();
  });

  test('describeMatch', () => {
    expect(describeMatch(cfg.styles[0]!)).toBe('confidence is confirmed');
    expect(describeMatch(cfg.styles[6]!)).toBe('open_question is set');
    expect(describeMatch({ ...cfg.styles[0]!, match: [] })).toBe('every block');
  });

  test('orphanId reads the id quoted in the warning (UI27)', () => {
    expect(orphanId('Config has metadata for "n1", which is not in the diagram')).toBe('n1');
    expect(orphanId('Config lanes lists "_unassigned", which is never listed (it always shows last)')).toBe('_unassigned');
    expect(orphanId('Layout file pins "n-2", which is not in the diagram')).toBe('n-2');
    expect(orphanId('no id here')).toBeNull();
  });
});
