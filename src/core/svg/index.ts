// The SVG export (design.md §7.1). Pure: takes a Graph, a LayoutResult, resolved per-node styles and
// a legend, and returns an SVG document as a string. No fs — the CLI and the UI both write the bytes
// this returns. Layout and drawing details beyond §7.1's structural contract are this module's choice.
import { isLaneFree, type Graph, type LayoutResult, type LegendItem, type ResolvedStyle } from '../types';
import { shapeGeometry, type DecorationShape, type OutlineShape } from '../shapes';
import { getTheme, resolveStyle, type ResolvedNodeStyle, type Theme, type ThemeName } from '../theme';
import { BADGE_FONT, LABEL_FONT, badgeBox, textArea, textWidth, wrapLabel } from '../measure';

export interface RenderSvgOptions {
  title: string;
  /** Topology and labels (this module treats `layout` as authoritative for geometry and text content;
   *  `graph` is accepted for interface completeness and any future cross-referencing need). */
  graph: Graph;
  layout: LayoutResult;
  styles: Record<string, ResolvedStyle>;
  legend: LegendItem[];
  theme: ThemeName;
}

const MARGIN = 24;
const TITLE_FONT_SIZE = 20;
const TITLE_BLOCK_HEIGHT = TITLE_FONT_SIZE + 24;
const LEGEND_GAP = 28;
const LEGEND_ROW_HEIGHT = 20;
const LEGEND_SWATCH_W = 26;
const LEGEND_SWATCH_H = 16;
const LEGEND_ITEM_GAP_X = 24;
const LEGEND_ITEM_GAP_Y = 12;
const EDGE_LABEL_PAD_X = 6;
const MIN_CONTENT_WIDTH = 320;

function num(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Escapes text for use as either XML element content or a double-quoted attribute value (§7.1). */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function presentationAttrs(style: ResolvedNodeStyle): string {
  const dash = style.dasharray ? ` stroke-dasharray="${style.dasharray}"` : '';
  return `fill="${style.fill}" stroke="${style.stroke}" stroke-width="${num(style.strokeWidth)}"${dash}`;
}

function renderOutline(shape: OutlineShape, style: ResolvedNodeStyle): string {
  const presentation = presentationAttrs(style);
  switch (shape.tag) {
    case 'rect':
      return `<rect x="${num(shape.x)}" y="${num(shape.y)}" width="${num(shape.width)}" height="${num(shape.height)}" rx="${num(shape.rx)}" ry="${num(shape.ry)}" ${presentation}/>`;
    case 'polygon':
      return `<polygon points="${shape.points}" ${presentation}/>`;
    case 'path':
      return `<path d="${shape.d}" ${presentation}/>`;
  }
}

function renderDecoration(shape: DecorationShape, style: ResolvedNodeStyle): string {
  const strokeWidth = num(Math.max(style.strokeWidth - 0.5, 1));
  const presentation = `fill="none" stroke="${style.stroke}" stroke-width="${strokeWidth}"`;
  switch (shape.tag) {
    case 'path':
      return `<path d="${shape.d}" ${presentation}/>`;
    case 'ellipse':
      return `<ellipse cx="${num(shape.cx)}" cy="${num(shape.cy)}" rx="${num(shape.rx)}" ry="${num(shape.ry)}" ${presentation}/>`;
    case 'rect':
      return `<rect x="${num(shape.x)}" y="${num(shape.y)}" width="${num(shape.width)}" height="${num(shape.height)}" ${presentation}/>`;
  }
}

function fontAttrs(style: ResolvedNodeStyle): string {
  const parts: string[] = [];
  if (style.fontStyle === 'italic') parts.push('font-style="italic"');
  if (style.fontWeight === 'bold') parts.push('font-weight="bold"');
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function renderLabelLines(lines: string[], area: { x: number; y: number; width: number; height: number }, style: ResolvedNodeStyle): string {
  if (!lines.length) return '';
  const totalHeight = lines.length * LABEL_FONT.lineHeight;
  const firstBaseline = area.y + Math.max((area.height - totalHeight) / 2, 0) + LABEL_FONT.lineHeight * 0.72;
  const cx = area.x + area.width / 2;
  const attrs = fontAttrs(style);
  return lines
    .map((line, i) => {
      const y = firstBaseline + i * LABEL_FONT.lineHeight;
      return `<text data-role="label" x="${num(cx)}" y="${num(y)}" text-anchor="middle" font-size="${LABEL_FONT.size}" fill="${style.textColor}"${attrs}>${escapeXml(line)}</text>`;
    })
    .join('');
}

/** The badge as a tag on the node's top edge, clear of the label's text area (`badgeBox`, shared with the UI). */
function renderBadge(badge: string, node: LayoutResult['nodes'][number], theme: Theme): string {
  const b = badgeBox(node.kind, node.width, node.height, badge);
  const x = node.x + b.x;
  const y = node.y + b.y;
  return [
    `<rect x="${num(x)}" y="${num(y)}" width="${num(b.width)}" height="${num(b.height)}" rx="${num(b.height / 2)}" ry="${num(b.height / 2)}" fill="${theme.badgeFill}" stroke="${theme.canvasBackground}" stroke-width="1.5"/>`,
    `<text data-role="badge" x="${num(x + b.width / 2)}" y="${num(y + b.height / 2 + BADGE_FONT.size * 0.35)}" text-anchor="middle" font-size="${BADGE_FONT.size}" font-weight="${BADGE_FONT.weight}" fill="${theme.badgeText}">${escapeXml(badge)}</text>`,
  ].join('');
}

function renderLane(lane: LayoutResult['lanes'][number], index: number, theme: Theme, laneFree: boolean): string {
  if (laneFree) {
    // Amendment A4: a diagram without subgraphs is a plain flowchart: no band, no header. The lane's group and its
    // label stay in the file (hidden) so the §7.1 structure still lists every lane of `flowmap layout`.
    return `<g data-lane-id="${escapeXml(lane.id)}"><text visibility="hidden" x="${num(lane.x)}" y="${num(lane.y)}" font-size="12">${escapeXml(lane.label)}</text></g>`;
  }
  const fill = theme.laneFill[index % 2];
  return [
    `<g data-lane-id="${escapeXml(lane.id)}">`,
    `<rect x="${num(lane.x)}" y="${num(lane.y)}" width="${num(lane.width)}" height="${num(lane.height)}" fill="${fill}" stroke="${theme.laneBorder}" stroke-width="1"/>`,
    `<text x="${num(lane.x + 12)}" y="${num(lane.y + 20)}" font-size="12" font-weight="600" fill="${theme.laneLabel}">${escapeXml(lane.label)}</text>`,
    '</g>',
  ].join('');
}

function renderNode(node: LayoutResult['nodes'][number], style: ResolvedStyle | undefined, theme: Theme): string {
  const resolved = resolveStyle(style, theme);
  const geometry = shapeGeometry(node.kind, { x: node.x, y: node.y, width: node.width, height: node.height });
  const localArea = textArea(node.kind, node.width, node.height);
  const area = { x: node.x + localArea.x, y: node.y + localArea.y, width: localArea.width, height: localArea.height };
  const lines = wrapLabel(node.label, area.width);

  const parts: string[] = [`<g data-node-id="${escapeXml(node.id)}" data-kind="${node.kind}">`];
  parts.push(`<title>${escapeXml(node.label)}</title>`);
  parts.push(renderOutline(geometry.outline, resolved));
  for (const decoration of geometry.decorations) parts.push(renderDecoration(decoration, resolved));
  parts.push(renderLabelLines(lines, area, resolved));
  if (resolved.badge) parts.push(renderBadge(resolved.badge, node, theme));
  parts.push('</g>');
  return parts.join('');
}

function renderEdge(edge: LayoutResult['edges'][number], theme: Theme): string {
  const pointsAttr = edge.points.map(([x, y]) => `${num(x)},${num(y)}`).join(' ');
  const parts: string[] = [`<g data-edge-id="${escapeXml(edge.id)}">`];
  parts.push(`<polyline points="${pointsAttr}" fill="none" stroke="${theme.edgeColor}" stroke-width="1.5" marker-end="url(#arrowhead)"/>`);
  if (edge.label) {
    parts.push(`<title>${escapeXml(edge.label)}</title>`);
    if (edge.label_pos) {
      const [lx, ly] = edge.label_pos;
      const w = textWidth(edge.label) + EDGE_LABEL_PAD_X * 2;
      const h = LABEL_FONT.lineHeight;
      parts.push(`<rect x="${num(lx - w / 2)}" y="${num(ly - h / 2)}" width="${num(w)}" height="${num(h)}" fill="${theme.edgeLabelBackground}"/>`);
      parts.push(`<text x="${num(lx)}" y="${num(ly + h * 0.28)}" text-anchor="middle" font-size="${LABEL_FONT.size}" fill="${theme.edgeLabelText}">${escapeXml(edge.label)}</text>`);
    }
  }
  parts.push('</g>');
  return parts.join('');
}

interface LegendPosition {
  item: LegendItem;
  x: number;
  y: number;
}

function layoutLegend(legend: LegendItem[], maxWidth: number): { items: LegendPosition[]; totalHeight: number } {
  const items: LegendPosition[] = [];
  let x = 0;
  let y = 0;
  for (const item of legend) {
    const itemWidth = LEGEND_SWATCH_W + 8 + textWidth(item.text);
    if (x > 0 && x + itemWidth > maxWidth) {
      x = 0;
      y += LEGEND_ROW_HEIGHT + LEGEND_ITEM_GAP_Y;
    }
    items.push({ item, x, y });
    x += itemWidth + LEGEND_ITEM_GAP_X;
  }
  const totalHeight = legend.length ? y + LEGEND_ROW_HEIGHT : 0;
  return { items, totalHeight };
}

function renderLegend(legend: LegendItem[], theme: Theme, x: number, y: number, maxWidth: number): string {
  if (!legend.length) return '';
  const { items } = layoutLegend(legend, maxWidth);
  const parts: string[] = [`<g data-testid="legend" transform="translate(${num(x)}, ${num(y)})">`];
  for (const { item, x: ix, y: iy } of items) {
    const resolved = resolveStyle(item.style, theme);
    parts.push('<g data-testid="legend-item">');
    parts.push(`<rect x="${num(ix)}" y="${num(iy)}" width="${LEGEND_SWATCH_W}" height="${LEGEND_SWATCH_H}" rx="3" ry="3" ${presentationAttrs(resolved)}/>`);
    parts.push(
      `<text x="${num(ix + LEGEND_SWATCH_W + 8)}" y="${num(iy + LEGEND_SWATCH_H * 0.72)}" font-size="12" fill="${theme.legendText}">${escapeXml(item.text)}</text>`,
    );
    parts.push('</g>');
  }
  parts.push('</g>');
  return parts.join('');
}

function renderDefs(theme: Theme): string {
  return `<defs><marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="${theme.edgeColor}"/></marker></defs>`;
}

/** Render the diagram to an SVG document string (design.md §7.1). */
export function renderSvg(options: RenderSvgOptions): string {
  const theme = getTheme(options.theme);
  const { title, layout, styles, legend } = options;

  const contentWidth = Math.max(layout.width, MIN_CONTENT_WIDTH);
  const diagramTop = MARGIN + TITLE_BLOCK_HEIGHT;
  const legendLayout = layoutLegend(legend, contentWidth);
  const legendTop = diagramTop + layout.height + LEGEND_GAP;
  const totalHeight = legend.length ? legendTop + legendLayout.totalHeight + MARGIN : diagramTop + layout.height + MARGIN;
  const totalWidth = contentWidth + MARGIN * 2;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(totalWidth)}" height="${num(totalHeight)}" viewBox="0 0 ${num(totalWidth)} ${num(totalHeight)}" font-family="Inter, -apple-system, 'Segoe UI', sans-serif" data-theme="${theme.name}">`,
  );
  parts.push(renderDefs(theme));
  parts.push(`<rect x="0" y="0" width="${num(totalWidth)}" height="${num(totalHeight)}" fill="${theme.canvasBackground}"/>`);
  parts.push(`<text data-role="title" x="${num(MARGIN + contentWidth / 2)}" y="${num(MARGIN + TITLE_FONT_SIZE)}" text-anchor="middle" font-size="${TITLE_FONT_SIZE}" font-weight="700" fill="${theme.titleColor}">${escapeXml(title)}</text>`);

  parts.push(`<g transform="translate(${num(MARGIN)}, ${num(diagramTop)})">`);
  const laneFree = isLaneFree(layout.lanes);
  layout.lanes.forEach((lane, index) => parts.push(renderLane(lane, index, theme, laneFree)));
  for (const node of layout.nodes) parts.push(renderNode(node, styles[node.id], theme));
  for (const edge of layout.edges) parts.push(renderEdge(edge, theme));
  parts.push('</g>');

  parts.push(renderLegend(legend, theme, MARGIN, legendTop, contentWidth));
  parts.push('</svg>');

  return parts.join('');
}
