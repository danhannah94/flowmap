import { describe, expect, it } from 'vitest';
import { darkTheme, getTheme, lightTheme, normalizeHexColor, resolveStyle } from './theme';
import type { ResolvedStyle } from './types';

describe('getTheme', () => {
  it('returns the matching palette', () => {
    expect(getTheme('light')).toBe(lightTheme);
    expect(getTheme('dark')).toBe(darkTheme);
  });

  it('both themes define every required colour with enough contrast to read', () => {
    for (const theme of [lightTheme, darkTheme]) {
      for (const value of [
        theme.canvasBackground,
        theme.laneFill[0],
        theme.laneFill[1],
        theme.laneBorder,
        theme.laneLabel,
        theme.titleColor,
        theme.nodeFill,
        theme.nodeBorder,
        theme.nodeText,
        theme.edgeColor,
        theme.edgeLabelText,
        theme.edgeLabelBackground,
        theme.badgeFill,
        theme.badgeText,
        theme.legendText,
      ]) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/);
      }
      // The two lane bands must actually alternate.
      expect(theme.laneFill[0]).not.toBe(theme.laneFill[1]);
    }
    // Canvas and node text must not be identical between the two themes (that would mean dark mode
    // was never actually designed for).
    expect(lightTheme.canvasBackground).not.toBe(darkTheme.canvasBackground);
    expect(lightTheme.nodeText).not.toBe(darkTheme.nodeText);
  });
});

describe('normalizeHexColor', () => {
  it('lowercases and expands #rgb to #rrggbb', () => {
    expect(normalizeHexColor('#F96')).toBe('#ff9966');
    expect(normalizeHexColor('#ABCDEF')).toBe('#abcdef');
    expect(normalizeHexColor('#abcdef')).toBe('#abcdef');
  });
});

describe('resolveStyle', () => {
  it('falls back to the theme defaults when no style is given', () => {
    const resolved = resolveStyle(undefined, lightTheme);
    expect(resolved.fill).toBe(lightTheme.nodeFill);
    expect(resolved.stroke).toBe(lightTheme.nodeBorder);
    expect(resolved.textColor).toBe(lightTheme.nodeText);
    expect(resolved.dasharray).toBeNull();
    expect(resolved.fontStyle).toBe('normal');
    expect(resolved.fontWeight).toBe('normal');
    expect(resolved.badge).toBeUndefined();
  });

  it('maps border_style to the §7.1 dasharrays', () => {
    expect(resolveStyle({ border_style: 'solid' }, lightTheme).dasharray).toBeNull();
    expect(resolveStyle({ border_style: 'dashed' }, lightTheme).dasharray).toBe('6 4');
    expect(resolveStyle({ border_style: 'dotted' }, lightTheme).dasharray).toBe('2 3');
  });

  it('maps font_style to italic/bold independently, and normal to neither', () => {
    expect(resolveStyle({ font_style: 'italic' }, lightTheme)).toMatchObject({ fontStyle: 'italic', fontWeight: 'normal' });
    expect(resolveStyle({ font_style: 'bold' }, lightTheme)).toMatchObject({ fontStyle: 'normal', fontWeight: 'bold' });
    expect(resolveStyle({ font_style: 'normal' }, lightTheme)).toMatchObject({ fontStyle: 'normal', fontWeight: 'normal' });
  });

  it('carries border_width and badge through unchanged', () => {
    const resolved = resolveStyle({ border_width: 3, badge: 'wait' }, lightTheme);
    expect(resolved.strokeWidth).toBe(3);
    expect(resolved.badge).toBe('wait');
  });

  it('resolves a themed colour ({light, dark}) to the value for the given theme, normalised', () => {
    const style: ResolvedStyle = { fill: { light: '#FFF2CC', dark: '#4a3f12' } };
    expect(resolveStyle(style, lightTheme).fill).toBe('#fff2cc');
    expect(resolveStyle(style, darkTheme).fill).toBe('#4a3f12');
  });

  it('resolves a plain string colour the same in both themes', () => {
    const style: ResolvedStyle = { border_color: '#b85450' };
    expect(resolveStyle(style, lightTheme).stroke).toBe('#b85450');
    expect(resolveStyle(style, darkTheme).stroke).toBe('#b85450');
  });

  it('normalises #rgb shorthand for every colour property', () => {
    const style: ResolvedStyle = { fill: '#f96', border_color: '#0a0', text_color: '#abc' };
    const resolved = resolveStyle(style, lightTheme);
    expect(resolved.fill).toBe('#ff9966');
    expect(resolved.stroke).toBe('#00aa00');
    expect(resolved.textColor).toBe('#aabbcc');
  });
});
