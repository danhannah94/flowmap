// A15: a block's link to another diagram (design.md §4). Pure-helper unit tests: target-shape validation, path
// normalisation and the traversal guard, the `W-link-missing`/`W-link-traversal` checks, and that `link` (unlike
// `style`) still participates in style matching.
import {
  checkLinks, isWellFormedLinkTarget, linkHasTraversal, linkOf, linkTargetsByNode, linkTargetToMmdPath,
  matchFields, movedLinkTarget, normalizeLinkTarget, parseConfig, renamedFolderLinkTarget, ruleMatches,
} from './index';
import type { FlowConfig } from './model';

describe('isWellFormedLinkTarget', () => {
  it.each([
    'stage-2',
    'sales/stage-2',
    'sales/bc-api/v3-2-complete',
    'a.b-c_d',
    '..', // well-formed (a lone traversal segment); linkHasTraversal flags it separately
    '../sibling',
  ])('%s is well-formed', (t) => {
    expect(isWellFormedLinkTarget(t)).toBe(true);
  });

  it.each([
    '', ' stage-2', 'stage-2 ', '/stage-2', 'stage-2/', 'a//b', 'a\\b', 'C:\\diagrams\\a', 'a/ /b', 'a/b|c',
  ])('%s is not well-formed', (t) => {
    expect(isWellFormedLinkTarget(t)).toBe(false);
  });
});

describe('linkHasTraversal', () => {
  it('true for any .. segment, false otherwise', () => {
    expect(linkHasTraversal('../outside')).toBe(true);
    expect(linkHasTraversal('a/../b')).toBe(true);
    expect(linkHasTraversal('a/b')).toBe(false);
    expect(linkHasTraversal('a..b')).toBe(false); // ".." only counts as a whole segment
  });
});

describe('linkTargetToMmdPath', () => {
  it('appends .mmd for a well-formed target, null otherwise', () => {
    expect(linkTargetToMmdPath('sales/stage-2')).toBe('sales/stage-2.mmd');
    expect(linkTargetToMmdPath('/abs')).toBeNull();
  });
});

describe('normalizeLinkTarget', () => {
  it('trims, drops a trailing .mmd (any case) and a trailing slash, and turns backslashes into forward slashes', () => {
    expect(normalizeLinkTarget('  sales/stage-2  ')).toBe('sales/stage-2');
    expect(normalizeLinkTarget('sales/stage-2.mmd')).toBe('sales/stage-2');
    expect(normalizeLinkTarget('sales/stage-2.MMD')).toBe('sales/stage-2');
    expect(normalizeLinkTarget('sales\\stage-2')).toBe('sales/stage-2');
    expect(normalizeLinkTarget('sales/stage-2/')).toBe('sales/stage-2');
  });

  it('null when the result is not well-formed', () => {
    expect(normalizeLinkTarget('/absolute')).toBeNull();
    expect(normalizeLinkTarget('')).toBeNull();
    expect(normalizeLinkTarget('   ')).toBeNull();
  });
});

function configWith(nodes: Record<string, Record<string, unknown>>): FlowConfig {
  const { config } = parseConfig(null);
  return { ...config!, nodes };
}

describe('linkOf', () => {
  it('the text value when link is a scalar; null when absent or not a scalar', () => {
    expect(linkOf({ link: 'sales/stage-2' })).toBe('sales/stage-2');
    expect(linkOf({ link: 2 })).toBe('2');
    expect(linkOf({})).toBeNull();
    expect(linkOf(undefined)).toBeNull();
    expect(linkOf({ link: ['a', 'b'] })).toBeNull();
  });
});

describe('checkLinks', () => {
  it('no problems for a link that exists (self included) or no link at all', () => {
    const config = configWith({ a: { link: 'b' }, b: {}, c: { link: 'c' } });
    expect(checkLinks(config, ['a', 'b', 'c'], (t) => ['a', 'b', 'c'].includes(t))).toEqual([]);
  });

  it('W-link-missing for a well-formed target that does not exist', () => {
    const config = configWith({ a: { link: 'nope' } });
    const problems = checkLinks(config, ['a'], () => false);
    expect(problems).toEqual([{ code: 'W-link-missing', line: null, message: expect.stringContaining('nope') }]);
  });

  it('W-link-missing for a malformed target (never gets to the exists check)', () => {
    const exists = vi.fn(() => true);
    const config = configWith({ a: { link: '/absolute' } });
    const problems = checkLinks(config, ['a'], exists);
    expect(problems).toEqual([{ code: 'W-link-missing', line: null, message: expect.stringContaining('absolute') }]);
    expect(exists).not.toHaveBeenCalled();
  });

  it('W-link-traversal (not W-link-missing) for a .. segment, error-free', () => {
    const config = configWith({ a: { link: '../outside' } });
    const problems = checkLinks(config, ['a'], () => false);
    expect(problems).toEqual([{ code: 'W-link-traversal', line: null, message: expect.stringContaining('outside') }]);
  });

  it('null config: no problems', () => {
    expect(checkLinks(null, ['a'], () => false)).toEqual([]);
  });
});

describe('linkTargetsByNode', () => {
  it('only well-formed, non-traversing targets, keyed by node id', () => {
    const config = configWith({ a: { link: 'b' }, b: {}, c: { link: '../out' }, d: { link: '/bad' } });
    expect(linkTargetsByNode(config, ['a', 'b', 'c', 'd'])).toEqual({ a: 'b' });
  });
});

// ---- style matching (§4): `link` is a reserved key like `style`, but unlike `style` it must still match ----------

describe('link stays a matchable field, unlike style', () => {
  it('a rule matching {link: present} applies to a node with a link and not to one without', () => {
    const config = configWith({ a: { link: 'b' }, b: {} });
    const fieldsA = matchFields(config, { id: 'a', lane: '_unassigned', label: 'A', kind: 'step' });
    const fieldsB = matchFields(config, { id: 'b', lane: '_unassigned', label: 'B', kind: 'step' });
    const rule = { legend: null, match: [{ field: 'link', op: 'present' as const, value: 'present' }], style: {}, rawStyle: {} };
    expect(ruleMatches(rule, fieldsA)).toBe(true);
    expect(ruleMatches(rule, fieldsB)).toBe(false);
  });

  it('a rule matching a link\'s exact value also works', () => {
    const config = configWith({ a: { link: 'sales/stage-2' } });
    const fields = matchFields(config, { id: 'a', lane: '_unassigned', label: 'A', kind: 'step' });
    const rule = { legend: null, match: [{ field: 'link', op: 'equals' as const, value: 'sales/stage-2' }], style: {}, rawStyle: {} };
    expect(ruleMatches(rule, fields)).toBe(true);
  });
});

// ---- A17 (§12): remapping a link target after a diagram moves or its folder is renamed ----------------------

describe('movedLinkTarget', () => {
  it('an exact match becomes the new id', () => {
    expect(movedLinkTarget('sales/stage-2', 'sales/stage-2', 'sales/hub/stage-2')).toBe('sales/hub/stage-2');
  });

  it('a self-link (equal to the old id) is corrected the same way', () => {
    expect(movedLinkTarget('stage-2', 'stage-2', 'sales/stage-2')).toBe('sales/stage-2');
  });

  it('anything else is untouched (null)', () => {
    expect(movedLinkTarget('sales/stage-3', 'sales/stage-2', 'sales/hub/stage-2')).toBeNull();
    expect(movedLinkTarget('sales/stage-2x', 'sales/stage-2', 'sales/hub/stage-2')).toBeNull();
  });
});

describe('renamedFolderLinkTarget', () => {
  it('a link inside the renamed folder keeps its tail', () => {
    expect(renamedFolderLinkTarget('sales/stage-2', 'sales', 'sales-team')).toBe('sales-team/stage-2');
  });

  it('a nested link keeps its whole suffix', () => {
    expect(renamedFolderLinkTarget('sales/hub/stage-2', 'sales', 'sales-team')).toBe('sales-team/hub/stage-2');
  });

  it('a nested-folder rename only touches links inside that subfolder', () => {
    expect(renamedFolderLinkTarget('a/b/x', 'a/b', 'a/c')).toBe('a/c/x');
    expect(renamedFolderLinkTarget('a/other', 'a/b', 'a/c')).toBeNull();
  });

  it('is prefix-safe: a same-prefixed sibling is not a match', () => {
    expect(renamedFolderLinkTarget('sales-other/x', 'sales', 'sales-team')).toBeNull();
    expect(renamedFolderLinkTarget('salesx/x', 'sales', 'sales-team')).toBeNull();
    expect(renamedFolderLinkTarget('a/bc/x', 'a/b', 'a/c')).toBeNull();
  });

  it('a link outside the folder entirely is untouched', () => {
    expect(renamedFolderLinkTarget('other/x', 'sales', 'sales-team')).toBeNull();
  });
});
