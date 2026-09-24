// UI21: deleting a lane that has blocks asks first (`lane-delete-dialog`, §8.3): move the blocks to another lane or
// to Unassigned (`lane-target`, `lane-move-blocks`), delete them with the lane (`lane-delete-blocks`), or cancel
// (`confirm-no`).
import { useEffect, useRef, useState } from 'react';
import { UNASSIGNED } from '../../core/types';
import { useStore, useStoreState } from '../store/hooks';
import type { Store } from '../store/store';
import { deleteLaneMovingBlocks, deleteLaneWithBlocks, laneDeleteDialog } from './laneActions';
import { useSignal } from './signal';

export function LaneDeleteDialog() {
  const store = useStore();
  const id = useSignal(laneDeleteDialog);
  const layout = useStoreState((s) => s.shown?.layout ?? null);
  const lane = id ? layout?.lanes.find((l) => l.id === id) ?? null : null;

  // The lane went away (an external edit, an undo): nothing left to ask about.
  useEffect(() => {
    if (id && layout && !lane) laneDeleteDialog.set(null);
  }, [id, layout, lane]);

  if (!id || !lane || !layout) return null;
  // Remount per lane so the target select starts fresh.
  return <Dialog key={id} laneId={id} label={lane.label} close={() => laneDeleteDialog.set(null)} store={store} />;
}

function Dialog({ laneId, label, close, store }: { laneId: string; label: string; close: () => void; store: Store }) {
  const layout = useStoreState((s) => s.shown!.layout!);
  const targets = [
    ...layout.lanes.filter((l) => l.id !== laneId && l.id !== UNASSIGNED).map((l) => ({ id: l.id, label: l.label })),
    { id: UNASSIGNED, label: 'Unassigned' },
  ];
  const blocks = layout.nodes.filter((n) => n.lane === laneId);
  // Default target: the neighbour just above in display order (else the first other lane).
  const order = layout.lanes.map((l) => l.id);
  const at = order.indexOf(laneId);
  const neighbour = at > 0 ? order[at - 1]! : targets[0]!.id;
  const [target, setTarget] = useState(targets.some((t) => t.id === neighbour) ? neighbour : targets[0]!.id);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    selectRef.current?.focus({ preventScroll: true });
  }, []);

  const n = blocks.length;
  const noun = `${n} block${n === 1 ? '' : 's'}`;
  const sample = blocks.slice(0, 3).map((b) => b.label);

  return (
    <div className="fm-modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="fm-modal fm-lane-delete"
        data-testid="lane-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fm-lane-delete-title"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
      >
        <div className="fm-modal-message" id="fm-lane-delete-title">
          Delete the lane “{label}”?
        </div>
        <div className="fm-modal-detail">
          It has {noun}: {sample.map((s, i) => (
            <span key={i}>
              {i > 0 ? ', ' : ''}
              <span className="fm-quote">{s}</span>
            </span>
          ))}
          {n > sample.length ? ` and ${n - sample.length} more` : ''}.
        </div>

        <div className="fm-choice">
          <div className="fm-choice-text">
            <div className="fm-choice-title">Keep the blocks</div>
            <label className="fm-choice-row">
              <span>Move them to</span>
              <select
                ref={selectRef}
                className="fm-select"
                data-testid="lane-target"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="fm-btn fm-btn-primary"
            data-testid="lane-move-blocks"
            onClick={() => deleteLaneMovingBlocks(store, laneId, target)}
          >
            Move and delete lane
          </button>
        </div>

        <div className="fm-choice fm-choice-danger">
          <div className="fm-choice-text">
            <div className="fm-choice-title">Delete the blocks too</div>
            <div className="fm-choice-note">Their lines and pins go with them; their metadata stays in the config.</div>
          </div>
          <button type="button" className="fm-btn fm-btn-danger-outline" data-testid="lane-delete-blocks" onClick={() => deleteLaneWithBlocks(store, laneId)}>
            Delete lane and {noun}
          </button>
        </div>

        <div className="fm-modal-actions">
          <button type="button" className="fm-btn" data-testid="confirm-no" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
