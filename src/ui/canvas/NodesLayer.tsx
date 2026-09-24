import { useMemo } from 'react';
import { resolveStyle, type Theme } from '../../core/theme';
import type { LayoutResult, ResolvedStyle } from '../../core/types';
import { shallow, useStoreState } from '../store/hooks';
import { NodeView } from './NodeView';
import { useResizePreview } from './ResizeHandles';

export function NodesLayer({ layout, styles, theme }: { layout: LayoutResult; styles: Record<string, ResolvedStyle>; theme: Theme }) {
  const selectedNodes = useStoreState((s) => s.selection.nodes, shallow);
  const drag = useStoreState((s) => s.drag);
  const editingNode = useStoreState((s) => (s.editing?.target.kind === 'node' ? s.editing.target.id ?? null : null));
  const selected = useMemo(() => new Set(selectedNodes), [selectedNodes]);
  // v1.1 UI34: stored sizes (`data-sized`), who shows resize handles, and the box of a block being resized.
  const sizes = useStoreState((s) => s.shown?.doc.sizes);
  const canResize = useStoreState((s) => s.selection.nodes.length === 1 && !!s.derived && !s.derived.readOnly && !s.derived.layoutBroken);
  const resizing = useResizePreview();
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
        const box = resizing?.id === n.id ? { ...n, ...resizing.box } : n;
        return (
          <NodeView
            key={n.id}
            node={box}
            style={resolved[n.id]!}
            direction={layout.direction}
            selected={selected.has(n.id)}
            dx={m ? drag!.dx : 0}
            dy={m ? drag!.dy : 0}
            dragging={m}
            editing={editingNode === n.id}
            sized={!!sizes?.[n.id]}
            resizable={canResize && selected.has(n.id) && editingNode !== n.id}
          />
        );
      })}
    </div>
  );
}
