// The glyph library (A20): small line icons for the built-in presets, drawn here from scratch (no vendor artwork).
// Each glyph is a few SVG path strings on a 24 x 24 grid, meant to be stroked (never filled) in one colour with round
// caps and joins at width 2. Stroke-only means one colour does it: the renderer uses the block's text colour, which
// already contrasts with the block's fill in both themes. Pure data, so the editor and the SVG export draw the same
// thing with no network and no icon font.

/** The grid every glyph is drawn on, and the stroke width on that grid. */
export const GLYPH_GRID = 24;
export const GLYPH_STROKE = 2;

const circle = (cx: number, cy: number, r: number): string =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  // `{ }`: code that runs on demand.
  function: [
    'M9 4C7 4 6 5 6 7v3c0 1.2-.8 2-2 2 1.2 0 2 .8 2 2v3c0 2 1 3 3 3',
    'M15 4c2 0 3 1 3 3v3c0 1.2.8 2 2 2-1.2 0-2 .8-2 2v3c0 2-1 3-3 3',
  ],
  // Two stacked server units with their indicator dashes.
  service: [
    'M5 4h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
    'M5 13h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z',
    'M8 7.5h3',
    'M8 16.5h3',
  ],
  // A bucket: a lid ellipse over tapering sides.
  'object-storage': [
    'M4 6.5a8 2.5 0 1 0 16 0a8 2.5 0 1 0-16 0',
    'M4 6.5l2 11.5c.2 1.4 2.8 2.5 6 2.5s5.8-1.1 6-2.5l2-11.5',
  ],
  // A cylinder with a band.
  database: [
    'M4 6a8 3 0 1 0 16 0a8 3 0 1 0-16 0',
    'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6',
    'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  ],
  // A bolt: fast.
  cache: ['M13 2.5L5 13.5h6l-1 8 8-11h-6z'],
  // Waiting messages and the arrow they leave by.
  queue: [
    'M2.5 6.5h5v11h-5z',
    'M9.5 6.5h5v11h-5z',
    'M16.5 12h5',
    'M19 9.5l2.5 2.5-2.5 2.5',
  ],
  // A source broadcasting to every listener.
  topic: [
    circle(12, 12, 2),
    'M7.8 7.8a6 6 0 0 0 0 8.4',
    'M16.2 7.8a6 6 0 0 1 0 8.4',
    'M4.9 4.9a10 10 0 0 0 0 14.2',
    'M19.1 4.9a10 10 0 0 1 0 14.2',
  ],
  // A doorway with the way in: `[ -> ]`.
  'api-gateway': [
    'M4 4v16',
    'M20 4v16',
    'M8 12h8',
    'M13 8l4 4-4 4',
  ],
  // One way in, three ways out.
  'load-balancer': [
    'M3 12h5',
    'M8 12l9-6',
    'M8 12h9',
    'M8 12l9 6',
    circle(19, 6, 2),
    circle(19, 12, 2),
    circle(19, 18, 2),
  ],
  // A globe.
  cdn: [
    circle(12, 12, 9),
    'M3 12h18',
    'M12 3c2.6 2.7 4 5.7 4 9s-1.4 6.3-4 9c-2.6-2.7-4-5.7-4-9s1.4-6.3 4-9z',
  ],
  // A box with an arrow leaving it.
  'external-service': [
    'M14 4h6v6',
    'M20 4l-9 9',
    'M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4',
  ],
  // A head and shoulders.
  user: [
    circle(12, 8, 4),
    'M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7',
  ],
  // A shield with a tick.
  identity: [
    'M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z',
    'M8.5 12l2.5 2.5 4.5-5',
  ],
  // A clock.
  scheduler: [
    circle(12, 12, 9),
    'M12 7v5l3.5 2',
  ],
  // Axes and a trend line.
  monitoring: [
    'M3 3v18h18',
    'M7 15l4-5 3 3 5-7',
  ],
};

export function glyphNames(): string[] {
  return Object.keys(GLYPHS);
}

export function hasGlyph(name: string): boolean {
  return Object.hasOwn(GLYPHS, name);
}

/** Path data a pack may carry: path commands, numbers and separators only, so a pack can never inject markup. */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]+$/;
export const MAX_PATHS = 12;
export const MAX_PATH_LENGTH = 600;

export function isSafePathData(d: unknown): d is string {
  return typeof d === 'string' && d.length > 0 && d.length <= MAX_PATH_LENGTH && PATH_DATA.test(d);
}
