// The guides shown while a drag is snapped (UI39, `snap-guide`): transient drag state, kept out of the store so a
// pointer move that doesn't change the snap re-renders nothing. `SnapGuides.tsx` draws them.
import { signal } from '../features/signal';
import type { SnapGuide } from './snap';

export const snapGuides = signal<readonly SnapGuide[]>([]);

const same = (a: readonly SnapGuide[], b: readonly SnapGuide[]) =>
  a.length === b.length && a.every((g, i) => g.axis === b[i]!.axis && g.at === b[i]!.at && g.role === b[i]!.role);

export function showSnapGuides(guides: readonly SnapGuide[]): void {
  snapGuides.set((cur) => (same(cur, guides) ? cur : guides));
}

export function clearSnapGuides(): void {
  snapGuides.set((cur) => (cur.length ? [] : cur));
}
