// Model-based fuzz of the config writer: random operation sequences applied to the text (ConfigDoc) and to a plain JS
// model with §4's semantics; after every step the parsed text must equal the model, key order included.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigDoc, type EditResult } from './index';
import { parse, RICH } from './testkit';

type Obj = Record<string, any>;
const PR = readFileSync(join(__dirname, '../../../fixtures/purchase-request/purchase-request.flow.yaml'), 'utf8');

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VALUES = ['a', 'wait', '2', 'yes', 'x: y', '#c', 'b, c', 'multi\nline', 'quote"d', "it's", 'null', ' pad '];
const KEYS = ['confidence', 'system', 'kind', 'source', 'owner', 'note x'];
const IDS = ['intake', 'r01', 'p05', 'n1', 'n2', 'v01', 'f03'];
const LANES = ['requester', 'manager', 'purchasing', 'finance', 'vendor', 'new-lane'];
const COLORS = ['#abc', '#A0B1C2', '#000', ''];

/** Set key on an object: in place if present, else appended (JS insertion order = file order). */
function setKey(o: Obj, k: string, v: unknown) { o[k] = v; }
function renameKeyInPlace(o: Obj, from: string, to: string): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) out[k === from ? to : k] = v;
  return out;
}

function step(r: () => number, model: Obj, doc: ConfigDoc): { res: EditResult; apply: () => void } {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const styles = (): Obj[] => (model.styles ??= []);
  const nRules = (model.styles ?? []).length;
  const op = Math.floor(r() * 15);
  switch (op) {
    case 0: {
      const t = pick([...VALUES, '']);
      return { res: doc.setTitle(t), apply: () => { if (t.trim() === '') delete model.title; else setKey(model, 'title', t); } };
    }
    case 1: case 2: {
      const id = pick(IDS); const k = pick(KEYS);
      const kind = Math.floor(r() * 3);
      const v = kind === 0 ? pick(VALUES) : kind === 1 ? [pick(VALUES), pick(VALUES)] : { [pick(KEYS)]: pick(VALUES) };
      const fv = kind === 0 ? { type: 'text' as const, value: v as string }
        : kind === 1 ? { type: 'list' as const, items: v as string[] }
        : { type: 'map' as const, entries: Object.entries(v as Obj) as [string, string][] };
      return {
        res: doc.setNodeField(id, k, fv),
        apply: () => {
          if (!model.nodes || typeof model.nodes !== 'object') model.nodes = {};
          if (!model.nodes[id]) model.nodes[id] = {};
          model.nodes[id][k] = v;
        },
      };
    }
    case 3: {
      const id = pick(IDS); const k = pick(KEYS);
      return {
        res: doc.removeNodeField(id, k),
        apply: () => {
          const e = model.nodes?.[id];
          if (!e || !(k in e)) return;
          if (Object.keys(e).length === 1) delete model.nodes[id]; else delete e[k];
        },
      };
    }
    case 4: {
      const id = pick(IDS);
      return { res: doc.deleteNodeEntry(id), apply: () => { if (model.nodes) delete model.nodes[id]; } };
    }
    case 5: {
      const from = pick(IDS); const to = pick(IDS);
      const res = doc.renameNode(from, to);
      return {
        res,
        apply: () => {
          if (from === to || !res.ok) return;
          if (model.nodes && from in model.nodes) model.nodes = renameKeyInPlace(model.nodes, from, to);
          for (const rule of model.styles ?? []) if (rule.match && String(rule.match.id) === from && 'id' in rule.match) rule.match.id = to;
        },
      };
    }
    case 6:
      return { res: doc.addRule(), apply: () => { styles().push({ match: {}, style: {} }); } };
    case 7: {
      if (!nRules) return { res: doc.addRule(), apply: () => { styles().push({ match: {}, style: {} }); } };
      const i = Math.floor(r() * nRules);
      return { res: doc.deleteRule(i), apply: () => { styles().splice(i, 1); } };
    }
    case 8: {
      if (!nRules) return { res: doc.setTitle(model.title ?? ''), apply: () => {} };
      const i = Math.floor(r() * nRules); const dir = pick(['up', 'down'] as const);
      return {
        res: doc.moveRule(i, dir),
        apply: () => {
          const j = dir === 'up' ? i - 1 : i + 1;
          if (j < 0 || j >= nRules) return;
          const s = styles(); [s[i], s[j]] = [s[j]!, s[i]!];
        },
      };
    }
    case 9: {
      if (!nRules) return { res: doc.addRule(), apply: () => { styles().push({ match: {}, style: {} }); } };
      const i = Math.floor(r() * nRules); const t = pick([...VALUES, '']);
      return { res: doc.setRuleLegend(i, t), apply: () => { if (t.trim() === '') delete styles()[i]!.legend; else styles()[i]!.legend = t; } };
    }
    case 10: {
      if (!nRules) return { res: doc.addRule(), apply: () => { styles().push({ match: {}, style: {} }); } };
      const i = Math.floor(r() * nRules); const f = pick(['id', 'lane', ...KEYS]);
      const c = pick([{ op: 'equals' as const, value: pick(VALUES) }, { op: 'present' as const }, { op: 'absent' as const }]);
      return { res: doc.setMatchCondition(i, f, c), apply: () => { styles()[i]!.match[f] = c.op === 'equals' ? c.value : c.op; } };
    }
    case 11: {
      if (!nRules) return { res: doc.addRule(), apply: () => { styles().push({ match: {}, style: {} }); } };
      const i = Math.floor(r() * nRules); const f = pick(['id', 'lane', ...KEYS]);
      return {
        res: doc.removeMatchCondition(i, f),
        apply: () => { delete styles()[i]!.match[f]; },
      };
    }
    case 12: {
      if (!nRules) return { res: doc.addRule(), apply: () => { styles().push({ match: {}, style: {} }); } };
      const i = Math.floor(r() * nRules); const l = pick(COLORS); const d = pick(COLORS);
      const prop = pick(['fill', 'border_color'] as const);
      const res = doc.setStyleColor(i, prop, l, d);
      return {
        res,
        apply: () => {
          if (!res.ok) return;
          const st = styles()[i]!.style;
          if (!l && !d) { delete st[prop]; return; }
          const ln = l.toLowerCase(); const dn = d.toLowerCase();
          const norm = (c: string) => c.length === 4 ? '#' + c.slice(1).split('').map((x) => x + x).join('') : c;
          st[prop] = !dn || norm(ln) === norm(dn) ? ln : { light: ln, dark: dn };
        },
      };
    }
    case 13: {
      const ids = LANES.filter(() => r() < 0.6).sort(() => r() - 0.5);
      return {
        res: doc.setLaneOrder(ids),
        apply: () => {
          const old: Obj[] = model.lanes ?? [];
          const same = model.lanes && old.length === ids.length && old.every((l, k) => l.id === ids[k]);
          if (same) return;
          model.lanes = ids.map((id) => old.find((l) => l.id === id) ?? { id });
        },
      };
    }
    default: {
      const from = pick(LANES); const to = pick(LANES);
      return {
        res: doc.renameLane(from, to),
        apply: () => {
          if (from === to) return;
          for (const l of model.lanes ?? []) if (l.id === from) l.id = to;
          for (const rule of model.styles ?? []) if (rule.match && 'lane' in rule.match && String(rule.match.lane) === from) rule.match.lane = to;
        },
      };
    }
  }
}

describe.each([['RICH', RICH], ['purchase-request', PR], ['no file', null], ['empty file', '']])('fuzz from %s', (_name, start) => {
  test.each(Array.from({ length: 20 }, (_, k) => k + 1))('seed %i', (seed) => {
    const r = rng(seed * 7919);
    let text: string | null = start;
    let model: Obj = text === null ? {} : ((parse(text) as Obj) ?? {});
    let created = text !== null;
    const log: string[] = [];
    for (let n = 0; n < 40; n++) {
      const doc = new ConfigDoc(text);
      const before = JSON.stringify(model);
      const { res, apply } = step(r, model, doc);
      log.push(`${n}: ${res.ok ? 'ok' : 'refused ' + res.error}`);
      if (!res.ok) {
        // Only the documented refusals happen here.
        expect(res.error).toMatch(/already has an entry|needs a light colour/);
        model = JSON.parse(before);
        continue;
      }
      apply();
      if (res.text === null) {
        expect(created).toBe(false);
        model = JSON.parse(before);
        continue;
      }
      if (!created) { model = { version: 1, ...model }; created = true; }
      text = res.text;
      const got = parse(text) ?? {};
      if (JSON.stringify(got) !== JSON.stringify(model)) {
        throw new Error(`mismatch after step ${n}\n${log.join('\n')}\n--- text\n${text}\n--- want\n${JSON.stringify(model)}\n--- got\n${JSON.stringify(got)}`);
      }
    }
  });
});
