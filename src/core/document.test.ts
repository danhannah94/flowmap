// Unit tests for document.ts: the merged view of the three files (design.md §2, §7).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDocument } from './document';

const FIXTURES = join(import.meta.dirname, '../../fixtures');
const read = (...parts: string[]) => readFileSync(join(FIXTURES, ...parts), 'utf8');

describe('loadDocument: a clean diagram with config and layout (purchase-request)', () => {
  const mmd = read('purchase-request', 'purchase-request.mmd');
  const config = read('purchase-request', 'purchase-request.flow.yaml');
  const layoutFile = read('purchase-request', 'purchase-request.layout.json');
  const doc = loadDocument(mmd, config, layoutFile, 'purchase-request.mmd');

  it('has no errors', () => {
    expect(doc.problems.errors).toEqual([]);
  });

  it('parses the config', () => {
    expect(doc.config).not.toBeNull();
    expect(doc.config?.title).toBe('Purchase request approval (current state, synthetic)');
  });

  it('uses the config title', () => {
    expect(doc.title).toBe('Purchase request approval (current state, synthetic)');
  });

  it('respects the pin on "closed"', () => {
    expect(doc.pins['closed']).toEqual({ lane: 'requester', along: 1400, across: 40 });
  });

  it('computes a layout in which "closed" is pinned at its exact position', () => {
    expect(doc.layout).not.toBeNull();
    const node = doc.layout!.result.nodes.find((n) => n.id === 'closed');
    expect(node?.pinned).toBe(true);
  });

  it('resolves a style for every node', () => {
    for (const node of doc.graph.nodes) expect(doc.styles).toHaveProperty(node.id);
    // m01 is marked kind: wait, matching the "Waiting on someone" rule (a fill and a badge).
    expect(doc.styles['m01']).toMatchObject({ badge: 'wait' });
  });

  it('builds a non-empty legend', () => {
    expect(doc.legend.length).toBeGreaterThan(0);
  });
});

describe('loadDocument: .mmd errors are fatal for layout', () => {
  const mmd = read('errors', 'E-header.mmd');
  const doc = loadDocument(mmd, null, null, 'E-header.mmd');

  it('reports E-header at line 1', () => {
    expect(doc.problems.errors).toContainEqual({ code: 'E-header', line: 1, message: expect.any(String) });
  });

  it('does not compute a layout', () => {
    expect(doc.layout).toBeNull();
  });

  it('still returns an empty (not-null) config and no pins', () => {
    expect(doc.config).not.toBeNull();
    expect(doc.pins).toEqual({});
  });

  it('falls back to the .mmd base name as the title', () => {
    expect(doc.title).toBe('E-header');
  });
});

describe('loadDocument: E-config is not fatal for layout', () => {
  const mmd = read('errors', 'E-config.mmd');
  const config = read('errors', 'E-config.flow.yaml');
  const doc = loadDocument(mmd, config, null, 'E-config.mmd');

  it('has no .mmd errors', () => {
    expect(doc.diagram).toBeTruthy();
  });

  it('reports E-config with a null line', () => {
    expect(doc.problems.errors).toContainEqual({ code: 'E-config', line: null, message: expect.any(String) });
  });

  it('still computes a layout (default styles)', () => {
    expect(doc.layout).not.toBeNull();
  });

  it('gives every node the default (empty) style', () => {
    for (const style of Object.values(doc.styles)) expect(style).toEqual({});
  });

  it('has an empty legend', () => {
    expect(doc.legend).toEqual([]);
  });

  it('falls back to the .mmd base name as the title', () => {
    expect(doc.title).toBe('E-config');
  });
});

describe('loadDocument: a malformed layout file is not fatal, and drops its pins', () => {
  const mmd = 'flowchart LR\n  a["A"]\n  b["B"]\n  a --> b\n';
  const doc = loadDocument(mmd, null, '{not valid json', 'x.mmd');

  it('reports E-layout with a null line', () => {
    expect(doc.problems.errors).toContainEqual({ code: 'E-layout', line: null, message: expect.any(String) });
  });

  it('lays out with no pins', () => {
    expect(doc.pins).toEqual({});
    expect(doc.layout).not.toBeNull();
    for (const node of doc.layout!.result.nodes) expect(node.pinned).toBe(false);
  });
});

describe('loadDocument: problem order is .mmd (by line), then config, then layout', () => {
  const mmd = 'flowchart LR\n  a["A"]\n  weird line that is not mermaid\n';
  const config = 'version: 1\nstyles: [not valid\n';
  const layoutFile = '{not valid json';
  const doc = loadDocument(mmd, config, layoutFile, 'x.mmd');

  it('orders errors mmd, then config, then layout', () => {
    expect(doc.problems.errors.map((p) => p.code)).toEqual(['E-syntax', 'E-config', 'E-layout']);
  });
});

describe('loadDocument: cross-file checks are folded into their file group', () => {
  const mmd = 'flowchart LR\n  subgraph lane1 [Lane One]\n    a["A"]\n  end\n';
  const config = 'version: 1\nnodes:\n  ghost:\n    confidence: confirmed\n';
  const layoutFile = '{"version": 1, "nodes": {"ghost": {"lane": "lane1", "along": 0, "across": 12}}}';
  const doc = loadDocument(mmd, config, layoutFile, 'x.mmd');

  it('warns about the config entry for a node not in the diagram', () => {
    expect(doc.problems.warnings).toContainEqual(
      expect.objectContaining({ code: 'W-config-unknown-node', line: null }),
    );
  });

  it('warns about the pin for a node not in the diagram', () => {
    expect(doc.problems.warnings).toContainEqual(
      expect.objectContaining({ code: 'W-layout-unknown-node', line: null }),
    );
  });

  it('drops the unknown pin from the effective pins', () => {
    expect(doc.pins).toEqual({});
  });
});

describe('loadDocument: no config or layout file at all', () => {
  const mmd = 'flowchart LR\n  subgraph lane1 [Lane One]\n    a["A"]\n    b["B"]\n  end\n\n  a --> b\n';
  const doc = loadDocument(mmd, null, null, 'diagram.mmd');

  it('gives an empty, non-null config', () => {
    expect(doc.config).toEqual({ version: 1, title: null, lanes: null, styles: [], nodes: {}, nodeStyles: {}, notes: {}, showTitle: true, preset: null });
  });

  it('has no problems', () => {
    expect(doc.problems).toEqual({ errors: [], warnings: [] });
  });

  it('titles the diagram from the .mmd base name, stripping the extension', () => {
    expect(doc.title).toBe('diagram');
  });
});
