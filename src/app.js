// Your own build, before it ships: secrets that slipped in, risky Electron settings, shipped source maps and .env
// files, and (when REA is installed) REA's view of the app's structure. Your own code's network and file use is
// your business, so it isn't listed here; this is about what you didn't mean to ship.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import * as acorn from 'acorn';
import * as loose from 'acorn-loose';
import * as walk from 'acorn-walk';
import { entropy } from './facts.js';

// Known secret shapes. A few are public by design (a Firebase web key), so they are notable, not hold.
const SECRETS = [
  { cap: 'secret', name: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { cap: 'secret', name: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { cap: 'secret', name: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { cap: 'secret', name: 'Anthropic key', re: /\bsk-ant-[a-z]+\d*-[A-Za-z0-9_-]{60,}\b/ },
  { cap: 'secret', name: 'OpenAI key', re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}\b|\bsk-[A-Za-z0-9]{48}\b/ },
  { cap: 'secret', name: 'Stripe live key', re: /\b(?:sk|rk)_live_[0-9a-zA-Z]{24,}\b/ },
  { cap: 'secret', name: 'Slack token', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { cap: 'secret', name: 'private key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { cap: 'secret-public', name: 'Google API key (often public by design, e.g. Firebase; check it is restricted)', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
];
const ASSIGNED = /(?:api[_-]?key|secret|token|passw(?:or)?d|client[_-]?secret)["']?\s*[:=]\s*["']([A-Za-z0-9_\-/+=.]{24,})["']/i;
const TEXT = new Set(['.js', '.mjs', '.cjs', '.json', '.map', '.html', '.htm', '.txt', '.yml', '.yaml', '.toml', '.ini', '.xml', '.plist', '.properties', '.ts', '.py', '.css']);

const redact = s => `${s.slice(0, 4)}…(${s.length} chars)`;

export function secretFacts(text, file) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const s of SECRETS) {
      const m = line.match(s.re);
      if (m) out.push({ cap: s.cap, detail: `${s.name} in the build: ${redact(m[0])}`, file, line: i + 1, scope: `${file}#0`, code: line.replace(m[0], redact(m[0])).trim().slice(0, 160) });
    }
    const a = line.match(ASSIGNED);
    if (a && !out.some(o => o.line === i + 1 && o.file === file) && entropy(a[1]) > 3.8 && !/^(process\.env|import\.meta|\$\{|YOUR_|xxx|placeholder)/i.test(a[1]))
      out.push({ cap: 'secret-maybe', detail: `a secret-looking value assigned in the build: ${redact(a[1])}`, file, line: i + 1, scope: `${file}#0`, code: line.replace(a[1], redact(a[1])).trim().slice(0, 160) });
  });
  return out;
}

// Electron's security switches, read from literal values in your own code.
const PREFS = {
  nodeIntegration: [true, 'electron-node', 'turns on nodeIntegration: web content can reach Node.js'],
  nodeIntegrationInWorker: [true, 'electron-node', 'turns on nodeIntegrationInWorker'],
  nodeIntegrationInSubFrames: [true, 'electron-node', 'turns on nodeIntegrationInSubFrames'],
  contextIsolation: [false, 'electron-isolation-off', 'turns off contextIsolation: page scripts share the preload\'s world'],
  sandbox: [false, 'electron-sandbox-off', 'turns off the renderer sandbox'],
  webSecurity: [false, 'electron-websec-off', 'turns off webSecurity (same-origin policy)'],
  allowRunningInsecureContent: [true, 'electron-websec-off', 'allows insecure (http) content in https pages'],
  enableRemoteModule: [true, 'electron-node', 'turns on the remote module'],
  experimentalFeatures: [true, 'electron-websec-off', 'turns on experimental Chromium features'],
};

export function electronFacts(src, file) {
  const out = [], lines = src.split(/\r?\n/);
  let ast;
  const opts = { ecmaVersion: 'latest', locations: true, allowHashBang: true, allowReturnOutsideFunction: true };
  try { ast = acorn.parse(src, { ...opts, sourceType: 'module' }); } catch {
    try { ast = acorn.parse(src, { ...opts, sourceType: 'script' }); } catch { ast = loose.parse(src, opts); }
  }
  const add = (cap, detail, node) => out.push({ cap, detail, file, line: node.loc.start.line, scope: `${file}#0`, code: (lines[node.loc.start.line - 1] || '').trim().slice(0, 160) });
  walk.full(ast, node => {
    if (node.type === 'Property' && !node.computed) {
      const key = node.key.name ?? node.key.value, p = PREFS[key];
      if (p && node.value.type === 'Literal' && node.value.value === p[0]) add(p[1], p[2], node);
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && !node.callee.computed) {
      const fn = node.callee.property.name;
      if (fn === 'openDevTools') add('devtools', 'opens DevTools (fine in development, not in a release)', node);
      if (fn === 'openExternal' && node.arguments[0] && node.arguments[0].type !== 'Literal')
        add('open-external', 'shell.openExternal() with a computed URL: check where it comes from', node);
    }
  });
  return out;
}

/** Where REA's entry script lives: SLOWSHIP_REA (the script, or a bin wrapper next to it), or a global npm install. */
function reaScript() {
  const env = process.env.SLOWSHIP_REA, find = 'rea-agents/scripts/rea.mjs';
  const tries = env ? [env, join(dirname(env), '..', find)] : [];
  if (process.env.APPDATA) tries.push(join(process.env.APPDATA, 'npm', 'node_modules', find));
  return tries.find(p => /\.m?js$/.test(p) && existsSync(p)) ?? null;
}

/** REA's summary of an Electron app's structure, or null when REA isn't installed. Small on purpose (--filter-output). */
export function reaSummary(path) {
  const script = reaScript();
  const args = ['analyze-javascript-application', path, '--format', 'json', '--filter-output', 'normalized_result.summary'];
  const opts = { encoding: 'utf8', timeout: 300_000, maxBuffer: 8 << 20, stdio: ['ignore', 'pipe', 'ignore'] };
  try {
    // No shell: run REA's own JavaScript with this Node (rea.cmd on Windows is only a wrapper around it)
    const out = script ? execFileSync(process.execPath, [script, ...args], opts) : execFileSync('rea', args, opts);
    return JSON.parse(out).normalized_result.summary;
  } catch { return null; }
}

export function reaFacts(summary) {
  if (!summary) return [];
  const out = [], add = (cap, detail) => out.push({ cap, detail, file: '(REA)', line: 0, scope: 'rea#0', code: '' });
  const ipc = summary.ipc ?? {};
  if (ipc.main_handlers > 0 && !summary.sender_validation_observations)
    add('ipc-unchecked', `${ipc.main_handlers} IPC handler(s) in the main process, and REA saw none check who sent the message`);
  if (summary.exposed_api_members > 0) add('bridge', `${summary.exposed_api_members} function(s) exposed to web pages through contextBridge`);
  if (summary.native_addon_bindings > 0) add('native', `${summary.native_addon_bindings} native addon(s): compiled code slowship can't read`);
  return out;
}

/** Everything about a build directory (or a single file). REA only runs for directories that look like an Electron app. */
export function appFacts(root, { rea = true } = {}) {
  const facts = [], coverage = { files: 0, read: 0, skipped: [], errors: [] };
  let electron = false;
  const visit = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name), rel = relative(root, p).replaceAll('\\', '/'), ext = extname(e.name).toLowerCase();
      if (e.isDirectory()) {
        if (e.name === 'node_modules') coverage.skipped.push(`${rel}/ (dependencies: checked as packages, not as your code)`);
        else if (e.name !== '.git') visit(p);
        continue;
      }
      if (/^\.env(\.|$)/.test(e.name) && !/\.(example|sample|template)$/.test(e.name)) facts.push({ cap: 'env-file', detail: `${e.name} is in the build: it usually holds secrets`, file: rel, line: 0, scope: `${rel}#0`, code: '' });
      if (ext === '.map') facts.push({ cap: 'sourcemap', detail: 'ships a source map: your original source code is readable', file: rel, line: 0, scope: `${rel}#0`, code: '' });
      if (!TEXT.has(ext)) continue;
      coverage.files++;
      if (statSync(p).size > 5_000_000) { coverage.skipped.push(`${rel} (over 5 MB)`); continue; }
      const text = readFileSync(p, 'utf8');
      coverage.read++;
      facts.push(...secretFacts(text, rel));
      if (['.js', '.mjs', '.cjs'].includes(ext)) {
        if (/require\(['"]electron['"]\)|from ['"]electron['"]/.test(text)) electron = true;
        try { facts.push(...electronFacts(text, rel)); } catch { coverage.errors.push(`${rel} (unparseable)`); }
      }
    }
  };
  statSync(root).isDirectory() ? visit(root) : facts.push(...secretFacts(readFileSync(root, 'utf8'), basename(root)));
  if (rea && electron) {
    const summary = reaSummary(root);
    coverage.rea = summary ? 'read by REA' : 'REA not installed: structure checks skipped (npm i -g rea-agents)';
    facts.push(...reaFacts(summary));
  }
  return { facts, coverage };
}
