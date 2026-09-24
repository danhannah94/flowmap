// v1.1 config (§4): a block's own `style`, `notes`, `show_title`, and the ConfigDoc operations that write them (UI35,
// UI41, UI42), each checked for byte preservation on a comment-rich file (every untouched line identical).
import {
  checkNoteClashes, ConfigDoc, fieldSuggestions, legend, parseConfig, resolveStyle, type EditResult,
} from './index';
import { lineDiff, parse } from './testkit';

type Obj = Record<string, any>;

/** A comment-rich v1.1 config: odd indents, flow and block maps, comments inside entries, a trailing comment. */
const RICH11 = `# v1.1 config (hand-maintained; keep comments)
version: 1
title:   Purchase request   # shown above the diagram
owner: ops-team        # unknown key, kept

styles:                    # applied top to bottom
  - legend: Waiting
    match: {kind: wait}
    style: {fill: "#fff2cc", badge: wait}

nodes:
    intake:                # 4-space indent here
        confidence: confirmed
        source: [sam-09-01, lee-09-03]
    r01:
        system: excel
        # the famous spreadsheet
        quote: "the form is a spreadsheet somebody made in 2014"
    p05:
        kind: wait
        style:             # hand-set colours
            text_color: "#333"
            border_style: dotted
            fill: {light: "#fff", dark: "#000"}
        # end of p05
    q09: {style: {border_color: "#abc"}}

notes:                     # free text on the canvas
  note1:
    text: Freight is the long pole   # from ops
    font_size: 18
  # a second note
  note2: {text: "Two\\nlines", bold: true, color: {light: "#333", dark: "#eee"}}

# trailing comment
`;

function ok(r: EditResult): string {
  if (!r.ok) throw new Error(`refused: ${r.error}`);
  if (r.text === null) throw new Error('no file');
  if (parseConfig(r.text).problems.errors.length) throw new Error(`invalid result:\n${r.text}`);
  return r.text;
}
function refused(r: EditResult): string {
  if (r.ok) throw new Error(`expected a refusal, got:\n${r.text}`);
  return r.error;
}
/** Exactly these original lines changed or went away; every other line survives byte for byte. */
function changed(before: string, after: string, lines: string[]) {
  expect(lineDiff(before, after).removed.sort()).toEqual([...lines].sort());
}
const added = (before: string, after: string) => lineDiff(before, after).added;
const base = (): Obj => parse(RICH11) as Obj;
const rich = new ConfigDoc(RICH11);

const L = {
  r01quote: '        quote: "the form is a spreadsheet somebody made in 2014"',
  p05style: '        style:             # hand-set colours',
  p05text: '            text_color: "#333"',
  p05border: '            border_style: dotted',
  p05fill: '            fill: {light: "#fff", dark: "#000"}',
  q09: '    q09: {style: {border_color: "#abc"}}',
  note1text: '    text: Freight is the long pole   # from ops',
  note1size: '    font_size: 18',
  note2: '  note2: {text: "Two\\nlines", bold: true, color: {light: "#333", dark: "#eee"}}',
  notesHead: 'notes:                     # free text on the canvas',
  note1head: '  note1:',
  note2comment: '  # a second note',
};

describe('parse: the v1.1 config file', () => {
  test('RICH11 parses clean', () => {
    const r = parseConfig(RICH11);
    expect(r.problems.errors).toEqual([]);
    expect(r.problems.warnings.map((p) => p.code)).toEqual(['W-config-key']); // owner
    const c = r.config!;
    expect(c.nodeStyles).toEqual({
      p05: { text_color: '#333333', border_style: 'dotted', fill: { light: '#ffffff', dark: '#000000' } },
      q09: { border_color: '#aabbcc' },
    });
    expect(c.notes).toEqual({
      note1: { text: 'Freight is the long pole', font_size: 18 },
      note2: { text: 'Two\nlines', bold: true, color: { light: '#333333', dark: '#eeeeee' } },
    });
    expect(c.showTitle).toBe(true);
    expect(c.nodes.p05!.style).toEqual({ text_color: '#333', border_style: 'dotted', fill: { light: '#fff', dark: '#000' } });
  });

  describe("a block's own style", () => {
    const cfg = (nodes: string) => parseConfig(`styles:\n  - legend: All\n    match: {}\n    style: {fill: "#111", border_width: 2}\nnodes:\n${nodes}`);
    test('applies after every rule, to that node only, and never in the legend', () => {
      const c = cfg('  a:\n    style: {fill: "#F96", badge: mine}\n').config!;
      expect(resolveStyle(c, { id: 'a', lane: 'l', label: 'A', kind: 'step' })).toEqual({ fill: '#ff9966', border_width: 2, badge: 'mine' });
      expect(resolveStyle(c, { id: 'b', lane: 'l', label: 'B', kind: 'step' })).toEqual({ fill: '#111111', border_width: 2 });
      expect(legend(c)).toEqual([{ text: 'All', style: { fill: '#111111', border_width: 2 } }]);
    });
    test('bad properties are W-style and ignored, as in rules', () => {
      const r = cfg('  a:\n    style: {border_width: 5, glow: 1, fill: red, text_color: {dark: "#000"}, border_style: dashed}\n');
      expect(r.problems.errors).toEqual([]);
      expect(r.problems.warnings.map((p) => p.code)).toEqual(['W-style', 'W-style', 'W-style', 'W-style']);
      expect(r.problems.warnings.every((p) => p.message.includes('node "a" style'))).toBe(true);
      expect(r.config!.nodeStyles).toEqual({ a: { border_style: 'dashed' } });
    });
    test('a style that isn\'t a map is W-style and ignored; a null style is no style', () => {
      const r = cfg('  a:\n    style: red\n  b:\n    style:\n');
      expect(r.problems.errors).toEqual([]);
      expect(r.problems.warnings.map((p) => [p.code, p.message.includes('"a"')])).toEqual([['W-style', true]]);
      expect(r.config!.nodeStyles).toEqual({});
    });
    test('every match on style is false, including present and absent', () => {
      for (const cond of ['{style: present}', '{style: absent}', '{style: fancy}', '{kind: step, style: absent}']) {
        const c = parseConfig(`styles:\n  - match: ${cond}\n    style: {badge: hit}\nnodes:\n  a:\n    style: fancy\n  b:\n    kind: x\n`).config!;
        for (const id of ['a', 'b', 'c']) expect(resolveStyle(c, { id, lane: 'l', label: id, kind: 'step' }).badge).toBeUndefined();
      }
    });
    test('style is not offered as a field suggestion from nodes', () => {
      const c = parseConfig('nodes:\n  a:\n    style: fancy\n').config!;
      expect(fieldSuggestions(c, 'style')).toEqual([]);
    });
  });

  describe('notes', () => {
    const notes = (body: string) => parseConfig(`notes:\n${body}`);
    test('defaults are absent; each property read', () => {
      expect(notes('  n1:\n    text: Hi\n').config!.notes).toEqual({ n1: { text: 'Hi' } });
      expect(notes('  n1: {text: Hi, font_size: 10, bold: false, color: "#ABC"}\n  n2: {text: x, font_size: 48}\n').config!.notes)
        .toEqual({ n1: { text: 'Hi', font_size: 10, bold: false, color: '#aabbcc' }, n2: { text: 'x', font_size: 48 } });
    });
    test('text may hold line breaks; trailing ones are dropped (a YAML | block adds one)', () => {
      expect(notes('  n1:\n    text: |\n      one\n      two\n').config!.notes.n1!.text).toBe('one\ntwo');
      expect(notes('  n1: {text: "  lead and  inner  "}\n').config!.notes.n1!.text).toBe('  lead and  inner  ');
    });
    test.each([
      ['missing text', '  n1: {bold: true}\n'],
      ['blank text', '  n1: {text: "   "}\n'],
      ['only line breaks', '  n1: {text: "\\n\\n"}\n'],
      ['text a number', '  n1: {text: 2024}\n'],
      ['text a list', '  n1: {text: [a]}\n'],
      ['a null entry', '  n1:\n'],
      ['an entry that is text', '  n1: hello\n'],
      ['an id that breaks the id rules', '  "my note": {text: x}\n'],
      ['a reserved id', '  end: {text: x}\n'],
      ['an id starting end_', '  end_1: {text: x}\n'],
    ])('E-config (line null): %s', (_n, body) => {
      const r = notes(body);
      expect(r.config).toBeNull();
      expect(r.problems.errors.map((p) => [p.code, p.line])).toEqual([['E-config', null]]);
    });
    test('notes that isn\'t a map is E-config; a null notes is none', () => {
      expect(parseConfig('notes: [a]\n').problems.errors.map((p) => p.code)).toEqual(['E-config']);
      expect(parseConfig('notes:\n').config!.notes).toEqual({});
    });
    test.each([
      ['font_size 9', 'font_size: 9'], ['font_size 49', 'font_size: 49'], ['font_size 14.5', 'font_size: 14.5'],
      ['font_size "14"', 'font_size: "14"'], ['bold "yes"', 'bold: "yes"'], ['bold 1', 'bold: 1'],
      ['color red', 'color: red'], ['color dark only', 'color: {dark: "#000"}'], ['color with a bad key', 'color: {light: "#000", dim: "#111"}'],
    ])('W-style, property ignored: %s', (_n, prop) => {
      const r = notes(`  n1: {text: Hi, ${prop}}\n`);
      expect(r.problems.errors).toEqual([]);
      expect(r.problems.warnings.map((p) => p.code)).toEqual(['W-style']);
      expect(r.config!.notes.n1).toEqual({ text: 'Hi' });
    });
    test('an unknown key in a note is W-config-key', () => {
      const r = notes('  n1: {text: Hi, size: 3}\n');
      expect(r.problems.warnings.map((p) => p.code)).toEqual(['W-config-key']);
    });
    test('a note id equal to a node or subgraph id is E-config (checked against the diagram)', () => {
      const c = notes('  a: {text: x}\n  lane1: {text: y}\n  n9: {text: z}\n').config!;
      const e = checkNoteClashes(c, ['a', 'b'], ['lane1']);
      expect(e.map((p) => [p.code, p.line])).toEqual([['E-config', null], ['E-config', null]]);
      expect(e[0]!.message).toContain('"a"');
      expect(e[1]!.message).toContain('"lane1"');
      expect(checkNoteClashes(null, ['a'], [])).toEqual([]);
    });
  });

  describe('show_title and the top-level keys', () => {
    test('false hides; true and absent and null show', () => {
      expect(parseConfig('show_title: false\n').config!.showTitle).toBe(false);
      expect(parseConfig('show_title: true\n').config!.showTitle).toBe(true);
      expect(parseConfig('show_title:\n').config!.showTitle).toBe(true);
      expect(parseConfig('title: x\n').config!.showTitle).toBe(true);
    });
    test('anything else is E-config', () => {
      for (const v of ['"false"', 'no', '0', '[false]']) {
        expect(parseConfig(`show_title: ${v}\n`).problems.errors.map((p) => p.code)).toEqual(['E-config']);
      }
    });
    test('show_title and notes are known keys (no W-config-key); others still warn', () => {
      expect(parseConfig('show_title: false\nnotes: {}\n').problems).toEqual({ errors: [], warnings: [] });
      expect(parseConfig('note: {}\n').problems.warnings.map((p) => p.code)).toEqual(['W-config-key']);
    });
  });
});

describe("ConfigDoc: a block's colours (UI35), byte-preserving", () => {
  test('set a colour on a node without a style: appended at the end of its entry, inline', () => {
    const out = ok(rich.setBlockColor(['r01'], 'fill', '#FFF2CC', null));
    changed(RICH11, out, []);
    expect(added(RICH11, out)).toEqual(['        style: {fill: "#fff2cc"}']);
    expect(out.indexOf('style: {fill: "#fff2cc"}')).toBeGreaterThan(out.indexOf(L.r01quote));
    const want = base();
    want.nodes.r01.style = { fill: '#fff2cc' };
    expect(parse(out)).toEqual(want);
  });
  test('light and dark give {light, dark}; equal values give one colour; #rgb kept as entered', () => {
    expect((parse(ok(rich.setBlockColor(['r01'], 'border_color', '#abc', '#123456'))) as Obj).nodes.r01.style)
      .toEqual({ border_color: { light: '#abc', dark: '#123456' } });
    expect((parse(ok(rich.setBlockColor(['r01'], 'text_color', '#ABC', '#aabbcc'))) as Obj).nodes.r01.style).toEqual({ text_color: '#abc' });
  });
  test('change an existing colour in a block style: only that line changes', () => {
    const out = ok(rich.setBlockColor(['p05'], 'text_color', '#444', null));
    changed(RICH11, out, [L.p05text]);
    expect(out).toContain('            text_color: "#444"');
  });
  test('change a colour inside a flow style: only that line changes', () => {
    const out = ok(rich.setBlockColor(['q09'], 'fill', '#000', null));
    changed(RICH11, out, [L.q09]);
    expect(out).toContain('    q09: {style: {border_color: "#abc", fill: "#000"}}');
  });
  test('a new node entry is appended at the end of nodes; several blocks in the given order', () => {
    const out = ok(rich.setBlockColor(['zz', 'intake', 'aa'], 'fill', '#111', null));
    changed(RICH11, out, []);
    const want = base();
    want.nodes.zz = { style: { fill: '#111' } };
    want.nodes.intake.style = { fill: '#111' };
    want.nodes.aa = { style: { fill: '#111' } };
    expect(parse(out)).toEqual(want);
    expect(Object.keys((parse(out) as Obj).nodes)).toEqual(['intake', 'r01', 'p05', 'q09', 'zz', 'aa']);
  });
  test('clear one colour: only its line goes', () => {
    const out = ok(rich.setBlockColor(['p05'], 'text_color', '', ''));
    changed(RICH11, out, [L.p05text]);
    const want = base();
    delete want.nodes.p05.style.text_color;
    expect(parse(out)).toEqual(want);
  });
  test('clearing the last property empties style: it goes; an emptied entry goes too', () => {
    const out = ok(rich.setBlockColor(['q09'], 'border_color', null, null));
    changed(RICH11, out, [L.q09]);
    const want = base();
    delete want.nodes.q09;
    expect(parse(out)).toEqual(want);
    const src = 'nodes:\n  a:\n    kind: x\n    style: {fill: "#fff"}\n';
    expect(ok(new ConfigDoc(src).setBlockColor(['a'], 'fill', null, null))).toBe('nodes:\n  a:\n    kind: x\n');
    expect(ok(new ConfigDoc('nodes:\n  a:\n    style: {fill: "#fff"}\n').setBlockColor(['a'], 'fill', null, null))).toBe('nodes: {}\n');
  });
  test('clearing a colour a block doesn\'t have changes nothing', () => {
    expect(ok(rich.setBlockColor(['r01', 'ghost'], 'fill', null, null))).toBe(RICH11);
  });
  test('reset colours: fill, border and text colour go; other hand-written properties stay', () => {
    const out = ok(rich.resetBlockColors(['p05', 'q09', 'r01']));
    changed(RICH11, out, [L.p05text, L.p05fill, L.q09]);
    const want = base();
    want.nodes.p05.style = { border_style: 'dotted' };
    delete want.nodes.q09;
    expect(parse(out)).toEqual(want);
  });
  test('reset colours on a style with only colours removes style', () => {
    const src = 'nodes:\n  a:   # the a node\n    style:\n      fill: "#fff"\n      text_color: "#000"\n    owner: sam\n';
    expect(ok(new ConfigDoc(src).resetBlockColors(['a']))).toBe('nodes:\n  a:   # the a node\n    owner: sam\n');
  });
  test('a swatch sets only the fill: light and dark, or one colour when equal', () => {
    const out = ok(rich.applySwatch(['p05', 'r01'], '#D5E8D4', '#1e3a1e'));
    changed(RICH11, out, [L.p05fill]);
    const want = base();
    want.nodes.p05.style.fill = { light: '#d5e8d4', dark: '#1e3a1e' };
    want.nodes.r01.style = { fill: { light: '#d5e8d4', dark: '#1e3a1e' } };
    expect(parse(out)).toEqual(want);
    expect((parse(ok(rich.applySwatch(['r01'], '#FFF', '#ffffff'))) as Obj).nodes.r01.style).toEqual({ fill: '#fff' });
  });
  test('refusals: a dark colour without a light one; not a colour; a swatch with no light colour', () => {
    expect(refused(rich.setBlockColor(['r01'], 'fill', '', '#000'))).toMatch(/light/);
    expect(refused(rich.setBlockColor(['r01'], 'fill', 'red', null))).toMatch(/colour/);
    expect(refused(rich.setBlockColor(['r01'], 'badge' as never, '#000', null))).toMatch(/colour property/);
    expect(refused(rich.applySwatch(['r01'], '', '#000'))).toMatch(/light/);
  });
  test('no file: created with version 1 and only the style', () => {
    expect(new ConfigDoc(null).setBlockColor(['n1'], 'fill', '#fff', null))
      .toEqual({ ok: true, text: 'version: 1\nnodes:\n  n1:\n    style: {fill: "#fff"}\n' });
    expect(new ConfigDoc(null).resetBlockColors(['n1'])).toEqual({ ok: true, text: null });
  });
  test('the field form refuses the key style (set and remove); node YAML includes it', () => {
    expect(refused(rich.setNodeField('r01', 'style', { type: 'text', value: 'x' }))).toMatch(/style/);
    expect(refused(rich.setFieldOnNodes(['r01', 'p05'], 'style', { type: 'yaml', text: '{fill: "#fff"}' }))).toMatch(/style/);
    expect(refused(rich.removeFieldFromNodes(['p05'], 'style'))).toMatch(/style/);
    expect(rich.nodeYaml('p05')).toContain('style:');
    expect(rich.nodeYaml('p05')).toContain('fill: {light: "#fff", dark: "#000"}');
    const out = ok(rich.replaceNodeEntry('r01', 'system: excel\nstyle: {fill: "#abc"}\n'));
    expect((parse(out) as Obj).nodes.r01).toEqual({ system: 'excel', style: { fill: '#abc' } });
  });
  test('a style written through node YAML is inline', () => {
    const out = ok(new ConfigDoc('nodes: {}\n').replaceNodeEntry('a', 'style:\n  fill:\n    light: "#fff"\n    dark: "#000"\n'));
    expect(out).toBe('nodes:\n  a:\n    style: {fill: {light: "#fff", dark: "#000"}}\n');
  });
});

describe('ConfigDoc: notes (UI41), byte-preserving', () => {
  test('add a note: appended at the end of notes', () => {
    const out = ok(rich.addNote('note3', 'Ask Sam'));
    changed(RICH11, out, []);
    expect(added(RICH11, out)).toEqual(['  note3:', '    text: Ask Sam']);
    const want = base();
    want.notes.note3 = { text: 'Ask Sam' };
    expect(parse(out)).toEqual(want);
    expect(Object.keys((parse(out) as Obj).notes)).toEqual(['note1', 'note2', 'note3']);
  });
  test('a note with line breaks; trailing breaks dropped; text that reads as another type is quoted', () => {
    const out = ok(rich.addNote('note3', 'one\ntwo\n\n'));
    expect((parse(out) as Obj).notes.note3).toEqual({ text: 'one\ntwo' });
    expect((parse(ok(rich.addNote('note3', 'true'))) as Obj).notes.note3).toEqual({ text: 'true' });
    expect((parse(ok(rich.addNote('note3', '2024'))) as Obj).notes.note3).toEqual({ text: '2024' });
  });
  test('a first note in a file without notes: the key goes at the very end (R5.7)', () => {
    const src = 'version: 1\nnodes: {}\n# tail\n';
    expect(ok(new ConfigDoc(src).addNote('note1', 'Hi'))).toBe('version: 1\nnodes: {}\n# tail\nnotes:\n  note1:\n    text: Hi\n');
    expect(new ConfigDoc(null).addNote('note1', 'Hi')).toEqual({ ok: true, text: 'version: 1\nnotes:\n  note1:\n    text: Hi\n' });
  });
  test('refusals: blank text, an existing note, a bad or reserved id, a node entry of that id', () => {
    expect(refused(rich.addNote('note3', '  \n '))).toMatch(/text/);
    expect(refused(rich.addNote('note1', 'x'))).toMatch(/already/);
    expect(refused(rich.addNote('my note', 'x'))).toMatch(/not a valid/);
    expect(refused(rich.addNote('end', 'x'))).toMatch(/not a valid/);
    expect(refused(rich.addNote('r01', 'x'))).toMatch(/already used/);
  });
  test('edit a note\'s text: only that line changes, its comment stays', () => {
    const out = ok(rich.setNoteText('note1', 'Freight is slow'));
    changed(RICH11, out, [L.note1text]);
    expect(out).toContain('    text: Freight is slow   # from ops');
    const out2 = ok(rich.setNoteText('note2', 'One line'));
    changed(RICH11, out2, [L.note2]);
    expect((parse(out2) as Obj).notes.note2.text).toBe('One line');
    expect(refused(rich.setNoteText('note1', ''))).toMatch(/text/);
    expect(refused(rich.setNoteText('nope', 'x'))).toMatch(/no note/);
  });
  test('font size: set, change, default removes the key, out of range refused', () => {
    changed(RICH11, ok(rich.setNoteFontSize('note1', 20)), [L.note1size]);
    const reset = ok(rich.setNoteFontSize('note1', 14));
    changed(RICH11, reset, [L.note1size]);
    expect((parse(reset) as Obj).notes.note1).toEqual({ text: 'Freight is the long pole' });
    expect(ok(rich.setNoteFontSize('note1', null))).toBe(reset);
    const add = ok(rich.setNoteFontSize('note2', 12));
    changed(RICH11, add, [L.note2]);
    expect(add).toContain('  note2: {text: "Two\\nlines", bold: true, color: {light: "#333", dark: "#eee"}, font_size: 12}');
    for (const bad of [9, 49, 14.5]) expect(refused(rich.setNoteFontSize('note1', bad))).toMatch(/10 to 48/);
  });
  test('bold: true writes it, false removes it', () => {
    const b = ok(rich.setNoteBold('note1', true));
    changed(RICH11, b, []);
    expect((parse(b) as Obj).notes.note1.bold).toBe(true);
    const nb = ok(rich.setNoteBold('note2', false));
    changed(RICH11, nb, [L.note2]);
    expect((parse(nb) as Obj).notes.note2).toEqual({ text: 'Two\nlines', color: { light: '#333', dark: '#eee' } });
  });
  test('colour: light and dark, one colour, cleared (the default) removes the key', () => {
    expect((parse(ok(rich.setNoteColor('note1', '#B85450', '#F08080'))) as Obj).notes.note1.color).toEqual({ light: '#b85450', dark: '#f08080' });
    expect((parse(ok(rich.setNoteColor('note1', '#111', ''))) as Obj).notes.note1.color).toBe('#111');
    const cleared = ok(rich.setNoteColor('note2', null, null));
    changed(RICH11, cleared, [L.note2]);
    expect((parse(cleared) as Obj).notes.note2).toEqual({ text: 'Two\nlines', bold: true });
    expect(refused(rich.setNoteColor('note1', null, '#000'))).toMatch(/light/);
  });
  test('delete a note: its lines go; deleting the last note removes notes', () => {
    const one = ok(rich.deleteNote('note1'));
    changed(RICH11, one, [L.note1head, L.note1text, L.note1size]);
    const want = base();
    delete want.notes.note1;
    expect(parse(one)).toEqual(want);
    const none = ok(new ConfigDoc(one).deleteNote('note2'));
    const want2 = base();
    delete want2.notes;
    expect(parse(none)).toEqual(want2);
    expect(none).not.toMatch(/^notes:/m);
    expect(none).toContain('# trailing comment');
    expect(ok(rich.deleteNote('nope'))).toBe(RICH11);
  });
});

describe('ConfigDoc: title visibility (UI42)', () => {
  test('hide writes show_title: false at the end; show removes it; true is never written', () => {
    const hidden = ok(rich.setShowTitle(false));
    changed(RICH11, hidden, []);
    expect(hidden.endsWith('# trailing comment\nshow_title: false\n')).toBe(true);
    expect(parseConfig(hidden).config!.showTitle).toBe(false);
    expect(ok(new ConfigDoc(hidden).setShowTitle(true))).toBe(RICH11);
    expect(ok(rich.setShowTitle(true))).toBe(RICH11);
  });
  test('an existing show_title line is edited in place, keeping its comment', () => {
    const src = 'version: 1\nshow_title: true   # visible\nnodes: {}\n';
    expect(ok(new ConfigDoc(src).setShowTitle(false))).toBe('version: 1\nshow_title: false   # visible\nnodes: {}\n');
    expect(ok(new ConfigDoc(src).setShowTitle(true))).toBe('version: 1\nnodes: {}\n');
  });
  test('no file: hiding creates it; showing creates nothing', () => {
    expect(new ConfigDoc(null).setShowTitle(false)).toEqual({ ok: true, text: 'version: 1\nshow_title: false\n' });
    expect(new ConfigDoc(null).setShowTitle(true)).toEqual({ ok: true, text: null });
  });
  test('a config with errors refuses every v1.1 edit', () => {
    const broken = new ConfigDoc('notes:\n  n1: {bold: true}\n');
    expect(refused(broken.setShowTitle(false))).toMatch(/errors/);
    expect(refused(broken.addNote('n2', 'x'))).toMatch(/errors/);
    expect(refused(broken.setBlockColor(['a'], 'fill', '#fff', null))).toMatch(/errors/);
  });
});

describe('ConfigDoc: renaming respects note ids', () => {
  test('renaming a node to a note id is refused', () => {
    expect(refused(rich.renameNode('r01', 'note1'))).toMatch(/note/);
  });
});
