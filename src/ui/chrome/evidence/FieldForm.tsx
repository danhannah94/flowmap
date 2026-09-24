// The inspector's field form (UI24, §8.3 Field form): a key, a type (text, list, map, YAML), a value and save, with
// one-click suggested values for keys that style rules match on. With one block it adds or edits a field; with
// several it sets the field on all of them, and `field-remove-all` removes the named field from all of them.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BLOCK_STYLE_KEY, fieldSuggestions, fieldValueFromForm, type FieldValue, type FlowConfig } from '../../../core/config';
import { removeFieldFromNodes, removeNodeField, setFieldOnNodes, setNodeField, type Files } from '../../../core/ops';
import { chain } from '../../actions';
import { useStore } from '../../store/hooks';
import { ico } from './controls';
import { convertForm, formJs, knownKeys, ruleKeys, sameJs, type FieldType } from './format';

/** v1.1 §4: `style` is reserved for a block's own colours, which have their own controls. */
const STYLE_KEY_REFUSED = '“style” holds the block’s colours: set them under Colours (or edit the node YAML).';

export interface FieldFormInit {
  key: string;
  type: FieldType;
  text: string;
  /** Editing this existing field (saving under another key renames it). */
  editing?: string;
}

const PLACEHOLDER: Record<FieldType, string> = {
  text: 'Value',
  list: 'One item per line',
  map: 'key: value (one per line)',
  yaml: 'Any YAML: lists, maps, nested values',
};

export function FieldForm({ ids, config, init, disabled, onClose, autoFocus }: {
  /** The blocks the form writes to (one, or the whole selection). */
  ids: readonly string[];
  config: FlowConfig | null;
  init: FieldFormInit;
  disabled: boolean;
  /** Single block: close after a save. Absent: the form stays (several blocks). */
  onClose?: () => void;
  autoFocus?: 'key' | 'value';
}) {
  const store = useStore();
  const multi = !onClose;
  const [key, setKey] = useState(init.key);
  const [type, setType] = useState<FieldType>(init.type);
  const [text, setText] = useState(init.text);
  const [error, setError] = useState<string | null>(null);
  const textTouched = useRef(false);
  const keyRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLTextAreaElement>(null);
  const listId = useId();

  useEffect(() => {
    if (autoFocus === 'key') keyRef.current?.focus();
    else if (autoFocus === 'value') valueRef.current?.focus();
  }, [autoFocus]);

  const k = key.trim();
  const keys = useMemo(() => knownKeys(config), [config]);
  const suggestions = useMemo(
    () => (k && ruleKeys(config).has(k) ? fieldSuggestions(config, k, multi ? undefined : ids[0]) : []),
    [config, k, multi, ids],
  );
  /** The field's value on every target block, if they all have the same one. */
  const current = useMemo(() => {
    if (!k || !config) return undefined;
    const vals = ids.map((id) => (Object.hasOwn(config.nodes, id) && Object.hasOwn(config.nodes[id]!, k) ? config.nodes[id]![k] : undefined));
    return vals.every((v) => v !== undefined && JSON.stringify(v) === JSON.stringify(vals[0])) ? vals[0] : undefined;
  }, [config, ids, k]);
  const existing = init.editing && config?.nodes[ids[0]!]?.[init.editing];

  const parsed = fieldValueFromForm(type, text);
  const inSync = !('error' in parsed) && k !== '' && (!init.editing || init.editing === k) && sameJs(formJs(parsed), current);

  /** Write `value` under the key; returns true when written (or already so). */
  const write = (value: FieldValue): boolean => {
    if (!k) {
      setError('Give the field a name first');
      keyRef.current?.focus();
      return false;
    }
    if (k === BLOCK_STYLE_KEY) {
      setError(STYLE_KEY_REFUSED);
      keyRef.current?.focus();
      return false;
    }
    const renaming = !multi && init.editing !== undefined && init.editing !== k;
    if (!renaming && sameJs(formJs(value), current)) return true;
    const id = ids[0]!;
    const from = init.editing!;
    const r = multi
      ? store.apply(setFieldOnNodes, ids, k, value)
      : renaming
        ? store.apply(function renameField(f: Files) {
            return chain(f, [(x) => setNodeField(x, id, k, value), (x) => removeNodeField(x, id, from)]);
          })
        : store.apply(setNodeField, id, k, value);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    setError(null);
    return true;
  };

  const save = () => {
    const v = fieldValueFromForm(type, text);
    if ('error' in v) {
      setError(v.error);
      return;
    }
    if (write(v) && onClose) onClose();
  };

  const pick = (s: string) => {
    let nextType: FieldType = type === 'list' ? 'list' : 'text';
    let nextText = s;
    if (nextType === 'list') {
      const lines = text.split('\n').filter((l) => l.trim() !== '');
      nextText = lines.includes(s) ? lines.join('\n') : [...lines, s].join('\n');
    }
    setType(nextType);
    setText(nextText);
    textTouched.current = true;
    const v = fieldValueFromForm(nextType, nextText);
    if (!('error' in v)) write(v);
  };

  const changeType = (t: FieldType) => {
    if (!textTouched.current && existing !== undefined) {
      const converted = convertForm(existing, t);
      if (converted !== null) setText(converted);
    }
    setType(t);
    setError(null);
  };

  const removeAll = () => {
    if (!k) {
      setError('Type the name of the field to remove');
      keyRef.current?.focus();
      return;
    }
    if (k === BLOCK_STYLE_KEY) {
      setError(STYLE_KEY_REFUSED);
      keyRef.current?.focus();
      return;
    }
    const r = store.apply(removeFieldFromNodes, ids, k);
    if (r.ok) setError(null);
    else setError(r.error);
  };

  return (
    <div className={`fm-ev-form${multi ? ' fm-ev-form-multi' : ''}`} onKeyDown={(e) => {
      if (e.key === 'Escape' && onClose) {
        e.stopPropagation();
        onClose();
      }
    }}>
      <div className="fm-ev-form-row">
        <label className="fm-ev-form-label" htmlFor={`${listId}-key`}>Field</label>
        <input
          ref={keyRef}
          id={`${listId}-key`}
          data-testid="field-key"
          className="fm-ev-input fm-ev-mono"
          value={key}
          list={`${listId}-keys`}
          placeholder="e.g. confidence"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(e) => {
            setKey(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              valueRef.current?.focus();
            }
          }}
        />
        <select
          data-testid="field-type"
          className="fm-ev-select fm-ev-type"
          value={type}
          disabled={disabled}
          aria-label="Value type"
          onChange={(e) => changeType(e.target.value as FieldType)}
        >
          <option value="text">text</option>
          <option value="list">list</option>
          <option value="map">map</option>
          <option value="yaml">yaml</option>
        </select>
        <datalist id={`${listId}-keys`}>
          {keys.map((x) => <option key={x} value={x} />)}
        </datalist>
      </div>
      <textarea
        ref={valueRef}
        data-testid="field-value"
        className={`fm-ev-input fm-ev-textarea${type === 'yaml' || type === 'map' ? ' fm-ev-mono' : ''}`}
        value={text}
        rows={Math.min(10, Math.max(type === 'text' ? 2 : 3, text.split('\n').length + (type === 'text' ? 0 : 1)))}
        placeholder={PLACEHOLDER[type]}
        spellCheck={type === 'text'}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          textTouched.current = true;
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && ((type === 'text' && !e.shiftKey) || e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
      />
      {suggestions.length > 0 ? (
        <div className="fm-ev-suggestions" aria-label="Suggested values">
          {suggestions.map((s) => {
            const on = current !== undefined && (Array.isArray(current) ? current.includes(s) : String(current) === s);
            return (
              <button
                key={s}
                type="button"
                data-testid="field-suggestion"
                className={`fm-ev-chip fm-ev-chip-btn${on ? ' fm-ev-chip-on' : ''}`}
                title={type === 'list' ? `Add “${s}”` : `Set ${k} to “${s}”`}
                disabled={disabled}
                onClick={() => pick(s)}
              >
                {s}
              </button>
            );
          })}
        </div>
      ) : null}
      {error ? <div className="fm-ev-form-error" role="alert">{error}</div> : null}
      <div className="fm-ev-form-actions">
        <span className="fm-ev-hint">
          {type === 'text' ? '↵ to save' : '⌘↵ to save'}
        </span>
        {multi ? (
          <button type="button" data-testid="field-remove-all" className="fm-btn fm-ev-btn fm-ev-btn-quiet" disabled={disabled} onClick={removeAll} title="Remove this field from every selected block">
            Remove from all
          </button>
        ) : (
          <button type="button" className="fm-btn fm-ev-btn fm-ev-btn-quiet" onClick={onClose}>
            Cancel
          </button>
        )}
        <button type="button" data-testid="field-save" className="fm-btn fm-btn-primary fm-ev-btn" disabled={disabled} onClick={save}>
          {inSync && !multi ? <>{ico.check} Done</> : multi ? `Set on ${ids.length}` : 'Save'}
        </button>
      </div>
    </div>
  );
}
