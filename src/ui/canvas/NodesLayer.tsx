import { useMemo } from 'react';
import { linkOf } from '../../core/config';
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
  // A15: each node's link target, if it has one (the badge, and Cmd/Ctrl+click, gestures.ts).
  const configNodes = useStoreState((s) => s.shown?.doc.config?.nodes);
  const links = useMemo(() => {
    const out: Record<string, string> = {};
    for (const n of layout.nodes) {
      const t = linkOf(configNodes?.[n.id]);
      if (t) out[n.id] = t;
    }
    return out;
  }, [layout, configNodes]);
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
        // While resizing, the block is drawn as it will land: at the preview box, pinned and sized (UI34, A6).
        const r = resizing?.id === n.id;
        const box = r ? { ...n, ...resizing.box, pinned: true } : n;
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
            sized={r || !!sizes?.[n.id]}
            resizable={canResize && selected.has(n.id) && editingNode !== n.id}
            link={links[n.id] ?? null}
          />
        );
      })}
    </div>
  );
}
