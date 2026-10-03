// A18 / UI44: line styles in the editor. Importing this mounts the picker bar (shown while lines are selected) and adds
// the line context menu's `line-style` item. Both do the same thing: one `setEdgeStyle` operation, one undo step.
import { createElement } from 'react';
import { setEdgeStyle } from '../../core/ops';
import { EDGE_STYLES, type EdgeStyle } from '../../core/types';
import { overlays } from '../chrome/Panels';
import { defineMenuItem, registerMenuHandler, type MenuContext } from '../contextmenu/registry';
import { useStoreState } from '../store/hooks';
import type { Store } from '../store/store';
import { EDGE_STYLE_HINTS, EDGE_STYLE_NAMES, EdgeStyleIcon } from './EdgeStyleIcon';
import { commonStyle, EdgeStylePicker } from './EdgeStylePicker';

/** Set the style of lines; lines that already have it are left alone (and a no-change is not an undo step). */
export function setLineStyle(store: Store, ids: readonly string[], style: EdgeStyle): void {
  const edges = store.layout?.edges ?? [];
  const change = ids.filter((id) => (edges.find((e) => e.id === id)?.style ?? 'solid') !== style);
  if (change.length) store.apply(setEdgeStyle, change, style);
}

overlays.push({
  id: 'edge-style-picker',
  Component: function LineStylePicker() {
    return createElement(EdgeStylePicker, { onStyle: setLineStyle });
  },
});

// ---- The context menu's `line-style` item (UI40): the same four options, inside the menu.

defineMenuItem({
  on: 'line',
  name: 'line-style',
  label: 'Line style',
  section: 1,
  order: 2,
  icon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h4" />
      <path d="M10 12h4" />
      <path d="M17 12h3" />
      <path d="M17.5 9l3 3-3 3" />
    </svg>
  ),
});

function LineStyleControl({ ctx }: { ctx: MenuContext<'line'> }) {
  const id = ctx.target.id;
  const current = useStoreState((s) => commonStyle([s.shown?.layout?.edges.find((e) => e.id === id)?.style ?? 'solid']));
  return (
    <div className="fm-cm-shapes" role="group" aria-label="Line style">
      {EDGE_STYLES.map((style) => (
        <button
          key={style}
          type="button"
          role="menuitemradio"
          aria-checked={style === current}
          className="fm-cm-shape"
          data-edge-style={style}
          title={EDGE_STYLE_HINTS[style]}
          onClick={() => {
            ctx.close();
            setLineStyle(ctx.store, [id], style);
          }}
        >
          <EdgeStyleIcon style={style} width={30} height={14} />
          <span className="fm-cm-shape-name">{EDGE_STYLE_NAMES[style]}</span>
        </button>
      ))}
    </div>
  );
}

registerMenuHandler('line', 'line-style', { Control: LineStyleControl });
