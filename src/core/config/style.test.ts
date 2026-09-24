import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  colorForTheme, diagramTitle, effectiveKind, fieldSuggestions, isValidColor, laneOrder, legend, normalizeColor,
  parseConfig, resolveStyle, sameColor, type NodeFieldsInput,
} from './index';

const cfg = (text: string) => {
  const r = parseConfig(text);
  if (!r.config) throw new Error(JSON.stringify(r.problems));
  return r.config;
};
const node = (id: string, over: Partial<NodeFieldsInput> = {}): NodeFieldsInput => ({
  id, lane: 'l1', label: 'Label', kind: 'step', ...over,
});

describe('effectiveKind', () => {
  test('metadata kind overrides the shape kind; otherwise the shape kind', () => {
    expect(effectiveKind('document', { kind: 'wait' })).toBe('wait');
    expect(effectiveKind('step', { kind: 2 })).toBe('2');
    expect(effectiveKind('decision', {})).toBe('decision');
    expect(effectiveKind('decision', undefined)).toBe('decision');
    expect(effectiveKind('decision', { kind: null })).toBe('decision');
    expect(effectiveKind('decision', { kind: ['a'] })).toBe('decision');
  });
});

describe('resolveStyle (§4 match semantics)', () => {
  const c = cfg(`styles:
  - match: {}
    style: {fill: "#111"}
  - match: {confidence: confirmed}
    style: {border_style: solid, border_width: 2}
  - match: {confidence: single-source, system: erp}
    style: {border_style: dashed}
  - match: {n: 2}
    style: {badge: two}
  - match: {flag: "true"}
    style: {badge: flag}
  - match: {source: pat}
    style: {text_color: "#222"}
  - match: {open_question: present}
    style: {border_color: "#333"}
  - match: {quote: absent}
    style: {font_style: italic}
  - match: {kind: wait}
    style: {fill: {light: "#fff2cc", dark: "#4a3f12"}}
  - match: {kind: decision}
    style: {font_style: bold}
  - match: {id: special, lane: l2, label: Hello}
    style: {badge: special}
  - match: {confidence: confirmed}
    style: {border_width: 3}
nodes:
  a: {confidence: confirmed, quote: q}
  b: {confidence: single-source, system: erp, quote: q}
  c: {confidence: single-source, system: excel, quote: q}
  d: {n: "2", quote: q}
  e: {n: 2, flag: true, quote: q}
  f: {source: [lee, pat], quote: q}
  g: {open_question: null, quote: q}
  h: {kind: wait, quote: q}
  i: {quote: q, variants: {a: b}}
  special: {quote: q}
`);
  test('empty match applies to all; later rules override earlier properties', () => {
    expect(resolveStyle(c, node('a'))).toEqual({ fill: '#111111', border_style: 'solid', border_width: 3 });
  });
  test('AND across keys', () => {
    expect(resolveStyle(c, node('b')).border_style).toBe('dashed');
    expect(resolveStyle(c, node('c')).border_style).toBeUndefined();
  });
  test('values compare as strings', () => {
    expect(resolveStyle(c, node('d')).badge).toBe('two');
    expect(resolveStyle(c, node('e')).badge).toBe('flag');
  });
  test('list fields match when they contain the value', () => {
    expect(resolveStyle(c, node('f')).text_color).toBe('#222222');
  });
  test('present / absent test existence (a null value is present)', () => {
    expect(resolveStyle(c, node('g')).border_color).toBe('#333333');
    expect(resolveStyle(c, node('a')).border_color).toBeUndefined();
    expect(resolveStyle(c, node('nometa')).font_style).toBe('italic');
    expect(resolveStyle(c, node('a')).font_style).toBeUndefined();
  });
  test('kind is the effective kind in a match', () => {
    expect(resolveStyle(c, node('h', { kind: 'document' })).fill).toEqual({ light: '#fff2cc', dark: '#4a3f12' });
    expect(resolveStyle(c, node('a', { kind: 'decision' })).font_style).toBe('bold');
    expect(resolveStyle(c, node('h', { kind: 'decision' })).font_style).toBeUndefined();
  });
  test('id, lane and label are matchable', () => {
    expect(resolveStyle(c, node('special', { lane: 'l2', label: 'Hello' })).badge).toBe('special');
    expect(resolveStyle(c, node('special', { lane: 'l1', label: 'Hello' })).badge).toBeUndefined();
  });
  test('a map field never equals a value', () => {
    expect(resolveStyle(c, node('i')).badge).toBeUndefined();
  });
  test('no config / broken config: default style', () => {
    expect(resolveStyle(null, node('a'))).toEqual({});
  });
  test('bad properties do not override earlier good ones', () => {
    const c2 = cfg('styles:\n  - match: {}\n    style: {border_width: 2}\n  - match: {}\n    style: {border_width: 9}\n');
    expect(resolveStyle(c2, node('x'))).toEqual({ border_width: 2 });
  });
  test('purchase-request: v01 (document, kind wait) gets the waiting style', () => {
    const pr = cfg(readFileSync(join(__dirname, '../../../fixtures/purchase-request/purchase-request.flow.yaml'), 'utf8'));
    expect(resolveStyle(pr, node('v01', { kind: 'document' }))).toEqual({
      border_style: 'solid', border_width: 2, fill: { light: '#fff2cc', dark: '#4a3f12' }, badge: 'wait',
    });
    expect(resolveStyle(pr, node('p04'))).toEqual({
      border_style: 'dashed', border_width: 1, border_color: { light: '#b85450', dark: '#f08080' },
    });
  });
});

describe('legend', () => {
  test('rules with legend text, in rule order, with their own style', () => {
    const c = cfg(`styles:
  - {legend: One, match: {a: b}, style: {border_style: dashed}}
  - {match: {}, style: {fill: "#000"}}
  - {legend: "", match: {}, style: {}}
  - {legend: 3, match: {}, style: {fill: "#abc", glow: 1}}
`);
    expect(legend(c)).toEqual([
      { text: 'One', style: { border_style: 'dashed' } },
      { text: '3', style: { fill: '#aabbcc' } },
    ]);
    expect(legend(null)).toEqual([]);
  });
});

describe('colours', () => {
  test('validate, normalise, compare', () => {
    expect(isValidColor('#abc')).toBe(true);
    expect(isValidColor('#ABCDEF')).toBe(true);
    expect(isValidColor('red')).toBe(false);
    expect(isValidColor('#abcd')).toBe(false);
    expect(isValidColor('abc')).toBe(false);
    expect(normalizeColor('#F96')).toBe('#ff9966');
    expect(normalizeColor('#AbCdEf')).toBe('#abcdef');
    expect(sameColor('#fff', '#FFFFFF')).toBe(true);
    expect(sameColor('#fff', '#fffffe')).toBe(false);
  });
  test('pick per theme; a light-only colour serves both themes', () => {
    expect(colorForTheme('#F96', 'dark')).toBe('#ff9966');
    expect(colorForTheme({ light: '#111', dark: '#222' }, 'light')).toBe('#111111');
    expect(colorForTheme({ light: '#111', dark: '#222' }, 'dark')).toBe('#222222');
    expect(colorForTheme({ light: '#111' }, 'dark')).toBe('#111111');
    expect(colorForTheme({ dark: '#222' }, 'light')).toBeUndefined();
    expect(colorForTheme(undefined, 'light')).toBeUndefined();
  });
});

describe('title, lane order, suggestions', () => {
  test('title: config title, else the .mmd base name', () => {
    expect(diagramTitle(cfg('title: My map\n'), 'x.mmd')).toBe('My map');
    expect(diagramTitle(cfg('version: 1\n'), 'diagrams/purchase-request.mmd')).toBe('purchase-request');
    expect(diagramTitle(null, 'purchase-request')).toBe('purchase-request');
    expect(diagramTitle(cfg('title: ""\n'), 'a.mmd')).toBe('a');
    expect(diagramTitle(cfg('title: 2024\n'), 'a.mmd')).toBe('2024');
  });
  test('lane order: config order first, then file order; unknown and _unassigned ignored', () => {
    const c = cfg('lanes: [{id: c}, {id: gone}, {id: a}, {id: _unassigned}, {id: c}]\n');
    expect(laneOrder(c, ['a', 'b', 'c', 'd'])).toEqual(['c', 'a', 'b', 'd']);
    expect(laneOrder(null, ['a', 'b'])).toEqual(['a', 'b']);
  });
  test('field suggestions: rule values then node values, deduplicated', () => {
    const c = cfg(`styles:
  - {match: {confidence: confirmed}, style: {}}
  - {match: {confidence: present}, style: {}}
  - {match: {confidence: inferred, system: erp}, style: {}}
nodes:
  a: {confidence: single-source, source: [x, y]}
  b: {confidence: confirmed, source: [y, z]}
`);
    expect(fieldSuggestions(c, 'confidence')).toEqual(['confirmed', 'inferred', 'single-source']);
    expect(fieldSuggestions(c, 'source')).toEqual(['x', 'y', 'z']);
    expect(fieldSuggestions(c, 'source', 'a')).toEqual(['y', 'z']);
  });
});
