// Test helpers for the operations layer, written the way the acceptance suite checks parity (design.md §10 Part 3):
// apply an operation; separately apply the equivalent hand edit as an explicit text transformation (then `fmt` on the
// `.mmd`); compare the `.mmd` bytes, the config as parsed YAML with every untouched line byte-identical, and the
// layout file as parsed JSON.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { lineDiff } from '../config/testkit';
import { format, parse } from '../mmd';
import type { Files, OpResult } from './context';

const FIXTURE = join(import.meta.dirname, '../../../fixtures/purchase-request');
const read = (name: string) => readFileSync(join(FIXTURE, name), 'utf8');

/** The purchase-request fixture (canonical `.mmd`, a config, one pin). */
export const PR: Files = {
  mmd: read('purchase-request.mmd'),
  config: read('purchase-request.flow.yaml'),
  layout: read('purchase-request.layout.json'),
};

/**
 * A comment-rich, non-canonical variant: unlaned nodes, a never-declared node (`ghost`), a class suffix, comments on
 * every kind of statement, end-comments, an empty lane, pass-through lines, a duplicate edge, a trailing comment.
 */
export const RICH_MMD = `%% Rich variant of the purchase-request map for the ops tests.
flowchart LR
%% It has unlaned nodes, end-comments, pass-through lines, pins and a never-declared node.

%% an unlaned note
loose["Loose end"]
stray{"Stray question?"}:::hot

%% the requester's lane
subgraph requester [Requester]
  intake(["Needs a part"])
  %% the form is a spreadsheet
  r01["Fill the form"];
  %% end of requester
end

subgraph manager [Manager]
  m01["Review the request"]
  m02{"Approved?"}
  %% the manager decides
  m01 --> m02
end

subgraph finance ["Finance & approvals"]
  f01@{ shape: delay, label: "Wait for budget" }
  %% the invoice
  f02[/"Invoice #35;quot; copy"/]
end

subgraph empty [Empty lane]
  %% nothing here yet
end

intake --> r01
%% hand-off to the manager
r01 --> m01
m02 -->|yes| f01
m02 -- no --> r01
f01 --> f02 & ghost
r01 --> m01
loose --> stray
classDef hot fill:#f96;stroke:#333
class r01 hot
%% style the review
style m01 fill:#eee

%% trailing note
`;

/** Comments, odd spacing, an unknown key, a stale lane entry, rules matching `id` and `lane`, an orphan entry `n1`. */
export const RICH_CONFIG = `# Rich config for the ops tests (comments and odd spacing must survive)
version: 1
title:   Rich purchase map   # the title
owner: ops-team   # unknown key, kept

lanes:
  - id: finance        # finance first
  - id: archive        # stale: no such lane
  - id: requester
    colour: blue       # extra key
  - id: manager

styles:
  # by id
  - legend: The form
    match: { id: r01 }
    style: {border_style: dashed}
  - legend: Requester lane
    match: {lane: requester}
    style:
      fill: {light: "#dae8fc", dark: "#1e3a5f"}
  - match: {confidence: confirmed}
    style: {border_width: 2}

nodes:
  r01:
    system: excel     # the famous spreadsheet
    confidence: confirmed
  m01:
    kind: wait
    source: [sam-09-01, lee-09-03]
  n1:                 # orphan: no such block
    note: gone from the diagram

# trailing comment
`;

/** Pins in three lanes (one unlaned), an orphan pin `n2`, and `hints`. */
export const RICH_LAYOUT = `{
  "version": 1,
  "nodes": {
    "r01": { "lane": "requester", "along": 300, "across": 40 },
    "stray": { "lane": "_unassigned", "along": 500, "across": 20 },
    "n2": { "lane": "manager", "along": 10, "across": 12 },
    "f02": { "lane": "finance", "along": 700, "across": 30 }
  },
  "hints": { "v": 1, "note": [1, 2] }
}
`;

export const RICH: Files = { mmd: RICH_MMD, config: RICH_CONFIG, layout: RICH_LAYOUT };

/** The same diagram files with the `.mmd` in canonical form (for byte-exact undo by a reverse operation). */
export const canonical = (files: Files): Files => ({ ...files, mmd: canon(files.mmd) });

// ---- hand edits

/** Replace each `find` (which must occur exactly once) with its replacement, in order. */
export function edit(text: string, ...pairs: [string, string][]): string {
  let out = text;
  for (const [find, replace] of pairs) {
    const at = out.indexOf(find);
    if (at < 0) throw new Error(`hand edit: "${find}" not found in:\n${out}`);
    if (out.indexOf(find, at + 1) >= 0) throw new Error(`hand edit: "${find}" occurs more than once`);
    out = out.slice(0, at) + replace + out.slice(at + find.length);
  }
  return out;
}

/** `flowmap fmt`: the canonical form of a hand-edited `.mmd` (which must have no errors). */
export function canon(text: string): string {
  const { diagram, problems } = parse(text);
  if (problems.errors.length) throw new Error(`hand edit has errors: ${JSON.stringify(problems.errors)}\n${text}`);
  return format(diagram);
}

/** Edit a layout file's JSON by hand (the text is re-serialised; the comparison is on parsed JSON). */
export function editJson(text: string | null, change: (js: any) => void): string {
  const js = text === null ? { version: 1, nodes: {} } : JSON.parse(text);
  change(js);
  return JSON.stringify(js, null, 2);
}

function yamlJs(text: string): unknown {
  const doc = parseDocument(text);
  if (doc.errors.length) throw new Error(`invalid YAML:\n${text}`);
  return doc.toJS();
}

/** Unwrap a successful result. */
export function ok<T extends object>(r: OpResult<T>): { files: Files } & T {
  if (!r.ok) throw new Error(`refused: ${r.error}`);
  return r;
}

/** Unwrap a refusal. */
export function refused(r: OpResult<object>): string {
  if (r.ok) throw new Error(`expected a refusal, got:\n${JSON.stringify(r.files, null, 2)}`);
  return r.error;
}

/**
 * The parity check (§8.1): `result` must equal `hand` applied to `before`. `hand` gives the hand-edited raw text of
 * each file it changes (omitted: unchanged; null: no file). The `.mmd` is compared byte for byte after `fmt`; the
 * config as parsed YAML, with the same original lines removed or changed (so every untouched line is byte-identical);
 * the layout file as parsed JSON.
 */
export function expectParity(
  r: OpResult<object>,
  before: Files,
  hand: { mmd?: string; config?: string | null; layout?: string | null },
): Files {
  const after = ok(r).files;
  expect(after.mmd).toBe(canon(hand.mmd ?? before.mmd));

  const wantConfig = hand.config === undefined ? before.config : hand.config;
  if (wantConfig === null) expect(after.config).toBeNull();
  else {
    expect(after.config).not.toBeNull();
    expect(yamlJs(after.config!)).toEqual(yamlJs(wantConfig));
    if (before.config !== null) {
      expect(lineDiff(before.config, after.config!).removed.sort())
        .toEqual(lineDiff(before.config, wantConfig).removed.sort());
    }
    if (hand.config === undefined) expect(after.config).toBe(before.config);
  }

  const wantLayout = hand.layout === undefined ? before.layout : hand.layout;
  if (wantLayout === null) expect(after.layout).toBeNull();
  else {
    expect(after.layout).not.toBeNull();
    expect(JSON.parse(after.layout!)).toEqual(JSON.parse(wantLayout));
    if (hand.layout === undefined) expect(after.layout).toBe(before.layout);
  }
  return after;
}
