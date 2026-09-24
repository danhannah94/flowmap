// Text measurement and node sizing, shared by layout (node sizes), SVG export and the UI (label wrapping), so that
// a label wraps identically everywhere (§6 L9). Owned by the layout module; the signatures below are the seam.
import type { ShapeKind } from './types';
import { INTER_13_RUNS } from './inter-widths';

/** The one label font. The UI bundles it (@fontsource/inter) so on-screen text matches these metrics. */
export const LABEL_FONT = { family: 'Inter', size: 13, lineHeight: 18, weight: 400 } as const;

/**
 * Shape geometry that the drawing code (SVG renderer, UI) and the text areas below agree on. Every shape fills its
 * box (the bounding rectangle, width W by height H, origin top-left):
 * - step: rectangle.
 * - subprocess: rectangle plus two vertical bars at x = BAR and x = W - BAR.
 * - terminal: stadium: a rectangle with corner radius R = min(H/2, ROUND_MAX) (a true stadium for one or two lines).
 * - decision: diamond through the four side midpoints (W/2,0) (W,H/2) (W/2,H) (0,H/2). W and H are always even.
 * - database: cylinder; the top cap is the ellipse centred (W/2, RY) with radii (W/2, RY); the bottom is the lower
 *   half of the ellipse centred (W/2, H-RY). The body's sides are x = 0 and x = W.
 * - io: parallelogram (SKEW,0) (W,0) (W-SKEW,H) (0,H).
 * - document: top and sides straight; the bottom edge is y = H - WAVE + WAVE * sin(2πx/W) (one period, amplitude
 *   WAVE), so it runs between H - 2·WAVE and H (touching the box bottom at x = W/4).
 * - delay: flat left side; the right end rounded with radius R = min(H/2, ROUND_MAX) at both corners (a half circle
 *   for one or two lines).
 */
export const SHAPE_GEOMETRY = {
  subprocessBar: 10,
  databaseRy: 8,
  ioSkew: 14,
  documentWave: 6,
  roundMax: 28,
} as const;

/** Corner radius of the terminal's ends and the delay's right end. */
export const roundRadius = (height: number): number => Math.min(height / 2, SHAPE_GEOMETRY.roundMax);

/** Safety margin applied to every measured width: real (kerned, shaped) text measured at most +2.2% over the
 * per-character sum in Chromium (scripts/gen-inter-widths.mjs), so 3% plus 1 px keeps the label inside its area. */
const WIDTH_FACTOR = 1.03;
const WIDTH_PAD = 1;
/** Width for a character Inter doesn't have (the browser falls back to another font). Deliberately generous. */
const FALLBACK_WIDTH = 13;
const FALLBACK_WIDE = 18; // astral plane: emoji and the like

const WIDTHS = new Map<number, number>();
for (const [start, ws] of INTER_13_RUNS) ws.forEach((w, i) => WIDTHS.set(start + i, w));

function charWidth(cp: number): number {
  const w = WIDTHS.get(cp);
  if (w !== undefined) return w;
  if (cp === 0x09) return WIDTHS.get(0x20)! * 4;
  if (cp < 0x20 || cp === 0x200b || cp === 0xfeff || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0; // controls, ZWSP, VS
  if (cp >= 0x300 && cp <= 0x36f) return 0; // combining marks
  return cp > 0xffff ? FALLBACK_WIDE : FALLBACK_WIDTH;
}

/** Width in px of `text` in LABEL_FONT. */
export function textWidth(text: string): number {
  if (text.length === 0) return 0;
  let sum = 0;
  for (const ch of text) sum += charWidth(ch.codePointAt(0)!);
  return Math.ceil(sum * WIDTH_FACTOR + WIDTH_PAD);
}

/** Split a word wider than maxWidth into pieces that fit (at least one character per piece). */
function splitWord(word: string, maxWidth: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of word) {
    if (cur && textWidth(cur + ch) > maxWidth) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Break a label into lines that each fit `maxWidth` px (words wrap; an over-long word is split). */
export function wrapLabel(label: string, maxWidth: number): string[] {
  const words = label.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    if (cur) {
      const joined = cur + ' ' + word;
      if (textWidth(joined) <= maxWidth) {
        cur = joined;
        continue;
      }
      lines.push(cur);
      cur = '';
    }
    if (textWidth(word) <= maxWidth) cur = word;
    else {
      const pieces = splitWord(word, maxWidth);
      lines.push(...pieces.slice(0, -1));
      cur = pieces[pieces.length - 1]!;
    }
  }
  lines.push(cur);
  return lines;
}

interface Sizing {
  /** Box width limits (multiples of 10). */
  minW: number;
  maxW: number;
  minH: number;
  /** Box width needed for a text block `tw` wide and `th` tall. */
  boxW: (tw: number, th: number) => number;
  /** Box height needed for `n` lines. */
  boxH: (n: number) => number;
}

const LH = LABEL_FONT.lineHeight;
const G = SHAPE_GEOMETRY;
/** Horizontal room a round end (radius r) takes from a text block `th` tall, plus 8 px air. */
/**
 * Horizontal room a round end of radius r takes from a text area whose top and bottom are 6 px inside the box, plus
 * 8 px of air: the area's corner is (r - 6) px from the arc's centre vertically, so the arc is at r - sqrt(r² - (r-6)²).
 */
const roundInset = (r: number) => Math.ceil(r - Math.sqrt(Math.max(0, r * r - Math.max(0, r - 6) ** 2))) + 8;
const even = (n: number) => Math.ceil(n / 2) * 2;
const DECISION_W = 0.58; // the diamond's text area is 58% of its width and 40% of its height (0.58 + 0.40 < 1)
const DECISION_H = 0.4;

const SIZING: Record<ShapeKind, Sizing> = {
  step: { minW: 120, maxW: 180, minH: 52, boxW: (tw) => tw + 24, boxH: (n) => LH * n + 16 },
  subprocess: { minW: 120, maxW: 200, minH: 52, boxW: (tw) => tw + 2 * G.subprocessBar + 20, boxH: (n) => LH * n + 16 },
  terminal: {
    minW: 120, maxW: 200, minH: 52,
    boxW: (tw, th) => tw + 2 * roundInset(roundRadius(Math.max(52, th + 12))),
    boxH: (n) => LH * n + 12,
  },
  decision: {
    minW: 120, maxW: 260, minH: 56,
    boxW: (tw) => (tw + 4) / DECISION_W,
    boxH: (n) => (LH * n + 2) / DECISION_H,
  },
  database: { minW: 120, maxW: 180, minH: 52, boxW: (tw) => tw + 24, boxH: (n) => LH * n + 2 * G.databaseRy + 4 + G.databaseRy + 4 },
  io: { minW: 120, maxW: 200, minH: 52, boxW: (tw) => tw + 2 * G.ioSkew + 20, boxH: (n) => LH * n + 16 },
  document: { minW: 120, maxW: 180, minH: 52, boxW: (tw) => tw + 24, boxH: (n) => LH * n + 8 + 2 * G.documentWave + 4 },
  delay: {
    minW: 120, maxW: 200, minH: 52,
    boxW: (tw, th) => 12 + tw + roundInset(roundRadius(Math.max(52, th + 12))),
    boxH: (n) => LH * n + 12,
  },
};

const sizeCache = new Map<string, { width: number; height: number }>();

/** Node box size (integers) for a label and shape, big enough that the wrapped label fits its text area. */
export function nodeSize(label: string, kind: ShapeKind): { width: number; height: number } {
  const key = kind + '\u0000' + label;
  const hit = sizeCache.get(key);
  if (hit) return { ...hit };
  const s = SIZING[kind];
  // The widest text the box may hold: the text area of a max-width, two-line box.
  const maxText = Math.max(40, textArea(kind, s.maxW, even(Math.max(s.minH, s.boxH(2)))).width);
  const n = wrapLabel(label, maxText).length;
  // Balance: the narrowest wrap width that still needs only n lines (greedy line count falls as width grows).
  let lo = 1;
  let hi = maxText;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (wrapLabel(label, mid).length <= n) hi = mid;
    else lo = mid + 1;
  }
  const lines = wrapLabel(label, lo);
  const tw = Math.max(...lines.map(textWidth));
  let height = even(Math.max(s.minH, Math.ceil(s.boxH(lines.length))));
  let width = Math.max(s.minW, Math.ceil(s.boxW(tw, LH * lines.length) / 10) * 10);
  // Round ends and the diamond depend on both sides: grow until the text area really holds the block.
  for (let guard = 0; guard < 200; guard++) {
    const a = textArea(kind, width, height);
    if (a.width >= tw && a.height >= LH * lines.length) break;
    if (a.width < tw) width += 10;
    if (a.height < LH * lines.length) height += 2;
  }
  const out = { width, height };
  if (sizeCache.size > 5000) sizeCache.clear();
  sizeCache.set(key, out);
  return { ...out };
}

/** The text area inside a node box of this size and shape, relative to the box's top-left (integers). */
export function textArea(kind: ShapeKind, width: number, height: number): { x: number; y: number; width: number; height: number } {
  const W = width;
  const H = height;
  const rect = (x: number, y: number, r: number, b: number) => ({
    x, y, width: Math.max(0, W - x - r), height: Math.max(0, H - y - b),
  });
  switch (kind) {
    case 'step':
      return rect(12, 8, 12, 8);
    case 'subprocess':
      return rect(G.subprocessBar + 10, 8, G.subprocessBar + 10, 8);
    case 'terminal': {
      const i = roundInset(roundRadius(H));
      return rect(i, 6, i, 6);
    }
    case 'delay': {
      const i = roundInset(roundRadius(H));
      return rect(12, 6, i, 6);
    }
    case 'database':
      return rect(12, 2 * G.databaseRy + 4, 12, G.databaseRy + 4);
    case 'io':
      return rect(G.ioSkew + 10, 8, G.ioSkew + 10, 8);
    case 'document':
      return rect(12, 8, 12, 2 * G.documentWave + 4);
    case 'decision': {
      const w = Math.floor(W * DECISION_W);
      const h = Math.floor(H * DECISION_H);
      return { x: Math.floor((W - w) / 2), y: Math.floor((H - h) / 2), width: w, height: h };
    }
  }
}

/** The style badge (§4 `badge`): a small tag in 10 px semibold Inter, 16 px tall, 6 px of padding each side. */
export const BADGE_FONT = { size: 10, weight: 600, height: 16, padX: 6 } as const;

/**
 * Where a node's badge goes, relative to the node box's top-left: a tag sitting on the top edge, towards the right,
 * whose bottom never comes below the top of the shape's text area. So the badge can never cover the label, whatever
 * the label's length or the shape, and it needs no room in the node's size (the layout ignores styles). It stands
 * out above the box by at most 10 px, which the layout's gaps (L3's 16 px and more) leave free.
 * - Round ends (terminal, delay): right-aligned where the round end starts, on the straight part of the top.
 * - Decision: just right of the top point, so an edge entering the point stays clear of it.
 * - Everything else: 10 px in from the right edge.
 */
export function badgeBox(kind: ShapeKind, width: number, height: number, text: string): { x: number; y: number; width: number; height: number } {
  const w = badgeWidth(text);
  const bottom = Math.min(textArea(kind, width, height).y, 6);
  const y = bottom - BADGE_FONT.height;
  let x: number;
  if (kind === 'decision') x = Math.round(width / 2) + 10;
  else if (kind === 'terminal' || kind === 'delay') x = Math.round(width - roundRadius(height)) - w;
  else x = width - 10 - w;
  return { x, y, width: w, height: BADGE_FONT.height };
}

/** Width of a badge tag: the text at 10/13 of the label font, with room for the heavier weight, plus padding. */
export function badgeWidth(text: string): number {
  return Math.ceil(textWidth(text) * (BADGE_FONT.size / LABEL_FONT.size) * 1.1) + 2 * BADGE_FONT.padX;
}

/** Longest line an edge label is allowed before it wraps. */
export const EDGE_LABEL_MAX = 140;

/** Lines of an edge label (edge labels wrap at EDGE_LABEL_MAX). */
export function edgeLabelLines(label: string): string[] {
  return wrapLabel(label, EDGE_LABEL_MAX);
}

/** The box an edge label occupies, centred on the layout's `label_pos` (integers, 4 px side padding). */
export function edgeLabelSize(label: string): { width: number; height: number } {
  const lines = edgeLabelLines(label);
  return { width: even(Math.max(...lines.map(textWidth)) + 8), height: LH * lines.length };
}

/**
 * How far inside the box (px) a shape's drawn outline is, at a point on the box boundary: `side` is which box side
 * and `t` the offset along it from the box's top-left (x for top/bottom, y for left/right). An edge ending on the box
 * boundary can be extended by this much so its arrow touches the outline (the parallelogram's slanted sides, round
 * ends, the cylinder's caps, the document's wave, the diamond's faces).
 */
export function outlineInset(kind: ShapeKind, width: number, height: number, side: 'top' | 'right' | 'bottom' | 'left', t: number): number {
  const W = width;
  const H = height;
  const round = (r: number, d: number) => r - Math.sqrt(Math.max(0, r * r - d * d));
  switch (kind) {
    case 'step':
    case 'subprocess':
      return 0;
    case 'terminal': {
      const R = roundRadius(H);
      if (side === 'left' || side === 'right') return round(R, Math.max(0, R - Math.min(t, H - t)));
      return round(R, Math.max(0, R - Math.min(t, W - t)));
    }
    case 'delay': {
      const R = roundRadius(H);
      if (side === 'right') return round(R, Math.max(0, R - Math.min(t, H - t)));
      if (side === 'left') return 0;
      return round(R, Math.max(0, t - (W - R)));
    }
    case 'io':
      if (side === 'left') return G.ioSkew * (1 - t / H);
      if (side === 'right') return (G.ioSkew * t) / H;
      if (side === 'top') return Math.max(0, G.ioSkew - t);
      return Math.max(0, t - (W - G.ioSkew));
    case 'database': {
      if (side === 'left' || side === 'right') return 0;
      const rx = W / 2;
      const dx = Math.min(1, Math.abs(t - rx) / rx);
      const bulge = G.databaseRy * Math.sqrt(1 - dx * dx);
      return G.databaseRy - bulge; // same on the top cap and the bottom curve
    }
    case 'document':
      if (side !== 'bottom') return 0;
      return G.documentWave - G.documentWave * Math.sin((2 * Math.PI * t) / W);
    case 'decision': {
      // Distance from the box side to the diamond face, measured perpendicular to the side.
      if (side === 'left' || side === 'right') return (W / 2) * Math.min(1, Math.abs(t - H / 2) / (H / 2));
      return (H / 2) * Math.min(1, Math.abs(t - W / 2) / (W / 2));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// v1.1: resizing (§5 sizes, §6 L4 and L9 "needs")

const needsCache = new Map<string, { minWidth: number; height: number }>();

/** Smallest box height whose text area is at least `textH` tall (the text area's height never depends on the width). */
function heightFor(kind: ShapeKind, width: number, textH: number): number {
  let h = Math.max(1, textH);
  while (textArea(kind, width, h).height < textH) h++;
  return h;
}

/** Does the label, wrapped at the text area's width, fit a box of this size? */
function fits(label: string, kind: ShapeKind, width: number, height: number): boolean {
  const a = textArea(kind, width, height);
  return a.width > 0 && wrapLabel(label, a.width).length * LH <= a.height;
}

/**
 * The height a label needs in a box `width` wide: the smallest height from which on every taller box holds the label,
 * wrapped at its text area's width (a stored height may be anything above the need, §5). Only round ends make the text
 * area's width depend on the height (narrower as the box gets taller, until the radius reaches ROUND_MAX at a height of
 * 2 × ROUND_MAX); from there on, fitting is monotone in the height.
 */
function neededHeight(label: string, kind: ShapeKind, width: number): number {
  const round = kind === 'terminal' || kind === 'delay';
  if (!round) {
    const tw = textArea(kind, width, 100000).width;
    return heightFor(kind, width, LH * (tw > 0 ? wrapLabel(label, tw).length : Math.max(1, label.length)));
  }
  // The smallest fixed point of h → the height the lines at h need (monotone, so iterating from below finds it) ...
  let h = heightFor(kind, width, LH);
  for (let guard = 0; guard < 100; guard++) {
    const tw = textArea(kind, width, h).width;
    const next = heightFor(kind, width, LH * (tw > 0 ? wrapLabel(label, tw).length : Math.max(1, label.length)));
    if (next <= h) break;
    h = next;
  }
  // ... then past any taller height that doesn't fit, up to where the radius stops growing.
  for (let H = h; H <= 2 * SHAPE_GEOMETRY.roundMax || !fits(label, kind, width, H); H++) {
    if (!fits(label, kind, width, H)) h = H + 1;
    if (H > 100000) break;
  }
  return h;
}

/** Width of the widest word of a label (0 for an empty label). */
function widestWord(label: string): number {
  let w = 0;
  for (const word of label.split(/\s+/)) if (word) w = Math.max(w, textWidth(word));
  return w;
}

/**
 * What a label needs (§6 L9, v1.1), for resizing (UI34) and for a stored size (§5):
 * - `minWidth`: the block's narrowest width, the one at which its longest word still fits on a line of the text area
 *   (at the height the label then needs), never less than 40;
 * - `height`: the height of the label wrapped at the text area of a box `width` wide (at least `minWidth`), plus the
 *   shape's insets.
 * Integers. The effective size of a block with a stored size is, per dimension, the larger of the two (`effectiveSize`).
 */
export function labelNeeds(label: string, kind: ShapeKind, width: number): { minWidth: number; height: number } {
  const w0 = Math.max(1, Math.ceil(width));
  const key = `${kind}\u0000${w0}\u0000${label}`;
  const hit = needsCache.get(key);
  if (hit) return { ...hit };
  const ww = widestWord(label);
  // The text area is at most as wide as the box. Only round ends make its width depend on the height, and a taller box
  // never has a wider one; a block may be made as tall as anyone likes, so the word must fit a very tall box too.
  let minWidth = Math.max(40, ww);
  while (textArea(kind, minWidth, 100000).width < ww) minWidth++;
  const out = { minWidth, height: neededHeight(label, kind, Math.max(w0, minWidth)) };
  if (needsCache.size > 20000) needsCache.clear();
  needsCache.set(key, out);
  return { ...out };
}

/**
 * A block's box size (§5): its automatic size (`nodeSize`) without a stored size; with one, per dimension the larger
 * of the stored size and what the label needs (the height need is taken at the effective width).
 */
export function effectiveSize(label: string, kind: ShapeKind, stored: { width: number; height: number } | null): { width: number; height: number } {
  if (!stored) return nodeSize(label, kind);
  const sw = Math.round(stored.width);
  const sh = Math.round(stored.height);
  const width = Math.max(sw, labelNeeds(label, kind, sw).minWidth);
  return { width, height: Math.max(sh, labelNeeds(label, kind, width).height) };
}

// ---------------------------------------------------------------------------------------------------------------
// v1.1: notes and the title (§4, §6 "Notes and title", §7)

/** The title's font (as drawn above the diagram by the UI and the SVG export). */
export const TITLE_FONT = { size: 20, lineHeight: 28, weight: 700 } as const;
/** Bold Inter runs about 6% wider than regular; used to size bold text from the regular metrics. */
const BOLD_FACTOR = 1.06;

/** Width in px of `text` in Inter at `size` px, regular or bold (scaled from the 13 px metrics, same safety margin). */
export function textWidthAt(text: string, size: number, bold: boolean): number {
  if (text.length === 0) return 0;
  let sum = 0;
  for (const ch of text) sum += charWidth(ch.codePointAt(0)!);
  return Math.ceil(sum * (size / LABEL_FONT.size) * (bold ? BOLD_FACTOR : 1) * WIDTH_FACTOR + WIDTH_PAD);
}

/** Line height of a note at a font size: 1.4 × the size, rounded (14 px text: 20 px lines). */
export function noteLineHeight(fontSize: number): number {
  return Math.round(fontSize * 1.4);
}

/** A note's lines: its text split at line breaks (a blank line counts). */
export function noteLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** A note's box: the width of its longest line and one line height per line (integers, at least 1 px wide). */
export function noteSize(text: string, fontSize: number, bold: boolean): { width: number; height: number } {
  const lines = noteLines(text);
  return {
    width: Math.max(1, ...lines.map((l) => textWidthAt(l, fontSize, bold))),
    height: lines.length * noteLineHeight(fontSize),
  };
}

/** The title's box: one line of TITLE_FONT (at least 1 px wide). */
export function titleSize(text: string): { width: number; height: number } {
  return { width: Math.max(1, textWidthAt(text, TITLE_FONT.size, true)), height: TITLE_FONT.lineHeight };
}
