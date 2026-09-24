// The lane menu (UI19–UI21, §8.3): an opener inside each lane header (`data-testid="lane-menu"`, via
// `setLaneHeaderExtras`) and a popover with rename, id, move up/down and delete. The popover is rendered by the
// feature host outside the canvas, so it is never scaled or clipped by the canvas.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { UNASSIGNED } from '../../core/types';
import { editable } from '../commands/types';
import type { LayoutLane } from '../canvas/geometry';
import { useStore, useStoreState } from '../store/hooks';
import {
  blocksIn, editLaneId, editLaneLabel, laneMenu, moveLaneBy, movableLanes, requestDeleteLane,
} from './laneActions';
import { useSignal } from './signal';

/** The opener inside a lane header. Unassigned has none: it can't be renamed, moved or deleted. */
export function LaneMenuButton({ lane }: { lane: LayoutLane }) {
  const menu = useSignal(laneMenu);
  const canEdit = useStoreState(editable);
  if (lane.id === UNASSIGNED || !canEdit) return null;
  const open = menu?.lane === lane.id;
  return (
    <button
      type="button"
      className={`fm-lane-menu-btn${open ? ' fm-open' : ''}`}
      data-testid="lane-menu"
      title="Lane options"
      aria-label={`Options for lane ${lane.label}`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={(e) => {
        const anchor = e.currentTarget.getBoundingClientRect();
        laneMenu.set((cur) => (cur?.lane === lane.id ? null : { lane: lane.id, anchor }));
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="3.5" cy="8" r="1.4" fill="currentColor" />
        <circle cx="8" cy="8" r="1.4" fill="currentColor" />
        <circle cx="12.5" cy="8" r="1.4" fill="currentColor" />
      </svg>
    </button>
  );
}

const MENU_WIDTH = 228;

/** The popover for the open lane menu (mounted once by the feature host). */
export function LaneMenuPopover() {
  const store = useStore();
  const menu = useSignal(laneMenu);
  const lane = useStoreState((s) => (menu ? s.shown?.layout?.lanes.find((l) => l.id === menu.lane) ?? null : null));
  const viewport = useStoreState((s) => s.viewport);
  const direction = useStoreState((s) => s.shown?.layout?.direction ?? 'LR');
  const ref = useRef<HTMLDivElement>(null);
  const openedAt = useRef(viewport);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Close when the lane goes away, or when the canvas pans or zooms under the menu.
  useEffect(() => {
    if (menu && !lane) laneMenu.set(null);
  }, [menu, lane]);
  useEffect(() => {
    if (menu) openedAt.current = viewport;
  }, [menu]);
  useEffect(() => {
    if (menu && viewport !== openedAt.current) laneMenu.set(null);
  }, [menu, viewport]);

  // Outside pointerdown closes (the openers toggle themselves).
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('.fm-lane-popover, [data-testid="lane-menu"]')) return;
      laneMenu.set(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [menu]);

  // Place against the opener, flipping to stay on screen; focus the first item for the keyboard.
  useLayoutEffect(() => {
    if (!menu) {
      setPos(null);
      return;
    }
    const el = ref.current;
    const a = menu.anchor;
    const h = el?.offsetHeight ?? 240;
    let left = a.right + 6;
    let top = a.top - 4;
    if (direction === 'TB' || left + MENU_WIDTH > window.innerWidth - 8) {
      left = Math.min(a.left, window.innerWidth - MENU_WIDTH - 8);
      top = a.bottom + 6;
    }
    if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 6);
    setPos({ left: Math.max(8, left), top });
  }, [menu, direction]);
  useEffect(() => {
    if (pos) ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [pos]);

  if (!menu || !lane) return null;
  const order = movableLanes(store).map((l) => l.id);
  const index = order.indexOf(lane.id);
  const first = index <= 0;
  const last = index === order.length - 1;
  const tb = direction === 'TB';
  const count = blocksIn(store, lane.id).length;

  const close = (refocus: boolean) => {
    laneMenu.set(null);
    if (refocus) {
      document.querySelector<HTMLElement>(`[data-lane-header="${CSS.escape(lane.id)}"] [data-testid="lane-menu"]`)?.focus();
    }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Keys inside the menu never reach the global shortcuts (arrows would nudge the selection).
    e.stopPropagation();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div
      ref={ref}
      className="fm-lane-popover"
      role="menu"
      aria-label={`Lane ${lane.label}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: MENU_WIDTH }}
      onKeyDown={onKeyDown}
    >
      <div className="fm-menu-head">
        <span className="fm-menu-title" title={lane.label}>{lane.label}</span>
        <span className="fm-menu-sub">
          <code>{lane.id}</code> · {count === 0 ? 'empty' : `${count} block${count === 1 ? '' : 's'}`}
        </span>
      </div>
      <MenuItem testid="lane-rename-label" hint="Double-click" onClick={() => editLaneLabel(store, lane.id)} icon={ICON.pencil}>
        Rename
      </MenuItem>
      <MenuItem testid="lane-rename-id" onClick={() => editLaneId(store, lane.id)} icon={ICON.hash}>
        Change id…
      </MenuItem>
      <div className="fm-menu-sep" role="separator" />
      <MenuItem testid="lane-up" muted={first} onClick={() => moveLaneBy(store, lane.id, 'up')} icon={tb ? ICON.left : ICON.up}>
        {tb ? 'Move left' : 'Move up'}
      </MenuItem>
      <MenuItem testid="lane-down" muted={last} onClick={() => moveLaneBy(store, lane.id, 'down')} icon={tb ? ICON.right : ICON.down}>
        {tb ? 'Move right' : 'Move down'}
      </MenuItem>
      <div className="fm-menu-sep" role="separator" />
      <MenuItem testid="lane-delete" danger onClick={() => requestDeleteLane(store, lane.id)} icon={ICON.trash}>
        {count === 0 ? 'Delete lane' : 'Delete lane…'}
      </MenuItem>
    </div>
  );
}

function MenuItem(props: {
  testid: string;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  hint?: string;
  danger?: boolean;
  /** Does nothing right now (first lane up, last lane down): shown muted but still clickable, as a no-op. */
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`fm-menu-item${props.danger ? ' fm-danger' : ''}${props.muted ? ' fm-muted-item' : ''}`}
      data-testid={props.testid}
      // Not aria-disabled: it stays a clickable no-op (ruling R6.9), only muted, with a tooltip saying why.
      title={props.muted ? 'Already at the end' : undefined}
      onClick={props.onClick}
    >
      <span className="fm-menu-icon">{props.icon}</span>
      <span className="fm-menu-label">{props.children}</span>
      {props.hint ? <span className="fm-menu-hint">{props.hint}</span> : null}
    </button>
  );
}

const svg = (d: string) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const ICON = {
  pencil: svg('M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4'),
  hash: svg('M5 9h14M5 15h14M10 4 8 20M16 4l-2 16'),
  up: svg('M12 19V5M6 11l6-6 6 6'),
  down: svg('M12 5v14M6 13l6 6 6-6'),
  left: svg('M19 12H5M11 6l-6 6 6 6'),
  right: svg('M5 12h14M13 6l6 6-6 6'),
  trash: svg('M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3'),
};
