// Where each legend entry goes (UI2, §7.1): left to right, wrapping to a new row when the next entry would pass
// `maxWidth`. Shared by the SVG export and the editor (its legend and its "fit" bounds), so both wrap the same way.
import { textWidth } from './measure';

export const LEGEND_ROW_HEIGHT = 20;
export const LEGEND_SWATCH_W = 26;
export const LEGEND_SWATCH_H = 16;
/** Between a swatch and its text. */
export const LEGEND_TEXT_GAP = 8;
export const LEGEND_ITEM_GAP_X = 24;
export const LEGEND_ITEM_GAP_Y = 12;

export interface LegendPosition<T> {
  item: T;
  /** The entry's top-left, relative to the legend's. */
  x: number;
  y: number;
}

export function legendLayout<T extends { text: string }>(legend: readonly T[], maxWidth: number): { items: LegendPosition<T>[]; totalHeight: number } {
  const items: LegendPosition<T>[] = [];
  let x = 0;
  let y = 0;
  for (const item of legend) {
    const itemWidth = LEGEND_SWATCH_W + LEGEND_TEXT_GAP + textWidth(item.text);
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
