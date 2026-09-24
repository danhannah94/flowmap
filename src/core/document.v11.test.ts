// document.ts with v1.1 files: everything merged and handed to the layout (sizes, edge entries, notes, the title),
// block styles, the UI31 rules for broken files, and problem order.
import { loadDocument } from './document';
import { Ctx } from './ops/context';

const MMD = [
  'flowchart LR',
  '',
  '  subgraph l1 [One]',
  '    a["A"]',
  '    b{"B?"}',
  '  end',
  '',
  '  subgraph l2 [Two]',
  '    c(["C"])',
  '  end',
  '',
  '  a --> b',
  '  b -->|yes| c',
  '  a --> c',
  '  a --> c',
  '',
].join('\n');

const CONFIG = [
  'version: 1',
  'title: Shaped',
  'styles:',
  '  - legend: Everything',
  '    match: {}',
  '    style: {fill: "#111", border_width: 2}',
  'nodes:',
  '  a:',
  '    style: {fill: "#F96", text_color: {light: "#000", dark: "#fff"}}',
  'notes:',
  '  note1: {text: "Freight\\nis slow", font_size: 18}',
  '  note2: {text: Ask Sam, bold: true, color: "#b85450"}',
  '  note3: {text: Unplaced}',
  '',
].join('\n');

const LAYOUT = JSON.stringify({
  version: 1,
  nodes: {
    a: { lane: 'l1', along: -40, across: -20, width: 200, height: 80 },
    b: { lane: 'l2', along: 300, across: 0, width: 120, height: 120 }, // stale lane: pin ignored, size kept
    c: { width: 90, height: 60 },
  },
  edges: {
    'a->b': { source_side: 'bottom', target_side: 'top', points: [{ lane: 'l1', along: 100, across: 150 }], label_at: 0.25 },
    'b->c': { points: [{ lane: 'gone', along: 1, across: 1 }], label_at: 0.5 },
    'a->c#2': { target_side: 'left' },
  },
  notes: { note1: { x: -40, y: -60 }, note2: { x: 500, y: 20 } },
  title: { x: 10, y: -48 },
});

describe('loadDocument with v1.1 files', () => {
  const doc = loadDocument(MMD, CONFIG, LAYOUT, 'shaped.mmd');

  test('no problems', () => {
    expect(doc.problems).toEqual({ errors: [], warnings: [] });
  });
  test('effective pins and sizes: a stale pin is ignored, its size still applies', () => {
    expect(doc.pins).toEqual({ a: { lane: 'l1', along: -40, across: -20 } });
    expect(doc.sizes).toEqual({ a: { width: 200, height: 80 }, b: { width: 120, height: 120 }, c: { width: 90, height: 60 } });
  });
  test('edge entries: a point set with a missing lane is ignored, the rest of its entry stays', () => {
    expect(doc.edgeEntries).toEqual({
      'a->b': { source_side: 'bottom', target_side: 'top', points: [{ lane: 'l1', along: 100, across: 150 }], label_at: 0.25 },
      'b->c': { label_at: 0.5 },
      'a->c#2': { target_side: 'left' },
    });
  });
  test('notes in config order with defaults applied and their positions', () => {
    expect(doc.notes).toEqual([
      { id: 'note1', text: 'Freight\nis slow', font_size: 18, bold: false, position: { x: -40, y: -60 } },
      { id: 'note2', text: 'Ask Sam', font_size: 14, bold: true, color: '#b85450', position: { x: 500, y: 20 } },
      { id: 'note3', text: 'Unplaced', font_size: 14, bold: false, position: null },
    ]);
  });
  test('the title: text, shown, position', () => {
    expect(doc.title).toBe('Shaped');
    expect(doc.showTitle).toBe(true);
    expect(doc.titlePosition).toEqual({ x: 10, y: -48 });
  });
  test('the layout gets the parsed file, the notes (without positions) and the shown title', () => {
    expect(doc.layoutInput.graph).toBe(doc.graph);
    expect(doc.layoutInput.file).toBe(doc.layoutFile);
    expect(doc.layoutFile!.title).toEqual({ x: 10, y: -48 });
    expect(doc.layoutInput.notes).toEqual([
      { id: 'note1', text: 'Freight\nis slow', font_size: 18, bold: false },
      { id: 'note2', text: 'Ask Sam', font_size: 14, bold: true, color: '#b85450' },
      { id: 'note3', text: 'Unplaced', font_size: 14, bold: false },
    ]);
    expect(doc.layoutInput.title).toBe('Shaped');
    expect(doc.layout).not.toBeNull();
  });
  test('styles: rules, then the block\'s own style; not in the legend', () => {
    expect(doc.styles.a).toEqual({ fill: '#ff9966', border_width: 2, text_color: { light: '#000000', dark: '#ffffff' } });
    expect(doc.styles.b).toEqual({ fill: '#111111', border_width: 2 });
    expect(doc.legend).toEqual([{ text: 'Everything', style: { fill: '#111111', border_width: 2 } }]);
  });
});

describe('the title hidden', () => {
  test('show_title: false hands the layout a null title; the text is still known', () => {
    const doc = loadDocument(MMD, 'show_title: false\n', null, 'x.mmd');
    expect(doc.showTitle).toBe(false);
    expect(doc.title).toBe('x');
    expect(doc.layoutInput.title).toBeNull();
    expect(doc.layoutInput.notes).toEqual([]);
  });
});

describe('orphans: W-layout-unknown-node, -edge, -note (UI27)', () => {
  const layout = JSON.stringify({
    version: 1,
    nodes: { ghost: { width: 50, height: 50 } },
    edges: { 'a->b': { label_at: 0.5 }, 'a->zz': { label_at: 0.5 }, 'a->c#3': { source_side: 'top' } },
    notes: { note1: { x: 0, y: 0 }, lost: { x: 1, y: 1 } },
  });
  test('each is reported after the config\'s warnings, in order node, edge, note', () => {
    const doc = loadDocument(MMD, 'notes:\n  note1: {text: x}\nnodes:\n  gone: {k: v}\n', layout, 'x.mmd');
    expect(doc.problems.errors).toEqual([]);
    expect(doc.problems.warnings.map((p) => [p.code, p.line])).toEqual([
      ['W-config-unknown-node', null],
      ['W-layout-unknown-node', null],
      ['W-layout-unknown-edge', null],
      ['W-layout-unknown-edge', null],
      ['W-layout-unknown-note', null],
    ]);
    expect(doc.notes.map((n) => n.position)).toEqual([{ x: 0, y: 0 }]);
  });
  test('no config file: every placed note is unknown', () => {
    const doc = loadDocument(MMD, null, layout, 'x.mmd');
    expect(doc.problems.warnings.filter((p) => p.code === 'W-layout-unknown-note')).toHaveLength(2);
  });
  test('with E-config the notes can\'t be read: no notes, the title shown, no W-layout-unknown-note (UI31)', () => {
    const doc = loadDocument(MMD, 'show_title: false\nnotes:\n  note1: {bold: true}\n', layout, 'x.mmd');
    expect(doc.problems.errors.map((p) => p.code)).toEqual(['E-config']);
    expect(doc.problems.warnings.map((p) => p.code)).not.toContain('W-layout-unknown-note');
    expect(doc.notes).toEqual([]);
    expect(doc.showTitle).toBe(true);
    expect(doc.layoutInput.title).toBe('x');
    expect(doc.layoutInput.notes).toEqual([]);
    expect(doc.layout).not.toBeNull();
  });
});

describe('R14.6: under E-config the title is the file\'s base name, even when the config has a title', () => {
  test.each([
    ['a bad version', 'version: 2\ntitle: Set by hand\n'],
    ['a bad show_title', 'title: Set by hand\nshow_title: yes\n'],
    ['YAML that doesn\'t parse', 'title: Set by hand\nlanes: [\n'],
    ['a note-id clash', 'title: Set by hand\nnotes:\n  a: {text: x}\n'],
    ['E-config with show_title: false', 'title: Set by hand\nshow_title: false\nversion: 3\n'],
  ])('%s', (_name, config) => {
    const doc = loadDocument(MMD, config, null, 'some/dir/my-diagram.mmd');
    expect(doc.problems.errors.map((p) => p.code)).toEqual(['E-config']);
    expect(doc.title).toBe('my-diagram');
    expect(doc.showTitle).toBe(true);
    expect(doc.layout!.result.title?.text).toBe('my-diagram');
  });
});

describe('a note id that clashes with a node or lane id is E-config', () => {
  const doc = loadDocument(MMD, 'nodes:\n  a:\n    style: {fill: "#f00"}\nnotes:\n  l2: {text: x}\n', null, 'x.mmd');
  test('reported with line null; the config then counts as having errors', () => {
    expect(doc.problems.errors.map((p) => [p.code, p.line])).toEqual([['E-config', null]]);
    expect(doc.config).toBeNull();
    expect(doc.styles.a).toEqual({});
    expect(doc.notes).toEqual([]);
  });
});

describe('E-layout for v1.1 content: none of the file\'s placements apply', () => {
  test.each([
    ['a size below 40', { nodes: { a: { width: 39, height: 50 } } }],
    ['an empty edge entry', { nodes: {}, edges: { 'a->b': {} } }],
    ['label_at with three decimals', { nodes: {}, edges: { 'a->b': { label_at: 0.125 } } }],
    ['a bend point with a negative across outside the first lane', { nodes: {}, edges: { 'a->b': { points: [{ lane: 'l2', along: 0, across: -1 }] } } }],
    ['an empty title', { nodes: {}, title: {} }],
  ])('%s', (_n, body) => {
    const doc = loadDocument(MMD, CONFIG, JSON.stringify({ version: 1, ...body }), 'x.mmd');
    expect(doc.problems.errors.map((p) => [p.code, p.line])).toEqual([['E-layout', null]]);
    expect(doc.layoutFile).toBeNull();
    expect(doc.layoutInput.file).toBeNull();
    expect(doc.pins).toEqual({});
    expect(doc.sizes).toEqual({});
    expect(doc.edgeEntries).toEqual({});
    expect(doc.titlePosition).toBeNull();
    expect(doc.notes.every((n) => n.position === null)).toBe(true);
    expect(doc.layout).not.toBeNull();
  });
  test('a negative across in the first lane is fine (config order decides which lane is first)', () => {
    const body = JSON.stringify({ version: 1, nodes: {}, edges: { 'a->b': { points: [{ lane: 'l2', along: 0, across: -1 }] } } });
    expect(loadDocument(MMD, 'lanes:\n  - id: l2\n', body, 'x.mmd').problems.errors).toEqual([]);
  });
});

describe('problem order: .mmd, then config (parse, then note clashes), then layout (parse, then ranges)', () => {
  test('errors', () => {
    const mmd = MMD + '  weird line\n';
    const doc = loadDocument(mmd, 'notes:\n  a: {text: x}\n', '{"version": 1, "nodes": {}, "edges": {"a->b": {}}}', 'x.mmd');
    expect(doc.problems.errors.map((p) => p.code)).toEqual(['E-syntax', 'E-config', 'E-layout']);
    expect(doc.layout).toBeNull();
  });
});

describe('taken ids include config and layout notes keys (§3.1)', () => {
  test('a new block id skips note ids', () => {
    const ctx = new Ctx({ mmd: MMD, config: 'notes:\n  n1: {text: x}\n', layout: '{"version": 1, "nodes": {}, "notes": {"n2": {"x": 0, "y": 0}}}' });
    expect(ctx.isTaken('n1')).toBe(true);
    expect(ctx.isTaken('n2')).toBe(true);
    expect(ctx.nextNodeId()).toBe('n3');
  });
});
