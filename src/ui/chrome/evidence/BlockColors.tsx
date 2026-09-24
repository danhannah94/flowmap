// UI35 Block colours: a block's own fill, border and text colour (its `style` in the config, §4), with light and dark
// values like the styles panel, a row of preset swatches, and "Reset colours". For one block or every selected block.
//
// - In the inspector: `BlockColors` (§8.3 `block-colors`: `data-prop` controls holding `data-variant` inputs, swatches
//   `data-testid="swatch"` with `data-color` / `data-color-dark`, and `block-colors-reset`).
// - In the block's context menu (UI40): `colors` opens the same inputs and swatches inside the menu, and
//   `reset-colors` removes them; both apply to every selected block when the clicked one is among several.
// Every write is one core operation (`setBlockColors`, `applySwatch`, `resetBlockColors`) through `store.apply`, so
// each is one undo step; config writes are off while the config has errors (UI26, UI31).
import { useMemo } from 'react';
import { COLOR_PROPS, sameColor, type ColorProp } from '../../../core/config';
import { applySwatch, resetBlockColors, setBlockColors } from '../../../core/ops';
import { getTheme } from '../../../core/theme';
import { registerMenuHandler, type MenuContext } from '../../contextmenu/registry';
import { MenuColorFields } from '../../contextmenu/controls';
import { shallow, useStore, useStoreState } from '../../store/hooks';
import type { State, Store } from '../../store/store';
import { ColorField } from './controls';
import './blockcolors.css';

/**
 * Preset fills (a swatch sets only the fill, UI35). Each is a soft tint for the light theme and a deep tone of the same
 * hue for the dark theme, chosen so the theme's own text and border colours stay readable on both.
 */
export const SWATCHES: readonly { name: string; light: string; dark: string }[] = [
  { name: 'Grey', light: '#f1f5f9', dark: '#334155' },
  { name: 'Blue', light: '#dbeafe', dark: '#1e3a5f' },
  { name: 'Teal', light: '#ccfbf1', dark: '#134e4a' },
  { name: 'Green', light: '#dcfce7', dark: '#1f4a2c' },
  { name: 'Yellow', light: '#fef3c7', dark: '#4a3f12' },
  { name: 'Orange', light: '#ffedd5', dark: '#5c2e10' },
  { name: 'Red', light: '#fee2e2', dark: '#5f1f1f' },
  { name: 'Purple', light: '#ede9fe', dark: '#3b2a6b' },
];

const PROP_LABEL: Record<ColorProp, string> = { fill: 'Fill', border_color: 'Border', text_color: 'Text' };

/** What the native picker starts from while a colour is unset: the theme's default for a block. */
const DEFAULTS: Record<ColorProp, { light: string; dark: string }> = {
  fill: { light: getTheme('light').nodeFill, dark: getTheme('dark').nodeFill },
  border_color: { light: getTheme('light').nodeBorder, dark: getTheme('dark').nodeBorder },
  text_color: { light: getTheme('light').nodeText, dark: getTheme('dark').nodeText },
};

/** Why config editing is off (UI26, UI31), or null. (The inspector's `configLock`, kept here to avoid an import cycle.) */
function lockOf(s: State): string | null {
  if (!s.derived) return 'Loading';
  if (s.derived.readOnly) return 'The .mmd file has errors, so the diagram is read-only until it’s fixed.';
  if (s.derived.configBroken) return 'The config file (.flow.yaml) has errors, so colours can’t be set until it’s fixed.';
  return null;
}

/** A block's own `style` map as written, or undefined. */
function ownStyle(s: State, id: string): Record<string, unknown> | undefined {
  const style = s.derived?.doc.config?.nodes[id]?.style;
  return style && typeof style === 'object' && !Array.isArray(style) ? (style as Record<string, unknown>) : undefined;
}

/** A colour value as its two inputs show it: a single colour is light only (dark empty, "same"). */
function parts(raw: unknown): { light: string; dark: string } {
  if (raw === undefined || raw === null) return { light: '', dark: '' };
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    return { light: o.light == null ? '' : String(o.light), dark: o.dark == null ? '' : String(o.dark) };
  }
  return { light: String(raw), dark: '' };
}

interface PropValue {
  light: string;
  dark: string;
  /** The selected blocks don't all have the same value. */
  mixed: boolean;
}

type Values = Record<ColorProp, PropValue>;

/** Each colour's value across the blocks (the shared one, or empty and `mixed`), and whether any block has one. */
function colorsOf(s: State, ids: readonly string[]): Values & { any: boolean } {
  let any = false;
  const out = {} as Values;
  for (const prop of COLOR_PROPS) {
    const vals = ids.map((id) => parts(ownStyle(s, id)?.[prop]));
    if (vals.some((v) => v.light || v.dark)) any = true;
    const first = vals[0] ?? { light: '', dark: '' };
    const same = vals.every((v) => v.light === first.light && v.dark === first.dark);
    out[prop] = same ? { ...first, mixed: false } : { light: '', dark: '', mixed: true };
  }
  return { ...out, any };
}

function sameValues(a: Values & { any: boolean }, b: Values & { any: boolean }): boolean {
  return a.any === b.any && COLOR_PROPS.every((p) => shallow(a[p], b[p]));
}

/** Does every block's fill equal this swatch (so it shows as the current one)? */
function swatchIsCurrent(fill: PropValue, sw: { light: string; dark: string }): boolean {
  if (fill.mixed || !fill.light) return false;
  const dark = fill.dark || fill.light;
  return sameColor(fill.light, sw.light) && sameColor(dark, sw.dark);
}

/**
 * Write one colour from its two inputs on every block (R5.11, as in the styles panel): an empty light value clears the
 * property; an empty dark value writes a single colour; a dark value typed with no light one is refused by the
 * operation, with its message.
 */
function commitColor(store: Store, ids: readonly string[], prop: ColorProp, shownLight: string, light: string, dark: string): void {
  if (light.trim() === '') store.apply(setBlockColors, ids, prop, null, shownLight === '' && dark.trim() !== '' ? dark : null);
  else store.apply(setBlockColors, ids, prop, light, dark.trim() === '' ? null : dark);
}

function pickSwatch(store: Store, ids: readonly string[], sw: { light: string; dark: string }): void {
  store.apply(applySwatch, ids, sw.light, sw.dark);
}

// ---------------------------------------------------------------------------------------------------------------
// The inspector section

/** UI35 in the inspector, for one block or every selected block (R10.1). */
export function BlockColors({ ids }: { ids: readonly string[] }) {
  const store = useStore();
  const values = useStoreState((s) => colorsOf(s, ids), sameValues);
  const lock = useStoreState(lockOf);
  const off = lock !== null;
  return (
    <section className="fm-ev-section fm-bc" data-testid="block-colors" aria-label="Block colours">
      <div className="fm-ev-section-head">
        <h3>{ids.length > 1 ? `Colours of all ${ids.length}` : 'Colours'}</h3>
        <button
          type="button"
          data-testid="block-colors-reset"
          className="fm-ev-link-btn"
          disabled={off || !values.any}
          title={values.any ? 'Remove the fill, border and text colours (other style properties stay)' : 'No colours set'}
          onClick={() => store.apply(resetBlockColors, ids)}
        >
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 12a8 8 0 1 0 2.3-5.6" />
            <path d="M4 4v4h4" />
          </svg>
          Reset
        </button>
      </div>
      {lock && lock !== 'Loading' ? <p className="fm-ev-empty">{lock}</p> : null}
      <Swatches fill={values.fill} disabled={off} onPick={(sw) => pickSwatch(store, ids, sw)} />
      <div className="fm-ev-props-grid fm-bc-fields">
        {COLOR_PROPS.map((prop) => {
          const v = values[prop];
          return (
            <ColorField
              key={prop}
              prop={prop}
              label={PROP_LABEL[prop]}
              light={v.light}
              dark={v.dark}
              defaults={DEFAULTS[prop]}
              disabled={off}
              placeholder={v.mixed ? { light: 'mixed', dark: 'mixed' } : undefined}
              onCommit={(l, d) => commitColor(store, ids, prop, v.light, l, d)}
            />
          );
        })}
      </div>
    </section>
  );
}

function Swatches({ fill, disabled, onPick }: {
  fill: PropValue;
  disabled: boolean;
  onPick: (sw: { light: string; dark: string }) => void;
}) {
  return (
    <div className="fm-bc-swatches" role="group" aria-label="Preset fills">
      {SWATCHES.map((sw) => {
        const current = swatchIsCurrent(fill, sw);
        return (
          <button
            key={sw.name}
            type="button"
            className="fm-bc-swatch"
            data-testid="swatch"
            data-color={sw.light}
            data-color-dark={sw.dark}
            aria-pressed={current}
            aria-label={`${sw.name} fill`}
            title={`${sw.name}: ${sw.light} in light, ${sw.dark} in dark`}
            disabled={disabled}
            style={{ ['--sw-light' as string]: sw.light, ['--sw-dark' as string]: sw.dark }}
            onClick={() => onPick(sw)}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The context menu (UI40): `colors` (inputs and swatches inside the menu) and `reset-colors`

function BlockColorsMenu({ ctx }: { ctx: MenuContext<'block'> }) {
  const ids = ctx.target.ids;
  const values = useStoreState((s) => colorsOf(s, ids), sameValues);
  const off = useStoreState((s) => lockOf(s) !== null);
  const fields = useMemo(
    () => COLOR_PROPS.map((prop) => ({ prop, label: PROP_LABEL[prop], light: values[prop].light, dark: values[prop].dark, defaults: DEFAULTS[prop] })),
    [values],
  );
  return (
    <div className="fm-bc-menu">
      <MenuColorFields
        fields={fields}
        swatches={SWATCHES}
        disabled={off}
        onSwatch={(sw) => pickSwatch(ctx.store, ids, sw)}
        onCommit={(prop, l, d) => commitColor(ctx.store, ids, prop as ColorProp, values[prop as ColorProp].light, l, d)}
      />
    </div>
  );
}

registerMenuHandler('block', 'colors', {
  Control: BlockColorsMenu,
  disabled: ({ store }) => lockOf(store.getState()),
});

registerMenuHandler('block', 'reset-colors', {
  run: ({ store, target }) => void store.apply(resetBlockColors, target.ids),
  disabled: ({ store }) => lockOf(store.getState()),
});
