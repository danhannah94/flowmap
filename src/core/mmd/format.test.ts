// Canonical form (design.md §3.3): one test per rule, each also checking idempotence.
import { emptyDiagram, format, formatNodeDecl, parse } from './index';

const src = (...lines: string[]) => lines.join('\n') + '\n';
const lr = (...lines: string[]) => src('flowchart LR', ...lines);

/** Format, asserting no errors and that the result is a fixed point (§3.3: fmt is idempotent). */
const fmt = (text: string): string => {
  const first = parse(text);
  expect(first.problems.errors).toEqual([]);
  const out = format(first.diagram);
  const again = parse(out);
  expect(again.problems.errors).toEqual([]);
  expect(format(again.diagram)).toBe(out);
  return out;
};

describe('§3.3 layout of the file', () => {
  it('normalises the header', () => {
    expect(fmt(src('graph TD', '  a["A"]'))).toBe(src('flowchart TB', '', '  a["A"]'));
    expect(fmt(src('graph LR;', '  a["A"]'))).toBe(src('flowchart LR', '', '  a["A"]'));
  });

  it('writes sections in order: unlaned nodes, lanes, edges, pass-through, trailing comments', () => {
    const text = src(
      'graph LR', '%% trailing?', '  classDef x fill:#fff', '  a --> b', '  subgraph s [S]', '    b["B"]', '  end',
      '  subgraph t [T]', '  end', '  a["A"]', '%% the end',
    );
    expect(fmt(text)).toBe(src(
      'flowchart LR', '%% trailing?', '', '  a["A"]', '', '  subgraph s [S]', '    b["B"]', '  end', '', '  subgraph t [T]',
      '  end', '', '  a --> b', '', '  classDef x fill:#fff', '', '%% the end',
    ));
  });

  it('leaves out empty sections with their blank line, and never writes two blank lines in a row', () => {
    expect(fmt(src('flowchart LR'))).toBe(src('flowchart LR'));
    expect(fmt(src('flowchart LR', '', '', '  a --> b', '', ''))).toBe(src('flowchart LR', '', '  a --> b'));
    expect(fmt(src('flowchart TB', '%% c', '', '', '  style a fill:#fff'))).toBe(
      src('flowchart TB', '%% c', '', '  style a fill:#fff'),
    );
  });

  it('ends with exactly one newline', () => {
    expect(fmt('flowchart LR\n  a --> b')).toBe(src('flowchart LR', '', '  a --> b'));
    expect(fmt('flowchart LR\n  a --> b\n\n\n')).toBe(src('flowchart LR', '', '  a --> b'));
  });

  it('writes nodes in order of first declaration, and never writes never-declared nodes', () => {
    const text = lr('  z --> y', '  subgraph s [S]', '    m[M]', '    k --> j[J]', '  end', '  b[B]', '  a[A]');
    expect(fmt(text)).toBe(lr(
      '', '  b["B"]', '  a["A"]', '', '  subgraph s [S]', '    m["M"]', '    j["J"]', '  end', '', '  z --> y', '  k --> j',
    ));
  });

  it('keeps pass-through lines in original order, removing a trailing ";" only', () => {
    const text = lr('  style a   fill:#fff ;', '  a --> b', '  classDef  hot  fill:#f96;', '  click a "x"');
    expect(fmt(text)).toBe(lr('', '  a --> b', '', '  style a   fill:#fff', '  classDef  hot  fill:#f96', '  click a "x"'));
  });
});

describe('§3.3 lane labels', () => {
  it.each([
    ['Operations', 'Operations'],
    ["It's ok, yes? no! a-b_c.d", "It's ok, yes? no! a-b_c.d"],
    ['Finance & approvals', '"Finance & approvals"'],
    ['Two  spaces', '"Two  spaces"'],
    [' leading', '" leading"'],
    ['trailing ', '"trailing "'],
    ['', '""'],
    ['Café', '"Café"'],
    ['a/b', '"a/b"'],
    ['Say "hi"', '"Say #quot;hi#quot;"'],
    ['#quot; literal', '"#35;quot; literal"'],
    ['tab\there', '"tab\there"'],
  ])('writes %j as [%s]', (label, written) => {
    const d = emptyDiagram();
    d.lanes.push({ id: 's', label, comments: [], nodes: [], endComments: [] });
    const out = format(d);
    expect(out).toBe(lr('', `  subgraph s [${written}]`, '  end'));
    expect(parse(out).diagram.lanes[0]!.label).toBe(label);
  });

  it('writes a lane with no label as [id]', () => {
    expect(fmt(lr('  subgraph my_lane-1', '  end'))).toBe(lr('', '  subgraph my_lane-1 [my_lane-1]', '  end'));
  });
});

describe('§3.3 edge labels', () => {
  it('writes an edge label unquoted when it passes the lane-label test, else quoted', () => {
    expect(fmt(lr('  a -- yes --> b', '  a -->|"no"| b', '  a -->|"two  spaces"| b', '  a -->|"(x)"| b', '  a -->|" x"| b')))
      .toBe(lr('', '  a -->|yes| b', '  a -->|no| b', '  a -->|"two  spaces"| b', '  a -->|"(x)"| b', '  a -->|" x"| b'));
  });

  it('writes no label for an empty one', () => {
    expect(fmt(lr('  a -->|| b', '  a -- --> b'))).toBe(lr('', '  a --> b', '  a --> b'));
  });

  it('encodes quotes and escape-like text in quoted edge labels', () => {
    expect(fmt(lr('  a -->|say #quot;x#quot;| b', '  a -->|"#35;92; stays"| b'))).toBe(
      lr('', '  a -->|"say #quot;x#quot;"| b', '  a -->|"#35;92; stays"| b'),
    );
  });
});

describe('§3.3 node declarations', () => {
  it('always writes a quoted label in each shape, with the class suffix', () => {
    const text = lr(
      '  a[A]', '  b{B}', '  c([C])', '  d[[D]]', '  e[(E)]', '  f[/F/]', '  g@{label: "G",shape: doc}',
      '  h@{ shape:  delay , label:   "H" }', '  i[I]:::hot',
    );
    expect(fmt(text)).toBe(lr(
      '', '  a["A"]', '  b{"B"}', '  c(["C"])', '  d[["D"]]', '  e[("E")]', '  f[/"F"/]',
      '  g@{ shape: doc, label: "G" }', '  h@{ shape: delay, label: "H" }', '  i["I"]:::hot',
    ));
  });

  it('stores labels decoded and re-encodes them on write', () => {
    const { diagram } = parse(lr('  a["Say #quot;hi#quot; #35;quot; #92; #amp;"]'));
    expect(diagram.unlaned[0]!.label).toBe('Say "hi" #quot; \\ #amp;');
    expect(format(diagram)).toBe(lr('', '  a["Say #quot;hi#quot; #35;quot; \\ #amp;"]'));
  });

  it('writes a literal #quot;, #35; or #92; with its # as #35;', () => {
    for (const literal of ['#quot;', '#35;', '#92;']) {
      const out = formatNodeDecl({ id: 'a', shape: 'step', label: `x ${literal} y`, className: null });
      expect(out).toBe(`a["x #35;${literal.slice(1)} y"]`);
      expect(parse(lr(`  ${out}`)).diagram.unlaned[0]!.label).toBe(`x ${literal} y`);
    }
    expect(formatNodeDecl({ id: 'a', shape: 'step', label: '#35 #quot #x; ##', className: null })).toBe(
      'a["#35 #quot #x; ##"]',
    );
  });

  it('writes a backslash as #92; inside @{…} labels and as is elsewhere', () => {
    expect(formatNodeDecl({ id: 'a', shape: 'document', label: 'C:\\x', className: null })).toBe(
      'a@{ shape: doc, label: "C:#92;x" }',
    );
    expect(formatNodeDecl({ id: 'a', shape: 'io', label: 'C:\\x', className: null })).toBe('a[/"C:\\x"/]');
    expect(fmt(lr('  a[C:#92;x]', '  b@{ shape: delay, label: "D:#92;y" }'))).toBe(
      lr('', '  a["C:\\x"]', '  b@{ shape: delay, label: "D:#92;y" }'),
    );
  });
});

describe('§3.3 comment rules', () => {
  it('file comment: comments before the header plus those right after it, at column 0', () => {
    const text = src('  %% before', '', '%% also before', 'flowchart LR', '    %% right after', '%% still', '', '%% not file', '  a --> b');
    expect(fmt(text)).toBe(src(
      'flowchart LR', '%% before', '%% also before', '%% right after', '%% still', '', '  %% not file', '  a --> b',
    ));
  });

  it('file comment stays at the top even though a statement follows it', () => {
    expect(fmt(src('flowchart LR', '%% about', '  subgraph s [S]', '  end'))).toBe(
      src('flowchart LR', '%% about', '', '  subgraph s [S]', '  end'),
    );
  });

  it('blank lines inside a comment block do not split it, and a blank line before the statement does not detach it', () => {
    expect(fmt(lr('  a["A"]', '', '  %% one', '', '  %% two', '', '', '  a --> b'))).toBe(
      lr('', '  a["A"]', '', '  %% one', '  %% two', '  a --> b'),
    );
  });

  it('a comment block after the last statement is trailing, at column 0', () => {
    expect(fmt(lr('  a --> b', '    %% t1', '', '  %% t2'))).toBe(lr('', '  a --> b', '', '%% t1', '%% t2'));
    expect(fmt(lr('  subgraph s [S]', '  end', '  %% after end'))).toBe(
      lr('', '  subgraph s [S]', '  end', '', '%% after end'),
    );
  });

  it('an edge written inside a subgraph moves to the edge section with its comment', () => {
    const text = lr('  subgraph s [S]', '    a["A"]', '    %% why', '    a --> b', '    b["B"]', '  end');
    expect(fmt(text)).toBe(lr('', '  subgraph s [S]', '    a["A"]', '    b["B"]', '  end', '', '  %% why', '  a --> b'));
  });

  it('a line with several edges gives its comment to the first edge', () => {
    expect(fmt(lr('', '  %% c', '  x["X"] --> a & b --> c'))).toBe(
      lr('', '  x["X"]', '', '  %% c', '  x --> a', '  x --> b', '  a --> c', '  b --> c'),
    );
  });

  it('a line with no edge gives its comment to its node declaration', () => {
    expect(fmt(lr('  subgraph s [S]', '    %% about a', '    a["A"]', '  end', '  %% about b', '  b["B"]'))).toBe(
      lr('', '  %% about b', '  b["B"]', '', '  subgraph s [S]', '    %% about a', '    a["A"]', '  end'),
    );
  });

  it('a comment above a dropped line goes with the next kept statement', () => {
    const text = lr(
      '  a["A"]', '  %% above direction', '  direction TB', '  %% above repeat', '  a["A"]', '  a --> b', '  %% at end',
      '  direction LR',
    );
    expect(fmt(text)).toBe(lr('', '  a["A"]', '', '  %% above direction', '  %% above repeat', '  a --> b', '', '%% at end'));
  });

  it('a comment above a subgraph stays above that subgraph line', () => {
    expect(fmt(lr('  a --> b', '  %% lane note', '  subgraph s [S]', '    b["B"]', '  end'))).toBe(
      lr('', '  %% lane note', '  subgraph s [S]', '    b["B"]', '  end', '', '  a --> b'),
    );
  });

  it('a comment directly above end stays as the last line inside the lane, at 4 spaces', () => {
    const text = lr('  subgraph s [S]', '    a["A"]', '    a --> b', '%% closing', '', '  end', '  b["B"]');
    expect(fmt(text)).toBe(lr('', '  b["B"]', '', '  subgraph s [S]', '    a["A"]', '    %% closing', '  end', '', '  a --> b'));
  });

  it('a comment above a pass-through line travels with it', () => {
    expect(fmt(lr('', '  %% colours', '  classDef hot fill:#f96', '  a --> b'))).toBe(
      lr('', '  a --> b', '', '  %% colours', '  classDef hot fill:#f96'),
    );
  });

  it('keeps %%{init}%% directives as comments', () => {
    expect(fmt(src('%%{init: {"flowchart": {"curve": "basis"}}}%%', 'graph TD', '  a --> b'))).toBe(
      src('flowchart TB', '%%{init: {"flowchart": {"curve": "basis"}}}%%', '', '  a --> b'),
    );
  });
});
