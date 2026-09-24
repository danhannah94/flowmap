// React bindings for the store: `useStore()` for actions, `useStoreState(selector)` for a slice of state. A component
// re-renders only when its selected slice changes (compared with `Object.is`, or `shallow` for arrays and objects).
import { createContext, useContext, useRef, useSyncExternalStore } from 'react';
import type { State, Store } from './store';

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore: no <StoreContext.Provider>');
  return store;
}

export function useStoreState<T>(selector: (s: State) => T, equal: (a: T, b: T) => boolean = Object.is): T {
  const store = useStore();
  const memo = useRef<{ state: State; value: T; selector: (s: State) => T } | null>(null);
  const get = () => {
    const state = store.getState();
    const m = memo.current;
    if (m && m.state === state && m.selector === selector) return m.value;
    const value = selector(state);
    if (m && equal(m.value, value)) {
      memo.current = { state, value: m.value, selector };
      return m.value;
    }
    memo.current = { state, value, selector };
    return value;
  };
  return useSyncExternalStore(store.subscribe, get, get);
}

/** Shallow equality for arrays and plain objects. */
export function shallow<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => Object.is(v, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
