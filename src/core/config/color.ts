// Colour helpers (§4 colours, §7.1 SVG colours are lowercase #rrggbb).
import type { ThemedColor } from '../types';

export type Theme = 'light' | 'dark';

const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** `#rgb` or `#rrggbb` (either case). */
export function isValidColor(s: unknown): s is string {
  return typeof s === 'string' && COLOR_RE.test(s);
}

/** Lowercase `#rrggbb` (`#F96` becomes `#ff9966`). Throws on an invalid colour. */
export function normalizeColor(s: string): string {
  if (!isValidColor(s)) throw new Error(`not a colour: ${s}`);
  const hex = s.slice(1).toLowerCase();
  return '#' + (hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex);
}

/** Two colours are the same colour (`#FFF` equals `#ffffff`). */
export function sameColor(a: string, b: string): boolean {
  return isValidColor(a) && isValidColor(b) && normalizeColor(a) === normalizeColor(b);
}

/**
 * The colour to draw in `theme`, as lowercase `#rrggbb`, or undefined for the theme default. A `{light, dark}` colour
 * with no `dark` uses `light` in both themes.
 */
export function colorForTheme(c: ThemedColor | undefined, theme: Theme): string | undefined {
  if (c === undefined) return undefined;
  const v = typeof c === 'string' ? c : theme === 'dark' ? (c.dark ?? c.light) : c.light;
  return v !== undefined && isValidColor(v) ? normalizeColor(v) : undefined;
}
