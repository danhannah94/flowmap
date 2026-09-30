// The parsed `.flow.yaml` config (§4).
import type { ResolvedStyle, ThemedColor } from '../types';

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

/** A note (§4 v1.1): free text on the canvas. Only valid properties are kept (bad ones warned `W-style`). */
export interface ConfigNote {
  /** Non-empty, not only whitespace; may hold line breaks (trailing ones are dropped when read). */
  text: string;
  /** An integer from 10 to 48; absent means the default, 14. */
  font_size?: number;
  /** Absent means the default, false. */
  bold?: boolean;
  /** Colours normalised to lowercase #rrggbb; absent means the theme's text colour. */
  color?: ThemedColor;
}

export interface FlowConfig {
  version: 1;
  title: string | null;
  /** The `lanes` list in order, or null when the config has no `lanes` key. */
  lanes: ConfigLane[] | null;
  styles: StyleRule[];
  /** Metadata by node id, as written (a block's own `style` included). */
  nodes: Record<string, NodeMeta>;
  /** v1.1: each node's own `style` (§4 "A block's own style"), valid properties only, for nodes that have one. */
  nodeStyles: Record<string, ResolvedStyle>;
  /** v1.1: notes by id, in file order. */
  notes: Record<string, ConfigNote>;
  /** v1.1: false only for `show_title: false`. */
  showTitle: boolean;
}

export function emptyConfig(): FlowConfig {
  return { version: 1, title: null, lanes: null, styles: [], nodes: {}, nodeStyles: {}, notes: {}, showTitle: true };
}

/** v1.1 note defaults (§4). */
export const NOTE_FONT_SIZE = 14;
export const NOTE_FONT_MIN = 10;
export const NOTE_FONT_MAX = 48;
/** The metadata key that holds a block's own style (§4); reserved: never a field, never matched. */
export const BLOCK_STYLE_KEY = 'style';

/**
 * A15: the metadata key that holds a block's link to another diagram (§4 "link"): a path to another diagram's
 * `.mmd`, relative to the served root, without the extension, forward slashes only (e.g. `brehob/stage-2`).
 * Reserved like `style`: the inspector shows it as the "Links to" field, not a field row, and the field form refuses
 * it as a key. Unlike `style`, it stays an ordinary metadata value for matching: `{match: {link: present}}` works.
 */
export const LINK_KEY = 'link';

export const STYLE_PROPS = [
  'fill', 'border_color', 'text_color', 'border_style', 'border_width', 'font_style', 'badge',
] as const;
export type StyleProp = (typeof STYLE_PROPS)[number];
export const COLOR_PROPS = ['fill', 'border_color', 'text_color'] as const;
export type ColorProp = (typeof COLOR_PROPS)[number];
export const BORDER_STYLES = ['solid', 'dashed', 'dotted'] as const;
export const FONT_STYLES = ['normal', 'italic', 'bold'] as const;
