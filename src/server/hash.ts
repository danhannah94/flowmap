// Content-addressed versions for the three diagram files (design.md §8.2: PUT's `base`/response `versions`).
import { createHash } from 'node:crypto';

/** A file's version id: a sha1 hex digest of its content. Callers use `null` for an absent file. */
export function contentHash(content: string): string {
  return createHash('sha1').update(content, 'utf8').digest('hex');
}
