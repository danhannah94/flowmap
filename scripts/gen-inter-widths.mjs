#!/usr/bin/env node
// Regenerates src/core/inter-widths.ts: per-character advance widths of Inter 400 at 13 px, measured with
// canvas.measureText in headless Chromium against the exact woff2 files the UI bundles (@fontsource/inter).
//
//   node scripts/gen-inter-widths.mjs
//
// Also prints a kerning report: how far the per-character sum strays from the real (kerned, shaped) width of whole
// strings, measured both with canvas and with DOM spans. measure.ts's safety margin is chosen from that report.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fontDir = join(root, 'node_modules/@fontsource/inter');
const SIZE = 13;

// Candidate code points: every unicode-range the 400 subsets declare, minus control characters.
const ranges = Object.values(JSON.parse(readFileSync(join(fontDir, 'unicode.json'), 'utf8')));
const candidates = new Set();
for (const spec of ranges) {
  for (const part of spec.split(',')) {
    const [a, b] = part.replace(/U\+/g, '').split('-');
    const lo = parseInt(a, 16);
    const hi = b ? parseInt(b, 16) : lo;
    for (let cp = lo; cp <= hi; cp++) {
      if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || cp === 0xfeff || cp === 0xad) continue;
      candidates.add(cp);
    }
  }
}
const cps = [...candidates].sort((a, b) => a - b);

const dir = mkdtempSync(join(tmpdir(), 'flowmap-font-'));
const html = join(dir, 'measure.html');
writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${pathToFileURL(join(fontDir, '400.css')).href}">
</head><body style="margin:0"><canvas id="c" width="10" height="10"></canvas></body></html>`);

// Strings for the kerning report: realistic process-map labels plus pair-heavy text.
const samples = [
  'Needs a part or service', 'Fill the purchase request form', 'Receive the delivery and sign for it',
  'Request closed', 'Review the request', 'Approved?', 'Tell the requester why not', 'Check the request is complete',
  'Complete?', 'Send it back with what is missing', 'Over $1,000?', 'Get three quotes', 'Pick the vendor',
  'Create the PO in the ERP', 'Budget available?', 'Move budget or defer to next quarter',
  'Match the invoice to the PO and the receipt', 'Vendor paid', 'Send a quote', 'Ship the order',
  'AVAWAYAT To Ty Vy LT PT F. P. Y. W. yes no', 'Wait for the freight quote (2 days)', '"Quoted" #35; - -> <- => ...',
  'WWWWWWWWWW', 'iiiiiiiiii', 'The quick brown fox jumps over the lazy dog', 'Ärger über Öl – naïve café résumé',
  'ffi fl ff 1/2 3x4 10:30 a.m.', 'Привет мир', 'Γειά σου κόσμε', 'Tiếng Việt có dấu',
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(html).href);
  const out = await page.evaluate(async ({ cps, samples, SIZE }) => {
    const all = String.fromCodePoint(...cps);
    // Load every subset the page will need, then make sure they really loaded.
    await document.fonts.load(`400 ${SIZE}px Inter`, all);
    await document.fonts.ready;
    const ctx = document.getElementById('c').getContext('2d');
    const w = (font, s) => { ctx.font = font; return ctx.measureText(s).width; };
    const widths = {};
    let missing = 0;
    for (const cp of cps) {
      const ch = String.fromCodePoint(cp);
      // A glyph Inter lacks falls back to the next family, so the two stacks disagree.
      const a = w(`400 ${SIZE}px Inter, monospace`, ch);
      const b = w(`400 ${SIZE}px Inter, serif`, ch);
      if (Math.abs(a - b) > 0.001) { missing++; continue; }
      widths[cp] = a;
    }
    // Kerning report: canvas and DOM against the per-character sum.
    const span = document.createElement('span');
    span.style.cssText = `font: 400 ${SIZE}px Inter; white-space: pre; position: absolute; left: 0; top: 0`;
    document.body.appendChild(span);
    const report = samples.map((s) => {
      let sum = 0;
      for (const ch of s) sum += widths[ch.codePointAt(0)] ?? NaN;
      span.textContent = s;
      return { s, sum, canvas: w(`400 ${SIZE}px Inter`, s), dom: span.getBoundingClientRect().width };
    });
    const loaded = [...document.fonts].filter((f) => f.status === 'loaded').length;
    return { widths, missing, report, loaded };
  }, { cps, samples, SIZE });

  // Pack into contiguous runs so the table stays small in the UI bundle.
  const keys = Object.keys(out.widths).map(Number).sort((a, b) => a - b);
  const runs = [];
  for (const cp of keys) {
    const v = Math.round(out.widths[cp] * 1000) / 1000;
    const last = runs[runs.length - 1];
    if (last && last[0] + last[1].length === cp) last[1].push(v);
    else runs.push([cp, [v]]);
  }
  const body = runs.map(([s, ws]) => `  [0x${s.toString(16)}, [${ws.join(',')}]],`).join('\n');
  const ts = `// GENERATED by scripts/gen-inter-widths.mjs; do not edit by hand.
// Advance widths (px) of Inter 400 at ${SIZE} px (@fontsource/inter), measured with canvas.measureText in Chromium.
// Each run is [first code point, widths of consecutive code points]. ${keys.length} characters.
export const INTER_13_RUNS: readonly (readonly [number, readonly number[]])[] = [
${body}
];
`;
  writeFileSync(join(root, 'src/core/inter-widths.ts'), ts);
  console.log(`fonts loaded: ${out.loaded}; measured ${keys.length} chars, ${out.missing} not in Inter; ${runs.length} runs`);
  let worst = 0;
  for (const r of out.report) {
    const ratio = Math.max(r.canvas, r.dom) / r.sum;
    worst = Math.max(worst, ratio);
    console.log(`${r.sum.toFixed(2).padStart(8)} sum  ${r.canvas.toFixed(2).padStart(8)} canvas  ${r.dom.toFixed(2).padStart(8)} dom  x${ratio.toFixed(4)}  ${r.s}`);
  }
  console.log(`worst real/sum ratio: ${worst.toFixed(4)}`);
} finally {
  await browser.close();
}
