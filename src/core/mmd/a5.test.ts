// Amendment A5 (design.md §3.2, §12): a `.mmd` with no subgraphs is a plain flowchart and gives no W-no-lane warnings;
// one subgraph anywhere (even an empty or broken one) brings them back for every unlaned node.
import { parse } from './index';

const warnings = (text: string) => parse(text).problems.warnings.map((w) => [w.code, w.line]);

describe('A5: no W-no-lane without subgraphs', () => {
  test('declared, inline and never-declared nodes in a lane-free file: no warnings', () => {
    expect(warnings('flowchart LR\n  a["A"]\n  b{"B"} --> c\n  a --> ghost\n')).toEqual([]);
    expect(warnings('flowchart TB\n  a --> b\n')).toEqual([]);
  });

  test('other warnings stay', () => {
    expect(warnings('flowchart LR\n  direction TB\n  a["A"]\n')).toEqual([['W-direction', 2]]);
  });

  test('with a subgraph (even an empty one) unlaned nodes still warn', () => {
    expect(warnings('flowchart LR\n  a["A"]\n  subgraph s [S]\n  end\n  a --> ghost\n'))
      .toEqual([['W-no-lane', 2], ['W-no-lane', 5]]);
  });

  test('a broken subgraph line counts as a subgraph (the file is meant to have lanes)', () => {
    const r = parse('flowchart LR\n  a["A"]\n  subgraph end [S]\n  end\n');
    expect(r.problems.errors.map((e) => e.code)).toEqual(['E-syntax']);
    expect(r.problems.warnings.map((w) => w.code)).toEqual(['W-no-lane']);
  });
});
