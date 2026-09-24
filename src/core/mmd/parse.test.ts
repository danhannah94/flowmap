// One test (or a few) per rule sentence in design.md §3.1 and §3.2. Canonical-form rules (§3.3) are in format.test.ts.
import { format, parse, toGraph } from './index';

/** Lines joined into a file. */
const src = (...lines: string[]) => lines.join('\n') + '\n';
/** A file with the standard header. */
const lr = (...lines: string[]) => src('flowchart LR', ...lines);

const errors = (text: string) => parse(text).problems.errors.map((e) => [e.code, e.line]);
const warnings = (text: string) => parse(text).problems.warnings.map((w) => [w.code, w.line]);
const ok = (text: string) => {
  const result = parse(text);
  expect(result.problems.errors).toEqual([]);
  return result;
};
const graph = (text: string) => toGraph(ok(text).diagram);
const edgeList = (text: string) => graph(text).edges.map((e) => (e.label === null ? e.id : `${e.id}|${e.label}`));
const node = (text: string, id: string) => graph(text).nodes.find((n) => n.id === id);

describe('§3.1 header', () => {
  it.each([
    ['flowchart LR', 'LR'], ['flowchart TB', 'TB'], ['flowchart TD', 'TB'],
    ['graph LR', 'LR'], ['graph TB', 'TB'], ['graph TD', 'TB'], ['flowchart LR;', 'LR'], ['  graph   TD  ', 'TB'],
  ])('accepts %j as %s', (header, direction) => {
    expect(ok(src(header, '  a["A"]')).diagram.direction).toBe(direction);
  });

  it.each(['flowchart RL', 'flowchart BT', 'graph', 'flowchart', 'flowchart lr', 'flowchart LR extra', 'stateDiagram'])(
    'rejects %j with E-header at that line',
    (header) => {
      expect(errors(src(header, '  a["A"]'))).toEqual([['E-header', 1]]);
    },
  );

  it('reports a missing header at the first line that is not a comment or blank', () => {
    expect(errors(src('%% note', '', '  a["A"] --> b["B"]'))).toEqual([['E-header', 3]]);
  });

  it('reports an empty file at line 1', () => {
    expect(errors('')).toEqual([['E-header', 1]]);
    expect(errors('\n\n  \n')).toEqual([['E-header', 1]]);
  });

  it('keeps reporting errors after a bad header', () => {
    expect(errors(src('flowchart RL', '  a((x))'))).toEqual([['E-header', 1], ['E-shape', 2]]);
  });

  it('accepts CRLF line endings and a BOM', () => {
    expect(format(ok('\uFEFFflowchart LR\r\n  a["A"]\r\n').diagram)).toBe(lr('', '  a["A"]'));
  });
});

describe('§3.1 statements and semicolons', () => {
  it('drops a trailing ";" on every kind of statement', () => {
    const text = src(
      'flowchart LR;', '  subgraph s [S];', '    a[A];', '    direction TB;', '  end;', '  a --> b;', '  classDef x fill:#f96;',
    );
    const { diagram, problems } = ok(text);
    expect(problems.errors).toEqual([]);
    expect(format(diagram)).toBe(lr('', '  subgraph s [S]', '    a["A"]', '  end', '', '  a --> b', '', '  classDef x fill:#f96'));
  });

  it('rejects several statements on one line', () => {
    expect(errors(lr('  a --> b; b --> c'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  a["A"];b["B"]'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  a --> b;;'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  style a fill:#f00;;'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  style a fill:red; stroke:blue'))).toEqual([['E-syntax', 2]]);
  });

  it('allows ";" inside labels and ending a #…; escape', () => {
    const g = graph(lr('  a[x; y] -->|p;q| b["r;s"]', '  a -- t;u --> b', '  c[Say #quot;hi#quot;]'));
    expect(g.nodes.map((n) => n.label)).toEqual(['x; y', 'r;s', 'Say "hi"']);
    expect(g.edges.map((e) => e.label)).toEqual(['p;q', 't;u']);
    expect(ok(lr('  classDef hot fill:#f96;stroke:#333', '  click a "x; y"')).diagram.passThrough.map((p) => p.text))
      .toEqual(['classDef hot fill:#f96;stroke:#333', 'click a "x; y"']);
  });

  it('ignores a line that is only ";"', () => {
    expect(ok(lr(';', '  a["A"]')).diagram.unlaned).toHaveLength(1);
  });

  it('matches keywords as whole tokens only', () => {
    expect(edgeList(lr('  class_a --> b'))).toEqual(['class_a->b']);
    expect(edgeList(lr('  classDef-x --> end1'))).toEqual(['classDef-x->end1']);
    expect(edgeList(lr('  endpoint --> styles', '  subgraph1["S"] --> directions'))).toEqual([
      'endpoint->styles', 'subgraph1->directions',
    ]);
    expect(node(lr('  ending["E"]'), 'ending')?.label).toBe('E');
  });

  it('reports any other unparseable line as E-syntax', () => {
    expect(errors(lr('  a["A"]', '  this is not mermaid'))).toEqual([['E-syntax', 3]]);
    expect(errors(lr('  a --> b --> '))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  a & --> b'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  a --> b %% trailing comment'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  1a["A"]'))).toEqual([['E-syntax', 2]]);
  });

  it('reports every error, not just the first', () => {
    const text = lr(
      '  a((circle))', '  b -.-> c', '  d["x"]', '  d["y"]', '  bad line here', '  end', '  subgraph s', '    subgraph t',
      '    end',
    );
    expect(errors(text)).toEqual([
      ['E-shape', 2], ['E-edge', 3], ['E-duplicate', 5], ['E-syntax', 6], ['E-syntax', 7], ['E-nested', 9],
      ['E-unclosed', 8],
    ].sort((x, y) => (x[1] as number) - (y[1] as number)));
  });
});

describe('§3.1 lanes', () => {
  it.each([
    ['subgraph ops [Operations]', 'Operations'],
    ['subgraph ops[Operations]', 'Operations'],
    ['subgraph ops ["Ops & more"]', 'Ops & more'],
    ['subgraph ops["Ops & more"]', 'Ops & more'],
    ['subgraph ops [  Lots   of   space  ]', 'Lots of space'],
    ['subgraph ops', 'ops'],
    ['subgraph ops [Say #quot;hi#quot;]', 'Say "hi"'],
  ])('%s has label %j', (line, label) => {
    expect(ok(lr(`  ${line}`, '    a["A"]', '  end')).diagram.lanes[0]).toMatchObject({ id: 'ops', label });
  });

  it('applies the node id rules to subgraph ids', () => {
    for (const id of ['end', 'class', 'default', '_unassigned', 'end-x', 'end_x', 'flowchart']) {
      expect(errors(lr(`  subgraph ${id} [X]`, '  end'))).toEqual([['E-syntax', 2]]);
    }
    expect(errors(lr('  subgraph a--b [X]', '  end'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  subgraph a- [X]', '  end'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  subgraph My Lane', '  end'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  subgraph ok [a [b] c]', '  end'))).toEqual([['E-syntax', 2]]);
  });

  it('reports a nested subgraph at the inner line, once (its end is not a second error)', () => {
    expect(errors(lr('  subgraph a [A]', '    subgraph b [B]', '      x["X"]', '    end', '  end'))).toEqual([
      ['E-nested', 3],
    ]);
  });

  it('reports an unclosed subgraph at its subgraph line', () => {
    expect(errors(lr('  a["A"]', '  subgraph s [S]', '    b["B"]'))).toEqual([['E-unclosed', 3]]);
  });

  it('reports "end" with no open subgraph as E-syntax', () => {
    expect(errors(lr('  a["A"]', '  end'))).toEqual([['E-syntax', 3]]);
    expect(errors(lr('  subgraph s [S]', '  end', '  end'))).toEqual([['E-syntax', 4]]);
  });

  it('reports a repeated subgraph id at the later subgraph', () => {
    expect(errors(lr('  subgraph s [S]', '  end', '  subgraph s [T]', '  end'))).toEqual([['E-duplicate', 4]]);
  });

  it('reports a subgraph id equal to a node id at whichever comes later', () => {
    expect(errors(lr('  x["X"]', '  subgraph x [X]', '  end'))).toEqual([['E-duplicate', 3]]);
    expect(errors(lr('  subgraph x [X]', '  end', '  x["X"]'))).toEqual([['E-duplicate', 4]]);
    expect(errors(lr('  subgraph x [X]', '  end', '  a --> x["X"]'))).toContainEqual(['E-duplicate', 4]);
  });

  it('reports an edge to or from a subgraph id as E-syntax, wherever the subgraph is', () => {
    expect(errors(lr('  subgraph s [S]', '    a["A"]', '  end', '  a --> s'))).toEqual([['E-syntax', 5]]);
    expect(errors(lr('  s --> a', '  subgraph s [S]', '    a["A"]', '  end'))).toEqual([['E-syntax', 2]]);
  });
});

describe('§3.1 node shapes', () => {
  it.each([
    ['a[Label]', 'step'], ['a{Label}', 'decision'], ['a([Label])', 'terminal'], ['a[[Label]]', 'subprocess'],
    ['a[(Label)]', 'database'], ['a[/Label/]', 'io'], ['a@{ shape: doc, label: "Label" }', 'document'],
    ['a@{ shape: delay, label: "Label" }', 'delay'],
    ['a["Label"]', 'step'], ['a{"Label"}', 'decision'], ['a(["Label"])', 'terminal'], ['a[["Label"]]', 'subprocess'],
    ['a[("Label")]', 'database'], ['a[/"Label"/]', 'io'],
  ])('%s is a %s', (decl, kind) => {
    expect(node(lr(`  ${decl}`), 'a')).toMatchObject({ kind, label: 'Label' });
  });

  it('takes a class suffix on the six bracket shapes', () => {
    for (const decl of ['a[L]', 'a{L}', 'a([L])', 'a[[L]]', 'a[(L)]', 'a[/L/]', 'a["L"]']) {
      expect(ok(lr(`  ${decl}:::hot-1`)).diagram.unlaned[0]!.className).toBe('hot-1');
    }
  });

  it('stops a class name before an arrow with no space', () => {
    expect(edgeList(lr('  a[x]:::hot-->b', '  c["y"]:::c-1-->|l|d'))).toEqual(['a->b', 'c->d|l']);
    expect(ok(lr('  a[x]:::hot-->b')).diagram.unlaned[0]!.className).toBe('hot');
  });

  it('rejects a "/" in an unquoted io label, but not in a quoted one', () => {
    expect(errors(lr('  a[/a/b/]'))).toEqual([['E-syntax', 2]]);
    expect(node(lr('  a[/"a/b"/]'), 'a')?.label).toBe('a/b');
    expect(node(lr('  a[a/b]'), 'a')?.label).toBe('a/b');
  });

  it.each([
    'a((x))', 'a(((x)))', 'a(x)', 'a{{x}}', 'a>x]', 'a[\\x\\]', 'a[\\x/]', 'a[/x\\]', 'a[/"x"\\]',
    'a@{ shape: circle, label: "x" }', 'a@{ shape: rect, label: "x" }', 'a@{ shape: document, label: "x" }',
    'a@{ shape: doc }', 'a@{ label: "x" }', 'a@{ shape: doc, label: "x", icon: "y" }',
    'a@{ shape: doc, label: "x", shape: doc }', 'a@{ shape: doc, label: x }', 'a@{ shape: "doc", label: "x" }',
    'a@{ shape: doc, label: "x" }:::hot', 'a@{ shape:doc, label: "x" }', 'a@{ shape: doc, label:"x" }',
    'a@{shape:doc,label:"x"}', 'a@{ shape: doc, label: "C:\\temp" }',
  ])('%s is E-shape', (decl) => {
    expect(errors(lr(`  ${decl}`))).toEqual([['E-shape', 2]]);
  });

  it('accepts @{…} keys in either order, with other whitespace optional', () => {
    for (const decl of [
      'a@{ label: "x", shape: doc }', 'a@{shape: doc,label: "x"}', 'a@{  shape :  doc ,  label :\t"x"  }',
    ]) {
      expect(node(lr(`  ${decl}`), 'a')).toMatchObject({ kind: 'document', label: 'x' });
    }
  });

  it('decodes #92; as a backslash in @{…} labels', () => {
    expect(node(lr('  a@{ shape: delay, label: "C:#92;temp" }'), 'a')?.label).toBe('C:\\temp');
  });

  it('reports an E-shape even when the node is inline in an edge', () => {
    expect(errors(lr('  a["A"]', '  b(("Circle"))', '  a --> b'))).toEqual([['E-shape', 3]]);
    expect(errors(lr('  a --> b{{x}}'))).toEqual([['E-shape', 2]]);
  });

  it('requires the shape to touch the id', () => {
    expect(errors(lr('  a [Label]'))).toEqual([['E-syntax', 2]]);
  });
});

describe('§3.1 node ids', () => {
  it('accepts letters, digits, "_" and single "-" inside', () => {
    for (const id of ['a', 'A1', '_x', 'a-b', 'a_b-c-1', 'n07', 'endx', 'end1', 'ending']) {
      expect(node(lr(`  ${id}["L"]`), id)?.label).toBe('L');
    }
  });

  it('rejects ids ending in "-" or containing "--"', () => {
    expect(errors(lr('  a-["A"]'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  a--b["A"]'))).toEqual([['E-syntax', 2]]);
  });

  it('reads "a--b --> c" as an edge labelled b, since ids never contain "--"', () => {
    expect(edgeList(lr('  a--b --> c'))).toEqual(['a->c|b']);
  });

  it.each([
    'end', 'subgraph', 'graph', 'flowchart', 'direction', 'class', 'classDef', 'style', 'linkStyle', 'click', 'default',
    '_unassigned', 'end-x', 'end_x', 'end-', 'end__',
  ])('reserved id %s is E-syntax, as a declaration or in an edge', (id) => {
    expect(errors(lr('  a["A"]', `  a --> ${id}`))).toEqual([['E-syntax', 3]]);
    expect(errors(lr(`  x["X"] & ${id}["Y"]`))).toEqual([['E-syntax', 2]]);
  });

  it('rejects a line that is only a bare id', () => {
    expect(errors(lr('  a'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  a;'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  a & b'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  a["A"] & b'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  a:::hot'))).toEqual([['E-syntax', 2]]);
  });

  it('accepts several declarations joined by "&" with no edge', () => {
    expect(graph(lr('  a["A"] & b{"B"}')).nodes.map((n) => n.kind)).toEqual(['step', 'decision']);
  });
});

describe('§3.1 labels', () => {
  it('rejects brackets, braces, parentheses, "|" and \'"\' in unquoted labels', () => {
    for (const bad of ['a[x (y)]', 'a[x [y]]', 'a{x {y}}', 'a[x|y]', 'a[x"y]', 'a[x}y]']) {
      expect(errors(lr(`  ${bad}`))).toEqual([['E-syntax', 2]]);
    }
    for (const bad of ['a -->|x (y)| b', 'a -- x [y] --> b', 'a -->|x"y| b', 'a -- x|y --> b']) {
      expect(errors(lr(`  ${bad}`))).toEqual([['E-syntax', 2]]);
    }
  });

  it('trims unquoted labels and collapses whitespace runs', () => {
    expect(node(lr('  a[   Check \t the   order  ]'), 'a')?.label).toBe('Check the order');
    expect(edgeList(lr('  a -->|  two   words | b', '  a --   x   y   --> b'))).toEqual(['a->b|two words', 'a->b#2|x y']);
  });

  it('keeps quoted labels exactly', () => {
    expect(node(lr('  a["  spaced   out  "]'), 'a')?.label).toBe('  spaced   out  ');
    expect(node(lr('  a["Anything (goes) [here] {ok} | fine"]'), 'a')?.label).toBe('Anything (goes) [here] {ok} | fine');
    expect(edgeList(lr('  a -->|"  x  "| b'))).toEqual(['a->b|  x  ']);
  });

  it('decodes exactly #quot;, #35; and #92;, keeping any other #…; literally', () => {
    expect(node(lr('  a["#quot;q#quot; #35;h #92;b #amp; #9829; #35;quot;"]'), 'a')?.label).toBe(
      '"q" #h \\b #amp; #9829; #quot;',
    );
    expect(node(lr('  a[#quot;unquoted#quot;]'), 'a')?.label).toBe('"unquoted"');
    expect(edgeList(lr('  a -->|say #quot;x#quot;| b'))).toEqual(['a->b|say "x"']);
  });

  it('treats an empty edge label as no label', () => {
    expect(graph(lr('  a -->|| b', '  a -- --> b', '  a -->|""| b', '  a -->|  | b')).edges.map((e) => e.label)).toEqual([
      null, null, null, null,
    ]);
  });

  it('keeps an empty quoted node label, but rejects an empty unquoted one', () => {
    expect(node(lr('  a[""]'), 'a')?.label).toBe('');
    expect(errors(lr('  a[]'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  a[  ]'))).toEqual([['E-syntax', 2]]);
  });
});

describe('§3.1 edges', () => {
  it('accepts the four edge forms', () => {
    expect(edgeList(lr('  a --> b', '  a -->|l| b', '  a -->|"l m"| b', '  a -- l --> b', '  a -- "l m" --> b'))).toEqual([
      'a->b', 'a->b#2|l', 'a->b#3|l m', 'a->b#4|l', 'a->b#5|l m',
    ]);
  });

  it('allows whitespace around arrows and labels to be left out or added', () => {
    expect(edgeList(lr('  a-->b', '  a-->|x|b', '  a --> |x| b', '  a--x-->b', '  a-- y -->b', '  a  -->  b'))).toEqual([
      'a->b', 'a->b#2|x', 'a->b#3|x', 'a->b#4|x', 'a->b#5|y', 'a->b#6',
    ]);
    expect(edgeList(lr('  a["A"]-->b{"B"}', '  a-b-->c-d'))).toEqual(['a->b', 'a-b->c-d']);
  });

  it('expands chains left to right', () => {
    expect(edgeList(lr('  a --> b -->|x| c -- y --> d'))).toEqual(['a->b', 'b->c|x', 'c->d|y']);
  });

  it('expands "&" groups source-major, left to right', () => {
    expect(edgeList(lr('  a & b --> c & d'))).toEqual(['a->c', 'a->d', 'b->c', 'b->d']);
    expect(edgeList(lr('  a --> b & c --> d'))).toEqual(['a->b', 'a->c', 'b->d', 'c->d']);
    expect(edgeList(lr('  a&b-->|x|c'))).toEqual(['a->c|x', 'b->c|x']);
  });

  it('declares nodes inline in edges, in left-to-right order', () => {
    const { diagram } = ok(lr('  a["X"] --> b{"Y"} & c(["Z"])'));
    expect(diagram.unlaned.map((n) => [n.id, n.shape, n.label])).toEqual([
      ['a', 'step', 'X'], ['b', 'decision', 'Y'], ['c', 'terminal', 'Z'],
    ]);
  });

  it('keeps duplicate edges, in file order', () => {
    expect(edgeList(lr('  a --> b', '  b --> a', '  a --> b', '  a -->|x| b'))).toEqual([
      'a->b', 'b->a', 'a->b#2', 'a->b#3|x',
    ]);
  });

  it.each([
    'a --- b', 'a -.-> b', 'a -.- b', 'a ==> b', 'a === b', 'a --o b', 'a --x b', 'a <--> b', 'a <-.-> b', 'a ~~~ b',
    'a o--o b', 'a x--x b', 'a ---> b', 'a -->> b', 'a -- text --- b', 'a -. text .-> b', 'a == text ==> b',
    'a---b', 'a-.->b', 'a==>b',
  ])('%s is E-edge', (line) => {
    expect(errors(lr('  a["A"]', '  b["B"]', `  ${line}`))).toEqual([['E-edge', 4]]);
  });

  it('reports an unfinished "--" arrow as E-syntax', () => {
    expect(errors(lr('  a -- b'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  a -- x -->|y| b'))).toEqual([['E-syntax', 2]]);
  });
});

describe('§3.1 comments, pass-through and direction', () => {
  it('reads %% lines, including %%{init}%% directives, as comments', () => {
    const { diagram } = ok(src('%%{init: {"theme": "dark"}}%%', 'flowchart LR', '  a["A"]', '  %% note; with (stuff)', '  a --> b'));
    expect(diagram.fileComment).toEqual(['%%{init: {"theme": "dark"}}%%']);
    expect(diagram.edges[0]!.comments).toEqual(['%% note; with (stuff)']);
  });

  it('keeps classDef, class, style, linkStyle and click lines', () => {
    const lines = ['classDef hot fill:#f96', 'class a,b hot', 'style a fill:#fff', 'linkStyle 0 stroke:#f00', 'click a "https://x"'];
    const { diagram } = ok(lr('  a["A"] --> b', ...lines.map((l) => `  ${l};`)));
    expect(diagram.passThrough.map((p) => p.text)).toEqual(lines);
    expect(toGraph(diagram).nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('rejects an incomplete pass-through line', () => {
    expect(errors(lr('  classDef'))).toEqual([['E-syntax', 2]]);
  });

  it('warns about direction lines at the top level and inside a subgraph, and drops them', () => {
    const text = lr('  direction TB', '  subgraph s [S]', '    direction LR', '    a["A"]', '  end');
    expect(warnings(text)).toEqual([['W-direction', 2], ['W-direction', 4]]);
    expect(format(ok(text).diagram)).toBe(lr('', '  subgraph s [S]', '    a["A"]', '  end'));
    expect(ok(text).diagram.direction).toBe('LR');
  });

  it('rejects a direction line with no direction', () => {
    expect(errors(lr('  direction'))).toEqual([['E-syntax', 2]]);
    expect(errors(lr('  direction sideways'))).toEqual([['E-syntax', 2]]);
  });
});

describe('§3.2 lanes of nodes', () => {
  it('puts a node in the subgraph where it is first declared with a shape', () => {
    const g = graph(lr('  a --> b', '  subgraph s [S]', '    a["A"]', '    b["B"] --> c["C"]', '  end'));
    expect(g.nodes.map((n) => [n.id, n.lane])).toEqual([['a', 's'], ['b', 's'], ['c', 's']]);
  });

  it('does not assign lanes through edges inside a subgraph block', () => {
    const text = lr('  x["X"]', '  subgraph s [S]', '    a["A"]', '    a --> x & y', '  end');
    expect(graph(text).nodes.map((n) => [n.id, n.lane])).toEqual([['x', '_unassigned'], ['a', 's'], ['y', '_unassigned']]);
  });

  it('warns W-no-lane at the declaration of an unlaned node, or at the first mention of a never-declared one', () => {
    const text = lr('  a --> b', '  subgraph s [S]', '    c["C"] --> d', '  end', '  b["B"]', '  e --> d');
    expect(warnings(text)).toEqual([['W-no-lane', 2], ['W-no-lane', 4], ['W-no-lane', 6], ['W-no-lane', 7]]);
  });

  it('gives a never-declared node kind step and its id as label', () => {
    expect(node(lr('  a["A"] --> ghost'), 'ghost')).toEqual({ id: 'ghost', label: 'ghost', kind: 'step', lane: '_unassigned' });
  });

  it('ignores a repeated identical declaration', () => {
    const text = lr('  subgraph s [S]', '    a[A]:::c', '    a["A"]:::c', '    a[A]:::c --> b', '  end');
    const { diagram } = ok(text);
    expect(diagram.lanes[0]!.nodes).toHaveLength(1);
  });

  it.each([
    ['a different shape', 'a{"A"}'], ['a different label', 'a["B"]'], ['a different class', 'a["A"]:::d'],
    ['no class', 'a["A"]'],
  ])('reports a redeclaration with %s at the later line', (_, decl) => {
    expect(errors(lr('  a["A"]:::c', '  b --> c', `  ${decl}`))).toEqual([['E-duplicate', 4]]);
  });

  it('reports a redeclaration in a different lane at the later line', () => {
    expect(errors(lr('  a["A"]', '  subgraph s [S]', '    a["A"]', '  end'))).toEqual([['E-duplicate', 4]]);
    expect(errors(lr('  subgraph s [S]', '    a["A"]', '  end', '  x --> a["A"]'))).toEqual([['E-duplicate', 5]]);
  });
});

describe('§3.4 edge ids', () => {
  it('appends #2, #3… to repeats of the same pair, in file order', () => {
    expect(graph(lr('  a --> b', '  b --> a', '  a --> b & b', '  a -->|x| b')).edges.map((e) => e.id)).toEqual([
      'a->b', 'b->a', 'a->b#2', 'a->b#3', 'a->b#4',
    ]);
  });
});
