// The contract fixtures (design.md §10 C1–C3): exact canonical output, expected warnings, lanes, edge ids, labels,
// and one error code and line per error file.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { format, parse, toGraph } from './index';

const FIXTURES = join(import.meta.dirname, '../../../fixtures');
const read = (...parts: string[]) => readFileSync(join(FIXTURES, ...parts), 'utf8');

const syntaxCases = readdirSync(join(FIXTURES, 'syntax'))
  .filter((f) => f.endsWith('.mmd') && !f.endsWith('.canonical.mmd'))
  .map((f) => f.replace(/\.mmd$/, ''));

describe('fixtures/syntax (C1, C2)', () => {
  it('finds the syntax fixtures', () => {
    expect(syntaxCases).toEqual(expect.arrayContaining(['edge-cases', 'shapes']));
  });

  describe.each(syntaxCases)('%s', (name) => {
    const source = read('syntax', `${name}.mmd`);
    const canonical = read('syntax', `${name}.canonical.mmd`);
    const expected = JSON.parse(read('syntax', `${name}.expected.json`));
    const { diagram, problems } = parse(source);
    const graph = toGraph(diagram);

    it('formats to exactly its .canonical.mmd', () => {
      expect(format(diagram)).toBe(canonical);
    });

    it('the canonical file is a fixed point', () => {
      const again = parse(canonical);
      expect(again.problems.errors).toEqual([]);
      expect(format(again.diagram)).toBe(canonical);
    });

    it('reports the expected errors and warnings (order-free)', () => {
      expect(problems.errors.map((p) => p.code)).toEqual(expected.errors.map((p: { code: string }) => p.code));
      const got = problems.warnings.map((p) => `${p.code}@${p.line}`).sort();
      const want = expected.warnings.map((p: { code: string; line: number }) => `${p.code}@${p.line}`).sort();
      expect(got).toEqual(want);
    });

    it('derives the expected edge ids', () => {
      expect(graph.edges.map((e) => e.id)).toEqual(expected.edge_ids);
    });

    if (expected.lanes) {
      it('puts nodes in the expected lanes', () => {
        const lanes: Record<string, string[]> = {};
        for (const node of graph.nodes) (lanes[node.lane] ??= []).push(node.id);
        for (const [lane, ids] of Object.entries(expected.lanes as Record<string, string[]>)) {
          expect([...(lanes[lane] ?? [])].sort()).toEqual([...ids].sort());
        }
        expect(Object.keys(lanes).sort()).toEqual(Object.keys(expected.lanes).sort());
      });
    }

    if (expected.groups) {
      it('puts nodes in the expected groups (A19)', () => {
        const groups: Record<string, string[]> = {};
        for (const node of graph.nodes) if (node.group) (groups[node.group] ??= []).push(node.id);
        expect(groups).toEqual(expected.groups);
      });
    }

    if (expected.group_parents) {
      it('nests the groups as expected (A19)', () => {
        expect(Object.fromEntries((graph.groups ?? []).map((g) => [g.id, g.parent]))).toEqual(expected.group_parents);
      });
    }

    if (expected.kinds) {
      it('reads the expected shape kinds', () => {
        const kinds = Object.fromEntries(graph.nodes.map((n) => [n.id, n.kind]));
        expect(kinds).toMatchObject(expected.kinds);
      });
    }

    if (expected.labels) {
      it('decodes the expected node and lane labels', () => {
        const labels: Record<string, string> = {};
        for (const n of graph.nodes) labels[n.id] = n.label;
        for (const l of graph.lanes) labels[l.id] = l.label;
        expect(labels).toMatchObject(expected.labels);
      });
    }

    if (expected.edge_labels) {
      it('decodes the expected edge labels', () => {
        const labels = Object.fromEntries(graph.edges.map((e) => [e.id, e.label]));
        expect(labels).toMatchObject(expected.edge_labels);
      });
    }
  });
});

describe('fixtures/errors (C3)', () => {
  // The README's table is the expected code and line for each file.
  const table = read('errors', 'README.md')
    .split('\n')
    .map((row) => /^\| (E-\S+\.mmd)[^|]*\| (E-\S+) \| (\d+|null) \|$/.exec(row))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ file: m[1]!, code: m[2]!, line: m[3] === 'null' ? null : Number(m[3]) }));

  it('reads the README table', () => {
    expect(table.length).toBeGreaterThanOrEqual(7);
  });

  // E-config is the config module's problem; the .mmd itself must be clean of errors.
  for (const { file, code, line } of table) {
    if (code === 'E-config') {
      it(`${file} has no .mmd errors (its error is in the config)`, () => {
        expect(parse(read('errors', file)).problems.errors).toEqual([]);
      });
      continue;
    }
    it(`${file} gives ${code} at line ${line}`, () => {
      const { errors } = parse(read('errors', file)).problems;
      expect(errors.map((e) => [e.code, e.line])).toContainEqual([code, line]);
      // Each error fixture has exactly one error: no cascades.
      expect(errors).toHaveLength(1);
    });
  }
});

describe('fixtures/purchase-request', () => {
  const source = read('purchase-request', 'purchase-request.mmd');

  it('is already canonical and has no problems', () => {
    const { diagram, problems } = parse(source);
    expect(problems).toEqual({ errors: [], warnings: [] });
    expect(format(diagram)).toBe(source);
  });

  it('orders lanes by the config lane list', () => {
    const { diagram } = parse(source);
    const graph = toGraph(diagram, ['vendor', 'requester', 'nope']);
    expect(graph.lanes.map((l) => l.id)).toEqual(['vendor', 'requester', 'manager', 'purchasing', 'finance']);
    expect(graph.nodes).toHaveLength(20);
    expect(graph.edges).toHaveLength(22);
  });
});
