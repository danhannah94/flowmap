// UI34 in the inspector: the selected block's size, "custom" when it has a stored size (from resizing) and "auto"
// when it fits its label, with a reset for a custom size. Added through `inspectorSections` (loaded by index.ts after
// the inspector). Resizing itself is on the canvas (canvas/ResizeHandles.tsx).
import { resetSize } from '../../../core/ops';
import { pinningBlocked } from '../../actions';
import { useStore, useStoreState } from '../../store/hooks';
import { inspectorSections } from '../Inspector';
import { IconButton } from './controls';

function BlockSize({ id }: { id: string }) {
  const store = useStore();
  const box = useStoreState((s) => {
    const n = s.shown?.layout?.nodes.find((x) => x.id === id);
    return n ? `${n.width} × ${n.height}` : null;
  });
  const sized = useStoreState((s) => !!s.derived?.doc.sizes[id]);
  const blocked = useStoreState(() => pinningBlocked(store));
  if (!box) return null;
  return (
    <div className="fm-ev-kv">
      <span className="fm-ev-k">Size</span>
      <span className="fm-ev-v">
        <code className="fm-ev-code fm-ev-code-quiet" title={sized ? 'Set by resizing' : 'Fits the label'}>{box}</code>
        <span className="fm-ev-faint">{sized ? 'custom' : 'auto'}</span>
        {sized ? (
          <IconButton label="Reset size (fit the label)" disabled={!!blocked} onClick={() => store.apply(resetSize, [id])}>
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 12a8 8 0 1 0 2.3-5.6" />
              <path d="M4 4v4h4" />
            </svg>
          </IconButton>
        ) : null}
      </span>
    </div>
  );
}

inspectorSections.push({ id: 'size', Component: BlockSize });
