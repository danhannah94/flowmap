// The context-menu item registry (design.md §8.2 UI40, §8.3 `context-menu`).
//
// An item has two halves, so the menu stays honest while features land at different times:
// - Its SLOT, `defineMenuItem({on, name, label, icon, section, order, multi?, when?})`: the target kind (`block`,
//   `line`, `note`, `title`, `lane`, `canvas`), the `data-menu-item` name, where it sits, whether it is offered with
//   several blocks selected (`multi`, applied to all of them), and its "shows when" rule. Every UI40 item already has
//   a slot (items.tsx); a feature may define new ones.
// - Its HANDLER, `registerMenuHandler(on, name, {run} | {Control})`, from the feature that owns the behaviour.
//   `run(ctx)` is an action: the menu closes, then it runs (so an editor it opens gets the focus). `Control` is a
//   component rendered inside the menu element when the item is clicked (the `shape`, `colors`, `color` and
//   `font-size` sub-controls; controls.tsx has `MenuColorFields` and `MenuNumberField` for these). Optional:
//   `disabled(ctx)` returns a reason to grey it out (e.g. a file with errors, UI31), `checked(ctx)` shows a tick
//   (`bold`), and `when` / `label` add to or replace the slot's.
// An item renders only with both halves and its `when` passing, so an item whose feature hasn't landed doesn't show.
//
// `ctx` (MenuContext): the store; the target (`block`: `ids`, every block the item applies to, and `clicked`; `line`:
// `id` and `bend`, the clicked bend point's index or null; `note`: `id`; `lane`: `id`); `world`, where the menu was
// opened in diagram coordinates (for `add-note`, `add-bend`); and `close()`.
//
// Example, from the block-colours feature's own module:
//   registerMenuHandler('block', 'reset-colors', { run: ({ store, target }) => store.apply(resetBlockColors, target.ids) });
//   registerMenuHandler('block', 'colors', { Control: BlockColorsMenu });
import type { ComponentType, ReactNode } from 'react';
import type { Point } from '../canvas/viewport';
import type { Store } from '../store/store';

export type MenuOn = 'block' | 'line' | 'note' | 'title' | 'lane' | 'canvas';

/** What the menu was opened on. */
export type MenuTarget =
  /** `ids`: the blocks the items apply to (the clicked one, or the whole selection when it was one of several). */
  | { kind: 'block'; ids: readonly string[]; clicked: string }
  /** `bend`: the index of the bend point clicked (`data-bend`), or null for anywhere else on the line. */
  | { kind: 'line'; id: string; bend: number | null }
  | { kind: 'note'; id: string }
  | { kind: 'title' }
  /** A lane header (not in UI40's table: the lane menu's actions, for convenience). */
  | { kind: 'lane'; id: string }
  | { kind: 'canvas' };

export type TargetOf<K extends MenuOn> = Extract<MenuTarget, { kind: K }>;

export interface MenuContext<K extends MenuOn = MenuOn> {
  store: Store;
  target: TargetOf<K>;
  /** Where the menu was opened, in diagram (world, layout) coordinates. */
  world: Point;
  /** Close the menu. */
  close(): void;
}

export interface MenuItemDef<K extends MenuOn = MenuOn> {
  on: K;
  /** The `data-menu-item` name (§8.3). Unique per target kind. */
  name: string;
  label: string | ((ctx: MenuContext<K>) => string);
  icon?: ReactNode;
  /** Items are grouped by section (ascending), with a separator between groups, and ordered within one. */
  section: number;
  order: number;
  /** A heading shown above the item's section (set it on any one item of the section). */
  sectionTitle?: string;
  /** Drawn as a compact tile in a grid rather than a row (the canvas's `add-<shape kind>` items). */
  tile?: boolean;
  /** Block items only: offered when several blocks are selected, and applied to all of them (UI40). */
  multi?: boolean;
  /** "Shows when" (UI40's table). Absent: always. */
  when?: (ctx: MenuContext<K>) => boolean;
  danger?: boolean;
  /** A keyboard hint shown at the right (e.g. the shortcut that does the same). */
  hint?: string;
}

export interface MenuHandler<K extends MenuOn = MenuOn> {
  /** An action: the menu closes, then this runs. */
  run?: (ctx: MenuContext<K>) => void;
  /** A sub-control rendered inside the menu when the item is clicked. */
  Control?: ComponentType<{ ctx: MenuContext<K> }>;
  /** A reason the item can't be used right now (shown greyed out with the reason as its tooltip), or null. */
  disabled?: (ctx: MenuContext<K>) => string | null;
  /** Shown with a tick when true (toggles such as `bold`). */
  checked?: (ctx: MenuContext<K>) => boolean;
  /** Extra "shows when" condition, on top of the slot's. */
  when?: (ctx: MenuContext<K>) => boolean;
  /** Replaces the slot's label. */
  label?: string | ((ctx: MenuContext<K>) => string);
}

/** An item ready to render: its slot and handler, with the label resolved. */
export interface ResolvedMenuItem {
  def: MenuItemDef;
  handler: MenuHandler;
  label: string;
  disabled: string | null;
  checked: boolean | null;
}

const defs = new Map<string, MenuItemDef>();
const handlers = new Map<string, MenuHandler>();
const listeners = new Set<() => void>();
let version = 0;

const keyOf = (on: MenuOn, name: string) => `${on}\u0000${name}`;

function changed(): void {
  version++;
  for (const fn of listeners) fn();
}

/** Define (or redefine) an item's slot. */
export function defineMenuItem<K extends MenuOn>(def: MenuItemDef<K>): void {
  defs.set(keyOf(def.on, def.name), def as unknown as MenuItemDef);
  changed();
}

/**
 * Attach the behaviour for an item (its slot must be defined, here or by `defineMenuItem`). Replaces any earlier
 * handler for the same item. Returns a function that removes it again.
 */
export function registerMenuHandler<K extends MenuOn>(on: K, name: string, handler: MenuHandler<K>): () => void {
  const key = keyOf(on, name);
  const h = handler as unknown as MenuHandler;
  if (!handler.run && !handler.Control) throw new Error(`registerMenuHandler(${on}, ${name}): needs run or Control`);
  handlers.set(key, h);
  changed();
  return () => {
    if (handlers.get(key) === h) {
      handlers.delete(key);
      changed();
    }
  };
}

/** Is an item defined and handled (whatever its "shows when" says)? */
export function hasMenuHandler(on: MenuOn, name: string): boolean {
  return defs.has(keyOf(on, name)) && handlers.has(keyOf(on, name));
}

/** Registry changes (for the menu to re-render if a feature registers while it is open). */
export function subscribeMenuRegistry(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function menuRegistryVersion(): number {
  return version;
}

const labelOf = <K extends MenuOn>(l: string | ((ctx: MenuContext<K>) => string), ctx: MenuContext<K>) =>
  typeof l === 'function' ? l(ctx) : l;

/** The items to show for a menu, in order: defined, handled, offered for this selection, and passing "shows when". */
export function menuItemsFor(ctx: MenuContext): ResolvedMenuItem[] {
  const multi = ctx.target.kind === 'block' && ctx.target.ids.length > 1;
  const out: ResolvedMenuItem[] = [];
  for (const def of defs.values()) {
    if (def.on !== ctx.target.kind) continue;
    const handler = handlers.get(keyOf(def.on, def.name));
    if (!handler) continue;
    if (multi && !def.multi) continue;
    if (def.when && !def.when(ctx)) continue;
    if (handler.when && !handler.when(ctx)) continue;
    out.push({
      def,
      handler,
      label: labelOf(handler.label ?? def.label, ctx),
      disabled: handler.disabled?.(ctx) ?? null,
      checked: handler.checked ? handler.checked(ctx) : null,
    });
  }
  out.sort((a, b) => a.def.section - b.def.section || a.def.order - b.def.order);
  return out;
}
