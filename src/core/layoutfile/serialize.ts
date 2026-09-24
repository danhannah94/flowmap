// The layout file's text (§5): stable, so the UI's writes give small diffs and a canonical file round-trips unchanged.
import type { LayoutEdgeEntry, LayoutFile, LayoutNodeEntry, Pin, XY } from '../types';
import { pinOf, sizeOf } from '../types';

const q = JSON.stringify;
const num = (n: number) => String(n + 0);

function nodeLine(e: LayoutNodeEntry): string {
  const parts: string[] = [];
  const pin = pinOf(e);
  const size = sizeOf(e);
  if (pin) parts.push(`"lane": ${q(pin.lane)}`, `"along": ${num(pin.along)}`, `"across": ${num(pin.across)}`);
  if (size) parts.push(`"width": ${num(size.width)}`, `"height": ${num(size.height)}`);
  return `{ ${parts.join(', ')} }`;
}

const pointText = (p: Pin) => `{ "lane": ${q(p.lane)}, "along": ${num(p.along)}, "across": ${num(p.across)} }`;

function edgeLine(e: LayoutEdgeEntry): string {
  const parts: string[] = [];
  if (e.source_side !== undefined) parts.push(`"source_side": ${q(e.source_side)}`);
  if (e.target_side !== undefined) parts.push(`"target_side": ${q(e.target_side)}`);
  if (e.points !== undefined) parts.push(`"points": [${e.points.map(pointText).join(', ')}]`);
  if (e.label_at !== undefined) parts.push(`"label_at": ${num(e.label_at)}`);
  return `{ ${parts.join(', ')} }`;
}

const xyText = (p: XY) => `{ "x": ${num(p.x)}, "y": ${num(p.y)} }`;

function section<T>(entries: Record<string, T>, line: (v: T) => string): string {
  const list = Object.entries(entries);
  if (list.length === 0) return '{}';
  return `{\n${list.map(([id, v]) => `    ${q(id)}: ${line(v)}`).join(',\n')}\n  }`;
}

/**
 * The file text: 2-space JSON with keys in a fixed order (`version`, `nodes`, `edges`, `notes`, `title`, `hints`),
 * one line per entry in file order, each entry's keys in a fixed order (`lane`, `along`, `across`, `width`, `height`;
 * `source_side`, `target_side`, `points`, `label_at`; `x`, `y`), ending with a newline. Empty `edges` and `notes` maps
 * are left out. A v1.0 file written by v1.0 comes out byte-identical.
 */
export function serializeLayoutFile(file: LayoutFile): string {
  let out = `{\n  "version": 1,\n  "nodes": ${section(file.nodes, nodeLine)}`;
  if (file.edges && Object.keys(file.edges).length) out += `,\n  "edges": ${section(file.edges, edgeLine)}`;
  if (file.notes && Object.keys(file.notes).length) out += `,\n  "notes": ${section(file.notes, xyText)}`;
  if (file.title) out += `,\n  "title": ${xyText(file.title)}`;
  if (file.hints !== undefined) {
    const h = JSON.stringify(file.hints, null, 2);
    if (h !== undefined) out += `,\n  "hints": ${h.split('\n').join('\n  ')}`;
  }
  return out + '\n}\n';
}
