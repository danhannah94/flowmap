// The context menu (design.md §8.2 UI40, §8.3 `data-testid="context-menu"`, items `data-menu-item`). A right-click,
// or a two-finger click on a trackpad (both fire `contextmenu`), on a block, line, note, the title, a lane header or
// the empty canvas opens a small menu at the pointer, kept inside the window. Its items come from the registry
// (registry.ts; the UI40 slots are in items.tsx, the built-in handlers in builtin.tsx).
//
// - Right-clicking a block that isn't selected selects it; one that is part of a multi-selection keeps the selection,
//   and the items that make sense for several blocks apply to all of them. Right-clicking a line selects it.
// - Escape, a click anywhere else, the wheel, or resizing the window closes it. Arrow keys move through the items,
//   Enter or Space runs one, Right opens an item's sub-control, Left closes it; keys never reach the global shortcuts.
// - An item with a sub-control (`shape`, `colors`, `color`, `font-size`) opens it inside the menu element.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { overlays } from '../chrome/Panels';
import { toWorld } from '../canvas/viewport';
import { useSignal } from '../features/signal';
import { isTyping } from '../keyboard';
import { useStore, useStoreState } from '../store/hooks';
import {
  menuItemsFor, menuRegistryVersion, subscribeMenuRegistry, type MenuContext, type ResolvedMenuItem,
} from './registry';
import { closeContextMenu, menuTargetAt, openMenu, showContextMenu, targetExists, type OpenMenu } from './state';
import './contextmenu.css';

const MARGIN = 8;

export function ContextMenuHost() {
  const store = useStore();
  const menu = useSignal(openMenu);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return;
      if (el.closest('[data-testid="context-menu"]')) {
        e.preventDefault(); // no browser menu over ours
        return;
      }
      const canvas = el.closest<HTMLElement>('[data-testid="canvas"]');
      if (!canvas) return;
      e.preventDefault();
      const s = store.getState();
      if (s.drag || s.marquee || s.status !== 'ready') return;
      const reason = store.readOnlyReason();
      if (reason) {
        closeContextMenu();
        store.toast(reason, 'info');
        return;
      }
      // The element actually under the pointer (a gesture's pointer capture can retarget events to the canvas).
      const under = document.elementFromPoint(e.clientX, e.clientY) ?? el;
      const target = menuTargetAt(canvas.contains(under) ? under : el, s);
      if (!target) return;
      if (target.kind === 'block' && target.ids.length === 1) {
        const sel = s.selection;
        if (!(sel.nodes.length === 1 && sel.nodes[0] === target.clicked && sel.edges.length === 0)) store.select({ nodes: [target.clicked] });
      } else if (target.kind === 'line') {
        const sel = s.selection;
        if (!(sel.edges.length === 1 && sel.edges[0] === target.id && sel.nodes.length === 0)) store.select({ edges: [target.id] });
      }
      const r = canvas.getBoundingClientRect();
      const world = toWorld(s.viewport, { x: e.clientX - r.left, y: e.clientY - r.top });
      showContextMenu(target, world, { x: e.clientX, y: e.clientY });
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      closeContextMenu();
    };
  }, [store]);

  if (!menu) return null;
  return createPortal(<Menu key={menu.seq} menu={menu} />, document.body);
}

interface Section {
  key: number;
  title: string | null;
  rows: ResolvedMenuItem[];
  tiles: ResolvedMenuItem[];
}

function sectionsOf(items: readonly ResolvedMenuItem[]): Section[] {
  const out: Section[] = [];
  for (const item of items) {
    let sec = out[out.length - 1];
    if (!sec || sec.key !== item.def.section) {
      sec = { key: item.def.section, title: null, rows: [], tiles: [] };
      out.push(sec);
    }
    sec.title ??= item.def.sectionTitle ?? null;
    (item.def.tile ? sec.tiles : sec.rows).push(item);
  }
  return out;
}

function Menu({ menu }: { menu: OpenMenu }) {
  const store = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [control, setControl] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Re-render on any store change (a "shows when" fact may change) and when a feature registers a handler.
  const state = useStoreState((s) => s);
  useSyncExternalStore(subscribeMenuRegistry, menuRegistryVersion, menuRegistryVersion);
  const ctx = useMemo<MenuContext>(
    () => ({ store, target: menu.target, world: menu.world, close: closeContextMenu }),
    [store, menu],
  );
  const exists = targetExists(menu.target, state);
  const items = exists ? menuItemsFor(ctx) : [];
  const empty = items.length === 0;

  useEffect(() => {
    if (empty) closeContextMenu();
  }, [empty]);

  // Close on a press elsewhere, the wheel, a window resize; Escape when the focus isn't in the menu.
  useEffect(() => {
    const inside = (t: EventTarget | null) => t instanceof Node && !!ref.current?.contains(t);
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) closeContextMenu();
    };
    const onWheel = (e: WheelEvent) => {
      if (!inside(e.target)) closeContextMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || inside(e.target)) return;
      e.preventDefault();
      e.stopPropagation(); // Escape closes the menu only; it doesn't also clear the selection
      closeContextMenu();
    };
    const onResize = () => closeContextMenu();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // Place at the pointer, inside the window: flip to the pointer's left when it would overflow the right edge, and
  // shift up as much as needed at the bottom (also when a sub-control opens and the menu grows).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const { x, y } = menu.client;
      let left = x + 2;
      if (left + w > window.innerWidth - MARGIN) left = x - w - 2;
      left = Math.max(MARGIN, Math.min(left, window.innerWidth - MARGIN - w));
      const top = Math.max(MARGIN, Math.min(y + 2, window.innerHeight - MARGIN - h));
      setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [menu, empty]);

  // Once placed, take the keyboard (the menu itself, nothing highlighted yet, like a native menu).
  const placed = pos !== null;
  useEffect(() => {
    if (placed) ref.current?.focus({ preventScroll: true });
  }, [placed]);

  if (empty) return null;

  const focusables = () =>
    [...(ref.current?.querySelectorAll<HTMLElement>('[data-menu-item]:not([aria-disabled="true"])') ?? [])];

  const activate = (item: ResolvedMenuItem) => {
    if (item.disabled) return;
    if (item.handler.Control) {
      setControl(item.def.name);
      return;
    }
    closeContextMenu();
    item.handler.run?.(ctx);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // keys in the menu never reach the global shortcuts (arrows would nudge)
    if (e.key === 'Escape') {
      e.preventDefault();
      closeContextMenu();
      return;
    }
    if (isTyping(e.target)) return; // a sub-control's input handles its own keys
    const list = focusables();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();
    const current = at >= 0 ? items.find((it) => it.def.name === list[at]!.dataset.menuItem) : undefined;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusAt(at < 0 ? 0 : at + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusAt(at < 0 ? list.length - 1 : at - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(list.length - 1);
        break;
      case 'ArrowRight':
        if (current?.handler.Control) {
          e.preventDefault();
          activate(current);
          requestAnimationFrame(() => {
            ref.current?.querySelector<HTMLElement>('[data-menu-control] button, [data-menu-control] input')?.focus();
          });
        }
        break;
      case 'ArrowLeft':
        if (control) {
          e.preventDefault();
          const name = control;
          setControl(null);
          requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-menu-item="${CSS.escape(name)}"]`)?.focus());
        }
        break;
      case 'Enter':
      case ' ':
        if (at < 0) e.preventDefault();
        break;
      default:
    }
  };

  const target = menu.target;
  const header = target.kind === 'block' && target.ids.length > 1 ? `${target.ids.length} blocks` : null;
  return (
    <div
      ref={ref}
      className="fm-cm"
      data-testid="context-menu"
      data-menu-on={target.kind}
      data-canvas-control
      role="menu"
      aria-label={`${target.kind === 'canvas' ? 'Canvas' : target.kind} menu`}
      tabIndex={-1}
      style={{ left: pos?.left ?? menu.client.x, top: pos?.top ?? menu.client.y, visibility: pos ? undefined : 'hidden' }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {header ? <div className="fm-cm-header">{header}</div> : null}
      {sectionsOf(items).map((sec, i) => (
        <Fragment key={sec.key}>
          {i > 0 ? <div className="fm-cm-sep" role="separator" /> : null}
          {sec.title ? <div className="fm-cm-section-title">{sec.title}</div> : null}
          {sec.rows.map((item) => (
            <Row key={item.def.name} item={item} open={control === item.def.name} ctx={ctx} onActivate={activate} />
          ))}
          {sec.tiles.length ? (
            <div className="fm-cm-tiles" role="group" aria-label={sec.title ?? undefined}>
              {sec.tiles.map((item) => (
                <button
                  key={item.def.name}
                  type="button"
                  role="menuitem"
                  className="fm-cm-tile"
                  data-menu-item={item.def.name}
                  aria-disabled={item.disabled ? 'true' : undefined}
                  title={item.disabled ?? item.label}
                  onClick={() => activate(item)}
                >
                  <span className="fm-cm-tile-icon">{item.def.icon}</span>
                  <span className="fm-cm-tile-label">{item.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

function Row({ item, open, ctx, onActivate }: {
  item: ResolvedMenuItem;
  open: boolean;
  ctx: MenuContext;
  onActivate: (item: ResolvedMenuItem) => void;
}) {
  const { def, handler } = item;
  const Control = handler.Control;
  const checkable = item.checked !== null;
  return (
    <>
      <button
        type="button"
        role={checkable ? 'menuitemcheckbox' : 'menuitem'}
        className={`fm-cm-item${def.danger ? ' fm-cm-danger' : ''}${open ? ' fm-cm-open' : ''}`}
        data-menu-item={def.name}
        aria-checked={checkable ? item.checked! : undefined}
        aria-disabled={item.disabled ? 'true' : undefined}
        aria-haspopup={Control ? 'true' : undefined}
        aria-expanded={Control ? open : undefined}
        title={item.disabled ?? undefined}
        onClick={() => onActivate(item)}
      >
        <span className="fm-cm-icon">{def.icon}</span>
        <span className="fm-cm-label">{item.label}</span>
        {checkable ? <span className="fm-cm-check" aria-hidden="true">{item.checked ? CHECK : null}</span> : null}
        {def.hint && !Control ? <span className="fm-cm-hint">{def.hint}</span> : null}
        {Control ? <span className="fm-cm-chevron" aria-hidden="true">{CHEVRON}</span> : null}
      </button>
      {Control && open ? (
        <div className="fm-cm-control" data-menu-control={def.name}>
          <Control ctx={ctx} />
        </div>
      ) : null}
    </>
  );
}

const CHECK = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 12 5 5 9-10" />
  </svg>
);

const CHEVRON = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

overlays.push({ id: 'context-menu', Component: ContextMenuHost });
