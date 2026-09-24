// Diagram operations (design.md §8.2 UI22, UI23).
import { flipDirection } from '../layoutfile';
import type { Direction } from '../types';
import { refuse, run, type Files, type OpResult } from './context';

/** UI22: set the config `title` (creating the config file if needed); an empty title removes the key. */
export function setTitle(files: Files, title: string | null): OpResult {
  return run(files, (ctx) => {
    ctx.requireConfig();
    ctx.editConfig('always', (doc) => doc.setTitle(title));
    return {};
  });
}

/**
 * UI23: rewrite the header's direction. Pins keep their `along` and `across`, and so do sizes, bend points and
 * `label_at`; (v1.1) sides rotate with the diagram (right ↔ bottom, left ↔ top) and note and title positions swap x
 * and y. Setting the direction it already has changes nothing.
 */
export function setDirection(files: Files, direction: Direction): OpResult {
  return run(files, (ctx) => {
    if (direction !== 'LR' && direction !== 'TB') refuse(`The direction is LR or TB, not "${String(direction)}"`);
    if (ctx.d.direction === direction) return {};
    ctx.d.direction = direction;
    // A broken layout file can't be read: refuse only if it may hold something the flip rotates.
    ctx.editLayout(['source_side', 'target_side', 'notes', 'title'], (file) => flipDirection(file));
    return {};
  });
}
