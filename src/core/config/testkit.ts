// Test helpers for config writing: a comment-rich config and a line diff to prove untouched lines survive.
import { parseDocument } from 'yaml';

export const RICH = `# flowmap config for the purchase-request map
# (hand-maintained by the AI; keep comments)

version: 1
title:   Purchase request approval   # shown above the diagram
owner: ops-team        # unknown key, kept

lanes:                     # display order
  - id: requester          # first
  - id: manager
    colour: blue           # extra key, kept
  # purchasing goes here
  - id: purchasing
  - id: finance

styles:                    # applied top to bottom
  # Evidence strength
  - legend: Confirmed by two or more people
    match: { confidence: confirmed }
    style: {border_style: solid, border_width: 2}
  - legend: One source only
    match: {confidence: single-source}   # the usual case
    style:
      border_style: dashed
  - match: {kind: wait}
    style: {fill: {light: "#fff2cc", dark: "#4a3f12"}, badge: wait}
    legend: Waiting on someone
  - legend: By id
    match: {id: r01, lane: requester}
    style: {text_color: "#333"}

nodes:
    intake:                # 4-space indent here
        confidence: confirmed
        source: [sam-09-01, lee-09-03]
    r01:
        system: excel
        # the famous spreadsheet
        quote: "the form is a spreadsheet somebody made in 2014"
    p05:
        kind: wait
        variants:
            main plant: three quotes over $1,000
            warehouse: one quote is fine under $5,000
        # end of p05

# trailing comment
`;

export function parse(text: string | null): unknown {
  if (text === null) return undefined;
  const doc = parseDocument(text);
  if (doc.errors.length) throw new Error(`invalid YAML:\n${text}\n${doc.errors[0]!.message}`);
  return doc.toJS();
}

/** Lines of `a` not kept in `b` (by longest common subsequence), and lines of `b` that are new. */
export function lineDiff(a: string, b: string): { removed: string[]; added: string[] } {
  const x = a.split('\n');
  const y = b.split('\n');
  const n = x.length;
  const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { i++; j++; } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) removed.push(x[i++]!); else added.push(y[j++]!);
  }
  while (i < n) removed.push(x[i++]!);
  while (j < m) added.push(y[j++]!);
  return { removed, added };
}
