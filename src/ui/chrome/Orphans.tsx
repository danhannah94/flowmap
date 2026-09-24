// UI27 Orphans: config `nodes` entries and `lanes` entries, and pins, for ids that aren't in the `.mmd` show in the
// error banner (W-config-unknown-node, W-config-unknown-lane, W-layout-unknown-node), each with an `orphan-delete`
// button that removes that one entry. Deleting a block never deletes its evidence, so this is the only way it goes.
import { deleteOrphanLaneEntry, deleteOrphanNodeEntry, deleteOrphanPin } from '../../core/ops';
import type { Problem } from '../../core/types';
import { useStore } from '../store/hooks';
import { problemExtras } from './Panels';
import { orphanId } from './evidence/format';
import './evidence/evidence.css';

const ORPHANS = {
  'W-config-unknown-node': { op: deleteOrphanNodeEntry, what: 'Delete this metadata entry from the config', label: 'Delete entry' },
  'W-config-unknown-lane': { op: deleteOrphanLaneEntry, what: 'Delete this lanes entry from the config', label: 'Delete entry' },
  'W-layout-unknown-node': { op: deleteOrphanPin, what: 'Delete this pin from the layout file', label: 'Delete pin' },
} as const;

function OrphanDelete({ problem }: { problem: Problem }) {
  const store = useStore();
  const spec = ORPHANS[problem.code as keyof typeof ORPHANS];
  const id = orphanId(problem.message);
  if (!spec || id === null) return null;
  return (
    <button
      type="button"
      data-testid="orphan-delete"
      className="fm-ev-orphan-btn"
      title={`${spec.what} ("${id}")`}
      onClick={() => store.apply(spec.op, id)}
    >
      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
        <path d="M4 7h16M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
      </svg>
      {spec.label}
    </button>
  );
}

for (const code of Object.keys(ORPHANS)) problemExtras.set(code, OrphanDelete);
