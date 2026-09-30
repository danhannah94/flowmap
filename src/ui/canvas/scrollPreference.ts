// The "Scroll to:" override in the controls legend (Task 1, amendment A14): Pan, Zoom or Auto (the wheel-intent
// heuristic, wheel-intent.ts). Remembered in localStorage so it survives a reload; every storage access is wrapped in
// try/catch so the feature degrades to "just Auto" rather than throwing when storage is unavailable (private
// browsing, quota, disabled), the same posture as `dismissedWarnings.ts`.
import type { ScrollPreference } from './wheel-intent';

const KEY = 'flowmap.scroll-preference';
const VALID: readonly ScrollPreference[] = ['auto', 'pan', 'zoom'];

function read(): ScrollPreference {
  try {
    const raw = localStorage.getItem(KEY);
    return (VALID as readonly string[]).includes(raw ?? '') ? (raw as ScrollPreference) : 'auto';
  } catch {
    return 'auto';
  }
}

let current: ScrollPreference = read();

/** The current override; cheap (an in-memory read), safe to call on every wheel event. */
export function getScrollPreference(): ScrollPreference {
  return current;
}

/** Set the override and persist it. Never throws. */
export function setScrollPreference(pref: ScrollPreference): void {
  current = pref;
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // Storage unavailable: the choice just won't survive a reload.
  }
}
