// flowmap's local server (design.md §2, §7, §8.2, §9): serves the built UI, a small JSON API over the three
// diagram files, a live-change push channel (SSE) and an export endpoint. Node built-ins only (`http`, `fs`,
// `crypto`, `path`) — no npm dependencies. Binds to 127.0.0.1 only (loopback).
//
// Entry point: `serve({ dir, port })`, called by the CLI's `serve` command (see `src/cli/main.ts`).
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import { join, resolve } from 'node:path';

import {
  type DiagramVersions,
  type FilesPatch,
  applyPut,
  isValidMmdName,
  listMmdFiles,
} from './files.js';
import { defaultUiDir, serveStatic } from './static.js';
import { DiagramWatcher } from './watcher.js';

export type ExportFormat = 'svg' | 'png';
export type Theme = 'light' | 'dark';

/** Writes the export and returns the path it wrote (design.md UI32). Injected because the real renderer lives in
 *  `src/cli/` (SVG rendering, PNG via a headless browser); without one, `POST /api/export` returns 501. */
export type ExportFn = (mmdPath: string, format: ExportFormat, theme: Theme) => Promise<string>;

export interface ServeOptions {
  /** The directory to serve: every `.mmd` in it, plus its `.flow.yaml`/`.layout.json` siblings. */
  dir: string;
  /** 0 lets the OS pick a free port (tests do this); the CLI passes `--port` (default 4870). */
  port: number;
  exportFn?: ExportFn;
  /** SSE heartbeat interval in ms. Default 15000 (design.md §8.2); tests override it to avoid a real 15s wait. */
  heartbeatMs?: number;
  /** How long to debounce directory-watch events before checking for external changes. Default 50ms. */
  watchDebounceMs?: number;
  /** Where to serve the built UI from. Defaults to searching for `dist/ui` above this module (see `static.ts`). */
  uiDir?: string | null;
}

export interface ServeHandle {
  /** Stops the HTTP server, ends every open SSE connection and stops the directory watcher. */
  close(): Promise<void>;
  /** The port actually bound (equal to `options.port` unless it was 0). */
  port: number;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isVersions(value: unknown): value is DiagramVersions {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  for (const key of ['mmd', 'config', 'layout']) {
    if (v[key] !== undefined && v[key] !== null && typeof v[key] !== 'string') return false;
  }
  return true;
}

function isFilesPatch(value: unknown): value is FilesPatch {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  for (const key of ['mmd', 'config', 'layout'] as const) {
    if (!(key in v)) return false;
    const val = v[key];
    if (val !== null && typeof val !== 'string') return false;
  }
  return true;
}

export async function serve(options: ServeOptions): Promise<ServeHandle> {
  const dir = resolve(options.dir);
  const heartbeatMs = options.heartbeatMs ?? 15000;
  const watchDebounceMs = options.watchDebounceMs ?? 50;
  const uiDir = options.uiDir !== undefined ? options.uiDir : defaultUiDir();
  const exportFn = options.exportFn;

  const watcher = new DiagramWatcher(dir, watchDebounceMs);
  watcher.start();

  const heartbeatTimers = new Set<NodeJS.Timeout>();

  async function handleDiagramGet(res: ServerResponse, file: string): Promise<void> {
    const snapshot = await watcher.ensureTracked(file);
    if (snapshot.files.mmd === null) {
      sendJson(res, 404, { error: `"${file}" does not exist` });
      return;
    }
    sendJson(res, 200, snapshot);
  }

  async function handleDiagramPut(req: IncomingMessage, res: ServerResponse, file: string): Promise<void> {
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { error: 'invalid JSON body' });
      return;
    }
    if (typeof body !== 'object' || body === null) {
      sendJson(res, 400, { error: 'body must be an object with "base" and "files"' });
      return;
    }
    const { base, files: patch } = body as { base?: unknown; files?: unknown };
    if (!isVersions(base) || !isFilesPatch(patch)) {
      sendJson(res, 400, { error: 'body must be { base: {mmd,config,layout}, files: {mmd,config,layout} }' });
      return;
    }
    const fullBase: DiagramVersions = { mmd: base.mmd ?? null, config: base.config ?? null, layout: base.layout ?? null };

    // The watcher holds back its checks of this diagram until the write is recorded, so it never echoes (UI29).
    watcher.beginWrite(file);
    let result: Awaited<ReturnType<typeof applyPut>> | undefined;
    try {
      result = await applyPut(dir, file, fullBase, patch);
    } finally {
      watcher.endWrite(file, result && !result.conflict ? result.snapshot.versions : undefined);
    }
    if (result.conflict) {
      // "Disk wins": the client's edit is rejected with what's actually on disk.
      sendJson(res, 409, result.snapshot);
      return;
    }
    sendJson(res, 200, result.snapshot);
  }

  function handleEvents(req: IncomingMessage, res: ServerResponse, file: string): void {
    void (async () => {
      await watcher.ensureTracked(file);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      watcher.subscribe(file, res);

      const heartbeat = setInterval(() => {
        try {
          res.write(': heartbeat\n\n');
        } catch (e) {
          console.error('flowmap: error writing SSE heartbeat:', e);
        }
      }, heartbeatMs);
      heartbeatTimers.add(heartbeat);

      const cleanup = (): void => {
        clearInterval(heartbeat);
        heartbeatTimers.delete(heartbeat);
        watcher.unsubscribe(file, res);
      };
      req.on('close', cleanup);
      res.on('close', cleanup);
      res.on('error', cleanup);
    })();
  }

  async function handleExport(res: ServerResponse, file: string, url: URL): Promise<void> {
    const format = url.searchParams.get('format');
    if (format !== 'svg' && format !== 'png') {
      sendJson(res, 400, { error: '"format" must be svg or png' });
      return;
    }
    const theme = url.searchParams.get('theme') ?? 'light';
    if (theme !== 'light' && theme !== 'dark') {
      sendJson(res, 400, { error: '"theme" must be light or dark' });
      return;
    }
    if (!exportFn) {
      sendJson(res, 501, { error: 'export is not configured on this server' });
      return;
    }
    const mmdPath = join(dir, file);
    const path = await exportFn(mmdPath, format, theme);
    sendJson(res, 200, { path });
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    if (pathname === '/api/diagrams' && req.method === 'GET') {
      sendJson(res, 200, { files: await listMmdFiles(dir) });
      return;
    }

    if (pathname === '/api/diagram' && (req.method === 'GET' || req.method === 'PUT')) {
      const file = url.searchParams.get('file');
      if (!isValidMmdName(file)) {
        sendJson(res, 400, { error: 'invalid "file" parameter' });
        return;
      }
      if (req.method === 'GET') return handleDiagramGet(res, file);
      return handleDiagramPut(req, res, file);
    }

    if (pathname === '/api/events' && req.method === 'GET') {
      const file = url.searchParams.get('file');
      if (!isValidMmdName(file)) {
        sendJson(res, 400, { error: 'invalid "file" parameter' });
        return;
      }
      handleEvents(req, res, file);
      return;
    }

    if (pathname === '/api/export' && req.method === 'POST') {
      const file = url.searchParams.get('file');
      if (!isValidMmdName(file)) {
        sendJson(res, 400, { error: 'invalid "file" parameter' });
        return;
      }
      return handleExport(res, file, url);
    }

    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      await serveStatic(uiDir, pathname, res);
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err: unknown) => {
      console.error('flowmap: error handling request:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('internal error');
      } else {
        res.end();
      }
    });
  });
  // Never let one bad connection take the process down.
  server.on('clientError', (err, socket) => {
    console.error('flowmap: client error:', err);
    if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => resolvePromise());
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;
  console.log(`flowmap serving ${dir} at http://127.0.0.1:${port}`);

  let closed = false;
  return {
    port,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      for (const t of heartbeatTimers) clearInterval(t);
      heartbeatTimers.clear();
      watcher.closeAllSubscribers();
      watcher.stop();
      await new Promise<void>((resolvePromise, reject) => {
        server.close((err) => (err ? reject(err) : resolvePromise()));
      });
    },
  };
}
