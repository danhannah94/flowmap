// Sub-controls that render inside the context menu (UI40, §8.3: "the `shape`, colour and font-size controls render
// inside the menu element"). Feature owners use these for their items' `Control` (see registry.ts):
// - `MenuColorFields`: colour properties as `data-prop` holding `data-variant="light|dark"` hex inputs (each with the
//   native picker, as in the styles panel and inspector), plus an optional row of preset swatches
//   (`data-testid="swatch"`, `data-color`, `data-color-dark`, as in the inspector's `block-colors`, §8.3).
// - `MenuNumberField`: a number input with `data-prop` (e.g. `font_size`), committed on Enter or when it loses focus.
// - `MenuShapeOptions`: one option per shape with `data-shape` (the block's `shape` item).
import { SHAPE_KINDS, type ShapeKind } from '../../core/types';
import { ShapeIcon } from '../chrome/Palette';
import { ColorField, CommitInput } from '../chrome/evidence/controls';

export interface MenuColorFieldSpec {
  /** The `data-prop` value (`fill`, `border_color`, `text_color`, `color`). */
  prop: string;
  label: string;
  /** Current values as written (empty: not set). */
  light: string;
  dark: string;
  /** What the native picker starts from while unset (the theme default). */
  defaults: { light: string; dark: string };
}

export interface MenuSwatch {
  light: string;
  dark: string;
  name?: string;
}

export function MenuColorFields({ fields, onCommit, swatches, onSwatch, disabled }: {
  fields: readonly MenuColorFieldSpec[];
  /** Both values of one property (an empty light value clears it, R5.11). */
  onCommit: (prop: string, light: string, dark: string) => void;
  swatches?: readonly MenuSwatch[];
  onSwatch?: (swatch: MenuSwatch) => void;
  disabled?: boolean;
}) {
  return (
    <div className="fm-cm-colors">
      {swatches?.length ? (
        <div className="fm-cm-swatches" role="group" aria-label="Preset colours">
          {swatches.map((sw) => (
            <button
              key={`${sw.light}/${sw.dark}`}
              type="button"
              className="fm-cm-swatch"
              data-testid="swatch"
              data-color={sw.light}
              data-color-dark={sw.dark}
              title={sw.name ?? `${sw.light} / ${sw.dark}`}
              aria-label={sw.name ?? `Fill ${sw.light}, dark ${sw.dark}`}
              disabled={disabled}
              style={{ ['--sw-light' as string]: sw.light, ['--sw-dark' as string]: sw.dark }}
              onClick={() => onSwatch?.(sw)}
            />
          ))}
        </div>
      ) : null}
      {fields.map((f) => (
        <ColorField
          key={f.prop}
          prop={f.prop}
          label={f.label}
          light={f.light}
          dark={f.dark}
          defaults={f.defaults}
          disabled={disabled}
          onCommit={(light, dark) => onCommit(f.prop, light, dark)}
        />
      ))}
    </div>
  );
}

export function MenuNumberField({ prop, label, value, min, max, placeholder, onCommit, disabled }: {
  prop: string;
  label: string;
  /** Current value, or null for the default (shown as the placeholder). */
  value: number | null;
  min?: number;
  max?: number;
  placeholder?: string;
  /** The typed whole number, or null when emptied. */
  onCommit: (value: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <label className="fm-cm-number">
      <span className="fm-cm-number-label">{label}</span>
      <CommitInput
        type="number"
        inputMode="numeric"
        data-prop={prop}
        className="fm-ev-input fm-cm-number-input"
        value={value === null ? '' : String(value)}
        min={min}
        max={max}
        step={1}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={label}
        onCommit={(text) => {
          const t = text.trim();
          if (t === '') onCommit(null);
          else if (/^-?\d+$/.test(t)) onCommit(Number(t));
        }}
      />
    </label>
  );
}

export const SHAPE_NAMES: Record<ShapeKind, string> = {
  step: 'Step',
  decision: 'Decision',
  terminal: 'Start / end',
  subprocess: 'Subprocess',
  database: 'System',
  io: 'Input / output',
  document: 'Document',
  delay: 'Wait',
};

export function MenuShapeOptions({ current, onPick }: { current: ShapeKind | null; onPick: (shape: ShapeKind) => void }) {
  return (
    <div className="fm-cm-shapes" role="group" aria-label="Shape">
      {SHAPE_KINDS.map((k) => (
        <button
          key={k}
          type="button"
          role="menuitemradio"
          aria-checked={k === current}
          className="fm-cm-shape"
          data-shape={k}
          title={SHAPE_NAMES[k]}
          onClick={() => onPick(k)}
        >
          <ShapeIcon kind={k} width={26} height={18} />
          <span className="fm-cm-shape-name">{SHAPE_NAMES[k]}</span>
        </button>
      ))}
    </div>
  );
}
