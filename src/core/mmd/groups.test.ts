// Amendment A19: subgraphs inside lanes are groups. Parsing (§3.1, §3.2), canonical form (§3.3) and the graph view,
// including a seeded round-trip property over random nested diagrams written in non-canonical order.
import { allGroups, declaredNodes, findNode, format, parse, subgraphIds, toGraph } from './index';

const lr = (...lines: string[]) => ['flowchart LR', ...lines].join('\n') + '\n';
const errors = (text: string) => parse(text).problems.errors.map((p) => [p.code, p.line]);
const ok = (text: string) => {
  const r = parse(text);
  expect(r.problems.errors).toEqual([]);
  return r;
};

const NESTED = lr(
  '',
  '  subgraph acct [Account]',
  '    gw["Gateway"]',
  '    subgraph net [Network]',
  '      lb["Load balancer"]',
  '      subgraph sub-a [Subnet A]',
  '        app["App"]',
  '        subgraph deep [Deeper]',
  '          worker["Worker"]',
  '        end',
  '      end',
  '    end',
  '  end',
  '',
  '  gw --> lb',
  '  lb --> app',
  '  app --> worker',
);

describe('A19 parse: groups', () => {
  it('a subgraph inside a lane is a group; nodes take the innermost group, their lane stays the lane', () => {
    const { diagram, problems } = ok(NESTED);
    expect(problems.warnings).toEqual([]);
    expect(diagram.lanes.map((l) => l.id)).toEqual(['acct']);
    expect(declaredNodes(diagram).map((e) => [e.node.id, e.lane, e.group])).toEqual([
      ['gw', 'acct', null], ['lb', 'acct', 'net'], ['app', 'acct', 'sub-a'], ['worker', 'acct', 'deep'],
    ]);
    expect(allGroups(diagram).map((g) => [g.group.id, g.lane, g.parent, g.depth])).toEqual([
      ['net', 'acct', null, 1], ['sub-a', 'acct', 'net', 2], ['deep', 'acct', 'sub-a', 3],
    ]);
    expect(subgraphIds(diagram)).toEqual(['acct', 'net', 'sub-a', 'deep']);
    expect(findNode(diagram, 'worker')).toMatchObject({ lane: 'acct', group: 'deep' });
  });

  it('the graph lists groups (file order) and each grouped node carries its group; lanes are unchanged', () => {
    const graph = toGraph(ok(NESTED).diagram);
    expect(graph.lanes).toEqual([{ id: 'acct', label: 'Account' }]);
    expect(graph.groups).toEqual([
      { id: 'net', label: 'Network', lane: 'acct', parent: null },
      { id: 'sub-a', label: 'Subnet A', lane: 'acct', parent: 'net' },
      { id: 'deep', label: 'Deeper', lane: 'acct', parent: 'sub-a' },
    ]);
    expect(graph.nodes.map((n) => [n.id, n.lane, n.group])).toEqual([
      ['gw', 'acct', undefined], ['lb', 'acct', 'net'], ['app', 'acct', 'sub-a'], ['worker', 'acct', 'deep'],
    ]);
    expect('group' in graph.nodes[0]!).toBe(false);
  });

  it('a diagram without groups has no groups key and no node group (unchanged graph)', () => {
    const graph = toGraph(ok(lr('  subgraph a [A]', '    x["X"]', '  end')).diagram);
    expect('groups' in graph).toBe(false);
    expect(graph.nodes).toEqual([{ id: 'x', label: 'X', kind: 'step', lane: 'a' }]);
  });

  it('group ids follow the subgraph id rules and must be unique across lanes, groups and nodes', () => {
    expect(errors(lr('  subgraph a [A]', '    subgraph end-x [X]', '    end', '  end'))).toEqual([['E-syntax', 3]]);
    // A group repeating a lane id, another group's id, or a node id: E-duplicate at the later one.
    expect(errors(lr('  subgraph a [A]', '    subgraph a [X]', '    end', '  end'))).toEqual([['E-duplicate', 3]]);
    expect(errors(lr(
      '  subgraph a [A]', '    subgraph g [G]', '    end', '  end', '  subgraph b [B]', '    subgraph g [G2]', '    end', '  end',
    ))).toEqual([['E-duplicate', 7]]);
    expect(errors(lr('  x["X"]', '  subgraph a [A]', '    subgraph x [X]', '    end', '  end'))).toEqual([['E-duplicate', 4]]);
    expect(errors(lr('  subgraph a [A]', '    subgraph g [G]', '    end', '  end', '  g["G"]'))).toEqual([['E-duplicate', 6]]);
  });

  it('declaring a node again in another group (or the lane itself) is E-duplicate; the same group is fine', () => {
    const base = ['  subgraph a [A]', '    subgraph g [G]', '      x["X"]', '    end'];
    expect(errors(lr(...base, '    x["X"]', '  end'))).toEqual([['E-duplicate', 6]]);
    expect(errors(lr(...base, '    subgraph h [H]', '      x["X"]', '    end', '  end'))).toEqual([['E-duplicate', 7]]);
    expect(errors(lr('  subgraph a [A]', '    subgraph g [G]', '      x["X"]', '      x["X"]', '    end', '  end'))).toEqual([]);
  });

  it('an edge to or from a group id is E-syntax', () => {
    expect(errors(lr('  subgraph a [A]', '    subgraph g [G]', '      x["X"]', '    end', '  end', '  x --> g'))).toEqual([['E-syntax', 7]]);
  });

  it('an unclosed group is E-unclosed at its subgraph line (and so is its lane)', () => {
    expect(errors(lr('  subgraph a [A]', '    subgraph g [G]', '      x["X"]', '  end'))).toEqual([['E-unclosed', 2]]);
    expect(errors(lr('  subgraph a [A]', '    subgraph g [G]', '      x["X"]'))).toEqual([['E-unclosed', 2], ['E-unclosed', 3]]);
  });

  it('a grouped node gets no W-no-lane; an unlaned one in a file with groups still does', () => {
    const { problems } = parse(lr('  u["U"]', '  subgraph a [A]', '    subgraph g [G]', '      x["X"]', '    end', '  end'));
    expect(problems.warnings.map((w) => [w.code, w.line])).toEqual([['W-no-lane', 2]]);
  });

  it('nodes declared in a group whose subgraph line has an error fall back to the enclosing subgraph', () => {
    const r = parse(lr('  subgraph a [A]', '    subgraph bad [x] y', '      x["X"]', '    end', '  end'));
    expect(r.problems.errors.map((p) => p.code)).toEqual(['E-syntax']);
    expect(findNode(r.diagram, 'x')).toMatchObject({ lane: 'a', group: null });
  });
});

describe('A19 canonical form', () => {
  it('writes a subgraph\'s nodes, then its groups one level deeper, then its end comments', () => {
    const text = lr(
      '%% top',
      '',
      'subgraph acct [Account]',
      '%% above net',
      'subgraph net [Network]',
      'subgraph sub ["Sub #quot;net#quot;"]',
      'app[App]',
      '%% end of sub',
      'end',
      'lb[LB]',
      'end',
      '%% after net travels with gw',
      'gw[Gateway]',
      '%% end of acct',
      'end',
      'gw --> lb',
    );
    expect(format(ok(text).diagram)).toBe([
      'flowchart LR',
      '%% top',
      '',
      '  subgraph acct [Account]',
      '    %% after net travels with gw',
      '    gw["Gateway"]',
      '    %% above net',
      '    subgraph net [Network]',
      '      lb["LB"]',
      '      subgraph sub ["Sub #quot;net#quot;"]',
      '        app["App"]',
      '        %% end of sub',
      '      end',
      '    end',
      '    %% end of acct',
      '  end',
      '',
      '  gw --> lb',
      '',
    ].join('\n'));
  });

  it('is idempotent and round-trips the model on the nested example', () => {
    const once = format(ok(NESTED).diagram);
    expect(once).toBe(NESTED);
    expect(format(parse(once).diagram)).toBe(once);
  });

  it('an empty group is kept', () => {
    const text = lr('', '  subgraph a [A]', '    x["X"]', '    subgraph g [G]', '    end', '  end');
    expect(format(ok(text).diagram)).toBe(text);
  });
});

// ---- A seeded round-trip property over random nested diagrams ------------------------------------------------------

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { int: (n: number) => Math.floor(next() * n), chance: (p: number) => next() < p };
}

interface Spec {
  /** node id → [lane, group|null] as written */
  members: Map<string, [string, string | null]>;
  /** group id → parent (null: the lane) */
  parents: Map<string, string | null>;
  text: string;
}

/** A random diagram with lanes holding up to 4 levels of groups, written with nodes before, between and after groups. */
function randomNested(seed: number): Spec {
  const r = rng(seed);
  const members = new Map<string, [string, string | null]>();
  const parents = new Map<string, string | null>();
  let n = 0;
  let g = 0;
  const lines: string[] = [r.chance(0.5) ? 'flowchart LR' : 'graph TD'];
  const body = (lane: string, group: string | null, depth: number, indent: string) => {
    const items = 1 + r.int(4);
    for (let k = 0; k < items; k++) {
      if (depth < 4 && r.chance(0.35)) {
        const id = `g${++g}`;
        parents.set(id, group);
        if (r.chance(0.3)) lines.push(`${indent}%% about ${id}`);
        lines.push(`${indent}subgraph ${id}${r.chance(0.5) ? ' ' : ''}[Group ${g}]`);
        body(lane, id, depth + 1, indent + (r.chance(0.5) ? '  ' : ''));
        lines.push(`${indent}end`);
      } else {
        const id = `n${++n}`;
        members.set(id, [lane, group]);
        lines.push(`${indent}${id}${r.chance(0.5) ? `[Step ${n}]` : `(["Step ${n}"])`}`);
      }
    }
  };
  const lanes = 1 + r.int(3);
  for (let l = 1; l <= lanes; l++) {
    lines.push(`subgraph lane${l} [Lane ${l}]`);
    body(`lane${l}`, null, 0, '  ');
    lines.push('end');
  }
  const ids = [...members.keys()];
  for (let e = 0; e < ids.length; e++) {
    if (r.chance(0.6) && ids.length > 1) lines.push(`${ids[r.int(ids.length)]} --> ${ids[r.int(ids.length)]}`);
  }
  return { members, parents, text: lines.join('\n') + '\n' };
}

describe('A19 property: random nested diagrams', () => {
  for (let seed = 1; seed <= 60; seed++) {
    it(`seed ${seed}: parses cleanly, keeps every membership and nesting, and formats idempotently`, () => {
      const spec = randomNested(seed);
      const { diagram, problems } = parse(spec.text);
      expect(problems.errors).toEqual([]);
      const got = new Map(declaredNodes(diagram).map((e) => [e.node.id, [e.lane, e.group] as [string | null, string | null]]));
      expect(got).toEqual(spec.members);
      expect(new Map(allGroups(diagram).map((x) => [x.group.id, x.parent]))).toEqual(spec.parents);
      const once = format(diagram);
      const again = parse(once);
      expect(again.problems.errors).toEqual([]);
      expect(format(again.diagram)).toBe(once);
      const back = new Map(declaredNodes(again.diagram).map((e) => [e.node.id, [e.lane, e.group] as [string | null, string | null]]));
      expect(back).toEqual(spec.members);
      expect(again.diagram.edges.map((e) => `${e.source}>${e.target}`)).toEqual(diagram.edges.map((e) => `${e.source}>${e.target}`));
    });
  }
});
