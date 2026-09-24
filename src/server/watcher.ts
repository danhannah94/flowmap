// Watches the served directory and pushes `changed` events over SSE (design.md UI29, §8.2). Debounces bursts of
// fs events, then re-reads each tracked diagram's three files and compares their hashes to what the server itself
// last wrote or broadcast, so the UI's own writes never echo back as a reload.
import { type FSWatcher, watch } from 'node:fs';
import type { ServerResponse } from 'node:http';

import { type DiagramSnapshot, type DiagramVersions, readDiagram, versionsEqual } from './files.js';

export class DiagramWatcher {
  private readonly dir: string;
  private readonly debounceMs: number;
  /** The last versions the server itself observed for each tracked diagram: from a write, a broadcast, or the
   *  first time it was read/subscribed to (a baseline, not a change). */
  private readonly known = new Map<string, DiagramVersions>();
  private readonly subscribers = new Map<string, Set<ServerResponse>>();
  private fsWatcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  /** Diagrams a PUT is writing right now (how many writes), and a counter bumped whenever one starts. A check that
   *  overlaps a write is deferred until it ends, so a half-done or not-yet-recorded own write never echoes. */
  private readonly writing = new Map<string, number>();
  private readonly writeGen = new Map<string, number>();
  private readonly deferred = new Set<string>();

  constructor(dir: string, debounceMs = 50) {
    this.dir = dir;
    this.debounceMs = debounceMs;
  }

  start(): void {
    this.fsWatcher = watch(this.dir, { persistent: true }, () => this.scheduleCheck());
    this.fsWatcher.on('error', (err) => console.error('flowmap: directory watch error:', err));
  }

  stop(): void {
    this.fsWatcher?.close();
    this.fsWatcher = null;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  private scheduleCheck(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.checkTracked();
    }, this.debounceMs);
  }

  private trackedFiles(): Set<string> {
    return new Set([...this.subscribers.keys(), ...this.known.keys()]);
  }

  private async checkTracked(): Promise<void> {
    for (const mmdFile of this.trackedFiles()) {
      try {
        const gen = this.writeGen.get(mmdFile) ?? 0;
        if (this.writing.has(mmdFile)) {
          this.deferred.add(mmdFile);
          continue;
        }
        const snapshot = await readDiagram(this.dir, mmdFile);
        if (this.writing.has(mmdFile) || (this.writeGen.get(mmdFile) ?? 0) !== gen) {
          this.deferred.add(mmdFile); // a write started while reading: check again once it's recorded
          if (!this.writing.has(mmdFile)) this.scheduleCheck();
          continue;
        }
        const prev = this.known.get(mmdFile);
        if (prev && !versionsEqual(prev, snapshot.versions)) {
          this.known.set(mmdFile, snapshot.versions);
          this.broadcast(mmdFile, snapshot);
        } else if (!prev) {
          this.known.set(mmdFile, snapshot.versions);
        }
      } catch (e) {
        console.error(`flowmap: error checking "${mmdFile}" for changes:`, e);
      }
    }
  }

  /** A PUT starts writing a diagram: checks of it wait until `endWrite`. */
  beginWrite(mmdFile: string): void {
    this.writing.set(mmdFile, (this.writing.get(mmdFile) ?? 0) + 1);
    this.writeGen.set(mmdFile, (this.writeGen.get(mmdFile) ?? 0) + 1);
  }

  /** The PUT is done: record the versions it wrote (none if it wrote nothing), then run any check it held back. */
  endWrite(mmdFile: string, versions?: DiagramVersions): void {
    const n = (this.writing.get(mmdFile) ?? 1) - 1;
    if (n > 0) this.writing.set(mmdFile, n);
    else this.writing.delete(mmdFile);
    if (versions) this.known.set(mmdFile, versions);
    if (n <= 0 && this.deferred.delete(mmdFile)) this.scheduleCheck();
  }

  /** Reads a diagram and, the first time it's seen, records its versions as the baseline (no event fires for it). */
  async ensureTracked(mmdFile: string): Promise<DiagramSnapshot> {
    const snapshot = await readDiagram(this.dir, mmdFile);
    if (!this.known.has(mmdFile)) this.known.set(mmdFile, snapshot.versions);
    return snapshot;
  }

  subscribe(mmdFile: string, res: ServerResponse): void {
    let set = this.subscribers.get(mmdFile);
    if (!set) {
      set = new Set();
      this.subscribers.set(mmdFile, set);
    }
    set.add(res);
  }

  unsubscribe(mmdFile: string, res: ServerResponse): void {
    const set = this.subscribers.get(mmdFile);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) this.subscribers.delete(mmdFile);
  }

  /** Ends every open SSE connection (used on server `close()`). */
  closeAllSubscribers(): void {
    for (const set of this.subscribers.values()) {
      for (const res of set) {
        try {
          res.end();
        } catch {
          // already closed
        }
      }
    }
    this.subscribers.clear();
  }

  private broadcast(mmdFile: string, snapshot: DiagramSnapshot): void {
    const set = this.subscribers.get(mmdFile);
    if (!set || set.size === 0) return;
    const payload = `event: changed\ndata: ${JSON.stringify(snapshot)}\n\n`;
    for (const res of set) {
      try {
        res.write(payload);
      } catch (e) {
        console.error('flowmap: error writing SSE event:', e);
      }
    }
  }
}
