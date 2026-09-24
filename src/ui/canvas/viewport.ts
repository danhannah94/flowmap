// Screen <-> world (layout) coordinates. World coordinates are exactly the layout's (§7 layout JSON, U9): the canvas
// draws the diagram at world (0, 0) and applies one CSS transform `translate(x, y) scale(zoom)` for pan and zoom.
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** A point relative to the canvas element's top-left, in world coordinates. */
export function toWorld(v: Viewport, p: Point): Point {
  return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
}

export function toScreen(v: Viewport, p: Point): Point {
  return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
}

/** Zoom by `factor`, keeping the screen point `c` fixed. */
export function zoomAround(v: Viewport, factor: number, c: Point): Viewport {
  const zoom = clampZoom(v.zoom * factor);
  const k = zoom / v.zoom;
  return { zoom, x: c.x - (c.x - v.x) * k, y: c.y - (c.y - v.y) * k };
}

/** The viewport that shows `bounds` whole, centred, with a margin; never zoomed in past 100%. */
export function fitViewport(bounds: Rect, size: { width: number; height: number }, margin = 48): Viewport {
  const zw = (size.width - margin * 2) / Math.max(1, bounds.width);
  const zh = (size.height - margin * 2) / Math.max(1, bounds.height);
  const zoom = clampZoom(Math.min(1, zw, zh));
  return {
    zoom,
    x: (size.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (size.height - bounds.height * zoom) / 2 - bounds.y * zoom,
  };
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function containsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}
