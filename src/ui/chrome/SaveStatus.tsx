import { useStoreState } from '../store/hooks';

/** UI30: `saved`, `saving` or `error` (exactly that text; the dot is CSS). */
export function SaveStatus() {
  const save = useStoreState((s) => s.save);
  const error = useStoreState((s) => s.saveError);
  return (
    <span
      className={`fm-save fm-save-${save}`}
      data-testid="save-status"
      title={save === 'error' ? `Couldn't save: ${error ?? 'unknown error'} (retrying)` : undefined}
      aria-live="polite"
    >
      {save}
    </span>
  );
}
