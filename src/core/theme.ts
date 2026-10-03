// Light and dark palettes (design.md §4, §7.1) and the helper that turns a config style rule (a
// ResolvedStyle, already produced by rule matching in the config module) into concrete SVG values:
// lowercase #rrggbb colours, dasharray, stroke width, font style/weight. No fs, no DOM.
import type { ResolvedStyle, ThemedColor } from './types';

export type ThemeName = 'light' | 'dark';

export interface Theme {
  name: ThemeName;
  /** Overall canvas fill. */
  canvasBackground: string;
  /** Alternating lane band fills, subtle relative to canvasBackground. */
  laneFill: [string, string];
  laneBorder: string;
  laneLabel: string;
  /** A19: a group's box (a box inside a lane): a fill a step off the lane bands, and its outline. */
  groupFill: string;
  groupBorder: string;
  titleColor: string;
  /** Defaults for a node with no matching style rule. */
  nodeFill: string;
  nodeBorder: string;
  nodeText: string;
  edgeColor: string;
  edgeLabelText: string;
  /** Small background behind an edge label so it reads over the line it sits on. */
  edgeLabelBackground: string;
  badgeFill: string;
  badgeText: string;
  legendText: string;
}

export const lightTheme: Theme = {
  name: 'light',
  canvasBackground: '#ffffff',
  laneFill: ['#f8fafc', '#eef1f6'],
  laneBorder: '#d9dfe6',
  laneLabel: '#334155',
  groupFill: '#ffffff',
  groupBorder: '#a3b1c2',
  titleColor: '#0f172a',
  nodeFill: '#ffffff',
  nodeBorder: '#475569',
  nodeText: '#0f172a',
  edgeColor: '#64748b',
  edgeLabelText: '#334155',
  edgeLabelBackground: '#ffffff',
  badgeFill: '#eef2ff',
  badgeText: '#3730a3',
  legendText: '#0f172a',
};

export const darkTheme: Theme = {
  name: 'dark',
  canvasBackground: '#0f172a',
  laneFill: ['#111c2e', '#16233a'],
  laneBorder: '#2c3b52',
  laneLabel: '#cbd5e1',
  groupFill: '#1a2840',
  groupBorder: '#3e5272',
  titleColor: '#f1f5f9',
  nodeFill: '#1e293b',
  nodeBorder: '#94a3b8',
  nodeText: '#f1f5f9',
  edgeColor: '#94a3b8',
  edgeLabelText: '#e2e8f0',
  edgeLabelBackground: '#0f172a',
  badgeFill: '#3730a3',
  badgeText: '#e0e7ff',
  legendText: '#f1f5f9',
};

export function getTheme(name: ThemeName): Theme {
  return name === 'dark' ? darkTheme : lightTheme;
}

/** Default stroke weight for a node with no `border_width` rule (config values are integers 1-4; see §4). */
const DEFAULT_BORDER_WIDTH = 1.5;

/** Dash patterns per design.md §7.1: absent/`none` for solid, `6 4` dashed, `2 3` dotted. */
const DASH: Record<'solid' | 'dashed' | 'dotted', string | null> = {
  solid: null,
  dashed: '6 4',
  dotted: '2 3',
};

export interface ResolvedNodeStyle {
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** null means solid: the caller should omit the `stroke-dasharray` attribute entirely. */
  dasharray: string | null;
  textColor: string;
  fontStyle: 'normal' | 'italic';
  fontWeight: 'normal' | 'bold';
  badge?: string;
}

/** Normalise a config colour to lowercase `#rrggbb` (`#f96` -> `#ff9966`), per §7.1. */
export function normalizeHexColor(input: string): string {
  const hex = input.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex);
  if (short) {
    const [, r, g, b] = short;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return hex;
}

function pickColor(color: ThemedColor | undefined, themeName: ThemeName, fallback: string): string {
  if (color === undefined) return fallback;
  if (typeof color === 'string') return normalizeHexColor(color);
  const value = color[themeName] ?? color.light ?? color.dark;
  return value === undefined ? fallback : normalizeHexColor(value);
}

/** Resolve one node's (or one legend swatch's) style against a theme (§4 style properties -> §7.1 SVG values). */
export function resolveStyle(style: ResolvedStyle | undefined, theme: Theme): ResolvedNodeStyle {
  const fontStyleValue = style?.font_style;
  return {
    fill: pickColor(style?.fill, theme.name, theme.nodeFill),
    stroke: pickColor(style?.border_color, theme.name, theme.nodeBorder),
    strokeWidth: style?.border_width ?? DEFAULT_BORDER_WIDTH,
    dasharray: DASH[style?.border_style ?? 'solid'],
    textColor: pickColor(style?.text_color, theme.name, theme.nodeText),
    fontStyle: fontStyleValue === 'italic' ? 'italic' : 'normal',
    fontWeight: fontStyleValue === 'bold' ? 'bold' : 'normal',
    badge: style?.badge,
  };
}
