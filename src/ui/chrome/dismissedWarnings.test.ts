// Dismissing warnings (UI31 amendment): keyed by code+message (not line), persisted per diagram, forgotten once the
// warning's cause is fixed. `localStorage` isn't a Node global, so these tests stub one in, including a version that
// throws, to exercise the try/catch fallback the owner asked for.
import { loadDismissed, pruneDismissed, saveDismissed, warningKey } from './dismissedWarnings';

class FakeStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? this.store.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
}

describe('warningKey', () => {
  test('is code + message, not line: two warnings differing only by line share a key', () => {
    const a = { code: 'W-style', line: 3, message: 'bad font_size' };
    const b = { code: 'W-style', line: 41, message: 'bad font_size' };
    expect(warningKey(a)).toBe(warningKey(b));
  });

  test('differs by code or by message', () => {
    const base = { code: 'W-style', line: 1, message: 'bad font_size' };
    expect(warningKey(base)).not.toBe(warningKey({ ...base, code: 'W-no-lane' }));
    expect(warningKey(base)).not.toBe(warningKey({ ...base, message: 'bad color' }));
  });
});

describe('loadDismissed / saveDismissed', () => {
  const realLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;
  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = realLocalStorage;
  });

  test('round-trips through storage, namespaced per file', () => {
    (globalThis as unknown as { localStorage: FakeStorage }).localStorage = new FakeStorage();
    saveDismissed('a.mmd', new Set(['x', 'y']));
    saveDismissed('b.mmd', new Set(['z']));
    expect(loadDismissed('a.mmd')).toEqual(new Set(['x', 'y']));
    expect(loadDismissed('b.mmd')).toEqual(new Set(['z']));
    expect(loadDismissed('nothing-saved.mmd')).toEqual(new Set());
  });

  test('saving an empty set clears the entry instead of leaving `[]` around', () => {
    const fake = new FakeStorage();
    (globalThis as unknown as { localStorage: FakeStorage }).localStorage = fake;
    saveDismissed('a.mmd', new Set(['x']));
    saveDismissed('a.mmd', new Set());
    expect(fake.getItem('flowmap.dismissed-warnings.a.mmd')).toBeNull();
  });

  test('garbage in storage reads back as empty, not a throw', () => {
    const fake = new FakeStorage();
    fake.setItem('flowmap.dismissed-warnings.a.mmd', 'not json{');
    (globalThis as unknown as { localStorage: FakeStorage }).localStorage = fake;
    expect(loadDismissed('a.mmd')).toEqual(new Set());
  });

  test('storage that throws (private mode, disabled) never throws out of load or save', () => {
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem() {
        throw new Error('storage disabled');
      },
      setItem() {
        throw new Error('storage disabled');
      },
      removeItem() {
        throw new Error('storage disabled');
      },
    };
    expect(() => loadDismissed('a.mmd')).not.toThrow();
    expect(loadDismissed('a.mmd')).toEqual(new Set());
    expect(() => saveDismissed('a.mmd', new Set(['x']))).not.toThrow();
  });

  test('no global localStorage at all also degrades quietly', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadDismissed('a.mmd')).toEqual(new Set());
    expect(() => saveDismissed('a.mmd', new Set(['x']))).not.toThrow();
  });
});

describe('pruneDismissed', () => {
  test('keeps only keys still present among the active warnings', () => {
    const dismissed = new Set(['k1', 'k2', 'k3']);
    const active = new Set(['k2', 'k4']);
    expect(pruneDismissed(dismissed, active)).toEqual(new Set(['k2']));
  });

  test('fixing the cause (the key disappears) forgets the dismissal entirely', () => {
    const dismissed = new Set(['k1']);
    expect(pruneDismissed(dismissed, new Set())).toEqual(new Set());
  });
});
