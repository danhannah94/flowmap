// Which file a problem in the error banner is in (UI31: "code, line, message"; a problem with no `.mmd` line shows
// its file instead). Every code §7 lists has an entry, so a warning from the config or layout file (or, A20, a preset
// pack file) never shows up as the `.mmd`'s.
import type { Problem } from '../../core/types';

type DiagramFile = 'mmd' | 'config' | 'layout';

/** Every problem code (§7) and the diagram file it is about. */
export const PROBLEM_FILES: Readonly<Record<string, DiagramFile>> = {
  // The `.mmd` (§3).
  'E-header': 'mmd',
  'E-nested': 'mmd',
  'E-unclosed': 'mmd',
  'E-shape': 'mmd',
  'E-edge': 'mmd',
  'E-duplicate': 'mmd',
  'E-syntax': 'mmd',
  'W-no-lane': 'mmd',
  'W-direction': 'mmd',
  // The `.flow.yaml` (§4): its rules and styles, node metadata, `link` (A15) and `preset` (A20). A preset problem in
  // the pack file itself carries that file instead (`Problem.file`).
  'E-config': 'config',
  'W-style': 'config',
  'W-config-key': 'config',
  'W-config-unknown-node': 'config',
  'W-config-unknown-lane': 'config',
  'W-link-missing': 'config',
  'W-link-traversal': 'config',
  'W-preset-unknown': 'config',
  'W-preset-invalid': 'config',
  'W-preset-kind': 'config',
  // The `.layout.json` (§5).
  'E-layout': 'layout',
  'W-layout-unknown-node': 'layout',
  'W-layout-unknown-edge': 'layout',
  'W-layout-unknown-note': 'layout',
};

const SUFFIX: Record<DiagramFile, string> = { mmd: '.mmd', config: '.flow.yaml', layout: '.layout.json' };

/** Where a problem is, for the banner: the pack file it names (A20), else its code's diagram file as a suffix. */
export function problemSource(p: Pick<Problem, 'code' | 'file'>): string {
  if (p.file) return p.file;
  return SUFFIX[PROBLEM_FILES[p.code] ?? 'mmd'];
}
