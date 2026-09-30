import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigDoc, fieldValueFromForm, parseConfig, type EditResult } from './index';
import { lineDiff, parse, RICH } from './testkit';

type Obj = Record<string, any>;
const PR = readFileSync(join(__dirname, '../../../fixtures/purchase-request/purchase-request.flow.yaml'), 'utf8');

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
/** Pure reordering: the same lines, moved. */
function sameLines(before: string, after: string) {
  expect(after.split('\n').sort()).toEqual(before.split('\n').sort());
}
const base = (): Obj => parse(RICH) as Obj;
const rich = new ConfigDoc(RICH);
const text = (value: string) => ({ type: 'text' as const, value });

// Lines of RICH, by role.
const L = {
  title: 'title:   Purchase request approval   # shown above the diagram',
  laneReq: '  - id: requester          # first',
  laneMgr: '  - id: manager',
  laneMgrExtra: '    colour: blue           # extra key, kept',
  rule0: ['  - legend: Confirmed by two or more people', '    match: { confidence: confirmed }', '    style: {border_style: solid, border_width: 2}'],
  rule1: ['  - legend: One source only', '    match: {confidence: single-source}   # the usual case', '    style:', '      border_style: dashed'],
  rule2: ['  - match: {kind: wait}', '    style: {fill: {light: "#fff2cc", dark: "#4a3f12"}, badge: wait}', '    legend: Waiting on someone'],
  rule3match: '    match: {id: r01, lane: requester}',
  rule3style: '    style: {text_color: "#333"}',
  r01: ['    r01:', '        system: excel', '        # the famous spreadsheet', '        quote: "the form is a spreadsheet somebody made in 2014"'],
  p05: ['    p05:', '        kind: wait', '        variants:', '            main plant: three quotes over $1,000', '            warehouse: one quote is fine under $5,000', '        # end of p05'],
  intakeSource: '        source: [sam-09-01, lee-09-03]',
};

describe('title (UI22)', () => {
  test('set in place, keeping the line comment', () => {
    const out = ok(rich.setTitle('New "title": v2'));
    changed(RICH, out, [L.title]);
    expect(out).toContain('title:   "New \\"title\\": v2"   # shown above the diagram');
    expect(parse(out)).toEqual({ ...base(), title: 'New "title": v2' });
  });
  test('text that would read as another type is quoted', () => {
    expect((parse(ok(rich.setTitle('2024'))) as Obj).title).toBe('2024');
    expect((parse(ok(rich.setTitle('yes'))) as Obj).title).toBe('yes');
  });
  test('clear removes the key', () => {
    const out = ok(rich.setTitle(''));
    changed(RICH, out, [L.title]);
    const want = base();
    delete want.title;
    expect(parse(out)).toEqual(want);
    expect(ok(rich.setTitle(null))).toBe(out);
  });
  test('a new top-level key is appended at the end of the file', () => {
    const src = 'version: 1  # v\nnodes: {}\n# tail\n';
    const out = ok(new ConfigDoc(src).setTitle('T'));
    expect(out).toBe('version: 1  # v\nnodes: {}\n# tail\ntitle: T\n');
    expect(ok(new ConfigDoc('version: 1').setTitle('T'))).toBe('version: 1\ntitle: T\n');
  });
  test('no file: created with version 1 and only the title; clearing creates nothing', () => {
    expect(new ConfigDoc(null).setTitle('My map')).toEqual({ ok: true, text: 'version: 1\ntitle: My map\n' });
    expect(new ConfigDoc(null).setTitle('')).toEqual({ ok: true, text: null });
  });
  test('setting the same title changes nothing', () => {
    expect(ok(rich.setTitle('Purchase request approval'))).toBe(RICH);
  });
});

describe('lanes (UI18–UI21, UI27)', () => {
  test('reorder: every lane in the new order, entries keep their extra keys and their text', () => {
    const out = ok(rich.setLaneOrder(['finance', 'purchasing', 'manager', 'requester']));
    sameLines(RICH, out);
    expect((parse(out) as Obj).lanes).toEqual([
      { id: 'finance' }, { id: 'purchasing' }, { id: 'manager', colour: 'blue' }, { id: 'requester' },
    ]);
  });
  test('stale entries dropped, new lanes added, _unassigned never listed', () => {
    const out = ok(rich.setLaneOrder(['requester', 'purchasing', 'finance', 'vendor', '_unassigned']));
    changed(RICH, out, [L.laneMgr, L.laneMgrExtra]);
    expect((parse(out) as Obj).lanes).toEqual([{ id: 'requester' }, { id: 'purchasing' }, { id: 'finance' }, { id: 'vendor' }]);
    expect(out).toContain('  - id: finance\n  - id: vendor\n\nstyles:');
  });
  test('the same order changes nothing', () => {
    expect(ok(rich.setLaneOrder(['requester', 'manager', 'purchasing', 'finance']))).toBe(RICH);
  });
  test('no lanes key: the list is appended; no file: created', () => {
    const out = ok(new ConfigDoc('version: 1\ntitle: x\n').setLaneOrder(['b', 'a']));
    expect(out).toBe('version: 1\ntitle: x\nlanes:\n  - id: b\n  - id: a\n');
    expect(ok(new ConfigDoc(null).setLaneOrder(['a']))).toBe('version: 1\nlanes:\n  - id: a\n');
  });
  test('flow-style lanes list', () => {
    const src = 'lanes: [{id: a, x: 1}, {id: b}]  # c\n';
    const out = ok(new ConfigDoc(src).setLaneOrder(['b', 'c', 'a']));
    expect(out).toBe('lanes: [{id: b}, {id: c}, {id: a, x: 1}]  # c\n');
  });
  test('append a lane only when the config has a lanes list', () => {
    const out = ok(rich.appendLane('vendor'));
    changed(RICH, out, []);
    expect((parse(out) as Obj).lanes.at(-1)).toEqual({ id: 'vendor' });
    expect(out).toContain('  - id: finance\n  - id: vendor\n');
    expect(ok(new ConfigDoc('title: x\n').appendLane('v'))).toBe('title: x\n');
    expect(new ConfigDoc(null).appendLane('v')).toEqual({ ok: true, text: null });
    expect(ok(rich.appendLane('finance'))).toBe(RICH);
  });
  test('delete a lane entry (with its extra keys); deleting the last leaves lanes: []', () => {
    const out = ok(rich.deleteLaneEntry('manager'));
    changed(RICH, out, [L.laneMgr, L.laneMgrExtra]);
    expect((parse(out) as Obj).lanes.map((l: Obj) => l.id)).toEqual(['requester', 'purchasing', 'finance']);
    const one = ok(new ConfigDoc('lanes:\n  - id: a\n  - id: _unassigned\n  - id: a\n').deleteLaneEntry('a'));
    expect(one).toBe('lanes:\n  - id: _unassigned\n');
    expect(ok(new ConfigDoc(one).deleteLaneEntry('_unassigned'))).toBe('lanes: []\n');
  });
  test('rename a lane: its entry and rules matching lane', () => {
    const out = ok(rich.renameLane('requester', 'req'));
    changed(RICH, out, [L.laneReq, L.rule3match]);
    expect(out).toContain('  - id: req          # first\n');
    expect(out).toContain('    match: {id: r01, lane: req}\n');
    const p = parse(out) as Obj;
    expect(p.lanes[0]).toEqual({ id: 'req' });
    expect(p.styles[3].match).toEqual({ id: 'r01', lane: 'req' });
  });
});

describe('node fields (UI24)', () => {
  test('edit an existing field in place', () => {
    const out = ok(rich.setNodeField('r01', 'system', text('erp')));
    changed(RICH, out, [L.r01[1]!]);
    expect((parse(out) as Obj).nodes.r01).toEqual({ system: 'erp', quote: 'the form is a spreadsheet somebody made in 2014' });
  });
  test('a new field goes at the end of its entry', () => {
    const out = ok(rich.setNodeField('intake', 'owner', text('Pat')));
    changed(RICH, out, []);
    expect(Object.keys((parse(out) as Obj).nodes.intake)).toEqual(['confidence', 'source', 'owner']);
  });
  test('a new node entry goes at the end of nodes', () => {
    const out = ok(rich.setNodeField('n9', 'confidence', text('confirmed')));
    changed(RICH, out, []);
    const p = parse(out) as Obj;
    expect(Object.keys(p.nodes)).toEqual(['intake', 'r01', 'p05', 'n9']);
    expect(p.nodes.n9).toEqual({ confidence: 'confirmed' });
  });
  test.each([['2'], ['true'], ['null'], ['yes'], [''], ['#tag'], ['a: b'], ['2024-09-01'], ['  padded ']])(
    'text %j is written as a string', (v) => {
      expect((parse(ok(rich.setNodeField('n9', 'k', text(v)))) as Obj).nodes.n9.k).toBe(v);
    });
  test('list, map and YAML values', () => {
    let out = ok(rich.setNodeField('r01', 'source', { type: 'list', items: ['a', '2', 'b, c'] }));
    changed(RICH, out, []);
    expect((parse(out) as Obj).nodes.r01.source).toEqual(['a', '2', 'b, c']);
    out = ok(rich.setNodeField('p05', 'variants', { type: 'map', entries: [['main plant', 'one'], ['2', 'true']] }));
    changed(RICH, out, L.p05.slice(3, 5));
    expect((parse(out) as Obj).nodes.p05.variants).toEqual({ 'main plant': 'one', 2: 'true' });
    expect((parse(out) as Obj).nodes.p05.variants['2']).toBe('true');
    out = ok(rich.setNodeField('r01', 'deep', { type: 'yaml', text: 'a: [1, {b: c}]\nd: true\n' }));
    expect((parse(out) as Obj).nodes.r01.deep).toEqual({ a: [1, { b: 'c' }], d: true });
    out = ok(rich.setNodeField('r01', 'n', { type: 'yaml', text: '2' }));
    expect((parse(out) as Obj).nodes.r01.n).toBe(2);
    out = ok(rich.setNodeField('r01', 'empty', { type: 'list', items: [] }));
    expect((parse(out) as Obj).nodes.r01.empty).toEqual([]);
  });
  test('refusals: bad YAML, empty key', () => {
    expect(refused(rich.setNodeField('r01', 'x', { type: 'yaml', text: 'a: [1' }))).toMatch(/not valid YAML/);
    expect(refused(rich.setNodeField('r01', ' ', text('x')))).toMatch(/name/);
  });
  test('set a field on several nodes, in order', () => {
    const out = ok(rich.setFieldOnNodes(['z2', 'intake', 'z1'], 'confidence', text('inferred')));
    changed(RICH, out, ['        confidence: confirmed']);
    const p = parse(out) as Obj;
    expect(Object.keys(p.nodes)).toEqual(['intake', 'r01', 'p05', 'z2', 'z1']);
    expect([p.nodes.intake.confidence, p.nodes.z2.confidence, p.nodes.z1.confidence]).toEqual(['inferred', 'inferred', 'inferred']);
  });
  test('remove a field; removing the last field removes the entry; an emptied nodes is {}', () => {
    let out = ok(rich.removeNodeField('intake', 'source'));
    changed(RICH, out, [L.intakeSource]);
    expect((parse(out) as Obj).nodes.intake).toEqual({ confidence: 'confirmed' });
    out = ok(new ConfigDoc(out).removeNodeField('intake', 'confidence'));
    expect(Object.keys((parse(out) as Obj).nodes)).toEqual(['r01', 'p05']);
    const small = 'nodes:\n  a:\n    x: 1   # c\n# end\n';
    expect(ok(new ConfigDoc(small).removeNodeField('a', 'x'))).toBe('nodes: {}\n# end\n');
    expect(ok(rich.removeNodeField('intake', 'nope'))).toBe(RICH);
    expect(new ConfigDoc(null).removeNodeField('a', 'x')).toEqual({ ok: true, text: null });
  });
  test('remove a field from several nodes', () => {
    const out = ok(rich.removeFieldFromNodes(['p05', 'intake', 'r01'], 'kind'));
    changed(RICH, out, [L.p05[1]!]);
    expect((parse(out) as Obj).nodes.p05.kind).toBeUndefined();
  });
  test('no file: the first field creates version 1 + nodes', () => {
    expect(ok(new ConfigDoc(null).setNodeField('n1', 'confidence', text('confirmed'))))
      .toBe('version: 1\nnodes:\n  n1:\n    confidence: confirmed\n');
  });
  test('field form parsing (§8.3)', () => {
    expect(fieldValueFromForm('list', 'a\n\nb \r\n')).toEqual({ type: 'list', items: ['a', 'b '] });
    expect(fieldValueFromForm('map', 'main plant: a: b\nx:\n')).toEqual({ type: 'map', entries: [['main plant', 'a: b'], ['x', '']] });
    expect(fieldValueFromForm('map', 'nope')).toHaveProperty('error');
    expect(fieldValueFromForm('text', ' x ')).toEqual({ type: 'text', value: ' x ' });
  });
});

describe('node YAML (UI24)', () => {
  test('replace an entry in place', () => {
    const out = ok(rich.replaceNodeEntry('r01', 'system: erp\nsource: [kim]\n'));
    changed(RICH, out, L.r01.slice(1));
    const p = parse(out) as Obj;
    expect(Object.keys(p.nodes)).toEqual(['intake', 'r01', 'p05']);
    expect(p.nodes.r01).toEqual({ system: 'erp', source: ['kim'] });
  });
  test('a node without an entry gets one appended', () => {
    const out = ok(rich.replaceNodeEntry('n3', 'a: "1"'));
    changed(RICH, out, []);
    expect((parse(out) as Obj).nodes.n3).toEqual({ a: '1' });
  });
  test('empty YAML (or {}) removes the entry; a non-map is refused', () => {
    changed(RICH, ok(rich.replaceNodeEntry('r01', '  \n# nothing\n')), L.r01);
    changed(RICH, ok(rich.replaceNodeEntry('r01', '{}')), L.r01);
    expect(refused(rich.replaceNodeEntry('r01', '- a\n- b\n'))).toMatch(/map/);
    expect(refused(rich.replaceNodeEntry('r01', 'just text'))).toMatch(/map/);
    expect(refused(rich.replaceNodeEntry('r01', 'a: [1'))).toMatch(/YAML/);
  });
  test('the entry text round-trips unchanged (comments included)', () => {
    const y = rich.nodeYaml('p05');
    expect(y).toBe('kind: wait\nvariants:\n    main plant: three quotes over $1,000\n    warehouse: one quote is fine under $5,000\n# end of p05\n');
    expect(ok(rich.replaceNodeEntry('p05', y))).toBe(RICH);
    expect(rich.nodeYaml('r01')).toContain('# the famous spreadsheet');
    expect(rich.nodeYaml('nope')).toBe('');
  });
});

describe('rename, copy and delete node entries (UI9, UI13, UI27)', () => {
  test('rename keeps the entry in place and updates rules matching id', () => {
    const out = ok(rich.renameNode('r01', 'r1x'));
    changed(RICH, out, [L.r01[0]!, L.rule3match]);
    const p = parse(out) as Obj;
    expect(Object.keys(p.nodes)).toEqual(['intake', 'r1x', 'p05']);
    expect(p.styles[3].match).toEqual({ id: 'r1x', lane: 'requester' });
  });
  test('rename with only a rule reference, or nothing at all', () => {
    const src = 'styles:\n  - match: {id: a}\n    style: {}\n';
    expect(ok(new ConfigDoc(src).renameNode('a', 'b'))).toBe('styles:\n  - match: {id: b}\n    style: {}\n');
    expect(ok(rich.renameNode('zz', 'yy'))).toBe(RICH);
    expect(new ConfigDoc(null).renameNode('a', 'b')).toEqual({ ok: true, text: null });
  });
  test('rename onto an existing entry is refused', () => {
    expect(refused(rich.renameNode('r01', 'p05'))).toMatch(/p05/);
  });
  test('copy appends a copy of the metadata under the new id', () => {
    const out = ok(rich.copyNode('p05', 'n7'));
    changed(RICH, out, []);
    const p = parse(out) as Obj;
    expect(Object.keys(p.nodes)).toEqual(['intake', 'r01', 'p05', 'n7']);
    expect(p.nodes.n7).toEqual(p.nodes.p05);
    expect(ok(rich.copyNode('nometa', 'n7'))).toBe(RICH);
    expect(refused(rich.copyNode('p05', 'r01'))).toMatch(/r01/);
  });
  test('delete an entry (with the comments inside it)', () => {
    const out = ok(rich.deleteNodeEntry('p05'));
    changed(RICH, out, L.p05);
    let all = out;
    for (const id of ['intake', 'r01']) all = ok(new ConfigDoc(all).deleteNodeEntry(id));
    expect((parse(all) as Obj).nodes).toEqual({});
    expect(all).toContain('\nnodes: {}\n');
    changed(RICH, all, ['nodes:', '    intake:                # 4-space indent here', '        confidence: confirmed',
      L.intakeSource, ...L.r01, ...L.p05]);
  });
});

describe('style rules (UI25)', () => {
  test('add: {match: {}, style: {}} at the end', () => {
    const out = ok(rich.addRule());
    changed(RICH, out, []);
    expect((parse(out) as Obj).styles.at(-1)).toEqual({ match: {}, style: {} });
    expect(out).toContain('    style: {text_color: "#333"}\n  - match: {}\n    style: {}\n');
    expect(ok(new ConfigDoc(null).addRule())).toBe('version: 1\nstyles:\n  - match: {}\n    style: {}\n');
    expect(ok(new ConfigDoc('styles: []\n').addRule())).toBe('styles:\n  - match: {}\n    style: {}\n');
  });
  test('delete a rule; a comment above it stays; the last one leaves styles: []', () => {
    changed(RICH, ok(rich.deleteRule(1)), L.rule1);
    const out = ok(rich.deleteRule(0));
    changed(RICH, out, L.rule0);
    expect(out).toContain('  # Evidence strength\n  - legend: One source only');
    expect(ok(new ConfigDoc('styles:\n  - match: {}\n    style: {}\n').deleteRule(0))).toBe('styles: []\n');
    expect(refused(rich.deleteRule(4))).toMatch(/rule 5/);
  });
  test('move up and down', () => {
    const out = ok(rich.moveRule(0, 'down'));
    sameLines(RICH, out);
    const p = parse(out) as Obj;
    expect(p.styles.map((r: Obj) => r.legend)).toEqual(['One source only', 'Confirmed by two or more people', 'Waiting on someone', 'By id']);
    expect(ok(new ConfigDoc(out).moveRule(1, 'up'))).toBe(RICH);
    expect(ok(rich.moveRule(0, 'up'))).toBe(RICH);
    expect(ok(rich.moveRule(3, 'down'))).toBe(RICH);
    const last = ok(rich.moveRule(3, 'up'));
    sameLines(RICH, last);
    expect((parse(last) as Obj).styles[2].legend).toBe('By id');
  });
  test('legend: set, replace, clear (never touching match/style)', () => {
    let out = ok(rich.setRuleLegend(2, 'Waits'));
    changed(RICH, out, [L.rule2[2]!]);
    out = ok(rich.setRuleLegend(0, ''));
    changed(RICH, out, [L.rule0[0]!, L.rule0[1]!]);
    expect(out).toContain('  - match: { confidence: confirmed }\n    style: {border_style: solid');
    expect((parse(out) as Obj).styles[0]).toEqual({ match: { confidence: 'confirmed' }, style: { border_style: 'solid', border_width: 2 } });
    const added = ok(new ConfigDoc(ok(rich.addRule())).setRuleLegend(4, 'true'));
    expect((parse(added) as Obj).styles[4]).toEqual({ match: {}, style: {}, legend: 'true' });
  });
  test('match conditions: equals, present, absent; edit; delete', () => {
    let out = ok(rich.setMatchCondition(1, 'system', { op: 'present' }));
    changed(RICH, out, [L.rule1[1]!]);
    expect(out).toContain('    match: {confidence: single-source, system: present}   # the usual case\n');
    out = ok(rich.setMatchCondition(0, 'quote', { op: 'absent' }));
    expect((parse(out) as Obj).styles[0].match).toEqual({ confidence: 'confirmed', quote: 'absent' });
    out = ok(rich.setMatchCondition(0, 'n', { op: 'equals', value: '2' }));
    expect((parse(out) as Obj).styles[0].match.n).toBe('2');
    out = ok(rich.setMatchCondition(0, 'confidence', { op: 'equals', value: 'inferred' }));
    changed(RICH, out, [L.rule0[1]!]);
    expect(out).toContain('    match: { confidence: inferred }\n');
    out = ok(rich.editMatchCondition(3, 'lane', 'system', { op: 'equals', value: 'erp' }));
    changed(RICH, out, [L.rule3match]);
    expect(Object.entries((parse(out) as Obj).styles[3].match)).toEqual([['id', 'r01'], ['system', 'erp']]);
    expect(refused(rich.editMatchCondition(3, 'lane', 'id', { op: 'present' }))).toMatch(/already/);
    expect(refused(rich.editMatchCondition(3, 'nope', 'x', { op: 'present' }))).toMatch(/no condition/);
    expect(refused(rich.setMatchCondition(0, '', { op: 'present' }))).toMatch(/field/);
    out = ok(rich.removeMatchCondition(3, 'id'));
    expect((parse(out) as Obj).styles[3].match).toEqual({ lane: 'requester' });
    out = ok(rich.removeMatchCondition(1, 'confidence'));
    changed(RICH, out, [L.rule1[1]!]);
    expect(out).toContain('    match: {}   # the usual case\n');
    const fresh = ok(new ConfigDoc(null).addRule());
    expect(ok(new ConfigDoc(fresh).setMatchCondition(0, 'kind', { op: 'equals', value: 'wait' })))
      .toBe('version: 1\nstyles:\n  - match: {kind: wait}\n    style: {}\n');
  });
  test('style properties: set, replace, clear; enumerations and integers checked', () => {
    let out = ok(rich.setStyleProp(1, 'border_width', '3'));
    changed(RICH, out, []);
    expect(out).toContain('    style:\n      border_style: dashed\n      border_width: 3\n');
    out = ok(rich.setStyleProp(0, 'border_style', 'dotted'));
    changed(RICH, out, [L.rule0[2]!]);
    expect((parse(out) as Obj).styles[0].style).toEqual({ border_style: 'dotted', border_width: 2 });
    out = ok(rich.setStyleProp(0, 'font_style', 'italic'));
    expect(out).toContain('    style: {border_style: solid, border_width: 2, font_style: italic}\n');
    out = ok(rich.setStyleProp(2, 'badge', 'yes'));
    expect((parse(out) as Obj).styles[2].style.badge).toBe('yes');
    out = ok(rich.setStyleProp(2, 'badge', ''));
    expect(out).toContain('    style: {fill: {light: "#fff2cc", dark: "#4a3f12"}}\n');
    out = ok(rich.setStyleProp(1, 'border_style', null));
    changed(RICH, out, [L.rule1[2]!, L.rule1[3]!]);
    expect(out).toContain('    style: {}\n');
    out = ok(rich.setStyleProp(3, 'text_color', null));
    expect((parse(out) as Obj).styles[3].style).toEqual({});
    expect(refused(rich.setStyleProp(0, 'border_style', 'wavy'))).toMatch(/solid/);
    expect(refused(rich.setStyleProp(0, 'font_style', 'underline'))).toMatch(/italic/);
    expect(refused(rich.setStyleProp(0, 'border_width', '2.5'))).toMatch(/whole/);
    expect((parse(ok(rich.setStyleProp(0, 'border_width', 4))) as Obj).styles[0].style.border_width).toBe(4);
  });
  test('colours: single, light+dark, equal dark collapses, lowercase, refusals', () => {
    let out = ok(rich.setStyleColor(0, 'fill', '#ABC', '#000000'));
    changed(RICH, out, [L.rule0[2]!]);
    expect(out).toContain('    style: {border_style: solid, border_width: 2, fill: {light: "#abc", dark: "#000000"}}\n');
    out = ok(rich.setStyleColor(2, 'fill', '#abc', '#AABBCC'));
    expect(out).toContain('    style: {fill: "#abc", badge: wait}\n');
    out = ok(rich.setStyleColor(2, 'fill', '#FFEEDD', ''));
    expect((parse(out) as Obj).styles[2].style.fill).toBe('#ffeedd');
    out = ok(rich.setStyleColor(2, 'fill', null, null));
    expect((parse(out) as Obj).styles[2].style).toEqual({ badge: 'wait' });
    out = ok(rich.setStyleColor(1, 'border_color', '#123', '#456'));
    expect(out).toContain('      border_style: dashed\n      border_color: {light: "#123", dark: "#456"}\n');
    out = ok(rich.setStyleProp(3, 'text_color', '#F00'));
    expect(out).toContain('    style: {text_color: "#f00"}\n');
    expect(refused(rich.setStyleColor(0, 'fill', '', '#000'))).toMatch(/light/);
    expect(refused(rich.setStyleColor(0, 'fill', 'red', null))).toMatch(/colour/);
    expect(refused(rich.setStyleColor(0, 'fill', '#fff', '#12'))).toMatch(/colour/);
  });
  test('replace the whole styles list from YAML', () => {
    const out = ok(rich.replaceStyles('- legend: Only\n  match: {a: "2"}\n  style: {badge: x, glow: 1}\n'));
    const p = parse(out) as Obj;
    expect(p.styles).toEqual([{ legend: 'Only', match: { a: '2' }, style: { badge: 'x', glow: 1 } }]);
    changed(RICH, out, ['styles:                    # applied top to bottom', '  # Evidence strength',
      ...L.rule0, ...L.rule1, ...L.rule2, '  - legend: By id', L.rule3match, L.rule3style]);
    expect(ok(rich.replaceStyles('[]'))).toContain('\nstyles: []\n');
    expect(refused(rich.replaceStyles('a: 1'))).toMatch(/list/);
    expect(refused(rich.replaceStyles(''))).toMatch(/list/);
    expect(refused(rich.replaceStyles('- match: {}\n'))).toMatch(/style/);
    expect(refused(rich.replaceStyles('- match: {a: [1]}\n  style: {}\n'))).toMatch(/single value/);
    expect(refused(rich.replaceStyles('- [1'))).toMatch(/YAML/);
  });
  test('styles YAML round-trips unchanged', () => {
    const y = rich.stylesYaml();
    expect(y.startsWith('- legend: Confirmed by two or more people\n  match: { confidence: confirmed }\n')).toBe(true);
    expect(ok(rich.replaceStyles(y))).toBe(RICH);
    expect(new ConfigDoc(null).stylesYaml()).toBe('');
  });
});

// A17 (§12): rewriting `link:` values after a diagram moves or its folder is renamed. `rewriteLinks` isn't an
// `EditResult` (it never refuses; a config that fails to parse is just left alone), so these check `{text, count}`
// directly rather than going through `ok`/`refused`.
describe('rewriteLinks (A17, §12)', () => {
  const LINKS_FIXTURE = `version: 1
nodes:
  a:
    kind: step
    link: brehob/stage-2   # a comment worth keeping
  b:
    link: brehob/stage-2x
  c:
    kind: wait
  d:
    link: other/thing
`;

  test('rewrites an exact match only, keeping every other byte (a line comment included)', () => {
    const result = new ConfigDoc(LINKS_FIXTURE).rewriteLinks((t) => (t === 'brehob/stage-2' ? 'brehob/hub/stage-2' : null));
    expect(result.count).toBe(1);
    changed(LINKS_FIXTURE, result.text!, ['    link: brehob/stage-2   # a comment worth keeping']);
    expect(result.text).toContain('link: brehob/hub/stage-2   # a comment worth keeping');
    // Everything else — including targets that merely start with the same text — is untouched.
    expect(result.text).toContain('link: brehob/stage-2x');
    expect(result.text).toContain('link: other/thing');
  });

  test('several matches are all rewritten, in one pass', () => {
    const fixture = 'nodes:\n  a:\n    link: x\n  b:\n    link: y\n  c:\n    link: x\n';
    const result = new ConfigDoc(fixture).rewriteLinks((t) => (t === 'x' ? 'z' : null));
    expect(result.count).toBe(2);
    expect(result.text).toBe('nodes:\n  a:\n    link: z\n  b:\n    link: y\n  c:\n    link: z\n');
  });

  test('folder-rename remap: a nested link keeps its tail, a same-prefixed sibling is untouched', () => {
    const fixture = [
      'nodes:', '  a:', '    link: brehob/stage-2', '  b:', '    link: brehob/hub/stage-2',
      '  c:', '    link: brehob-other/x', '  d:', '    link: brehobx/x', '',
    ].join('\n');
    const remap = (t: string) => (t.startsWith('brehob/') ? `brehob-bc/${t.slice('brehob/'.length)}` : null);
    const result = new ConfigDoc(fixture).rewriteLinks(remap);
    expect(result.count).toBe(2);
    expect(result.text).toContain('link: brehob-bc/stage-2');
    expect(result.text).toContain('link: brehob-bc/hub/stage-2');
    expect(result.text).toContain('link: brehob-other/x');
    expect(result.text).toContain('link: brehobx/x');
  });

  test('no-op when nothing links: the exact same text, byte for byte, and count 0', () => {
    const result = new ConfigDoc(RICH).rewriteLinks(() => 'whatever');
    expect(result).toEqual({ text: RICH, count: 0 });
  });

  test('a remap returning the same value back is not a match: no rewrite, count 0', () => {
    const fixture = 'nodes:\n  a:\n    link: x\n';
    const result = new ConfigDoc(fixture).rewriteLinks((t) => t);
    expect(result).toEqual({ text: fixture, count: 0 });
  });

  test('a config that fails to parse is left untouched rather than risked, count 0', () => {
    const broken = 'nodes: [this is: not: valid\n';
    const result = new ConfigDoc(broken).rewriteLinks(() => 'anything');
    expect(result).toEqual({ text: broken, count: 0 });
  });

  test('no file (null text): still safe, nothing to rewrite', () => {
    expect(new ConfigDoc(null).rewriteLinks(() => 'anything')).toEqual({ text: null, count: 0 });
  });
});

describe('safety', () => {
  test('a config with errors refuses every edit', () => {
    const broken = new ConfigDoc('styles: [this is: not: valid\n');
    for (const r of [broken.setTitle('x'), broken.addRule(), broken.setNodeField('a', 'b', text('c')), broken.setLaneOrder(['a'])]) {
      expect(refused(r)).toMatch(/errors/);
    }
    expect(refused(new ConfigDoc('version: 2\n').setTitle('x'))).toMatch(/errors/);
  });
  test('warnings do not block edits; unknown keys are kept', () => {
    const src = 'owner: x\nstyles: [{match: {}, style: {glow: 1}, note: n}]\n';
    const out = ok(new ConfigDoc(src).setStyleProp(0, 'badge', 'b'));
    expect(out).toBe('owner: x\nstyles: [{match: {}, style: {glow: 1, badge: b}, note: n}]\n');
  });
  test('a file without a trailing newline', () => {
    expect(ok(new ConfigDoc('nodes:\n  a:\n    x: 1').setNodeField('a', 'w', text('2')))).toBe('nodes:\n  a:\n    x: 1\n    w: "2"\n');
    expect(ok(new ConfigDoc('styles:\n  - match: {}\n    style: {}').addRule())).toBe('styles:\n  - match: {}\n    style: {}\n  - match: {}\n    style: {}\n');
  });
  test('CRLF files and a document-start marker', () => {
    const crlf = 'version: 1\r\n# c\r\nnodes:\r\n  a:\r\n    x: 1\r\nstyles:\r\n  - match: {}\r\n    style: {}\r\n';
    let out = ok(new ConfigDoc(crlf).setNodeField('a', 'w', text('2')));
    expect((parse(out) as Obj).nodes.a).toEqual({ x: 1, w: '2' });
    expect(out.startsWith('version: 1\r\n# c\r\nnodes:\r\n  a:\r\n    x: 1\r\n')).toBe(true);
    out = ok(new ConfigDoc(out).deleteRule(0));
    expect((parse(out) as Obj).styles).toEqual([]);
    out = ok(new ConfigDoc(crlf).removeNodeField('a', 'x'));
    expect((parse(out) as Obj).nodes).toEqual({});
    const marked = '%YAML 1.2\n---\ntitle: a\n';
    expect(ok(new ConfigDoc(marked).setTitle('b'))).toBe('%YAML 1.2\n---\ntitle: b\n');
    expect(ok(new ConfigDoc(marked).setNodeField('n1', 'k', text('v')))).toBe('%YAML 1.2\n---\ntitle: a\nnodes:\n  n1:\n    k: v\n');
  });
  test('an all-flow config is edited in flow style', () => {
    const src = '{version: 1, nodes: {a: {x: 1}}, styles: [{match: {}, style: {}}]}\n';
    let out = ok(new ConfigDoc(src).setNodeField('b', 'w', text('z')));
    expect(out).toBe('{version: 1, nodes: {a: {x: 1}, b: {w: z}}, styles: [{match: {}, style: {}}]}\n');
    out = ok(new ConfigDoc(out).deleteNodeEntry('a'));
    expect(out).toBe('{version: 1, nodes: {b: {w: z}}, styles: [{match: {}, style: {}}]}\n');
    out = ok(new ConfigDoc(out).addRule());
    expect(out).toBe('{version: 1, nodes: {b: {w: z}}, styles: [{match: {}, style: {}}, {match: {}, style: {}}]}\n');
    out = ok(new ConfigDoc(out).moveRule(0, 'down'));
    out = ok(new ConfigDoc(out).setTitle('T'));
    expect(parse(out)).toEqual({ version: 1, nodes: { b: { w: 'z' } }, styles: [{ match: {}, style: {} }, { match: {}, style: {} }], title: 'T' });
  });
});

describe('round trips on purchase-request.flow.yaml', () => {
  const pr = new ConfigDoc(PR);
  const cfg = parseConfig(PR).config!;
  test('add then remove a field restores the bytes', () => {
    const a = ok(pr.setNodeField('f03', 'owner', text('kim')));
    changed(PR, a, []);
    expect(ok(new ConfigDoc(a).removeNodeField('f03', 'owner'))).toBe(PR);
  });
  test('add then delete a rule restores the bytes', () => {
    const a = ok(pr.addRule());
    changed(PR, a, []);
    expect(ok(new ConfigDoc(a).deleteRule(7))).toBe(PR);
  });
  test('rename a node there and back', () => {
    const a = ok(pr.renameNode('v01', 'v1'));
    changed(PR, a, ['  v01:']);
    expect(ok(new ConfigDoc(a).renameNode('v1', 'v01'))).toBe(PR);
  });
  test('rename a lane there and back', () => {
    const a = ok(pr.renameLane('finance', 'fin'));
    changed(PR, a, ['  - id: finance']);
    expect(ok(new ConfigDoc(a).renameLane('fin', 'finance'))).toBe(PR);
  });
  test('move every rule down and back up', () => {
    for (let i = 0; i < 6; i++) {
      const a = ok(pr.moveRule(i, 'down'));
      sameLines(PR, a);
      expect(ok(new ConfigDoc(a).moveRule(i + 1, 'up'))).toBe(PR);
    }
  });
  test('reorder lanes and back', () => {
    const a = ok(pr.setLaneOrder(['vendor', 'finance', 'purchasing', 'manager', 'requester']));
    sameLines(PR, a);
    expect(ok(new ConfigDoc(a).setLaneOrder(['requester', 'manager', 'purchasing', 'finance', 'vendor']))).toBe(PR);
  });
  test('no-op edits change nothing', () => {
    expect(ok(pr.setTitle(cfg.title))).toBe(PR);
    expect(ok(pr.setLaneOrder(cfg.lanes!.map((l) => l.id)))).toBe(PR);
    expect(ok(pr.replaceStyles(pr.stylesYaml()))).toBe(PR);
    for (const id of Object.keys(cfg.nodes)) expect(ok(pr.replaceNodeEntry(id, pr.nodeYaml(id)))).toBe(PR);
    expect(ok(pr.setNodeField('p03', 'system', text('email')))).toBe(PR);
    expect(ok(pr.setStyleColor(3, 'fill', '#dae8fc', '#1e3a5f'))).toBe(PR);
  });
  test('the v01 comment survives edits to v01', () => {
    const a = ok(pr.setNodeField('v01', 'confidence', text('inferred')));
    changed(PR, a, ['    confidence: confirmed']);
    expect(a).toContain('    # Deliberate: a document shape whose effective kind is wait, so it also gets the waiting style.\n    kind: wait\n    confidence: inferred\n');
  });
  test('a chain of edits stays valid and leaves unrelated lines alone', () => {
    let t = PR;
    const steps: ((d: ConfigDoc) => EditResult)[] = [
      (d) => d.setTitle('Purchase request (v2)'),
      (d) => d.renameNode('p03', 'p3'),
      (d) => d.copyNode('p05', 'n1'),
      (d) => d.setNodeField('n1', 'kind', text('decision')),
      (d) => d.addRule(),
      (d) => d.setMatchCondition(7, 'kind', { op: 'equals', value: 'decision' }),
      (d) => d.setStyleColor(7, 'fill', '#eee', '#222'),
      (d) => d.setRuleLegend(7, 'A decision'),
      (d) => d.moveRule(7, 'up'),
      (d) => d.deleteLaneEntry('vendor'),
      (d) => d.removeNodeField('r02', 'confidence'),
    ];
    for (const s of steps) t = ok(s(new ConfigDoc(t)));
    const p = parse(t) as Obj;
    expect(p.title).toBe('Purchase request (v2)');
    expect(p.nodes.p3).toBeDefined();
    expect(p.nodes.r02).toBeUndefined();
    expect(p.nodes.n1.kind).toBe('decision');
    expect(p.styles[6]).toEqual({ match: { kind: 'decision' }, style: { fill: { light: '#eee', dark: '#222' } }, legend: 'A decision' });
    expect(p.lanes.map((l: Obj) => l.id)).toEqual(['requester', 'manager', 'purchasing', 'finance']);
    // Lines of entries and rules nobody touched are all still there.
    for (const line of ['  - legend: Open question', '    match: {open_question: present}', '  f03:', '    quote: "three-way match, when the receipt shows up"']) {
      expect(t.split('\n')).toContain(line);
    }
  });
});
