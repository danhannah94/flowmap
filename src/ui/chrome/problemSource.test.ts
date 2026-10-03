// Every problem code maps to the file it is really in (the banner's "where" for a problem without an `.mmd` line).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parsePackText, resolvePreset } from '../../core/preset';
import { PROBLEM_FILES, problemSource } from './problemSource';

const ROOT = join(import.meta.dirname, '../../..');

/** The codes §7 lists ("Error and warning codes: …"). */
function specCodes(): string[] {
  const design = readFileSync(join(ROOT, 'docs/design.md'), 'utf8');
  const start = design.indexOf('Error and warning codes:');
  const end = design.indexOf('Every error found is reported.', start);
  expect(start).toBeGreaterThan(0);
  return [...new Set(design.slice(start, end).match(/`[EW]-[a-z-]+`/g)!.map((c) => c.slice(1, -1)))];
}

/** Every code the core and the CLI emit, as written in their sources. */
function sourceCodes(): string[] {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
        for (const m of readFileSync(p, 'utf8').matchAll(/'([EW]-[a-z]+(?:-[a-z]+)*)'/g)) out.add(m[1]!);
      }
    }
  };
  walk(join(ROOT, 'src/core'));
  walk(join(ROOT, 'src/cli'));
  return [...out];
}

describe('problemSource', () => {
  it('every code in the spec (§7) has a file', () => {
    const codes = specCodes();
    expect(codes.length).toBeGreaterThan(20);
    for (const code of codes) expect(PROBLEM_FILES, code).toHaveProperty([code]);
  });

  it('every code the core emits has a file, and is in the spec', () => {
    const spec = new Set(specCodes());
    for (const code of sourceCodes()) {
      expect(PROBLEM_FILES, code).toHaveProperty([code]);
      expect(spec.has(code), `${code} is listed in §7`).toBe(true);
    }
  });

  it.each([
    ['W-style', '.flow.yaml'],
    ['W-config-key', '.flow.yaml'],
    ['W-link-missing', '.flow.yaml'],
    ['W-link-traversal', '.flow.yaml'],
    ['W-preset-unknown', '.flow.yaml'],
    ['W-preset-kind', '.flow.yaml'],
    ['E-layout', '.layout.json'],
    ['W-layout-unknown-node', '.layout.json'],
    ['W-layout-unknown-edge', '.layout.json'],
    ['W-layout-unknown-note', '.layout.json'],
    ['W-no-lane', '.mmd'],
  ])('%s is in %s', (code, file) => {
    expect(problemSource({ code })).toBe(file);
  });

  it('a problem inside a preset pack file names that file (W-preset-invalid, W-style from the pack)', () => {
    const { warnings } = parsePackText('kinds:\n  job:\n    icon: nope\n    style: {fill: 12}\n', 'packs/team.yaml');
    expect(warnings.map((w) => w.code).sort()).toEqual(['W-preset-invalid', 'W-style']);
    for (const w of warnings) expect(problemSource(w)).toBe('packs/team.yaml');
    const broken = parsePackText('kinds: [oops\n', 'team.yaml').warnings;
    expect(broken.map(problemSource)).toEqual(['team.yaml']);
  });

  it('a bad or unreadable preset reference is in the .flow.yaml', () => {
    expect(resolvePreset('no-such-pack', {}).warnings.map(problemSource)).toEqual(['.flow.yaml']);
    expect(resolvePreset('packs/missing.yaml', { 'packs/missing.yaml': null }).warnings.map(problemSource)).toEqual(['.flow.yaml']);
    expect(resolvePreset('C:\\\\packs\\\\x.yaml', {}).warnings.map(problemSource)).toEqual(['.flow.yaml']);
  });
});
