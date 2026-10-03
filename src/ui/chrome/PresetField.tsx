// A20: the Styles panel's "Preset pack" field: which preset pack the diagram uses (the config's `preset:`), as a
// built-in name or a path to a pack file beside the diagram. One core operation (`setPreset`) through `store.apply`,
// like every other config edit; off while the config has errors (UI26).
import { builtinPresetNames } from '../../core/preset';
import { setPreset } from '../../core/ops';
import { useStore, useStoreState } from '../store/hooks';
import { configLock } from './Inspector';
import { CommitInput } from './evidence/controls';

export function PresetField() {
  const store = useStore();
  const ref = useStoreState((s) => s.derived?.doc.config?.preset ?? null);
  const name = useStoreState((s) => s.derived?.doc.preset?.name ?? null);
  const lock = useStoreState(configLock);
  const off = lock !== null;
  const builtins = builtinPresetNames();
  return (
    <section className="fm-ev-section fm-preset" data-testid="preset-field" aria-label="Preset pack">
      <div className="fm-ev-section-head">
        <h3>Preset pack</h3>
      </div>
      <p className="fm-preset-intro">
        Icons, looks and legend entries for blocks with a <code className="fm-ev-code">kind</code>, from a built-in pack or a
        pack file beside the diagram. Your rules below still win.
      </p>
      <div className="fm-links-row">
        <CommitInput
          data-testid="preset-input"
          className="fm-ev-input fm-ev-grow"
          value={ref ?? ''}
          placeholder={`e.g. ${builtins[0] ?? 'cloud'} or packs/team.yaml`}
          disabled={off}
          aria-label="Preset pack: a built-in name or a pack file path"
          onCommit={(text) => store.apply(setPreset, text.trim() === '' ? null : text)}
        />
        <button
          type="button"
          data-testid="preset-clear"
          className="fm-ev-link-btn"
          disabled={off || !ref}
          onClick={() => store.apply(setPreset, null)}
        >
          Clear
        </button>
      </div>
      {name ? <div className="fm-preset-using" data-testid="preset-using">Using {name}</div> : null}
      {!off ? (
        <div className="fm-ev-quick" aria-label="Built-in presets">
          {builtins.filter((b) => b !== ref).map((b) => (
            <button
              key={b}
              type="button"
              data-testid="preset-suggestion"
              className="fm-ev-chip fm-ev-chip-btn"
              onClick={() => store.apply(setPreset, b)}
            >
              {b}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
