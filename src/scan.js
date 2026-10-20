// One run: find everything, skip what's unchanged, read the rest, ask the model only where there is something to judge.
import { condense, dirFacts } from './facts.js';
import { available, judge, MODEL } from './judge.js';
import { assess, combos, keysOf, risk, worst } from './policy.js';
import { claimOf, npmPackages } from './inventory.js';
import { fingerprint, load, newSince, save } from './state.js';

/** items: [{ key, name, dir, claim, fp, manifest?, kind }]. Returns the run summary; results are stored in state. */
export async function checkItems(items, { model = true, onItem = () => {} } = {}) {
  const state = load(), useModel = model && await available();
  const run = { model: useModel ? MODEL : null, items: [], stats: { total: items.length, cached: 0, judged: 0, quiet: 0, ms: 0, tokens: 0 } };
  for (const it of items) {
    const cached = state.results[it.fp];
    let r;
    if (cached && (cached.model || !cached.wanted || !useModel)) { r = cached; run.stats.cached++; }
    else {
      const { facts, coverage } = dirFacts(it.dir, { manifest: it.manifest });
      const found = combos(facts), short = condense(facts, 40, keysOf(found), risk);
      let labels = {}, judged = null;
      const wanted = short.some(f => !['fs', 'os', 'env', 'url', 'fs-read', 'decode', 'imports'].includes(f.cap));
      if (useModel && wanted) {
        judged = await judge(it.name, it.claim, short);  // nothing worth judging → no model call at all
        if (judged) { labels = judged.labels; run.stats.judged++; run.stats.ms += judged.ms; run.stats.tokens += judged.tokens; }
      } else run.stats.quiet++;
      const a = assess(short, found, labels);
      r = {
        key: it.key, kind: it.kind, name: it.name, level: a.level, findings: a.findings, coverage,
        facts: short.map(({ id, cap, detail, file, line, code }) => ({ id, cap, detail, file, line, code, ...labels[id] })),
        caps: [...new Set(short.map(f => f.cap))], model: judged ? MODEL : null, wanted, at: new Date().toISOString(),
      };
      state.results[it.fp] = r;
    }
    const approved = state.approved[it.key] === it.fp;
    const diff = approved ? null : newSince(state, `${it.kind}:${it.name}`, r.caps);
    run.items.push({ ...r, fp: it.fp, approved, diff });
    onItem(run.items.at(-1));
  }
  save(state);
  run.level = worst(run.items.filter(i => !i.approved).map(i => i.level));
  return run;
}

export async function scanProject(project, opts) {
  const { packages, warnings } = npmPackages(project);
  const items = packages.map(p => ({
    kind: 'npm', key: p.key, name: p.name, dir: p.dir, manifest: p.manifest,
    claim: claimOf(p.dir, p.manifest), fp: fingerprint(p.dir, p.integrity),
  }));
  const run = await checkItems(items, opts);
  return { ...run, warnings, project };
}

/** Approve current results so they stop asking: by key, or every item at or below a level. */
export function approve(run, which) {
  const state = load(), order = ['info', 'notable', 'review', 'hold'];
  let n = 0;
  for (const i of run.items) {
    const byLevel = order.includes(which) && order.indexOf(i.level) <= order.indexOf(which);
    if (byLevel || i.key === which || i.name === which) { state.approved[i.key] = i.fp; n++; }
  }
  save(state);
  return n;
}
