// wheel-intent.ts: classifying a wheel event as pan or zoom (Task 1, amendment A14). `classifyWheel` is pure, so
// these thread state through by hand instead of stubbing a DOM event or a timer.
import { classifyWheel, STICKY_MS, type StickyWheelState, type WheelSample } from './wheel-intent';

/** A pixel-mode sample (a trackpad's usual mode) with sensible defaults. */
function sample(over: Partial<WheelSample>): WheelSample {
  return { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, ...over };
}

describe('classifyWheel: mouse signals -> zoom', () => {
  test('deltaMode 1 (lines) is a mouse wheel', () => {
    const r = classifyWheel(sample({ deltaY: -3, deltaMode: 1 }), null, 0);
    expect(r.intent).toBe('zoom');
  });

  test('deltaMode 2 (pages) is a mouse wheel', () => {
    const r = classifyWheel(sample({ deltaY: 1, deltaMode: 2 }), null, 0);
    expect(r.intent).toBe('zoom');
  });

  test('a legacy wheelDeltaY that is a clean multiple of 120 is a mouse notch', () => {
    const r = classifyWheel(sample({ deltaY: -100, wheelDeltaY: 120 }), null, 0);
    expect(r.intent).toBe('zoom');
  });

  test('a whole-pixel, vertical-only delta with no legacy wheelDeltaY falls back to zoom (the original behaviour)', () => {
    const r = classifyWheel(sample({ deltaY: -300 }), null, 0);
    expect(r.intent).toBe('zoom');
  });
});

describe('classifyWheel: trackpad signals -> pan', () => {
  test('a fractional deltaY is a trackpad', () => {
    const r = classifyWheel(sample({ deltaY: -4.333333 }), null, 0);
    expect(r.intent).toBe('pan');
  });

  test('non-zero deltaX in pixel mode is a trackpad, even with a whole deltaY', () => {
    const r = classifyWheel(sample({ deltaX: 12, deltaY: 4 }), null, 0);
    expect(r.intent).toBe('pan');
  });

  test('a wheelDeltaY that is not a multiple of 120 does not force zoom, and a fractional deltaY still pans', () => {
    const r = classifyWheel(sample({ deltaY: -4.5, wheelDeltaY: 37 }), null, 0);
    expect(r.intent).toBe('pan');
  });

  test('non-zero deltaX wins over a synthetic wheelDeltaY notch (Chromium fills in a fixed -120/120 on every '
    + 'CDP-dispatched wheel event, real trackpad or not)', () => {
    const r = classifyWheel(sample({ deltaX: 40, deltaY: 25, wheelDeltaY: -120 }), null, 0);
    expect(r.intent).toBe('pan');
  });
});

describe('classifyWheel: ctrl/meta pinch -> zoom, always', () => {
  test('ctrlKey (Chromium/Firefox trackpad pinch) zooms even with trackpad-shaped deltas', () => {
    const r = classifyWheel(sample({ deltaX: 3.2, deltaY: -1.7, ctrlKey: true }), null, 0);
    expect(r.intent).toBe('zoom');
  });

  test('metaKey zooms too', () => {
    const r = classifyWheel(sample({ deltaY: -2.1, metaKey: true }), null, 0);
    expect(r.intent).toBe('zoom');
  });

  test('ctrl+wheel overrides a "pan" override', () => {
    const r = classifyWheel(sample({ deltaY: -1, ctrlKey: true }), null, 0, 'pan');
    expect(r.intent).toBe('zoom');
  });

  test('ctrl+wheel overrides stickiness (a pan gesture that then adds Ctrl mid-stream becomes a zoom)', () => {
    const first = classifyWheel(sample({ deltaX: 5, deltaY: 2 }), null, 0);
    expect(first.intent).toBe('pan');
    const second = classifyWheel(sample({ deltaX: 5, deltaY: 2, ctrlKey: true }), first, 10);
    expect(second.intent).toBe('zoom');
  });

  test('a ctrl-forced zoom does not bleed into the very next event once Ctrl is released: an unambiguous trackpad '
    + 'pan right after a pinch pans, even inside STICKY_MS', () => {
    const pinch = classifyWheel(sample({ deltaY: -2, ctrlKey: true }), null, 0);
    expect(pinch.intent).toBe('zoom');
    const scroll = classifyWheel(sample({ deltaX: 20, deltaY: -15 }), pinch, 5); // no ctrlKey now, well inside STICKY_MS
    expect(scroll.intent).toBe('pan');
  });
});

describe('classifyWheel: shift+wheel pans horizontally (a nice-to-have)', () => {
  test('shiftKey alone classifies as pan', () => {
    const r = classifyWheel(sample({ deltaY: -300, shiftKey: true }), null, 0);
    expect(r.intent).toBe('pan');
  });
});

describe('classifyWheel: stickiness', () => {
  test('a sample within STICKY_MS of the last keeps the same intent even if it would classify differently alone', () => {
    // Start a trackpad pan (fractional delta).
    const first = classifyWheel(sample({ deltaY: -1.25 }), null, 0);
    expect(first.intent).toBe('pan');
    // A later sample in the same stream that looks mouse-shaped on its own (whole pixel, no deltaX) stays "pan".
    const second = classifyWheel(sample({ deltaY: -2 }), first, STICKY_MS - 1);
    expect(second.intent).toBe('pan');
  });

  test('a sample after STICKY_MS re-classifies from scratch', () => {
    const first = classifyWheel(sample({ deltaY: -1.25 }), null, 0);
    expect(first.intent).toBe('pan');
    const second = classifyWheel(sample({ deltaY: -300 }), first, STICKY_MS + 1);
    expect(second.intent).toBe('zoom');
  });

  test('exactly STICKY_MS later is still the same gesture (inclusive boundary)', () => {
    const first: StickyWheelState = { intent: 'pan', at: 0 };
    const second = classifyWheel(sample({ deltaY: -300 }), first, STICKY_MS);
    expect(second.intent).toBe('pan');
  });
});

describe('classifyWheel: the "Scroll to" override', () => {
  test('"pan" forces pan regardless of device shape', () => {
    const r = classifyWheel(sample({ deltaY: -300 }), null, 0, 'pan');
    expect(r.intent).toBe('pan');
  });

  test('"zoom" forces zoom regardless of device shape', () => {
    const r = classifyWheel(sample({ deltaX: 8, deltaY: 2.5 }), null, 0, 'zoom');
    expect(r.intent).toBe('zoom');
  });

  test('an override is immediate: it is not subject to stickiness', () => {
    const first = classifyWheel(sample({ deltaY: -1.25 }), null, 0); // pan, by device shape
    const second = classifyWheel(sample({ deltaY: -1 }), first, 5, 'zoom');
    expect(second.intent).toBe('zoom');
  });

  test('"auto" runs the heuristic', () => {
    const r = classifyWheel(sample({ deltaX: 5, deltaY: 2 }), null, 0, 'auto');
    expect(r.intent).toBe('pan');
  });
});
