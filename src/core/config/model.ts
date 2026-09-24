// The parsed `.flow.yaml` config (§4).
import type { ResolvedStyle } from '../types';

/** Metadata for one node: any keys, any YAML values (§4 `nodes`). */
export type NodeMeta = Record<string, unknown>;

export interface ConfigLane {
  id: string;
  /** Keys other than `id` (unknown to flowmap, kept by the writer). */
  extra: Record<string, unknown>;
}

export type MatchOp = 'equals' | 'present' | 'absent';

export interface MatchCondition {
  field: string;
  op: MatchOp;
  /** The value compared (as a string) for `equals`; `present` / `absent` for those ops. */
  value: string;
}

export interface StyleRule {
  legend: string | null;
  match: MatchCondition[];
  /** Valid properties only (bad ones warned with W-style and dropped); colours normalised to lowercase #rrggbb. */
  style: ResolvedStyle;
  /** The `style` map as written, including unknown or bad properties (for the styles panel). */
  rawStyle: Record<string, unknown>;
}

export interface FlowConfig {
  version: 1;
  title: string | null;
  /** The `lanes` list in order, or null when the config has no `lanes` key. */
  lanes: ConfigLane[] | null;
  styles: StyleRule[];
  nodes: Record<string, NodeMeta>;
}

export function emptyConfig(): FlowConfig {
  return { version: 1, title: null, lanes: null, styles: [], nodes: {} };
}

export const STYLE_PROPS = [
  'fill', 'border_color', 'text_color', 'border_style', 'border_width', 'font_style', 'badge',
] as const;
export type StyleProp = (typeof STYLE_PROPS)[number];
export const COLOR_PROPS = ['fill', 'border_color', 'text_color'] as const;
export type ColorProp = (typeof COLOR_PROPS)[number];
export const BORDER_STYLES = ['solid', 'dashed', 'dotted'] as const;
export const FONT_STYLES = ['normal', 'italic', 'bold'] as const;
