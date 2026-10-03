// Amendment A18: dashed (`-.->`), thick (`==>`) and bidirectional (`<-->`) edges in the `.mmd` subset (§3.1, §3.3).
import { describe, expect, it } from 'vitest';
import { format, formatEdge, parse, toGraph } from './index';

const lr = (...lines: string[]) => ['flowchart LR', ...lines, ''].join('\n');
const ok = (text: string) => {
  const r = parse(text);
  expect(r.problems.errors).toEqual([]);
  return r.diagram;
};
const errors = (text: string) => parse(text).problems.errors.map((e) => [e.code, e.line]);
/** `source->target[style]|label` per edge, in file order. */
const edges = (text: string) =>
  ok(text).edges.map((e) => `${e.source}->${e.target}[${e.style ?? 'solid'}]${e.label === null ? '' : `|${e.label}`}`);

describe('A18 parse: the three new arrows', () => {
  it.each([
    ['a -.-> b', 'dashed'],
    ['a ==> b', 'thick'],
    ['a <--> b', 'bidirectional'],
    ['a-.->b', 'dashed'],
    ['a==>b', 'thick'],
    ['a<-->b', 'bidirectional'],
    ['a   -.->   b', 'dashed'],
  ])('%s is %s', (line, style) => {
    expect(edges(lr(`  ${line}`))).toEqual([`a->b[${style}]`]);
  });

  it('leaves a solid edge without a style field (so older output is unchanged)', () => {
    const d = ok(lr('  a --> b', '  c -.-> d'));
    expect('style' in d.edges[0]!).toBe(false);
    expect(d.edges[1]!.style).toBe('dashed');
  });

  it.each([
    ['a -.->|event| b', 'dashed', 'event'],
    ['a ==>|critical| b', 'thick', 'critical'],
    ['a <-->|sync| b', 'bidirectional', 'sync'],
    ['a -.->|"two words, quoted"| b', 'dashed', 'two words, quoted'],
    ['a ==> |spaced| b', 'thick', 'spaced'],
    ['a -. event .-> b', 'dashed', 'event'],
    ['a == critical path ==> b', 'thick', 'critical path'],
    ['a <-- sync --> b', 'bidirectional', 'sync'],
    ['a -. "quoted: text" .-> b', 'dashed', 'quoted: text'],
    ['a -->|plain| b', 'solid', 'plain'],
  ])('%s carries its label', (line, style, label) => {
    expect(edges(lr(`  ${line}`))).toEqual([`a->b[${style}]|${label}`]);
  });

  it('an empty label is no label, as for -->', () => {
    expect(edges(lr('  a -.->|| b', '  a ==>|""| b'))).toEqual(['a->b[dashed]', 'a->b[thick]']);
  });

  it('each arrow of a chain keeps its own style', () => {
    expect(edges(lr('  a --> b -.-> c ==> d <-->|x| e'))).toEqual([
      'a->b[solid]', 'b->c[dashed]', 'c->d[thick]', 'd->e[bidirectional]|x',
    ]);
  });

  it('every edge of an & group gets the arrow', () => {
    expect(edges(lr('  a & b -.->|e| c & d'))).toEqual([
      'a->c[dashed]|e', 'a->d[dashed]|e', 'b->c[dashed]|e', 'b->d[dashed]|e',
    ]);
  });

  it('declares nodes inline in a styled edge', () => {
    const d = ok(lr('  a["A"] ==> b{"B?"}'));
    expect(d.unlaned.map((n) => n.id)).toEqual(['a', 'b']);
    expect(d.edges[0]!.style).toBe('thick');
  });

  it('duplicate pairs keep their ids whatever the style', () => {
    const g = toGraph(ok(lr('  a --> b', '  a -.-> b', '  a <--> b')));
    expect(g.edges.map((e) => [e.id, e.style])).toEqual([['a->b', undefined], ['a->b#2', 'dashed'], ['a->b#3', 'bidirectional']]);
  });

  it('a comment above a styled edge travels with it', () => {
    const d = ok(lr('  a["A"]', '', '  %% async', '  a -.-> b'));
    expect(d.edges[0]!.comments).toEqual(['%% async']);
  });

  it('an edge to or from a subgraph is still E-syntax', () => {
    expect(errors(lr('  subgraph s [S]', '    a["A"]', '  end', '  a ==> s'))).toEqual([['E-syntax', 5]]);
  });
});

describe('A18 parse: everything else stays E-edge', () => {
  it.each([
    'a -.- b', 'a === b', 'a ==x b', 'a --- b', 'a <==> b', 'a <-.-> b', 'a ~~~ b', 'a --o b', 'a --x b',
    'a -..-> b', 'a ===> b', 'a -.->> b', 'a ==>> b', 'a <--x b', 'a <---> b', 'a <-->> b', 'a -. text .- b',
    'a == text === b', 'a == text', 'a -. text', 'a <-- text --- b', 'a-.-b', 'a===b',
  ])('%s', (line) => {
    expect(errors(lr('  a["A"]', '  b["B"]', `  ${line}`))).toEqual([['E-edge', 4]]);
  });

  it('a chain with one bad arrow reports E-edge once', () => {
    expect(errors(lr('  a --> b -.- c --> d'))).toEqual([['E-edge', 2]]);
  });

  it('an arrow with two labels is E-syntax', () => {
    expect(errors(lr('  a -. x .->|y| b'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  a == x ==>|y| b'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  a <-- x -->|y| b'))).toEqual([['E-syntax', 2]]);
  });
});

describe('A18 canonical form', () => {
  it.each([
    ['a -.-> b', '  a -.-> b'],
    ['a ==> b', '  a ==> b'],
    ['a <--> b', '  a <--> b'],
    ['a-.->|event|b', '  a -.->|event| b'],
    ['a==>|critical path|b', '  a ==>|critical path| b'],
    ['a<-->|"sync, two-way"|b', '  a <-->|sync, two-way| b'],
    ['a -. event .-> b', '  a -.->|event| b'],
    ['a == critical ==> b', '  a ==>|critical| b'],
    ['a <-- sync --> b', '  a <-->|sync| b'],
    ['a -->|x| b', '  a -->|x| b'],
  ])('%s is written %s', (line, canonical) => {
    expect(format(ok(lr(`  ${line}`)))).toBe(`flowchart LR\n\n${canonical}\n`);
  });

  it('quotes a label that is not safe unquoted, for every style', () => {
    expect(formatEdge({ source: 'a', target: 'b', label: 'x | y', style: 'dashed' })).toBe('a -.->|"x | y"| b');
    expect(formatEdge({ source: 'a', target: 'b', label: 'x | y', style: 'bidirectional' })).toBe('a <-->|"x | y"| b');
  });

  it('format(parse(x)) is a fixed point', () => {
    const text = lr(
      '  subgraph s [S]', '    a["A"]', '    b["B"]', '  end', '  a -.->|e| b', '  b ==> a', '  a <-->|s| b', '  a --> b',
      '  a -. x .-> b & c', '  %% note', '  c == y ==> a',
    );
    const once = format(ok(text));
    expect(format(ok(once))).toBe(once);
  });

  it('the long and pipe forms of one edge format identically', () => {
    for (const [a, b] of [['-.', '.->'], ['==', '==>'], ['<--', '-->']] as const) {
      const arrow = a === '-.' ? '-.->' : a === '==' ? '==>' : '<-->';
      expect(format(ok(lr(`  x ${a} go ${b} y`)))).toBe(format(ok(lr(`  x ${arrow}|go| y`))));
    }
  });
});
