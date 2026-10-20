// One run: find everything, skip what's unchanged, read the rest, ask the model only where there is something to judge.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { condense, dirFacts } from './facts.js';
import { available, judge, MODEL } from './judge.js';
import { assess, combos, keysOf, risk, worst } from './policy.js';
import { claimOf, npmPackages } from './inventory.js';
import { findMcpServers, findSkills, resolveServer, skillFacts } from './agents.js';
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
      const { facts, coverage } = it.read ? it.read() : dirFacts(it.dir, { manifest: it.manifest });
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
    run.items.push({ ...r, key: it.key, name: it.name, kind: it.kind, fp: it.fp, approved, diff });  // same bytes, other place: same result
    onItem(run.items.at(-1));
  }
  save(state);
  run.level = worst(run.items.filter(i => !i.approved).map(i => i.level));
  return run;
}

/** Everything in one pass: the project's packages, then the agent's skills and MCP servers on this machine. */
export async function scanProject(project, { packages = true, agents = true, fetch = true, ...opts } = {}) {
  const items = [], warnings = [], unread = [];
  if (packages) {
    const npm = npmPackages(project);
    warnings.push(...npm.warnings);
    for (const p of npm.packages) items.push({
      kind: 'npm', key: p.key, name: p.name, dir: p.dir, manifest: p.manifest,
      claim: claimOf(p.dir, p.manifest), fp: fingerprint(p.dir, p.integrity),
    });
  }
  if (agents) {
    for (const s of findSkills(project))
      items.push({ ...s, fp: `skill-${fingerprint(s.dir)}`, read: () => skillFacts(s.dir) });
    for (const m of findMcpServers(project)) {
      const where = resolveServer(m, { fetch });
      if (!where.readable) {
        if (!unread.some(u => u.key === `mcp:${m.name}` && u.why === where.why)) unread.push({ key: `mcp:${m.name}`, why: where.why, source: m.source });
        continue;
      }
      const manifest = (() => { try { return JSON.parse(readFileSync(join(where.dir, 'package.json'), 'utf8')); } catch { return null; } })();
      items.push({
        kind: 'mcp', key: `mcp:${m.name}`, name: manifest?.name ?? m.name, dir: where.dir, manifest,
        claim: claimOf(where.dir, manifest) || `MCP server "${m.name}"`, fp: fingerprint(where.dir),
      });
    }
  }
  const run = await checkItems(items, opts);
  return { ...run, warnings, unread, project };
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
