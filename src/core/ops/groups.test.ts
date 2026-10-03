// Amendment A19: operations with groups. Moving blocks into, out of and between groups (UI11 with groups, the
// inspector's group select), pins that record the group (§5), deleting a lane with groups (UI21), paste and duplicate
// (A12), and the layout file's `group` key. Parity style as in nodes.test.ts: each result equals the hand edit after
// `fmt`.
import { loadDocument } from '../document';
import { parseLayoutFile, serializeLayoutFile } from '../layoutfile';
import {
  addNode, addNodeAt, deleteLane, duplicateNodes, moveNodesToGroup, moveNodesToLane, pasteFragment, copyFragment,
  pinNodes, renameNode, resizeNode, type Files,
} from './index';
import { blockGroupAt } from './frame';
import { edit, editJson, expectParity, ok, refused } from './testkit';

const MMD = `flowchart LR

  subgraph acct [Account]
    gw["Gateway"]
    subgraph net [Network]
      lb["Load balancer"]
      subgraph sub-a [Subnet A]
        %% the app tier
        app["App"]
      end
      subgraph sub-b [Subnet B]
        db[("Database")]
      end
    end
  end

  subgraph ops [Operations]
    oncall(["On call"])
    subgraph tools [Tools]
      pager["Pager"]
    end
  end

  gw --> lb
  lb --> app
  app --> db
  db --> pager
`;
const LAYOUT = `{
  "version": 1,
  "nodes": {
    "app": { "lane": "acct", "group": "sub-a", "along": 400, "across": 200 }
  }
}
`;
const NET: Files = { mmd: MMD, config: null, layout: LAYOUT };
const layoutOf = (files: Files) => loadDocument(files.mmd, files.config, files.layout, 'net.mmd').layout!;
const pinsOf = (files: Files) => (files.layout === null ? {} : JSON.parse(files.layout).nodes);

describe('A19 moveNodesToGroup (UI11 with groups)', () => {
  it('moves a block from its lane\'s top level into a group: declared last there, pinned with the group', () => {
    const r = moveNodesToGroup(NET, ['gw'], { lane: 'acct', group: 'sub-b' }, { pins: [{ id: 'gw', along: 500, across: 300 }] });
    expectParity(r, NET, {
      mmd: edit(MMD, ['    gw["Gateway"]\n', ''], ['        db[("Database")]\n', '        db[("Database")]\n        gw["Gateway"]\n']),
      layout: editJson(LAYOUT, (js) => (js.nodes.gw = { lane: 'acct', group: 'sub-b', along: 500, across: 300 })),
    });
  });

  it('moves a block out of its group to the lane\'s top level (before the lane\'s groups), with its comment', () => {
    const r = moveNodesToGroup(NET, ['app'], { lane: 'acct', group: null }, { pins: [{ id: 'app', along: 10, across: 20 }] });
    const after = expectParity(r, NET, {
      mmd: edit(MMD, ['        %% the app tier\n        app["App"]\n', ''], ['    gw["Gateway"]\n', '    gw["Gateway"]\n    %% the app tier\n    app["App"]\n']),
      layout: editJson(LAYOUT, (js) => (js.nodes.app = { lane: 'acct', along: 10, across: 20 })),
    });
    expect(after.mmd).toContain('    %% the app tier\n    app["App"]\n    subgraph net [Network]');
  });

  it('moves between groups of different lanes; without a drop position the pin is dropped', () => {
    const r = moveNodesToGroup(NET, ['app'], { lane: 'ops', group: 'tools' });
    expectParity(r, NET, {
      mmd: edit(MMD, ['        %% the app tier\n        app["App"]\n', ''], ['      pager["Pager"]\n', '      pager["Pager"]\n      %% the app tier\n      app["App"]\n']),
      layout: editJson(LAYOUT, (js) => delete js.nodes.app),
    });
  });

  it('a block already exactly there stays put (its pin is re-set when it has a drop position)', () => {
    const r = ok(moveNodesToGroup(NET, ['app'], { lane: 'acct', group: 'sub-a' }, { pins: [{ id: 'app', along: 1, across: 2 }] }));
    expect(r.files.mmd).toBe(MMD);
    expect(pinsOf(r.files).app).toEqual({ lane: 'acct', group: 'sub-a', along: 1, across: 2 });
  });

  it('refuses a group that doesn\'t exist, one in another lane, and groups in Unassigned', () => {
    expect(refused(moveNodesToGroup(NET, ['gw'], { lane: 'acct', group: 'nope' }))).toMatch(/no group/);
    expect(refused(moveNodesToGroup(NET, ['gw'], { lane: 'acct', group: 'tools' }))).toMatch(/not in lane/);
    expect(refused(moveNodesToGroup(NET, ['gw'], { lane: '_unassigned', group: 'tools' }))).toMatch(/Unassigned/);
  });

  it('the result lays out with the block inside its new group, pinned exactly', () => {
    const r = ok(moveNodesToGroup(NET, ['gw'], { lane: 'acct', group: 'sub-b' }, { pins: [{ id: 'gw', along: 500, across: 300 }] }));
    const res = layoutOf(r.files).result;
    const gw = res.nodes.find((n) => n.id === 'gw')!;
    const sub = res.groups!.find((g) => g.id === 'sub-b')!;
    expect(gw).toMatchObject({ group: 'sub-b', pinned: true, x: 500 + layoutOf(r.files).translation.along });
    expect(gw.x >= sub.x && gw.y >= sub.y && gw.x + gw.width <= sub.x + sub.width && gw.y + gw.height <= sub.y + sub.height).toBe(true);
  });
});

describe('A19 pins record the group', () => {
  it('pinNodes (a drag or nudge within the group) writes the group', () => {
    const r = ok(pinNodes(NET, [{ id: 'lb', along: 300, across: 90 }, { id: 'gw', along: 40, across: 30 }]));
    expect(pinsOf(r.files).lb).toEqual({ lane: 'acct', group: 'net', along: 300, across: 90 });
    expect(pinsOf(r.files).gw).toEqual({ lane: 'acct', along: 40, across: 30 });
    // Key order lane, group, along, across.
    expect(r.files.layout).toContain('"lb": { "lane": "acct", "group": "net", "along": 300, "across": 90 }');
  });

  it('resizing a block in a group pins it with its group (A6)', () => {
    const r = ok(resizeNode(NET, layoutOf(NET), 'pager', 'se', { dx: 40, dy: 20 }));
    expect(pinsOf(r.files).pager).toMatchObject({ lane: 'ops', group: 'tools' });
  });

  it('the lane select keeps a block that is already in that lane in its group', () => {
    const r = ok(moveNodesToLane(NET, ['app'], 'acct', { pins: [{ id: 'app', along: 5, across: 6 }] }));
    expect(r.files.mmd).toBe(MMD);
    expect(pinsOf(r.files).app).toEqual({ lane: 'acct', group: 'sub-a', along: 5, across: 6 });
  });

  it('the lane select moves a grouped block to another lane\'s top level, pin dropped', () => {
    const r = moveNodesToLane(NET, ['app'], 'ops');
    expectParity(r, NET, {
      mmd: edit(MMD, ['        %% the app tier\n        app["App"]\n', ''], ['    oncall(["On call"])\n', '    oncall(["On call"])\n    %% the app tier\n    app["App"]\n']),
      layout: editJson(LAYOUT, (js) => delete js.nodes.app),
    });
  });

  it('group ids are taken: renaming a block to one is refused', () => {
    expect(refused(renameNode(NET, 'gw', 'sub-a'))).toMatch(/already used/);
  });
});

describe('A19 adding blocks into groups', () => {
  it('addNode with a group declares it last in that group, pinned with the group', () => {
    const r = ok(addNode(NET, { shape: 'step', lane: 'acct', group: 'net', pin: { along: 100, across: 50 } }));
    expect(r.files.mmd).toContain('      lb["Load balancer"]\n      n1["New step"]\n      subgraph sub-a');
    expect(pinsOf(r.files).n1).toEqual({ lane: 'acct', group: 'net', along: 100, across: 50 });
  });

  it('addNodeAt (the canvas menu) joins the innermost group under the block\'s centre', () => {
    const out = layoutOf(NET);
    const sub = out.result.groups!.find((g) => g.id === 'sub-b')!;
    const r = ok(addNodeAt(NET, 'step', { x: sub.x + 20, y: sub.y + 30 }, out));
    expect(r.lane).toBe('acct');
    expect(r.files.mmd).toContain('        db[("Database")]\n        n1["New step"]\n');
    expect(pinsOf(r.files).n1).toMatchObject({ lane: 'acct', group: 'sub-b' });
  });
});

describe('A19 blockGroupAt', () => {
  it('finds the innermost group box holding a point, in that lane only', () => {
    const res = layoutOf(NET).result;
    const a = res.groups!.find((g) => g.id === 'sub-a')!;
    const net = res.groups!.find((g) => g.id === 'net')!;
    expect(blockGroupAt(res, 'acct', a.x + 5, a.y + 5)).toBe('sub-a');
    expect(blockGroupAt(res, 'acct', net.x + 3, net.y + 3)).toBe('net');
    expect(blockGroupAt(res, 'ops', a.x + 5, a.y + 5)).toBeNull();
    expect(blockGroupAt(res, 'acct', net.x + net.width + 5, net.y)).toBeNull();
  });
});

describe('A19 deleting a lane with groups (UI21)', () => {
  it('move: every block in the lane and its groups goes to the target\'s top level, in order; the groups go', () => {
    const r = deleteLane(NET, 'acct', { mode: 'move', target: 'ops' });
    const after = ok(r).files;
    expect(after.mmd).toBe([
      'flowchart LR', '', '  subgraph ops [Operations]', '    oncall(["On call"])', '    gw["Gateway"]', '    lb["Load balancer"]',
      '    %% the app tier', '    app["App"]', '    db[("Database")]', '    subgraph tools [Tools]', '      pager["Pager"]', '    end', '  end',
      '', '  gw --> lb', '  lb --> app', '  app --> db', '  db --> pager', '',
    ].join('\n'));
    expect(pinsOf(after)).toEqual({});
  });

  it('delete: every block in it and its groups is deleted with its lines; empty: refused while any group holds one', () => {
    const r = ok(deleteLane(NET, 'ops', { mode: 'delete' }));
    expect(r.files.mmd).not.toMatch(/pager|oncall|tools/);
    expect(refused(deleteLane(NET, 'ops', { mode: 'empty' }))).toMatch(/still has blocks/);
    const onlyEmptyGroups = { ...NET, mmd: MMD.replace('      pager["Pager"]\n', '').replace('    oncall(["On call"])\n', '').replace('  db --> pager\n', '') };
    expect(ok(deleteLane(onlyEmptyGroups, 'ops', { mode: 'empty' })).files.mmd).not.toContain('tools');
  });
});

describe('A19 paste and duplicate (A12)', () => {
  it('duplicate keeps a copy in its original\'s group, pinned with it', () => {
    const r = ok(duplicateNodes(NET, ['db'], layoutOf(NET)));
    expect(r.ids).toEqual(['db-2']);
    expect(r.files.mmd).toContain('        db[("Database")]\n        db-2[("Database")]\n');
    expect(pinsOf(r.files)['db-2']).toMatchObject({ lane: 'acct', group: 'sub-b' });
  });

  it('a paste at a point joins the innermost group under each block\'s centre', () => {
    const out = layoutOf(NET);
    const frag = copyFragment(NET, ['gw'], out);
    if (!frag.ok) throw new Error(frag.error);
    const tools = out.result.groups!.find((g) => g.id === 'tools')!;
    const r = ok(pasteFragment(NET, frag.fragment, out, { at: { x: tools.x + 20, y: tools.y + 30 } }));
    expect(r.files.mmd).toContain('      pager["Pager"]\n      gw-2["Gateway"]\n');
    expect(pinsOf(r.files)['gw-2']).toMatchObject({ lane: 'ops', group: 'tools' });
  });
});

describe('A19 layout file: the pin\'s `group`', () => {
  it('parses and writes back byte for byte, key order lane, group, along, across', () => {
    const p = parseLayoutFile(LAYOUT);
    expect(p.problems.errors).toEqual([]);
    expect(p.file!.nodes.app).toEqual({ lane: 'acct', group: 'sub-a', along: 400, across: 200 });
    expect(serializeLayoutFile(p.file!)).toBe(LAYOUT);
  });

  it('`group` without a pin, or not a string, is E-layout', () => {
    for (const entry of ['{ "group": "g", "width": 80, "height": 50 }', '{ "lane": "a", "group": 3, "along": 1, "across": 2 }']) {
      const p = parseLayoutFile(`{"version": 1, "nodes": {"x": ${entry}}}`);
      expect(p.file).toBeNull();
      expect(p.problems.errors.map((e) => e.code)).toEqual(['E-layout']);
    }
  });
});
