// End-to-end tests for the real CLI (design.md §7): builds `dist/cli.js` once, then drives it as a subprocess the
// way the grader does (`node dist/cli.js <command> …`), against the fixtures.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const CLI = join(ROOT, 'dist', 'cli.js');
const FIXTURES = join(ROOT, 'fixtures');

beforeAll(() => {
  const build = spawnSync('pnpm', ['run', 'build:cli'], { cwd: ROOT, encoding: 'utf8' });
  if (build.status !== 0) {
    throw new Error(`pnpm run build:cli failed (status ${build.status}):\n${build.stdout}\n${build.stderr}`);
  }
}, 60_000);

interface RunResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

function run(args: string[], cwd: string = ROOT): RunResult {
  const result = spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

function tmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `flowmap-${prefix}-`));
}

// ---- validate: one fixture per error code (design.md §3, fixtures/errors/README.md) --------------------------------

const ERROR_CASES: { file: string; code: string; line: number | null }[] = [
  { file: 'E-header.mmd', code: 'E-header', line: 1 },
  { file: 'E-nested.mmd', code: 'E-nested', line: 3 },
  { file: 'E-unclosed.mmd', code: 'E-unclosed', line: 2 },
  { file: 'E-shape.mmd', code: 'E-shape', line: 3 },
  { file: 'E-edge.mmd', code: 'E-edge', line: 4 },
  { file: 'E-duplicate.mmd', code: 'E-duplicate', line: 3 },
  { file: 'E-syntax.mmd', code: 'E-syntax', line: 3 },
  { file: 'E-config.mmd', code: 'E-config', line: null },
];

describe('validate: one error fixture per code (§3, §7)', () => {
  it.each(ERROR_CASES)('$file gives $code at line $line, exit 1', ({ file, code, line }) => {
    const { stdout, status } = run(['validate', join(FIXTURES, 'errors', file), '--json']);
    expect(status).toBe(1);
    const json = JSON.parse(stdout) as { errors: { code: string; line: number | null }[] };
    expect(json.errors).toContainEqual(expect.objectContaining({ code, line }));
  });
});

describe('validate: purchase-request is clean', () => {
  it('exits 0 with no errors or warnings', () => {
    const { stdout, status } = run(['validate', join(FIXTURES, 'purchase-request', 'purchase-request.mmd'), '--json']);
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ errors: [], warnings: [] });
  });
});

describe('validate: usage', () => {
  it('exits 2 on an unknown command', () => {
    const { status, stderr } = run(['frobnicate']);
    expect(status).toBe(2);
    expect(stderr).toMatch(/unknown command/);
  });

  it('exits 2 on an unknown flag', () => {
    const { status, stderr } = run(['validate', join(FIXTURES, 'purchase-request', 'purchase-request.mmd'), '--bogus']);
    expect(status).toBe(2);
    expect(stderr).toMatch(/unknown flag/);
  });

  it('exits 2 with no command at all', () => {
    const { status } = run([]);
    expect(status).toBe(2);
  });
});

// ---- fmt: canonical form (§3.3, C1) ---------------------------------------------------------------------------------

describe('fmt --stdout: matches the canonical fixture exactly', () => {
  it.each(['edge-cases', 'shapes'])('%s.mmd', (name) => {
    const { stdout, status } = run(['fmt', join(FIXTURES, 'syntax', `${name}.mmd`), '--stdout']);
    expect(status).toBe(0);
    expect(stdout).toBe(readFileSync(join(FIXTURES, 'syntax', `${name}.canonical.mmd`), 'utf8'));
  });
});

describe('fmt --check', () => {
  it.each(['edge-cases', 'shapes'])('%s.canonical.mmd is already canonical (exit 0)', (name) => {
    const { status } = run(['fmt', join(FIXTURES, 'syntax', `${name}.canonical.mmd`), '--check']);
    expect(status).toBe(0);
  });

  it.each(['edge-cases', 'shapes'])('%s.mmd is not canonical (exit 1)', (name) => {
    const { status } = run(['fmt', join(FIXTURES, 'syntax', `${name}.mmd`), '--check']);
    expect(status).toBe(1);
  });

  it('writes nothing to the file', () => {
    const dir = tmpDir('fmt-check');
    const target = join(dir, 'edge-cases.mmd');
    cpSync(join(FIXTURES, 'syntax', 'edge-cases.mmd'), target);
    const before = readFileSync(target, 'utf8');
    run(['fmt', target, '--check']);
    expect(readFileSync(target, 'utf8')).toBe(before);
  });
});

describe('fmt: rewrites the file in canonical form, atomically, in place', () => {
  it.each(['edge-cases', 'shapes'])('%s.mmd', (name) => {
    const dir = tmpDir('fmt-inplace');
    const target = join(dir, `${name}.mmd`);
    cpSync(join(FIXTURES, 'syntax', `${name}.mmd`), target);
    const { status } = run(['fmt', target]);
    expect(status).toBe(0);
    expect(readFileSync(target, 'utf8')).toBe(readFileSync(join(FIXTURES, 'syntax', `${name}.canonical.mmd`), 'utf8'));
  });

  it('is idempotent: formatting a canonical copy changes nothing', () => {
    const dir = tmpDir('fmt-idempotent');
    const target = join(dir, 'edge-cases.mmd');
    cpSync(join(FIXTURES, 'syntax', 'edge-cases.canonical.mmd'), target);
    run(['fmt', target]);
    expect(readFileSync(target, 'utf8')).toBe(readFileSync(join(FIXTURES, 'syntax', 'edge-cases.canonical.mmd'), 'utf8'));
  });
});

describe('fmt: .mmd errors print to stderr and exit 1, writing nothing', () => {
  it('E-syntax.mmd', () => {
    const dir = tmpDir('fmt-error');
    const target = join(dir, 'E-syntax.mmd');
    cpSync(join(FIXTURES, 'errors', 'E-syntax.mmd'), target);
    const before = readFileSync(target, 'utf8');
    const { status, stderr, stdout } = run(['fmt', target]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/E-syntax/);
    expect(stdout).toBe('');
    expect(readFileSync(target, 'utf8')).toBe(before);
  });
});

describe('fmt --check: a non-canonical file prints a helpful line on stderr (§7)', () => {
  it('reports "not canonical: <file>" and exits 1, writing nothing', () => {
    const dir = tmpDir('fmt-not-canonical');
    const target = join(dir, 'edge-cases.mmd');
    cpSync(join(FIXTURES, 'syntax', 'edge-cases.mmd'), target);
    const before = readFileSync(target, 'utf8');
    const { status, stderr } = run(['fmt', target, '--check']);
    expect(status).toBe(1);
    expect(stderr).toBe(`not canonical: ${target}\n`);
    expect(readFileSync(target, 'utf8')).toBe(before);
  });
});

// ---- C3.103: E-config (and E-layout) don't stop fmt, layout or export (§7) ------------------------------------------

describe('a broken config beside a canonical .mmd does not stop fmt, layout or export (§7)', () => {
  function setupBrokenConfig(): { dir: string; mmd: string } {
    const dir = tmpDir('broken-config');
    const mmd = join(dir, 'cfg.mmd');
    cpSync(join(FIXTURES, 'syntax', 'edge-cases.canonical.mmd'), mmd);
    // An invalid `.flow.yaml` beside an otherwise-canonical `.mmd` (design.md §4: invalid YAML is `E-config`).
    writeFileSync(join(dir, 'cfg.flow.yaml'), 'version: 1\nstyles: [this is: not: valid\n');
    return { dir, mmd };
  }

  it('fmt --check reads only the .mmd: exits 0 with nothing on stderr', () => {
    const { mmd } = setupBrokenConfig();
    const { status, stderr } = run(['fmt', mmd, '--check']);
    expect(status).toBe(0);
    expect(stderr).toBe('');
  });

  it('fmt (rewrite) reads only the .mmd: exits 0, leaves the canonical file unchanged', () => {
    const { mmd } = setupBrokenConfig();
    const before = readFileSync(mmd, 'utf8');
    const { status, stderr } = run(['fmt', mmd]);
    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(readFileSync(mmd, 'utf8')).toBe(before);
  });

  it('layout exits 0 and reports the config problem on stderr', () => {
    const { mmd } = setupBrokenConfig();
    const { status, stdout, stderr } = run(['layout', mmd]);
    expect(status).toBe(0);
    expect(JSON.parse(stdout).direction).toBeDefined();
    expect(stderr).toMatch(/E-config/);
  });

  it('export exits 0 and reports the config problem on stderr', () => {
    const { dir, mmd } = setupBrokenConfig();
    const out = join(dir, 'cfg.svg');
    const { status, stdout, stderr } = run(['export', mmd, '--format', 'svg', '--out', out]);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe(out);
    expect(stderr).toMatch(/E-config/);
  });
});

// ---- A15: a block's link to another diagram ------------------------------------------------------------------------

describe('validate: A15 link warnings', () => {
  it('W-link-missing when the target does not exist', () => {
    const dir = tmpDir('link-missing');
    const mmd = join(dir, 'a.mmd');
    writeFileSync(mmd, 'flowchart LR\n  a["A"]\n');
    writeFileSync(join(dir, 'a.flow.yaml'), 'version: 1\nnodes:\n  a:\n    link: nope\n');
    const { stdout, status } = run(['validate', mmd, '--json']);
    expect(status).toBe(0); // a warning, not an error (§4)
    const json = JSON.parse(stdout) as { errors: unknown[]; warnings: { code: string }[] };
    expect(json.errors).toEqual([]);
    expect(json.warnings).toContainEqual(expect.objectContaining({ code: 'W-link-missing' }));
  });

  it('W-link-traversal (not W-link-missing) for a .. segment, error-free', () => {
    const dir = tmpDir('link-traversal');
    const mmd = join(dir, 'a.mmd');
    writeFileSync(mmd, 'flowchart LR\n  a["A"]\n');
    writeFileSync(join(dir, 'a.flow.yaml'), 'version: 1\nnodes:\n  a:\n    link: ../outside\n');
    const { stdout, status } = run(['validate', mmd, '--json']);
    expect(status).toBe(0);
    const json = JSON.parse(stdout) as { errors: unknown[]; warnings: { code: string }[] };
    expect(json.errors).toEqual([]);
    expect(json.warnings).toContainEqual(expect.objectContaining({ code: 'W-link-traversal' }));
    expect(json.warnings.some((w) => w.code === 'W-link-missing')).toBe(false);
  });

  it('no warning when the target exists beside it', () => {
    const dir = tmpDir('link-ok');
    writeFileSync(join(dir, 'a.mmd'), 'flowchart LR\n  a["A"]\n');
    writeFileSync(join(dir, 'a.flow.yaml'), 'version: 1\nnodes:\n  a:\n    link: b\n');
    writeFileSync(join(dir, 'b.mmd'), 'flowchart LR\n  x["X"]\n');
    const { stdout, status } = run(['validate', join(dir, 'a.mmd'), '--json']);
    expect(status).toBe(0);
    expect((JSON.parse(stdout) as { warnings: unknown[] }).warnings).toEqual([]);
  });

  it('finds a target nested in a subfolder of the served root (the .mmd\'s own directory)', () => {
    const dir = tmpDir('link-subfolder');
    writeFileSync(join(dir, 'a.mmd'), 'flowchart LR\n  a["A"]\n');
    writeFileSync(join(dir, 'a.flow.yaml'), 'version: 1\nnodes:\n  a:\n    link: sub/b\n');
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'b.mmd'), 'flowchart LR\n  x["X"]\n');
    const { stdout, status } = run(['validate', join(dir, 'a.mmd'), '--json']);
    expect(status).toBe(0);
    expect((JSON.parse(stdout) as { warnings: unknown[] }).warnings).toEqual([]);
  });

  it('linking to itself is fine (no warning)', () => {
    const dir = tmpDir('link-self');
    writeFileSync(join(dir, 'a.mmd'), 'flowchart LR\n  a["A"]\n');
    writeFileSync(join(dir, 'a.flow.yaml'), 'version: 1\nnodes:\n  a:\n    link: a\n');
    const { stdout, status } = run(['validate', join(dir, 'a.mmd'), '--json']);
    expect(status).toBe(0);
    expect((JSON.parse(stdout) as { warnings: unknown[] }).warnings).toEqual([]);
  });
});

describe('export --format svg: A15 links', () => {
  it('wraps a linked block in <a href="<target>.svg">', () => {
    const dir = tmpDir('export-link');
    writeFileSync(join(dir, 'a.mmd'), 'flowchart LR\n  a["A"]\n');
    writeFileSync(join(dir, 'a.flow.yaml'), 'version: 1\nnodes:\n  a:\n    link: b\n');
    const out = join(dir, 'a.svg');
    const { status } = run(['export', join(dir, 'a.mmd'), '--format', 'svg', '--out', out]);
    expect(status).toBe(0);
    const svg = readFileSync(out, 'utf8');
    expect(svg).toMatch(/<a href="b\.svg">\s*<g data-node-id="a"/);
  });
});

// ---- A20: preset packs on the command line (design.md §4.1) ---------------------------------------------------------

describe('A20 preset packs', () => {
  const FIX = join(ROOT, 'examples', 'cloud-architecture', 'order-pipeline.mmd');
  const PACK = 'name: Team\nkinds:\n  job:\n    label: Background job\n    icon: queue\n    style: {fill: "#abcdef"}\n';

  it('validate: the cloud-architecture fixture (built-in pack) is clean', () => {
    const { stdout, status } = run(['validate', FIX, '--json']);
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ errors: [], warnings: [] });
  });

  it('validate: an unknown pack and an unknown kind are warnings, not errors', () => {
    const dir = tmpDir('preset-warn');
    writeFileSync(join(dir, 'a.mmd'), 'flowchart LR\n  a["A"]\n  b["B"]\n');
    writeFileSync(join(dir, 'a.flow.yaml'), 'preset: nope\n');
    writeFileSync(join(dir, 'b.mmd'), 'flowchart LR\n  a["A"]\n');
    writeFileSync(join(dir, 'b.flow.yaml'), 'preset: cloud\nnodes:\n  a: {kind: widget}\n');
    const a = JSON.parse(run(['validate', join(dir, 'a.mmd'), '--json']).stdout) as { warnings: { code: string }[] };
    expect(a.warnings.map((w) => w.code)).toEqual(['W-preset-unknown']);
    const b = run(['validate', join(dir, 'b.mmd'), '--json']);
    expect(b.status).toBe(0);
    expect((JSON.parse(b.stdout) as { warnings: { code: string }[] }).warnings.map((w) => w.code)).toEqual(['W-preset-kind']);
  });

  it('export svg: icons and legend entries from the built-in pack are in the file', () => {
    const dir = tmpDir('preset-svg');
    const out = join(dir, 'o.svg');
    expect(run(['export', FIX, '--format', 'svg', '--out', out]).status).toBe(0);
    const svg = readFileSync(out, 'utf8');
    expect(svg.match(/data-role="icon"/g)!.length).toBe(11 + 11);
    expect(svg).toContain('data-icon="database"');
    expect(svg).toContain('>Object storage</text>');
  });

  it('export svg: a pack file beside the diagram (and above it) is read', () => {
    const dir = tmpDir('preset-file');
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'team.yaml'), PACK);
    writeFileSync(join(dir, 'sub', 'a.mmd'), 'flowchart LR\n  a["A"]\n');
    writeFileSync(join(dir, 'sub', 'a.flow.yaml'), 'preset: ../team.yaml\nnodes:\n  a: {kind: job}\n');
    const out = join(dir, 'o.svg');
    const r = run(['export', join(dir, 'sub', 'a.mmd'), '--format', 'svg', '--out', out]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    const svg = readFileSync(out, 'utf8');
    expect(svg).toContain('data-icon="queue"');
    expect(svg).toContain('fill="#abcdef"');
    expect(svg).toContain('>Background job</text>');
  });

  it('export svg: a missing pack file warns on stderr and the picture is drawn without it', () => {
    const dir = tmpDir('preset-missing');
    writeFileSync(join(dir, 'a.mmd'), 'flowchart LR\n  a["A"]\n');
    writeFileSync(join(dir, 'a.flow.yaml'), 'preset: nope.yaml\nnodes:\n  a: {kind: job}\n');
    const out = join(dir, 'o.svg');
    const r = run(['export', join(dir, 'a.mmd'), '--format', 'svg', '--out', out]);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('W-preset-unknown');
    expect(readFileSync(out, 'utf8')).not.toContain('data-role="icon"');
  });

  it('export png: the icons are in the picture (it differs from the same diagram without the pack)', () => {
    const dir = tmpDir('preset-png');
    cpSync(join(ROOT, 'examples', 'cloud-architecture'), dir, { recursive: true });
    const withPack = join(dir, 'with.png');
    const without = join(dir, 'without.png');
    expect(run(['export', join(dir, 'order-pipeline.mmd'), '--format', 'png', '--out', withPack]).status).toBe(0);
    writeFileSync(join(dir, 'order-pipeline.flow.yaml'), readFileSync(join(dir, 'order-pipeline.flow.yaml'), 'utf8').replace('preset: cloud', ''));
    expect(run(['export', join(dir, 'order-pipeline.mmd'), '--format', 'png', '--out', without]).status).toBe(0);
    expect(readFileSync(withPack).equals(readFileSync(without))).toBe(false);
    expect(readFileSync(withPack).subarray(1, 4).toString()).toBe('PNG');
  }, 60_000);
});

// ---- layout (§6, §7) -------------------------------------------------------------------------------------------------

describe('layout: purchase-request respects its pin', () => {
  it('lays out with the pin on "closed" exact and other invariants sane', () => {
    const { stdout, status } = run(['layout', join(FIXTURES, 'purchase-request', 'purchase-request.mmd')]);
    expect(status).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.direction).toBe('LR');
    const closed = result.nodes.find((n: { id: string }) => n.id === 'closed');
    expect(closed.pinned).toBe(true);
    // The pin (§5): along=1400 is the box's x; across=40 is the offset from its lane's top (requester is lane 0, y=0).
    expect(closed.x).toBe(1400);
    expect(closed.y).toBe(40);
    // All numbers are integers (§7).
    for (const n of result.nodes) {
      for (const key of ['x', 'y', 'width', 'height']) expect(Number.isInteger(n[key])).toBe(true);
    }
  });

  it('exits 1 with no output on a .mmd error', () => {
    const { status, stdout, stderr } = run(['layout', join(FIXTURES, 'errors', 'E-header.mmd')]);
    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toBe('');
  });
});

// ---- export --format svg (§7.1) ----------------------------------------------------------------------------------

describe('export --format svg: structure (§7.1)', () => {
  it('purchase-request: title, lanes, nodes, edges, legend', () => {
    const dir = tmpDir('export-svg');
    const out = join(dir, 'pr.svg');
    const { status, stdout } = run([
      'export', join(FIXTURES, 'purchase-request', 'purchase-request.mmd'), '--format', 'svg', '--out', out,
    ]);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe(out);
    const svg = readFileSync(out, 'utf8');
    // Attribute values escape `>` as `&gt;` (valid, if not required, XML); decode for substring matching below.
    const decoded = svg.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

    expect(svg).toMatch(/<text data-role="title"[^>]*>Purchase request approval \(current state, synthetic\)<\/text>/);
    expect(svg).toMatch(/<g data-lane-id="requester">/);
    expect(svg).toMatch(/<g data-lane-id="vendor">/);
    expect(svg).toMatch(/<g data-node-id="intake" data-kind="terminal">/);
    expect(svg).toMatch(/<g data-node-id="m02" data-kind="decision">/);
    // Full label in a <title> child (unwrapped).
    expect(svg).toMatch(/<g data-node-id="m02"[^>]*>\s*<title>Approved\?<\/title>/);
    expect(decoded).toMatch(/<g data-edge-id="intake->r01">/);
    // A labelled edge carries its label in a <title>.
    expect(decoded).toMatch(/<g data-edge-id="p02->p03">[\s\S]*?<title>no<\/title>/);
    // The legend: one item per rule with legend text, and every legend text from the config appears.
    expect(svg).toMatch(/<g data-testid="legend"[^>]*>/);
    expect(svg).toContain('Confirmed by two or more people');
    expect(svg).toContain('Waiting on someone');
    const legendItems = svg.match(/data-testid="legend-item"/g) ?? [];
    expect(legendItems.length).toBe(7); // every rule in purchase-request.flow.yaml has a legend
  });

  it('shapes.mmd: renders every one of the eight shape kinds', () => {
    const dir = tmpDir('export-svg-shapes');
    const out = join(dir, 'shapes.svg');
    const { status } = run(['export', join(FIXTURES, 'syntax', 'shapes.mmd'), '--format', 'svg', '--out', out]);
    expect(status).toBe(0);
    const svg = readFileSync(out, 'utf8');
    const kinds: Record<string, string> = {
      a: 'step', b: 'decision', c: 'terminal', d: 'subprocess', e: 'database', f: 'io', g: 'document', h: 'delay',
    };
    for (const [id, kind] of Object.entries(kinds)) {
      expect(svg).toMatch(new RegExp(`<g data-node-id="${id}" data-kind="${kind}">`));
    }
    // Node shapes: a rect/polygon/path first child carrying fill/stroke presentation attributes.
    expect(svg).toMatch(/<g data-node-id="a" data-kind="step">\s*<title>[^<]*<\/title>\s*<rect[^>]*fill="[^"]+"[^>]*stroke="[^"]+"/);
  });

  it('exits 1 with no output on a .mmd error', () => {
    const dir = tmpDir('export-svg-error');
    const out = join(dir, 'x.svg');
    const { status, stdout, stderr } = run(['export', join(FIXTURES, 'errors', 'E-header.mmd'), '--format', 'svg', '--out', out]);
    expect(status).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toBe('');
  });
});

// ---- export --format png -------------------------------------------------------------------------------------------

describe('export --format png', () => {
  it('writes a valid PNG at 2x scale', () => {
    const dir = tmpDir('export-png');
    const out = join(dir, 'pr.png');
    const { status, stdout } = run([
      'export', join(FIXTURES, 'purchase-request', 'purchase-request.mmd'), '--format', 'png', '--out', out,
    ]);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe(out);
    const png = readFileSync(out);
    // PNG signature.
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    // IHDR: width and height (big-endian uint32) right after the signature and the chunk length/type.
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);

    const svgOut = join(dir, 'pr.svg');
    run(['export', join(FIXTURES, 'purchase-request', 'purchase-request.mmd'), '--format', 'svg', '--out', svgOut]);
    const svg = readFileSync(svgOut, 'utf8');
    const svgWidth = Number(/\swidth="([\d.]+)"/.exec(svg)![1]);
    const svgHeight = Number(/\sheight="([\d.]+)"/.exec(svg)![1]);
    expect(width).toBe(svgWidth * 2);
    expect(height).toBe(svgHeight * 2);
  }, 30_000);
});

describe('export --format png without the headless browser', () => {
  it('fails with a clear message naming the install command, and SVG export still works', () => {
    const dir = tmpDir('export-png-missing');
    // Point Playwright at an empty browser cache, so the headless shell is "not installed" on any machine.
    const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(dir, 'no-browsers') };
    const mmd = join(FIXTURES, 'purchase-request', 'purchase-request.mmd');
    const png = spawnSync('node', [CLI, 'export', mmd, '--format', 'png', '--out', join(dir, 'pr.png')], {
      cwd: ROOT, encoding: 'utf8', env,
    });
    expect(png.status).toBe(1);
    expect(png.stderr).toMatch(/^flowmap: PNG export needs Playwright's headless Chromium, which isn't installed\./);
    expect(png.stderr).toMatch(/npx playwright@\d+\.\d+\.\d+ install chromium-headless-shell/);
    expect(png.stderr).not.toContain('    at '); // a one-line message, not a stack trace
    expect(png.stdout).toBe('');

    const svg = spawnSync('node', [CLI, 'export', mmd, '--format', 'svg', '--out', join(dir, 'pr.svg')], {
      cwd: ROOT, encoding: 'utf8', env,
    });
    expect(svg.status).toBe(0);
  }, 30_000);
});

// ---- serve (§7): starts the server on loopback, serves the API and the UI, stops on SIGTERM ---------------------------

describe('serve', () => {
  it('serves the diagrams in a directory until stopped', async () => {
    const dir = tmpDir('serve');
    cpSync(join(FIXTURES, 'purchase-request'), dir, { recursive: true });
    const port = 20000 + Math.floor(Math.random() * 20000);
    const child = spawn('node', [CLI, 'serve', dir, '--port', String(port)], { cwd: ROOT });
    try {
      let out = '';
      await new Promise<void>((resolveUp, reject) => {
        const timer = setTimeout(() => reject(new Error(`serve did not start: ${out}`)), 10_000);
        child.stdout.on('data', (d: Buffer) => {
          out += d.toString();
          if (out.includes('serving')) {
            clearTimeout(timer);
            resolveUp();
          }
        });
        child.on('exit', (code) => reject(new Error(`serve exited early (${code}): ${out}`)));
      });
      const list = (await (await fetch(`http://127.0.0.1:${port}/api/diagrams`)).json()) as { files: string[] };
      expect(list.files).toContain('purchase-request.mmd');
      const page = await fetch(`http://127.0.0.1:${port}/`);
      expect(page.status).toBe(200);
      // The built UI (dist/ui), not the server's "not built yet" page.
      const html = await page.text();
      expect(html).toContain('<div id="root"></div>');
      expect(html).toMatch(/src="\/assets\/index-[^"]+\.js"/);
    } finally {
      const exited = new Promise((r) => child.on('exit', r));
      child.kill('SIGTERM');
      await exited;
    }
  }, 30_000);
});

// ---- R1: `pnpm exec flowmap` works from the repo root ----------------------------------------------------------------

describe('R1: pnpm exec flowmap', () => {
  it('runs the built CLI via the linked package bin', () => {
    const result = spawnSync('pnpm', ['exec', 'flowmap', 'validate', join(FIXTURES, 'purchase-request', 'purchase-request.mmd')], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no problems found');
  }, 30_000);
});

// ---- A18: dashed, thick and bidirectional edges round-trip through every command ------------------------------------

describe('A18 edge styles: validate, fmt, layout and export', () => {
  const dir = join(ROOT, 'tests', 'golden', 'edge-styles');
  const mixed = join(dir, 'mixed.mmd');
  const canonical = readFileSync(join(dir, 'mixed.canonical.mmd'), 'utf8');

  it('validate: clean, exit 0', () => {
    for (const name of ['dashed', 'thick', 'bidirectional', 'mixed']) {
      const { stdout, status } = run(['validate', join(dir, `${name}.mmd`), '--json']);
      expect(status).toBe(0);
      expect(JSON.parse(stdout)).toEqual({ errors: [], warnings: [] });
    }
  });

  it('fmt --stdout writes the canonical arrows (text-label forms become pipe labels)', () => {
    const { stdout, status } = run(['fmt', mixed, '--stdout']);
    expect(status).toBe(0);
    expect(stdout).toBe(canonical);
    expect(stdout).toContain('api ==>|critical path| model');
    expect(stdout).toContain('model <--> cache');
    expect(stdout).toContain('api -.->|audit records| audit');
  });

  it('fmt --check: the canonical file passes, the hand-written one does not; fmt is idempotent', () => {
    expect(run(['fmt', join(dir, 'mixed.canonical.mmd'), '--check']).status).toBe(0);
    expect(run(['fmt', mixed, '--check']).status).toBe(1);
    const tmp = tmpDir('a18-fmt');
    const target = join(tmp, 'm.mmd');
    writeFileSync(target, readFileSync(mixed, 'utf8'));
    run(['fmt', target]);
    expect(readFileSync(target, 'utf8')).toBe(canonical);
    run(['fmt', target]);
    expect(readFileSync(target, 'utf8')).toBe(canonical);
  });

  it('layout --json carries style on the non-solid edges only', () => {
    const { stdout, status } = run(['layout', mixed, '--json']);
    expect(status).toBe(0);
    const edges = (JSON.parse(stdout) as { edges: { id: string; style?: string }[] }).edges;
    expect(Object.fromEntries(edges.map((e) => [e.id, e.style ?? null]))).toEqual({
      'client->api': null,
      'api->model': 'thick',
      'model->cache': 'bidirectional',
      'api->audit': 'dashed',
      'model->audit': 'dashed',
      'cache->audit': 'bidirectional',
    });
  });

  it('export --format svg writes exactly the golden SVG', () => {
    const tmp = tmpDir('a18-export');
    for (const name of ['dashed', 'thick', 'bidirectional', 'mixed']) {
      const out = join(tmp, `${name}.svg`);
      const { status } = run(['export', join(dir, `${name}.mmd`), '--format', 'svg', '--out', out]);
      expect(status).toBe(0);
      expect(`${readFileSync(out, 'utf8')}\n`).toBe(readFileSync(join(dir, `${name}.svg`), 'utf8'));
    }
  });

  it('other arrows are still E-edge (<-.->, <==>, -.-, ===)', () => {
    const tmp = tmpDir('a18-edge');
    for (const arrow of ['<-.->', '<==>', '-.-', '===']) {
      const target = join(tmp, 'e.mmd');
      writeFileSync(target, `flowchart LR\n  a["A"]\n  b["B"]\n  a ${arrow} b\n`);
      const { stdout, status } = run(['validate', target, '--json']);
      expect(status).toBe(1);
      expect(JSON.parse(stdout).errors).toContainEqual(expect.objectContaining({ code: 'E-edge', line: 4 }));
    }
  });
});
