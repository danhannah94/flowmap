// Parity tests for evidence and styles (design.md §10 Part 3: P15–P19). The config is compared as parsed YAML, with
// the same original lines removed or changed as the hand edit (every untouched line byte-identical, UI26).
import {
  addRule, deleteOrphanLaneEntry, deleteOrphanNodeEntry, deleteOrphanPin, deleteRule, editMatchCondition, moveRule,
  removeFieldFromNodes, removeMatchCondition, removeNodeField, replaceNodeEntry, replaceStyles, setFieldOnNodes,
  setMatchCondition, setNodeField, setRuleLegend, setStyleColor, setStyleProp,
} from './index';
import { edit, editJson, expectParity, ok, PR, refused, RICH } from './testkit';

const C = RICH.config!;
const NODES_END = '    note: gone from the diagram\n';
const text = (value: string) => ({ type: 'text' as const, value });

describe('P15 metadata fields (UI24)', () => {
  test('text: add to a block with no entry (new entry at the end of nodes)', () => {
    expectParity(setNodeField(RICH, 'm02', 'owner', text('Pat')), RICH, {
      config: edit(C, [NODES_END, `${NODES_END}  m02:\n    owner: Pat\n`]),
    });
  });

  test('text: add to an existing entry (new field at the end), edit, and values that read as other types', () => {
    expectParity(setNodeField(RICH, 'r01', 'owner', text('Kim: ops')), RICH, {
      config: edit(C, ['    confidence: confirmed\n', '    confidence: confirmed\n    owner: "Kim: ops"\n']),
    });
    expectParity(setNodeField(RICH, 'r01', 'system', text('erp')), RICH, {
      config: edit(C, ['    system: excel     # the famous spreadsheet', '    system: erp     # the famous spreadsheet']),
    });
    for (const v of ['2', 'true', 'null', '1.5']) {
      expectParity(setNodeField(RICH, 'r01', 'system', text(v)), RICH, {
        config: edit(C, ['    system: excel     # the famous spreadsheet', `    system: "${v}"`]),
      });
    }
  });

  test('list: add and edit', () => {
    expectParity(setNodeField(RICH, 'm01', 'source', { type: 'list', items: ['a', 'b', '2'] }), RICH, {
      config: edit(C, ['    source: [sam-09-01, lee-09-03]\n', '    source:\n      - a\n      - b\n      - "2"\n']),
    });
    expectParity(setNodeField(RICH, 'r01', 'tags', { type: 'list', items: ['x'] }), RICH, {
      config: edit(C, ['    confidence: confirmed\n', '    confidence: confirmed\n    tags: [x]\n']),
    });
  });

  test('map: add and edit', () => {
    const variants = { type: 'map' as const, entries: [['main plant', 'three quotes'], ['warehouse', '']] as [string, string][] };
    expectParity(setNodeField(RICH, 'r01', 'variants', variants), RICH, {
      config: edit(C, ['    confidence: confirmed\n', '    confidence: confirmed\n    variants:\n      main plant: three quotes\n      warehouse: ""\n']),
    });
    expectParity(setNodeField(PR, 'p05', 'variants', { type: 'map', entries: [['all', 'one quote']] }), PR, {
      config: edit(PR.config!, ['      main plant: three quotes over $1,000\n      warehouse: one quote is fine under $5,000\n', '      all: one quote\n']),
    });
  });

  test('YAML: deeper structures', () => {
    expectParity(setNodeField(RICH, 'm01', 'extra', { type: 'yaml', text: 'a: [1, 2]\nb: {c: d}\n' }), RICH, {
      config: edit(C, ['    source: [sam-09-01, lee-09-03]\n', '    source: [sam-09-01, lee-09-03]\n    extra:\n      a: [1, 2]\n      b:\n        c: d\n']),
    });
    expect(refused(setNodeField(RICH, 'm01', 'extra', { type: 'yaml', text: 'a: [' }))).toMatch(/YAML/);
  });

  test('delete a field; deleting the last one removes the entry', () => {
    expectParity(removeNodeField(RICH, 'r01', 'confidence'), RICH, { config: edit(C, ['    confidence: confirmed\n', '']) });
    const one = ok(removeNodeField(RICH, 'm01', 'kind')).files;
    expectParity(removeNodeField(one, 'm01', 'source'), RICH, {
      config: edit(C, ['  m01:\n    kind: wait\n    source: [sam-09-01, lee-09-03]\n', '']),
    });
    expect(ok(removeNodeField(RICH, 'm02', 'nope')).files.config).toBe(C);
  });

  test('set a field on several blocks: new entries appended in file declaration order', () => {
    const after = expectParity(setFieldOnNodes(RICH, ['m02', 'r01', 'loose'], 'confidence', text('inferred')), RICH, {
      config: edit(C,
        ['    confidence: confirmed\n', '    confidence: inferred\n'],
        [NODES_END, `${NODES_END}  loose:\n    confidence: inferred\n  m02:\n    confidence: inferred\n`]),
    });
    expect(after.config!.indexOf('  loose:')).toBeLessThan(after.config!.indexOf('  m02:'));
  });

  test('remove a named field from several blocks', () => {
    expectParity(removeFieldFromNodes(RICH, ['r01', 'm01', 'm02'], 'kind'), RICH, { config: edit(C, ['    kind: wait\n', '']) });
  });

  test('no config file: created with version 1 and the entry', () => {
    const none = { ...RICH, config: null };
    expectParity(setNodeField(none, 'loose', 'owner', text('Pat')), none, { config: 'version: 1\nnodes:\n  loose:\n    owner: Pat\n' });
    expect(ok(removeNodeField(none, 'loose', 'owner')).files.config).toBeNull();
  });

  test('refusals: unknown block, empty key', () => {
    expect(refused(setNodeField(RICH, 'n1', 'x', text('y')))).toMatch(/no block/);
    expect(refused(setFieldOnNodes(RICH, ['r01', 'zz'], 'x', text('y')))).toMatch(/no block/);
    expect(refused(setNodeField(RICH, 'r01', ' ', text('y')))).toMatch(/name/);
  });
});

describe('P16 node YAML (UI24)', () => {
  test('replace an entry', () => {
    expectParity(replaceNodeEntry(RICH, 'r01', 'system: erp\nowner: kim\nsource: [a, b]\n'), RICH, {
      config: edit(C, ['    system: excel     # the famous spreadsheet\n    confidence: confirmed\n', '    system: erp\n    owner: kim\n    source: [a, b]\n']),
    });
  });

  test('a new entry is appended', () => {
    expectParity(replaceNodeEntry(RICH, 'ghost', 'seen: never'), RICH, {
      config: edit(C, [NODES_END, `${NODES_END}  ghost:\n    seen: never\n`]),
    });
  });

  test('empty YAML or {} removes the entry', () => {
    for (const empty of ['', '  \n', '{}', '# nothing\n']) {
      expectParity(replaceNodeEntry(RICH, 'm01', empty), RICH, {
        config: edit(C, ['  m01:\n    kind: wait\n    source: [sam-09-01, lee-09-03]\n', '']),
      });
    }
  });

  test('refusals: not a map, invalid YAML, unknown block', () => {
    expect(refused(replaceNodeEntry(RICH, 'r01', '[1, 2]'))).toMatch(/map/);
    expect(refused(replaceNodeEntry(RICH, 'r01', 'just text'))).toMatch(/map/);
    expect(refused(replaceNodeEntry(RICH, 'r01', 'a: [\n'))).toMatch(/YAML/);
    expect(refused(replaceNodeEntry(RICH, 'zz', 'a: b'))).toMatch(/no block/);
  });
});

describe('P17 style rules (UI25)', () => {
  const RULE2 = '  - match: {confidence: confirmed}\n    style: {border_width: 2}\n';

  test('add: {match: {}, style: {}} at the end', () => {
    expectParity(addRule(RICH), RICH, { config: edit(C, [RULE2, `${RULE2}  - match: {}\n    style: {}\n`]) });
    expectParity(addRule({ ...PR, config: null }), { ...PR, config: null }, { config: 'version: 1\nstyles:\n  - match: {}\n    style: {}\n' });
  });

  test('legend: set, change, clear', () => {
    expectParity(setRuleLegend(RICH, 2, 'Confirmed: 2+'), RICH, { config: edit(C, [RULE2, `${RULE2}    legend: "Confirmed: 2+"\n`]) });
    expectParity(setRuleLegend(RICH, 0, 'Form'), RICH, { config: edit(C, ['  - legend: The form', '  - legend: Form']) });
    expectParity(setRuleLegend(RICH, 0, ''), RICH, { config: edit(C, ['  - legend: The form\n    match: { id: r01 }', '  - match: { id: r01 }']) });
  });

  test('conditions: equals, present, absent; a typed number is written as a string', () => {
    expectParity(setMatchCondition(RICH, 2, 'system', { op: 'equals', value: 'erp' }), RICH, {
      config: edit(C, ['match: {confidence: confirmed}', 'match: {confidence: confirmed, system: erp}']),
    });
    expectParity(setMatchCondition(RICH, 1, 'open_question', { op: 'present' }), RICH, {
      config: edit(C, ['match: {lane: requester}', 'match: {lane: requester, open_question: present}']),
    });
    expectParity(setMatchCondition(RICH, 1, 'lane', { op: 'absent' }), RICH, {
      config: edit(C, ['match: {lane: requester}', 'match: {lane: absent}']),
    });
    expectParity(setMatchCondition(RICH, 2, 'level', { op: 'equals', value: '2' }), RICH, {
      config: edit(C, ['match: {confidence: confirmed}', 'match: {confidence: confirmed, level: "2"}']),
    });
  });

  test('conditions: edit (rename the field in place), delete', () => {
    expectParity(editMatchCondition(RICH, 0, 'id', 'owner', { op: 'equals', value: 'kim' }), RICH, {
      config: edit(C, ['match: { id: r01 }', 'match: { owner: kim }']),
    });
    expectParity(removeMatchCondition(RICH, 1, 'lane'), RICH, { config: edit(C, ['match: {lane: requester}', 'match: {}']) });
    expect(refused(editMatchCondition(RICH, 0, 'nope', 'x', { op: 'present' }))).toMatch(/no condition/);
  });

  test('each property: set and clear', () => {
    const S0 = 'style: {border_style: dashed}';
    const cases: [ReturnType<typeof setStyleProp>, string][] = [
      [setStyleProp(RICH, 0, 'border_style', 'dotted'), 'style: {border_style: dotted}'],
      [setStyleProp(RICH, 0, 'border_width', 3), 'style: {border_style: dashed, border_width: 3}'],
      [setStyleProp(RICH, 0, 'border_width', '4'), 'style: {border_style: dashed, border_width: 4}'],
      [setStyleProp(RICH, 0, 'font_style', 'italic'), 'style: {border_style: dashed, font_style: italic}'],
      [setStyleProp(RICH, 0, 'badge', '2'), 'style: {border_style: dashed, badge: "2"}'],
      [setStyleProp(RICH, 0, 'border_style', null), 'style: {}'],
      [setStyleProp(RICH, 0, 'border_style', ''), 'style: {}'],
      [setStyleColor(RICH, 0, 'fill', '#ABC', null), 'style: {border_style: dashed, fill: "#abc"}'],
      [setStyleColor(RICH, 0, 'border_color', '#aabbcc', '#123'), 'style: {border_style: dashed, border_color: {light: "#aabbcc", dark: "#123"}}'],
      [setStyleColor(RICH, 0, 'text_color', '#abc', '#AABBCC'), 'style: {border_style: dashed, text_color: "#abc"}'],
    ];
    for (const [r, line] of cases) expectParity(r, RICH, { config: edit(C, [S0, line]) });
  });

  test('colours on a block-style rule: change light and dark, drop dark, clear', () => {
    const F = '      fill: {light: "#dae8fc", dark: "#1e3a5f"}';
    expectParity(setStyleColor(RICH, 1, 'fill', '#FFF', '#000'), RICH, { config: edit(C, [F, '      fill: {light: "#fff", dark: "#000"}']) });
    expectParity(setStyleColor(RICH, 1, 'fill', '#dae8fc', ''), RICH, { config: edit(C, [F, '      fill: "#dae8fc"']) });
    expectParity(setStyleColor(RICH, 1, 'fill', null, null), RICH, { config: edit(C, ['    style:\n' + F, '    style: {}']) });
    expectParity(setStyleProp(RICH, 2, 'border_width', null), RICH, { config: edit(C, ['style: {border_width: 2}', 'style: {}']) });
  });

  test('refusals: bad values, dark without light, no such rule', () => {
    expect(refused(setStyleColor(RICH, 0, 'fill', '', '#000'))).toMatch(/light/);
    expect(refused(setStyleColor(RICH, 0, 'fill', 'red', null))).toMatch(/colour/);
    expect(refused(setStyleProp(RICH, 0, 'border_style', 'wavy'))).toMatch(/solid/);
    expect(refused(setStyleProp(RICH, 0, 'border_width', 'x'))).toMatch(/whole number/);
    expect(refused(setRuleLegend(RICH, 9, 'x'))).toMatch(/no style rule/);
  });

  test('reorder and delete', () => {
    // The comment above the first rule stays where it is (the config writer swaps the items, not the comment).
    const R0 = '  - legend: The form\n    match: { id: r01 }\n    style: {border_style: dashed}\n';
    const R1 = '  - legend: Requester lane\n    match: {lane: requester}\n    style:\n      fill: {light: "#dae8fc", dark: "#1e3a5f"}\n';
    const down = expectParity(moveRule(RICH, 0, 'down'), RICH, { config: edit(C, [R0 + R1, R1 + R0]) });
    expect(ok(moveRule(down, 1, 'up')).files.config).toBe(C);
    expectParity(moveRule(RICH, 2, 'up'), RICH, { config: edit(C, [R1 + RULE2, RULE2 + R1]) });
    expect(ok(moveRule(RICH, 0, 'up')).files.config).toBe(C);
    expectParity(deleteRule(RICH, 1), RICH, { config: edit(C, [R1, '']) });
    expectParity(deleteRule(PR, 6), PR, {
      config: edit(PR.config!, ['  - legend: Open question\n    match: {open_question: present}\n    style: {border_color: {light: "#b85450", dark: "#f08080"}}\n', '']),
    });
  });
});

describe('P18 styles YAML (UI25)', () => {
  test('replace the whole list', () => {
    const yaml = '- legend: Only one\n  match: {system: erp}\n  style: {fill: "#dae8fc"}\n';
    const RULES = C.slice(C.indexOf('  # by id\n'), C.indexOf('\nnodes:'));
    expectParity(replaceStyles(RICH, yaml), RICH, {
      config: edit(C, [RULES, '  - legend: Only one\n    match: {system: erp}\n    style: {fill: "#dae8fc"}\n']),
    });
    expectParity(replaceStyles(RICH, '[]'), RICH, { config: edit(C, [`styles:\n${RULES}`, 'styles: []\n']) });
  });

  test('refusals: not a list of rules', () => {
    expect(refused(replaceStyles(RICH, 'a: b'))).toMatch(/list of rules/);
    expect(refused(replaceStyles(RICH, '- legend: x\n'))).toMatch(/match/);
    expect(refused(replaceStyles(RICH, '- [\n'))).toMatch(/YAML/);
  });
});

describe('P19 orphans (UI27)', () => {
  test('a node entry', () => {
    expectParity(deleteOrphanNodeEntry(RICH, 'n1'), RICH, { config: edit(C, [`  n1:                 # orphan: no such block\n${NODES_END}`, '']) });
  });

  test('a lane entry', () => {
    expectParity(deleteOrphanLaneEntry(RICH, 'archive'), RICH, { config: edit(C, ['  - id: archive        # stale: no such lane\n', '']) });
  });

  test('a pin', () => {
    expectParity(deleteOrphanPin(RICH, 'n2'), RICH, { layout: editJson(RICH.layout, (js) => { delete js.nodes.n2; }) });
    expect(ok(deleteOrphanPin({ ...RICH, layout: null }, 'n2')).files.layout).toBeNull();
  });
});
