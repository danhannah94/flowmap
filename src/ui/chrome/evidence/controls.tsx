// Small controls shared by the inspector and the styles panel: a text input that commits on Enter and on blur, a
// colour field (hex text plus the native picker), a live style swatch, and icon buttons.
import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { resolveStyle, getTheme } from '../../../core/theme';
import type { ResolvedStyle } from '../../../core/types';
import { Shape } from '../../canvas/Shape';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'defaultValue'>;

/**
 * A text input bound to a value on disk. Typing keeps a local draft; Enter or leaving the field commits it (`onCommit`,
 * skipped when unchanged), Escape reverts. After a commit the input shows the file's value again (the new one, or the
 * old one if the edit was refused). A draft still pending when the input goes away is committed too.
 */
export function CommitInput({ value, onCommit, onDraft, ...rest }: InputProps & {
  value: string;
  onCommit: (text: string) => void;
  onDraft?: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const latest = useRef({ draft, value, onCommit });
  latest.current = { draft, value, onCommit };

  const commit = () => {
    const { draft: d, value: v, onCommit: c } = latest.current;
    if (d === null) return;
    latest.current.draft = null;
    setDraft(null);
    if (d !== v) c(d);
  };

  useEffect(() => () => {
    // Unmounted with a pending draft (the selection moved on): keep what was typed.
    const { draft: d, value: v, onCommit: c } = latest.current;
    if (d !== null && d !== v) c(d);
  }, []);

  return (
    <input
      {...rest}
      value={draft ?? value}
      spellCheck={false}
      onChange={(e) => {
        setDraft(e.target.value);
        onDraft?.(e.target.value);
      }}
      onKeyDown={(e) => {
        rest.onKeyDown?.(e);
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          latest.current.draft = null;
          setDraft(null);
          onDraft?.(value);
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        commit();
        rest.onBlur?.(e);
      }}
    />
  );
}

/** A textarea that grows with its content (up to `maxRows`). */
export function AutoTextarea({ minRows = 2, maxRows = 14, value, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  value: string;
  minRows?: number;
  maxRows?: number;
}) {
  const lines = value.split('\n').length;
  return <textarea {...rest} value={value} rows={Math.min(maxRows, Math.max(minRows, lines))} spellCheck={false} />;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function toPickerValue(hex: string, fallback: string): string {
  const h = hex.trim().toLowerCase();
  if (!HEX.test(h)) return fallback;
  if (h.length === 4) return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  return h;
}

/**
 * A colour property (UI25, §8.3): `data-prop` holding light and dark hex inputs (`data-variant`), each with a native
 * picker. `onCommit(light, dark)` receives both current values. Emptying light clears the property (R5.11).
 */
export function ColorField({ prop, label, light, dark, disabled, defaults, onCommit, placeholder }: {
  prop: string;
  label: string;
  light: string;
  dark: string;
  disabled?: boolean;
  defaults: { light: string; dark: string };
  onCommit: (light: string, dark: string) => void;
  /** Placeholder text for an empty input instead of `none` / `same` (e.g. `mixed` across several blocks). */
  placeholder?: { light?: string; dark?: string };
}) {
  // Live text while a picker is open; the commit happens when the picker closes (its native `change`).
  const [preview, setPreview] = useState<{ light?: string; dark?: string }>({});
  const shownLight = preview.light ?? light;
  const shownDark = preview.dark ?? dark;
  return (
    <div className="fm-ev-prop fm-ev-color" data-prop={prop}>
      <span className="fm-ev-prop-name">{label}</span>
      <div className="fm-ev-color-pair">
        {(['light', 'dark'] as const).map((variant) => {
          const cur = variant === 'light' ? shownLight : shownDark;
          const pickerValue = toPickerValue(cur || (variant === 'dark' ? shownLight : ''), defaults[variant]);
          const set = (text: string) => (variant === 'light' ? onCommit(text, dark) : onCommit(light, text));
          return (
            <label key={variant} className={`fm-ev-color-input fm-ev-${variant}${cur ? '' : ' fm-ev-unset'}`} title={`${label}, ${variant} theme`}>
              <NativePicker
                value={pickerValue}
                unset={!cur}
                disabled={disabled}
                ariaLabel={`${label} (${variant} theme) picker`}
                onPreview={(v) => setPreview((p) => ({ ...p, [variant]: v }))}
                onPick={(v) => {
                  setPreview({});
                  if (v !== toPickerValue(cur, '')) set(v);
                }}
              />
              <CommitInput
                data-variant={variant}
                className="fm-ev-input fm-ev-hex"
                value={variant === 'light' ? light : dark}
                placeholder={placeholder?.[variant] ?? (variant === 'light' ? 'none' : light ? 'same' : 'none')}
                aria-label={`${label}, ${variant} theme (#rgb or #rrggbb)`}
                disabled={disabled}
                maxLength={7}
                onCommit={set}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}

function NativePicker({ value, unset, disabled, ariaLabel, onPreview, onPick }: {
  value: string;
  unset: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onPreview: (v: string) => void;
  onPick: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const el = ref.current!;
    const onChange = () => pick.current(el.value.toLowerCase());
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);
  return (
    <span className="fm-ev-swatch-btn" style={unset ? undefined : { background: value }}>
      <input
        ref={ref}
        type="color"
        className="fm-ev-native-color"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        tabIndex={-1}
        onChange={(e) => onPreview(e.target.value.toLowerCase())}
      />
    </span>
  );
}

/** A live sample of a style: a step shape with its fill, border, text and badge, in the current theme. */
export function StyleSwatch({ style, theme, size = 'md' }: { style: ResolvedStyle; theme: 'light' | 'dark'; size?: 'sm' | 'md' }) {
  const t = getTheme(theme);
  const s = resolveStyle(style, t);
  const W = size === 'sm' ? 34 : 52;
  const H = size === 'sm' ? 22 : 32;
  return (
    <span className={`fm-ev-sample fm-ev-sample-${size}`} style={{ background: t.canvasBackground }} aria-hidden="true">
      <svg width={W + 8} height={H + 10} viewBox={`-4 -6 ${W + 8} ${H + 10}`}>
        <Shape kind="step" width={W} height={H} paint={{ fill: s.fill, stroke: s.stroke, strokeWidth: s.strokeWidth, dasharray: s.dasharray }} />
        <text
          x={W / 2}
          y={H / 2 + (size === 'sm' ? 4 : 4.5)}
          textAnchor="middle"
          fill={s.textColor}
          fontSize={size === 'sm' ? 10 : 12}
          fontStyle={s.fontStyle}
          fontWeight={s.fontWeight === 'bold' ? 700 : 400}
          fontFamily="Inter, sans-serif"
        >
          Aa
        </text>
        {s.badge ? (
          <g>
            <rect x={W - 16} y={-5} width={14} height={8} rx={4} fill={t.badgeFill} />
            <circle cx={W - 9} cy={-1} r={1.4} fill={t.badgeText} />
          </g>
        ) : null}
      </svg>
    </span>
  );
}

export function IconButton({ label, children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button type="button" className={`fm-ev-icon-btn${className ? ` ${className}` : ''}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

function Ico({ children }: { children: ReactNode }) {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const ico = {
  edit: <Ico><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></Ico>,
  trash: <Ico><path d="M4 7h16" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /><path d="M9 7V4h6v3" /></Ico>,
  up: <Ico><path d="m6 15 6-6 6 6" /></Ico>,
  down: <Ico><path d="m6 9 6 6 6-6" /></Ico>,
  plus: <Ico><path d="M12 5v14M5 12h14" /></Ico>,
  close: <Ico><path d="M6 6l12 12M18 6 6 18" /></Ico>,
  x: <Ico><path d="M7 7l10 10M17 7 7 17" /></Ico>,
  check: <Ico><path d="m5 12 5 5 9-10" /></Ico>,
};
