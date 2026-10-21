// Your own build, before it ships: secrets that slipped in, risky Electron settings, shipped source maps and .env
// files, and (when REA is installed) REA's view of the app's structure. Your own code's network and file use is
// your business, so it isn't listed here; this is about what you didn't mean to ship.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import * as acorn from 'acorn';
import * as loose from 'acorn-loose';
import * as walk from 'acorn-walk';
import { binaryFacts, fuseFacts, isBinary, rea, reaScript } from './binary.js';
import { entropy, fileFacts } from './facts.js';

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

/** One line with every secret-shaped value cut down to its first four characters, for showing code around a finding. */
export function redactLine(line) {
  for (const s of SECRETS) line = line.replace(new RegExp(s.re.source, 'g'), redact);
  return line.replace(new RegExp(ASSIGNED.source, 'gi'), (m, v) => entropy(v) > 3.8 ? m.replace(v, redact(v)) : m);
}

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

/** REA's view of an Electron app: its summary and graph (nodes and edges only: the semantic graph is the big part). */
export function reaApp(path) {
  const r = rea(['analyze-javascript-application', path, '--filter-output', 'normalized_result.summary,normalized_result.graph.nodes,normalized_result.graph.edges'], 64 << 20);
  return r?.normalized_result ?? null;
}

/** Every main-process IPC handler in REA's graph: its channel and place, whether REA saw it check the sender,
 *  which contextBridge members lead to it (window.api.x) and which files send to it. */
export function ipcMap(graph) {
  const nodes = new Map(graph.nodes.map(n => [n.node_id, n])), via = new Map(), from = new Map();
  const put = (m, k, v) => v && (m.get(k) ?? m.set(k, new Set()).get(k)).add(v);
  for (const n of graph.nodes) for (const o of n.observations ?? [])
    if (o.properties?.entry_kind === 'bridge-member') put(via, o.properties.channel, `window.${o.properties.entry}`);
  for (const e of graph.edges ?? [])
    if ((e.relation === 'invokes' || e.relation === 'sends') && e.properties?.handler_path) put(from, e.target_node_id, nodes.get(e.source_node_id)?.observations?.[0]?.label);
  return graph.nodes.filter(n => n.kind === 'ipc-handler').map(n => {
    const [o] = n.observations, p = o.properties, at = o.evidence?.location?.value;
    return {
      channel: p.channel ?? '(computed name)', op: p.operation, file: at?.source ?? null,
      line: p.handler_location?.start.line ?? at?.start.line ?? 0, end: p.handler_location?.end.line ?? at?.end.line ?? 0,
      checked: n.observations.some(x => x.properties?.fact_kind === 'sender-validation-candidate'),
      via: [...(via.get(p.channel) ?? [])], from: [...(from.get(n.node_id) ?? [])],
    };
  });
}

// What an unchecked handler can be talked into: starting programs, running strings as code, opening a computed URL.
const SINKS = new Map([['exec', 'starts a program'], ['code', 'runs a string as code'], ['open-external', 'opens a computed URL']]);

/** A fact per unchecked handler, and the sinks inside its body when something in the renderer can reach it.
 *  ponytail: only inline handler bodies are searched; a handler that calls a named function elsewhere isn't followed. */
export function ipcFacts(map, root, known = []) {
  const out = [], nodeOn = known.some(f => f.cap === 'electron-node'), files = new Map();  // a bundled main.js holds many handlers: read it once
  const read = file => {
    if (!files.has(file)) {
      let src = '';
      try { src = readFileSync(join(root, file), 'utf8'); } catch { /* REA saw it; we can't reopen it */ }
      files.set(file, { src, facts: src ? [...fileFacts(src, file).facts, ...electronFacts(src, file)] : [] });
    }
    return files.get(file);
  };
  for (const h of map.filter(h => !h.checked)) {
    const { src, facts } = h.file ? read(h.file) : { src: '', facts: [] };
    const scope = `ipc:${h.channel}`, code = (src.split(/\r?\n/)[h.line - 1] || '').trim().slice(0, 160);
    const reach = h.via.length ? `pages reach it through ${h.via.join(', ')}` : h.from.length ? `${h.from.join(', ')} sends to it` : nodeOn ? 'any page can reach it: nodeIntegration is on' : '';
    out.push({ cap: 'ipc-unchecked', detail: `IPC handler "${h.channel}" doesn't check who sent the message${reach ? `; ${reach}` : ''}`, file: h.file ?? '(REA)', line: h.line, scope, code });
    if (!reach || !src) continue;
    for (const f of facts) {
      if (!SINKS.has(f.cap) || f.line < h.line || f.line > h.end) continue;
      out.push({ ...f, cap: 'ipc-sink', detail: `inside the "${h.channel}" handler: ${f.detail}`, scope });
      h.does = [...new Set([...(h.does ?? []), SINKS.get(f.cap)])];  // for the map in the report
    }
  }
  return out;
}

export function reaFacts(summary) {
  if (!summary) return [];
  const out = [], add = (cap, detail) => out.push({ cap, detail, file: '(REA)', line: 0, scope: 'rea#0', code: '' });
  if (summary.exposed_api_members > 0) add('bridge', `${summary.exposed_api_members} function${summary.exposed_api_members === 1 ? '' : 's'} exposed to web pages through contextBridge`);
  if (summary.native_addon_bindings > 0) add('native', `${summary.native_addon_bindings} native addon${summary.native_addon_bindings === 1 ? '' : 's'}: compiled code, read only as far as its build record`);
  return out;
}

/** Everything about a build directory (or a single file). REA only runs for directories that look like an Electron app. */
export function appFacts(root, { rea: useRea = true } = {}) {
  let facts = [];
  const coverage = { files: 0, read: 0, skipped: [], errors: [] }, map = {};
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
      if (useRea && isBinary(p)) {
        const b = binaryFacts(p, rel), fz = ['.dll', '.node', '.so', '.dylib'].includes(ext) ? null : fuseFacts(p, rel);
        // ponytail: a packaged app's fuses are read, but its app.asar isn't sent to REA's app map (on VS Code's 6,187 files
        // that map read 156 in 13 minutes); point --app at the unpacked build to get the IPC map
        if (fz) { facts.push(...fz.facts); b.built.fuses = fz.fuses; }
        facts.push(...b.facts); (map.binaries ??= []).push({ file: rel, ...b.built });
        continue;
      }
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
  if (useRea && electron) {
    const r = statSync(root).isDirectory() ? reaApp(root) : null;
    coverage.rea = r ? 'read by REA' : reaScript() ? 'REA couldn\'t map this app (too large, or it failed): structure checks skipped'
      : 'REA not installed: structure checks skipped (npm i -g rea-agents)';
    if (r) {
      map.ipc = ipcMap(r.graph);
      const ipc = ipcFacts(map.ipc, root, facts), sunk = new Set(ipc.filter(f => f.cap === 'ipc-sink').map(f => `${f.file}:${f.line}`));
      // a sink inside a handler is shown once, as part of that handler
      facts = [...facts.filter(f => !(f.cap === 'open-external' && sunk.has(`${f.file}:${f.line}`))), ...reaFacts(r.summary), ...ipc];
    }
  }
  return { facts, coverage, map: Object.keys(map).length ? map : undefined };
}
