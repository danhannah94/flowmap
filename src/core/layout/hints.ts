// Layout-stability hints (§5 `hints`, §6 Stability). Opaque outside this module; always validated on the way in, so
// a hand-edited or stale hints object can only make the layout less stable, never invalid.
import type { Direction } from '../types';

export interface Hints {
  /** Format version. */
  v: 1;
  /** Direction the sizes below were measured in (`cols` and `rows` are ignored after a direction flip). */
  dir: Direction;
  /** Per node id: [lane id, rank (column), row within the lane, or -1 for none]. */
  n: Record<string, [string, number, number]>;
  /** Width of each column along the flow, by rank. Columns never shrink below these while the hints are kept. */
  cols: number[];
  /** Along gap after each column, by rank. Sticky like `cols`, so pinning or relabelling doesn't pull columns in. */
  gaps: number[];
  /** Per lane id: thickness of each row across the flow. */
  rows: Record<string, number[]>;
}

const MAX_RANK = 100000;
const MAX_SIZE = 100000;

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

/** Reads hints, dropping anything malformed. Returns null when there is nothing usable. */
export function readHints(raw: unknown): Hints | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  const dir: Direction = r.dir === 'TB' ? 'TB' : 'LR';
  const n: Hints['n'] = {};
  if (r.n && typeof r.n === 'object' && !Array.isArray(r.n)) {
    for (const [id, e] of Object.entries(r.n as Record<string, unknown>)) {
      if (!Array.isArray(e) || e.length !== 3) continue;
      const [lane, rank, row] = e as unknown[];
      if (typeof lane !== 'string' || !isInt(rank, 0, MAX_RANK) || !isInt(row, -1, MAX_RANK)) continue;
      n[id] = [lane, rank, row];
    }
  }
  const cols: number[] = [];
  if (Array.isArray(r.cols) && r.cols.length <= MAX_RANK) {
    for (const c of r.cols) cols.push(isInt(c, 0, MAX_SIZE) ? c : 0);
  }
  const gaps: number[] = [];
  if (Array.isArray(r.gaps) && r.gaps.length <= MAX_RANK) {
    for (const c of r.gaps) gaps.push(isInt(c, 0, MAX_SIZE) ? c : 0);
  }
  const rows: Hints['rows'] = {};
  if (r.rows && typeof r.rows === 'object' && !Array.isArray(r.rows)) {
    for (const [lane, rs] of Object.entries(r.rows as Record<string, unknown>)) {
      if (!Array.isArray(rs) || rs.length > MAX_RANK) continue;
      rows[lane] = rs.map((x) => (isInt(x, 0, MAX_SIZE) ? x : 0));
    }
  }
  return { v: 1, dir, n, cols, gaps, rows };
}
