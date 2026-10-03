// Amendment A18: line styles through the operations (design.md §8.2 UI44): set, create with a style, keep across
// reconnect, copy and paste.
import { describe, expect, test } from 'vitest';
import {
  connect, copyFragment, deleteItems, isFragment, fragmentToMermaid, pasteFragment, reconnect, setEdgeLabel, setEdgeStyle,
} from './index';
import { ok, refused } from './testkit';
import { layoutOf } from './testkit-v11';
import type { Files } from './context';

const FILES: Files = {
  mmd: [
    'flowchart LR', '', '  a["A"]', '  b["B"]', '  c["C"]', '',
    '  %% sync call', '  a --> b', '  a -.->|event| c', '  b ==> c', '  c <-->|two-way| a', '',
  ].join('\n'),
  config: null,
  layout: null,
};

describe('setEdgeStyle (UI44)', () => {
  test('rewrites only the arrow, keeping label, comment and place', () => {
    const r = ok(setEdgeStyle(FILES, 'a->b', 'dashed'));
    expect(r.files.mmd).toBe(FILES.mmd.replace('a --> b', 'a -.-> b'));
    expect(ok(setEdgeStyle(FILES, 'a->c', 'solid')).files.mmd).toBe(FILES.mmd.replace('a -.->|event| c', 'a -->|event| c'));
    expect(ok(setEdgeStyle(FILES, 'a->c', 'thick')).files.mmd).toBe(FILES.mmd.replace('a -.->|event| c', 'a ==>|event| c'));
    expect(ok(setEdgeStyle(FILES, 'b->c', 'bidirectional')).files.mmd).toBe(FILES.mmd.replace('b ==> c', 'b <--> c'));
  });

  test('several lines at once, in one step', () => {
    const r = ok(setEdgeStyle(FILES, ['a->b', 'b->c'], 'dashed'));
    expect(r.files.mmd).toBe(FILES.mmd.replace('a --> b', 'a -.-> b').replace('b ==> c', 'b -.-> c'));
  });

  test('the same style again changes nothing', () => {
    expect(ok(setEdgeStyle(FILES, 'a->c', 'dashed')).files).toEqual(FILES);
  });

  test('the edge id, and its layout entry, stay', () => {
    const files: Files = { ...FILES, layout: JSON.stringify({ version: 1, nodes: {}, edges: { 'a->b': { source_side: 'bottom' } } }) };
    const r = ok(setEdgeStyle(files, 'a->b', 'thick'));
    expect(JSON.parse(r.files.layout!)).toEqual(JSON.parse(files.layout!));
  });

  test('refusals: an unknown line, an unknown style (nothing is written)', () => {
    expect(refused(setEdgeStyle(FILES, 'a->zz', 'dashed'))).toMatch(/no line/);
    expect(refused(setEdgeStyle(FILES, ['a->b', 'nope'], 'dashed'))).toMatch(/no line/);
    expect(refused(setEdgeStyle(FILES, 'a->b', 'wavy' as never))).toMatch(/line style/);
  });
});

describe('connect with a style (UI15)', () => {
  test('the new line is written with the style\'s arrow', () => {
    for (const [style, arrow] of [['dashed', '-.->'], ['thick', '==>'], ['bidirectional', '<-->'], ['solid', '-->']] as const) {
      const r = ok(connect(FILES, 'b', 'a', { style }));
      expect(r.edgeId).toBe('b->a');
      expect(r.files.mmd).toBe(`${FILES.mmd}  b ${arrow} a\n`);
    }
  });

  test('a style that is not one of the four is refused', () => {
    expect(refused(connect(FILES, 'a', 'b', { style: 'dotted' as never }))).toMatch(/line style/);
  });
});

describe('a style survives the other line operations', () => {
  test('reconnect', () => {
    const r = ok(reconnect(FILES, 'a->c', 'target', 'b'));
    expect(r.edgeId).toBe('a->b#2');
    expect(r.files.mmd).toContain('a -.->|event| b');
  });

  test('a label edit', () => {
    expect(ok(setEdgeLabel(FILES, 'b->c', 'critical')).files.mmd).toContain('b ==> c'.replace('==>', '==>|critical|'));
    expect(ok(setEdgeLabel(FILES, 'a->c', null)).files.mmd).toContain('a -.-> c');
  });

  test('deleting another line', () => {
    const r = ok(deleteItems(FILES, { edges: ['a->b'] }));
    expect(r.files.mmd).toContain('a -.->|event| c');
    expect(r.files.mmd).toContain('c <-->|two-way| a');
  });
});

describe('copy and paste carry the style', () => {
  const copy = () => {
    const r = copyFragment(FILES, ['a', 'b', 'c'], layoutOf(FILES));
    if (!r.ok) throw new Error(r.error);
    return r.fragment;
  };

  test('copied lines record their style (solid ones leave it out)', () => {
    const f = copy();
    expect(f.edges.map((e) => [e.source, e.target, e.style])).toEqual([
      ['a', 'b', undefined], ['a', 'c', 'dashed'], ['b', 'c', 'thick'], ['c', 'a', 'bidirectional'],
    ]);
    expect(isFragment(JSON.parse(JSON.stringify(f)))).toBe(true);
  });

  test('a style that is not one of the four makes the fragment invalid', () => {
    const f = JSON.parse(JSON.stringify(copy()));
    f.edges[0].style = 'wavy';
    expect(isFragment(f)).toBe(false);
  });

  test('paste appends the lines with their arrows', () => {
    const r = pasteFragment(FILES, copy(), layoutOf(FILES), { step: 40 });
    if (!r.ok) throw new Error(r.error);
    const lines = r.files.mmd.split('\n');
    expect(lines).toEqual(expect.arrayContaining([
      '  a-2 --> b-2', '  a-2 -.->|event| c-2', '  b-2 ==> c-2', '  c-2 <-->|two-way| a-2',
    ]));
  });

  test('the Mermaid on the system clipboard keeps the arrows', () => {
    const text = fragmentToMermaid(copy());
    expect(text).toContain('a -.->|event| c');
    expect(text).toContain('b ==> c');
    expect(text).toContain('c <-->|two-way| a');
  });
});
