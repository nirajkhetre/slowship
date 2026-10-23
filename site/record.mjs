// Records one real watch for the web demo: public packages (a real project's lockfile) plus slowship's own inert
// test fixtures, never anything else on this machine. It keeps the run, the code around each finding, and the
// watch's timeline so the demo can replay it. Paths are rewritten so they show nobody's machine.
//   node site/record.mjs <project with a package-lock.json> [out.json]   (SLOWSHIP_ADVISORIES for Storm watch, SLOWSHIP_REA for the IPC map)
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const project = resolve(process.argv[2] ?? '.'), out = resolve(process.argv[3] ?? join(import.meta.dirname, 'demo-run.json'));
const FX = resolve(import.meta.dirname, '..', 'test', 'fixtures');
// a home of our own: only the fixture skills live there, and a fresh cache so the timeline shows real work
const home = mkdtempSync(join(tmpdir(), 'slowship-demo-'));
process.env.USERPROFILE = process.env.HOME = home;
process.env.SLOWSHIP_HOME = join(home, '.slowship');
for (const s of ['evil-skill', 'good-skill']) cpSync(join(FX, s), join(home, '.agents', 'skills', s), { recursive: true });

const { checkItems } = await import('../src/scan.js');
const { npmPackages, claimOf } = await import('../src/inventory.js');
const { fingerprint } = await import('../src/state.js');
const { findAutorun, findSkills, skillFacts } = await import('../src/agents.js');
const { applyStorm } = await import('../src/storm.js');
const { appFacts } = await import('../src/app.js');
const { codeWindow } = await import('../src/server.js');

// two builds: a careless one, and a notes window whose IPC map has one handler that checks its sender and two that don't
const app = join(FX, 'my-electron-app'), notes = join(FX, 'ipc-app'), items = [];
for (const [dir, name] of [[app, 'my-app'], [notes, 'notes-window']])
  items.push({ kind: 'app', key: `app:${dir}`, name, dir, claim: '', fp: `app-${fingerprint(dir)}`, noModel: true, read: () => appFacts(dir) });
for (const p of npmPackages(project).packages) items.push({ kind: 'npm', key: p.key, name: p.name, dir: p.dir, manifest: p.manifest, claim: claimOf(p.dir, p.manifest), fp: fingerprint(p.dir, p.integrity) });
for (const f of ['evil-pkg', 'injected-pkg']) {
  const dir = join(FX, f), m = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  items.push({ kind: 'npm', key: `npm:${m.name}@${m.version}`, name: m.name, dir, manifest: m, claim: claimOf(dir, m), fp: fingerprint(dir) });
}
for (const s of findSkills(home)) items.push({ ...s, fp: `skill-${fingerprint(s.dir)}`, read: () => skillFacts(s.dir) });
const auto = findAutorun(project); if (auto) items.unshift(auto);  // what opening the project runs, if it has any

const t0 = Date.now(), timeline = [];
const name = i => i.kind === 'npm' ? i.key.replace(/^npm:/, '') : i.name;
const run = await checkItems(items, {
  onStep: s => timeline.push({ t: Date.now() - t0, type: 'step', name: name(s), kind: s.kind, phase: s.phase }),
  onItem: (i, n, how) => timeline.push({ t: Date.now() - t0, type: 'item', name: name(i), kind: i.kind, level: i.level, how: how.how, ms: how.ms }),
});
applyStorm(run, project);  // runtimes, lockfiles and advisories, as a watch adds them (advisories from SLOWSHIP_ADVISORIES, if set)
run.finished = new Date().toISOString();
run.options = { project, model: true, packages: true, agents: true, fetch: false, app };
run.unread = [{ key: 'mcp:a-remote-server', why: 'remote server: its code runs elsewhere and can’t be read', source: join(home, '.cursor', 'mcp.json') }];

// the code around every finding worth opening, read now so the demo can show it
const codes = {};
for (const i of run.items) for (const f of i.findings) for (const id of f.evidence) {
  const e = i.facts.find(x => x.id === id);
  if (e?.line && e.code) { const w = codeWindow(i.dir, e.file, e.line); if (w) codes[`${i.key}|${e.file}|${e.line}`] = w; }
}

// nobody's machine: the project, the fixtures and the temporary home become ~/code/my-app and ~
let text = JSON.stringify({ run: { ...run, home: '/home/you' }, codes, timeline, recorded: { at: run.finished, model: run.model, ms: Date.now() - t0 } });
const swap = (from, to) => {
  for (const f of [from, from.replaceAll('\\', '/')]) text = text.split(JSON.stringify(f).slice(1, -1)).join(to);
};
swap(join(FX, 'my-electron-app'), '/home/you/code/my-app/dist');
swap(join(FX, 'ipc-app'), '/home/you/code/my-app/notes-window');
for (const f of ['evil-pkg', 'injected-pkg']) swap(join(FX, f), `/home/you/code/my-app/node_modules/${JSON.parse(readFileSync(join(FX, f, 'package.json'), 'utf8')).name}`);
swap(project, '/home/you/code/my-app');
swap(home, '/home/you');
text = text.replace(/\/home\/you(\\\\[^"\\]*)+/g, m => m.replaceAll('\\\\', '/'));  // any Windows separators left inside rewritten paths
writeFileSync(out, text);
rmSync(home, { recursive: true, force: true });
console.log(`recorded ${run.items.length} items, ${Object.keys(codes).length} code windows, ${timeline.length} timeline events in ${Math.round((Date.now() - t0) / 1000)} s → ${out}`);
