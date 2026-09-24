// Every `.fm-*` class a UI stylesheet styles is one the UI can render: its name appears in the UI's TypeScript. A
// rule for a class nothing renders any more (like v1.0's `.fm-handle` connection handles, replaced by v1.1's ports)
// is dead weight and misleads the next reader.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const UI = import.meta.dirname;

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name), ext) : ext.test(e.name) ? [join(dir, e.name)] : []);
}

test('no stylesheet rule targets an .fm-* class that the UI never renders', () => {
  const source = files(UI, /\.tsx?$/).filter((f) => !/\.test\.tsx?$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
  const dead: string[] = [];
  for (const css of files(UI, /\.css$/)) {
    const text = readFileSync(css, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of text.matchAll(/\.(fm-[a-zA-Z0-9_-]+)/g)) {
      const cls = m[1]!;
      // Used literally, or built from a prefix: `fm-resize-${h}`, `fm-save-${save}`; a one-word class such as `fm-LR`
      // or `fm-warn` from `fm-${direction}` or `fm-${level}`.
      const oneWord = !cls.slice(3).includes('-');
      const used = source.includes(cls)
        || (oneWord && source.includes('fm-${'))
        || [...cls.matchAll(/-/g)].some((d) => d.index! > 2 && source.includes(`${cls.slice(0, d.index! + 1)}\${`));
      if (!used) dead.push(`${css.slice(UI.length + 1)}: .${cls}`);
    }
  }
  expect([...new Set(dead)]).toEqual([]);
});
