// Property tests (design.md §10 C2, C7): seeded random diagrams written in random non-canonical syntax. For each, the
// generator records the meaning it wrote (lanes, nodes, edges, labels, kinds, comments) independently of the parser.
// Checked: the parse has no errors and matches that meaning; formatting is idempotent; and the canonical text
// parses back to the same model.
import { performance } from 'node:perf_hooks';
import { SHAPE_KINDS, type EdgeStyle, type ShapeKind } from '../types';
import type { Diagram } from './model';
import { declaredNodes, format, parse, toGraph } from './index';
import { encodeLabel, normaliseUnquoted, UNQUOTED_FORBIDDEN } from './syntax';

// ---- Seeded randomness ----------------------------------------------------------------------------------------------

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return {
    int,
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => items[int(items.length)]!,
  };
}
type Rng = ReturnType<typeof rng>;

// ---- Labels ---------------------------------------------------------------------------------------------------------

const WORDS = ['Check', 'the', 'order', 'Approve', 'over', '$5k', 'yes', 'no', 'a-b', "it's", 'done?', 'ok!', '1,000', 'x.y'];
const ODD = [
  '"', '#', '#quot;', '#35;', '#92;', '#amp;', '\\', '(', ')', '[', ']', '{', '}', '|', '&', ';', '/', ':', 'é', '  ', '->',
  '%%', ':::', '@',
];

function randomLabel(r: Rng): string {
  const parts: string[] = [];
  const n = 1 + r.int(4);
  for (let i = 0; i < n; i++) parts.push(r.chance(0.3) ? r.pick(ODD) : r.pick(WORDS));
  let label = parts.join(r.chance(0.8) ? ' ' : '');
  if (r.chance(0.05)) label = ` ${label} `;
  if (r.chance(0.02)) label = '';
  return label;
}

/** Encoded text usable unquoted (§3.1), with `"` written as `#quot;`; undefined when it can't be written unquoted. */
function unquotedForm(label: string, extraForbidden = ''): string | undefined {
  if (label === '' || normaliseUnquoted(label) !== label) return undefined;
  const text = encodeLabel(label);
  if ([...text].some((ch) => UNQUOTED_FORBIDDEN.has(ch) || extraForbidden.includes(ch))) return undefined;
  return text;
}

/** Sloppy whitespace that unquoted parsing trims and collapses. */
function pad(r: Rng, text: string): string {
  const spaced = r.chance(0.3) ? text.replace(/ /g, () => (r.chance(0.5) ? '  ' : ' \t')) : text;
  return (r.chance(0.3) ? '  ' : '') + spaced + (r.chance(0.3) ? ' ' : '');
}

/** Optionally write backslashes as `#92;` (allowed anywhere, §3.1). */
const quoted = (r: Rng, label: string) => {
  const text = encodeLabel(label);
  return `"${r.chance(0.5) ? text.replace(/\\/g, '#92;') : text}"`;
};

// ---- The generated diagram ------------------------------------------------------------------------------------------

interface SpecNode {
  id: string;
  shape: ShapeKind;
  label: string;
  className: string | null;
  lane: string | null;
}

interface Expected {
  direction: 'LR' | 'TB';
  lanes: { id: string; label: string }[];
  /** Declared nodes in canonical order (unlaned, then by lane), each in order of first declaration. */
  nodes: SpecNode[];
  edges: { source: string; target: string; label: string | null; style: EdgeStyle }[];
  passThrough: string[];
  comments: string[];
}

const BRACKETS: Partial<Record<ShapeKind, [string, string]>> = {
  step: ['[', ']'], decision: ['{', '}'], terminal: ['([', '])'], subprocess: ['[[', ']]'], database: ['[(', ')]'],
  io: ['[/', '/]'],
};

function writeDecl(r: Rng, node: SpecNode): string {
  if (node.shape === 'document' || node.shape === 'delay') {
    const shape = `shape:${r.pick([' ', '  ', '\t'])}${node.shape === 'document' ? 'doc' : 'delay'}`;
    const label = `label:${r.pick([' ', '  '])}"${encodeLabel(node.label, { backslash: true })}"`;
    const [first, second] = r.chance(0.5) ? [shape, label] : [label, shape];
    const sp = () => r.pick(['', ' ', '  ']);
    return `${node.id}@{${sp()}${first}${sp()},${sp()}${second}${sp()}}`;
  }
  const [open, close] = BRACKETS[node.shape]!;
  const bare = r.chance(0.5) ? unquotedForm(node.label, node.shape === 'io' ? '/' : '') : undefined;
  let body = bare !== undefined ? pad(r, bare) : quoted(r, node.label);
  // `a[/x]` would open an io (or `a[\x]` a trapezoid), so a step label starting with a slash needs a leading space.
  if (node.shape === 'step' && /^[/\\]/.test(body)) body = ` ${body}`;
  return `${node.id}${open}${body}${close}${node.className ? `:::${node.className}` : ''}`;
}

// A18: the bare arrow of each style, and the pieces of its text-label form (`-- label -->`, `-. label .->`, ...).
const BARE: Record<EdgeStyle, string> = { solid: '-->', dashed: '-.->', thick: '==>', bidirectional: '<-->' };
const TEXT_FORM: Record<EdgeStyle, [string, string]> = {
  solid: ['--', '-->'], dashed: ['-.', '.->'], thick: ['==', '==>'], bidirectional: ['<--', '-->'],
};

function writeArrow(r: Rng, label: string | null, style: EdgeStyle = 'solid'): string {
  const ws = () => r.pick(['', ' ', '  ']);
  const bareArrow = BARE[style];
  const [open, close] = TEXT_FORM[style];
  if (label === null) return r.pick([`${ws()}${bareArrow}${ws()}`, ` ${bareArrow}|| `, ` ${open} ${close} `, `${ws()}${bareArrow}${ws()}`]);
  const bare = unquotedForm(label);
  const forms: string[] = [`${ws()}${bareArrow}${ws()}|${quoted(r, label)}|${ws()}`];
  if (bare !== undefined) forms.push(`${ws()}${bareArrow}${ws()}|${pad(r, bare)}|${ws()}`);
  // The text form runs to the first closing run (`--`, `.->`, `==`), so the written label can't contain one.
  const text = bare !== undefined && r.chance(0.5) ? bare : quoted(r, label);
  const stop = style === 'dashed' ? '.->' : style === 'thick' ? '==' : '--';
  if (!text.includes(stop) && !text.endsWith('-') && !text.endsWith('=')) forms.push(` ${open} ${text} ${close} `);
  return r.pick(forms);
}

const PASS_THROUGH = ['classDef hot fill:#f96', 'class n1,n2 hot', 'style n1 fill:#fff,stroke:#333', 'linkStyle 0 stroke:#f00', 'click n1 "https://example.com"'];

function generate(seed: number, nodeCount?: number): { text: string; expected: Expected } {
  const r = rng(seed);
  const lines: string[] = [];
  const comments: string[] = [];
  let commentNo = 0;
  const indent = () => r.pick(['', '  ', '    ', '\t']);
  /** Maybe a comment block (with blank lines inside it) before the next line. */
  const maybeComments = (p = 0.2) => {
    while (r.chance(p)) {
      const text = r.chance(0.1) ? `%%{init: {"n": ${commentNo++}}}%%` : `%% note ${commentNo++}${r.chance(0.2) ? ' (with; stuff) "x"' : ''}`;
      comments.push(text);
      lines.push(indent() + text);
      if (r.chance(0.2)) lines.push('');
    }
  };
  const blank = () => {
    if (r.chance(0.2)) lines.push(r.pick(['', '   ']));
  };
  const stmt = (text: string) => {
    maybeComments();
    lines.push(indent() + text + (r.chance(0.15) ? ';' : ''));
    blank();
  };

  // Lanes and nodes.
  const laneCount = r.int(5);
  const lanes = Array.from({ length: laneCount }, (_, i) => {
    const id = r.pick([`lane${i}`, `L-${i}`, `lane_${i}`]);
    const hasLabel = r.chance(0.8);
    return { id, label: hasLabel ? randomLabel(r) : id, hasLabel };
  });
  const count = nodeCount ?? 1 + r.int(25);
  const nodes: SpecNode[] = Array.from({ length: count }, (_, i) => {
    const shape = r.pick(SHAPE_KINDS);
    const bracket = shape !== 'document' && shape !== 'delay';
    return {
      id: r.pick([`n${i}`, `n-${i}`, `_n${i}`, `N${i}_x`, `endn${i}`]),
      shape,
      label: randomLabel(r),
      className: bracket && r.chance(0.2) ? r.pick(['hot', 'c-1', 'x_y']) : null,
      lane: laneCount > 0 && r.chance(0.8) ? lanes[r.int(laneCount)]!.id : null,
    };
  });
  const ghosts = Array.from({ length: r.int(4) }, (_, i) => `ghost${i}`);
  const allIds = [...nodes.map((n) => n.id), ...ghosts];

  const edges: Expected['edges'] = [];
  const passThrough: string[] = [];
  const declaredOrder = new Map<string | null, SpecNode[]>();

  /** An edge statement: a chain of `&` groups. `declare` (if given) is written with its shape at a random spot. */
  const edgeStatement = (declare?: SpecNode, repeat?: SpecNode) => {
    const groups = Array.from({ length: 2 + (r.chance(0.3) ? 1 : 0) }, () =>
      Array.from({ length: r.chance(0.25) ? 2 : 1 }, () => r.pick(allIds)),
    );
    const labels = groups.slice(1).map(() => (r.chance(0.4) ? randomLabel(r) || null : null));
    const styles = groups.slice(1).map(() => (r.chance(0.4) ? r.pick(['dashed', 'thick', 'bidirectional'] as const) : 'solid'));
    const shaped = new Map<string, SpecNode>();
    // The repeat goes first so that, if both land on one slot, the new declaration wins.
    for (const node of [repeat, declare]) {
      if (!node) continue;
      const g = groups[r.int(groups.length)]!;
      g[r.int(g.length)] = node.id;
      shaped.set(node.id, node);
    }
    const written = new Set<string>();
    const ref = (id: string) => {
      const node = shaped.get(id);
      if (!node || written.has(id)) return id;
      written.add(id);
      return writeDecl(r, node);
    };
    let text = groups[0]!.map(ref).join(r.pick([' & ', '&', ' &  ']));
    labels.forEach((label, k) => {
      text += writeArrow(r, label, styles[k]) + groups[k + 1]!.map(ref).join(' & ');
      for (const source of groups[k]!) for (const target of groups[k + 1]!) edges.push({ source, target, label, style: styles[k]! });
    });
    stmt(text.trim());
  };

  const noise = () => {
    if (r.chance(0.1)) stmt(r.pick(['direction LR', 'direction TB', 'direction TD', 'direction RL']));
    if (r.chance(0.08)) {
      const line = r.pick(PASS_THROUGH);
      passThrough.push(line);
      stmt(line);
    }
    if (r.chance(0.3)) edgeStatement();
  };

  /** Declare every node of one context (a lane, or null for unlaned), standalone or inline in edges. */
  const declareAll = (lane: string | null) => {
    const own = nodes.filter((n) => n.lane === lane);
    const done: SpecNode[] = [];
    declaredOrder.set(lane, done);
    for (const node of own) {
      const repeat = done.length > 0 && r.chance(0.15) ? r.pick(done) : undefined;
      if (r.chance(0.3)) edgeStatement(node, repeat);
      else {
        stmt(writeDecl(r, node));
        if (repeat) stmt(writeDecl(r, repeat)); // an identical repeat: no effect (§3.2)
      }
      done.push(node);
      noise();
    }
  };

  // File comment, header.
  maybeComments(0.4);
  const direction = r.pick(['LR', 'TB', 'TD'] as const);
  lines.push(`${r.pick(['flowchart', 'graph'])} ${direction}${r.chance(0.1) ? ';' : ''}`);
  if (r.chance(0.5)) maybeComments(0.6);
  blank();

  // Body: the unlaned context and the lanes, in random order, with loose statements in between.
  const topSlot = r.int(lanes.length + 1);
  const order = lanes.map((l) => l.id as string | null);
  order.splice(topSlot, 0, null);
  for (const ctx of order) {
    noise();
    if (ctx === null) {
      declareAll(null);
      continue;
    }
    const lane = lanes.find((l) => l.id === ctx)!;
    let header = `subgraph ${lane.id}`;
    if (lane.hasLabel) {
      const bare = r.chance(0.5) ? unquotedForm(lane.label) : undefined;
      header += `${r.pick(['', ' '])}[${bare !== undefined ? pad(r, bare) : quoted(r, lane.label)}]`;
    }
    stmt(header);
    declareAll(lane.id);
    maybeComments(0.3);
    stmt('end');
  }
  noise();
  maybeComments(0.4);
  if (r.chance(0.5)) lines.push('');

  const byLane = (lane: string | null) => declaredOrder.get(lane) ?? [];
  return {
    text: lines.join('\n') + (r.chance(0.8) ? '\n' : ''),
    expected: {
      direction: direction === 'LR' ? 'LR' : 'TB',
      lanes: lanes.map(({ id, label }) => ({ id, label })),
      nodes: [...byLane(null), ...lanes.flatMap((l) => byLane(l.id))],
      edges,
      passThrough,
      comments,
    },
  };
}

// ---- Checks ---------------------------------------------------------------------------------------------------------

function allComments(d: Diagram): string[] {
  return [
    ...d.fileComment, ...d.trailingComments,
    ...d.unlaned.flatMap((n) => n.comments),
    ...d.lanes.flatMap((l) => [...l.comments, ...l.endComments, ...l.nodes.flatMap((n) => n.comments)]),
    ...d.edges.flatMap((e) => e.comments),
    ...d.passThrough.flatMap((p) => p.comments),
  ];
}

/** The model without source line numbers, for comparing a parse of the input with a parse of its canonical form. */
function withoutLines(d: Diagram): unknown {
  return JSON.parse(JSON.stringify(d, (key, value) => (key === 'line' ? undefined : value)));
}

function checkMeaning(d: Diagram, expected: Expected): void {
  expect(d.direction).toBe(expected.direction);
  expect(d.lanes.map(({ id, label }) => ({ id, label }))).toEqual(expected.lanes);
  expect(declaredNodes(d).map(({ node, lane }) => ({
    id: node.id, shape: node.shape, label: node.label, className: node.className, lane,
  }))).toEqual(expected.nodes);
  expect(d.edges.map(({ source, target, label, style }) => ({ source, target, label, style: style ?? 'solid' }))).toEqual(expected.edges);
  expect(d.passThrough.map((p) => p.text)).toEqual(expected.passThrough);
  expect(allComments(d).sort()).toEqual([...expected.comments].sort());
}

/** 400 seeds by default; set MMD_PROPERTY_SEEDS for a longer sweep. */
const SEEDS = Array.from({ length: Number(process.env.MMD_PROPERTY_SEEDS ?? 400) }, (_, i) => i + 1);

describe('random diagrams (C2)', () => {
  it.each(SEEDS)('seed %i: parses to the written meaning, and fmt is idempotent and meaning-preserving', (seed) => {
    const { text, expected } = generate(seed);
    const first = parse(text);
    if (first.problems.errors.length > 0) {
      throw new Error(`errors ${JSON.stringify(first.problems.errors)} in:\n${text}`);
    }
    checkMeaning(first.diagram, expected);

    const canonical = format(first.diagram);
    const second = parse(canonical);
    expect(second.problems.errors).toEqual([]);
    expect(withoutLines(second.diagram)).toEqual(withoutLines(first.diagram));
    expect(format(second.diagram)).toBe(canonical);
    // Warnings (W-no-lane) survive formatting, minus the dropped direction lines.
    const codes = (p: typeof first.problems) => p.warnings.map((w) => w.code).filter((c) => c !== 'W-direction').sort();
    expect(codes(second.problems)).toEqual(codes(first.problems));
    expect(toGraph(second.diagram)).toEqual(toGraph(first.diagram));
  });

  it('covers every shape, lanes, unlaned and undeclared nodes, comments, chains and groups across the seeds', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const { text, expected } = generate(seed);
      for (const n of expected.nodes) seen.add(`shape:${n.shape}`);
      if (expected.nodes.some((n) => n.lane === null)) seen.add('unlaned');
      if (expected.lanes.length > 0) seen.add('lanes');
      if (/ & |&/.test(text)) seen.add('group');
      if (/-->.*-->/.test(text)) seen.add('chain');
      if (text.includes(' -- ')) seen.add('text-label');
      if (text.includes('-->|')) seen.add('pipe-label');
      for (const style of ['dashed', 'thick', 'bidirectional'] as const) {
        if (expected.edges.some((e) => e.style === style)) seen.add(`style:${style}`);
      }
      if (/-\. .* \.->/.test(text)) seen.add('text-label:dashed');
      if (/== .* ==>/.test(text)) seen.add('text-label:thick');
      if (/<-- .* -->/.test(text)) seen.add('text-label:bidirectional');
      if (text.includes('#quot;')) seen.add('escape');
      if (text.includes('ghost')) seen.add('undeclared');
      if (expected.comments.length > 0) seen.add('comments');
      if (expected.passThrough.length > 0) seen.add('pass-through');
    }
    expect([...seen].sort()).toEqual([
      ...SHAPE_KINDS.map((s) => `shape:${s}`), 'chain', 'comments', 'escape', 'group', 'lanes', 'pass-through', 'pipe-label',
      'style:bidirectional', 'style:dashed', 'style:thick', 'text-label', 'text-label:bidirectional',
      'text-label:dashed', 'text-label:thick', 'undeclared', 'unlaned',
    ].sort());
  });
});

describe('performance (C7)', () => {
  it('parses and formats a 150-node diagram well under 2 s', () => {
    const { text } = generate(4242, 150);
    const start = performance.now();
    const { diagram, problems } = parse(text);
    const out = format(diagram);
    format(parse(out).diagram);
    const ms = performance.now() - start;
    expect(problems.errors).toEqual([]);
    expect(declaredNodes(diagram)).toHaveLength(150);
    expect(ms).toBeLessThan(200);
  });
});

// The edit operations (a later wave) build models directly, so canonical text must also carry any valid model
// through unchanged: parse(format(m)) is m. Labels here use the full character range, not only what's easy to type.
describe('random models round-trip through canonical text', () => {
  const CHARS = ['a', 'Z', '0', ' ', '  ', '"', '#', '#quot;', '#35;', '#92;', '\\', '[', ']', '(', ')', '{', '}', '|', '/', ';', '&', ':', '%%', '-', '--', '-->', 'é', '\t', '@{'];
  const label = (r: Rng) => Array.from({ length: r.int(6) }, () => r.pick(CHARS)).join('');

  function randomModel(seed: number): Diagram {
    const r = rng(seed);
    let c = 0;
    const comments = (p: number) => {
      const out: string[] = [];
      while (r.chance(p)) out.push(r.chance(0.2) ? `%%{init: ${c++}}%%` : `%% c${c++}${r.chance(0.3) ? ' "x" (y);' : ''}`);
      return out;
    };
    let n = 0;
    const node = () => {
      const shape = r.pick(SHAPE_KINDS);
      const bracket = shape !== 'document' && shape !== 'delay';
      return { id: `n${n++}`, shape, label: label(r), className: bracket && r.chance(0.3) ? 'hot' : null, comments: comments(0.2) };
    };
    const d: Diagram = {
      direction: r.pick(['LR', 'TB'] as const),
      fileComment: comments(0.4),
      unlaned: Array.from({ length: r.int(4) }, node),
      lanes: Array.from({ length: r.int(4) }, (_, i) => ({
        id: `lane${i}`, label: label(r), comments: comments(0.3), nodes: Array.from({ length: r.int(4) }, node),
        endComments: comments(0.3),
      })),
      edges: [],
      passThrough: Array.from({ length: r.int(3) }, () => ({ text: r.pick(PASS_THROUGH), comments: comments(0.3) })),
      trailingComments: comments(0.4),
    };
    const ids = [...declaredNodes(d).map((e) => e.node.id), 'ghost'];
    d.edges = Array.from({ length: r.int(8) }, () => {
      const text = label(r);
      const style = r.pick(['solid', 'solid', 'dashed', 'thick', 'bidirectional'] as const);
      return {
        source: r.pick(ids), target: r.pick(ids), label: text === '' ? null : text,
        ...(style === 'solid' ? {} : { style }), comments: comments(0.2),
      };
    });
    return d;
  }

  it.each(Array.from({ length: 300 }, (_, i) => i + 1))('seed %i', (seed) => {
    const model = randomModel(seed);
    const text = format(model);
    const back = parse(text);
    expect(back.problems.errors).toEqual([]);
    expect(withoutLines(back.diagram)).toEqual(model);
    expect(format(back.diagram)).toBe(text);
  });
});
