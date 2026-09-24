// Diagram operations (design.md §8.2 UI22, UI23).
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

/** UI23: rewrite the header's direction. Pins keep their `along` and `across`. */
export function setDirection(files: Files, direction: Direction): OpResult {
  return run(files, (ctx) => {
    if (direction !== 'LR' && direction !== 'TB') refuse(`The direction is LR or TB, not "${String(direction)}"`);
    ctx.d.direction = direction;
    return {};
  });
}
