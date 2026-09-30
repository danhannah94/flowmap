# flowmap

A local flowchart tool for process maps that two authors share: a person working in a visual editor and an AI
working in text. Both edit the same files on disk. The AI writes compact Mermaid; the person drags boxes, connects
them, renames them and exports a picture; each sees the other's changes live, because the files are the single
source of truth and the editor watches them.

Everything runs on your machine. The server binds to `127.0.0.1` only, works offline after install, and makes no
cloud calls.

The full contract is in [`docs/design.md`](docs/design.md), with rulings on open questions in
[`docs/rulings.md`](docs/rulings.md).

## Install, build, run

You need Node 22 or newer and pnpm.

```sh
pnpm install && pnpm build
pnpm exec flowmap serve <dir>            # the editor for every .mmd in <dir>, on http://127.0.0.1:4870
pnpm exec flowmap serve <dir> --port 5000
```

Open the address it prints, pick a diagram (or start one with New diagram: a Flowchart, or Swimlanes with a lane
per role), and edit. `/?file=<name>.mmd` opens one directly.

The other commands (each takes the path to a `.mmd`; its config and layout files are found beside it):

| Command | What it does |
|---|---|
| `flowmap validate <file.mmd> [--json]` | Checks all three files and lists errors and warnings with their codes and lines. Exits 1 on errors. |
| `flowmap fmt <file.mmd> [--check] [--stdout]` | Rewrites the `.mmd` in canonical form. `--check` only reports; `--stdout` prints instead of writing. |
| `flowmap layout <file.mmd> [--json]` | Prints the computed layout (every lane, block and line, in pixels). |
| `flowmap export <file.mmd> --format svg\|png [--theme light\|dark] [--out <path>]` | Writes a picture to `exports/<name>.svg` or `.png` beside the `.mmd` (light theme by default). |
| `flowmap serve <dir> [--port 4870]` | Runs the editor. |

PNG export renders in headless Chromium through Playwright. If it says the browser is missing, run
`pnpm exec playwright install chromium` once.

Development: `pnpm test` runs the unit tests (Vitest), `pnpm typecheck` checks types, `pnpm test:ui` builds and runs
the browser tests (Playwright), and `pnpm dev:ui` serves the UI with hot reload, proxying `/api` to a running
`flowmap serve` (set `FLOWMAP_API` if it isn't on the default port).

## The three files

A diagram is up to three files with the same base name, side by side. Only the `.mmd` is required.

| File | Owns | Who writes it |
|---|---|---|
| `<name>.mmd` | What the process is: lanes, steps, decisions, lines, labels. A strict subset of Mermaid flowchart syntax, so GitHub renders it too. | Both. The editor always writes canonical form (`flowmap fmt`), so diffs stay small. |
| `<name>.flow.yaml` | How it looks and what we know: the title, lane order, per-step metadata (who said it, how sure we are, quotes, open questions) and style rules that turn that metadata into looks, with a legend. | Both. The editor changes only the lines it edits; comments and formatting elsewhere survive byte for byte. |
| `<name>.layout.json` | Where things are: the positions you pinned by dragging, relative to their lane, and any lane sizes you set by dragging a lane's edge. | The editor (hand edits are allowed but rare). |

Why three and not two: the layout file changes on every drag, so keeping it apart means the human-edited config never
picks up noise from the editor, and neither author's edits clobber the other's.

Anything you can do by editing these files, you can do in the editor, and it writes the same result. A few things
are deliberately text-only and are kept untouched: comments in the `.mmd` (the AI's working notes), `:::class`
suffixes and `classDef`/`style` lines, and the order of statements in the `.mmd`.

## Flowcharts without lanes

Lanes are optional. A `.mmd` with no `subgraph` is a plain flowchart: no lane bands, no lane headers, just the blocks
and lines on the canvas (in the editor, the SVG and the PNG alike). Its layout is the same as any other diagram's,
with every block in the `_unassigned` lane, so `flowmap layout` and pins work as usual (a pin's `across` is simply its
distance from the top, or from the left for top-to-bottom).

```mermaid
flowchart LR
  start(["Ticket arrives"])
  known{"Known issue?"}
  reply["Reply with the fix"]
  repro["Reproduce the problem"]
  start --> known
  known -->|yes| reply
  known -->|no| repro
  repro --> reply
```

In the editor, New diagram asks for **Flowchart** (no lanes) or **Swimlanes**; both create the same empty `.mmd`, and
the choice only decides what the first-steps hint suggests. In a flowchart, clicking a shape in the palette adds the
block straight away (placed automatically and opened for its label), and dragging a shape onto the canvas adds it
pinned where you drop it. Adding a lane at any time turns it into a swimlane map; the blocks you already have show in
the Unassigned lane until you move them. `flowmap validate` still notes each block that isn't in a subgraph
(`W-no-lane`); the editor doesn't list those for a diagram that has no lanes at all.

![A flowchart without lanes, light theme](docs/screenshots/flowchart-light.png)
![The same flowchart, dark theme](docs/screenshots/flowchart-dark.png)

## Using the editor

**Blocks.** The palette on the left has the eight shapes (step, decision, start/end, subprocess, system/data,
input/output, document, wait). Click a shape and then click in a lane, or click a lane's empty area and then a shape,
or drag a shape into a lane (it lands pinned where you drop it). A new block opens straight into its label. Double-click
a block, or select it and press Enter, to rename it. Change its shape from the shape picker, and its id from the
inspector.

**Moving.** Drag a block to move it; it is pinned where you drop it (saved within a second). Drop it in another lane
to move it there (the lane it will land in lights up while you drag). Drop it outside every lane (below the last
one, or past their end) to make it unassigned: it moves to the Unassigned lane, pinned where you dropped it, and
while you drag, the place that lane will appear is outlined. Shift-click adds to the selection, Shift-drag on
the background draws a selection box, and the arrow keys nudge by 10 px. Unpin puts selected blocks back under
automatic placement; Re-layout all clears every pin. Drag the background to pan; scroll or pinch to zoom; Fit shows
everything.

**Lines.** Drag from a block's connection handle (the dot on its side, shown on hover) to another block, or select a
block, press Connect and click the target. Select a line and drag either end to reconnect it. Double-click a line to
set or clear its label.

**Lanes.** Add a lane from the toolbar and name it. Double-click a lane's header to rename it. The header's menu
(the `···` button that appears on hover) can also change the lane's id, move it up or down, or delete it. Drag a lane
header to reorder the lanes; a line shows where it will land. Deleting a lane that still has blocks asks whether to
move them to another lane (or Unassigned) or delete them with it. Blocks with no lane live in the Unassigned lane,
which always shows last.

**Title and direction.** Double-click the title to edit it (empty falls back to the file name). The direction button
flips between left-to-right and top-to-bottom; pins keep their values.

**Evidence and styles.** Select a block to see its id, lane, shape, label and every metadata field in the inspector.
Add, edit or delete fields as text, a list, a map or raw YAML; values that the style rules match on are offered as
one-click choices. With several blocks selected, set or remove a field on all of them. The Styles panel lists the
rules in order with their legend text and a swatch; add, reorder and delete rules, and edit their conditions and
looks (fill, border colour, style and width, text colour, font style, badge, each with light and dark colours). A
badge is a small tag on the top edge of the block, never over its label.
Config entries for things that no longer exist show in the warnings list with a button to delete them.

**Undo.** Every edit, to any of the three files, is one undo step: Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z, or the toolbar
buttons. Undo restores all three files exactly (a file an edit created is deleted again). If a file changes on disk
from outside (the AI edited it), the view updates within a second, keeps your pan, zoom and selection, and clears
the undo history so undo can never overwrite the other author's work; the editor says when that happens.

**Safety.** Every edit saves within a second, atomically. The save indicator shows saved, saving or error. A file
with errors is shown in the error banner (code, line, message) and never overwritten; with `.mmd` errors the diagram
is read-only until the file is fixed.

**Export.** The SVG and PNG buttons write `exports/<name>.svg` or `.png` beside the `.mmd` (light theme, the same
picture as `flowmap export`) and show the path, with a button to copy it.

**Keyboard.** Press `?` (or the `?` button at the bottom left) for the full list. The main ones:

| Keys | Does |
|---|---|
| Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z | Undo, redo |
| Delete or Backspace | Delete the selected blocks and lines |
| Cmd/Ctrl+D | Duplicate the selected blocks |
| Cmd/Ctrl+A | Select everything |
| Enter | Edit the selected block's label |
| Escape | Cancel an edit, or clear the selection |
| Arrow keys | Nudge the selection 10 px (pins it) |
| `?` | Show or hide the shortcut list |

Shortcuts never fire while you are typing in an editor or a field.

## Library choices, and why

- **A custom canvas instead of React Flow** (ruling R7). The layout function decides every position, and the editor
  must show a block exactly where `flowmap layout` puts it, to the pixel. React Flow positions and measures nodes
  itself and fought those exact coordinates. The canvas is a single CSS-transformed layer of plain DOM and SVG, which
  also keeps dragging smooth on 100+ node diagrams.
- **Its own layout and router instead of ELK.** ELK has no hard fixed-position constraint, and its router doesn't
  route around nodes it didn't place, but pinned blocks must stay exactly where they were dropped and lines must
  avoid every box. flowmap's layered layout places unpinned blocks around pinned ones in lane bands and routes
  orthogonal lines itself. It is deterministic, and it keeps "hints" in the layout file so a small edit doesn't
  reshuffle unrelated boxes.
- **No server framework.** The server is a small JSON API, a server-sent-events channel and static files, on Node's
  built-in `http` and `fs`. There's nothing a framework would add, and one less dependency to keep safe.
- **Playwright for PNG export.** The SVG is rendered in headless Chromium with the same bundled Inter font the editor
  uses, so the PNG matches the SVG and the screen. Playwright is already the UI test runner, so this adds no new
  dependency.
- **`yaml` for reading the config, with minimal text edits for writing it.** The `yaml` package's `toString()`
  reformats untouched lines, so the editor splices only the byte ranges it changes (amendment A1). Comments, key
  order and odd spacing elsewhere survive.
- **Inter, bundled** (`@fontsource/inter`). Label sizes are measured against Inter's metrics, so the editor, the SVG
  and the PNG wrap labels identically, and it works offline.
- **React, Vite, Vitest, TypeScript** as the contract suggests.

## Layout of the code

- `src/core`: parsing and canonical formatting of the `.mmd`, the config and layout files, styles, the layout and
  router, SVG rendering, and every edit as a pure function over the three files (`src/core/ops`). No DOM, no file
  system. The CLI and the editor share this one core.
- `src/cli`: the `flowmap` command.
- `src/server`: static files, reading and atomically writing the three files, watching the directory, the JSON API and
  the push channel.
- `src/ui`: the editor. Every edit calls a core operation through the store (`store.apply`), which makes it one undo
  step and saves it.

## License

MIT, see [LICENSE](LICENSE).
