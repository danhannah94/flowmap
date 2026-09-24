// flowmap's command line (design.md §7). Bundled by esbuild (`pnpm build:cli`) to `dist/cli.js`, a self-contained
// ESM script with a shebang, run as `flowmap` (see package.json's `bin`) or directly with `node dist/cli.js`.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';

import { loadDocument } from '../core/document';
import { format as formatMmd, parse as parseMmd } from '../core/mmd';
import { renderSvg } from '../core/svg';
import type { Problem } from '../core/types';

const USAGE = `flowmap: a local flowchart tool

Usage:
  flowmap validate <file.mmd> [--json]
  flowmap fmt <file.mmd> [--check] [--stdout]
  flowmap layout <file.mmd> [--json]
  flowmap export <file.mmd> --format svg|png [--theme light|dark] [--out <path>]
  flowmap serve <dir> [--port 4870]`;

function usageError(message: string): never {
  process.stderr.write(`flowmap: ${message}\n\n${USAGE}\n`);
  process.exit(2);
}

// ---- Small argv parser: positional arguments plus `--flag` (boolean) and `--flag <value>` (value) flags. -----------

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | true>;
}

function parseArgs(argv: string[], boolFlags: readonly string[], valueFlags: readonly string[]): ParsedArgs {
  const bools = new Set(boolFlags);
  const values = new Set(valueFlags);
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (values.has(name)) {
        const value = argv[++i];
        if (value === undefined) usageError(`--${name} needs a value`);
        flags[name] = value;
      } else if (bools.has(name)) {
        flags[name] = true;
      } else {
        usageError(`unknown flag "--${name}"`);
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function requirePositional(positional: string[], usage: string): string {
  const value = positional[0];
  if (value === undefined) usageError(`${usage} needs a file argument`);
  return value;
}

// ---- Files beside the .mmd (§7: config and layout files are found beside it by base name). ------------------------

interface DiagramPaths {
  mmd: string;
  config: string;
  layoutFile: string;
}

function diagramPaths(mmdArg: string): DiagramPaths {
  const mmd = resolve(mmdArg);
  const withoutExt = mmd.replace(/\.mmd$/i, '');
  return { mmd, config: `${withoutExt}.flow.yaml`, layoutFile: `${withoutExt}.layout.json` };
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

async function readRequired(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (e) {
    process.stderr.write(`flowmap: cannot read "${path}": ${(e as Error).message}\n`);
    process.exitCode = 1;
    throw e;
  }
}

async function loadDoc(paths: DiagramPaths) {
  const mmdText = await readRequired(paths.mmd);
  const configText = await readOptional(paths.config);
  const layoutText = await readOptional(paths.layoutFile);
  return loadDocument(mmdText, configText, layoutText, basename(paths.mmd));
}

function formatProblem(p: Problem): string {
  return p.line !== null ? `${p.code}:${p.line}: ${p.message}` : `${p.code}: ${p.message}`;
}

/** Codes that come from the `.mmd` itself (design.md §3). Everything else is a config or layout problem. */
const MMD_CODES = new Set([
  'E-header', 'E-nested', 'E-unclosed', 'E-shape', 'E-edge', 'E-duplicate', 'E-syntax', 'W-no-lane', 'W-direction',
]);

// ---- Atomic writes (UI30's rule applies to the CLI too: write to a temp file, then rename). ------------------------

async function writeAtomic(path: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  await writeFile(tmp, data);
  await rename(tmp, path);
}

// ---- validate ---------------------------------------------------------------------------------------------------

async function cmdValidate(argv: string[]): Promise<void> {
  const { positional, flags } = parseArgs(argv, ['json'], []);
  const paths = diagramPaths(requirePositional(positional, 'validate'));
  const doc = await loadDoc(paths);

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ errors: doc.problems.errors, warnings: doc.problems.warnings }, null, 2)}\n`);
  } else {
    for (const e of doc.problems.errors) process.stdout.write(`error ${formatProblem(e)}\n`);
    for (const w of doc.problems.warnings) process.stdout.write(`warning ${formatProblem(w)}\n`);
    if (doc.problems.errors.length === 0 && doc.problems.warnings.length === 0) process.stdout.write('no problems found\n');
  }
  process.exitCode = doc.problems.errors.length > 0 ? 1 : 0;
}

// ---- fmt ---------------------------------------------------------------------------------------------------------

async function cmdFmt(argv: string[]): Promise<void> {
  const { positional, flags } = parseArgs(argv, ['check', 'stdout'], []);
  const mmdPath = resolve(requirePositional(positional, 'fmt'));
  const mmdText = await readRequired(mmdPath);
  const { diagram, problems } = parseMmd(mmdText);

  if (problems.errors.length > 0) {
    for (const e of problems.errors) process.stderr.write(`error ${formatProblem(e)}\n`);
    process.exitCode = 1;
    return;
  }

  const canonical = formatMmd(diagram);
  if (flags.stdout) process.stdout.write(canonical);
  if (flags.check) {
    process.exitCode = canonical === mmdText ? 0 : 1;
    return;
  }
  if (!flags.stdout) await writeAtomic(mmdPath, canonical);
  process.exitCode = 0;
}

// ---- layout --------------------------------------------------------------------------------------------------------

async function cmdLayout(argv: string[]): Promise<void> {
  const { positional } = parseArgs(argv, ['json'], []);
  const paths = diagramPaths(requirePositional(positional, 'layout'));
  const doc = await loadDoc(paths);

  if (doc.layout === null) {
    // §7: a `.mmd` error stops `layout`: exit 1, no output.
    process.exitCode = 1;
    return;
  }
  for (const e of doc.problems.errors) if (!MMD_CODES.has(e.code)) process.stderr.write(`error ${formatProblem(e)}\n`);
  for (const w of doc.problems.warnings) if (!MMD_CODES.has(w.code)) process.stderr.write(`warning ${formatProblem(w)}\n`);
  process.stdout.write(`${JSON.stringify(doc.layout.result)}\n`);
  process.exitCode = 0;
}

// ---- export --------------------------------------------------------------------------------------------------------

function svgPixelSize(svg: string): { width: number; height: number } {
  const w = /\swidth="([\d.]+)"/.exec(svg);
  const h = /\sheight="([\d.]+)"/.exec(svg);
  if (!w || !h) throw new Error('rendered SVG has no width/height attribute');
  return { width: Math.ceil(Number(w[1])), height: Math.ceil(Number(h[1])) };
}

/** `@font-face` rules for every weight/style the SVG can use (title 700, lane/badge labels 600, node text 400/italic/bold),
 * embedded as data URLs so the PNG (rendered in a headless browser with no other fonts installed) matches the SVG's
 * declared `font-family: Inter`. */
function interFontFaceCss(): string {
  const require = createRequire(import.meta.url);
  const pkgJson = require.resolve('@fontsource/inter/package.json');
  const filesDir = join(dirname(pkgJson), 'files');
  const variants: { weight: number; style: 'normal' | 'italic'; file: string }[] = [
    { weight: 400, style: 'normal', file: 'inter-latin-400-normal.woff2' },
    { weight: 400, style: 'italic', file: 'inter-latin-400-italic.woff2' },
    { weight: 600, style: 'normal', file: 'inter-latin-600-normal.woff2' },
    { weight: 700, style: 'normal', file: 'inter-latin-700-normal.woff2' },
  ];
  return variants
    .map(({ weight, style, file }) => {
      const base64 = readFileSync(join(filesDir, file)).toString('base64');
      return (
        `@font-face { font-family: 'Inter'; font-weight: ${weight}; font-style: ${style}; ` +
        `src: url(data:font/woff2;base64,${base64}) format('woff2'); font-display: block; }`
      );
    })
    .join('\n');
}

/** Render an SVG string to a PNG buffer at 2x scale using Playwright's chromium (§7: "may use a headless browser"). */
async function renderPng(svg: string): Promise<Buffer> {
  const { chromium } = await import('playwright');
  const { width, height } = svgPixelSize(svg);
  const html =
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<style>${interFontFaceCss()}\nhtml,body{margin:0;padding:0;}</style>` +
    `</head><body>${svg}</body></html>`;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const svgHandle = await page.$('svg');
    const buffer = svgHandle ? await svgHandle.screenshot() : await page.screenshot();
    return buffer;
  } finally {
    await browser.close();
  }
}

async function cmdExport(argv: string[]): Promise<void> {
  const { positional, flags } = parseArgs(argv, [], ['format', 'theme', 'out']);
  const paths = diagramPaths(requirePositional(positional, 'export'));

  const formatArg = flags.format;
  if (formatArg !== 'svg' && formatArg !== 'png') usageError('export needs --format svg or png');
  const format = formatArg as 'svg' | 'png';
  const themeArg = flags.theme ?? 'light';
  if (themeArg !== 'light' && themeArg !== 'dark') usageError('--theme must be light or dark');
  const theme = themeArg as 'light' | 'dark';

  const doc = await loadDoc(paths);
  if (doc.layout === null) {
    // §7: a `.mmd` error stops `export`: exit 1, no output.
    process.exitCode = 1;
    return;
  }
  for (const e of doc.problems.errors) if (!MMD_CODES.has(e.code)) process.stderr.write(`error ${formatProblem(e)}\n`);
  for (const w of doc.problems.warnings) if (!MMD_CODES.has(w.code)) process.stderr.write(`warning ${formatProblem(w)}\n`);

  const svg = renderSvg({
    title: doc.title,
    graph: doc.graph,
    layout: doc.layout.result,
    styles: doc.styles,
    legend: doc.legend,
    theme,
  });

  const name = basename(paths.mmd).replace(/\.mmd$/i, '');
  const outArg = flags.out as string | undefined;
  const outPath = outArg ? resolve(outArg) : join(dirname(paths.mmd), 'exports', `${name}.${format}`);
  const contents = format === 'svg' ? svg : await renderPng(svg);
  await writeAtomic(outPath, contents);
  process.stdout.write(`${outPath}\n`);
  process.exitCode = 0;
}

// ---- serve ---------------------------------------------------------------------------------------------------------

interface ServerModule {
  main?: (dir: string, port: number) => Promise<void>;
}

function isModuleNotFound(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
}

async function cmdServe(argv: string[]): Promise<void> {
  const { positional, flags } = parseArgs(argv, [], ['port']);
  const dir = requirePositional(positional, 'serve');
  const port = flags.port ? Number(flags.port) : 4870;

  // src/server/ doesn't exist yet (another engineer's work). This dispatches to it once it does, without esbuild
  // trying to bundle a module that isn't there yet: the specifier is a variable, not a string literal, so esbuild
  // leaves the `import()` call alone instead of resolving it at build time.
  const specifier = '../server/index.js';
  try {
    const mod = (await import(specifier)) as ServerModule;
    if (typeof mod.main === 'function') {
      await mod.main(dir, port);
      return;
    }
  } catch (e) {
    if (!isModuleNotFound(e)) throw e;
  }
  process.stderr.write('serve: not implemented yet\n');
  process.exitCode = 1;
}

// ---- dispatch ------------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case 'validate':
      return cmdValidate(rest);
    case 'fmt':
      return cmdFmt(rest);
    case 'layout':
      return cmdLayout(rest);
    case 'export':
      return cmdExport(rest);
    case 'serve':
      return cmdServe(rest);
    case undefined:
      usageError('missing command');
      return;
    default:
      usageError(`unknown command "${cmd}"`);
  }
}

main().catch((e) => {
  if (process.exitCode === undefined || process.exitCode === 0) {
    process.stderr.write(`flowmap: ${(e as Error)?.stack ?? e}\n`);
    process.exitCode = 1;
  }
});
