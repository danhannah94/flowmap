import { describe, expect, it } from 'vitest';
import { SHAPE_KINDS } from './types';
import { roundRadius, SHAPE_GEOMETRY } from './measure';
import { shapeGeometry, type Box } from './shapes';

const box: Box = { x: 10, y: 20, width: 160, height: 60 };

describe('shapeGeometry', () => {
  it('returns geometry for every shape kind', () => {
    for (const kind of SHAPE_KINDS) {
      const geometry = shapeGeometry(kind, box);
      expect(['rect', 'polygon', 'path']).toContain(geometry.outline.tag);
      expect(Array.isArray(geometry.decorations)).toBe(true);
    }
  });

  it('step is a plain rectangle spanning the box', () => {
    const { outline } = shapeGeometry('step', box);
    expect(outline).toMatchObject({ tag: 'rect', x: 10, y: 20, width: 160, height: 60 });
  });

  it('decision is a diamond with 4 points inscribed in the box', () => {
    const { outline } = shapeGeometry('decision', box);
    expect(outline.tag).toBe('polygon');
    if (outline.tag !== 'polygon') throw new Error('unreachable');
    const points = outline.points.split(' ').map((p) => p.split(',').map(Number));
    expect(points).toHaveLength(4);
    // Every point touches one of the box's edges (the diamond is inscribed).
    for (const [x, y] of points) {
      const onVerticalEdge = x === box.x || x === box.x + box.width;
      const onHorizontalEdge = y === box.y || y === box.y + box.height;
      expect(onVerticalEdge || onHorizontalEdge).toBe(true);
    }
  });

  it('terminal is a rounded rect with measure.ts\'s roundRadius: a stadium up to two lines, capped for taller boxes', () => {
    for (const height of [52, 56, 60, 78, 120]) {
      const { outline } = shapeGeometry('terminal', { ...box, height });
      expect(outline.tag).toBe('rect');
      if (outline.tag !== 'rect') throw new Error('unreachable');
      expect(outline.rx).toBe(roundRadius(height));
      expect(outline.ry).toBe(roundRadius(height));
    }
    // A true stadium at 56 px; capped at ROUND_MAX for a tall (multi-line) box, where the text area assumes it.
    expect((shapeGeometry('terminal', { ...box, height: 56 }).outline as { rx: number }).rx).toBe(28);
    expect((shapeGeometry('terminal', { ...box, height: 120 }).outline as { rx: number }).rx).toBe(SHAPE_GEOMETRY.roundMax);
  });

  it('subprocess is a rectangle with two vertical bar decorations', () => {
    const { outline, decorations } = shapeGeometry('subprocess', box);
    expect(outline.tag).toBe('rect');
    expect(decorations).toHaveLength(2);
    for (const decoration of decorations) expect(decoration.tag).toBe('path');
  });

  it('database is a cylinder path with a lid ellipse decoration', () => {
    const { outline, decorations } = shapeGeometry('database', box);
    expect(outline.tag).toBe('path');
    expect(decorations).toHaveLength(1);
    expect(decorations[0]!.tag).toBe('ellipse');
  });

  it('io is a parallelogram (polygon) skewed within the box', () => {
    const { outline } = shapeGeometry('io', box);
    expect(outline.tag).toBe('polygon');
    if (outline.tag !== 'polygon') throw new Error('unreachable');
    const points = outline.points.split(' ').map((p) => p.split(',').map(Number));
    expect(points).toHaveLength(4);
    // Top edge is shifted right relative to the bottom edge (a slant).
    const [top1, , , bottom1] = points as [number[], number[], number[], number[]];
    expect(top1[0]).toBeGreaterThan(bottom1[0]!);
  });

  it('document is a path whose bottom edge follows measure.ts\'s sine wave (touches the bottom at W/4)', () => {
    const { outline } = shapeGeometry('document', box);
    expect(outline.tag).toBe('path');
    if (outline.tag !== 'path') throw new Error('unreachable');
    // Sampled, not a smooth bezier, but it must trace the same curve textArea() assumes: dipping to
    // the full box height near x = W/4, and never exceeding it.
    const points = outline.d
      .split(/(?=[ML])/)
      .map((cmd) => cmd.trim().slice(1).replace(/Z$/, '').trim().split(',').map(Number))
      .filter((p) => p.length === 2 && p.every((v) => !Number.isNaN(v))) as [number, number][];
    const maxY = Math.max(...points.map(([, y]) => y));
    expect(maxY).toBeCloseTo(box.y + box.height, 0);
    const atQuarter = points.find((p) => Math.abs(p[0] - (box.x + box.width / 4)) < 1);
    expect(atQuarter).toBeDefined();
    expect(atQuarter![1]).toBeCloseTo(box.y + box.height, 0);
  });

  it('delay is a half-rounded rectangle (straight left edge, arced right edge)', () => {
    const { outline } = shapeGeometry('delay', box);
    expect(outline.tag).toBe('path');
    if (outline.tag !== 'path') throw new Error('unreachable');
    expect(outline.d).toMatch(/^M 10,20 L /); // starts at the box's top-left, straight left edge
    expect(outline.d).toMatch(/A /); // rounded right cap
  });

  it('delay rounds its right corners with measure.ts\'s roundRadius (capped for tall boxes)', () => {
    for (const height of [52, 60, 78, 120]) {
      const b = { ...box, height };
      const { outline } = shapeGeometry('delay', b);
      if (outline.tag !== 'path') throw new Error('unreachable');
      const r = roundRadius(height);
      const right = b.x + b.width;
      // Two corner arcs of radius r, joined by a straight right side from y + r to y + H - r.
      expect(outline.d).toBe(
        `M 10,20 L ${right - r},20 A ${r} ${r} 0 0 1 ${right},${20 + r} L ${right},${20 + height - r} `
          + `A ${r} ${r} 0 0 1 ${right - r},${20 + height} L 10,${20 + height} Z`,
      );
    }
  });

  it('is pure: same input produces the same output, and does not mutate the box', () => {
    const frozenBox = Object.freeze({ ...box });
    const first = shapeGeometry('step', frozenBox);
    const second = shapeGeometry('step', frozenBox);
    expect(first).toEqual(second);
  });
});
