// A17 (design.md §12, amending A15/A16): rewriting `link:` values across the served directory after a diagram
// moves or a folder renames. Unlike `files.ts` ("no parsing of their contents happens here"), this one file does
// read a `.flow.yaml`'s structure — narrowly, through `ConfigDoc` (src/core/config/doc.ts), the same
// comment/formatting-preserving surgical writer the UI's own config edits go through (UI26) — because finding and
// rewriting a `link:` value can't be done as opaque text. Everything else about a diagram's files stays opaque to
// the rest of the server, as before; the move/rename mechanics themselves are still `files.ts`'s `moveDiagram`/
// `renameFolder`, called first, by the route handlers in `index.ts`.
import { join } from 'node:path';

import { ConfigDoc } from '../core/config/doc.js';
import { diagramFileNames, listMmdFiles, readOptional, writeAtomic } from './files.js';

export interface LinkRewrite {
  /** The diagram whose config was rewritten, as a root-relative `.mmd` path. */
  file: string;
  /** How many `link:` values changed in it. */
  count: number;
}

export interface LinkRewriteResult {
  /** One diagram per `.flow.yaml` actually rewritten, and how many links changed in it. */
  rewritten: LinkRewrite[];
  /** Diagrams whose config exists but failed to parse: left untouched rather than risking a corrupt rewrite,
   *  reported so the caller can surface them instead of silently leaving a stale link behind. */
  skipped: string[];
}

/**
 * Rewrites every `link:` value under `dir` for which `remap` returns a replacement (null: unaffected), across
 * every diagram `listMmdFiles` finds (so it respects the same reserved-folder, depth and sort rules as everywhere
 * else, §8.2 A16). Only a `.flow.yaml` whose links actually change is rewritten — `ConfigDoc.rewriteLinks` only
 * touches the bytes it needs to (UI26), and this skips the atomic write entirely when nothing matched. Called after
 * a successful `moveDiagram` or `renameFolder` (see `index.ts`), scanning the tree in its *new* state, so the moved
 * diagram's own new location is swept too (a self-link matching the old id is corrected the same way an incoming
 * one from another diagram is, §12 A17).
 */
export async function rewriteLinksAcrossDir(dir: string, remap: (target: string) => string | null): Promise<LinkRewriteResult> {
  const rewritten: LinkRewrite[] = [];
  const skipped: string[] = [];
  const mmdFiles = await listMmdFiles(dir);
  for (const mmdFile of mmdFiles) {
    const { config: configName } = diagramFileNames(mmdFile);
    const configPath = join(dir, configName);
    const text = await readOptional(configPath);
    if (text === null) continue; // no config: nothing to rewrite
    const doc = new ConfigDoc(text);
    if (!doc.config) {
      skipped.push(mmdFile);
      continue;
    }
    const result = doc.rewriteLinks(remap);
    if (result.count > 0 && result.text !== null && result.text !== text) {
      await writeAtomic(configPath, result.text);
      rewritten.push({ file: mmdFile, count: result.count });
    }
  }
  return { rewritten, skipped };
}
