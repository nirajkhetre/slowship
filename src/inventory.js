// What to check: every package installed in a project, read from its lockfile (or node_modules if there is none).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

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
  return [manifest?.description, manifest?.keywords?.length ? `keywords: ${manifest.keywords.join(', ')}` : '', readme].filter(Boolean).join('\n');
}
