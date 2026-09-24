# flowmap rulings

Answers to questions the contract (`design.md`) didn't settle. Both builds get every ruling; see `ab-protocol.md`
rule 3. Newest at the bottom.

| # | Date | Asked by | Question | Ruling | Given to the other build |
|---|---|---|---|---|---|
| R1 | 2026-09-24 | acceptance suite | §7 says the grader runs `pnpm exec flowmap`, but pnpm 9 doesn't put a package's own `bin` on the PATH. | The build must make `pnpm exec flowmap <args>` work from its root after `pnpm install && pnpm build`, for example with a dev dependency `"flowmap": "link:."`. | Build B: in its starting context |
| R2 | 2026-09-24 | A + acceptance suite | §9 says the `yaml` Document API keeps untouched config lines byte-identical. It doesn't: `toString()` re-pads flow maps (`{a: b}` → `{ a: b }`) and collapses spacing. | §9's advice is wrong; UI26 stands (untouched parts byte-identical, including unusual spacing). Edit the text minimally, or an equivalent that preserves bytes. Amendment 1 in `design.md` §12. | Build B: in its starting context |
| R3 | 2026-09-24 | acceptance suite | UI18: a lane label with no `a-z0-9` characters ("!!!") gives an empty slug, and `lane-` breaks the id rules. | If the slug is empty, the id is `lane` (then `lane-2`, `lane-3`… while taken). The `lane-` prefix still applies to a slug that starts with a digit or is reserved. | Build B: in its starting context |
| R4 | 2026-09-24 | A | Parser edge cases the contract leaves open (list below). | Adopted as listed below. | Build B: in its starting context |
| R5 | 2026-09-24 | A | Config and layout-file edge cases the contract leaves open (list below). | Adopted as listed below. | Build B: in its starting context |
| R6 | 2026-09-24 | A | Edit-operation edge cases the contract leaves open (list below). | Adopted as listed below. | Build B: in its starting context |
| R7 | 2026-09-24 | A | §9 lists React Flow for the canvas. It positions nodes itself and fights exact layout coordinates. May a build draw its own canvas? | Yes. §9's library list is a recommendation; the DOM contract (§8.3) and the layout rules are binding. Say why in the README, as §9 asks. | Build B: in its starting context |
| R8 | 2026-09-24 | Dan (CEO) | Can a person make a generic flowchart without lanes? | Yes: amendment A4 in `design.md` §12. | Build B: in its starting context |

## R4: parser edge cases

1. An empty or comment-only file is `E-header` at line 1. A first statement that isn't a valid header gets only
   `E-header`, not an extra `E-syntax`.
2. `direction X` gives `W-direction` for X in `TB TD BT RL LR`; any other `direction` line is `E-syntax`.
3. In an `@{…}` node, a raw backslash in the label, a quoted shape value (`shape: "doc"`), an unquoted label or a
   missing label is `E-shape`.
4. An empty unquoted label (`a[]`, `a[ ]`, `subgraph s []`) is `E-syntax`. `a[""]` is accepted as an empty label (the
   UI still refuses to set an empty block label, per UI8).
5. A space between an id and its shape (`a [x]`) is `E-syntax`, and so is a class on a node without a shape
   (`a:::hot`).
6. `a -- "text" --> b` (a quoted label in the long form) is accepted.
7. `a -- b` and `a--b["X"]` are `E-syntax`. `---`, `--x`, `--o`, `-.->`, `==>`, `<-->`, `~~~` and `o--o` are
   `E-edge`.
8. In pass-through lines, `;` is allowed inside `"…"` and right after a `#word` (so `fill:#f96;stroke:#333` is fine);
   `;;` at the end is `E-syntax`.
9. `a["A"] & b["B"]` with no arrow is two declarations; a comment above it goes with the first.
10. An id used as both a node and a subgraph, with edges to it, reports both `E-duplicate` and `E-syntax`. Otherwise
    each line reports at most one syntax error.
11. A lane written without a label keeps its old id as its label after the lane id is renamed (canonical output is
    `[id]` either way).
12. Layout JSON `nodes` order: unlaned first, then each lane in file order, then never-declared nodes by first
    mention.
13. Re-declaring a laned node at the top level with the same shape and label is `E-duplicate` (no lane counts as a
    different lane).

## R5: config and layout-file edge cases

1. A null top-level key (`nodes:`) or null node entry (`n1:`) is treated as absent or empty, not `E-config`. A null
   `match` or `style` in a rule is `E-config`.
2. `version: "1"` (a string) is `E-config`; only the number 1 is accepted.
3. Reading a themed colour with `dark` but no `light` is `W-style` (mirroring the write refusal). A light-only colour
   is used in both themes.
4. `border_width: "2"` (a string) is `W-style`. `badge: ""` means no badge, with no warning.
5. Metadata keys named `id`, `lane` or `label` don't override the node's own values in `match`; only `kind` does
   (§4).
6. Node YAML of `{}` removes the entry, like empty YAML.
7. A new top-level config key goes at the very end of the file, after any trailing comments.
8. Deleting the last `lanes` or `styles` entry leaves `lanes: []` or `styles: []`.
9. The layout file requires `version: 1` and `nodes`; unknown top-level keys (other than `hints`) and extra keys in a
   pin are `E-layout`.
10. Pins are written in file order: new pins last, and a renamed pin keeps its place.
11. In the UI, emptying a colour's light value clears the whole property; emptying only the dark value writes a
    single colour.
12. A match value typed `2` is written as the string `"2"` (§4: text inputs write strings).
13. Renaming a lane to an id that has a stale config `lanes` entry removes the stale entry.
14. A field-form map line without `": "` is refused, except a line ending in `:`, which becomes an empty value.

## R6: edit-operation edge cases

1. Renaming a block (UI9) changes exactly the references UI9 lists; pass-through lines such as `class r01 hot` are
   left as they are (they're text-only, §8.1).
2. When the config or layout file has errors, an operation is refused if it always writes that file, or if an
   affected id appears in that file's raw text as a whole word; otherwise it proceeds and leaves the broken file
   byte-identical. Ids mentioned in a broken file count as taken.
3. A block or lane label that is only whitespace is refused like an empty one; an edge label that is only whitespace
   removes the label; any label containing a line break is refused.
4. `addLane` with a stale config `lanes` entry for the new id removes the stale entry and appends the new one
   (extends R5.13).
5. Changing the shape of, or moving, a node that exists only in edges declares it (in the unlaned section or the
   target lane). Duplicating one copies it as a declared step labelled with its id, in Unassigned.
6. Moving a block to the lane it's already in does nothing (no re-append; its pin is kept).
7. Duplicates don't copy the original's comments.
8. Inspector field operations refuse ids not in the `.mmd`; orphaned entries are removed only through the orphan
   deletes (UI27).
9. Move up on the first lane, or down on the last, changes nothing.
