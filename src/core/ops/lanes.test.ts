// Parity tests for lane and diagram operations (design.md §10 Part 3: P12–P14).
import {
  addLane, deleteLane, laneSlug, moveLane, renameLane, reorderLanes, setDirection, setLaneLabel, setTitle,
} from './index';
import { edit, editJson, expectParity, ok, PR, refused, RICH, RICH_MMD } from './testkit';

const EMPTY_LANE = '\nsubgraph empty [Empty lane]\n  %% nothing here yet\nend\n';

describe('P12 add a lane (UI18)', () => {
  test.each([
    ['Quality & Safety', 'quality-safety'], ['  Ops  team ', 'ops-team'], ['2nd shift', 'lane-2nd-shift'],
    ['End', 'lane-end'], ['End game', 'lane-end-game'], ['Class', 'lane-class'], ['Default', 'lane-default'],
    ['Subgraph', 'lane-subgraph'], ['Café Crème', 'caf-cr-me'], ['!!!', 'lane'], ['_unassigned', 'unassigned'],
    ['end_x', 'lane-end-x'], ['A--B', 'a-b'], ['9', 'lane-9'],
  ])('slug of "%s" is %s', (label, id) => {
    expect(laneSlug(label)).toBe(id);
  });

  test('appended after the last subgraph and to the config lanes list', () => {
    const r = addLane(RICH, 'Quality & Safety');
    expect(ok(r).id).toBe('quality-safety');
    expectParity(r, RICH, {
      mmd: edit(RICH_MMD, [EMPTY_LANE, `${EMPTY_LANE}\nsubgraph quality-safety ["Quality & Safety"]\nend\n`]),
      config: edit(RICH.config!, ['  - id: manager\n', '  - id: manager\n  - id: quality-safety\n']),
    });
  });

  test('a taken id gets -2 (node ids, lane ids and config or layout keys are all taken)', () => {
    const r = addLane(PR, 'Vendor');
    expect(ok(r).id).toBe('vendor-2');
    expectParity(r, PR, {
      mmd: edit(PR.mmd, ['    v02["Ship the order"]\n  end\n', '    v02["Ship the order"]\n  end\n  subgraph vendor-2 [Vendor]\n  end\n']),
      config: edit(PR.config!, ['  - id: vendor\n', '  - id: vendor\n  - id: vendor-2\n']),
    });
    expect(ok(addLane(RICH, 'N1')).id).toBe('n1-2');
    expect(ok(addLane(RICH, 'n2')).id).toBe('n2-2');
    expect(ok(addLane(RICH, 'M01')).id).toBe('m01-2');
    const twice = ok(addLane(ok(addLane(PR, '!!!')).files, '???'));
    expect(twice.id).toBe('lane-2');
    expect(twice.files.mmd).toContain('  subgraph lane [!!!]\n  end\n\n  subgraph lane-2 [???]\n  end\n');
  });

  test('a stale config entry for the same id is replaced by the appended one', () => {
    const r = addLane(RICH, 'Archive');
    expectParity(r, RICH, {
      mmd: edit(RICH_MMD, [EMPTY_LANE, `${EMPTY_LANE}subgraph archive [Archive]\nend\n`]),
      config: edit(RICH.config!, ['  - id: archive        # stale: no such lane\n', ''], ['  - id: manager\n', '  - id: manager\n  - id: archive\n']),
    });
  });

  test('no lanes list, or no config: only the .mmd changes', () => {
    const noList = { ...PR, config: 'version: 1\ntitle: T\n' };
    expectParity(addLane(noList, 'QA'), noList, { mmd: `${PR.mmd}\n  subgraph qa [QA]\n  end\n` });
    const none = { ...PR, config: null, layout: null };
    expectParity(addLane(none, 'QA'), none, { mmd: `${PR.mmd}\n  subgraph qa [QA]\n  end\n` });
  });

  test('refusals: empty or multi-line label', () => {
    expect(refused(addLane(PR, ''))).toMatch(/empty/);
    expect(refused(addLane(PR, ' '))).toMatch(/empty/);
    expect(refused(addLane(PR, 'a\nb'))).toMatch(/single line/);
  });
});

describe('P12 rename a lane (UI19)', () => {
  test('its label', () => {
    expectParity(setLaneLabel(RICH, 'finance', 'Money'), RICH, {
      mmd: edit(RICH_MMD, ['subgraph finance ["Finance & approvals"]', 'subgraph finance [Money]']),
    });
    expectParity(setLaneLabel(PR, 'vendor', 'Vendor "A" & co'), PR, {
      mmd: edit(PR.mmd, ['subgraph vendor [Vendor]', 'subgraph vendor ["Vendor #quot;A#quot; & co"]']),
    });
  });

  test('its id: subgraph, config lanes entry in place, style rules matching lane, and every pin in it', () => {
    const r = renameLane(RICH, 'requester', 'req');
    const after = expectParity(r, RICH, {
      mmd: edit(RICH_MMD, ['subgraph requester [Requester]', 'subgraph req [Requester]']),
      config: edit(RICH.config!, ['  - id: requester\n', '  - id: req\n'], ['match: {lane: requester}', 'match: {lane: req}']),
      layout: editJson(RICH.layout, (js) => { js.nodes.r01.lane = 'req'; }),
    });
    expect(after.config).toContain('  - id: req\n    colour: blue       # extra key\n');
    expectParity(renameLane(PR, 'purchasing', 'buying'), PR, {
      mmd: edit(PR.mmd, ['subgraph purchasing [Purchasing]', 'subgraph buying [Purchasing]']),
      config: edit(PR.config!, ['  - id: purchasing\n', '  - id: buying\n']),
    });
  });

  test('to an id with a stale config entry: the stale entry goes (R5.13)', () => {
    expectParity(renameLane(RICH, 'manager', 'archive'), RICH, {
      mmd: edit(RICH_MMD, ['subgraph manager [Manager]', 'subgraph archive [Manager]']),
      config: edit(RICH.config!, ['  - id: archive        # stale: no such lane\n', ''], ['  - id: manager\n', '  - id: archive\n']),
      layout: editJson(RICH.layout, (js) => { js.nodes.n2.lane = 'archive'; }),
    });
  });

  test('a lane written without a label keeps its old id as its label (R4.11)', () => {
    const files = { mmd: 'flowchart LR\nsubgraph ops\n  a["A"]\nend\n', config: null, layout: null };
    expectParity(renameLane(files, 'ops', 'team'), files, { mmd: 'flowchart LR\nsubgraph team [ops]\n  a["A"]\nend\n' });
  });

  test.each([
    ['a--b', /not a valid id/], ['1st', /not a valid id/], ['end', /reserved/], ['_unassigned', /reserved/],
    ['m01', /already used/], ['finance', /already used/], ['ghost', /already used/], ['n1', /already used/],
    ['n2', /already used/],
  ])('refuses id "%s"', (id, why) => {
    expect(refused(renameLane(RICH, 'requester', id))).toMatch(why);
  });

  test('refusals: unknown lane, Unassigned, empty label', () => {
    expect(refused(renameLane(RICH, 'nope', 'x'))).toMatch(/no lane/);
    expect(refused(renameLane(RICH, '_unassigned', 'x'))).toMatch(/Unassigned/);
    expect(refused(setLaneLabel(RICH, 'finance', ''))).toMatch(/empty/);
    expect(refused(setLaneLabel(RICH, '_unassigned', 'x'))).toMatch(/Unassigned/);
  });
});

describe('P12 reorder lanes (UI20)', () => {
  test('writes every lane in the new order; extra keys kept; stale entries dropped; the .mmd unchanged', () => {
    expectParity(reorderLanes(RICH, ['manager', 'empty', '_unassigned', 'requester', 'finance']), RICH, {
      config: edit(RICH.config!, [
        'lanes:\n  - id: finance        # finance first\n  - id: archive        # stale: no such lane\n'
          + '  - id: requester\n    colour: blue       # extra key\n  - id: manager\n',
        'lanes:\n  - id: manager\n  - id: empty\n  - id: requester\n    colour: blue       # extra key\n'
          + '  - id: finance        # finance first\n',
      ]),
    });
  });

  test('purchase-request', () => {
    expectParity(reorderLanes(PR, ['vendor', 'finance', 'purchasing', 'manager', 'requester']), PR, {
      config: edit(PR.config!, ['lanes:\n  - id: requester\n  - id: manager\n  - id: purchasing\n  - id: finance\n  - id: vendor\n',
        'lanes:\n  - id: vendor\n  - id: finance\n  - id: purchasing\n  - id: manager\n  - id: requester\n']),
    });
  });

  test('creates the config file or the lanes list', () => {
    const none = { ...PR, config: null };
    expectParity(reorderLanes(none, ['manager', 'requester', 'purchasing', 'finance', 'vendor']), none, {
      config: 'version: 1\nlanes: [{id: manager}, {id: requester}, {id: purchasing}, {id: finance}, {id: vendor}]\n',
    });
    const noList = { ...PR, config: '# mine\nversion: 1\ntitle: T\n' };
    expectParity(reorderLanes(noList, ['vendor', 'requester', 'manager', 'purchasing', 'finance']), noList, {
      config: '# mine\nversion: 1\ntitle: T\nlanes:\n- id: vendor\n- id: requester\n- id: manager\n- id: purchasing\n- id: finance\n',
    });
  });

  test('move up / move down swap with the neighbour in display order; past the end changes nothing', () => {
    // Display order in the rich files: finance, requester, manager (listed), then empty (file order).
    expectParity(moveLane(RICH, 'empty', 'up'), RICH, {
      config: edit(RICH.config!, ['  - id: archive        # stale: no such lane\n', ''], ['  - id: manager\n', '  - id: empty\n  - id: manager\n']),
    });
    expectParity(moveLane(PR, 'requester', 'down'), PR, {
      config: edit(PR.config!, ['  - id: requester\n  - id: manager\n', '  - id: manager\n  - id: requester\n']),
    });
    expect(ok(moveLane(PR, 'requester', 'up')).files).toEqual(PR);
    expect(ok(moveLane(PR, 'vendor', 'down')).files).toEqual(PR);
    expect(refused(moveLane(PR, 'nope', 'up'))).toMatch(/no lane/);
  });

  test('refusals: every lane exactly once', () => {
    expect(refused(reorderLanes(PR, ['vendor', 'finance']))).toMatch(/every lane/);
    expect(refused(reorderLanes(PR, ['vendor', 'finance', 'purchasing', 'manager', 'requester', 'x']))).toMatch(/every lane/);
    expect(refused(reorderLanes(PR, ['vendor', 'vendor', 'purchasing', 'manager', 'requester']))).toMatch(/every lane/);
  });
});

describe('P12 delete a lane (UI21)', () => {
  test('an empty lane: the subgraph with its comments, and its config entry', () => {
    expectParity(deleteLane(RICH, 'empty', { mode: 'empty' }), RICH, { mmd: edit(RICH_MMD, [EMPTY_LANE, '']) });
    const added = ok(addLane(PR, 'QA')).files;
    expectParity(deleteLane(added, 'qa', { mode: 'empty' }), added, {
      mmd: edit(added.mmd, ['\n  subgraph qa [QA]\n  end\n', '']),
      config: edit(added.config!, ['  - id: qa\n', '']),
    });
  });

  test('moving its blocks: each appended to the target with its comments, pins dropped; lane comments deleted', () => {
    expectParity(deleteLane(RICH, 'requester', { mode: 'move', target: 'manager' }), RICH, {
      mmd: edit(RICH_MMD,
        ['%% the requester\'s lane\nsubgraph requester [Requester]\n  intake(["Needs a part"])\n  %% the form is a spreadsheet\n  r01["Fill the form"];\n  %% end of requester\nend\n', ''],
        ['  m02{"Approved?"}\n', '  m02{"Approved?"}\n  intake(["Needs a part"])\n  %% the form is a spreadsheet\n  r01["Fill the form"]\n']),
      config: edit(RICH.config!, ['  - id: requester\n    colour: blue       # extra key\n', '']),
      layout: editJson(RICH.layout, (js) => { delete js.nodes.r01; }),
    });
  });

  test('moving its blocks to Unassigned', () => {
    expectParity(deleteLane(RICH, 'finance', { mode: 'move', target: '_unassigned' }), RICH, {
      mmd: edit(RICH_MMD,
        ['subgraph finance ["Finance & approvals"]\n  f01@{ shape: delay, label: "Wait for budget" }\n  %% the invoice\n  f02[/"Invoice #35;quot; copy"/]\nend\n', ''],
        ['stray{"Stray question?"}:::hot\n', 'stray{"Stray question?"}:::hot\nf01@{ shape: delay, label: "Wait for budget" }\n%% the invoice\nf02[/"Invoice #35;quot; copy"/]\n']),
      config: edit(RICH.config!, ['  - id: finance        # finance first\n', '']),
      layout: editJson(RICH.layout, (js) => { delete js.nodes.f02; }),
    });
    expectParity(deleteLane(PR, 'vendor', { mode: 'move', target: 'purchasing' }), PR, {
      mmd: edit(PR.mmd,
        ['  subgraph vendor [Vendor]\n    v01@{ shape: doc, label: "Send a quote" }\n    v02["Ship the order"]\n  end\n\n', ''],
        ['    p07["Create the PO in the ERP"]\n', '    p07["Create the PO in the ERP"]\n    v01@{ shape: doc, label: "Send a quote" }\n    v02["Ship the order"]\n']),
      config: edit(PR.config!, ['  - id: vendor\n', '']),
    });
  });

  test('with its blocks: as UI14 (edges, comments, pins), config metadata kept', () => {
    expectParity(deleteLane(RICH, 'finance', { mode: 'delete' }), RICH, {
      mmd: edit(RICH_MMD,
        ['subgraph finance ["Finance & approvals"]\n  f01@{ shape: delay, label: "Wait for budget" }\n  %% the invoice\n  f02[/"Invoice #35;quot; copy"/]\nend\n', ''],
        ['m02 -->|yes| f01\n', ''], ['f01 --> f02 & ghost\n', '']),
      config: edit(RICH.config!, ['  - id: finance        # finance first\n', '']),
      layout: editJson(RICH.layout, (js) => { delete js.nodes.f02; }),
    });
    expectParity(deleteLane(PR, 'vendor', { mode: 'delete' }), PR, {
      mmd: edit(PR.mmd,
        ['  subgraph vendor [Vendor]\n    v01@{ shape: doc, label: "Send a quote" }\n    v02["Ship the order"]\n  end\n\n', ''],
        ['  p05 --> v01\n  v01 --> p06\n', ''], ['  p07 --> v02\n  v02 --> r02\n', '']),
      config: edit(PR.config!, ['  - id: vendor\n', '']),
    });
  });

  test('refusals', () => {
    expect(refused(deleteLane(RICH, 'finance', { mode: 'empty' }))).toMatch(/still has blocks/);
    expect(refused(deleteLane(RICH, 'finance', { mode: 'move', target: 'finance' }))).toMatch(/different lane/);
    expect(refused(deleteLane(RICH, 'finance', { mode: 'move', target: 'nope' }))).toMatch(/no lane/);
    expect(refused(deleteLane(RICH, '_unassigned', { mode: 'delete' }))).toMatch(/Unassigned/);
    expect(refused(deleteLane(RICH, 'nope', { mode: 'empty' }))).toMatch(/no lane/);
  });
});

describe('P13 title (UI22)', () => {
  test('with a config file: set in place, comment kept', () => {
    expectParity(setTitle(RICH, 'Purchasing: as-is'), RICH, {
      config: edit(RICH.config!, ['title:   Rich purchase map   # the title', 'title: "Purchasing: as-is"   # the title']),
    });
    expectParity(setTitle(PR, 'Purchase requests'), PR, {
      config: edit(PR.config!, ['title: Purchase request approval (current state, synthetic)', 'title: Purchase requests']),
    });
  });

  test('without a config file: created with version 1 and the title', () => {
    const none = { ...PR, config: null };
    const after = expectParity(setTitle(none, 'My map'), none, { config: 'version: 1\ntitle: My map\n' });
    expect(after.config).toBe('version: 1\ntitle: My map\n');
    expectParity(setTitle(none, '2024'), none, { config: 'version: 1\ntitle: "2024"\n' });
  });

  test('cleared: the key goes; with no file, none is created', () => {
    expectParity(setTitle(RICH, ''), RICH, { config: edit(RICH.config!, ['title:   Rich purchase map   # the title\n', '']) });
    expect(ok(setTitle({ ...PR, config: null }, '')).files.config).toBeNull();
  });
});

describe('P14 direction (UI23)', () => {
  test('both ways; pins keep their values', () => {
    const tb = expectParity(setDirection(PR, 'TB'), PR, { mmd: edit(PR.mmd, ['flowchart LR', 'flowchart TB']) });
    expectParity(setDirection(tb, 'LR'), tb, { mmd: PR.mmd });
    expectParity(setDirection(RICH, 'TB'), RICH, { mmd: edit(RICH_MMD, ['flowchart LR', 'graph TD']) });
  });

  test('refuses anything but LR and TB', () => {
    expect(refused(setDirection(PR, 'RL' as 'LR'))).toMatch(/LR or TB/);
  });
});
