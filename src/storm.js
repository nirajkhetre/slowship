// Storm watch: when a big vulnerability breaks (PHP2Shell, the next Log4Shell), are you in it, how bad would it be, and
// what's the fix. Three readings, all on this computer, none of them running anything:
//   what each project runs on: runtimes and base images, and whether anyone still fixes them (an end-of-life snapshot);
//   the public advisories (OSV), downloaded whole and matched here, so your inventory never leaves;
//   what a takeover would get: the keys your app holds, and what the thing itself already touches.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { keysFrom, keysNamed } from './agents.js';
import { worst } from './policy.js';
import { HOME, load } from './state.js';

const json = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const EOL = JSON.parse(readFileSync(new URL('./eol.json', import.meta.url), 'utf8'));
const STORMS = JSON.parse(readFileSync(new URL('./storms.json', import.meta.url), 'utf8')).runtime;
export const RUNTIME = { node: 'Node.js', php: 'PHP', python: 'Python', ruby: 'Ruby', go: 'Go', java: 'Java', deno: 'Deno', bun: 'Bun', dotnet: '.NET' };
const today = () => new Date().toISOString().slice(0, 10);
const sha = s => createHash('sha256').update(s).digest('base64url').slice(0, 22);

// ---------- versions: numbers first, then pre-releases (1.2.3-beta.1 sorts before 1.2.3) ----------
const parts = v => {
  const [core, pre] = String(v).trim().replace(/^[v=]+/, '').split('+')[0].split(/-(.*)/s);
  return { n: core.split('.').map(x => parseInt(x, 10) || 0), pre: pre ? pre.split('.') : [] };
};
export function cmp(a, b) {
  const A = parts(a), B = parts(b);
  for (let k = 0; k < Math.max(A.n.length, B.n.length, 3); k++) { const d = (A.n[k] ?? 0) - (B.n[k] ?? 0); if (d) return Math.sign(d); }
  if (!A.pre.length || !B.pre.length) return A.pre.length ? -1 : B.pre.length ? 1 : 0;
  for (let k = 0; k < Math.max(A.pre.length, B.pre.length); k++) {
    const x = A.pre[k], y = B.pre[k];
    if (x === undefined) return -1; if (y === undefined) return 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) { if (+x !== +y) return Math.sign(+x - +y); } else if (nx !== ny) return nx ? -1 : 1; else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
// Python's rules (PEP 440): 1.0.dev1 < 1.0a1 < 1.0b2 < 1.0rc1 < 1.0 < 1.0.post1, and an epoch (1!) beats everything
const PEP = /^(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[-_.]?(a|b|c|rc|alpha|beta|pre|preview)[-_.]?(\d*))?(?:-(\d+)|[-_.]?(?:post|rev|r)[-_.]?(\d*))?(?:[-_.]?dev[-_.]?(\d*))?$/;
const PHASE = { a: 0, alpha: 0, b: 1, beta: 1, c: 2, rc: 2, pre: 2, preview: 2 };
function pep440(a, b) {
  const key = v => {
    const m = String(v).trim().toLowerCase().replace(/^v/, '').split('+')[0].match(PEP);
    if (!m) return null;
    const [, ep, rel, pre, preN, post1, post2, dev] = m, post = post1 ?? post2;
    return [+(ep ?? 0), rel.split('.').map(Number), pre ? PHASE[pre] : post == null && dev != null ? -1 : 3, +(preN || 0), post == null ? -1 : +(post || 0), dev == null ? Infinity : +(dev || 0)];
  };
  const A = key(a), B = key(b);
  if (!A || !B) return cmp(a, b);
  if (A[0] !== B[0]) return Math.sign(A[0] - B[0]);
  for (let k = 0; k < Math.max(A[1].length, B[1].length); k++) { const d = (A[1][k] ?? 0) - (B[1][k] ?? 0); if (d) return Math.sign(d); }
  for (let k = 2; k < 6; k++) if (A[k] !== B[k]) return A[k] < B[k] ? -1 : 1;
  return 0;
}
// Ruby's rules (and close enough for Composer): numbers and words in turn, and a word means a pre-release (1.0.0.rc1 < 1.0.0)
// ponytail: Composer's "-p1" patch releases sort as pre-releases here; give it Composer's own order if one ever matters
function segments(a, b) {
  const seg = v => (String(v).trim().replace(/^v/i, '').split('+')[0].match(/\d+|[a-z]+/gi) ?? []).map(s => /\d/.test(s) ? +s : s.toLowerCase());
  const A = seg(a), B = seg(b);
  for (let k = 0; k < Math.max(A.length, B.length); k++) {
    const x = A[k] ?? 0, y = B[k] ?? 0;
    if (x === y) continue;
    if (typeof x !== typeof y) return typeof x === 'string' ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
/** How an ecosystem orders its versions: npm, crates.io and Go are semver; PyPI, RubyGems and Packagist have their own. */
export const cmpOf = eco => ({ PyPI: pep440, RubyGems: segments, Packagist: segments })[eco] ?? cmp;
// names as each registry compares them: PyPI ignores case and treats - _ . alike, Composer ignores case
const norm = (eco, n) => eco === 'PyPI' ? n.toLowerCase().replace(/[-_.]+/g, '-') : eco === 'Packagist' ? n.toLowerCase() : n;
const lead = s => String(s ?? '').match(/\d+(?:\.\d+){0,2}/)?.[0] ?? null;  // the first version in "^8.1", ">=18", "20.11.1-alpine"
const exactish = v => !!v && v.split('.').length === 3;

// ---------- what a project runs on ----------
const IMAGES = { node: 'node', php: 'php', python: 'python', ruby: 'ruby', golang: 'go', 'eclipse-temurin': 'java', openjdk: 'java', amazoncorretto: 'java', 'denoland/deno': 'deno', 'oven/bun': 'bun', dotnet: 'dotnet' };
/** A container image reference, as far as it says which runtime and version it is. */
export function fromImage(ref) {
  const [, img, tag, digest] = String(ref).match(/^([^:@\s]+)(?::([^@\s]+))?(?:@(\S+))?$/) ?? [];
  if (!img) return null;
  const name = img.replace(/^(docker\.io\/)?(library\/)?/, '').replace(/^mcr\.microsoft\.com\/dotnet\/(sdk|aspnet|runtime)$/, 'dotnet');
  const runtime = IMAGES[name];
  if (!runtime) return null;
  const version = tag && tag !== 'latest' ? lead(tag) : null;
  return { runtime, version, image: `${img}${tag ? ':' + tag : ''}`, floating: !digest && !exactish(version), how: 'container image', runs: true };
}
// where a runtime is named, and whether that's what runs (an image, a pinned version) or only what's allowed or tested
const TOOL = { nodejs: 'node', node: 'node', php: 'php', python: 'python', ruby: 'ruby', golang: 'go', go: 'go', deno: 'deno', bun: 'bun' };
/** Every runtime a project names: [{ runtime, version, exact, floating, range, runs, image?, how, file, line, code }]. */
export function runtimesOf(project) {
  const out = [], read = f => { try { return readFileSync(join(project, f), 'utf8'); } catch { return null; } };
  const add = (file, line, code, d) => d?.runtime && out.push({ exact: exactish(d.version), floating: false, range: false, runs: false, ...d, file, line, code: String(code).trim().slice(0, 160) });
  const lines = f => (read(f) ?? '').split(/\r?\n/);
  const lineOf = (f, re) => lines(f).findIndex(l => re.test(l)) + 1 || 1;
  // containers: each FROM that names a language image; a stage built FROM an earlier stage is skipped
  for (const f of filesIn(project, n => /^(Dockerfile|Containerfile)(\..+)?$|\.(Dockerfile|Containerfile)$/i.test(n))) {
    const stages = new Set(), args = {};
    lines(f).forEach((l, k) => {
      const arg = l.match(/^\s*ARG\s+(\w+)=(\S+)/i); if (arg) args[arg[1]] = arg[2].replace(/^["']|["']$/g, '');
      const m = l.match(/^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i); if (!m) return;
      const ref = m[1].replace(/\$\{?(\w+)\}?/g, (_, v) => args[v] ?? `\${${v}}`);
      if (!stages.has(m[1].toLowerCase())) add(f, k + 1, l, fromImage(ref));
      if (m[2]) stages.add(m[2].toLowerCase());
    });
  }
  const pkg = json(join(project, 'package.json'));
  if (pkg?.engines?.node) add('package.json', lineOf('package.json', /"node"\s*:/), `"node": "${pkg.engines.node}"`, { runtime: 'node', version: lead(pkg.engines.node), range: true, how: 'engines' });
  if (pkg?.volta?.node) add('package.json', lineOf('package.json', /"node"\s*:/), `"node": "${pkg.volta.node}"`, { runtime: 'node', version: lead(pkg.volta.node), runs: true, how: 'volta' });
  for (const f of ['.nvmrc', '.node-version']) { const t = read(f)?.trim(); if (t) add(f, 1, t, { runtime: 'node', version: lead(t), runs: true, how: f }); }
  lines('.tool-versions').forEach((l, k) => { const [tool, v] = l.trim().split(/\s+/); if (TOOL[tool] && v) add('.tool-versions', k + 1, l, { runtime: TOOL[tool], version: lead(v), runs: true, how: 'asdf' }); });
  for (const [f, rt] of [['.python-version', 'python'], ['.ruby-version', 'ruby']]) { const t = read(f)?.trim(); if (t) add(f, 1, t.split(/\s/)[0], { runtime: rt, version: lead(t), runs: true, how: f }); }
  const rtxt = read('runtime.txt')?.trim(); if (rtxt && /python/i.test(rtxt)) add('runtime.txt', 1, rtxt, { runtime: 'python', version: lead(rtxt), runs: true, how: 'runtime.txt' });
  lines('pyproject.toml').forEach((l, k) => { const m = l.match(/^\s*requires-python\s*=\s*["']([^"']+)/); if (m) add('pyproject.toml', k + 1, l, { runtime: 'python', version: lead(m[1]), range: true, how: 'requires-python' }); });
  const composer = json(join(project, 'composer.json'));
  if (composer?.require?.php) add('composer.json', lineOf('composer.json', /"php"\s*:/), `"php": "${composer.require.php}"`, { runtime: 'php', version: lead(composer.require.php), range: true, how: 'composer require' });
  if (composer?.config?.platform?.php) add('composer.json', lines('composer.json').findLastIndex(l => /"php"\s*:/.test(l)) + 1 || 1, `"php": "${composer.config.platform.php}"`, { runtime: 'php', version: lead(composer.config.platform.php), runs: true, how: 'composer platform' });
  lines('go.mod').forEach((l, k) => {
    const g = l.match(/^go\s+(\S+)/), t = l.match(/^toolchain\s+go(\S+)/);
    if (g) add('go.mod', k + 1, l, { runtime: 'go', version: lead(g[1]), range: true, how: 'go.mod' });
    if (t) add('go.mod', k + 1, l, { runtime: 'go', version: lead(t[1]), runs: true, how: 'toolchain' });
  });
  lines('Gemfile').forEach((l, k) => { const m = l.match(/^\s*ruby\s+["']([^"']+)/); if (m) add('Gemfile', k + 1, l, { runtime: 'ruby', version: lead(m[1]), range: /[~<>]/.test(m[1]), runs: !/[~<>]/.test(m[1]), how: 'Gemfile' }); });
  lines('netlify.toml').forEach((l, k) => { const m = l.match(/NODE_VERSION\s*=\s*["']?([\w.]+)/); if (m) add('netlify.toml', k + 1, l, { runtime: 'node', version: lead(m[1]), runs: true, how: 'netlify' }); });
  // CI: what the tests run on (setup-node and friends, plain values and [matrix, lists])
  let wf = []; try { wf = readdirSync(join(project, '.github', 'workflows')).filter(n => /\.ya?ml$/.test(n)); } catch {}
  for (const n of wf) lines(`.github/workflows/${n}`).forEach((l, k) => {
    const m = l.match(/^\s*-?\s*(node|php|python|go|ruby)(?:-version)?\s*:\s*(.+)$/); if (!m || /\$\{\{/.test(m[2])) return;
    for (const v of m[2].match(/\d+(?:\.\d+){0,2}/g) ?? []) add(`.github/workflows/${n}`, k + 1, l, { runtime: m[1], version: v, range: true, how: 'CI' });
  });
  return out;
}
/** Files in a project, two folders deep, whose names pass a test (so a monorepo's backend/ and web/ count too). */
function filesIn(project, test) {
  const files = [], look = (dir, depth) => {
    let es = []; try { es = readdirSync(join(project, dir), { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isFile() && test(e.name)) files.push(rel);
      else if (e.isDirectory() && depth < 2 && !/^(node_modules|\.git|vendor|dist|build|\.next|out|target|\.?venv|__pycache__)$/.test(e.name)) look(rel, depth + 1);
    }
  };
  look('', 0);
  return files;
}

// ---------- what a project pulls in: every lockfile it has, in six languages ----------
const lineMap = (L, re) => { const m = new Map(); L.forEach((l, k) => { const x = l.match(re); if (x && !m.has(x[1])) m.set(x[1], k); }); return m; };
// the [[package]] blocks of a TOML lockfile (Cargo, Poetry, uv): name (and its line), version, source, a [package.source] type
const tomlPackages = L => {
  const out = []; let b = null;
  L.forEach((l, k) => {
    if (/^\[\[package\]\]/.test(l)) out.push(b = { k });
    else if (/^\[(?!package\.)/.test(l)) b = null;
    else if (b) { const m = l.match(/^(name|version|source|type)\s*=\s*(.+)$/); if (m && !(m[1] in b)) { b[m[1]] = m[2].trim(); if (m[1] === 'name') b.k = k; } }
  });
  return out.filter(b => b.name && b.version).map(b => ({ ...b, name: b.name.replace(/^"|"$/g, ''), version: b.version.replace(/^"|"$/g, '') }));
};
const PNPM = /^ {2}['"]?\/?((?:@[^/\s'"]+\/)?[^@/\s'"(]+)[@/](\d[^\s'"(:_]*)/;  // v5 /name/1.0.0, v6 /name@1.0.0, v9 name@1.0.0
// each lockfile: its name, its ecosystem in OSV's words, and a reader that gives [{ name, version, k (0-based line) }]
const LOCKS = [
  [/^(package-lock|npm-shrinkwrap)\.json$/, 'npm', (t, L) => {
    const at = lineMap(L, /^\s*"((?:[^"]*\/)?node_modules\/[^"]+)"\s*:\s*\{/);
    return Object.entries(JSON.parse(t).packages ?? {}).filter(([p, i]) => p && !i.link && i.version)
      .map(([p, i]) => ({ name: i.name ?? p.slice(p.lastIndexOf('node_modules/') + 13), version: i.version, k: at.get(p) }));
  }],
  [/^pnpm-lock\.yaml$/, 'npm', (t, L) => { let sec = ''; return L.flatMap((l, k) => { if (/^\S/.test(l)) sec = l.replace(/:.*$/, ''); const m = sec === 'packages' && l.match(PNPM); return m ? [{ name: m[1], version: m[2], k }] : []; }); }],
  [/^yarn\.lock$/, 'npm', (t, L) => {  // classic: `name@^1.0.0:` then `version "1.0.3"`; berry: `"name@npm:^1.0.0":` then `version: 1.0.3`
    const out = []; let cur = null;
    L.forEach((l, k) => {
      if (/^[^\s#].*:$/.test(l)) { const spec = l.split(/,\s*/)[0].replace(/^"|"?:?$/g, ''); cur = /@(workspace|link|portal|file|patch):/.test(l) || spec.startsWith('__metadata') ? null : { name: spec.slice(0, spec.indexOf('@', 1)), k }; }
      else if (cur) { const m = l.match(/^\s+version:?\s+"?([^"\s]+)"?/); if (m) { out.push({ ...cur, version: m[1] }); cur = null; } }
    });
    return out;
  }],
  [/^composer\.lock$/, 'Packagist', (t, L) => {
    const lock = JSON.parse(t), at = lineMap(L, /"name"\s*:\s*"([^"]+)"/);
    return [...lock.packages ?? [], ...lock['packages-dev'] ?? []].filter(p => p.name && p.version && !/^dev-|-dev$/.test(p.version)).map(p => ({ name: p.name, version: p.version, k: at.get(p.name) }));
  }],
  [/^(poetry|uv)\.lock$/, 'PyPI', (t, L) => tomlPackages(L).filter(b => !/^"(git|directory|file|url)"$/.test(b.type ?? '') && !/\{\s*(editable|virtual|directory|path|git|url)\s*=/.test(b.source ?? ''))],
  [/^Pipfile\.lock$/, 'PyPI', (t, L) => {
    const lock = JSON.parse(t), at = lineMap(L, /^\s*"([^"]+)"\s*:\s*\{/);
    return ['default', 'develop'].flatMap(s => Object.entries(lock[s] ?? {})).filter(([, v]) => /^===?/.test(v.version ?? '')).map(([name, v]) => ({ name, version: v.version.replace(/^=+/, ''), k: at.get(name) }));
  }],
  [/^requirements[\w.-]*\.txt$/, 'PyPI', (t, L) => L.flatMap((l, k) => {  // only an exact pin says what's installed; a range is kept with no version, to be named
    const m = l.match(/^\s*([A-Za-z0-9][\w.-]*)(?:\[[^\]]*\])?(?=\s*(?:[<>=!~;,#]|$))(?:\s*===?\s*([^\s;#\\,]+))?/);
    return m ? [{ name: m[1], version: m[2] && !m[2].includes('*') ? m[2] : null, k }] : [];
  })],
  [/^Cargo\.lock$/, 'crates.io', (t, L) => tomlPackages(L).filter(b => /^"(registry|sparse)\+/.test(b.source ?? ''))],  // no source: the project's own crates
  [/^go\.mod$/, 'Go', (t, L) => {
    let block = false;
    return L.flatMap((l, k) => {
      if (/^require\s*\(/.test(l)) { block = true; return []; }
      if (block && /^\s*\)/.test(l)) { block = false; return []; }
      const m = block ? l.match(/^\s*([^\s/]\S*)\s+v(\S+)/) : l.match(/^require\s+(\S+)\s+v(\S+)/);
      return m ? [{ name: m[1], version: m[2], k }] : [];
    });
  }],
  [/^Gemfile\.lock$/, 'RubyGems', (t, L) => { let sec = ''; return L.flatMap((l, k) => { if (/^\S/.test(l)) sec = l.trim(); const m = sec === 'GEM' && l.match(/^ {4}([^\s(]+) \(([^)]+)\)\s*$/); return m ? [{ name: m[1], version: m[2].replace(/-.*$/, ''), k }] : []; }); }],  // 1.15.4-x86_64-linux: the platform isn't the version
];
/** Every package a project's lockfiles pin: [{ eco, name, version, file, line, code }]; version is null for a requirement with
 *  no exact pin. A lockfile that won't parse is skipped. */
export function locksOf(project) {
  const out = [];
  for (const f of filesIn(project, n => LOCKS.some(([re]) => re.test(n)))) {
    const [, eco, read] = LOCKS.find(([re]) => re.test(f.split('/').pop()));
    let L, found;
    try { const t = readFileSync(join(project, f), 'utf8'); L = t.split(/\r?\n/); found = read(t, L); } catch { continue; }
    for (const x of found) out.push({ eco, name: x.name, version: x.version, file: f, line: (x.k ?? 0) + 1, code: (L[x.k ?? 0] ?? '').trim().slice(0, 160) });
  }
  return out;
}
/** The ecosystems a project uses, so only their advisories are fetched. */
export const ecosystemsOf = project => [...new Set([...existsSync(join(project, 'node_modules')) ? ['npm'] : [], ...locksOf(project).filter(l => l.version).map(l => l.eco)])];

// ---------- what each one means: storms, end of life, floating tags ----------
const cycleOf = d => {
  const v = d.version?.split('.') ?? [];
  if (d.runtime === 'node') return v[0] ?? null;  // Node's cycles are majors; the rest are major.minor
  return v.length >= 2 ? `${v[0]}.${v[1]}` : null;
};
/** When fixes stop for this runtime's cycle, from the bundled snapshot: { cycle, end, past, soon, next } or null. */
export function eolOf(d) {
  const table = EOL.runtimes[d.runtime], cycle = cycleOf(d);
  if (!table || !cycle || !(cycle in table)) return null;
  const [end] = table[cycle], now = today(), soonDate = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
  const next = Object.entries(table).filter(([, [e, born]]) => (!born || born <= now) && (e === null || (e !== true && e > now))).map(([c]) => c).sort(cmp).reverse().slice(0, 2);
  if (end === null) return { cycle, end: null, past: false, soon: false, next };
  const past = end === true || end <= now;
  return { cycle, end: end === true ? null : end, past, soon: !past && end <= soonDate, next };
}
/** Which runtime storms touch this declaration: [{ storm, status: in | check | clear, fix, nofix }]. */
export function stormsOf(d) {
  return STORMS.filter(s => s.runtime === d.runtime).map(s => {
    const branches = Object.keys(s.fixed).sort(cmp), all = branches.map(b => s.fixed[b]);
    if (!d.version || d.version.split('.').length < 2) return { storm: s, status: 'check', fix: all };  // no version to go on: depends on the build
    const [maj, min] = d.version.split('.'), branch = `${maj}.${min}`;
    if (cmp(branch, s.from) < 0 || cmp(branch, branches.at(-1)) > 0) return null;  // older than the bug, or newer than every fix
    const fix = s.fixed[branch];
    if (!fix) return d.range ? { storm: s, status: 'check', nofix: true, fix: all } : { storm: s, status: 'in', nofix: true, fix: all };
    if (d.exact) return { storm: s, status: cmp(d.version, fix) < 0 ? 'in' : 'clear', fix: [fix] };
    return { storm: s, status: 'check', fix: [fix] };
  }).filter(Boolean);
}
const list = xs => xs.length <= 2 ? xs.join(' or ') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`;
/** What a declaration means, in slowship's words: { level, findings: [{ kind, level, says, fix }] }. */
export function judgeRuntime(d) {
  const name = `${RUNTIME[d.runtime] ?? d.runtime}${d.version ? ' ' + d.version : ''}`, findings = [];
  for (const h of stormsOf(d)) {
    if (h.status === 'clear') continue;
    const s = h.storm, crit = s.severity === 'critical';
    const where = d.floating ? `${d.image} only gets the fix when you pull and rebuild` : d.range ? `this project allows ${name}` : `this runs ${name}`;
    const says = h.nofix ? `${s.id}: ${s.says}. ${RUNTIME[d.runtime]} ${cycleOf(d)} gets no official fix, and ${where}`
      : h.status === 'in' ? `${s.id}: ${s.says}. Fixed in ${list(h.fix)}, and ${where}`
      : `${s.id}: ${s.says}. Fixed in ${list(h.fix)}; ${where}, so check which build you're on`;
    const to = h.fix.at(-1), flavour = (d.image?.match(/-[a-z][\w.-]*$/) ?? [''])[0];
    const fix = d.image && !d.version ? `Pin ${d.image.replace(/[:@].*$/, '')} to a fixed version (${list(h.fix)}), rebuild the image, and ${s.restart}.`
      : d.image ? `Move ${d.image} to ${d.image.replace(/:.*$/, '')}:${h.nofix ? to : h.fix[0]}${flavour} or newer, rebuild the image, and ${s.restart}.`
      : h.nofix ? `Move to a branch that's still fixed (${RUNTIME[d.runtime]} ${list(h.fix)}) and ${s.restart}. ${s.backports}`
      : `Update to ${RUNTIME[d.runtime]} ${h.fix[0]} or newer and ${s.restart}. ${s.backports}`;
    // a range only allows the old version (the image or pin is what runs), so it's noted, not queued
    const level = h.status === 'in' ? (crit ? 'hold' : 'review') : crit && !d.range ? 'review' : 'notable';
    findings.push({ kind: 'storm', level, says, fix, storm: s.id, status: h.status });
  }
  const eol = eolOf(d);
  if (eol?.past || eol?.soon) {
    const when = eol.end ? (eol.past ? `since ${eol.end}` : `from ${eol.end}`) : 'for years';
    const says = eol.past ? `No one fixes ${RUNTIME[d.runtime]} ${eol.cycle} any more (${when})${d.runs ? '' : d.how === 'CI' ? ', and your tests still run on it' : ', and this project still allows it'}`
      : `Fixes for ${RUNTIME[d.runtime]} ${eol.cycle} stop ${when}`;
    findings.push({ kind: 'eol', level: eol.past && d.runs ? 'review' : 'notable', says, fix: eol.next.length ? `Move to ${RUNTIME[d.runtime]} ${list(eol.next)}.` : '' });
  }
  if (d.floating && !findings.some(f => f.kind === 'storm')) findings.push({ kind: 'floating', level: 'notable', says: `${d.image} is a floating tag: fixes reach you only when you pull and rebuild`, fix: `Pin an exact version (${d.image.replace(/:.*$/, '')}:x.y.z) and bump it on purpose.` });
  return { name, eol, level: worst(findings.map(f => f.level)), findings };
}

// ---------- what a takeover would get ----------
const TOUCH = [['net', 'the network'], ['exec', 'programs'], ['fs-write', 'files'], ['secret-path', 'credential files'], ['persist-path', 'autostart places'], ['code', 'code it builds at runtime'], ['ipc-unchecked', 'calls from your pages']];
/** Keys a set of items' code reads, by name (never values). */
const keysOf = items => [...new Set(items.flatMap(i => [...(i.keys ?? []), ...keysFrom(i.facts ?? [])].map(k => k.name)))];
/** For an item caught in a storm: what it already touches itself, and what a takeover inherits from the process it runs in. */
export function blastOf(item, inherited = []) {
  const caps = new Set([...(item.caps ?? []), ...(item.facts ?? []).map(f => f.cap)]);
  const touches = TOUCH.filter(([c]) => caps.has(c)).map(([, w]) => w), own = keysOf([item]);
  const keys = [...new Set([...own, ...inherited])];
  const k = keys.length ? `${keys.length} key${keys.length > 1 ? 's' : ''} (${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''})` : 'no keys slowship could see';
  const says = item.kind === 'runtime' ? `A takeover runs as your app: it gets ${k}, and everything the app can reach`
    : item.kind === 'skill' || item.kind === 'mcp' ? `A takeover runs inside your agent: it gets ${k}${touches.length ? `, and already touches ${list(touches)}` : ''}`
    : `A takeover runs inside your app: it gets ${k}${touches.length ? `; on its own it already touches ${list(touches)}` : ''}`;
  return { keys, touches, score: keys.length * 3 + touches.length, says };
}

// ---------- the public advisories, matched here ----------
const OSV = 'https://osv-vulnerabilities.storage.googleapis.com';
export const ADVISORIES = () => process.env.SLOWSHIP_ADVISORIES || join(HOME, 'advisories');
/** Whether advisories for an ecosystem are on this computer, and from when. */
export const advisoryStatus = (eco = 'npm') => json(join(ADVISORIES(), eco, 'meta.json'));

/** A zip's files, read in memory (zip64 directories too: OSV's npm archive holds more than 65,535 files). */
export function* zipEntries(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip file');
  let n = buf.readUInt16LE(e + 10), p = buf.readUInt32LE(e + 16);
  if (n === 0xFFFF || p === 0xFFFFFFFF) {
    const loc = e - 20;
    if (buf.readUInt32LE(loc) !== 0x07064b50) throw new Error('bad zip64 locator');
    const z = Number(buf.readBigUInt64LE(loc + 8));
    n = Number(buf.readBigUInt64LE(z + 32)); p = Number(buf.readBigUInt64LE(z + 48));
  }
  for (; n > 0; n--) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip directory');
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    p += 46 + nl + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (name.endsWith('/')) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28), data = buf.subarray(start, start + size);
    yield { name, body: method === 8 ? inflateRawSync(data) : data };
  }
}
// what's kept of an advisory: enough to match it and to say it in slowship's own words
function compact(a, eco) {
  if (a.withdrawn) return null;
  const p = [];
  for (const af of a.affected ?? []) {
    if (af.package?.ecosystem !== eco || !af.package?.name) continue;
    const ranges = (af.ranges ?? []).filter(r => r.type === 'SEMVER' || r.type === 'ECOSYSTEM').map(r => r.events);
    p.push([af.package.name, ranges, ranges.length ? [] : (af.versions ?? [])]);
  }
  if (!p.length) return null;
  return { v: (a.database_specific?.severity ?? '').toLowerCase() || null, m: a.id.startsWith('MAL-') ? 1 : 0, a: (a.aliases ?? []).filter(x => /^(CVE|GHSA)-/.test(x)).slice(0, 3), s: (a.summary ?? '').slice(0, 140), p };
}
function keep(eco, ix, meta) {
  const dir = join(ADVISORIES(), eco); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.json.tmp'), JSON.stringify(ix)); renameSync(join(dir, 'index.json.tmp'), join(dir, 'index.json'));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
  loaded.delete(dir);
}
/** Bring one ecosystem's advisories up to date: the whole archive the first time (or when far behind), then only what changed. */
export async function syncAdvisories(eco = 'npm', { fetch = globalThis.fetch, log = () => {} } = {}) {
  const meta = advisoryStatus(eco), ix = meta && json(join(ADVISORIES(), eco, 'index.json'));
  if (meta && ix) {  // modified_id.csv: newest first, "time,id"
    const r = await fetch(`${OSV}/${encodeURIComponent(eco)}/modified_id.csv`, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`OSV answered ${r.status}`);
    const fresh = [], since = Date.parse(meta.modified);  // times differ in how many decimals they carry: compare them as times
    let newest = meta.modified;
    for (const row of (await r.text()).split('\n')) {
      const [t, id] = row.trim().split(',');
      if (!id) continue;
      if (Date.parse(t) <= since) break;
      if (Date.parse(t) > Date.parse(newest)) newest = t;
      fresh.push(id.replace(/^.*\//, ''));
      if (fresh.length > 3000) break;
    }
    if (fresh.length <= 3000) {
      log(`${fresh.length} advisories changed since ${meta.modified}`);
      for (let k = 0; k < fresh.length; k += 16) await Promise.all(fresh.slice(k, k + 16).map(async id => {
        const a = await fetch(`${OSV}/${encodeURIComponent(eco)}/${id}.json`, { signal: AbortSignal.timeout(30_000) }).then(x => x.ok ? x.json() : null).catch(() => null);
        if (!a) return;
        const c = compact(a, eco); if (c) ix[id] = c; else delete ix[id];
      }));
      keep(eco, ix, { ...meta, modified: newest, synced: new Date().toISOString(), count: Object.keys(ix).length });
      return { eco, changed: fresh.length, count: Object.keys(ix).length };
    }
  }
  log(`downloading every ${eco} advisory from OSV (once; later nights fetch only what changed)…`);
  const r = await fetch(`${OSV}/${encodeURIComponent(eco)}/all.zip`, { signal: AbortSignal.timeout(15 * 60_000) });
  if (!r.ok) throw new Error(`OSV answered ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer()), out = {};
  let modified = '';
  for (const { name, body } of zipEntries(buf)) {
    if (!name.endsWith('.json')) continue;
    let a; try { a = JSON.parse(body); } catch { continue; }
    if (!modified || Date.parse(a.modified) > Date.parse(modified)) modified = a.modified;
    const c = compact(a, eco); if (c) out[a.id] = c;
  }
  keep(eco, out, { eco, modified, synced: new Date().toISOString(), count: Object.keys(out).length, bytes: buf.length });
  return { eco, changed: null, count: Object.keys(out).length };
}
/** Brings a project's ecosystems up to date: the first download only when asked (force), after that at most once a day.
 *  Never fatal: a failed fetch keeps the copy here. Gives one line per ecosystem it touched. */
export async function refreshAdvisories(project, { force = false, fetch, log = () => {} } = {}) {
  const notes = [];
  for (const eco of ecosystemsOf(project)) {
    const m = advisoryStatus(eco);
    if (!force && (!m || Date.now() - Date.parse(m.synced) < 20 * 3600e3)) continue;
    try {
      const r = await syncAdvisories(eco, { fetch, log });
      notes.push(`advisories: ${r.count.toLocaleString('en')} for ${eco} on this computer${r.changed != null ? `, ${r.changed} changed since last time` : ''}`);
    } catch (e) { notes.push(`couldn't update the ${eco} advisories (${e.message}); using the copy here`); }
  }
  return notes;
}
const loaded = new Map();  // by the store's folder, so a different SLOWSHIP_ADVISORIES never answers from the old one
function byName(eco) {
  const dir = join(ADVISORIES(), eco);
  if (!loaded.has(dir)) {
    const ix = json(join(dir, 'index.json')), by = new Map();
    for (const [id, a] of Object.entries(ix ?? {})) for (const [raw, ranges, versions] of a.p) { const name = norm(eco, raw); (by.get(name) ?? by.set(name, []).get(name)).push({ id, a, ranges, versions }); }
    loaded.set(dir, ix ? by : null);
  }
  return loaded.get(dir);
}
/** Is version v inside an OSV range? Events in version order: introduced turns it on, fixed turns it off, last_affected
 *  is the last one still on. */
export function inRange(v, events, c = cmp) {
  const evs = events.map(e => { const [t, at] = Object.entries(e)[0]; return { t, at: String(at) }; }).filter(e => e.t !== 'limit')
    .sort((x, y) => x.at === '0' ? -1 : y.at === '0' ? 1 : c(x.at, y.at));
  let on = false;
  for (const e of evs) {
    if (e.at !== '0' && c(e.at, v) > 0) break;
    if (e.t === 'introduced') on = true;
    else if (e.t === 'fixed') on = false;
    else if (e.t === 'last_affected' && c(v, e.at) > 0) on = false;
  }
  return on;
}
const fixedAfter = (v, ranges, c) => ranges.flat().map(e => e.fixed).filter(f => f && c(f, v) > 0).sort(c)[0] ?? null;
/** The advisories that name this package at this version, or null if advisories were never downloaded. */
export function advisoriesFor(eco, name, version) {
  const by = byName(eco), c = cmpOf(eco);
  if (!by) return null;
  return (by.get(norm(eco, name)) ?? []).filter(x => x.versions.length ? x.versions.some(y => c(y, version) === 0) : x.ranges.some(ev => inRange(version, ev, c)))
    .map(x => ({ id: x.id, aliases: x.a.a, severity: x.a.v, malicious: !!x.a.m, summary: x.a.s, fixed: fixedAfter(version, x.ranges, c) }));
}

// ---------- after a watch: the runtimes as items, advisories on the packages, a blast radius on everything in a storm ----------
// a known vulnerability asks for a glance at most: only code found doing harm, or a known-malicious package, holds the ship
const SEV = { critical: 'review', high: 'review', moderate: 'notable', medium: 'notable', low: 'info' };
const STORMY = new Set(['storm', 'malicious', 'eol', 'floating']);
const RANK = ['critical', 'high', 'moderate', 'medium', 'low', null];
/** One package's advisories in slowship's words: a fact per advisory, pointing at where the version is pinned, and one
 *  finding per package however many name it (how many, the worst, the one version that fixes them all). */
function advisoryFindings(eco, name, xs, at) {
  const c = cmpOf(eco);
  xs.sort((a, b) => b.malicious - a.malicious || RANK.indexOf(a.severity) - RANK.indexOf(b.severity));
  const facts = xs.map((x, k) => ({ id: `V${k + 1}`, cap: 'storm', detail: `${x.id}${x.severity ? ` (${x.severity})` : ''}`, ...at }));
  const ids = l => l.slice(0, 2).map(x => x.id).join(', ') + (l.length > 2 ? ', …' : ''), ev = l => l.slice(0, 3).map(x => `V${xs.indexOf(x) + 1}`);
  const bad = xs.filter(x => x.malicious), vulns = xs.filter(x => !x.malicious), found = [];
  if (bad.length) found.push({ kind: 'malicious', level: 'hold', says: `${ids(bad)}: a known malicious package`, fix: `Remove ${name}, and look for what it may already have done.`, evidence: ev(bad), matches_claim: 'no', advisories: bad });
  if (vulns.length) {
    const worstSev = vulns[0].severity, all = vulns.every(x => x.fixed) ? vulns.map(x => x.fixed).sort(c).at(-1) : null;
    const says = vulns.length === 1 ? `${ids(vulns)}: a known ${worstSev ? worstSev + ' ' : ''}vulnerability${all ? `, fixed in ${all}` : ', with no fixed version yet'}`
      : `${vulns.length} known vulnerabilities, the worst ${worstSev ?? 'unrated'} (${ids(vulns)})${all ? `, all fixed in ${all}` : ', some with no fixed version yet'}`;
    found.push({ kind: 'storm', level: SEV[worstSev] ?? 'notable', says, evidence: ev(vulns), matches_claim: 'unknown', advisories: vulns,
      fix: all ? `Update ${name} to ${all} or newer.` : `Update ${name} to its newest version; for what has no fix yet, replace it or keep it away from untrusted input.` });
  }
  return { facts, found };
}
// what an archive weighed on 22 October 2026, for the "download once" hint
const ZIP_MB = { npm: 219, PyPI: 37, Go: 13, Packagist: 11, RubyGems: 5, 'crates.io': 4 };
/** Adds what Storm watch finds to a finished run, in place. Nothing here is cached: advisories change nightly, code doesn't. */
export function applyStorm(run, project) {
  const state = load(), decls = project ? runtimesOf(project) : [], all = project ? locksOf(project) : [], locks = all.filter(l => l.version);
  // requirements with no exact pin can't be matched: say how many, so quiet isn't read as clean
  const unpinned = Object.entries(Object.groupBy(all.filter(l => !l.version), l => l.file)).map(([file, ls]) => ({ file, names: ls.map(l => l.name) }));
  // the keys the app holds: what its JavaScript reads, plus the names in an .env.example (any language; never a value)
  const envKeys = project ? ['.env.example', '.env.sample', '.env.template'].flatMap(f => { try { return keysNamed(readFileSync(join(project, f), 'utf8'), f).map(k => k.name); } catch { return []; } }) : [];
  const inherited = [...new Set([...keysOf(run.items.filter(i => i.kind === 'npm' || i.kind === 'app')), ...envKeys])];
  const layer = [];
  for (const d of decls) {
    const j = judgeRuntime(d);
    layer.push({ runtime: d.runtime, version: d.version, image: d.image ?? null, how: d.how, runs: d.runs, floating: d.floating, file: d.file, line: d.line, code: d.code, level: j.level, eol: j.eol, storms: stormsOf(d).map(h => ({ id: h.storm.id, status: h.status })) });
    if (j.level === 'info') continue;
    const key = `runtime:${d.runtime}@${d.file}:${d.line}:${d.version ?? d.image}`, fp = `rt-${sha([project, d.file, d.code, j.findings.map(f => f.says).join('|')].join('\n'))}`;
    const item = {
      kind: 'runtime', key, name: d.image ?? j.name, dir: project, fp, claim: '', level: j.level, rules: 0,
      findings: j.findings.map(f => ({ ...f, evidence: ['R1'], matches_claim: 'unknown' })),
      facts: [{ id: 'R1', cap: 'runtime', detail: `${d.how}: ${j.name}`, file: d.file, line: d.line, code: d.code }],
      caps: ['runtime'], coverage: { files: 1, read: 1, skipped: [], errors: [] }, approved: state.approved[key] === fp, runtime: d,
    };
    item.blast = blastOf(item, inherited);
    run.items.push(item);
  }
  const tally = {}, count = (eco, hit) => { const t = tally[eco] ??= { checked: 0, hits: 0 }; t.checked++; if (hit) t.hits++; };
  // installed npm packages: their code was read, so the advisories join what it does
  if (advisoryStatus('npm')) for (const i of run.items) {
    if (i.kind !== 'npm') continue;
    const at = i.key.lastIndexOf('@'), name = i.key.slice(4, at), version = i.key.slice(at + 1), xs = advisoriesFor('npm', name, version) ?? [];
    count('npm', xs.length);
    if (!xs.length) continue;
    const pkgLines = (() => { try { return readFileSync(join(i.dir, 'package.json'), 'utf8').split(/\r?\n/); } catch { return []; } })();
    const line = pkgLines.findIndex(l => /"version"\s*:/.test(l)) + 1 || 1;
    const { facts, found } = advisoryFindings('npm', name, xs, { file: 'package.json', line, code: pkgLines[line - 1]?.trim() ?? `"version": "${version}"` });
    i.facts = [...facts, ...(i.facts ?? [])];  // new arrays: copies of one package share the cached ones
    i.findings = [...found, ...(i.findings ?? [])].sort((a, b) => ['hold', 'review', 'notable', 'info'].indexOf(a.level) - ['hold', 'review', 'notable', 'info'].indexOf(b.level));
    i.level = worst([i.level, ...found.map(f => f.level)]);
  }
  // everything else a lockfile pins, in any language, installed or not: matched by name and version, its code not read
  const keys = new Set(run.items.map(i => i.key));
  for (const l of locks) {
    const key = `${l.eco}:${l.name}@${l.version}`;
    if (keys.has(key)) continue;  // an installed npm package (above), or the same pin in a second lockfile
    keys.add(key);
    const xs = advisoriesFor(l.eco, l.name, l.version);
    if (!xs) continue;  // that ecosystem was never downloaded
    count(l.eco, xs.length);
    if (!xs.length) continue;
    const { facts, found } = advisoryFindings(l.eco, l.name, xs, { file: l.file, line: l.line, code: l.code });
    const fp = `dep-${sha([key, ...found.map(f => f.says)].join('\n'))}`;
    const item = {
      kind: 'dep', eco: l.eco, key, name: l.name, version: l.version, dir: project, fp, claim: '', level: worst(found.map(f => f.level)), rules: 0,
      findings: found, facts, caps: ['storm'], coverage: { files: 1, read: 1, skipped: [], errors: [] }, approved: state.approved[key] === fp,
    };
    item.blast = blastOf(item, inherited);
    run.items.push(item);
  }
  for (const i of run.items) if (!i.blast && i.findings?.some(f => STORMY.has(f.kind))) i.blast = blastOf(i, i.kind === 'npm' ? inherited : []);
  const advisories = {};
  for (const eco of new Set([...run.items.some(i => i.kind === 'npm') ? ['npm'] : [], ...locks.map(l => l.eco)])) {
    const m = advisoryStatus(eco);
    advisories[eco] = m ? { count: m.count, synced: m.synced, checked: 0, hits: 0, ...tally[eco] } : { missing: true, mb: ZIP_MB[eco] ?? null };
  }
  run.storm = { snapshot: EOL.snapshot, storms: STORMS.map(s => ({ id: s.id, published: s.published, runtime: s.runtime, cves: s.cves })), layer, advisories, unpinned };
  run.level = worst(run.items.filter(i => !i.approved).map(i => i.level));
  return run;
}

/** The storm part of a run, as plain text: for the terminal, slowship storm and the agent. Slowship's words only. */
export function stormText(run) {
  const st = run.storm ?? {}, out = [], advs = Object.entries(st.advisories ?? {});
  for (const [eco, a] of advs) if (!a.missing) out.push(`Advisories, ${eco}: ${a.count.toLocaleString('en')} known, synced ${a.synced?.slice(0, 16).replace('T', ' ')} UTC, matched on this computer: ${a.checked} packages checked, ${a.hits} in a storm.`);
  const miss = advs.filter(([, a]) => a.missing);
  if (miss.length) out.push(`Advisories not on this computer yet for ${list(miss.map(([e, a]) => `${e}${a.mb ? ` (about ${a.mb} MB)` : ''}`))}. Run: slowship storm --sync (once; later nights fetch only what changed). Your inventory never leaves.`);
  if (!advs.length) out.push('Advisories: no lockfile or installed packages here to match against them.');
  for (const u of st.unpinned ?? []) out.push(`${u.file}: ${u.names.length} package${u.names.length > 1 ? 's' : ''} with no exact version (${u.names.slice(0, 3).join(', ')}${u.names.length > 3 ? ', …' : ''}), so ${u.names.length > 1 ? 'they' : 'it'} can't be matched. Pin them (pip freeze), or use a lockfile (uv lock, poetry lock).`);
  out.push(`Runtime storms on file: ${(st.storms ?? []).map(s => `${s.id} (${s.published})`).join(', ') || 'none'}. End-of-life dates as of ${st.snapshot}.`);
  if (st.layer?.length) {
    out.push('', 'What it runs on:');
    for (const d of st.layer) out.push(`  ${d.runs ? 'runs  ' : d.how === 'CI' ? 'tests ' : 'allows'} ${RUNTIME[d.runtime] ?? d.runtime} ${d.version ?? '?'}${d.image ? ` (${d.image})` : ''}  ${d.file}:${d.line}  ${d.level === 'info' ? 'fine' : d.level}`);
  }
  const caught = run.items.filter(i => !i.approved && i.findings?.some(f => STORMY.has(f.kind) && f.level !== 'notable'));
  out.push('', caught.length ? 'In a storm:' : 'Nothing aboard is in a storm.');
  const LV = { hold: 3, review: 2 };
  for (const i of caught.sort((x, y) => (LV[y.level] ?? 0) - (LV[x.level] ?? 0) || (y.blast?.score ?? 0) - (x.blast?.score ?? 0))) {
    out.push(`  ${i.level === 'hold' ? 'HELD  ' : 'GLANCE'} ${i.kind === 'npm' ? i.key.replace(/^npm:/, '') : i.kind === 'dep' ? `${i.name}@${i.version} (${i.eco}, ${i.facts[0].file}:${i.facts[0].line})` : i.name}`);
    for (const f of i.findings.filter(f => STORMY.has(f.kind) && f.level !== 'notable').slice(0, 3)) out.push(`         ${f.says}`, ...(f.fix ? [`         fix: ${f.fix}`] : []));
    if (i.blast) out.push(`         ${i.blast.says}`);
  }
  return out.join('\n');
}
