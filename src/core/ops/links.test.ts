// A15: setting and clearing a block's link through the operations layer (design.md §4 "Setting a link"). Parity
// with the equivalent hand edit (§8.1), a refused malformed target, and that the generic field form can't be used to
// write `link` (it's reserved, like `style`).
import { clearNodeLink, removeNodeField, setNodeField, setNodeLink } from './index';
import { edit, expectParity, ok, PR, refused } from './testkit';

// PR's `m02` has no config entry yet; `p05` already has one with several fields (fixtures/purchase-request).
describe('A15 setNodeLink / clearNodeLink: parity with a hand edit', () => {
  test('a block with no entry gets a new one, appended at the end of nodes', () => {
    expectParity(setNodeLink(PR, 'm02', 'brehob/stage-2'), PR, {
      config: edit(PR.config!, ['nodes:\n', 'nodes:\n  m02:\n    link: brehob/stage-2\n']),
    });
  });

  test('a block with an entry gets the field appended at its end', () => {
    expectParity(setNodeLink(PR, 'p05', 'brehob/stage-2'), PR, {
      config: edit(
        PR.config!,
        ['      warehouse: one quote is fine under $5,000\n', '      warehouse: one quote is fine under $5,000\n    link: brehob/stage-2\n'],
      ),
    });
  });

  test('accepts a pasted .mmd name and backslashes, normalising them', () => {
    expectParity(setNodeLink(PR, 'm02', 'Brehob\\Stage-2.MMD'), PR, {
      config: edit(PR.config!, ['nodes:\n', 'nodes:\n  m02:\n    link: Brehob/Stage-2\n']),
    });
  });

  test('changing an existing link rewrites it in place', () => {
    const withLink = ok(setNodeLink(PR, 'm02', 'a')).files;
    expectParity(setNodeLink(withLink, 'm02', 'b'), withLink, {
      config: edit(withLink.config!, ['link: a', 'link: b']),
    });
  });

  test('clearing removes the field, and the entry too when link was its only field', () => {
    const withLink = ok(setNodeLink(PR, 'm02', 'a')).files;
    expectParity(clearNodeLink(withLink, 'm02'), withLink, {
      config: edit(withLink.config!, ['  m02:\n    link: a\n', '']),
    });
  });

  test('clearing a field on a block with other evidence keeps its entry', () => {
    const withLink = ok(setNodeLink(PR, 'p05', 'a')).files;
    expectParity(clearNodeLink(withLink, 'p05'), withLink, {
      config: edit(withLink.config!, ['\n    link: a\n', '\n']),
    });
  });

  test('a malformed target is refused, writing nothing', () => {
    expect(refused(setNodeLink(PR, 'p05', '/absolute'))).toMatch(/valid diagram path/);
    expect(refused(setNodeLink(PR, 'p05', ''))).toMatch(/valid diagram path/);
  });

  test('a .. segment is accepted (a warning, not a refusal, §4): the UI decides whether to follow it', () => {
    expectParity(setNodeLink(PR, 'm02', '../outside'), PR, {
      config: edit(PR.config!, ['nodes:\n', 'nodes:\n  m02:\n    link: ../outside\n']),
    });
  });

  test('an unknown block is refused', () => {
    expect(refused(setNodeLink(PR, 'nope', 'a'))).toMatch(/no block/);
    expect(refused(clearNodeLink(PR, 'nope'))).toMatch(/no block/);
  });
});

describe('A15: link is reserved, like style (§4)', () => {
  test('the generic field form refuses "link" as a key', () => {
    expect(refused(setNodeField(PR, 'p05', 'link', { type: 'text', value: 'a' }))).toMatch(/Links to field/);
    const withLink = ok(setNodeLink(PR, 'p05', 'a')).files;
    expect(refused(removeNodeField(withLink, 'p05', 'link'))).toMatch(/Links to field/);
  });
});
