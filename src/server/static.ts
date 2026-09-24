// Serves the built UI (`dist/ui`, produced by `vite build`), with an index fallback for the client-side router, or
// a minimal notice page when the UI hasn't been built yet (design.md §7, §9).
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const FALLBACK_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>flowmap</title></head>
<body><p>flowmap: the UI hasn't been built yet. Run <code>pnpm build:ui</code>, then restart <code>flowmap serve</code>.</p></body>
</html>
`;

/**
 * Looks for a `dist/ui` directory by walking up from `startDir`. Robust to where this module ends up running from
 * (`src/server` in development and tests, wherever the CLI build places it in production) without hard-coding a
 * relative depth.
 */
export function findUiDir(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'dist', 'ui');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function defaultUiDir(): string | null {
  return findUiDir(dirname(fileURLToPath(import.meta.url)));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Serves `uiDir` with index fallback, or the notice page when `uiDir` is null. */
export async function serveStatic(uiDir: string | null, urlPath: string, res: ServerResponse): Promise<void> {
  if (!uiDir) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(FALLBACK_HTML);
    return;
  }

  const safePath = urlPath
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.' && seg !== '..')
    .join('/');
  const candidate = safePath === '' ? null : join(uiDir, safePath);
  const target = candidate && (await fileExists(candidate)) ? candidate : join(uiDir, 'index.html');

  if (!(await fileExists(target))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }

  const contentType = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
  const data = await readFile(target);
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(data);
}
