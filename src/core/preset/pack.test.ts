import { describe, expect, test } from 'vitest';
import { parseConfig } from '../config';
import { BUILTIN_PACKS, builtinPresetNames } from './builtin';
import { GLYPHS, glyphNames, isSafePathData } from './glyphs';
import { applyPreset, builtinPack, classifyPresetRef, parsePackText, presetFileOf, resolvePreset } from './pack';

const codes = (w: { code: string }[]) => w.map((x) => x.code);

describe('classifyPresetRef', () => {
  test('a bare word is a built-in name', () => {
    expect(classifyPresetRef('cloud')).toEqual({ type: 'builtin', name: 'cloud' });
    expect(classifyPresetRef('  my-pack ')).toEqual({ type: 'builtin', name: 'my-pack' });
  });

  test('a slash or a .yaml/.yml/.json ending is a file, normalised and relative to the diagram', () => {
    expect(classifyPresetRef('team.yaml')).toEqual({ type: 'file', path: 'team.yaml' });
    expect(classifyPresetRef('./packs//team.yml')).toEqual({ type: 'file', path: 'packs/team.yml' });
    expect(classifyPresetRef('../shared/team.json')).toEqual({ type: 'file', path: '../shared/team.json' });
    expect(classifyPresetRef('packs/team')).toEqual({ type: 'file', path: 'packs/team' });
  });

  test('absolute paths, backslashes, empty and directory-only references are invalid', () => {
    for (const bad of ['/etc/pack.yaml', 'C:/pack.yaml', 'packs\\team.yaml', '', '   ', '..', 'a/..', 'not a name']) {
      expect(classifyPresetRef(bad).type, bad).toBe('invalid');
    }
  });
});

describe('the built-in cloud pack', () => {
  const pack = builtinPack('cloud')!;

  test('is listed and reads without a single warning', () => {
    expect(builtinPresetNames()).toEqual(['cloud']);
    expect(pack).not.toBeNull();
    expect(pack.name).toBe('Cloud architecture');
    // Through the same reader a pack file goes through: nothing in the built-in is ignored.
    expect(parsePackText(JSON.stringify(BUILTIN_PACKS.cloud), 'cloud').warnings).toEqual([]);
    expect(resolvePreset('cloud', undefined).warnings).toEqual([]);
  });

  test('covers the roles the issue names, each with a legend label and a glyph', () => {
    for (const id of ['function', 'object-storage', 'database', 'queue', 'cache', 'api-gateway', 'external-service', 'user']) {
      const kind = pack.byName.get(id);
      expect(kind, id).toBeTruthy();
      expect(kind!.label, id).toBeTruthy();
      expect(kind!.icon, id).not.toBeNull();
      expect(kind!.icon!.paths.length).toBeGreaterThan(0);
    }
  });

  test('every kind uses a distinct glyph and has a light and a dark fill', () => {
    const names = pack.kinds.map((k) => k.icon!.name);
    expect(new Set(names).size).toBe(names.length);
    for (const k of pack.kinds) {
      const fill = k.style.fill as { light: string; dark: string };
      expect(fill.light, k.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(fill.dark, k.id).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test('aliases resolve to their kind and never collide', () => {
    expect(pack.byName.get('db')?.id).toBe('database');
    expect(pack.byName.get('bucket')?.id).toBe('object-storage');
    expect(pack.byName.get('saas')?.id).toBe('external-service');
    const all = pack.kinds.flatMap((k) => [k.id, ...k.aliases]);
    expect(new Set(all).size).toBe(all.length);
  });

  test('has no vendor names anywhere in its data', () => {
    const text = JSON.stringify(BUILTIN_PACKS).toLowerCase() + JSON.stringify(GLYPHS).toLowerCase();
    for (const brand of ['aws', 'amazon', 'azure', 'microsoft', 'gcp', 'google', 'lambda', 's3', 'dynamo']) {
      expect(text, brand).not.toContain(brand);
    }
  });
});

describe('glyphs', () => {
  test('every glyph is a few safe path strings', () => {
    for (const name of glyphNames()) {
      const paths = GLYPHS[name]!;
      expect(paths.length, name).toBeGreaterThan(0);
      for (const d of paths) expect(isSafePathData(d), `${name}: ${d}`).toBe(true);
    }
  });

  test('path data that could carry markup or is huge is refused', () => {
    expect(isSafePathData('M0 0L10 10')).toBe(true);
    expect(isSafePathData('M0 0"><script>')).toBe(false);
    expect(isSafePathData('url(#x)')).toBe(false);
    expect(isSafePathData('')).toBe(false);
    expect(isSafePathData('M0 0' + ' L1 1'.repeat(300))).toBe(false);
  });
});

describe('parsePackText (a pack file)', () => {
  const ok = [
    'version: 1',
    'name: Team pack',
    'kinds:',
    '  worker:',
    '    label: Worker',
    '    aliases: [job]',
    '    icon: {paths: ["M4 4h16v16H4z", "M8 12h8"]}',
    '    style: {fill: {light: "#ffeedd", dark: "#332211"}, badge: w}',
    '  store:',
    '    icon: database',
    '',
  ].join('\n');

  test('a valid pack reads with no warnings, custom paths and built-in glyph names both', () => {
    const { pack, warnings } = parsePackText(ok, 'team.yaml');
    expect(warnings).toEqual([]);
    expect(pack!.name).toBe('Team pack');
    expect(pack!.kinds.map((k) => k.id)).toEqual(['worker', 'store']);
    expect(pack!.byName.get('job')?.id).toBe('worker');
    expect(pack!.byName.get('worker')!.icon).toEqual({ name: 'custom', paths: ['M4 4h16v16H4z', 'M8 12h8'] });
    expect(pack!.byName.get('store')!.icon!.name).toBe('database');
    expect(pack!.byName.get('store')!.label).toBeNull();
    expect(pack!.byName.get('worker')!.style.fill).toEqual({ light: '#ffeedd', dark: '#332211' });
  });

  test('JSON works too', () => {
    const { pack, warnings } = parsePackText('{"version": 1, "kinds": {"a": {"label": "A"}}}', 'p.json');
    expect(warnings).toEqual([]);
    expect(pack!.kinds[0]!.label).toBe('A');
  });

  test('invalid YAML, a non-map and a missing kinds map give no pack and one warning', () => {
    for (const text of ['kinds: [oops\n', '- just\n- a list\n', 'version: 1\nname: x\n', 'version: 2\nkinds: {}\n']) {
      const { pack, warnings } = parsePackText(text, 'p.yaml');
      expect(pack, text).toBeNull();
      expect(codes(warnings), text).toEqual(['W-preset-invalid']);
    }
  });

  test('bad pieces are warned and dropped, the rest of the pack still works', () => {
    const { pack, warnings } = parsePackText(
      [
        'kinds:',
        '  a: {icon: no-such-glyph, label: A, colour: red}',
        '  b: {icon: {paths: ["M0 0\\"><script>"]}}',
        '  c: {aliases: [a], style: {border_width: 9, fill: "#abc"}}',
        '  d: 5',
        'extra: 1',
        '',
      ].join('\n'),
      'p.yaml',
    );
    expect(codes(warnings).sort()).toEqual(
      [...Array(6).fill('W-preset-invalid'), 'W-style'],
    );
    expect(pack!.kinds.map((k) => k.id)).toEqual(['a', 'b', 'c']);
    expect(pack!.byName.get('a')!.icon).toBeNull();
    expect(pack!.byName.get('b')!.icon).toBeNull();
    // Alias "a" is a kind id already: ignored. The bad width is dropped, the good fill kept.
    expect(pack!.byName.get('c')!.aliases).toEqual([]);
    expect(pack!.byName.get('c')!.style).toEqual({ fill: '#aabbcc' });
  });
});

describe('resolvePreset', () => {
  test('no preset: nothing, quietly', () => {
    expect(resolvePreset(null, undefined)).toEqual({ pack: null, warnings: [] });
  });

  test('an unknown built-in is W-preset-unknown and names the ones that exist', () => {
    const r = resolvePreset('kloud', undefined);
    expect(r.pack).toBeNull();
    expect(codes(r.warnings)).toEqual(['W-preset-unknown']);
    expect(r.warnings[0]!.message).toContain('cloud');
  });

  test('an invalid reference is W-preset-invalid', () => {
    const r = resolvePreset('/etc/x.yaml', undefined);
    expect(codes(r.warnings)).toEqual(['W-preset-invalid']);
  });

  test('a pack file: read from the host-supplied text, unreadable (null) is a warning, not yet asked is quiet', () => {
    const text = 'kinds: {a: {label: A}}';
    expect(resolvePreset('p.yaml', { 'p.yaml': text }).pack!.kinds).toHaveLength(1);
    expect(codes(resolvePreset('p.yaml', { 'p.yaml': null }).warnings)).toEqual(['W-preset-unknown']);
    expect(resolvePreset('p.yaml', {})).toEqual({ pack: null, warnings: [] });
    expect(resolvePreset('p.yaml', undefined)).toEqual({ pack: null, warnings: [] });
  });
});

describe('applyPreset', () => {
  const pack = builtinPack('cloud')!;
  const config = (yaml: string) => parseConfig(yaml).config;

  test('selects by the metadata kind (ids and aliases), gives style, icon and legend in pack order', () => {
    const c = config('nodes:\n  a: {kind: database}\n  b: {kind: fn}\n  c: {kind: db}\n  d: {team: x}\n');
    const r = applyPreset(pack, c, ['a', 'b', 'c', 'd']);
    expect(Object.keys(r.icons).sort()).toEqual(['a', 'b', 'c']);
    expect(r.icons.a!.name).toBe('database');
    expect(r.icons.b!.name).toBe('function');
    expect(r.styles.d).toBeUndefined();
    // Function comes before Database in the pack; used kinds only, once each.
    expect(r.legend.map((l) => l.text)).toEqual(['Function', 'Database']);
    expect(r.legend[0]!.icon!.name).toBe('function');
    expect(r.warnings).toEqual([]);
  });

  test('only the metadata kind counts: a block that merely has the database shape gets nothing', () => {
    const r = applyPreset(pack, config('nodes:\n  a: {team: x}\n'), ['a']);
    expect(r.icons).toEqual({});
    expect(r.legend).toEqual([]);
  });

  test('a kind the pack does not have is one W-preset-kind per kind, listing its blocks', () => {
    const r = applyPreset(pack, config('nodes:\n  a: {kind: gizmo}\n  b: {kind: gizmo}\n  c: {kind: widget}\n'), ['a', 'b', 'c']);
    expect(codes(r.warnings)).toEqual(['W-preset-kind', 'W-preset-kind']);
    expect(r.warnings[0]!.message).toContain('"gizmo"');
    expect(r.warnings[0]!.message).toContain('a, b');
  });

  test('a kind the diagram styles itself (a rule matching on it) is not warned about', () => {
    const c = config('styles:\n  - match: {kind: wait}\n    style: {badge: w}\nnodes:\n  a: {kind: wait}\n');
    expect(applyPreset(pack, c, ['a']).warnings).toEqual([]);
  });

  test('no pack, nothing', () => {
    expect(applyPreset(null, config('nodes:\n  a: {kind: user}\n'), ['a'])).toEqual({ styles: {}, icons: {}, legend: [], warnings: [] });
  });
});

describe('presetFileOf', () => {
  test('only a file reference gives a path', () => {
    expect(presetFileOf(parseConfig('preset: cloud\n').config)).toBeNull();
    expect(presetFileOf(parseConfig('preset: ./packs/t.yaml\n').config)).toBe('packs/t.yaml');
    expect(presetFileOf(parseConfig('title: x\n').config)).toBeNull();
    expect(presetFileOf(null)).toBeNull();
  });
});
