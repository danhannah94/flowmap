// Emitter tests (the YAML text the UI writes). Named scratch.test.ts only because the file couldn't be renamed in the
// build sandbox; it is the emit.ts test file.
import { parseDocument } from 'yaml';
import { plainOk, renderDocument, renderInline, renderItemLines, renderPairLines, renderScalar } from './emit';

const js = (s: string) => parseDocument(s).toJS();
const js11 = (s: string) => parseDocument(s, { version: '1.1' }).toJS();

describe('scalar quoting (§4: quoted when a plain scalar would read back as another type)', () => {
  test.each(['2', '2.5', 'true', 'false', 'null', '~', '', ' x', 'x ', '0o12', '0x1f', '.inf', '1e3'])('quotes %j', (s) => {
    expect(plainOk(s)).toBe(false);
    expect(js(`k: ${renderScalar(s)}`)).toEqual({ k: s });
  });
  test.each(['yes', 'no', 'on', 'off', 'y', 'N', '2024-09-01', '1:20', '1_000'])('quotes YAML 1.1 special %j', (s) => {
    expect(plainOk(s)).toBe(false);
    expect(js11(`k: ${renderScalar(s)}`)).toEqual({ k: s });
    expect(js(`k: ${renderScalar(s)}`)).toEqual({ k: s });
  });
  test.each(['#fff', 'a: b', 'a #b', '- a', '[x]', '{x}', 'a, b', '*a', '&a', '!t', '%p', '@x', '`x', '"q"', "'q'", '? x', 'line\nbreak', 'tab\there', ' '])('quotes syntax-bearing %j', (s) => {
    expect(plainOk(s)).toBe(false);
    expect(js(`k: ${renderScalar(s)}`)).toEqual({ k: s });
    expect(js(`[${renderScalar(s)}]`)).toEqual([s]);
    expect(js11(`k: ${renderScalar(s)}`)).toEqual({ k: s });
  });
  test.each(['wait', 'single-source', 'Who chases the freight quote after two days?', 'sam-09-01', 'main plant', '$1,000 x'.slice(0, 2), 'e-mail'])('keeps plain %j', (s) => {
    expect(plainOk(s)).toBe(true);
    expect(renderScalar(s)).toBe(s);
  });
  test('non-strings', () => {
    expect(renderScalar(2)).toBe('2');
    expect(renderScalar(true)).toBe('true');
    expect(renderScalar(null)).toBe('null');
    expect(renderScalar(0.5)).toBe('0.5');
  });
});

describe('collections', () => {
  test('inline', () => {
    expect(renderInline(['a', 'b, c', '2'])).toBe('[a, "b, c", "2"]');
    expect(renderInline({ light: '#abc', dark: '#000' })).toBe('{light: "#abc", dark: "#000"}');
    expect(renderInline({})).toBe('{}');
    expect(renderInline([])).toBe('[]');
    expect(js(`k: ${renderInline({ 'a b': ['x', { y: 'z,w' }] })}`)).toEqual({ k: { 'a b': ['x', { y: 'z,w' }] } });
  });
  test('block pair: scalar lists flow, maps block, rule match/style flow', () => {
    expect(renderPairLines('source', ['a', 'b'], 4, ['nodes', 'n', 'source'])).toEqual(['    source: [a, b]']);
    expect(renderPairLines('v', { 'main plant': 'x' }, 2, ['nodes', 'n', 'v'])).toEqual(['  v:', '    main plant: x']);
    expect(renderItemLines({ match: {}, style: { fill: { light: '#abc' } } }, 2, ['styles', 0])).toEqual([
      '  - match: {}', '    style: {fill: {light: "#abc"}}',
    ]);
    const deep = { a: [{ b: 1, c: [1, 2] }, [3, { d: 'e' }]] };
    const text = renderPairLines('k', deep, 0, ['nodes', 'n', 'k']).join('\n');
    expect(js(text)).toEqual({ k: deep });
  });
  test('renderDocument round-trips', () => {
    const v = [{ legend: 'x', match: { a: '2' }, style: {} }, { match: {}, style: { badge: 'yes' } }];
    expect(js(renderDocument(v, ['styles']))).toEqual(v);
    expect(js(renderDocument({ a: 1, b: ['x'] }, ['nodes', 'n']))).toEqual({ a: 1, b: ['x'] });
  });
});
