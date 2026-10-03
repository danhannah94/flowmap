// The SVG export (design.md §7.1). Pure: takes a Graph, a LayoutResult, resolved per-node styles and
// a legend, and returns an SVG document as a string. No fs — the CLI and the UI both write the bytes
// this returns. Layout and drawing details beyond §7.1's structural contract are this module's choice.
import { isLaneFree, type Graph, type LayoutResult, type LayoutTextBox, type LegendItem, type NoteInput, type ResolvedIcon, type ResolvedStyle } from '../types';
import { shapeGeometry, type DecorationShape, type OutlineShape } from '../shapes';
import { getTheme, resolveStyle, type ResolvedNodeStyle, type Theme, type ThemeName } from '../theme';
import { GLYPH_GRID, GLYPH_STROKE } from '../preset/glyphs';
import { BADGE_FONT, ICON_CHIP, ICON_GLYPH, LABEL_FONT, TITLE_FONT, badgeBox, iconBox, noteLineHeight, noteLines, textArea, textWidth, titleSize, wrapLabel } from '../measure';

export interface RenderSvgOptions {
  /** The title's text. Where it goes (and whether it shows) is `layout.title`; a layout without a `title` key (a
   * v1.0-style caller) gets it in the default place, above the diagram's top-left corner. */
  title: string;
  /** v1.1: the notes' font size, weight and colour, by id or as the list the layout was given (config order). The
   * layout's `notes` say where they go; a note missing here is drawn at 14 px, regular, in the theme's text colour. */
  notes?: NoteInput[];
  /** Topology and labels (this module treats `layout` as authoritative for geometry and text content;
   *  `graph` is accepted for interface completeness and any future cross-referencing need). */
  graph: Graph;
  layout: LayoutResult;
  styles: Record<string, ResolvedStyle>;
  legend: LegendItem[];
  theme: ThemeName;
  /** A15: well-formed, non-traversing link targets by node id (`linkTargetsByNode`, core/config), for the export
   *  only (§7.1 "so exported sets stay clickable"). A linked node's `<g>` is wrapped in `<a href="<target>.svg">`.
   *  Omitted (or a node missing here) draws that node exactly as before. PNG export takes no special handling: it
   *  screenshots this SVG, and a static raster has no links either way. */
  links?: Record<string, string>;
  /** A20: the preset pack's icon for each node that has one (`FlowDocument.icons`). Drawn as a small round tag on the
   *  node's top edge, towards the left (`iconBox`); omitted (or a node missing here) draws that node as before. */
  icons?: Record<string, ResolvedIcon>;
}

const MARGIN = 24;
/** The title's default place (§6): above the diagram's top-left corner, as the layout puts it (layout TITLE_GAP). */
const TITLE_DEFAULT_Y = -(TITLE_FONT.lineHeight + 18);
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

/**
 * A20: a glyph from the 24 x 24 grid, stroked in `color`, drawn `size` px wide with its top-left at (x, y). Stroke-only
 * and one colour, so it reads wherever its colour contrasts with what is behind it.
 */
function renderGlyph(icon: ResolvedIcon, x: number, y: number, size: number, color: string): string {
  const paths = icon.paths.map((d) => `<path d="${escapeXml(d)}"/>`).join('');
  return `<g transform="translate(${num(x)}, ${num(y)}) scale(${num(size / GLYPH_GRID)})" fill="none" stroke="${color}" stroke-width="${GLYPH_STROKE}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`;
}

/**
 * A20: the preset pack's icon as a round tag on the node's top edge (`iconBox`, shared with the UI): the block's own
 * fill and border for the tag, a ring in the canvas colour to set it off the lane behind, and the glyph in the block's
 * text colour, the one colour that contrasts with the block's fill in either theme.
 */
function renderIcon(icon: ResolvedIcon, node: LayoutResult['nodes'][number], resolved: ResolvedNodeStyle, theme: Theme): string {
  const b = iconBox(node.kind, node.width, node.height);
  const r = ICON_CHIP / 2;
  const cx = node.x + b.x + r;
  const cy = node.y + b.y + r;
  const pad = (ICON_CHIP - ICON_GLYPH) / 2;
  return [
    `<g data-role="icon" data-icon="${escapeXml(icon.name)}">`,
    `<circle cx="${num(cx)}" cy="${num(cy)}" r="${r + 1.5}" fill="${theme.canvasBackground}"/>`,
    `<circle cx="${num(cx)}" cy="${num(cy)}" r="${r}" fill="${resolved.fill}" stroke="${resolved.stroke}" stroke-width="1.25"/>`,
    renderGlyph(icon, node.x + b.x + pad, node.y + b.y + pad, ICON_GLYPH, resolved.textColor),
    '</g>',
  ].join('');
}

function renderLane(lane: LayoutResult['lanes'][number], index: number, theme: Theme, laneFree: boolean): string {
  if (laneFree) {
    // Amendment A4: a diagram without subgraphs is a plain flowchart: no band, no header. The lane's group and its
    // label stay in the file (hidden) so the §7.1 structure still lists every lane of `flowmap layout`.
    return `<g data-lane-id="${escapeXml(lane.id)}"><text visibility="hidden" x="${num(lane.x)}" y="${num(lane.y)}" font-size="12" fill="${theme.laneLabel}">${escapeXml(lane.label)}</text></g>`;
  }
  const fill = theme.laneFill[index % 2];
  return [
    `<g data-lane-id="${escapeXml(lane.id)}">`,
    `<rect x="${num(lane.x)}" y="${num(lane.y)}" width="${num(lane.width)}" height="${num(lane.height)}" fill="${fill}" stroke="${theme.laneBorder}" stroke-width="1"/>`,
    `<text x="${num(lane.x + 12)}" y="${num(lane.y + 20)}" font-size="12" font-weight="600" fill="${theme.laneLabel}">${escapeXml(lane.label)}</text>`,
    '</g>',
  ].join('');
}

function renderNode(node: LayoutResult['nodes'][number], style: ResolvedStyle | undefined, theme: Theme, linkTarget?: string, icon?: ResolvedIcon): string {
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
  if (icon) parts.push(renderIcon(icon, node, resolved, theme));
  parts.push('</g>');
  const group = parts.join('');
  // A15 §7.1: wrap a linked block so exported sets stay clickable (the `<g>` itself is unchanged, so every existing
  // structural check on it still matches).
  return linkTarget ? `<a href="${escapeXml(`${linkTarget}.svg`)}">${group}</a>` : group;
}

/** A18: how each edge style is drawn. Solid is the original look; the others change only the stroke and the heads. */
const EDGE_STROKE_WIDTH = { solid: 1.5, dashed: 1.5, bidirectional: 1.5, thick: 3 } as const;
const EDGE_DASH = '6 4';

function renderEdge(edge: LayoutResult['edges'][number], theme: Theme): string {
  const style = edge.style ?? 'solid';
  const pointsAttr = edge.points.map(([x, y]) => `${num(x)},${num(y)}`).join(' ');
  const styleAttr = style === 'solid' ? '' : ` data-edge-style="${style}"`;
  const parts: string[] = [`<g data-edge-id="${escapeXml(edge.id)}"${styleAttr}>`];
  const dash = style === 'dashed' ? ` stroke-dasharray="${EDGE_DASH}"` : '';
  const head = style === 'thick' ? 'arrowhead-thick' : 'arrowhead';
  const start = style === 'bidirectional' ? ` marker-start="url(#${head})"` : '';
  parts.push(`<polyline points="${pointsAttr}" fill="none" stroke="${theme.edgeColor}" stroke-width="${EDGE_STROKE_WIDTH[style]}"${dash}${start} marker-end="url(#${head})"/>`);
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
    // A20: a preset pack's entry shows its glyph on the swatch, centred, in the style's text colour.
    if (item.icon) {
      const g = LEGEND_SWATCH_H - 4;
      parts.push(renderGlyph(item.icon, ix + (LEGEND_SWATCH_W - g) / 2, iy + 2, g, resolved.textColor).replace('<g ', `<g data-role="icon" data-icon="${escapeXml(item.icon.name)}" `));
    }
    parts.push(
      `<text x="${num(ix + LEGEND_SWATCH_W + 8)}" y="${num(iy + LEGEND_SWATCH_H * 0.72)}" font-size="12" fill="${theme.legendText}">${escapeXml(item.text)}</text>`,
    );
    parts.push('</g>');
  }
  parts.push('</g>');
  return parts.join('');
}

function renderDefs(theme: Theme, thick: boolean): string {
  // A18: a thick line's head is sized from its own stroke width (markerUnits), so it gets its own smaller marker, and
  // only a diagram that has a thick line carries it.
  const marker = (id: string, size: number) => `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="${size}" markerHeight="${size}" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="${theme.edgeColor}"/></marker>`;
  return `<defs>${marker('arrowhead', 7)}${thick ? marker('arrowhead-thick', 4) : ''}</defs>`;
}

/** The title: one line of TITLE_FONT, its top-left at the box's (the layout's `title`, §7). */
function renderTitle(box: LayoutTextBox, theme: Theme): string {
  const baseline = box.y + (TITLE_FONT.lineHeight - TITLE_FONT.size) / 2 + TITLE_FONT.size * 0.8;
  return `<text data-role="title" x="${num(box.x)}" y="${num(baseline)}" font-size="${TITLE_FONT.size}" font-weight="700" fill="${theme.titleColor}">${escapeXml(box.text)}</text>`;
}

/** A note (§7.1 v1.1): a <g data-note-id> with one <text> per line, each with its size and colour, bold only when bold. */
function renderNote(note: { id: string } & LayoutTextBox, style: NoteInput | undefined, theme: Theme): string {
  const size = style?.font_size ?? 14;
  const bold = style?.bold ?? false;
  const fill = resolveStyle({ text_color: style?.color }, theme).textColor;
  const lh = noteLineHeight(size);
  const weight = bold ? ' font-weight="bold"' : '';
  const lines = noteLines(note.text).map((line, i) => {
    const baseline = note.y + i * lh + (lh - size) / 2 + size * 0.8;
    return `<text x="${num(note.x)}" y="${num(baseline)}" font-size="${size}" fill="${fill}"${weight} xml:space="preserve">${escapeXml(line)}</text>`;
  });
  return `<g data-note-id="${escapeXml(note.id)}">${lines.join('')}</g>`;
}

/** Render the diagram to an SVG document string (design.md §7.1). */
export function renderSvg(options: RenderSvgOptions): string {
  const theme = getTheme(options.theme);
  const { title, layout, styles, legend } = options;
  const titleBox: LayoutTextBox | null = layout.title !== undefined
    ? layout.title
    : { text: title, x: 0, y: TITLE_DEFAULT_Y, ...titleSize(title) };
  const notes = layout.notes ?? [];
  const noteStyle = new Map((options.notes ?? []).map((n) => [n.id, n]));

  // Everything drawn, in diagram coordinates: the lanes from (0, 0), plus the title, notes and any line or label
  // outside them (all may be at negative coordinates, §6). The picture is that box plus a margin, then the legend.
  let minX = 0;
  let minY = 0;
  let maxX = Math.max(layout.width, MIN_CONTENT_WIDTH);
  let maxY = layout.height;
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  };
  if (titleBox) grow(titleBox.x, titleBox.y, titleBox.x + titleBox.width, titleBox.y + titleBox.height);
  for (const n of notes) grow(n.x, n.y, n.x + n.width, n.y + n.height);
  for (const e of layout.edges) for (const [x, y] of e.points) grow(x - 8, y - 8, x + 8, y + 8);
  for (const e of layout.edges) {
    if (e.label && e.label_pos) {
      const w = textWidth(e.label) + EDGE_LABEL_PAD_X * 2;
      grow(e.label_pos[0] - w / 2, e.label_pos[1] - LABEL_FONT.lineHeight / 2, e.label_pos[0] + w / 2, e.label_pos[1] + LABEL_FONT.lineHeight / 2);
    }
  }
  const ox = MARGIN - minX;
  const oy = MARGIN - minY;
  const contentWidth = maxX - minX;
  const legendLayout = layoutLegend(legend, contentWidth);
  const legendTop = oy + maxY + LEGEND_GAP;
  const totalHeight = legend.length ? legendTop + legendLayout.totalHeight + MARGIN : oy + maxY + MARGIN;
  const totalWidth = contentWidth + MARGIN * 2;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(totalWidth)}" height="${num(totalHeight)}" viewBox="0 0 ${num(totalWidth)} ${num(totalHeight)}" font-family="Inter, -apple-system, 'Segoe UI', sans-serif" data-theme="${theme.name}">`,
  );
  parts.push(renderDefs(theme, layout.edges.some((e) => e.style === 'thick')));
  parts.push(`<rect x="0" y="0" width="${num(totalWidth)}" height="${num(totalHeight)}" fill="${theme.canvasBackground}"/>`);

  parts.push(`<g transform="translate(${num(ox)}, ${num(oy)})">`);
  const laneFree = isLaneFree(layout.lanes);
  layout.lanes.forEach((lane, index) => parts.push(renderLane(lane, index, theme, laneFree)));
  for (const node of layout.nodes) parts.push(renderNode(node, styles[node.id], theme, options.links?.[node.id], options.icons?.[node.id]));
  for (const edge of layout.edges) parts.push(renderEdge(edge, theme));
  // Notes and the title take no part in the layout rules and may sit over anything: drawn last, on top.
  for (const note of notes) parts.push(renderNote(note, noteStyle.get(note.id), theme));
  if (titleBox) parts.push(renderTitle(titleBox, theme));
  parts.push('</g>');

  parts.push(renderLegend(legend, theme, MARGIN, legendTop, contentWidth));
  parts.push('</svg>');

  return parts.join('');
}
