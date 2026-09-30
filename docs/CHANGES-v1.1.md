# flowmap v1.1: what changed since v1.0

v1.1 is the current contract. Every change is in `design.md`,
marked "(v1.1)" or listed in §12. This page is the map.

## Amendments folded in (already binding before v1.1)

| # | Change |
|---|---|
| A1 | §9: the `yaml` package's `toString()` does not keep untouched config lines byte-identical; edit text minimally (UI26 unchanged). |
| A2 | §7: `pnpm exec flowmap` must work from the build's root (for example a `"flowmap": "link:."` dev dependency). |
| A3 | UI18: an empty lane-id slug gives `lane`. |
| A4 | Diagrams without lanes are plain flowcharts; drop outside lanes to unlane a block; "New diagram" offers Flowchart or Swimlanes. |
| A5 | No `W-no-lane` warnings in a file with no subgraphs. |

Rulings R1–R8 (`rulings.md`) settle edge cases; they still apply.

## New in v1.1: shaping by hand

| What a person can do | Requirement | Where it's stored |
|---|---|---|
| Resize a block (8 handles; can't go below what the label needs) | UI34 | layout `nodes.<id>.width/height` |
| Colour a block (fill, border, text; light and dark; swatches) | UI35 | config `nodes.<id>.style` |
| Bend a line: drag a segment sideways, move, add or remove bend points, reset | UI36 | layout `edges.<id>.points` |
| Drag a line's label along it | UI37 | layout `edges.<id>.label_at` |
| Connect from any side (four handles; diamonds at their vertices); pick the target's connection point | UI38 | layout `edges.<id>.source_side/target_side` |
| Snap to other blocks' centres and edges, with guide lines (Alt turns it off) | UI39 | (the snapped position) |
| Right-click / two-finger-click menus on blocks, lines, notes, the title and empty canvas | UI40 | (each item's own storage) |
| Free text notes anywhere | UI41 | config `notes`, layout `notes` |
| Move, hide and show the title | UI42 | layout `title`, config `show_title` |
| Drop anything anywhere, including left of or above everything | UI43 | stored as dropped, negative values allowed; the layout's frame (§6) keeps output at 0 |

Supporting rules:
- §5: the whole layout file, including how bend points are expressed (lane-relative, like pins) and which values may
  be negative (flow axis, the first lane, notes and the title).
- §6: Frame (how negative values shift the output), L4 (sizes), L7 (manual lines are exempt), L8 (`label_at`), L11 (how a manual line is drawn), L12 (sides),
  notes and title outside the layout rules.
- §7: the layout JSON gains `manual`, `source_side` and `target_side` on edges, plus `notes` and `title`.
- §7.1: the SVG gains notes, and omits a hidden title.
- §8.2, "Keeping the layout file in step": which edits rename or remove layout entries.
- §8.3: new DOM attributes, each marked (v1.1).
- §10: U11–U16, P21–P30, H7–H8.

## Behaviour that changed

- **Connecting by handle** now writes `source_side` (four handles per block instead of one). The click path still
  writes no sides.
- **"Re-layout all"** also removes bend points; it keeps sizes, sides, label positions, notes and the title position.
- **The layout file** accepts the new keys; anything else is still `E-layout` (R5.9). Pins may now be negative, and
  UI10 no longer clamps `across` to 12.
- **Connection handles**: four `data-handle="source"` per block, in DOM order top, right, bottom, left. There is no
  `data-handle="target"`; drops aim at a block or at its `data-port-target` connection points.
- **Drags snap** (UI39); hold Alt to disable. The v1.0 drag tests now hold Alt.
