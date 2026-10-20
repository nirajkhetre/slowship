// Memory between runs: results keyed by content, and what you approved. Same bytes are never checked twice;
// a new version is compared with the one you approved, so only what changed gets your attention.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOME = process.env.SLOWSHIP_HOME || join(homedir(), '.slowship');
const FILE = join(HOME, 'state.json');

export function load() {
  try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return { results: {}, approved: {} }; }
}

export function save(state) {
  mkdirSync(HOME, { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1));
  renameSync(tmp, FILE);  // a crash mid-write can't leave half a file
}

/** A content fingerprint: the lockfile integrity when there is one, else a hash over every file's path, size and bytes. */
export function fingerprint(dir, integrity) {
  if (integrity) return integrity;
  const h = createHash('sha256');
  const visit = d => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) visit(p);
      else if (statSync(p).size < 5_000_000) h.update(p.slice(dir.length)).update(readFileSync(p));
    }
  };
  if (existsSync(dir)) visit(dir);
  return `sha256-${h.digest('base64')}`;
}

/** Capabilities that appear in `now` but not in the approved earlier version of the same package. */
export function newSince(state, name, caps) {
  const prev = Object.entries(state.approved).find(([k]) => k.startsWith(`${name}@`) || k === name);
  if (!prev) return null;
  const before = new Set(state.results[prev[1]]?.caps ?? []);
  return { version: prev[0], added: caps.filter(c => !before.has(c)) };
}
