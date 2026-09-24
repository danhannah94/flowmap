import { useMemo } from 'react';
import { resolveStyle, type Theme } from '../../core/theme';
import type { LayoutResult, ResolvedStyle } from '../../core/types';
import { shallow, useStoreState } from '../store/hooks';
import { NodeView } from './NodeView';

export function NodesLayer({ layout, styles, theme }: { layout: LayoutResult; styles: Record<string, ResolvedStyle>; theme: Theme }) {
  const selectedNodes = useStoreState((s) => s.selection.nodes, shallow);
  const drag = useStoreState((s) => s.drag);
  const editingNode = useStoreState((s) => (s.editing?.target.kind === 'node' ? s.editing.target.id ?? null : null));
  const selected = useMemo(() => new Set(selectedNodes), [selectedNodes]);
  const moving = useMemo(() => new Set(drag?.ids ?? []), [drag?.ids]);
  const resolved = useMemo(() => {
    const out: Record<string, ReturnType<typeof resolveStyle>> = {};
    for (const n of layout.nodes) out[n.id] = resolveStyle(styles[n.id], theme);
    return out;
  }, [layout, styles, theme]);
  return (
    <div className="fm-nodes">
      {layout.nodes.map((n) => {
        const m = moving.has(n.id);
        return (
          <NodeView
            key={n.id}
            node={n}
            style={resolved[n.id]!}
            direction={layout.direction}
            selected={selected.has(n.id)}
            dx={m ? drag!.dx : 0}
            dy={m ? drag!.dy : 0}
            dragging={m}
            editing={editingNode === n.id}
          />
        );
      })}
    </div>
  );
}
