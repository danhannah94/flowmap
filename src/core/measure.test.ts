import { describe, expect, it } from 'vitest';
import { SHAPE_KINDS } from './types';
import { textWidth, wrapLabel, nodeSize, textArea, edgeLabelSize, outlineInset, LABEL_FONT } from './measure';
import { rng } from './layout/testkit';

// Real widths of whole strings (kerned, shaped) in headless Chromium with the bundled Inter 400 13px, from
// `node scripts/gen-inter-widths.mjs`. textWidth must never be below them, and not wastefully above.
const CHROMIUM: [string, number][] = [
  ['Approved?', 66.36],
  ['Budget available?', 108.2],
  ['Match the invoice to the PO and the receipt', 265.47],
  ['WWWWWWWWWW', 130.95],
  ['iiiiiiiiii', 31.48],
  ['The quick brown fox jumps over the lazy dog', 276.11],
  ['Ärger über Öl – naïve café résumé', 209.14],
  ['Привет мир', 75.61],
  ['ffi fl ff 1/2 3x4 10:30 a.m.', 153.86],
];

describe('textWidth', () => {
  it.each(CHROMIUM)('%s is at least its real width, within 6%% + 2px', (s, real) => {
    const w = textWidth(s);
    expect(Number.isInteger(w)).toBe(true);
    expect(w).toBeGreaterThanOrEqual(real);
    expect(w).toBeLessThanOrEqual(real * 1.06 + 2);
  });
  it('is 0 for the empty string and monotonic in length', () => {
    expect(textWidth('')).toBe(0);
    expect(textWidth('ab')).toBeGreaterThan(textWidth('a'));
  });
  it('uses a generous fallback for characters Inter lacks', () => {
    expect(textWidth('漢字')).toBeGreaterThanOrEqual(26);
    expect(textWidth('🙂')).toBeGreaterThanOrEqual(16);
  });
});

describe('wrapLabel', () => {
  it('wraps words greedily and keeps every line within the width', () => {
    const lines = wrapLabel('Match the invoice to the PO and the receipt', 150);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(150);
    expect(lines.join(' ')).toBe('Match the invoice to the PO and the receipt');
  });
  it('splits a word longer than the width', () => {
    const lines = wrapLabel('Supercalifragilisticexpialidocious', 60);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join('')).toBe('Supercalifragilisticexpialidocious');
    for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(60);
  });
  it('collapses whitespace and handles empty labels', () => {
    expect(wrapLabel('  a   b  ', 500)).toEqual(['a b']);
    expect(wrapLabel('', 100)).toEqual(['']);
  });
  it('keeps one line when it fits', () => {
    expect(wrapLabel('Approved?', 200)).toEqual(['Approved?']);
  });
});

describe('nodeSize and textArea', () => {
  const r = rng(42);
  const words = 'a an the check purchase request form approve Supercalifragilistic vendor $1,000 PO #35 "quoted" Ärger Привет 漢字 x'.split(' ');
  const labels = ['Approved?', 'Match the invoice to the PO and the receipt', 'x', 'New step', ''];
  for (let k = 0; k < 150; k++) {
    const n = 1 + Math.floor(r() * 20);
    labels.push(Array.from({ length: n }, () => words[Math.floor(r() * words.length)]).join(' '));
  }

  it.each(SHAPE_KINDS)('%s: integer sizes, and the wrapped label fits the text area', (kind) => {
    for (const label of labels) {
      const { width, height } = nodeSize(label, kind);
      expect(Number.isInteger(width) && Number.isInteger(height)).toBe(true);
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
      expect(width).toBeGreaterThanOrEqual(120);
      expect(width).toBeLessThanOrEqual(kind === 'decision' ? 360 : 260);
      const a = textArea(kind, width, height);
      for (const v of [a.x, a.y, a.width, a.height]) expect(Number.isInteger(v)).toBe(true);
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.x + a.width).toBeLessThanOrEqual(width);
      expect(a.y + a.height).toBeLessThanOrEqual(height);
      // The renderer wraps at the text area's width: every line fits, and the block fits its height.
      const lines = wrapLabel(label, a.width);
      for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(a.width);
      expect(lines.length * LABEL_FONT.lineHeight).toBeLessThanOrEqual(a.height);
    }
  });

  it('keeps boxes readable: short labels are one line, long ones wrap instead of growing wide', () => {
    expect(nodeSize('Approved?', 'decision')).toEqual({ width: 130, height: 56 });
    expect(nodeSize('Review the request', 'step')).toEqual({ width: 150, height: 52 });
    const long = nodeSize('Match the invoice to the PO and the receipt', 'step');
    expect(long.width).toBeLessThanOrEqual(180);
    expect(long.height).toBe(52); // two lines
  });

  it('puts the diamond text area inside the diamond', () => {
    for (const label of labels) {
      const { width: W, height: H } = nodeSize(label, 'decision');
      const a = textArea('decision', W, H);
      for (const [x, y] of [[a.x, a.y], [a.x + a.width, a.y], [a.x, a.y + a.height], [a.x + a.width, a.y + a.height]] as const) {
        expect(Math.abs(x - W / 2) / (W / 2) + Math.abs(y - H / 2) / (H / 2)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps round ends and slanted sides clear of the text', () => {
    for (const label of labels.slice(0, 40)) {
      for (const kind of ['terminal', 'delay', 'io'] as const) {
        const { width: W, height: H } = nodeSize(label, kind);
        const a = textArea(kind, W, H);
        // At the text's top and bottom rows, the outline is left of / right of the text area.
        for (const y of [a.y, a.y + a.height]) {
          expect(outlineInset(kind, W, H, 'left', y)).toBeLessThanOrEqual(a.x);
          expect(W - outlineInset(kind, W, H, 'right', y)).toBeGreaterThanOrEqual(a.x + a.width);
        }
      }
    }
  });

  it('sizes edge labels', () => {
    const s = edgeLabelSize('yes');
    expect(s.height).toBe(18);
    expect(s.width).toBeGreaterThanOrEqual(textWidth('yes') + 8);
    expect(edgeLabelSize('a much longer edge label that has to wrap somewhere').height).toBeGreaterThan(18);
  });
});
