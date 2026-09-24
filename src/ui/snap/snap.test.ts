// UI39 snapping, the pure part: which lines snap, the screen-px threshold, tie-breaks, Alt, points and bare lines.
import { describe, expect, it } from 'vitest';
import { linesOf, snap, SNAP_DISTANCE } from './snap';

const box = (x: number, y: number, width = 100, height = 50) => ({ x, y, width, height });

describe('snap (UI39)', () => {
  it('snaps an edge within 6 screen px to the same edge of a target, per axis on its own', () => {
    // Left edge 4 px right of the target's left edge; y far from everything.
    const r = snap(box(204, 400), [box(200, 0)], 1, false);
    // Same widths: left, centre and right are all 4 px off, and the centre line wins the tie.
    expect(r).toEqual({ dx: -4, dy: 0, guides: [{ axis: 'x', at: 250, role: 'centre' }] });
  });

  it('only matches the same kind of line: left to left, never left to right', () => {
    // Subject left edge 3 px from the target's RIGHT edge (300); widths differ so no other line is close.
    const r = snap(box(303, 400, 60), [box(200, 0, 100)], 1, false);
    expect(r.dx).toBe(0);
    expect(r.guides).toEqual([]);
  });

  it('is 6 screen px, so the world distance depends on the zoom', () => {
    const t = [box(200, 0, 100)];
    // 5 world px: at zoom 1 that is 5 screen px (snaps); at zoom 2 it is 10 (doesn't).
    expect(snap(box(205, 400, 60), t, 1, false).dx).toBe(-5);
    expect(snap(box(205, 400, 60), t, 2, false).dx).toBe(0);
    // Exactly 6 screen px snaps; a bit more doesn't.
    expect(snap(box(206, 400, 60), t, 1, false).dx).toBe(-6);
    expect(snap(box(206.01, 400, 60), t, 1, false).dx).toBe(0);
    expect(snap(box(203, 400, 60), t, 2, false).dx).toBe(-3);
    expect(SNAP_DISTANCE).toBe(6);
  });

  it('snaps both axes at once, with a guide for each', () => {
    const r = snap(box(203, 98, 60, 40), [box(200, 0, 60, 40), box(500, 100, 80, 40)], 1, false);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(2);
    expect(r.guides.map((g) => g.axis)).toEqual(['x', 'y']);
  });

  it('uses x + floor(width / 2) for centre lines', () => {
    expect(linesOf(box(10, 20, 101, 51), 'x')).toEqual([
      { role: 'start', at: 10 }, { role: 'centre', at: 60 }, { role: 'end', at: 111 },
    ]);
    expect(linesOf(box(10, 20, 101, 51), 'y')[1]).toEqual({ role: 'centre', at: 45 });
    // A 101-wide subject centred on a 60-wide target: the target's centre is 230 (200 + 30), the subject's 183 + 50.
    const r = snap(box(183, 400, 101), [box(200, 0, 60)], 1, false);
    expect(r.dx).toBe(-3);
    expect(r.guides[0]).toEqual({ axis: 'x', at: 230, role: 'centre' });
  });

  it('breaks ties: centre over an edge', () => {
    // Subject 100 wide at x=203: left 203, centre 253. Target A's left edge 200 (3 away); target B's centre 256 (3 away).
    const r = snap(box(203, 400, 100), [box(200, 0, 40), box(236, 100, 40)], 1, false);
    expect(r.guides[0]).toMatchObject({ role: 'centre', at: 256 });
    expect(r.dx).toBe(3);
  });

  it('breaks ties: the left (top) edge over the right (bottom) one', () => {
    // Subject 100 wide at x=203: left 203, right 303. Target A's right edge 300 (3 away); target B's left edge 206.
    const r = snap(box(203, 400, 100), [box(260, 0, 40), box(206, 100, 30)], 1, false);
    expect(r.guides[0]).toMatchObject({ role: 'start', at: 206 });
    expect(r.dx).toBe(3);
    // Vertically: top over bottom.
    const v = snap(box(600, 203, 40, 100), [box(0, 260, 40, 40), box(300, 206, 40, 30)], 1, false);
    expect(v.guides[0]).toMatchObject({ axis: 'y', role: 'start', at: 206 });
  });

  it('breaks ties: then the smaller coordinate', () => {
    // Left edge 203, targets' left edges at 200 and 206: both 3 away.
    const r = snap(box(203, 400, 100), [box(206, 0, 30), box(200, 100, 30)], 1, false);
    expect(r.guides[0]).toMatchObject({ role: 'start', at: 200 });
  });

  it('prefers the closer line over the kind', () => {
    const r = snap(box(203, 400, 100), [box(201, 0, 30), box(258, 100, 30)], 1, false);
    // Left to 201 is 2 away; centre 253 to 273 (258 + 15) is 20 away.
    expect(r.guides[0]).toMatchObject({ role: 'start', at: 201 });
  });

  it('Alt turns snapping off', () => {
    expect(snap(box(204, 400), [box(200, 0)], 1, true)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('points have only a centre line; bare lines snap their own axis and role', () => {
    // A bend point snaps to a block's centre line, to another point, and to a bare line.
    expect(snap({ x: 203, y: 900 }, [box(150, 0)], 1, false)).toMatchObject({ dx: -3, dy: 0 });
    expect(snap({ x: 203, y: 900 }, [box(0, 0, 10, 10), { x: 205, y: 5 }], 1, false)).toMatchObject({ dx: 2, dy: 0 });
    expect(snap({ x: 203, y: 97 }, [{ axis: 'y', at: 100 }], 1, false)).toMatchObject({ dx: 0, dy: 3 });
    // A point never snaps to a block's edges.
    expect(snap({ x: 203, y: 900 }, [box(200, 0, 300)], 1, false).dx).toBe(0);
  });
});
