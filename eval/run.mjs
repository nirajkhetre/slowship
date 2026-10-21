#!/usr/bin/env node
// slowship's evaluation. Fetches pinned, reproducible subsets of public malware datasets into a quarantine folder,
// scores them with slowship's own scan path (scan.checkItems), and prints the tables in EVAL.md.
// Nothing downloaded is ever executed: samples are written, hashed and read as text, as in a normal slowship run.
//
//   node eval/run.mjs fetch <set>            set: malskillbench | datadog-npm | datadog-skills
//   node eval/run.mjs score <set> [--model]  needs Ollama + gemma4:e2b for --model
//   node eval/run.mjs lazy                   wall time of a full and a cached run of $SLOWSHIP_EVAL_BENIGN
//   node eval/run.mjs selftest               checks the unzipper (no network, no samples)
//
// SLOWSHIP_EVAL_ROOT (default D:/slowship-eval) holds samples and results. SLOWSHIP_EVAL_BENIGN (default
// D:/sloth-test) is an npm project whose installed packages are the benign side of the package test.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

const ROOT = resolve(process.env.SLOWSHIP_EVAL_ROOT || 'D:/slowship-eval');
const BENIGN_NPM = resolve(process.env.SLOWSHIP_EVAL_BENIGN || 'D:/sloth-test');
const REPO = resolve(import.meta.dirname, '..');
const [cmd, set] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const withModel = process.argv.includes('--model');

// Pinned commits and tree hashes: the same command always selects the same bytes.
const MSB = { repo: 'lxyeternal/MalSkillBench', commit: '06e083125d5ec5dd7a189dfedadfe587a70635b9' };
const DD = { repo: 'DataDog/malicious-software-packages-dataset', commit: '8a74a4c8ee0e1a2927f0419e0710968702ded609' };
const SETS = {
  malskillbench: { ...MSB, kind: 'skill', unit: 'dir', groups: [
    { name: 'malware', label: 1, base: 'Dataset/Skills/malware', tree: 'e915d969b2dcd3f12d4f1a498fa2aad9b6f8d1bc', n: 100 },
    { name: 'benign', label: 0, base: 'Dataset/Skills/benign', tree: '3e3b2b15269203aa8fdbadf281eae5ef7a77efdc', n: 100 }] },
  'datadog-npm': { ...DD, kind: 'npm', unit: 'zip', benign: 'npm', groups: [
    { name: 'compromised_lib', label: 1, base: 'samples/npm/compromised_lib', tree: 'fa24c97c54835d563042b73acba6b1985f8a929e', n: 50 },
    { name: 'malicious_intent', label: 1, base: 'samples/npm/malicious_intent', tree: '62213f4639af9ce4e63079633f68ab316c53c5f1', n: 50 }] },
  'datadog-skills': { ...DD, kind: 'skill', unit: 'zip', groups: [
    { name: 'ai-skills', label: 1, base: 'samples/ai-skills', tree: 'f775ef33a3f7ece75afd6f915b7b2b1508f534a0', n: Infinity }] },
};

const sha256 = s => createHash('sha256').update(s).digest('hex');
const gitBlob = b => createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
// One safe Windows path segment: no reserved characters, no trailing dots, no device names (CON, NUL, COM1…), no "..".
const safe = s => {
  const t = s.replace(/[<>:"|?*\\\x00-\x1f]/g, '_').replace(/[. ]+$/, '_') || '_';
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(t) ? `_${t}` : t;
};

async function get(url) {
  for (let t = 0; ; t++) {
    const r = await fetch(url, { headers: { 'user-agent': 'slowship-eval' } });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (t >= 3 || r.status === 404) throw new Error(`${r.status} ${url}`);
    await new Promise(ok => setTimeout(ok, 3000 * (t + 1)));
  }
}
const raw = (s, path) => `https://raw.githubusercontent.com/${s.repo}/${s.commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) await fn(list[i++]); }));
}

// ---------- unzip: classic ZipCrypto (the "infected" password convention), regular files only, never outside dest ----------
const CRC = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xEDB88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crcByte = (c, b) => (CRC[(c ^ b) & 0xff] ^ (c >>> 8)) >>> 0;
function zipCrypto(pw) {
  const k = [0x12345678, 0x23456789, 0x34567890];
  const upd = b => { k[0] = crcByte(k[0], b); k[1] = (Math.imul((k[1] + (k[0] & 0xff)) >>> 0, 134775813) + 1) >>> 0; k[2] = crcByte(k[2], k[1] >>> 24); };
  const key = () => { const t = (k[2] | 2) & 0xffff; return ((t * (t ^ 1)) >>> 8) & 0xff; };
  for (const b of Buffer.from(pw)) upd(b);
  return {
    decrypt: d => { const o = Buffer.alloc(d.length); for (let i = 0; i < d.length; i++) { o[i] = d[i] ^ key(); upd(o[i]); } return o.subarray(12); },
    encrypt: d => { const o = Buffer.alloc(d.length); for (let i = 0; i < d.length; i++) { o[i] = d[i] ^ key(); upd(d[i]); } return o; },
  };
}

export function unzip(buf, dest, password) {
  const root = resolve(dest), files = [];
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip directory');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), mode = buf.readUInt32LE(p + 38) >>> 16, local = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (name.endsWith('/') || (mode & 0xF000) === 0xA000) continue;  // directories and symlinks
    if (size === 0xFFFFFFFF) throw new Error('zip64 not supported');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    let data = buf.subarray(start, start + size);
    if (flags & 1) data = zipCrypto(password).decrypt(data);
    const body = method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
    if (!body) throw new Error(`zip method ${method} not supported`);  // 99 would be AES
    if (crc32(body) !== crc) throw new Error(`CRC mismatch in ${name}: wrong password?`);
    const rel = name.split(/[\\/]/).filter(s => s && s !== '.').map(safe).join('/'), target = resolve(root, rel);
    if (!rel || !target.startsWith(root + sep)) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
    files.push(rel);
  }
  return files;
}

// ---------- fetch ----------
const listFiles = (dir, base = dir) => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? listFiles(join(dir, e.name), base) : [relative(base, join(dir, e.name)).replaceAll('\\', '/')]);
// the shallowest folder under root that holds `file` (package.json, SKILL.md): that's the sample's own root
function shallowest(root, re) {
  for (let level = [root]; level.length;) {
    const hit = level.find(d => readdirSync(d).some(n => re.test(n)));
    if (hit) return hit;
    level = level.flatMap(d => readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(d, e.name)));
  }
  return root;
}

async function fetchSet(name) {
  const s = SETS[name], home = join(ROOT, name);
  if (existsSync(join(home, 'manifest.json'))) return console.log(`${home} already fetched`);
  mkdirSync(home, { recursive: true });
  const inventory = new Map();  // MalSkillBench labels every malicious skill: split (generated/wild/test) and vector
  if (name === 'malskillbench') for (const l of (await get(raw(s, 'Dataset/Skills/malware/_source_inventory.txt'))).toString('utf8').split(/\r?\n/)) {
    const m = l.match(/^(GENERATED|WILD|TEST)\s+(.+?)\s+<-\s+(\S.*)$/);
    if (m && !inventory.has(m[2])) inventory.set(m[2], { split: m[1].toLowerCase(), vector: m[3].match(/generated_malicious\/(CI|PI|MIXED)\/(B\d+)\/([a-z_+]+?)_\d{8}/)?.slice(1).join(' ') ?? null });
  }
  const samples = [];
  for (const g of s.groups) {
    const tree = JSON.parse((await get(`https://api.github.com/repos/${s.repo}/git/trees/${g.tree}?recursive=1`)).toString());
    if (tree.truncated) throw new Error(`tree listing for ${g.base} was truncated`);
    const blobs = tree.tree.filter(e => e.type === 'blob');
    let picks;
    if (s.unit === 'dir') {  // one sample = one top-level folder; chosen by sha256 of its name
      const dirs = tree.tree.filter(e => e.type === 'tree' && !e.path.includes('/')).map(e => e.path);
      picks = dirs.sort((a, b) => sha256(a) < sha256(b) ? -1 : 1).slice(0, g.n)
        .map(d => ({ id: d, blobs: blobs.filter(b => b.path.startsWith(`${d}/`)) }));
    } else {  // one sample = one zip; one version per package, so a burst of near-identical versions can't dominate
      const per = new Map();
      for (const b of blobs.filter(b => b.path.endsWith('.zip'))) {
        const pkg = g.base.includes('/npm/') ? b.path.split('/').slice(0, -2).join('/') : b.path;
        if (!per.has(pkg) || sha256(b.path) < sha256(per.get(pkg).path)) per.set(pkg, b);
      }
      picks = [...per.values()].sort((a, b) => sha256(a.path) < sha256(b.path) ? -1 : 1).slice(0, g.n)
        .map(b => ({ id: basename(b.path, '.zip'), blobs: [b] }));
    }
    console.log(`${g.base}: ${picks.length} samples, ${picks.reduce((n, p) => n + p.blobs.reduce((m, b) => m + b.size, 0), 0)} bytes`);
    await pool(picks, 8, async pick => {
      const out = join(home, g.name, safe(pick.id)), meta = inventory.get(pick.id) ?? null;
      const sample = { id: pick.id, group: g.name, label: g.label, ...meta, dir: null, files: {}, unreadable: [] };
      for (const b of pick.blobs) {
        const body = await get(raw(s, `${g.base}/${b.path}`));
        if (gitBlob(body) !== b.sha) throw new Error(`hash mismatch for ${b.path}`);
        if (s.unit === 'dir') {
          const target = join(out, ...b.path.split('/').slice(1).map(safe));
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, body);
        } else {
          writeFileSync(`${out}.zip`, body);
          try { unzip(body, out, 'infected'); } catch (e) { sample.unreadable.push(String(e.message)); }
          rmSync(`${out}.zip`);  // keep only what slowship reads
        }
      }
      const root = existsSync(out) ? shallowest(out, s.kind === 'npm' ? /^package\.json$/ : /^skill\.md$/i) : out;
      sample.dir = relative(home, root).replaceAll('\\', '/');
      if (existsSync(out)) for (const f of listFiles(out)) sample.files[relative(home, join(out, f)).replaceAll('\\', '/')] = statSync(join(out, f)).size;
      samples.push(sample);
    });
  }
  samples.sort((a, b) => a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
  writeFileSync(join(home, 'manifest.json'), JSON.stringify({ repo: s.repo, commit: s.commit, fetched: new Date().toISOString(), samples }, null, 1));
  console.log(`${samples.length} samples in ${home}`);
}

// ---------- score ----------
const POS = { hold: ['hold'], 'hold or review': ['hold', 'review'] };
function metrics(rows) {
  return Object.entries(POS).map(([t, levels]) => {
    const c = { tp: 0, fp: 0, fn: 0, tn: 0 };
    for (const r of rows) c[(levels.includes(r.level) ? (r.label ? 'tp' : 'fp') : (r.label ? 'fn' : 'tn'))]++;
    const p = c.tp / (c.tp + c.fp || 1), rc = c.tp / (c.tp + c.fn || 1);
    return { threshold: t, ...c, precision: p, recall: rc, f1: p + rc ? 2 * p * rc / (p + rc) : 0, fpr: c.fp / (c.fp + c.tn || 1) };
  });
}

async function score(name) {
  const s = SETS[name], home = join(ROOT, name), mode = withModel ? 'model' : 'rules';
  process.env.SLOWSHIP_HOME = join(ROOT, 'home', `${name}-${mode}`);  // its own cache, wiped: every score starts cold
  rmSync(process.env.SLOWSHIP_HOME, { recursive: true, force: true });
  const { checkItems } = await import('../src/scan.js');
  const { skillFacts } = await import('../src/agents.js');
  const { claimOf, npmPackages } = await import('../src/inventory.js');
  const { fingerprint } = await import('../src/state.js');

  const m = readJson(join(home, 'manifest.json')), items = [], samples = new Map(), damaged = [];
  for (const x of m.samples) {
    // Files missing or changed since the fetch (antivirus quarantine, usually) make a sample unfair to score: list them apart.
    const gone = Object.entries(x.files).filter(([f, size]) => { try { return statSync(join(home, f)).size !== size; } catch { return true; } });
    if (x.unreadable.length || gone.length || !Object.keys(x.files).length) { damaged.push({ id: x.id, group: x.group, why: x.unreadable[0] ?? `${gone.length} of ${Object.keys(x.files).length} files missing or changed on disk` }); continue; }
    const dir = join(home, x.dir), key = `${x.group}/${x.id}`;
    samples.set(key, x);
    if (s.kind === 'skill') {
      // the claim, exactly as agents.findSkills reads it
      const md = readdirSync(dir).find(n => /^skill\.md$/i.test(n));
      const fm = md ? readFileSync(join(dir, md), 'utf8').replace(/^﻿/, '').match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? '' : '';
      const field = k => fm.match(new RegExp(`^${k}:\\s*["']?(.+?)["']?\\s*$`, 'm'))?.[1] ?? '';
      items.push({ kind: 'skill', key, name: field('name') || basename(dir), dir, claim: field('description'), fp: `skill-${fingerprint(dir)}`, read: () => skillFacts(dir) });
    } else {
      const manifest = (() => { try { return readJson(join(dir, 'package.json')); } catch { return null; } })();
      items.push({ kind: 'npm', key, name: manifest?.name ?? x.id, dir, manifest, claim: claimOf(dir, manifest), fp: fingerprint(dir) });
    }
  }
  if (s.benign === 'npm') for (const p of npmPackages(BENIGN_NPM).packages) {  // exactly what scanProject would check
    const key = `benign/${p.name}@${p.version}`;
    samples.set(key, { id: `${p.name}@${p.version}`, group: 'benign', label: 0 });
    items.push({ kind: 'npm', key, name: p.name, dir: p.dir, manifest: p.manifest, claim: claimOf(p.dir, p.manifest), fp: fingerprint(p.dir, p.integrity) });
  }

  const t0 = performance.now();
  const run = await checkItems(items, { model: withModel });
  const wall = performance.now() - t0;
  if (withModel && !run.model) throw new Error('--model asked for, but Ollama with gemma4:e2b is not reachable');

  const rows = run.items.map(i => ({ ...samples.get(i.key), key: i.key, level: i.level, caps: i.caps, coverage: i.coverage,
    findings: i.findings.map(f => ({ kind: f.kind, level: f.level, says: f.says, matches_claim: f.matches_claim })) }));
  // a balanced view where the benign side is larger: the first N benign by sha256 of their name
  const nMal = rows.filter(r => r.label).length;
  const benign = rows.filter(r => !r.label).sort((a, b) => sha256(a.key) < sha256(b.key) ? -1 : 1);
  const balanced = benign.length > nMal && nMal ? [...rows.filter(r => r.label), ...benign.slice(0, nMal)] : rows;
  const groups = [...new Set(rows.map(r => r.vector?.split(' ')[0] ?? r.split ?? r.group))];
  const result = {
    set: name, mode, model: run.model, repo: m.repo, commit: m.commit, wall_ms: Math.round(wall), stats: run.stats, damaged,
    metrics: metrics(balanced), metrics_all: balanced === rows ? null : metrics(rows),
    levels: Object.fromEntries(['malicious', 'benign'].map(c => [c, Object.fromEntries(['hold', 'review', 'notable', 'info'].map(l => [l, rows.filter(r => !!r.label === (c === 'malicious') && r.level === l).length]))])),
    by_group: Object.fromEntries(groups.map(g => {
      const rs = rows.filter(r => (r.vector?.split(' ')[0] ?? r.split ?? r.group) === g);
      return [g, { n: rs.length, label: rs[0].label, hold: rs.filter(r => r.level === 'hold').length, review: rs.filter(r => r.level === 'review').length }];
    })),
    misses: rows.filter(r => r.label && !POS['hold or review'].includes(r.level)),
    false_alarms: rows.filter(r => !r.label && POS['hold or review'].includes(r.level)),
    rows,
  };
  mkdirSync(join(ROOT, 'results'), { recursive: true });
  const out = join(ROOT, 'results', `${name}-${mode}.json`);
  writeFileSync(out, JSON.stringify(result, null, 1));

  const pct = x => `${(100 * x).toFixed(1)}%`;
  const table = ms => ['| counts as flagged | TP | FP | FN | TN | precision | recall | F1 | false-alarm rate |', '|---|---|---|---|---|---|---|---|---|',
    ...ms.map(x => `| ${x.threshold} | ${x.tp} | ${x.fp} | ${x.fn} | ${x.tn} | ${pct(x.precision)} | ${pct(x.recall)} | ${x.f1.toFixed(3)} | ${pct(x.fpr)} |`)].join('\n');
  console.log(`\n### ${name}, ${mode}${run.model ? ` (${run.model})` : ''}: ${rows.filter(r => r.label).length} malicious, ${rows.filter(r => !r.label).length} benign scored, ${damaged.length} damaged\n`);
  console.log(table(result.metrics));
  if (result.metrics_all) console.log(`\nAll ${benign.length} benign packages:\n\n${table(result.metrics_all)}`);
  console.log('\nlevels', JSON.stringify(result.levels), '\nby group', JSON.stringify(result.by_group));
  console.log(`wall ${(wall / 1000).toFixed(1)} s, model calls ${run.stats.judged}, model time ${(run.stats.ms / 1000).toFixed(1)} s, tokens ${run.stats.tokens}`);
  if (damaged.length) console.log('damaged:', damaged.map(d => `${d.id} (${d.why})`).join('; '));
  console.log(`full results: ${out}`);
}

// ---------- laziness: a full run, then the same run again ----------
function lazy() {
  const once = (label, home, extra = []) => {
    const json = join(ROOT, 'results', `lazy-${label}.json`);
    const t0 = performance.now(), start = Date.now();
    const r = spawnSync(process.execPath, [join(REPO, 'bin', 'slowship.js'), BENIGN_NPM, '--json', json, ...extra],
      { env: { ...process.env, SLOWSHIP_HOME: home }, encoding: 'utf8', maxBuffer: 64 << 20 });
    const ms = performance.now() - t0;
    if (r.status !== 0 && r.status !== 2) throw new Error(`${label}: exit ${r.status}\n${r.stderr}`);
    // what this run actually read: results created during it, once per content fingerprint (cached ones keep old coverage)
    const run = readJson(json), fresh = [...new Map(run.items.filter(i => Date.parse(i.at) >= start).map(i => [i.fp, i])).values()];
    const sum = k => fresh.reduce((n, i) => n + (i.coverage?.[k] ?? 0), 0), npm = run.items.filter(i => i.kind === 'npm');
    return { label, wall_s: +(ms / 1000).toFixed(1), items: run.items.length, cached: run.stats.cached, judged: run.stats.judged,
      model_s: +(run.stats.ms / 1000).toFixed(1), code_files_seen: sum('files'), code_files_parsed: sum('read'), test_files_skipped: sum('tests'),
      npm: npm.length, npm_levels: Object.fromEntries(['hold', 'review', 'notable', 'info'].map(l => [l, npm.filter(i => i.level === l).length])),
      npm_flagged: npm.filter(i => ['hold', 'review'].includes(i.level)).map(i => ({ name: i.key, level: i.level, why: i.findings.filter(f => f.level === i.level).map(f => `${f.kind}: ${f.says}`) })) };
  };
  mkdirSync(join(ROOT, 'results'), { recursive: true });
  const homes = ['lazy-model', 'lazy-rules'].map(h => join(ROOT, 'home', h));
  for (const h of homes) rmSync(h, { recursive: true, force: true });
  const rows = [once('cold-model', homes[0]), once('rerun-model', homes[0]), once('cold-rules', homes[1], ['--no-model']), once('rerun-rules', homes[1], ['--no-model'])];
  writeFileSync(join(ROOT, 'results', 'lazy.json'), JSON.stringify(rows, null, 1));
  console.log('| run | wall | items | cached | model calls | model time | code files seen | parsed | test files skipped |\n|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.label} | ${r.wall_s} s | ${r.items} | ${r.cached} | ${r.judged} | ${r.model_s} s | ${r.code_files_seen} | ${r.code_files_parsed} | ${r.test_files_skipped} |`);
  for (const r of rows.filter(r => r.label.startsWith('cold')))  // installed npm packages, assumed benign: every flag is a false alarm
    console.log(`\n${r.label}: ${r.npm} npm packages`, JSON.stringify(r.npm_levels), '\n', r.npm_flagged.map(f => `${f.name} ${f.level}: ${f.why.join('; ')}`).join('\n '));
}

// ---------- the unzipper, checked against zips built here (stored, deflated, encrypted, hostile names) ----------
function selftest() {
  const zip = entries => {
    const locals = [], central = [];
    let off = 0;
    for (const [name, text, { method = 8, pw } = {}] of entries) {
      const body = Buffer.from(text), crc = crc32(body), n = Buffer.from(name);
      let data = method === 8 ? deflateRawSync(body) : body;
      if (pw) { const head = Buffer.alloc(12, 7); head[11] = crc >>> 24; data = zipCrypto(pw).encrypt(Buffer.concat([head, data])); }
      const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(pw ? 1 : 0, 6); h.writeUInt16LE(method, 8);
      h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(body.length, 22); h.writeUInt16LE(n.length, 26);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(pw ? 1 : 0, 8); c.writeUInt16LE(method, 10);
      c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(body.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
      locals.push(h, n, data); central.push(c, n); off += 30 + n.length + data.length;
    }
    const cd = Buffer.concat(central), e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
    return Buffer.concat([...locals, cd, e]);
  };
  const dest = join(process.env.TEMP || '/tmp', `slowship-unzip-${process.pid}`, 'q');
  try {
    const files = unzip(zip([['p/a.js', 'console.log(1)', { pw: 'infected' }], ['p/b.txt', 'stored', { method: 0 }],
      ['../../escape.js', 'bad'], ['p/con.js', 'device'], ['p/x:y.js', 'colon']]), dest, 'infected');
    if (readFileSync(join(dest, 'p/a.js'), 'utf8') !== 'console.log(1)' || readFileSync(join(dest, 'p/b.txt'), 'utf8') !== 'stored') throw new Error('content');
    if (existsSync(join(dest, '..', 'escape.js')) || existsSync(join(dest, '..', '..', 'escape.js'))) throw new Error('escaped dest');
    if (!files.includes('p/_con.js') || !files.includes('p/x_y.js')) throw new Error(`unsafe names kept: ${files}`);
    let wrong = false; try { unzip(zip([['a', 'x', { pw: 'infected' }]]), dest, 'nope'); } catch { wrong = true; }
    if (!wrong) throw new Error('a wrong password was accepted');
    console.log('unzip selftest ok');
  } finally { rmSync(dirname(dest), { recursive: true, force: true }); }
}

if (cmd === 'fetch' && SETS[set]) await fetchSet(set);
else if (cmd === 'score' && SETS[set]) await score(set);
else if (cmd === 'lazy') lazy();
else if (cmd === 'selftest') selftest();
else { console.log(readFileSync(import.meta.filename, 'utf8').split('\n').slice(5, 9).join('\n').replaceAll('//   ', '')); process.exitCode = 1; }
