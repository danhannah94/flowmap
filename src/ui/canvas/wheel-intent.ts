// Classifying a wheel event as a pan or a zoom (trackpad-friendly navigation): a trackpad's two-finger scroll pans
// the canvas in both axes, a trackpad pinch or a mouse's scroll wheel zooms around the cursor, and Cmd/Ctrl+wheel
// always zooms. There is no browser API that says "this came from a trackpad", so this combines a handful of signals
// (§ below) into one heuristic, and threads the result through explicitly rather than hiding it behind a class, so
// it's a small pure function the caller (Canvas.tsx) can unit test and step through by hand.
//
// The signals, checked per event, in this order:
// - `ctrlKey` or `metaKey`: an explicit zoom (this is also how Chromium and Firefox report a trackpad pinch). This
//   is decided fresh on every event, never sticky: releasing the key (or starting a plain scroll right after a
//   pinch) is an immediate, unambiguous change a person made on purpose.
// - a user override (§ ScrollPreference), when it isn't "auto": also fresh on every event.
// - `shiftKey` on its own: a mouse's Shift+wheel is a horizontal pan (a nice-to-have); also fresh.
// - otherwise, `classifyDevice` below, which only falls back to stickiness for a sample that is genuinely
//   ambiguous on its own (see there).
//
// Only `classifyDevice`'s last, ambiguous case consults `prev`/`STICKY_MS`: a trackpad's momentum can decay to a
// whole-pixel, single-axis delta indistinguishable from a mouse notch near the end of one continuous two-finger
// scroll, and stickiness is what keeps that tail end from flipping to a zoom. A modifier key or the user override
// changing between two events is not that kind of ambiguity, so those are never held over from `prev`.
export type WheelIntent = 'pan' | 'zoom';

/** The "Scroll to:" override in the controls legend (Task 1); "auto" runs the heuristic below. */
export type ScrollPreference = 'auto' | 'pan' | 'zoom';

export interface WheelSample {
  deltaX: number;
  deltaY: number;
  /** WheelEvent.deltaMode: 0 pixel, 1 line, 2 page. */
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey?: boolean;
  /** The legacy, Chromium-only notch delta; undefined on browsers that don't set it (Firefox, Safari). */
  wheelDeltaY?: number;
}

export interface StickyWheelState {
  intent: WheelIntent;
  /** The timestamp (same clock as `now`) this state was produced at, for the next call's stickiness check. */
  at: number;
}

/** How long a genuinely ambiguous sample is still read as a continuation of the gesture before `prev`. */
export const STICKY_MS = 300;

/**
 * Classify one wheel sample. `prev` is the state this same gesture produced last time (or `null` at the start of a
 * gesture); `now` is a monotonic timestamp in the same units as `prev.at` (e.g. `performance.now()` or
 * `event.timeStamp`). Pure: nothing is read or written outside the arguments, so the caller owns the one mutable ref.
 */
export function classifyWheel(
  sample: WheelSample,
  prev: StickyWheelState | null,
  now: number,
  preference: ScrollPreference = 'auto',
): StickyWheelState {
  // Cmd/Ctrl+wheel is always a zoom: it's the explicit modifier convention, and also how Chromium/Firefox report a
  // trackpad pinch. This beats the user override too, and is never sticky (see the file comment).
  if (sample.ctrlKey || sample.metaKey) return { intent: 'zoom', at: now };
  if (preference !== 'auto') return { intent: preference, at: now };
  // A mouse's Shift+wheel pans horizontally (a nice-to-have): also immediate, not sticky.
  if (sample.shiftKey) return { intent: 'pan', at: now };
  return { intent: classifyDevice(sample, prev, now), at: now };
}

function classifyDevice(sample: WheelSample, prev: StickyWheelState | null, now: number): WheelIntent {
  const { deltaX, deltaY, deltaMode, wheelDeltaY } = sample;
  // A line- or page-scroll event can only come from a mouse wheel; a trackpad always reports pixels. Unambiguous.
  if (deltaMode === 1 || deltaMode === 2) return 'zoom';
  // Sideways motion in pixel mode only comes from a trackpad's two-finger scroll: checked before the legacy
  // wheelDeltaY below, which some browsers (and test harnesses driving the OS wheel API directly) fill in with a
  // fixed "one notch" value on every wheel event, trackpad or not. Unambiguous.
  if (deltaX !== 0) return 'pan';
  // The legacy wheelDeltaY is a clean multiple of the mouse-wheel "notch" (120) while deltaY isn't the near-zero a
  // trackpad can also land on: a mouse. Fairly strong signal.
  if (wheelDeltaY !== undefined && Math.abs(deltaY) >= 1 && wheelDeltaY % 120 === 0) return 'zoom';
  // A fractional delta is a trackpad; a mouse wheel's deltaY is a whole number of pixels. Fairly strong signal.
  if (!Number.isInteger(deltaY)) return 'pan';
  // Genuinely ambiguous (whole-pixel, vertical-only, no legacy delta, no sideways motion): if this is still the
  // same gesture as the last sample, keep reading it the way it started; a trackpad's momentum decaying to this
  // shape at the tail of a scroll shouldn't suddenly zoom. Otherwise, the original, mouse-wheel-only behaviour.
  if (prev && now - prev.at <= STICKY_MS) return prev.intent;
  return 'zoom';
}
