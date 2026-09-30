// A17 (design.md §12): the home screen's brief confirmation message after a move or folder rename rewrites other
// diagrams' links. Pure formatting, so unit-tested directly rather than through Playwright.
import { linkRewriteMessage } from './links';

describe('linkRewriteMessage (A17, §12)', () => {
  it('null when nothing was rewritten (undefined or an empty list): no toast at all', () => {
    expect(linkRewriteMessage(undefined)).toBeNull();
    expect(linkRewriteMessage([])).toBeNull();
  });

  it('singular link, singular diagram', () => {
    expect(linkRewriteMessage([{ file: 'a.mmd', count: 1 }])).toBe('Updated 1 link in 1 diagram.');
  });

  it('plural links summed across diagrams, plural diagram count', () => {
    expect(linkRewriteMessage([{ file: 'a.mmd', count: 2 }, { file: 'b.mmd', count: 1 }]))
      .toBe('Updated 3 links in 2 diagrams.');
  });

  it('several links in one diagram: singular diagram, plural links', () => {
    expect(linkRewriteMessage([{ file: 'a.mmd', count: 3 }])).toBe('Updated 3 links in 1 diagram.');
  });
});
