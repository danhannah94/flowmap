// Shared helpers for src/server/*.test.ts. Not a test file itself (no `*.test.ts` suffix), so vitest won't run it
// as a suite.
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'purchase-request');
export const FIXTURE_NAMES = ['purchase-request.mmd', 'purchase-request.flow.yaml', 'purchase-request.layout.json'];

/** A fresh temp directory with the purchase-request fixture's three files copied in. */
export async function makeTempDiagramDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'flowmap-server-test-'));
  for (const name of FIXTURE_NAMES) {
    await cp(join(FIXTURE_DIR, name), join(dir, name));
  }
  return dir;
}

export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitFor(check: () => boolean, timeoutMs = 2000, intervalMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (check()) return;
    if (Date.now() >= deadline) throw new Error('waitFor: condition never became true');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export interface SseCapture {
  events: { event: string; data: string }[];
  comments: string[];
  stop(): void;
  /** Resolves once the underlying stream has ended (naturally, on abort, or because the server closed it). */
  finished: Promise<void>;
}

/** Reads an SSE stream in the background, splitting it into named `event:`/`data:` blocks and `:`-comment blocks
 *  (used for the heartbeat). */
export function captureSse(url: string): SseCapture {
  const controller = new AbortController();
  const events: { event: string; data: string }[] = [];
  const comments: string[] = [];

  const finished = (async () => {
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch {
      return;
    }
    const body = response.body;
    if (!body) return;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (block.startsWith(':')) {
            comments.push(block);
            continue;
          }
          const eventMatch = /^event: (.*)$/m.exec(block);
          const dataMatch = /^data: (.*)$/m.exec(block);
          if (eventMatch || dataMatch) {
            events.push({ event: eventMatch?.[1] ?? 'message', data: dataMatch?.[1] ?? '' });
          }
        }
      }
    } catch {
      // aborted, or the connection was closed by the server — either way, we're done reading.
    }
  })();

  return { events, comments, stop: () => controller.abort(), finished };
}
