// Where notes and the title are, for the parts of the UI that frame the diagram (fit, the legend). Pure: layout in,
// numbers out. Notes and the title come from the layout function (`LayoutResult.notes`, `.title`, §6 "Notes and
// title"), already in diagram coordinates and shifted by the frame.
import type { LayoutResult, LayoutTextBox } from '../../core/types';
import type { Rect } from '../canvas/viewport';
import type { Derived } from '../store/derive';

/** Every drawn note and the title (when shown), as boxes in diagram coordinates. */
export function annotationBoxes(layout: LayoutResult): LayoutTextBox[] {
  const out: LayoutTextBox[] = [...(layout.notes ?? [])];
  if (layout.title) out.push(layout.title);
  return out;
}

/**
 * The bottom of the diagram plus the default row of notes under it (§6: unplaced notes sit in a row below the
 * diagram). The legend goes below this, as in the SVG export, so it never sits on top of that row. A note someone
 * placed is wherever they put it and doesn't push the legend.
 */
export function notesRowBottom(shown: Derived | null): number {
  const layout = shown?.layout;
  if (!layout) return 0;
  const unplaced = new Set(shown!.doc.notes.filter((n) => n.position === null).map((n) => n.id));
  let bottom = layout.height;
  for (const n of layout.notes ?? []) if (unplaced.has(n.id)) bottom = Math.max(bottom, n.y + n.height);
  return bottom;
}

/** The smallest rect holding `r` and every note and the title (for fit to screen). */
export function withAnnotations(r: Rect, layout: LayoutResult): Rect {
  let x0 = r.x;
  let y0 = r.y;
  let x1 = r.x + r.width;
  let y1 = r.y + r.height;
  for (const b of annotationBoxes(layout)) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
