// What to check: every package installed in a project, read from its lockfile (or node_modules if there is none).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNPM } from './storm.js';

const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
// folders only: links (pnpm's, and Windows junctions) are someone else's real folder
const realDirs = d => { try { return readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; } };
/** pnpm-lock.yaml's integrity for each name@version, so a fingerprint needs no hashing (and matches npm's for the same tarball). */
function pnpmIntegrity(project) {
  const sums = new Map();
  let sec = '', at = null;
  for (const l of (() => { try { return readFileSync(join(project, 'pnpm-lock.yaml'), 'utf8').split(/\r?\n/); } catch { return []; } })()) {
    if (/^\S/.test(l)) sec = l.replace(/:.*$/, '');
    const k = sec === 'packages' && l.match(PNPM);
    if (k) at = `${k[1]}@${k[2]}`;
    const i = at && l.match(/^\s+resolution:\s*\{.*integrity:\s*([^,}\s]+)/);
    if (i) { sums.set(at, i[1]); at = null; }
  }
  return sums;
}

/** Installed npm packages: [{ key, name, version, dir, integrity, manifest }]. */
export function npmPackages(project) {
  const lock = readJson(join(project, 'package-lock.json')) ?? readJson(join(project, 'npm-shrinkwrap.json'));
  const out = [], warnings = [];
  if (lock?.packages) {
    for (const [path, info] of Object.entries(lock.packages)) {
      if (!path.startsWith('node_modules/') || info.link) continue;
      const dir = join(project, path);
      if (!existsSync(dir)) { warnings.push(`${path} is in the lockfile but not installed`); continue; }
      const manifest = readJson(join(dir, 'package.json'));
      const name = manifest?.name ?? path.split('node_modules/').pop();
      out.push({ key: `npm:${name}@${info.version}`, name, version: info.version, dir, integrity: info.integrity ?? null, manifest });
    }
    return { packages: out, warnings };
  }
  // pnpm: each package lives once in node_modules/.pnpm/<name@version>/node_modules/<name>; everything else is a link to it
  const store = join(project, 'node_modules', '.pnpm');
  if (existsSync(store)) {
    const sums = pnpmIntegrity(project), seen = new Set();
    for (const entry of realDirs(store)) {
      if (entry === 'node_modules') continue;  // pnpm's hoisted links
      const nm = join(store, entry, 'node_modules');
      for (const top of realDirs(nm)) for (const dir of top.startsWith('@') ? realDirs(join(nm, top)).map(s => join(nm, top, s)) : [join(nm, top)]) {
        const manifest = readJson(join(dir, 'package.json')), key = typeof manifest?.name === 'string' && typeof manifest.version === 'string' && `npm:${manifest.name}@${manifest.version}`;
        if (!key || seen.has(key)) continue;  // one copy per version, whatever peers it was installed with
        seen.add(key);
        out.push({ key, name: manifest.name, version: manifest.version, dir, integrity: sums.get(`${manifest.name}@${manifest.version}`) ?? null, manifest });
      }
    }
    if (!sums.size) warnings.push('pnpm without a pnpm-lock.yaml: reading node_modules/.pnpm directly, so versions are not pinned');
    return { packages: out, warnings };
  }
  warnings.push(existsSync(join(project, 'node_modules'))
    ? 'no package-lock.json: reading node_modules directly, so versions are not pinned'
    : 'no package-lock.json and no node_modules: nothing to check');
  const visit = nm => {
    if (!existsSync(nm)) return;
    for (const e of readdirSync(nm, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const dirs = e.name.startsWith('@') ? readdirSync(join(nm, e.name)).map(s => join(nm, e.name, s)) : [join(nm, e.name)];
      for (const dir of dirs) {
        const manifest = readJson(join(dir, 'package.json'));
        if (!manifest?.name) continue;
        out.push({ key: `npm:${manifest.name}@${manifest.version}`, name: manifest.name, version: manifest.version, dir, integrity: null, manifest });
        visit(join(dir, 'node_modules'));
      }
    }
  };
  visit(join(project, 'node_modules'));
  return { packages: out, warnings };
}

/** What a package says it does: its description, keywords and the start of its README. */
export function claimOf(dir, manifest) {
  const readme = (() => {
    try {
      const f = readdirSync(dir).find(n => /^readme(\.|$)/i.test(n));
      return f ? readFileSync(join(dir, f), 'utf8').replace(/<[^>]+>/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\s+/g, ' ').slice(0, 900) : '';
    } catch { return ''; }
  })();
  // a package's manifest is its own to write: a description that isn't text, or keywords that aren't a list, are left out
  const kw = Array.isArray(manifest?.keywords) ? manifest.keywords.filter(k => typeof k === 'string') : [];
  return [typeof manifest?.description === 'string' ? manifest.description : '', kw.length ? `keywords: ${kw.join(', ')}` : '', readme].filter(Boolean).join('\n');
}
