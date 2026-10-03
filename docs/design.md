# flowmap: design and build contract (v1.1, 2026-09-24)

> **v1.1** adds shaping by hand (resize, per-block colours, bent lines, connection sides, draggable line labels,
> snap guides, context menus, free notes, a movable title) and folds in amendments A1–A5. `CHANGES-v1.1.md` lists
> every change against v1.0. Sections and requirements marked "(v1.1)" are new.

A local flowchart tool for process maps that two authors share: a person working in a visual editor and an AI working
in text. Both edit the same files. This document is the contract for building it: what the files look like, what the
command line does, what the UI does, and how each requirement is checked. Where this document says MUST, an acceptance
test will check it. Where it leaves the implementation a choice, it says so.

## 1. Why this exists

We map business processes (who does what, in which system, waiting on whom) from interviews. The map changes
constantly: every conversation corrects it. Today the map is a YAML file rendered to draw.io by a script. draw.io is
slow (about a minute per exported page) and awkward to edit by hand, and hand edits in draw.io cannot flow back to the
source file.

flowmap fixes the loop:

- **The AI writes text fast.** Mermaid flowchart syntax is compact and every model knows it.
- **The person edits visually.** Drag boxes, connect them, rename them, move a step to another lane, export a picture.
- **Both see each other's changes live**, because the files are the single source of truth and the UI watches them.
- **The map is honest about evidence.** Each step carries metadata (who said it, how confident we are, the verbatim
  quote, the open question), and a style config turns that metadata into how the step looks (dashed border = one
  source only). The legend explains the encoding.

## 2. The one idea: text owns *what*, config owns *how it looks*, layout owns *where*

A diagram is three files with the same base name, side by side:

| File | Owns | Written by | Example |
|---|---|---|---|
| `<name>.mmd` | Topology: lanes, steps, decisions, edges, labels | Both: people via the UI, the AI by hand | `a["Check the order"] --> b{"Complete?"}` |
| `<name>.flow.yaml` | Meaning and look: lane order, per-step metadata, style rules, title | Both: people via the UI (title, lane order, inspector, styles panel), the AI by hand | `confidence: single-source` → dashed |
| `<name>.layout.json` | Where things are and how lines run: pinned positions, block sizes, line bends and sides, label, note and title positions | The UI (hand edits allowed) | `{"version": 1, "nodes": {"eq07": {"lane": "rep", "along": 840, "across": 30}}}` |

Why three files and not two: the layout file changes on every drag. Keeping it apart means the human-edited config
never picks up noise from the UI's writes, and neither author's edits clobber the other's.

**Parity**: anything either author can do by editing these files, a person can also do in the UI, which writes the
same result (section 8.1). The files are the common ground, not a back door.

Only `<name>.mmd` is required. A missing config means default styles; a missing layout file means everything is placed
automatically.

## 3. The `.mmd` format: a strict subset of Mermaid flowchart

The file must be valid Mermaid (GitHub renders it as a plain fallback view), but flowmap accepts only the subset below
so that both authors can round-trip it without loss. Anything outside the subset is an error, not a silent drop.

### 3.1 Accepted input

- **Header** (first line that isn't a comment or blank): `flowchart LR`, `flowchart TB`, `flowchart TD`, or the same
  with `graph`. `TD` means `TB`. Any other direction, or a missing header, is error `E-header`, at that first line
  (line 1 for an empty file).
- **Statements**: one per line. A trailing `;` is accepted and dropped; any other `;` outside a label and not ending
  a `#…;` escape (several statements on one line) is `E-syntax`. Keywords (`subgraph`, `end`, `direction`, `classDef`, `class`, `style`,
  `linkStyle`, `click`) match as whole tokens only, so `class_a --> b` is an edge.
- **Lanes**: `subgraph <id> [<Label>]` or `subgraph <id> ["<Label>"]` … `end` (the space before `[` is optional).
  Subgraph ids follow the node id rules below, including the reserved list. A missing label means the label is the
  id. One level only: a subgraph inside a subgraph is `E-nested` (at the inner `subgraph` line; the inner block
  still opens and closes, so its `end` is not a second error). A subgraph with no `end` is `E-unclosed` (at the
  `subgraph` line). An `end` with no open subgraph is `E-syntax`. Two subgraphs with the same id, or a subgraph id
  equal to a node id, is `E-duplicate` (at whichever of the two comes later in the file). An edge to or from a subgraph id is `E-syntax`.
- **Node shapes**: eight, each with a *shape kind* name used everywhere else in this contract:

  | Shape kind | Mermaid syntax | Drawn as | Typical use |
  |---|---|---|---|
  | `step` | `id[Label]` | rectangle | an action |
  | `decision` | `id{Label}` | diamond | a question with branches |
  | `terminal` | `id([Label])` | stadium | start or end |
  | `subprocess` | `id[[Label]]` | rectangle with side bars | a process mapped elsewhere |
  | `database` | `id[(Label)]` | cylinder | a system or data store |
  | `io` | `id[/Label/]` | parallelogram | input or output |
  | `document` | `id@{ shape: doc, label: "Label" }` | wavy-bottomed page | a document (a quote, a PDF) |
  | `delay` | `id@{ shape: delay, label: "Label" }` | half-rounded rectangle | waiting |

  The first six take a quoted label too (`id["Label"]`, `id[/"Label"/]`, …) and an optional `:::className` suffix;
  an unquoted `io` label can't contain `/`. The last two use Mermaid 11.3's expanded-shape syntax, which Mermaid reads as YAML:
  exactly the keys `shape` and `label` in either order, **a space after each `:`** (without it Mermaid silently loses
  the shape and label, so here it is `E-shape`), other whitespace optional, the label always double-quoted, and the
  shape exactly `doc` or `delay`. Because the label is a YAML string there, a backslash in it is written `#92;`. Any other Mermaid shape (`((…))`, `{{…}}`, `>…]`, `[\…\]`, trapezoids, other `@{…}` shapes or aliases,
  other keys, or a class suffix on an `@{…}` node) is `E-shape`. (GitHub renders the `@{…}` shapes only if its
  Mermaid is 11.3 or newer; flowmap itself doesn't depend on that.)
- **Node ids**: `[A-Za-z_][A-Za-z0-9_-]*`, not ending in `-` and not containing `--` (so ids never collide with
  arrows). The ids `end`, `subgraph`, `graph`, `flowchart`,
  `direction`, `class`, `classDef`, `style`, `linkStyle`, `click`, `default` and `_unassigned`, and any id starting
  with `end-` or `end_` (Mermaid's parser trips on them), are `E-syntax`.
  A line that is only a bare id (`a`) is `E-syntax`: in flowmap a node joins a lane by being declared there.
  Below, an id is **reserved** if it is in that list or starts with `end-` or `end_`, and **taken** if it is used as a
  node or subgraph id in the `.mmd` or is a key under `nodes` or `notes` in the config or layout file (v1.1: notes).
- **Labels** (node and edge alike): unquoted labels can't contain brackets, braces, parentheses, `|` or `"`; they are
  trimmed and runs of whitespace collapse to one space. Quoted labels can contain anything except a raw `"` and are
  kept exactly. A double quote inside a label is written `#quot;` and a literal `#` before text that would read as
  an escape is written `#35;`; a backslash may be written `#92;`. Exactly these three escapes are decoded; any other
  `#…;` sequence is kept literally.
  Labels are a single line in v1. An empty edge label (`-->||`, `-- --> `) means no label.
- **Edges**: `a --> b`, `a -->|label| b`, `a -->|"label"| b`, `a -- label --> b`. Whitespace around arrows and labels
  is optional (`a-->b`, `a-->|x|b`). Chains (`a --> b --> c`) and `&` groups (`a --> b & c`, `a & b --> c & d`) expand
  to single edges, source-major, left to right (as Mermaid does): `a & b --> c & d` is `a->c`, `a->d`, `b->c`, `b->d`.
  A node may be declared inline in an edge (`a["X"] --> b{"Y"}`). Duplicate edges are kept, in file order.
  (A18) Three more arrows are accepted, each a *line style* (§3.1.1): `-.->` dashed, `==>` thick and `<-->`
  bidirectional. They take labels exactly as `-->` does (`a -.->|event| b`, `a -.->|"label"| b`, and the long forms
  `a -. label .-> b`, `a == label ==> b`, `a <-- label --> b`), and chain and `&`-group the same way; each arrow of a
  chain has its own style. Any other arrow (`---`, `-.-`, `===`, `--o`, `--x`, `<-.->`, `<==>`, `~~~` and so on) is
  `E-edge`. Stray characters after an accepted arrow (`-.->>`, `==>>`, `<-->>`, `-..->`, `===>`) are `E-edge`.
- **Comments**: lines starting with `%%`, including `%%{init: …}%%` directives.
- **Pass-through lines**: `classDef`, `class`, `style`, `linkStyle` and `click` lines are kept (see 3.3) but have no
  effect in the flowmap UI; styling comes from the config.
- **Ignored with a warning**: `direction` lines, inside a subgraph or at the top level (`W-direction`); they are
  dropped on the next write. The header sets the direction.
- Any other line that doesn't parse is `E-syntax`. Validation reports **every** error it finds, not just the first.

### 3.2 What a node's lane is

A node's lane is the subgraph in which it is first **declared with a shape** (standalone or inline in an edge). Edges
inside a subgraph block do not assign lanes to nodes declared elsewhere. (Mermaid itself puts a node in the first
subgraph that mentions it, even in an edge, so GitHub's rendering matches flowmap's only for canonical files, where
all edges come after the lanes.) A node declared outside any subgraph, or never declared (it appears only in edges:
its label is its id and its kind is `step`), has no lane: warning `W-no-lane` at its declaration line, or at its
first mention if it is never declared. (A5: a file with no subgraphs at all is a plain flowchart, and none of its
nodes gets `W-no-lane`.) Its lane is `_unassigned` everywhere a lane id appears (`match`, the layout
JSON, the inspector, `data-lane`), and the UI shows it in the "Unassigned" lane. Listing `_unassigned` in the config's
`lanes` is `W-config-unknown-lane`.

Declaring the same id again with the same shape, label and class is fine and has no effect. Declaring it again with a
different shape, label, class or lane is `E-duplicate`, reported at the later declaration.

### 3.3 Canonical form (what every write produces)

The UI and `flowmap fmt` always write canonical form, so both authors' diffs stay small and predictable. Hand-written
files may be non-canonical; they are normalised on the first write. `fmt(parse(x))` is idempotent: formatting a
canonical file changes nothing.

In order:

1. The header, normalised: `flowchart LR` or `flowchart TB`.
2. **The file comment**, at column 0 (see the comment rules below).
3. A blank line, then **nodes without a lane**, one per line, indented 2 spaces, in order of first declaration.
   Never-declared nodes are not written as declarations.
4. For each subgraph in file order: a blank line, `  subgraph <id> [<Label>]`, its nodes (indented 4 spaces) in order
   of first declaration, and `  end`. The lane label is written unquoted if every character is an ASCII letter,
   digit, space or one of `_ . , ' ? ! -`, it is not empty, it has no leading or trailing space and no two spaces
   in a row; otherwise it is quoted (`subgraph fin ["Finance & approvals"]`). A lane with no label in the input is
   written `[<id>]`.
5. A blank line, then **all edges**, indented 2 spaces, in file order after expansion, one edge per line:
   `a --> b`, or `a -->|label| b` when the label passes the same unquoted-character test, else `a -->|"label"| b`.
   (A18) The arrow is the edge's style's one spelling: `-->` solid, `-.->` dashed, `==>` thick, `<-->` bidirectional,
   with the label after it in the same `|…|` form (`a -.->|event| b`); the long label forms are rewritten to it.
6. If there are pass-through lines: a blank line, then those lines in original order, indented 2 spaces, with a
   trailing `;` removed and otherwise unchanged.
7. If there are trailing comments: a blank line, then those comments at column 0.
8. The file ends with exactly one newline.

A section with nothing in it is left out along with its blank line. There are never two blank lines in a row.

A node declaration is always written with a quoted label: `id["Label"]`, `id{"Label"}`, `id(["Label"])`,
`id[["Label"]]`, `id[("Label")]`, `id[/"Label"/]` (plus `:::className` if present), `id@{ shape: doc, label: "Label" }`
or `id@{ shape: delay, label: "Label" }` (keys in that order, one space after `{`, `:` and `,`, and before `}`). Labels are stored decoded (`#quot;` becomes `"`) and re-encoded on write; a label that
literally contains the text `#quot;` (or `#35;`, `#92;`) is written with its `#` as `#35;` so it round-trips. Inside
`@{…}` labels a backslash is written `#92;`; elsewhere it is written as is.

**Comment rules.**
- The **file comment** is any comment lines before the header plus the comment lines that follow the header with no
  blank line in between. The first blank line (or statement) ends it. It stays at the top, even though a statement
  may follow it.
- Otherwise a comment block is a run of comment lines; blank lines between them don't split it, and a blank line
  before the next statement doesn't detach it.
- A comment block after the last statement is **trailing**.
- Any other comment block attaches to the next kept statement and travels with it, even if that statement moves
  section (an edge written inside a subgraph block moves to the edge section with its comment). If the next line
  expands into several statements, the comment goes with the first edge it produces, or with the node declaration if
  it produces no edge. If the next line is dropped (a `direction` line, a repeated identical declaration), the comment
  goes with the next kept statement. A comment above `subgraph` stays above that subgraph line.
- A comment directly above `end` stays as the last line inside that subgraph, at node indentation (4 spaces). A
  declaration the UI appends to a lane goes after the lane's last declaration and before such a comment.
- A travelling comment is written at its statement's indentation (4 for a node inside a lane, 2 otherwise).
- A comment attached to a node or edge the UI deletes is deleted with it.

`fixtures/syntax/edge-cases.mmd` and `edge-cases.canonical.mmd` exercise many of these rules in one file.

### 3.1.1 Line styles (A18)

An edge has one of four styles, set only by its arrow: `solid` (`-->`, the default), `dashed` (`-.->`), `thick` (`==>`)
and `bidirectional` (`<-->`). The style is part of the `.mmd` and nowhere else: it is not in the config or the layout
file. It means *how the line is drawn*, never where: layout, routing, ports, label placement, bend points and sides
treat every style exactly like `-->` (§6), so changing a style never moves anything. An edge's id (§3.4) does not
depend on its style, so two edges between the same pair differing only in style are `a->b` and `a->b#2`. In the
`GraphEdge` the layout and renderer see, `style` is absent for `solid`.

- Mermaid renders all four natively, so GitHub's fallback view shows them (`linkStyle` pass-through lines still apply
  to edges by position, as before).
- `bidirectional` has the arrowhead at both ends and is still *directed* for layout: its source and target are the
  arrow's left and right side, so rank, back edges and ports are decided exactly as for `-->`.

### 3.4 Edge ids

Mermaid edges have no ids, so flowmap derives them: `<source>-><target>`, with `#2`, `#3`… appended to repeats of the
same pair, in file order. Edge ids appear in `flowmap layout` output and on UI edge elements.

## 4. The `.flow.yaml` config

```yaml
version: 1
title: Purchase request approval (current state)   # shown above the diagram and in exports
preset: cloud              # optional: a preset pack of icons and looks by kind (section 4.1)
lanes:                     # display order. Ids match subgraph ids; labels come from the .mmd.
  - id: requester          # lanes missing here are shown after these, in file order
  - id: manager
styles:                    # applied top to bottom; a later matching rule overrides earlier properties
  - legend: Confirmed by two or more people
    match: {confidence: confirmed}
    style: {border_style: solid, border_width: 2}
  - legend: One source only
    match: {confidence: single-source}
    style: {border_style: dashed}
  - legend: Waiting on someone
    match: {kind: wait}
    style: {fill: {light: "#fff2cc", dark: "#4a3f12"}, badge: wait}
  - legend: Open question
    match: {open_question: present}
    style: {border_color: {light: "#b85450", dark: "#f08080"}}
nodes:                     # metadata per node id; any keys; all are shown in the inspector
  n07:
    kind: wait             # overrides the kind derived from the shape
    system: email
    confidence: single-source
    source: [interview-09-11]
    quote: "freight is the long pole"
    open_question: Who chases the freight quote after two days?
```

- **Node fields available to `match`**: `id`, `lane` (the lane id), `label`, `kind`, and every metadata key. In a
  `match`, `kind` is the node's **effective kind**: the metadata `kind` if the config sets one (any string, such as
  `wait`), otherwise the shape kind (section 3.1). Everywhere else (layout JSON, SVG and DOM
  `data-kind`), `kind` means the shape kind.
- **Match semantics**: every key in `match` must hold (AND). Values compare as strings after YAML parsing (`2`
  matches `"2"`). If the node's field is a list, it matches when the list contains the value. The special values
  `present` and `absent` test whether the field exists. A rule with an empty `match` applies to every node. A match
  value must be a scalar; a list or map is `E-config`.
- **Style properties** (the complete v1 vocabulary): `fill`, `border_color`, `text_color` (a colour `#rgb` or
  `#rrggbb`, or `{light, dark}` for per-theme colours), `border_style` (`solid` | `dashed` | `dotted`),
  `border_width` (integer 1 to 4), `font_style` (`normal` | `italic` | `bold`), `badge` (short text shown as a tag on
  the node). An unknown property, or a known one with a bad value (`border_width: 5`, `border_style: wavy`, `red`),
  is warning `W-style` and that property is ignored.
- **Legend**: every rule with a `legend` text appears in the legend, in rule order, with a sample swatch of its
  style. Rules without one don't.
- **A block's own style** (v1.1): a node's metadata may hold a `style` map with the properties above. It applies
  after every rule, to that node only, and never appears in the legend. `style` is reserved:
  - it isn't evidence: the inspector shows it as the block's colours (UI35), not as a field row, and the field form
    refuses `style` as a key;
  - the node YAML editor (UI24) does include it;
  - every `match` condition on `style` (including `present` and `absent`) is false.

  Bad properties are `W-style` and ignored, as in rules.
- **A block's link to another diagram** (v1.1, amendment A15): a node's metadata may hold `link`, another diagram's
  path relative to the served root (the directory `flowmap serve` was given), without its `.mmd` extension, forward
  slashes only (`sales-stage-2`, or `sales/stage-2` for one in a subfolder). `link` is reserved like
  `style`, but stays matchable (unlike `style`):
  - it isn't shown as an evidence field row; the inspector has a dedicated "Links to" field (a picker of the
    diagrams the server lists) and the field form refuses `link` as a key;
  - the node YAML editor (UI24) does include it;
  - unlike `style`, a `match` condition on `link` (`present`, `absent`, or an exact value) works normally, so a style
    rule can mark linked blocks.

  A link whose target doesn't exist is warning `W-link-missing`; one with a `..` segment is `W-link-traversal`
  (error-free: the value is still stored, but the UI refuses to follow it and it can't escape the served root).
  Linking a block to its own diagram is allowed (no warning). How the UI and the SVG export use it is in amendment
  A15 (§12) and §7.1.
- **Notes** (v1.1): `notes` maps a note id to `{text, font_size?, bold?, color?}`: free text on the canvas that isn't
  part of the flow.
  - `text` is a non-empty string, not only whitespace, and may contain line breaks (it has no trailing line break).
  - `font_size` is an integer from 10 to 48 (default 14), `bold` a boolean (default false), and `color` a colour or
    `{light, dark}` (default: the theme's text colour). The UI writes a default value by removing its key.
  - A missing or bad `text` is `E-config`; a bad `font_size`, `bold` or `color` is `W-style`, and that property is
    ignored.
  - Note ids follow the node id rules (§3.1) and count as taken. A note id that equals a node or subgraph id is
    `E-config`. An emptied `notes` map is removed.
  - A note's position is in the layout file.
- **Title visibility** (v1.1): `show_title: false` hides the title in the UI and in exports. Absent means shown (the
  UI never writes `show_title: true`). With no `title`, the shown title is the file's base name, as before.
- **Top-level keys**: `version` (missing means 1; any other value is `E-config`), `title`, `show_title`, `preset`
  (amendment A20, section 4.1), `lanes`, `styles`, `nodes`, `notes`. An unknown top-level key, or an unknown key in a rule or lane entry, is warning `W-config-key`.
- **No config, or no `title`**: the title is the `.mmd` file's base name.
- Config entries for ids that are not in the `.mmd` are warning `W-config-unknown-node`; lanes listed that don't
  exist are `W-config-unknown-lane`. Deleting a block in the UI never deletes its config entry (it holds evidence);
  the orphaned entry warns until someone deletes it (UI27).
- **How the UI writes the config** (so every implementation writes the same thing):
  - If the file doesn't exist, the first operation that writes it creates it with `version: 1` followed by only the
    keys that operation sets. A top-level key that doesn't exist yet is appended at the end of the file.
  - Values typed into text inputs (field values, list items, map values, match values, legend, badge, title) are
    written as YAML strings, quoted when a plain scalar would read back as another type (`"2"`, `"true"`, `"null"`).
    Border width is written as an integer. Colours are written lowercase, as entered (`#rgb` or `#rrggbb`); a dark
    colour with no light colour is refused.
  - Empty means absent: clearing a legend, badge, title or style property removes that key. A rule's `match` and
    `style` are never removed; with nothing left they are `{}`. A new rule is `{match: {}, style: {}}`, appended at
    the end of `styles`. Removing a node's last field removes its entry; an emptied `nodes` is `nodes: {}`.
  - Renaming a node or lane id keeps the renamed key or entry in its place.
- Invalid YAML, or a wrong type for a known key (`lanes` not a list, `nodes` not a map, a node's entry not a map, a
  rule without `match` or `style`) is error `E-config` (line null).

### 4.1 Preset packs (amendment A20)

Architecture sketches read faster when a block shows what kind of component it is. A **preset pack** is a shareable set
of **kinds**, each with an icon, a look and a legend label. A diagram uses one by naming it, instead of redefining
the same style rules in every file.

```yaml
preset: cloud                  # a built-in pack, or a path to a pack file (below)
nodes:
  create: {kind: function}     # the block's metadata `kind` picks the pack's "function" kind
  orders: {kind: queue}
  db: {kind: database}
```

- **The reference.** `preset` is text. A value that contains a `/` or ends in `.yaml`, `.yml` or `.json` is a **pack
  file**: a path relative to the folder of the diagram's `.mmd`, written with forward slashes, never absolute (`..`
  may climb, but the file must stay inside the folder `flowmap serve` was given; a path that leaves it, also through a
  symlink, is unreadable, as is a file over 256 KB). Anything else is the name of a **built-in pack**. A `preset` that
  isn't text is `E-config`. Moving a diagram or renaming a folder does not rewrite a pack path (unlike `link`, A17); the
  broken reference shows as `W-preset-unknown` until it is fixed.
- **The built-in pack `cloud`** ("Cloud architecture") is provider-neutral: the kinds are generic roles and the icons
  are original line drawings, not any vendor's artwork. Kinds (aliases in brackets): `function` (`serverless`, `fn`),
  `service` (`container`, `compute`, `server`), `object-storage` (`bucket`, `blob-storage`, `storage`), `database`
  (`db`, `datastore`), `cache`, `queue` (`message-queue`), `topic` (`event-bus`, `pubsub`), `api-gateway` (`gateway`,
  `api`), `load-balancer` (`lb`), `cdn`, `external-service` (`external`, `saas`, `third-party`; dashed border), `user`
  (`actor`, `person`, `client`), `identity` (`auth`, `idp`), `scheduler` (`cron`, `timer`), `monitoring` (`metrics`,
  `observability`, `logs`). Each kind has a light and a dark fill and border.
- **A pack file** is YAML (so JSON works too):

  ```yaml
  version: 1                     # optional; any other value makes the pack unreadable (W-preset-invalid)
  name: Team pack                # optional display name
  kinds:
    job:
      label: Background job      # the legend text; a kind without one has no legend entry
      aliases: [cron-job]        # other values of `kind` that mean the same
      icon: queue                # a built-in icon name, or {paths: ["M4 4h16v16H4z", "M8 12h8"]}
      style: {fill: {light: "#fde7c8", dark: "#5a3a10"}}   # the style properties of section 4
  ```

  An icon is stroke-only line art on a 24 x 24 grid: a built-in icon name (the `cloud` kind ids above) or `paths`, 1
  to 12 SVG path strings of at most 600 characters each, which may hold only path commands, numbers and separators (a
  pack can't carry markup). A pack's `style` has the same properties and the same `W-style` handling as a rule's.
- **What a block gets.** Only the block's **metadata** `kind` selects a pack kind (an id or an alias; exact, case
  sensitive). The block's shape kind does not: a pack never restyles every `database`-shaped block. A matching block
  gets the kind's style, as the lowest layer: the diagram's rules, then the block's own `style` (section 4), override
  it property by property. It also gets the kind's icon: a round tag on the block's top edge towards the left (mirror
  image of the badge), drawn in the block's own fill and border, with the glyph in the block's text colour so it
  contrasts with the fill in either theme. The tag is decoration: it takes no room in the layout (the layout still
  ignores styles), and no clicks.
- **The legend.** For each pack kind that at least one block uses and that has a `label`, in pack order, there is a
  legend entry (the kind's look as the swatch, with the icon on it), placed before the legend entries of the diagram's
  own rules. A kind nobody uses has none.
- **Warnings** (never errors; the diagram is drawn without whatever couldn't be read):
  - `W-preset-unknown`: a built-in name that doesn't exist, or a pack file that doesn't exist, isn't a file, is too
    big, or is outside the served folder.
  - `W-preset-invalid`: a reference that is neither a name nor a relative path; a pack file that isn't valid YAML, isn't
    a map with a `kinds` map, or has another `version`; and, naming the kind, a kind or icon that is ignored (not a
    map, an unknown icon name, unsafe or too many `paths`, an unknown key, an alias already taken). Bad style
    properties in a pack are `W-style`.
  - `W-preset-kind`: a block's `kind` that the pack doesn't have (one warning per kind, naming its blocks), unless a
    style rule of the diagram matches on that same `kind` value, which marks it as the diagram's own.
- **Where the pack file is read.** `flowmap validate`, `layout` and `export` read it from beside the `.mmd` (a path
  given directly is trusted); `flowmap serve` reads it from beside the diagram inside the served folder, sends its text
  with the diagram (the browser reads no file itself and fetches nothing), and treats a change to it like a change to
  the diagram's own files for the live view (UI29), except that it doesn't clear undo history, since the editor holds
  no copy of it. A pack file is never written by the editor.
- **No config, no pack:** a config with `E-config` uses default styles (section 7), so it uses no pack either.

## 5. The `.layout.json` file

Everything a person placed or shaped by hand. Everything here is optional; a missing file means automatic layout.

```json
{
  "version": 1,
  "nodes": {
    "n07": { "lane": "finance", "along": 840, "across": 30, "width": 220, "height": 90 },
    "n08": { "width": 200, "height": 80 }
  },
  "edges": {
    "n07->n08": {
      "source_side": "bottom", "target_side": "left",
      "points": [{ "lane": "finance", "along": 900, "across": 140 }],
      "label_at": 0.3
    }
  },
  "notes": { "note1": { "x": 40, "y": -60 } },
  "title": { "x": 0, "y": -48 }
}
```

**Nodes.** An entry holds a **pin** (`lane`, `along`, `across`, all three or none), a **size** (`width`, `height`, both
or none), or both.
- A node with a pin is **pinned**. `along` is the node's top-left position on the flow axis (x for `LR`, y for `TB`)
  and `across` is the offset of its top-left corner from its lane's **zero line** (below). Pins are relative to the
  lane so that when a lane above grows, pinned nodes move with their lane instead of spilling into a neighbour.
- A size is the box a person chose by resizing (v1.1). The node's actual box is, per dimension, the larger of the
  stored size and what its label needs at that width (§6 L9, "needs"), so a longer label never overflows a resized
  box. Width and height are integers of at least 40.
- If `lane` no longer matches the node's lane in the `.mmd` (someone moved it in text), the pin is ignored and the
  node is placed automatically; its size still applies.

**Edges** (v1.1). Keyed by edge id (§3.4). An entry holds any of:
- `source_side`, `target_side`: `top`, `right`, `bottom` or `left`. The line leaves or enters the node at that side's
  **port** (§6 L12). A side that isn't set is chosen by the layout.
- `source_at`, `target_at` (amendment A22): where along its side that end is attached, as a fraction of the side's
  length from its start (the left end of a top or bottom side, the top end of a left or right side): a number from 0
  to 1 with at most two decimals. Absent means 0.5, the side's midline port, so a file without them lays out exactly as
  before; the UI never writes 0.5. Each is allowed only beside its own side (`source_at` needs `source_side`), and
  goes when that side goes.
- `points`: the line's **bend points**, in order from source to target, each `{lane, along, across}` in the same frame
  as a pin (`lane` may be `_unassigned`). A line with `points` is **manual**: it is drawn through its bend points
  (§6 L11) instead of being routed automatically, and its bend points stay where they are when blocks move. If any
  point's lane no longer exists, the points are ignored and the line is routed automatically. A bend point belongs to
  the lane whose band contains it (each band includes its start edge and excludes its end edge); a point beyond the
  last displayed lane belongs to that last lane, and one before the first lane belongs to the first.
- `label_at`: where along the drawn line the label's centre sits, as a fraction of the line's length from its first
  point to its last (the `points` of the layout JSON, §7): a number from 0 to 1 with at most two decimals.

**Spreading line ends** (amendment A22). `"spread_ends": true` (after `lane_length`) spreads the line ends that share a
side evenly along it instead of meeting at its port (§6 L12). Absent, or `false`, means off; the UI turns it off by
removing the key.

**Notes and title** (v1.1). `notes` maps a note id (§4) to its position `{x, y}`, and `title` is the title's position
`{x, y}`: the top-left corner in pixels, x horizontal and y vertical whatever the direction. They aren't lane-relative:
their zero is the diagram's top-left corner as it would be with no negative values, and they shift with the frame
(§6, "Frame"). A note without a position, and a title without one, are placed by §6.

**Values.** Every number is an integer, except `label_at`, `source_at` and `target_at`. `along` (of pins and bend
points), note and title positions may be **negative**, and so may `across` in the **first** displayed lane: a person can put anything anywhere, including
before the start of the flow axis or before the first lane, and the file stores exactly where it was put. In every
other lane `across` is at least 0: a block or bend point that would start before its lane's zero line is stored at 0
(it sits on the lane's start edge). Sizes are at least 40. An entry with no keys is never written: an operation that empties an entry
removes it, and an empty `edges` or `notes` map is left out. When nothing is placed the file is
`{"version": 1, "nodes": {}}`. The file may also hold a `hints` object in any shape the implementation chooses (for example,
last positions of unpinned nodes, to keep the layout stable between edits); the tests never read or write it, and it
is still an input to the layout function (L10). The UI rewrites this file; hand edits are allowed.

**Problems.** Entries for unknown ids are warnings `W-layout-unknown-node`, `W-layout-unknown-edge` and
`W-layout-unknown-note`. A file that isn't valid JSON, has keys other than the ones above plus `hints`, has an empty
entry, or has a value of the wrong type or range is error `E-layout` (line null); the diagram still lays out, with
none of the file's placements. (A22) So is a `source_at` or `target_at` outside 0 to 1, with more than two decimals,
or without its side, and a `spread_ends` that isn't `true` or `false`.

## 6. Layout rules

One layout function, used by both the CLI and the UI (a node's position in the UI at zoom 1 equals `flowmap layout`
output to the pixel). The algorithm is the implementation's choice (ELK's layered layout with lane partitions is a
starting point). ELK has no hard fixed-position constraint and its router doesn't route around nodes it didn't place,
so expect to write your own step that places unpinned nodes around pinned ones, and your own orthogonal edge router.
All coordinates and sizes are integers, and "box" means a node's bounding rectangle (also for diamonds and
stadiums). The result MUST satisfy:

- **L1 Lanes are bands**: horizontal bands stacked top to bottom for `LR`, vertical bands left to right for `TB`, in
  config order. Lanes span the full diagram on the flow axis. Every lane is at least 100 px across, including empty
  lanes.
- **L2 Containment**: every node's box lies wholly inside its lane's band, with at least 12 px of padding (a pinned
  node's padding may be less if its pin says so).
- **L3 No overlap**: no two node boxes overlap or come within 16 px of each other, except two pinned nodes, which
  are wherever their pins put them.
- **Frame** (v1.1): stored values may be negative (§5), and the lanes always start at 0 in the output. Only pins and
  bend points that are applied count (not orphans, ignored pins or ignored point sets).
  - On the flow axis, T = max(0, −(the smallest applied `along`)). T is added to every computed flow-axis position:
    pinned or automatic, nodes, lines, notes and the title.
  - On the across axis, the first lane's zero line lies U after its start edge, where U = max(0, −(the smallest applied
    `across` in the first lane)), so the first lane grows toward its start to hold what was put before it. Every other
    lane's zero line is its start edge. U is added to every computed across-axis position in the first lane, and to
    notes and the title.
  - A lane's label header stays at the start of its band and may be covered by what was put there.
  - With no negative values T = U = 0, exactly as in v1.0. Notes and the title may still sit at negative output
    coordinates (above or left of the lanes).
- **L4 Pins are exact**: a pinned node's box is at exactly its pinned position (`along` + T, the lane's zero line +
  `across`, with U included for the first lane). The lane grows across its axis to contain it. A node with a stored size has exactly its effective size
  (§5). Bend points are exact in the same way.
- **L5 Flow direction**: for every edge whose endpoints are both unpinned and not in the same cycle (the same
  strongly connected component), the target's box starts at or after the source's box starts, on the flow axis (left
  to right for `LR`). Loops may go backwards.
- **L6 Edges are orthogonal**: each edge is a polyline of horizontal and vertical segments, starting on the source
  box's boundary and ending on the target box's boundary (within 2 px), or at a port (L12).
- **L7 Edges avoid boxes**: no edge segment passes through the interior of a node box other than its own source and
  target. (Exempt: edges touching a pinned node that overlaps another pinned node, and manual edges, which go where
  their bend points say.)
- **L8 Labels at the source**: an edge's label position is within 60 px of the source box's boundary. (This is what
  makes a decision's yes/no readable.) With `label_at` set, the label's centre is instead at that fraction of the
  drawn line's length from the source, within 2 px.
- **L9 Node size fits the label**: a node is at least wide and tall enough that its label, wrapped, fits inside at the
  UI's font size, inside the text area of its shape (the inscribed area for a diamond, between the bars for a
  subprocess, and so on). (Checked in the UI, where the
  font is real: see U10.) What a label **needs** at a given width (v1.1, for resizing): the height of the label
  wrapped at that width's text area, plus the shape's insets. A block's narrowest width is the one at which its
  longest word still fits on a line, and never less than 40.
- **L10 Deterministic**: the same three files always produce the same layout.
- **L11 Manual lines** (v1.1): a manual edge is drawn as source port → each bend point in order → target port. A step
  between two points that aren't lined up gets one elbow: from a port, first move perpendicular to the port's side;
  into a port, arrive perpendicular to its side; between two bend points, move along the flow axis first
  (horizontally for `LR`, vertically for `TB`). The result is still orthogonal (L6), and every bend point lies on the
  drawn line.
- **L12 Ports** (v1.1): each side of a block has one port, on the side's midline (the vertical line through the box's
  centre for top and bottom, the horizontal line for left and right), where the block's drawn outline crosses that
  line: on the box edge for most shapes, and at most 20 px inside it for slanted and curved outlines (a
  parallelogram's left and right sides, a cylinder's top, a document's wavy bottom, round ends). Diamonds have their
  ports at their four vertices. An edge with `source_side` or `target_side` starts or ends at that port, within 2 px,
  whether it is manual or routed automatically.
  - (A22) **Offsets.** The port at fraction `f` along a side is on the line across the side `floor(f × length)` px from
    its start (computed in hundredths, so a two-decimal `f` lands on the same pixel everywhere; 0.5 is the midline),
    where the drawn outline crosses it: on the box edge for most shapes, inside it for slanted and curved outlines as
    above, and on a diamond's face (however deep) anywhere but its vertex. An end with `source_at` or `target_at` is
    at that port of its side, within 2 px, manual or automatic, whatever else shares the side.
  - (A22) **Spreading.** Without `spread_ends`, as in v1.1, ends with a set side and the ends of manual lines meet at
    their side's port, and only the layout's own automatic ends spread close around it. With `spread_ends`, the ends
    sharing a side that have no offset (set side or not, manual or automatic) are spread evenly along it: the i-th of
    n, counted from the side's start in the order of where their lines go (the other block's centre, or a manual line's
    nearest bend point, along the side; then file order), at fraction `round((i + 1) / (n + 1), 2)`, so three ends
    take 0.25, 0.5 and 0.75 and their lines don't cross on the way out. A side with a single attachment point (a
    diamond's vertex, a round end) isn't spread. An end with a stored offset keeps it and isn't counted.
  - **Why spreading is off by default.** Turning it on moves the ends of every line that shares a side in every
    existing diagram, including manual lines whose bend points were placed against the old ends, and adding one line
    later moves its neighbours' ends too (against the Stability goal below). Off by default, every existing file draws
    exactly as before (the golden layouts are unchanged); a diagram that needs it, such as a sequence-style exchange
    between two blocks, turns it on once, and stored offsets give exact control of any single end either way.
- **Notes and title** (v1.1) take no part in L1–L8: they may sit anywhere, over anything. Without a stored position,
  the title sits above the diagram's top-left corner and unplaced notes sit in a row below the diagram, in the
  config's order.
- **Stability** (a goal, judged by a person as H5): a small edit (a rename, one added node or edge, one drag) should
  not visibly reshuffle unrelated nodes. The `hints` object in the layout file exists for this.

## 7. Command line

The repository root has a `package.json` whose `bin` is `flowmap`. After `pnpm install && pnpm build`, the acceptance tests run
`pnpm exec flowmap <command>`. Paths are to the `.mmd` file; the config and layout files are found beside it by base
name.

| Command | Does | Exit code |
|---|---|---|
| `flowmap validate <file.mmd> [--json]` | Parses all three files and reports errors and warnings. `--json` prints `{"errors":[{"code","line","message"}],"warnings":[…]}` (`line` is the 1-based line in the `.mmd`, or null). | 0 if no errors, 1 if errors |
| `flowmap fmt <file.mmd> [--check] [--stdout]` | Rewrites the file in canonical form. `--check` writes nothing and exits 1 if it isn't canonical. `--stdout` prints instead of writing. | 0, or 1 on `--check` failure or errors |
| `flowmap layout <file.mmd> [--json]` | Prints the computed layout (schema below). | 0, 1 on errors |
| `flowmap export <file.mmd> --format svg\|png [--theme light\|dark] [--out <path>]` | Writes a picture of the diagram: title, lanes, nodes, edges, labels, legend. Default theme light, default path `exports/<name>.<format>` beside the `.mmd`. `svg` is required in v1; `png` from the CLI may use a headless browser. | 0, 1 on errors |
| `flowmap serve <dir> [--port 4870]` | Starts the UI for every `.mmd` in `<dir>`, recursively (A16: `<dir>`'s subfolders are diagrams' folders too), on `http://127.0.0.1:<port>` (loopback only). | runs until stopped |

Which errors stop which command: errors in the `.mmd` stop every command except `validate` (exit 1, no output).
`E-config` and `E-layout` stop only `validate`; `layout`, `export` and `serve` still work, with default styles or no
pins respectively, and print the problem to stderr. `fmt` reads only the `.mmd`, so config and layout problems don't
affect it.

Error and warning codes: `E-header`, `E-nested`, `E-unclosed`, `E-shape`, `E-edge`, `E-duplicate`, `E-syntax`,
`E-config`, `E-layout`; `W-no-lane`, `W-direction`, `W-style`, `W-config-key`, `W-config-unknown-node`,
`W-config-unknown-lane`, `W-layout-unknown-node`, and (v1.1) `W-layout-unknown-edge`, `W-layout-unknown-note`, and
(amendment A15) `W-link-missing`, `W-link-traversal`, and (amendment A20) `W-preset-unknown`, `W-preset-invalid`,
`W-preset-kind`. Every error found is reported. Line numbers are 1-based lines in
the `.mmd`; problems in the config or layout file have line null. Messages are free text; codes and lines are the
contract.

Layout JSON (all numbers in px, origin top-left, the same coordinates as the UI canvas at zoom 1):

```json
{
  "direction": "LR",
  "width": 2400, "height": 900,
  "lanes": [{"id": "requester", "label": "Requester", "x": 0, "y": 0, "width": 2400, "height": 180}],
  "nodes": [{"id": "n01", "lane": "requester", "kind": "terminal", "label": "Needs a part",
             "x": 40, "y": 50, "width": 160, "height": 60, "pinned": false}],
  "edges": [{"id": "n01->n02", "source": "n01", "target": "n02", "label": null,
             "points": [[200, 80], [260, 80]], "label_pos": null,
             "manual": false, "source_side": "right", "target_side": "left"},
            {"id": "n02->n03", "source": "n02", "target": "n03", "label": "event", "style": "dashed",
             "points": [[320, 80], [380, 80]], "label_pos": [350, 80],
             "manual": false, "source_side": "right", "target_side": "left"}],
  "notes": [{"id": "note1", "text": "Freight is the long pole", "x": 40, "y": -60, "width": 180, "height": 20}],
  "title": {"text": "Purchase request", "x": 0, "y": -48, "width": 210, "height": 24}
}
```

Nodes with no lane are in a lane with id `_unassigned` (label "Unassigned"), placed last. That lane exists only when at
least one node has no lane. `kind` is the shape kind. All numbers are integers. `label_pos` is the centre of the label,
or null when the edge has none. (v1.1) `manual` says whether the edge has bend points; `source_side` and
`target_side` are the sides actually used (stored or chosen by the layout). (A18) `style` is `"dashed"`, `"thick"` or
`"bidirectional"`, and is left out for a solid (`-->`) edge, so a diagram that uses only `-->` has the output it always
had; the points, sides and label position are the same as the layout gives the edge drawn as `-->`. (A22) `source_at` and `target_at` say
where along its side an end is attached, present only when the layout file asks for it: the stored offset, or with
`spread_ends` the end's spread position when that isn't 0.5. They are the only fractions in the output; without them
an end is at its side's midline port, or (an automatic end) spread on its side as v1.1 does. `notes` lists every note
with its box in diagram coordinates (x and y may be negative), in the config's order. `title` is the title's box, or null when the title is
hidden. `width` and `height` of the diagram cover the lanes; notes and the title may extend beyond them.

### 7.1 The SVG export (what the tests read)

The tests parse the SVG as XML. Layout and drawing are otherwise the implementation's choice.

- The title is a `<text data-role="title">`, left out when the title is hidden (v1.1). The picture includes the
  title and every note wherever they are placed.
- Each note (v1.1) is a `<g data-note-id="<id>">` holding its text, one `<text>` or `<tspan>` per line. Each `<text>`
  carries `font-size="<n>"` and `fill="#rrggbb"`, plus `font-weight="bold"` only when bold.
- Each lane is a `<g data-lane-id="<id>">` containing a `<text>` with the lane label.
- Each node is a `<g data-node-id="<id>" data-kind="<shape kind>">`. Its first shape child (`rect`, `polygon` or
  `path`) carries the style as presentation attributes: `fill`, `stroke`, `stroke-width`, and `stroke-dasharray`
  (absent or `none` for solid, `6 4` for dashed, `2 3` for dotted). Colours are lowercase `#rrggbb` (`#f96` is written
  `#ff9966`). Unstyled nodes use the theme's default colours. Italic and bold labels carry `font-style="italic"` or
  `font-weight="bold"` on their `<text>`, and (v1.1) every label `<text>` carries its colour as `fill="#rrggbb"`. A
  badge is a `<text data-role="badge">`. The node's full label, unwrapped,
  is also in a `<title>` child of the `<g>`. (Amendment A15) A node with a well-formed, non-traversing `link` has its
  `<g>` wrapped in `<a href="<target>.svg">`, so an exported set of diagrams stays clickable; PNG export has no such
  wrapping (it screenshots the SVG, and a flat image has no links either way).
- Each edge is a `<g data-edge-id="<id>">` with a `<path>` or `<polyline>`, and, if it has a label, a `<title>` with
  the label. (A18) A non-solid edge's `<g>` also has `data-edge-style="dashed|thick|bidirectional"` (absent for solid),
  and its line is drawn so: dashed has `stroke-dasharray="6 4"`; thick has `stroke-width="3"` (solid and dashed: `1.5`)
  and an arrowhead sized for it (its own `<marker id="arrowhead-thick">`, defined only when a thick edge exists);
  bidirectional has `marker-start` as well as `marker-end`, both `url(#arrowhead)`. A solid edge is drawn as before.
- The legend is a `<g data-testid="legend">` with one `<g data-testid="legend-item">` per rule that has legend text,
  in rule order. Each holds the legend text and a swatch shape styled with the same attributes as a node shape.
  (Amendment A20) The entries of a preset pack (section 4.1) come first; each one's swatch is followed by a
  `<g data-role="icon" data-icon="<name>">` holding the glyph.
- (Amendment A20) A node with a preset-pack icon has, after its shape, label and badge, a
  `<g data-role="icon" data-icon="<name>">` (`<name>` is the built-in icon's name, or `custom` for a pack's own
  `paths`) holding the round tag (two `<circle>`s) and the glyph: a `<g>` with `fill="none"`, `stroke="#rrggbb"` (the
  block's text colour) and one `<path>` per path string. The icons are drawn inline: the SVG, and the PNG made from it,
  refer to nothing outside themselves.

## 8. The UI

A single-page web app served by `flowmap serve`. Local only, one user at a time, no accounts.

### 8.1 Parity: the UI can do anything the files can

**Every change a person could make by editing the three files by hand, they can make in the UI**, and the UI writes
the same result the hand edit would have (for the `.mmd`, the hand edit after `fmt`; for the config and layout files,
the same parsed content, with untouched parts of the config byte-for-byte unchanged). The person should never need to
open a file.

Deliberately text-only (the UI keeps them intact but doesn't show or edit them):
- comments in the `.mmd`: the AI's working notes. A person's notes belong in node metadata, which the UI edits and
  the styles can use;
- `:::className` suffixes and pass-through lines (`classDef`, `style` and so on): they have no effect in flowmap;
- the layout file's `hints` object;
- the config's comments and formatting, and keys flowmap doesn't know (`W-config-key`), which the UI keeps;
- the order of declarations, edges and subgraphs in the `.mmd` (it has no visual meaning; lane display order is the
  config's `lanes`, which the UI edits);
- nodes that exist only in edges (every block the UI creates is declared; editing such a node's label in the UI
  declares it in the unlaned section);
- repairing a file that has errors (the error banner says where to look);
- (v1.1) a stored size smaller than the label needs (the UI's handles stop at the need), renaming a note's id,
  removing a note's stored position (it can be moved but not un-placed), and `label_at` on an edge with no label.

Section 10, Part 3 lists every operation and how parity is checked.

### 8.2 Requirements

Three rules apply to every operation below:
- **Order**: an operation on several blocks handles them in file declaration order (unlaned section first, then lanes
  in file order). New declarations, new ids, new config entries and moves happen in that order.
- **Files with errors**: an operation whose result would change a file that has errors is disabled until the file is
  fixed.
- **Undo** (UI28) of an operation that created a config or layout file deletes that file again.

**Viewing**

- **UI1 Open**: the home page lists the current folder's subfolders, then its diagrams; clicking a diagram opens it,
  clicking a folder browses into it. `/?file=<path>.mmd` opens a diagram directly (`<path>` may include folders,
  e.g. `sales/stage-2`); `/?dir=<path>` opens the home page browsing that folder (A16).
- **UI2 Render**: title, lanes (with labels), nodes drawn in their shape (the eight in section 3.1) and styled by the
  config rules, edges with arrowheads and labels, the legend. Positions are the layout function's.
- **UI3 Navigate**: pan (drag the background), zoom (wheel or pinch), fit to screen.
- **UI4 Themes**: dark and light. Follows the system setting by default; a toggle overrides it. Colours given as
  `{light, dark}` in the config use the matching value.
- **UI5 Speed**: opening a 100-node diagram renders in under 2 s on a recent Mac; dragging stays smooth.

**Blocks**

- **UI6 Add**: a palette with all eight shapes. Three ways to add: click a shape, then click inside a lane; select a
  lane (click its empty area), then click a shape; or drag a shape from the palette into a lane. The new block gets a
  unique id (the first of `n1`, `n2`, … that isn't taken) and a starting label: "New step", "New decision", "New start
  or end", "New subprocess", "New system", "New input or output", "New document" or "New wait". It opens straight
  into label editing. It is written as the last declaration of its lane (see the comment rules in 3.3). To add an unlaned block, add it
  to any lane and choose Unassigned in the inspector's lane select (UI11). Added
  by clicking, it is not pinned; added by dragging from the palette, it is pinned where it was dropped.
- **UI7 Change shape**: a selected block's shape can be changed to any of the eight. The declaration is rewritten in
  place: same position in the file, same id, label, lane and comment. (A class suffix is dropped when changing to
  `document` or `delay`, which can't carry one.)
- **UI8 Edit label**: double-click a block, or press Enter with one selected, to edit its label in place. Enter commits,
  Escape cancels. An empty block label is refused (the old label stays).
- **UI9 Rename id**: from the inspector. The new id must follow the id rules and be neither reserved nor taken
  (section 3.1), or it is refused with a message. Every reference changes with it: the declaration, the edges, the config `nodes` key, the layout `nodes`
  key, and any style rule that matches on `id` with the old value (v1.1: and the layout file's edge entries, see
  "Keeping the layout file in step").
- **UI10 Move and pin**: dragging a block moves it smoothly and pins it where it's dropped (saved within 1 s). Shift-
  click adds or removes a block from the selection; Shift-drag on the background draws a selection box; Cmd/Ctrl+A
  selects everything. Dragging any selected block moves the whole selection together, and each moved block is pinned. (v1.1) A selection
  holds blocks and lines, as in v1.0; the selection box and Cmd/Ctrl+A select blocks only; a note or the title is
  selected on its own.
  Arrow keys nudge the selection by 10 px (pinning it). On every drop the UI snaps (UI39, v1.1; nudges don't snap), then
  rounds the top-left corner to whole pixels (halves toward −∞), and saves it as it is, negative values included
  where §5 allows them (UI43). Edges
  re-route to satisfy L6 and L7 when the
  drag ends (live re-routing during the drag is nice but not required).
- **UI11 Move across lanes**: a block dropped with its centre in a different lane moves to that lane: its declaration,
  with any comment attached to it, is appended as the last declaration of that subgraph (or of the unlaned section,
  for Unassigned), and its pin records the new lane. A block can also be moved by choosing its lane in the
  inspector's lane select, which always includes Unassigned (the only way to reach it when no block is unlaned and
  the Unassigned lane isn't showing); moved this way, its pin is dropped.
- **UI12 Unpin**: selected blocks can be unpinned (back to automatic placement). "Re-layout all" clears every pin
  and every line's bend points after a confirmation, keeping sizes, sides, label positions, notes, the title position
  and `hints` (v1.1; see "Keeping the layout file in step").
- **UI13 Duplicate**: Cmd/Ctrl+D or the duplicate button copies each selected block: a new id (as in UI6), the same
  shape, label, class and lane, and a copy of its config metadata under the new id. Each copy is declared as the last
  declaration of its lane, in order (see the Order rule). Edges aren't copied. Each copy is
  pinned 24 px along and 24 px across from its original's position, keeps its original's stored size (v1.1), and
  becomes the new selection.
- **UI14 Delete**: Delete, Backspace or the delete button removes the selected blocks and edges. Deleting a block
  deletes its edges, its pin, and any comments attached to the deleted statements, but never its config metadata
  (see UI27).

**Lines**

- **UI15 Connect**: drag from one of a block's connection handles to another block (v1.1: see UI38 for sides), or use
  the click path (select the source, press connect, click the target) so it works without precise dragging. New edges
  are appended at the end of the edge section.
- **UI16 Reconnect**: select an edge and drag either end onto another block. The edge keeps its place in the file, its
  label and its comment; its id follows its new endpoints.
- **UI17 Edge label**: double-click an edge to edit its label. Enter commits, Escape cancels, and an empty label removes
  the label.
- **UI44 Line style** (A18): while one or more lines are selected and no block is, the line style picker
  (`data-testid="edge-style-picker"`, a bar docked like the shape picker, UI7) offers the four styles as buttons
  `data-edge-style="solid|dashed|thick|bidirectional"`; the style every selected line has is pressed
  (`aria-pressed="true"`), none when they differ. Choosing one rewrites the arrow of every selected line whose style
  differs, as one undo step; choosing the style they already have writes nothing. The same four options are in the line
  context menu's `line-style` item (UI40). A line just made by connecting (UI15) is selected, so the picker is where a
  new line gets its style; connecting itself always makes a solid line. Changing a style keeps the line's id, place in
  the file, label, comment, sides, bend points and `label_at`; reconnecting (UI16), editing the label (UI17), moving
  blocks and re-keying (§8.2) keep it too. Copy, cut, paste and duplicate (A12) carry it, and the Mermaid copied to the
  system clipboard uses the arrows. The drawn line follows the style (dashed stroke, wider stroke, a head at each end
  for `bidirectional`), in the SVG export exactly as §7.1 says.

**Lanes**

- **UI18 Add lane**: the add-lane button asks for a label. The id is the label lowercased, with each run of characters
  other than `a-z` and `0-9` turned into one `-` and leading or trailing `-` removed; `lane-` is put in front if the
  result is empty, starts with a digit, or is reserved (section 3.1); `-2`, `-3`… are added until it isn't taken. The subgraph is appended
  after the last one, and to the config `lanes` list if the config has one.
- **UI19 Rename lane**: double-click a lane header to edit its label (rewrites the subgraph label). The lane menu can
  also rename its id (refused, with a message, if the new id breaks the id rules or is reserved or taken), which
  changes every reference: the subgraph, the config `lanes` entry, the `lane` of every pin
  and (v1.1) bend point, and any style rule that matches on `lane` with the old value.
- **UI20 Reorder lanes**: drag a lane header, or use Move up / Move down in the lane menu. This writes the config
  `lanes` list with every lane in the `.mmd`, in the new order (creating the config file or list if needed). Existing
  entries keep any extra keys; entries for lanes that don't exist are dropped; Unassigned is never listed and always
  shows last. The order of subgraphs in the `.mmd` doesn't change.
- **UI21 Delete lane**: an empty lane is removed (the subgraph and its config `lanes` entry) straight away. A lane with
  blocks asks first: move its blocks to another lane or to Unassigned (each appended to its new lane with its attached
  comments, pins dropped), or delete them along with the lane (as in UI14). Comments above the lane's `subgraph` line
  and above its `end` are deleted with it.

**Diagram**

- **UI22 Title**: double-click the title to edit it. This writes the config `title`, creating the config file if
  needed.
- **UI23 Direction**: a toggle between left-to-right and top-to-bottom. It rewrites the header; pins keep their `along`
  and `across` values, and (v1.1) so do sizes, bend points and `label_at`. Sides rotate with the diagram (`right` ↔
  `bottom`, `left` ↔ `top`), and note and title positions swap x and y, so everything keeps its place relative to the
  flow. (A22) Offsets along sides and `spread_ends` stay as they are: a side's start rotates with it (the top of a
  right side becomes the left of a bottom side).

**Evidence and styles**

- **UI24 Inspector**: selecting a single block shows its id, lane, shape, label and every metadata field. Fields can be
  added (key and value), edited and deleted. A value is text, a list of text, or a map of text to text; any value can
  also be edited as raw YAML (the only way to write deeper structures). For a key that any style rule matches on, the
  value editor offers the values those rules match, plus values the key has on other nodes, as one-click choices. The
  block's whole metadata entry can also be edited as YAML (empty YAML removes the entry; YAML that isn't a map is
  refused with a message). With several blocks selected, the inspector shows the field form, which sets a field on
  all of them, and can remove a named field from all of them.
- **UI25 Styles panel**: shows the rules in order, each with its legend text and a swatch. Rules can be added, deleted
  and moved up or down; each rule's legend text, match conditions (field; equals a value, present, or absent) and
  style properties can be edited with suitable controls: colour pickers with separate light and dark values,
  dropdowns for border style and font style, a number for border width, text for the badge. A colour whose dark value
  is empty or equal to its light value is written as a single colour. The whole `styles` list can also be edited as
  YAML (YAML that isn't a list of rules is refused with a message). Unknown properties are kept. Changes restyle the
  canvas at once. (Amendment A20) Above the rules, a "Preset pack" field sets the config's `preset` (section 4.1): a
  text input for a built-in name or a pack file path (commits on Enter or blur), a Clear button, one chip per built-in
  pack, and, while a pack is in use, its name. Each change is one undoable operation; the field is off while the config
  has errors (UI26).
- **UI26 Config writes keep the file intact**: comments, key order and formatting of every part not edited survive
  byte-for-byte. New node entries are appended at the end of `nodes`, new fields at the end of their entry. If the
  config on disk has errors, config editing is off (the diagram stays editable) until the file is fixed.
- **UI27 Orphans**: config `nodes` entries for ids not in the `.mmd` (`W-config-unknown-node`), config `lanes`
  entries for lanes that don't exist (`W-config-unknown-lane`), and layout entries for nodes, edges and notes that
  don't exist (`W-layout-unknown-node`, `W-layout-unknown-edge`, `W-layout-unknown-note`, v1.1) appear in the warnings
  list, each with a button that deletes that entry.

**Safety and sync**

- **UI28 Undo and redo**: every UI edit, to any of the three files, can be undone and redone with Cmd/Ctrl+Z and
  Shift+Cmd/Ctrl+Z or the toolbar buttons. Undo restores all three files byte-for-byte to how they were before that
  edit; one drag of several blocks is one step. An external change to any of the diagram's files clears the history,
  so undo can never overwrite the AI's edits, and the UI says so.
- **UI29 Live reload**: when any of the three files changes on disk from outside the UI, the view updates within 1 s,
  keeps the current pan and zoom, and keeps the selection for ids that still exist. The UI's own writes don't cause a
  visible reload.
- **UI30 Autosave**: every edit is written within 1 s. A save indicator shows saved, saving or error. Writes are atomic
  (write to a temp file, then rename). If a file is changed on disk while the UI has an unsaved edit, the disk wins,
  and the UI says its edit was dropped.
- **UI31 Errors are safe**: if a file on disk has errors, the UI shows them (code, line, message) in the error banner
  and never overwrites a file it couldn't parse. With `.mmd` errors the diagram is read-only until the file is fixed.
  With only `E-config` it draws with default styles, the diagram stays editable, and config editing is off. With only
  `E-layout` it draws unpinned, and dragging and pinning are off until the file is fixed. (v1.1) Put generally: every
  operation whose result would change a file with errors is off. With `E-layout` that includes connecting by a handle
  (it writes a side), resizing, shaping lines, dragging labels, notes and the title, and adding a note (the click-path
  connect and everything else that writes only the `.mmd` or config still work). With `E-config`, notes and
  `show_title` can't be read, so notes aren't drawn, the title is shown, and `W-layout-unknown-note` isn't reported
  (every note would look orphaned).
- **UI32 Export**: buttons for SVG and PNG. The server writes `exports/<name>.svg|png` beside the `.mmd` and the UI
  shows the path. The export matches the CLI's: title, lanes, nodes, edges, legend, light theme by default.
- **UI33 Keyboard**: Delete/Backspace deletes; Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z undo and redo; Cmd/Ctrl+D duplicates;
  Cmd/Ctrl+A selects all; Enter edits the selected block's label; Escape cancels an edit or clears the selection;
  the arrow keys nudge; `?` shows the list of shortcuts. Shortcuts don't fire while typing in an editor.

**Shaping by hand** (v1.1)

- **UI34 Resize**: a selected block shows resize handles on its four corners and four sides. Dragging one resizes
  the block and writes its `width` and `height` (both, even if only one changed). The opposite edge or corner stays
  fixed; only the moved edge is rounded to a whole pixel. Dragging a top or left handle also moves the block, so it
  writes the pin too. (A6) Every resize pins the block at its top-left as drawn before the resize (moved by the
  handle for top and left handles), so an automatically placed block doesn't jump when it's resized. The handle stops at the block's narrowest width and at the
  height its label needs at the current width (§6 L9, "needs"). "Reset size" (context menu) removes the stored size.
- **UI35 Block colours**: a block's fill, border colour and text colour can be set from the inspector and from the
  block's context menu, with light and dark values like the styles panel, plus a row of preset swatches. A swatch
  sets only the fill, to its light and dark values (a single colour if the two are equal). This writes the node's
  `style` in the config (§4). "Reset colours" removes `fill`, `border_color` and `text_color` from it (and `style`
  itself if that leaves it empty); other style properties written by hand stay. With several blocks selected, the
  colours apply to all of them.
- **UI36 Line shapes**: a selected line shows a handle at the middle of each segment of its drawn line and one at each
  bend point. Segments are counted on the drawn line after merging (a zero-length segment is dropped, and two
  segments in a straight row are one).
  - **Becoming manual.** The first shaping edit on an automatic line first stores, as its `points`, every corner of
    its drawn line except the two ends (the layout JSON's `points` without the first and last). It also stores the
    sides the line uses, and (A22) the offsets the layout JSON reports for its ends (`source_at`, `target_at`), so
    redrawing through L11 and L12 gives exactly the same line. If an end of the automatic line isn't at its side's
    port (at that offset, when there is one), that end is stored as a bend point too.
  - **Segment drag.** Dragging a segment's handle slides that segment sideways, perpendicular to itself, like
    draw.io: both of its end corners move by the same amount. An end of the segment that is attached to a port can't
    move, so the drag first adds a stub: a corner 20 px out from that port along the segment. A segment attached to
    ports at both ends gets a stub at each. The drag then writes every corner of the resulting line except its two
    ends.
  - **Bend drag.** Dragging a bend point's handle moves that point.
  - **Tidy.** After every drag, the moved points and their neighbours (a port counts as a neighbour) are checked: a
    point in a straight row with both neighbours, or on top of one, is removed. Other points are left alone. If no
    points remain, `points` is removed and the line is automatic again (its sides stay).
  - **Context menu.** "Add bend point" inserts a point at the spot on the line nearest the click, in path order, and
    it is kept even if it lies in a straight row. "Remove bend point" (on a bend point) removes it. "Reset line"
    removes the line's `points` and both sides, so it is routed automatically again.
  - Dragging a line's end still reconnects it (UI16). While dragging, the preview is drawn the way the final line
    will be: orthogonal, not a curve.
- **UI37 Line labels**: a line's label can be dragged along its line. On release, the label's centre is projected
  onto the nearest point of the drawn line and written as `label_at` (§5), rounded to two decimals. "Reset label
  position" in the context menu removes it. On an edge with no label, `label_at` is kept but has no effect.
- **UI38 Connection sides**: every block has four connection handles, one per side, in the order top, right, bottom,
  left. Dragging from one starts a line that leaves the block from that side, and the line's `source_side` is
  written.
  - While a line is being connected or reconnected, the block under the pointer shows its four connection points
    and highlights the nearest one. Dropping on a connection point attaches the line there and writes `target_side`
    (or `source_side`, when reconnecting a source end). Dropping elsewhere on the block leaves that side to the
    layout.
  - Dropping a line's end on another connection point of the block it is already attached to only changes that
    end's side: the id, `points` and `label_at` stay.
  - The preview line is drawn orthogonally, bending the way the final line will. The click path in UI15 sets no
    sides. Diamonds connect at their four vertices.
  - (A22) **Along a side.** The four ports come first: a drop within the snap distance (12 screen px) of one attaches
    there, as above. Otherwise a drop right at a side's outline (within 6 screen px of it, and never more than 15% of
    the block's smaller side inside it, so the block's body is still "elsewhere on the block") attaches to that side at
    the point the pointer is level with, which snaps to 0.25, 0.5 or 0.75 of the side when within 8 screen px of one (Alt held turns
    this snapping off, as in UI39) and is otherwise rounded to two decimals; it writes the side and, unless it is 0.5,
    the offset (`target_at`, or `source_at` when reconnecting a source end). So dragging a line's end along the side
    it is on moves it along that side (UI38's same-block rule: only that end's side and offset change). While
    dragging, the snap points other than the ports show as small ticks, and a marker shows where a drop along a side
    would attach. Any drop that sets a side without an offset removes the end's old offset.
- **UI39 Snap and guides**: while dragging blocks, bend points, notes or the title, the dragged item snaps when its
  centre line or one of its edges comes within 6 screen pixels of the same kind of line on a target that isn't being
  dragged: centre to centre, left edge to left edge, top to top, and so on, horizontally and vertically on their own.
  Targets are the other blocks; for a bend point, also the other bend points and the two ports of its own line; for a
  note, also the other notes. A centre line is `x + floor(width / 2)` (and likewise for y).
  - With several items dragged, the one under the pointer decides the snap and the rest move with it.
  - When two targets are equally close, centre lines win over edges, then the left or top edge over the right or
    bottom one, then the smaller coordinate.
  - A guide line (`snap-guide`) shows across the canvas while snapped, and the stored position is the snapped one.
  - Holding Alt (Option) while dragging turns snapping off.
- **UI40 Context menus**: a right-click, or a two-finger click on a trackpad, opens a small menu on what was clicked.
  With several blocks selected and one of them clicked, block items apply to all of them where that makes sense
  (colours, duplicate, unpin, reset size, delete); the others are left out. Escape, or a click elsewhere, closes the
  menu. The items, their `data-menu-item` names, and when each shows:

  | On | Item (`data-menu-item`) | Shows when |
  |---|---|---|
  | block | `edit-label`, `rename-id`, `shape`, `colors`, `duplicate`, `delete` | always (`edit-label`, `rename-id` and `shape` for one block only) |
  | block | `unpin` / `reset-size` / `reset-colors` | the block is pinned / has a stored size / has a `style` with colours |
  | line | `edit-label` (reads "Add label" when there is none), `delete` | always |
  | line | `add-bend` | the click wasn't on a bend point |
  | line | `remove-bend` | the click was on a bend point |
  | line | `reset-line` / `reset-label` | the line is manual or has a side / has `label_at` |
  | line | `line-style` (A18) | always; opens the four style options, each `data-edge-style`, the current one `aria-checked="true"` |
  | note | `edit-note`, `font-size`, `bold`, `color`, `delete` | always |
  | title | `edit-title`, `hide-title` | always |
  | title | `reset-position` | the title has a stored position |
  | canvas | `add-note`, `add-<shape kind>` for each of the eight shapes | always |
  | canvas | `show-title` | the title is hidden |
  | canvas | `spread-ends` (A22: "Spread line ends", ticked while on; toggles `spread_ends`) | always |

  `shape` opens `data-shape` options, `colors` and `color` open colour inputs (`data-prop`, `data-variant`), and
  `font-size` opens a number input (`data-prop="font_size"`), all inside the menu. `add-<shape kind>` adds the block
  with its top-left corner at the clicked spot, pinned there, in the lane its centre falls in by UI43's rules.
  Each item otherwise does exactly what its requirement says.
- **UI41 Notes**: free text anywhere on the canvas, for annotations that aren't part of the flow.
  - Add one from the toolbar (`add-note`, at the centre of the view) or the canvas context menu (at the clicked
    spot). It opens straight into its editor. Nothing is written until the first commit, which writes the note (the
    first free id of `note1`, `note2`…, not taken, §3.1), its text and its position as one step; Escape, or
    committing blank text, adds nothing.
  - In the editor, Enter adds a line, and Cmd/Ctrl+Enter or clicking away commits. The text is written as typed,
    without trailing line breaks. Committing blank text in an existing note deletes it.
  - Drag a note to move it (writes its position; snapping applies). Double-click to edit, press Delete to remove it.
    Its context menu sets the font size, bold and colour.
  - A note is its `notes` entry in the config (text and style) plus its position in the layout file.
- **UI42 Title**: the title can be dragged like a note (writes the layout file's `title` position). Its context menu can
  hide it (writes `show_title: false` in the config) and reset its position (removes `title` from the layout file).
  A hidden title comes back from the canvas context menu (`show-title`, which removes `show_title`). Double-clicking,
  or `edit-title`, edits it as in UI22.
- **UI43 Anywhere**: a block, bend point, note or title can be dropped anywhere, including left of or above
  everything else. The file stores exactly where it was dropped, negative values included (§5); the layout's frame
  (§6) keeps the output starting at 0, and the UI pans by the change so that nothing else moves on screen.
  - The block's centre decides its lane, as in UI11. A block whose centre is before the start of the flow axis stays
    in the lane its centre is across from (a negative `along`).
  - In a diagram with lanes, a block whose centre is before the first lane joins the first lane (a negative
    `across`), and one whose centre is after the last lane moves to Unassigned (A4).
  - In a lane-free diagram, before the lane's start is a negative `across` in `_unassigned`.
  - Only the first lane can grow toward its start (§5), so the promise that nothing else moves on screen holds for
    every drop. A block dropped across the start edge of a later lane is stored at `across` 0 and lands on that edge.

**Keeping the layout file in step** (v1.1). Every UI operation that changes the list of edges re-keys every edge
entry by its edge's new id (matching edges by their position in the file, so a reconnect that creates or breaks a
duplicate pair keeps entries on the right lines). In the same write:
- deleting an edge deletes its entry;
- renaming a node renames its node entry and the keys of its edges' entries;
- reconnecting an end to another block removes the entry's `points` and the moved end's side, with its offset (A22)
  (the other side and its offset, and `label_at` stay);
- deleting a node deletes its entry and its edges' entries;
- renaming a lane renames `lane` in pins and bend points;
- deleting a lane in any way removes the `points` of every line with a bend point in that lane, and the pins of
  blocks that move out of it;
- duplicating a block (UI13) copies its size as well;
- "Re-layout all" (UI12) removes every pin and every line's `points`, and keeps sizes, sides (with their offsets, A22),
  `label_at`, `spread_ends`, notes and the title position;
- when an operation leaves no block in Unassigned, so that its lane disappears, every bend point in `_unassigned` is
  re-expressed in the last remaining lane at the same on-screen position;
- any entry these leave empty is removed (§5).

The AI's text edits can shift edge ids too (for example by deleting a duplicate). The layout file is not re-keyed
then; that is the text author's job, and `W-layout-unknown-edge` shows any entry left behind.

### 8.3 Test contract (DOM attributes the acceptance tests use)

The acceptance tests drive the UI with Playwright through these attributes only. Styling, layout of the panels and
structure are otherwise the implementation's choice. Every control below must be reachable by a click (menus may need
opening first, through the listed opener).

| Element | Attributes |
|---|---|
| Home page | `data-testid="diagram-list"`, one link per diagram with `data-file="<path>.mmd"` (root-relative, folders included, A16); `data-testid="folder-list"`, one link per subfolder with `data-testid="folder-link"` and `data-folder="<path>"`; `data-testid="breadcrumbs"` holding one `data-testid="breadcrumb"` per segment (root included) with `data-dir="<path>"`; `data-testid="new-folder"` opens `new-folder-input`; each diagram and folder row has an opener (`data-testid="diagram-menu"`/`"folder-menu"`, `data-row-target="<path>"`) for a small popover of `data-menu-item`-style buttons: a diagram's are `data-testid="diagram-move-to"` and `diagram-delete` (A10), a folder's `folder-rename` and `folder-delete`, each carrying `data-diagram-file="<path>"`; renaming a folder shows `data-testid="folder-rename-input"`; "Move to…" opens `data-testid="move-to-dialog"` with `data-testid="move-to-crumb"` (`data-dir`) breadcrumbs, `data-testid="move-to-folder"` (`data-folder`) subfolder buttons to descend, and a `move-to-here` button that moves the diagram into the folder currently shown |
| Canvas container | `data-testid="canvas"`, `data-theme="light\|dark"` (the theme in effect), `data-direction="LR\|TB"` |
| Title | `data-testid="title"` (text); double-click opens `data-testid="title-editor"` |
| Lane | `data-lane-id="<id>"`, `data-selected="true\|false"`; its header is `data-lane-header="<id>"` (double-click to edit the label in `label-editor`); inside the header, `data-testid="lane-menu"` opens a menu with `lane-rename-id` (opens the id editor), `lane-up`, `lane-down`, `lane-delete` |
| Lane delete dialog | `data-testid="lane-delete-dialog"` with a `data-testid="lane-target"` select (lane ids and `_unassigned`) and buttons `lane-move-blocks`, `lane-delete-blocks`, `confirm-no` |
| Node | `data-node-id="<id>"`, `data-kind="<shape kind>"`, `data-lane="<lane id>"`, `data-pinned="true\|false"`, `data-selected="true\|false"`, `data-x`, `data-y`, `data-width`, `data-height` (integer layout coordinates at zoom 1, as in `flowmap layout`); the label text is in a child with `data-role="label"` |
| Node connection handle | `data-handle="source"` inside the node element (v1.1: four of them, see "Node (v1.1)"; there is no `data-handle="target"` in v1.1) |
| Edge | `data-edge-id="<id>"`, `data-source`, `data-target`, `data-selected`, (A18) `data-edge-style="solid\|dashed\|thick\|bidirectional"`; the label text is inside the element; when selected, its ends are `data-edge-end="source\|target"` |
| Palette | `data-testid="palette"`, one button per shape with `data-shape="<shape kind>"` (click, or drag onto a lane) |
| Shape picker | `data-testid="shape-picker"` (shown when one block is selected), one option per shape with `data-shape` |
| Toolbar | `data-testid` = `connect`, `duplicate`, `delete`, `unpin`, `relayout-all`, `add-lane`, `direction-toggle`, `undo`, `redo`, `styles-toggle`, `fit`, `export-svg`, `export-png`, `theme-toggle` |
| Label editor | `data-testid="label-editor"` (Enter commits, Escape cancels); the add-lane prompt uses it too |
| Id editor | `data-testid="id-editor"` (Enter commits); a refusal shows `data-testid="id-error"` |
| Inspector | `data-testid="inspector"`. Built-in fields are `data-field="id"`, `lane` (the lane id), `kind` (shape kind) and `label`; metadata fields are `data-field="meta.<key>"`, whose text is the value (a scalar as its YAML string, a list joined with `, `, a map as compact JSON). `data-testid="id-edit"` opens the id editor; `data-testid="lane-select"` is a select of lane ids plus `_unassigned`. With several blocks selected the inspector has `data-count="<n>"` and shows only the field form and `field-remove-all` (removes the field named in `field-key` from every selected block). Each metadata field contains `field-edit` and `field-delete` buttons. `add-field` opens the field form |
| Field form | `data-testid="field-key"` (input), `field-type` (select: `text`, `list`, `map`, `yaml`), `field-value` (textarea: text as is; a list as one item per line; a map as one `key: value` per line, split at the first `: `; YAML as is), `field-save`; suggested values are `data-testid="field-suggestion"` buttons whose text is the value |
| Node YAML | `data-testid="node-yaml"` (textarea with the selected block's metadata entry) and `node-yaml-apply`; a refusal shows `data-testid="yaml-error"` (also used by `styles-yaml`) |
| Styles panel | `data-testid="styles"` (opened by `styles-toggle`) with `rule-add`, `styles-yaml` (textarea with the whole `styles` list) and `styles-yaml-apply`. Each rule, in order, is `data-testid="style-rule"`, containing `rule-legend` (input), `rule-up`, `rule-down`, `rule-delete`, `match-add`, and its conditions as `data-testid="match-row"`, each with `match-field` (input), `match-op` (select: `equals`, `present`, `absent`), `match-value` (input) and `match-delete`. Each style property is a control with `data-prop="<property>"`; a colour property holds two text inputs, `data-variant="light"` and `data-variant="dark"`, that accept `#rrggbb` or `#rgb`; an empty input clears the property. Every select has an empty option and every number input may be emptied; empty clears the property |
| Legend | `data-testid="legend"`, one `data-testid="legend-item"` child per rule that has legend text, in rule order (amendment A20: the preset pack's entries first; an entry with an icon also has `data-icon="<name>"`) |
| Preset pack (amendment A20) | on a node, `data-testid="node-icon"` with `data-icon="<name>"` (an inline `<svg>` holding the tag and the glyph's `<path>`s), present only when the block has an icon; in the Styles panel, `data-testid="preset-field"` holding `preset-input` (commits on Enter or blur), `preset-clear`, `preset-suggestion` (one per built-in pack) and, while a pack is in use, `preset-using` ("Using <name>") |
| Save indicator | `data-testid="save-status"` with text `saved`, `saving` or `error` |
| Error banner | `data-testid="errors"`, one child per problem with `data-code="<code>"`; a child for any orphan code in UI27 contains an `orphan-delete` button |
| Confirmation dialog | `data-testid="confirm"` with buttons `confirm-yes` and `confirm-no` |
| Export result | `data-testid="export-path"` with the written path as text |
| Notices | `data-testid="edit-dropped"` (UI30), `data-testid="history-cleared"` (UI28) |
| Shortcut list | `data-testid="shortcuts"` (shown by `?`) |
| Node (v1.1) | also `data-sized="true\|false"` (has a stored size); four connection handles `data-handle="source"` each with `data-port="top\|right\|bottom\|left"`, in that DOM order; when selected, resize handles `data-resize="n\|ne\|e\|se\|s\|sw\|w\|nw"`; while a line is being connected or reconnected over it, connection points `data-port-target="<side>"` (A22: plus the snap ticks `data-port-tick="<side>"` with `data-at="0.25\|0.75"`, and, when a drop would attach along a side off its port, `data-port-drop` with `data-side` and `data-at`); (amendment A15) a node with a `link` also has a `data-testid="link-badge"` child with `data-link-target="<target>"` |
| Edge (v1.1) | also `data-manual="true\|false"` and `data-points` (the drawn line as integer diagram coordinates, `x1,y1 x2,y2 …`, equal to the layout JSON's `points`); its label is a child with `data-role="edge-label"` (draggable); when selected, one handle per segment of the merged drawn line `data-segment="<i>"` (UI36) and one per bend point `data-bend="<i>"` (0-based, from the source) |
| Line style (A18) | `data-testid="edge-style-picker"` (UI44), one button per style with `data-edge-style`, `aria-pressed`; the line context menu's `data-menu-item="line-style"` holds the same four `data-edge-style` options with `aria-checked` |
| Snap guide (v1.1) | `data-testid="snap-guide"`, present while a snap is active during a drag |
| Context menu (v1.1) | `data-testid="context-menu"`, items `data-menu-item="<name>"` exactly as in UI40's table; the `shape`, colour and font-size controls render inside the menu element |
| Block colours (v1.1) | in the inspector: `data-testid="block-colors"` holding `data-prop="fill\|border_color\|text_color"` controls with `data-variant="light\|dark"` inputs, preset swatches `data-testid="swatch"` with `data-color="#rrggbb"` (light) and `data-color-dark="#rrggbb"`, and `block-colors-reset` |
| Links (amendment A15) | in the inspector: `data-testid="link-field"` holding `data-testid="link-input"` (the target, commits on Enter or blur), `link-clear`, `link-suggestion` (one per diagram offered) and, once set, `link-open`; a refusal shows `data-testid="link-error"`. The block context menu's `data-menu-item="link"` ("Link to diagram…") opens the same input, suggestions and `link-clear` inside the menu. |
| Notes (v1.1) | each note `data-note-id="<id>"` with integer `data-x`, `data-y` (diagram coordinates, as in the layout JSON) and its text inside; toolbar button `add-note`; editor `data-testid="note-editor"` (a textarea) |
| Title (v1.1) | `data-testid="title"` also carries integer `data-x` and `data-y`, and can be dragged |

## 9. Stack and structure

- **TypeScript** throughout, **pnpm**, Node 22. **React** with **@xyflow/react** (React Flow) for the canvas,
  **elkjs** for layout, **yaml** for the config, **Vite** for the UI build, **Vitest** for unit tests, **Playwright**
  for UI tests. Other libraries are the implementation's choice; say why in the README.
- **Suggested structure**: `src/core` (parse, canonical format, validate, config, styles, layout, SVG rendering; pure
  functions with no DOM or file system), `src/cli`, `src/server` (static UI, file read/write, file watching, a small
  JSON API plus a push channel such as server-sent events or a WebSocket), `src/ui`. The rule that matters: **the CLI
  and the UI share one core**, so a layout or parse fix lands everywhere at once.
- Config writes must keep untouched parts of the file byte-identical (UI26). (Amendment A1: the `yaml` package's
  `toString()` does not do this; edit the text minimally instead.)
- Works offline after install. No telemetry, no cloud calls. The server binds to 127.0.0.1 only.
- `pnpm test` runs the project's own tests. A README says how to install, run, and use it.

## 10. Acceptance criteria

🤖 = checkable from outside, through the CLI and DOM contracts alone (without reading the source).
🧑 = checked by a person.

**Part 1: core and CLI**

| # | Criterion | Check |
|---|---|---|
| C1 | `fmt` turns each `fixtures/syntax/*.mmd` (other than the canonical files) into exactly its `.canonical.mmd` | 🤖 |
| C2 | `fmt` is idempotent and preserves meaning on every fixture and on generated random diagrams (same nodes, lanes, labels, kinds, edges, edge labels, comments) | 🤖 |
| C3 | `validate` reports the right code and line for each error case in section 3 and for each warning, and exits non-zero only on errors | 🤖 |
| C4 | Style rules: `match` semantics and override order as in section 4, read from the SVG attributes in section 7.1 | 🤖 |
| C5 | Layout invariants L1–L8 and L10 hold on every fixture, on generated diagrams of 10 to 150 nodes, and with pins added | 🤖 |
| C6 | `export --format svg` writes an SVG (section 7.1) containing the title, every lane label, every node label and edge label (in their `<title>` elements), and every legend text | 🤖 |
| C7 | `fmt` and `layout` on a 150-node diagram each finish in under 2 s | 🤖 |

**Part 2: UI**

| # | Criterion | Check |
|---|---|---|
| U1 | Viewing (UI1–UI5): the diagram opens; every node, lane and edge in the files is present with the right attributes; all eight shapes render; the theme toggle switches `data-theme` | 🤖 |
| U2 | Blocks (UI6–UI14): add each shape all three ways, change shape, edit label, rename id (including refusals), move and pin (single, multi-select, nudge), move across lanes, unpin, re-layout all, duplicate, delete | 🤖 |
| U3 | Lines (UI15–UI17): connect both ways, reconnect either end, set and clear a label | 🤖 |
| U4 | Lanes and diagram (UI18–UI23): add, rename label and id, reorder, delete (empty, move blocks, delete blocks), title, direction | 🤖 |
| U5 | Evidence and styles (UI24–UI27): every field type through the field form, suggestions offered, node YAML, multi-block field edit, every rule operation and property through the styles panel, styles YAML, orphan delete, and untouched config bytes preserved | 🤖 |
| U6 | Undo and redo (UI28): after each operation in Part 3, undo restores all three files byte-for-byte and redo re-applies it; an external change clears the history and shows the notice | 🤖 |
| U7 | Sync and safety (UI29–UI31): an external edit to each file shows within 1 s without resetting the view; the save indicator works; a broken file shows its errors and is never overwritten; `E-config` leaves the diagram editable | 🤖 |
| U8 | Export and keyboard (UI32, UI33): both exports are written; every listed shortcut works and none fires inside an editor | 🤖 |
| U9 | Node positions in the UI (`data-x` and so on) equal `flowmap layout` output | 🤖 |
| U10 | L9: every node's `data-role="label"` element's on-screen box lies inside the node element's box | 🤖 |
| U11 (v1.1) | Resize (UI34): every handle; the minimum size holds; top and left handles move the pin; reset size | 🤖 |
| U12 (v1.1) | Block colours (UI35): from the inspector, the swatches and the context menu; multi-select; reset; the SVG export shows them | 🤖 |
| U13 (v1.1) | Lines (UI36–UI38): segment drag, bend drag, add, remove and reset; label drag and reset; connect from each side; drop on a connection point; UI and `flowmap layout` agree on the drawn path | 🤖 |
| U14 (v1.1) | Snap (UI39) and context menus (UI40): a drag that ends within 6 px of alignment stores the aligned position and shows `snap-guide`; Alt disables it; every menu item on every target does what its requirement says | 🤖 |
| U15 (v1.1) | Notes and title (UI41, UI42): add, edit, move, style, delete; hide, show, move and reset the title; the SVG export includes them | 🤖 |
| U17 (A18) | Line styles (UI44): `-.->`, `==>` and `<-->` round-trip through `validate`, `fmt`, `layout --json` and `export` canonically; the editor draws each, and the picker and context menu change a line's style (one or several lines, undo, redo) and set one on a line just connected; the router treats them like `-->` | 🤖 |
| U16 (v1.1) | Anywhere (UI43): drops left of and above everything store the dropped position (negative values included), the lane rules for "above" and "left" hold, every other block keeps its on-screen position, and the lanes in `flowmap layout` still start at 0 | 🤖 |

**Part 3: parity (section 8.1)**

(v1.1) Drag tests written for v1.0 hold Alt so snapping (UI39) can't change their result, and P5 connects through the
click path (UI15), which writes no sides. Connecting by a handle is P25.

For each operation below, the suite makes the change twice, starting from the same files: once through the UI, once
by editing a copy of the files by hand (then `flowmap fmt` on the `.mmd`). It then compares: the `.mmd` byte for byte,
the config as parsed YAML with every untouched line byte-identical, and the layout file as parsed JSON (ignoring
`hints`).

| # | Operation | Check |
|---|---|---|
| P1 | Add a block of each of the eight shapes, in a lane and in Unassigned | 🤖 |
| P2 | Change a block's shape, for every pair of shapes | 🤖 |
| P3 | Edit a block's label, including one with `"` and `#` in it | 🤖 |
| P4 | Rename a block's id (with edges, metadata, a pin and a style rule that matches it) | 🤖 |
| P5 | Connect two blocks; add a duplicate edge | 🤖 |
| P6 | Reconnect an edge's source; reconnect its target | 🤖 |
| P7 | Set, change and clear an edge label | 🤖 |
| P8 | Delete a block (with edges, attached comments and a pin); delete an edge | 🤖 |
| P9 | Move a block to another lane and to Unassigned | 🤖 |
| P10 | Pin by drag, pin by nudge, unpin, re-layout all | 🤖 |
| P11 | Duplicate a block with metadata | 🤖 |
| P12 | Add a lane; rename its label; rename its id; reorder lanes; delete an empty lane; delete a lane moving its blocks; delete a lane with its blocks | 🤖 |
| P13 | Set the title (with and without an existing config file) | 🤖 |
| P14 | Flip the direction both ways | 🤖 |
| P15 | Add, edit and delete a metadata field of each type (text, list, map, YAML); set a field on several blocks at once | 🤖 |
| P16 | Replace a block's metadata through node YAML | 🤖 |
| P17 | Add, edit (legend, each condition type, each property, light and dark colours), reorder and delete a style rule | 🤖 |
| P18 | Replace the styles list through styles YAML | 🤖 |
| P19 | Delete each kind of orphan: a node entry, a lane entry, a pin | 🤖 |
| P20 | Undo then redo each of P1–P19 | 🤖 |
| P21 (v1.1) | Resize a block from a corner and from its top-left; reset its size | 🤖 |
| P22 (v1.1) | Set a block's fill, border and text colour (light and dark); set colours on several blocks; reset | 🤖 |
| P23 (v1.1) | Bend a line by dragging a segment; move a bend point; add and remove a bend point; reset the line | 🤖 |
| P24 (v1.1) | Drag a line's label; reset its position | 🤖 |
| P25 (v1.1) | Connect from each side of a step and each vertex of a diamond; drop on a target's connection point; reconnect an end of a manual line | 🤖 |
| P26 (v1.1) | Add, edit, move, restyle and delete a note | 🤖 |
| P27 (v1.1) | Move the title; hide it; show it; reset its position | 🤖 |
| P28 (v1.1) | Edits that keep the layout file in step (§8.2): delete one of three duplicate edges that have entries; rename a node with a sized, pinned entry and shaped lines; delete a lane that holds a bend point; re-layout all | 🤖 |
| P29 (v1.1) | Drop a block, a bend point and a note left of and above everything (negative values) | 🤖 |
| P30 (v1.1) | Undo then redo each of P21–P29 | 🤖 |
| P31 (A18) | Style a new line, an old line and several lines at once (picker and context menu); undo then redo each | 🤖 |

**Human judgment**

| # | Criterion | Check |
|---|---|---|
| H1 | It feels fast and fluid: dragging, zooming, editing | 🧑 |
| H2 | A fresh 10-step, 3-lane map can be made from scratch in the UI in under 5 minutes without reading docs | 🧑 |
| H3 | The rendered process map is clean: nothing overlaps, yes/no labels sit at their diamonds, the evidence styling reads at a glance | 🧑 |
| H4 | Nothing was ever lost or corrupted during a real session of editing alongside the AI | 🧑 |
| H5 | Small edits (a rename, an added step, one drag, an AI text edit) don't visibly reshuffle unrelated boxes | 🧑 |
| H6 | Marking evidence on a step and adding a style rule feel natural through the inspector and styles panel, without touching YAML | 🧑 |
| H7 (v1.1) | Shaping lines, resizing and connecting from a chosen side feel like a good flowchart tool (draw.io, Lucidchart) | 🧑 |
| H8 (v1.1) | Snapping helps rather than fights; context menus have what you reach for | 🧑 |

**Done** means Parts 1, 2 and 3 all pass and the H-criteria are acceptable to Dan.

## 11. Not in v1.1

Real-time multi-user editing; accounts; cloud anything; showing or editing `.mmd` comments, class suffixes or
pass-through lines in the UI (section 8.1); multiple pages per diagram with off-page connectors (stretch); comments on
the canvas (stretch); a generated open-questions list (stretch); draw.io export (stretch); nested lanes; Mermaid
features outside the subset in section 3; curved lines; line colours; line styles beyond the four of A18 (dotted, combinations such as dashed and bidirectional, other arrowheads); grouping several blocks into
one; rotating blocks.

## 12. Amendments

Changes to this contract after it is frozen are logged here, dated, with the reason, and are announced to every build
in flight.

| Date | Change | Why |
|---|---|---|
| 2026-09-24 | **v1.1 (Dan).** Shaping by hand: UI34–UI43, the extended layout file (§5: sizes, edge sides, bend points, `label_at`, note and title positions, negative values and the frame), block `style`, `notes` and `show_title` in the config (§4), L4/L7/L8 extended and L11/L12 added (§6), the layout JSON and SVG additions (§7, §7.1), the DOM rows marked (v1.1) in §8.3, and U11–U16, P21–P30, H7–H8 (§10). R5.9's strictness now applies to the §5 key list. See `CHANGES-v1.1.md`. | Feedback from real use: resize, colours, bent lines, sides, snap, context menus, notes, a movable title. |
| 2026-09-24 | **A1.** Section 9's note that the `yaml` Document API keeps untouched lines byte-identical is withdrawn. UI26 is unchanged. | `toString()` re-pads flow maps and collapses spacing (found independently by the implementation and the acceptance tests); ruling R2. |
| 2026-09-24 | **A2.** The build must make `pnpm exec flowmap` work from its root (section 7). | pnpm 9 doesn't expose a package's own `bin`; ruling R1. |
| 2026-09-24 | **A3.** UI18: an empty slug gives the id `lane`. | `lane-` broke the id rules; ruling R3. |
| 2026-09-24 | **A4. Diagrams without lanes (Dan).** (a) A `.mmd` with no subgraphs is a plain flowchart. Its layout is unchanged in the JSON (every node is in `_unassigned`), but the UI and the SVG export draw no lane band or lane header for it. The `_unassigned` lane element keeps its `data-lane-id` in the DOM, without a `data-lane-header`, and no space is reserved for a lane label. (b) UI6: in a diagram with no lanes, clicking a palette shape adds the block right away (unlaned, not pinned); dragging a shape from the palette onto the canvas adds it pinned where it was dropped. (c) UI11: in a diagram with lanes, a block dropped with its centre outside every lane moves to Unassigned, keeping a pin at the drop position. (v1.1 narrows this: a centre before the first lane joins the first lane; see UI43.) (d) UI1: the home page's new-diagram action offers "Flowchart" (no lanes) or "Swimlanes"; that choice is a UI convenience and writes nothing beyond a valid `.mmd`. | Dan wants generic flowcharts too, not only swimlane maps. |
| 2026-09-24 | **A5.** A `.mmd` with no subgraphs gives no `W-no-lane` warnings (§3.2). | In a plain flowchart every block would warn, which is noise; the warning still points at real problems in diagrams with lanes. |
| 2026-09-24 | **A6.** UI34: every resize pins the block (not only top and left handles). | Implementation found that resizing an automatically placed block from its right or bottom edge let the layout re-centre it on release, a visible jump by about half the size change. |
| 2026-09-30 | **A7. Renaming Unassigned (Dan).** UI19: the Unassigned lane can be renamed: double-click its header, or Rename in its lane menu (Unassigned now has one, with only Rename and, A8, Reset size). Renaming it promotes it to a real lane: a subgraph with that label and the id UI18 derives from it, appended after the last subgraph, holding every unlaned block in file declaration order with its attached comments (a node that exists only in edges is declared there, as R6.5 does). Every pin and bend point in `_unassigned` (applied or not), its lane size (A8) and every style rule matching `lane: _unassigned` take the new id. The lane is appended to the config `lanes` list if that list names every lane; a list that leaves lanes out is left alone, since the new lane must show where Unassigned did (last). Nothing moves on screen, and Unassigned no longer shows. Refused when no block is unlaned. A lane that is only renamed (UI19 or A7) and was displayed first is still first: R12 doesn't apply to it. | Adding a lane to a flowchart left its blocks in a lane that couldn't be named. |
| 2026-09-30 | **A8. Lane sizes (Dan).** §5: the layout file may hold `"lanes": {"<lane id>": {"size": <n>}}` (after `nodes`; `_unassigned` allowed): a lane's size across the flow, measured from its zero line (§6 Frame: the band's thickness less U in the first lane), an integer of at least 100. A missing, empty or wrong value, an empty entry or another key is `E-layout`; an empty map is left out. L1: a lane's band is at least its stored size (plus U in the first lane): max(stored, what its content needs). UI: each lane with a band (Unassigned included) has a handle on its far edge across the flow (bottom for `LR`, right for `TB`, `data-lane-resize="<id>"`). Dragging it writes the size; it stops at what the content needs, and reaching that removes the entry. Double-clicking the handle, or "Reset size" in the lane menu (`lane-reset-size`, shown when there is a size), removes it. Renaming a lane (UI19, A7) re-keys its entry in place; deleting a lane removes it; UI23 and UI12 keep sizes; R12 adds U to the old first lane's size; any operation drops entries for lanes that don't show after it (no warning). | Lanes could only ever be as big as their blocks, leaving no room to lay out a crowded lane by hand. |
| 2026-09-30 | **A9. Dismissible warnings (Dan).** Each warning row in the error banner (§8.3 `data-testid="errors"`, one child per problem with `data-code`) gets a `data-testid="dismiss-warning"` button; a `data-testid="dismiss-all-warnings"` button in the banner's summary line dismisses every warning currently shown. Errors (`E-*`) never get a dismiss control and are never hidden. A dismissal is keyed by the warning's code and message, not its line, and remembered per diagram (by file name) in `localStorage` (degrading quietly if storage is unavailable). Whenever the diagram's active warnings change, remembered dismissals are pruned to the warnings still present, so fixing a cause forgets its dismissal and a reintroduced warning shows again. | Warnings stayed on screen with no way to acknowledge them. |
| 2026-09-30 | **A10. Deleting a diagram (Dan).** The home page's list gets a delete control per row (hover/focus-revealed, keyboard reachable, `data-testid="diagram-delete"`) that asks "Delete `<name>`? It moves to `.flowmap-trash` in this folder." with Cancel/Delete. `DELETE /api/diagram?file=<name>.mmd` (name validated like every other route) moves the diagram's `.mmd`, `.flow.yaml` and `.layout.json` (whichever exist) into `.flowmap-trash/<timestamp>-<name>/` inside the served directory rather than unlinking them; `exports/` is untouched and the trash folder is never listed. A diagram's `.mmd` disappearing while it's open (by this delete or by hand) shows the same "couldn't open" screen as a missing file on first load instead of crashing. | Diagrams could never be removed from the list; moving to a trash folder keeps a misclick recoverable, matching the app's "nothing is silently lost" posture (UI28–UI30). |
| 2026-09-30 | **A11. Multi-select gestures (Dan).** UI3/UI10: a drag that starts on the background or a lane's empty area draws a selection box and selects the blocks wholly inside it, replacing the selection; with Shift or Cmd/Ctrl held at the press it adds to it. A press that doesn't move is still a click (select the lane, clear the selection, place an armed shape); a Shift or Cmd/Ctrl click on empty canvas keeps the selection. Panning moves from dragging the background to Space+drag (from anywhere, blocks included) and middle-button drag; the wheel and pinch still zoom. Cmd-click (Ctrl-click on other systems; on a Mac Ctrl-click stays the context menu, UI40) adds or removes a block or line exactly like Shift-click. Cmd/Ctrl+A selects every block and no line, as UI10 (v1.1) says. Group drag, nudge and delete are unchanged (each block to the lane under its own centre, one undo step). With several blocks selected the inspector heading reads "N blocks selected" (`data-testid="selection-count"`); `data-count` and the field form are unchanged. The canvas has `data-space-pan="true"` while Space is held. | Box-select is the most common gesture in a drawing tool and was hidden behind Shift, while a plain drag panned. |
| 2026-09-30 | **A12. Copy, cut, paste; duplicate brings its lines (Dan).** Cmd/Ctrl+C copies the selected blocks (shape, label, class, lane, config `nodes` entry, stored size) and every line whose both ends are selected (label, sides, `label_at`, bend points). Cmd/Ctrl+X copies, then deletes as UI14. Cmd/Ctrl+V pastes as one undo step into this diagram or any other in the same browser (in-app clipboard: `localStorage` key `flowmap.clipboard`, checked on read, falling back to memory). Each block keeps its original id if free, or if the only thing holding it is a config entry equal to its own metadata (what a cut leaves, which it then reuses); otherwise it gets `<base>-2`, `<base>-3`… (base: the id less a trailing `-<n>`; the first that follows the id rules and is neither reserved nor taken, §3.1). It is declared last in its lane in file order, its metadata is appended under the new id, its size is kept, and it is pinned. With the pointer over the canvas, the group's top-left lands at the pointer and each block joins the lane under its centre (UI43, as a drop). Otherwise each block goes to its own lane if the diagram has one with that id (Unassigned always exists), else the first displayed lane, 40 px along and 40 px across from its original's lane-relative position; repeating the same paste without moving the pointer adds 40 px more each time. Lines are appended at the end of the edge section with label, sides and `label_at`. Bend points are kept only if every one lands in a lane that shows, else the line is routed automatically. An orphaned layout entry already under a pasted line's id is replaced (R11.4). Pasted blocks become the selection. A copy also writes canonical flowmap Mermaid (original ids, lanes as subgraphs) to the system clipboard. Copy, cut and paste never fire in an editor, and when they can't run (nothing selected, empty clipboard, text selected on the page) the browser's own copy and paste go ahead. Paste is refused when the layout file has errors, or when the config has errors and there is metadata to write; copy is refused when the config has errors and mentions a copied block. UI13 becomes paste-in-place: Cmd/Ctrl+D and the toolbar and menu `duplicate` also copy the lines between the duplicated blocks, ids follow the paste rule (`r01` → `r01-2`, not `n1`), copies are pinned 40 px along and across (was 24), and the clipboard is left alone; P11 is re-derived to match. | Reusing parts of a map within and across diagrams. One copy-and-paste model makes duplicate, copy and paste behave alike and keeps the evidence and line shaping with the blocks. |
| 2026-09-30 | **A13. Lane length (Dan).** §5: the layout file may hold `"lane_length": <n>` (after `lanes`): the lanes' shared length along the flow, measured from the flow axis's zero line (§6 Frame: the frame's flow-axis length less T), an integer of at least 100. A wrong value is `E-layout`; absent when not set. L1: the lanes span max(T + stored, what the content needs) along the flow; in a diagram without lanes (A4) it doesn't apply (no bands) but is kept. UI: one handle on the lanes' far end along the flow, spanning every lane (right edge for `LR`, bottom for `TB`, `data-lane-length-resize`), none in a diagram without lanes. Dragging it writes the length and shows the new end and the length (`data-lane-length-preview`); it stops at what the content needs, and reaching that removes the value. Double-clicking the handle, or "Reset length" in any lane's menu (`lane-reset-length`, shown when there is a length), removes it. UI23, UI12, lane renames (UI19, A7), reorders, R12 and deleting lanes (all of them included) keep it. | Lanes could only ever be as long as their content, leaving no room along the flow to spread a crowded end by hand; one value because every lane spans the same length. |
| 2026-09-30 | **A14. Trackpad-friendly navigation, and a controls legend (Dan).** UI3: a trackpad's two-finger scroll pans the canvas on both axes instead of zooming; a trackpad pinch, a mouse's scroll wheel, and Cmd/Ctrl+wheel (still, unconditionally) all zoom around the cursor; a mouse's Shift+wheel pans horizontally. Space+drag and the middle button still pan (A11). Which way one wheel event goes is a heuristic (`classifyWheel`, `src/ui/canvas/wheel-intent.ts`), since no browser API says "this is a trackpad": `ctrlKey`/`metaKey` always zoom; `deltaMode` 1 or 2 (lines/pages) or a legacy `wheelDeltaY` that is a clean multiple of 120 read as a mouse; a non-zero `deltaX` in pixel mode or a fractional `deltaY` read as a trackpad; a whole-pixel, vertical-only, otherwise-unmarked delta falls back to zoom, the original behaviour. Classification is sticky for 300 ms of one continuous, genuinely ambiguous tail (a trackpad's momentum decaying to a whole-pixel delta near the end of a scroll), but a modifier key or the "Scroll to" override below is read fresh on every event and is never held over. Safari reports a trackpad pinch as `gesturestart`/`gesturechange`/`gestureend` (`scale`) instead of Ctrl+wheel; both are handled, and while one of Safari's gesture events is in progress the wheel handler stands down so the same physical pinch isn't applied twice. A "Scroll to: Auto / Pan / Zoom" choice (`localStorage` key `flowmap.scroll-preference`, degrading quietly if storage is unavailable) overrides the heuristic; Cmd/Ctrl+wheel still always zooms regardless of it. A controls legend — a small chip (`data-testid="controls-legend-toggle"`) beside the `?` shortcut button, its panel `data-testid="controls-legend"` — lists Pan, Zoom, Select, Edit and View in a few lines each, verified against the real gesture and keyboard code rather than guessed, and holds the "Scroll to" control (`data-testid="scroll-preference"`); its open/closed state is remembered in `localStorage` (`flowmap.controls-legend-open`), collapsed by default. It is not modal and doesn't replace the existing `?` shortcut list, which still has the full keyboard reference. | A plain wheel-always-zooms canvas fights a trackpad's two-finger scroll, the way most people expect to pan; and the pan/zoom/select/edit gestures were only discoverable by opening the full shortcut list. |
| 2026-09-30 | **A15. A block can link to another diagram (Dan).** §4: a node's metadata may hold `link`, another diagram's path relative to the served root, without `.mmd`, forward slashes only (§4's new bullet has the full grammar and the two warning codes, `W-link-missing` and `W-link-traversal`, added to §7's code list). `link` is reserved like `style` (not a field row; the field form refuses it as a key) but, unlike `style`, stays a normal matchable field, so a style rule can mark linked blocks (`match: {link: present}`). Linking a block to its own diagram is allowed. **Following a link**: Cmd+click (Mac) / Ctrl+click (elsewhere) on a linked block follows it instead of extending the selection (the one exception to A11's Cmd/Ctrl-click-extends-selection rule: only on a block that has a link); a plain click always still selects. Every linked block also draws a small corner badge (`data-testid="link-badge"`, `data-link-target`, its title the target); a plain click on the badge alone follows the link regardless of the selection state. Following a link uses the app's own `?file=` navigation (not a hand-rolled route), so Back returns to the diagram it was followed from; the previous diagram's viewport (pan and zoom) is cached in `sessionStorage`, keyed by file name, the moment a link is followed, and consumed once when that diagram is next opened (by Back or otherwise) — cheap, and falling back to the normal fit when there's nothing cached. A traversing link (a `..` segment) is stored and warned but the UI refuses to follow it (a toast explains why); a link to a target that simply doesn't exist is still followed, landing on the same "couldn't open" screen a deleted diagram already shows. **Setting a link**: the inspector gets a "Links to" field (`data-testid="link-field"`, `link-input`, `link-clear`, `link-suggestion` per diagram the server lists — reusing `GET /api/diagrams`, the home page's own API — and `link-open` once set); the block context menu gets `link` ("Link to diagram…"), the same input and suggestions inside the menu. Typing accepts a pasted `.mmd` name or a backslash path, normalising both. **Validation**: `flowmap validate` checks a diagram's links against every `.mmd` under its own directory (recursively, skipping `.flowmap-trash` and `exports`) — the closest available stand-in for "the served root" at the single-file CLI, since `validate` takes no `--dir`; the UI checks against the diagram list it already fetched. **Export**: SVG wraps a linked block's `<g>` in `<a href="<target>.svg">` (§7.1); PNG is unaffected (it screenshots the SVG, and a flat raster has no links regardless). **Staying valid across a move or folder rename**: amendment A17 (§12), below. | "Hand-off" blocks in a set of stage diagrams (e.g. "Hand-off to 2 · Complete + save") should take you straight to the diagram they refer to, without leaving the editor or hunting through the home page. |
| 2026-09-30 | **A16. Folders on the home screen (Dan).** Folders are real subdirectories of the served root, so they work with git, the CLI and editors: a diagram's id/path is its root-relative path without extension (`sales/stage-2`), and `?file=` is that path plus `.mmd` (a bare `<name>.mmd` still works unchanged). **Server**: `isValidMmdName` (§8.2's traversal rejections) now accepts any number of folder segments; every segment (of a diagram's or a folder's path alike) is still checked for `..`, a leading slash and a backslash, and additionally rejected if it's a dot-folder, `node_modules` or `exports` (already special, UI32/A10, so never reachable as a browsable folder). Every path is further resolved through the served root with symlinks followed (`resolveInRoot`/`PathTraversalError` in `src/server/files.ts`) before any read, write, move, or create/rename/delete, rejecting one that lands outside it. `GET /api/diagrams` now lists every `.mmd` under the root recursively (root-relative paths, depth-limited, `MAX_FOLDER_DEPTH` = 12), skipping dot-folders (so `.flowmap-trash`, A10, is never listed or reachable through these routes), `node_modules` and `exports` (already special, UI32/A10) at any depth. `GET /api/folder?dir=<path>` lists one folder's immediate subfolders and diagrams only (so an empty subfolder still shows, unlike the recursive list); `POST`/`PUT`/`DELETE /api/folder` create, rename (keeping a folder in its parent) and delete (only when empty, else 409 with a message) a folder. `POST /api/diagram/move` `{file, to}` moves a diagram's `.mmd`/`.flow.yaml`/`.layout.json` (whichever exist) and any other file beside it sharing its base name (an extra export, say) into folder `to`, refusing a name collision at the destination; it is one server function (`moveDiagram`) precisely so a later change could rewrite `link:` node values (the cross-diagram link feature built alongside this one) that point at the diagram's old path — that change is amendment A17 (§12), below. **Home screen**: shows the current folder's subfolders, then its diagrams; a breadcrumb (root, then each segment) remembers the folder in `?dir=`, so Back works. "New folder" creates one in the current folder; a folder's own small menu (opener + popover, the same pattern UI6/A10's per-row control uses) offers Rename and Delete (refused, with a message, unless empty); a diagram's row menu adds "Move to…" (a small dialog: breadcrumbs and subfolders to browse to, "Move here") beside Delete (A10, now inside the same menu rather than its own button). Dragging a diagram row onto a folder row or a breadcrumb segment moves it there the same way. New diagrams (UI6) are created in the current folder. The editor shows the full path in its file name and its "back to list" (the home logo, UI1) returns to the diagram's own folder, not always the root; a diagram's `?file=` keeps working with or without a folder. | Diagrams needed real folders to organise a growing set of process maps (Sales-style client work spans many stages), while staying plain files a person could also browse in Finder or edit by hand. |
| 2026-10-03 | **A18. Dashed, thick and bidirectional edges (issue #1).** §3.1: three more arrows are accepted, each a line style (new §3.1.1): `-.->` dashed (async, event, optional), `==>` thick (critical path) and `<-->` bidirectional (a head at each end). Labels work as for `-->` (`-.->|event|`, `-.->|"x"|`, and the long forms `-. x .->`, `== x ==>`, `<-- x -->`), and chains and `&` groups give each arrow its own style. Every other arrow, including the combinations `<-.->` and `<==>`, `-.-` and `===`, is still `E-edge`. §3.3: canonical form writes the one spelling of each style, with the label in `|…|` form. The style lives only in the `.mmd` (not the config or layout file), does not change the edge id, and does not change layout or routing: L1–L12 treat every style like `-->`. §7: `flowmap layout --json` edges gain `style` (`dashed`, `thick` or `bidirectional`; absent for solid, so a diagram of only `-->` edges has byte-identical output); §7.1: a non-solid edge's `<g>` has `data-edge-style`, dashed is `stroke-dasharray="6 4"`, thick is `stroke-width="3"` with its own `arrowhead-thick` marker (defined only when used), bidirectional has `marker-start`. §8: UI44 (line style picker `edge-style-picker`, the line context menu's `line-style` item, `data-edge-style` on every UI edge element; copy, paste and duplicate carry the style), §8.3 rows, U17 and P31. §11: "line styles" narrows to styles beyond these four. `fixtures/errors/E-edge.mmd` uses `---` now (it used `-.->`), and `docs/rulings.md` ruling 7 is annotated. Golden SVGs for each form are in `tests/golden/edge-styles/`. | Architecture diagrams need to tell synchronous calls from async or event flows, mark a critical path and show two-way links, and every arrow other than `-->` was an error. |
| 2026-10-03 | **A20. Architecture preset packs (issue #3).** New section 4.1 and the top-level config key `preset`: a diagram names a preset pack, a built-in (`cloud`, a provider-neutral "Cloud architecture" pack of 15 kinds with original line icons) or a YAML pack file relative to the diagram (inside the served folder), and every block whose metadata `kind` the pack knows gets the kind's icon (a round tag on the block's top edge, `iconBox`, shared by the editor and the export) and its style as the lowest layer under the diagram's rules and the block's own `style`; the legend gets an entry for each pack kind in use, before the diagram's own. A pack kind is `{label?, aliases?, icon?, style?}`; an icon is a built-in icon name or up to 12 safe SVG path strings (no markup). Warnings `W-preset-unknown`, `W-preset-invalid`, `W-preset-kind` (§7); `E-config` for a `preset` that isn't text. SVG export (§7.1) draws `<g data-role="icon" data-icon>` per icon, in blocks and in legend swatches, inline, so exports and PNGs need no network. `flowmap serve` sends the pack file's text with the diagram (snapshot `presets`, version `preset`, which the watcher follows without clearing undo history), refuses paths outside the served folder, and the Styles panel gets a Preset pack field (UI25, §8.3). The layout is unchanged by icons (it ignores styles). Pack paths are not rewritten when a diagram moves (A17 covers `link:` only). | Architecture sketches read faster with recognisable component types, and per-diagram style rules repeat the same encoding in every file; a shareable pack keeps the encoding in one place. |
| 2026-10-03 | **A21. Distribution and CI.** §7: the `flowmap` command is also installed from npm as `@danhannah94/flowmap` (`npx @danhannah94/flowmap <command>`); the package ships the built CLI and UI only (`dist/`, `bin/`), and `pnpm exec flowmap` from a clone still works as before (A2). §7: when `export --format png` cannot find the Playwright headless Chromium it exits 1 with a one-line message giving the install command (`npx playwright@<version> install chromium-headless-shell`) instead of a stack trace, and `POST /api/export` answers 503 with the same message; SVG export is unaffected. GitHub Actions runs typecheck, the unit tests and the browser tests on every push to `main` and pull request, and a `v*` tag publishes to npm. | The tool could only be run from a clone, nothing checked a change before it merged, and a fresh clone failed the PNG export test with a raw Playwright error. |
| 2026-10-03 | **A22. More connection points per block side (issue #6).** **Offsets**: §5: an edge entry may hold `source_at` / `target_at` beside `source_side` / `target_side`: where along that side the end is attached, as a fraction of the side's length from its start (the left end of a top or bottom side, the top end of a left or right side), a number from 0 to 1 with at most two decimals; absent means 0.5, the midline port, so every existing file lays out exactly as before. An offset outside 0 to 1, with more than two decimals, or without its own side is `E-layout`. §6 L12: the port at fraction `f` is on the line across the side `floor(f × length)` px from its start (in hundredths, so every implementation lands on the same pixel), where the drawn outline crosses it (a diamond's face off its vertices); an end with an offset is there within 2 px, manual or automatic. §7: the layout JSON's edges report `source_at` / `target_at` only when the file asks for them (a stored offset, or a spread position other than 0.5), so the output of every existing file is unchanged. **Setting one**: UI38: while connecting or reconnecting, a drop right at a side's outline (within 6 screen px, at most 15% of the block's smaller side inside it), not only on its port, attaches at the point along the side the pointer is level with, snapped to 0.25, 0.5 and 0.75 within 8 screen px (Alt turns that off, as UI39), else rounded to two decimals; dragging a line's end along the side it is on is the same-block case, so only that end's side and offset change. The four ports still win within their 12 px snap distance and the block's body is still "elsewhere", so a v1.1 drop does what it did unless it lands right on the outline. While dragging, the snap points show as `data-port-tick="<side>"` (`data-at`) and the drop point as `data-port-drop` (`data-side`, `data-at`). 0.5 is never written. Removing a side removes its offset (reconnecting an end to another block, Reset line, a drop elsewhere on the block); Re-layout all, copy, paste, duplicate, renames and UI23 keep offsets (UI23: a side's start rotates with it, so the value stays). UI36: becoming manual stores the reported offsets with the sides, so an end at an offset counts as at its port (`endAtPort`) and doesn't turn into a bend point, and the line doesn't move. **Spreading**: §5: `"spread_ends": true` (after `lane_length`) spreads the ends that share a side and have no offset (set side or not, manual or automatic) evenly along it, the i-th of n at `round((i + 1) / (n + 1), 2)`, ordered from the side's start by where their lines go (the other block's centre, or a manual line's nearest bend point), so they don't cross; single-point sides (a diamond's vertex, round ends) aren't spread. Not `true` or `false` is `E-layout`. UI40: the canvas menu's `spread-ends` ("Spread line ends", ticked while on) toggles it, writing `true` or removing the key. **Off by default**, because turning it on moves the ends of every line sharing a side in every existing diagram, manual lines included, and makes one added line move its neighbours' ends (against H5's stability); a diagram that needs it turns it on once, and offsets give exact control of single ends either way. U13 and P25 include a drop along a side, dragging an end along its side and the toggle (`tests/ui/ports-a22.spec.ts`). | Several lines leaving or entering the same side all met at its one midline port and overlapped, so a sequence-style diagram (two blocks exchanging several numbered messages, as in an OAuth flow) couldn't be read; bend points couldn't help, since they still converged on the same port. |
