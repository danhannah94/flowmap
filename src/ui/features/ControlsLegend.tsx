// A14: the controls legend, a small chip beside the `?` shortcut button (bottom-left) that lists the navigation,
// selection and editing controls this build actually implements (Task 1's trackpad-friendly pan/zoom, plus what's
// already in gestures.ts, keyboard.ts, clipboard.ts and core commands, verified against those files rather than
// guessed), and the "Scroll to" override (Auto/Pan/Zoom) for the wheel-intent heuristic (wheel-intent.ts). Collapsed
// by default; the open/closed state is remembered in localStorage (degrading quietly if storage is unavailable, the
// same posture as `dismissedWarnings.ts`). Distinct from `ShortcutList` (the full `?` keyboard-shortcut reference):
// this is a compact, always-current cheat sheet for the mouse/trackpad gestures a new person wouldn't otherwise find.
import { useEffect, useState } from 'react';
import { icons } from '../chrome/icons';
import { isTyping, modLabel } from '../keyboard';
import { getScrollPreference, setScrollPreference } from '../canvas/scrollPreference';
import type { ScrollPreference } from '../canvas/wheel-intent';

const OPEN_KEY = 'flowmap.controls-legend-open';

function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function saveOpen(open: boolean): void {
  try {
    if (open) localStorage.setItem(OPEN_KEY, '1');
    else localStorage.removeItem(OPEN_KEY);
  } catch {
    // Storage unavailable: the chip just starts collapsed again next time.
  }
}

interface Group {
  title: string;
  items: string[];
}

/** Every group and item here is a real, implemented control (Canvas.tsx, gestures.ts, keyboard.ts, clipboard.ts,
 *  commands/*.ts); computed once `modLabel()` is known (⌘ on a Mac, Ctrl elsewhere). */
function groups(): Group[] {
  const mod = modLabel();
  return [
    { title: 'Pan', items: ['Two-finger scroll (trackpad)', 'Space+drag', 'Middle-drag'] },
    { title: 'Zoom', items: ['Pinch (trackpad)', 'Scroll wheel (mouse)', `${mod}+scroll`] },
    { title: 'Select', items: ['Click', `Shift/${mod}+click to add`, 'Drag on empty canvas for a box'] },
    { title: 'Edit', items: [`${mod}+C / X / V`, `${mod}+D duplicate`, 'Delete/Backspace', 'Arrow keys nudge'] },
    { title: 'View', items: ['Shift+1 fit to screen', `${mod}+Z, Shift+${mod}+Z undo, redo`] },
  ];
}

export function ControlsLegend() {
  const [open, setOpen] = useState(loadOpen);
  const [pref, setPref] = useState<ScrollPreference>(getScrollPreference);

  useEffect(() => saveOpen(open), [open]);

  // Escape closes it first (not modal: it doesn't hold the keyboard otherwise, so shortcuts can still be tried).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isTyping(e.target)) return;
      e.preventDefault();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={`fm-legend-btn${open ? ' fm-active' : ''}`}
        data-testid="controls-legend-toggle"
        data-canvas-control
        title="Controls"
        aria-label="Controls legend"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icons.keyboard}
      </button>
      {open ? (
        <section className="fm-legend" data-testid="controls-legend" aria-label="Controls">
          <header className="fm-legend-head">
            <span>Controls</span>
            <button type="button" className="fm-notice-close" aria-label="Close" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>
          <div className="fm-legend-body">
            {groups().map((g) => (
              <div className="fm-legend-group" key={g.title}>
                <div className="fm-legend-group-title">{g.title}</div>
                <ul className="fm-legend-list">
                  {g.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              </div>
            ))}
            <label className="fm-legend-pref">
              <span>Scroll to</span>
              <select
                data-testid="scroll-preference"
                value={pref}
                onChange={(e) => {
                  const v = e.target.value as ScrollPreference;
                  setPref(v);
                  setScrollPreference(v);
                }}
              >
                <option value="auto">Auto</option>
                <option value="pan">Pan</option>
                <option value="zoom">Zoom</option>
              </select>
            </label>
          </div>
        </section>
      ) : null}
    </>
  );
}
