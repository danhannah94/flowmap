// Test helpers for the v1.1 operations (design.md §10 Part 3, P21–P30). The hand edits in these tests are written the
// way a person editing the files would work them out: read positions off `flowmap layout` output (the layout JSON),
// then store them in the layout file's frame (§5). `handPoint` is that calculation, written independently of the
// operations' own code.
import { loadDocument } from '../document';
import type { LayoutOutput } from '../layout';
import type { Pin } from '../types';
import type { Files } from './context';

/**
 * Two lanes, four pinned blocks (a step pair on top, a step and a diamond below) and five lines:
 * - `a->b`: straight, port to port;
 * - `a->c`: one vertical segment, port to port;
 * - `c->d`: three segments, both ends at ports (the diamond's left vertex);
 * - `a->d`: labelled "yes"; its source end is off `a`'s right port (ports spread), so becoming manual stores it.
 */
export const SHAPE_MMD = `flowchart LR

  subgraph top [Top]
    a["Alpha"]
    b["Beta"]
  end

  subgraph bottom [Bottom]
    c["Gamma"]
    d{"Delta?"}
  end

  a --> b
  a --> c
  b --> d
  c --> d
  a -->|yes| d
`;

export const SHAPE_CONFIG = `# Shaping fixture (comments and spacing must survive)
version: 1
title:   Shaping   # the title
nodes:
  b:
    owner: sam     # evidence
`;

export const SHAPE_LAYOUT = `{
  "version": 1,
  "nodes": {
    "a": { "lane": "top", "along": 40, "across": 30 },
    "b": { "lane": "top", "along": 400, "across": 30 },
    "c": { "lane": "bottom", "along": 40, "across": 40 },
    "d": { "lane": "bottom", "along": 400, "across": 30 }
  },
  "hints": { "kept": true }
}
`;

export const SHAPE: Files = { mmd: SHAPE_MMD, config: SHAPE_CONFIG, layout: SHAPE_LAYOUT };

/** The layout function's output for the files (`flowmap layout`, with its frame). */
export function layoutOf(files: Files): LayoutOutput {
  const out = loadDocument(files.mmd, files.config, files.layout, 'shape.mmd').layout;
  if (!out) throw new Error('the .mmd has errors');
  return out;
}

/** The drawn line of an edge (the layout JSON's `points`). */
export function drawn(files: Files, edgeId: string): [number, number][] {
  const e = layoutOf(files).result.edges.find((x) => x.id === edgeId);
  if (!e) throw new Error(`no edge ${edgeId}`);
  return e.points;
}

/**
 * By hand: the stored form of a point drawn at (x, y) (§5): the lane whose band holds it across the flow (start edge
 * included, end excluded; before the first lane the first, after the last the last), `along` less T, `across` from the
 * lane's zero line (its start edge, plus U in the first lane).
 */
export function handPoint(out: LayoutOutput, x: number, y: number): Pin {
  const { result, translation: t } = out;
  const LR = result.direction === 'LR';
  const c = LR ? y : x;
  const bands = result.lanes.map((l) => ({ id: l.id, start: LR ? l.y : l.x, end: LR ? l.y + l.height : l.x + l.width }));
  let k = bands.findIndex((b) => c < b.end);
  if (k < 0) k = bands.length - 1;
  if (c < bands[0]!.start) k = 0;
  const zero = bands[k]!.start + (k === 0 ? t.across : 0);
  return { lane: bands[k]!.id, along: (LR ? x : y) - t.along, across: c - zero };
}

/** Parse a layout file, for reading entries in assertions. */
export function layoutJs(files: Files): any {
  return files.layout === null ? null : JSON.parse(files.layout);
}
