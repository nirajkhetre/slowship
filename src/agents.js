// Your agent's supply chain: installed skills (instructions + scripts) and configured MCP servers.
// A skill is read as both code and instructions, because a skill attacks through either, or through the two together.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { binaryFacts, isBinary, reaScript } from './binary.js';
import { dirFacts, fileFacts } from './facts.js';
import { HOME } from './state.js';

const readText = p => readFileSync(p, 'utf8').replace(/^﻿/, '');  // config files sometimes start with a BOM
const readJson = p => { try { return JSON.parse(readText(p)); } catch { return null; } };

// ---------- skills ----------
const SKILL_ROOTS = project => [
  join(homedir(), '.claude', 'skills'), join(homedir(), '.claude', 'plugins'), join(homedir(), '.agents', 'skills'),
  join(homedir(), '.codex', 'skills'), join(project, '.claude', 'skills'), join(project, '.agents', 'skills'),
];

export function findSkills(project, roots = SKILL_ROOTS(project)) {
  const found = new Map();
  const visit = (dir, depth) => {
    if (depth > 8 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) visit(p, depth + 1);
      else if (/^skill\.md$/i.test(e.name)) found.set(dir, p);
    }
  };
  for (const r of roots) visit(r, 0);
  return [...found].map(([dir, md]) => {
    const fm = readText(md).match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? '';
    const field = k => fm.match(new RegExp(`^${k}:\\s*["']?(.+?)["']?\\s*$`, 'm'))?.[1] ?? '';
    const name = field('name') || basename(dir);
    return { kind: 'skill', name, dir, key: `skill:${name}@${relative(homedir(), dir).replaceAll('\\', '/')}`, claim: field('description') };
  });
}

// What SKILL.md tells the agent to do. Phrases are narrow on purpose: documentation must not cry wolf.
// Credential *files*. Docs that explain how to pass your own API key are normal, so key/token words alone don't count.
const SECRET_WORDS = /(~?[\\/]?\.ssh[\\/]|\bid_rsa\b|\bid_ed25519\b|\.npmrc\b|\.aws[\\/]credentials|\.git-credentials\b|\.netrc\b|Login Data\b|\bkeychain\b|wallet\.dat\b)/i;
const INSTRUCTIONS = [
  { cap: 'conceal', re: /\b(do not|don't|never)\s+(tell|inform|mention|reveal|show|notify|alert)\s+(this\s+to\s+)?(the\s+)?user\b|\bhide\b[^.\n]{0,40}\bfrom\s+(the\s+)?user\b|\bwithout\s+(telling|informing|notifying)\s+(the\s+)?user\b/i,
    says: 'tells the agent to keep something from you' },
  { cap: 'override', re: /\bignore\s+(all\s+|any\s+)?(previous|prior|above|earlier|other)\s+(instructions|rules|guidelines)\b|\bdisregard\s+(the\s+)?(system|previous|prior)\b/i,
    says: 'tells the agent to ignore its other instructions' },
  { cap: 'code', re: /\b(curl|wget|iwr|Invoke-WebRequest|irm)\b[^\n|]{0,200}\|\s*(sudo\s+)?(sh|bash|zsh|iex|Invoke-Expression|python3?|node)\b/i,
    says: 'tells the agent to download a script and run it straight away' },
  // "send the contents / keys / output … to https://…": sending local data out, not documenting an API call
  { cap: 'net', re: /\b(send|post|upload|exfiltrate|forward|transmit)\b[^.\n]{0,40}\b(contents?|files?|data|output|keys?|tokens?|secrets?|history|credentials|env(ironment)?( variables)?)\b[^.\n]{0,60}\b(to|at)\b[^.\n]{0,30}(https?:\/\/|webhook|pastebin|discord\.com\/api)/i,
    says: 'tells the agent to send local data to an outside address' },
];

export function instructionFacts(text, file) {
  const out = [], lines = text.split(/\r?\n/);
  lines.forEach((l, i) => {
    for (const r of INSTRUCTIONS) if (r.re.test(l)) out.push({ cap: r.cap, detail: r.says, file, line: i + 1, scope: `${file}#0`, code: l.trim().slice(0, 160) });
    if (/\b(read|cat|copy|collect|gather|print|send|upload|include|grab|look in)\b/i.test(l) && SECRET_WORDS.test(l))
      out.push({ cap: 'secret-path', detail: `tells the agent to handle "${l.match(SECRET_WORDS)[0]}"`, file, line: i + 1, scope: `${file}#0`, code: l.trim().slice(0, 160) });
  });
  return out;
}

// Python and shell scripts that skills bundle. A line-level read: narrower than the JS parser, and the report says so.
const SCRIPT_RULES = [
  { cap: 'exec', re: /\b(subprocess\.(run|call|Popen|check_output|check_call)|os\.(system|popen|exec[lv]p?e?)|Start-Process)\b/ , says: 'runs a program' },
  { cap: 'net', re: /\b(requests\.(get|post|put|request)|urlopen|urllib\.request\.Request|http\.client\.HTTPS?Connection|httpx\.(get|post|AsyncClient|Client)|socket\.(create_connection|socket)|aiohttp\.ClientSession|Invoke-WebRequest|Invoke-RestMethod|\bcurl\b|\bwget\b)/, says: 'makes network requests' },
  { cap: 'code', re: /(^|[^.\w])(exec|eval)\s*\(|\|\s*(sh|bash|iex)\b|Invoke-Expression/, says: 'runs a string or download as code' },
  { cap: 'decode', re: /\b(base64\.b64decode|b64decode|codecs\.decode|FromBase64String|base64\s+(-d|--decode))\b/, says: 'decodes base64' },
  { cap: 'env-secret', re: /(os\.environ(\.get)?\s*[\[(]\s*["'][A-Z_]*(TOKEN|SECRET|PASSWORD|API_?KEY|PRIVATE)|os\.getenv\(\s*["'][A-Z_]*(TOKEN|SECRET|PASSWORD|API_?KEY|PRIVATE)|\$env:[A-Z_]*(TOKEN|SECRET|PASSWORD|API_?KEY)|\$\{?[A-Z_]*(TOKEN|SECRET|PASSWORD|API_?KEY)\b)/, says: 'reads a secret from the environment' },
  { cap: 'fs-write', re: /(open\([^)]*["'][wa]b?\+?["']|>>\s*~?\/?\S|\bOut-File\b|Set-Content|Add-Content)/, says: 'writes files' },
];
const SECRET_LIT = /(\.ssh[\\/]|\bid_rsa\b|\bid_ed25519\b|\.npmrc\b|\.pypirc\b|\.netrc\b|\.git-credentials\b|\.aws[\\/]credentials|Login Data\b|wallet\.dat\b)/i;
const PERSIST_LIT = /((?:^|[~\\/"'\s])\.(?:bashrc|zshrc|bash_profile|profile|zprofile)\b|[\\/]authorized_keys\b|LaunchAgents[\\/]|Start Menu[\\/]Programs[\\/]Startup|\bcrontab\b|\.claude[\\/](?:settings(?:\.local)?\.json|[\w.-]+\.[cm]?js)\b|\.vscode[\\/](?:tasks\.json|[\w.-]+\.[cm]?js)\b)/;

export function scriptFacts(text, file) {
  const out = [];
  text.split(/\r?\n/).forEach((l, i) => {
    if (/^\s*(#|\/\/|REM\b)/.test(l)) return;
    const add = (cap, detail) => out.push({ cap, detail, file, line: i + 1, scope: `${file}#0`, code: l.trim().slice(0, 160) });
    for (const r of SCRIPT_RULES) if (r.re.test(l)) add(r.cap, r.says);
    const s = l.match(SECRET_LIT); if (s) add('secret-path', `mentions "${s[0]}"`);
    const p = l.match(PERSIST_LIT); if (p) add('persist-path', `mentions "${p[0].trim()}"`);
  });
  return out;
}

/** All facts for a skill directory: its instructions (.md), its JS (parser) and its other scripts (line rules). */
export function skillFacts(dir) {
  const { facts, coverage, map } = dirFacts(dir, { manifest: readJson(join(dir, 'package.json')) }), named = [];
  const visit = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = join(d, e.name), rel = relative(dir, p).replaceAll('\\', '/'), ext = extname(e.name).toLowerCase();
      if (e.isDirectory()) { visit(p); continue; }
      if (statSync(p).size > 1_000_000) continue;
      if (ext === '.md') { const t = readText(p); facts.push(...instructionFacts(t, rel)); named.push(...keysNamed(t, rel)); }
      else if (['.py', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd'].includes(ext)) {
        coverage.files++; coverage.read++; (coverage.lineLevel ??= []).push(rel);
        facts.push(...scriptFacts(readText(p), rel));
      }
    }
  };
  visit(dir);
  return { facts, coverage, map: named.length ? { ...map, keys: named } : map };
}

/** A compiled MCP server: its build record, read by REA. Its code itself stays unread, and coverage says so. */
export function serverBinaryFacts(file) {
  const { facts, built } = binaryFacts(file);
  return { facts, coverage: { files: 1, read: 0, skipped: [], errors: [], compiled: true }, map: { binaries: [{ file: basename(file), ...built }] } };
}

// ---------- MCP servers ----------
const MCP_CONFIGS = project => [
  join(homedir(), '.claude.json'), join(project, '.mcp.json'), join(homedir(), '.cursor', 'mcp.json'), join(project, '.cursor', 'mcp.json'),
  join(project, '.vscode', 'mcp.json'), join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json'),
];

export function findMcpServers(project) {
  const out = [];
  const take = (servers, source) => {
    for (const [name, s] of Object.entries(servers || {}))
      out.push({ name, source, command: s.command ?? null, args: (s.args ?? []).map(String), url: s.url ?? s.serverUrl ?? null,
        given: givenKeys([...Object.keys(s.env ?? {}), ...Object.keys(s.headers ?? {})], name) });
  };
  for (const f of MCP_CONFIGS(project)) {
    const d = existsSync(f) ? readJson(f) : null;
    if (!d) continue;
    take(d.mcpServers ?? d.servers, f);
    for (const p of Object.values(d.projects ?? {})) take(p.mcpServers, f);  // ~/.claude.json keeps per-project servers
  }
  const codex = join(homedir(), '.codex', 'config.toml');
  if (existsSync(codex)) {  // just enough TOML: [mcp_servers.name] command = "…" args = […] url = "…"
    for (const m of readText(codex).matchAll(/^\[mcp_servers\.([^\].]+)\]\s*\n((?:(?!^\[).*\n?)*)/gm)) {
      const v = k => m[2].match(new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, 'm'))?.[1] ?? null;
      const args = [...(m[2].match(/^args\s*=\s*\[([^\]]*)\]/m)?.[1] ?? '').matchAll(/"([^"]*)"/g)].map(a => a[1]);
      const env = [...(m[2].match(/^env\s*=\s*\{([^}]*)\}/m)?.[1] ?? '').matchAll(/"?([\w-]+)"?\s*=/g)].map(a => a[1]);  // inline env = { K = "…" }
      if (v('command') || v('url')) out.push({ name: m[1], source: codex, command: v('command'), args, url: v('url'), given: givenKeys(env, m[1]) });
    }
  }
  return out;
}

// ---------- what opening the project runs on its own ----------
// A coding agent runs a project's hooks (.claude/settings.json) as sessions start and tools run; VS Code runs tasks marked
// runOn: folderOpen. The ChainDrop worm (Aug 2026) planted both, and the setup.mjs files they call, in the repos it reached,
// so opening the project started it again after the bad package was gone.
const AGENT_SETTINGS = ['.claude/settings.json', '.claude/settings.local.json'];
const WHEN = {
  SessionStart: 'when your coding agent starts a session here', SessionEnd: 'when your coding agent ends a session here',
  UserPromptSubmit: 'every time you send your coding agent a message', PreToolUse: 'before your coding agent uses a tool',
  PostToolUse: 'after your coding agent uses a tool', Stop: 'when your coding agent finishes a reply', SubagentStop: 'when a subagent finishes',
  Notification: 'when your coding agent sends a notification', PreCompact: 'before your coding agent compacts the conversation',
};
const HELPERS = { apiKeyHelper: 'whenever your coding agent needs an API key', awsAuthRefresh: 'when your coding agent refreshes its AWS sign-in', awsCredentialExport: 'when your coding agent needs AWS keys', otelHeadersHelper: 'when your coding agent sends telemetry' };
const SCRIPT = /\.(m?js|cjs|ts|sh|ps1|py)$/;
// VS Code's JSON allows comments and trailing commas; strings are kept whole while the rest is cleaned
const jsonc = t => JSON.parse(t.replace(/("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, s) => s ?? '').replace(/,(\s*[}\]])/g, '$1'));

/** What opening this project runs without asking: every hook and folder-open task (one fact each, at its line), and the
 *  code of the scripts they call or that sit in those folders. Read, never run. */
export function autorunFacts(project) {
  const facts = [], ran = new Set(), files = new Set(), errors = [];
  const read = f => { try { const t = readText(join(project, f)); files.add(f); return t; } catch { return null; } };
  const at = (text, needle) => { const ls = text.split(/\r?\n/), k = Math.max(0, ls.findIndex(l => l.includes(needle))); return { line: k + 1, code: ls[k].trim().slice(0, 160) }; };
  // each command is a chain: the hook or task, what its own text does, and the script it starts (policy combines along it)
  const runs = (cmd, when, file, text, needle = cmd) => {
    const where = at(text, JSON.stringify(needle).slice(1, 41)), scripts = [];
    for (const [m] of cmd.matchAll(/[\w$.{}/\\-]+\.(?:m?js|cjs|ts|sh|ps1|py)\b/g)) {
      const rel = m.replace(/^(\$\{workspaceFolder\}|\$CLAUDE_PROJECT_DIR)/, '').replaceAll('\\', '/').replace(/^\.?\//, '');
      if (!rel.split('/').includes('..')) { ran.add(rel); scripts.push(rel); }
    }
    const chain = scripts[0] ?? `${file}:${where.line}`;
    facts.push({ cap: 'autorun', detail: `runs \`${cmd.slice(0, 120)}\` ${when}`, file, ...where, scope: `${file}#0`, chain });
    for (const f of scriptFacts(cmd, file)) if (f.cap !== 'persist-path') facts.push({ ...f, ...where, chain });  // a curl | sh in the command itself
  };
  for (const file of AGENT_SETTINGS) {
    const text = read(file); if (text == null) continue;
    let s; try { s = JSON.parse(text); } catch { errors.push(`${file} (unparseable)`); continue; }
    for (const [event, groups] of Object.entries(s?.hooks ?? {})) for (const g of [groups].flat()) for (const h of [g?.hooks].flat())
      if (typeof h?.command === 'string') runs(h.command, WHEN[event] ?? `on your coding agent's ${event} hook`, file, text);
    if (typeof s?.statusLine?.command === 'string') runs(s.statusLine.command, 'over and over, to draw your coding agent\'s status line', file, text);
    for (const [k, when] of Object.entries(HELPERS)) if (typeof s?.[k] === 'string') runs(s[k], when, file, text);
  }
  const tasks = read('.vscode/tasks.json');
  if (tasks != null) {
    let t; try { t = jsonc(tasks); } catch { errors.push('.vscode/tasks.json (unparseable)'); }
    for (const task of Array.isArray(t?.tasks) ? t.tasks : []) {
      if (task?.runOptions?.runOn !== 'folderOpen') continue;
      for (const o of [task, task.windows, task.osx, task.linux]) {  // each platform can have its own command
        if (typeof o?.command !== 'string') continue;
        const args = (Array.isArray(o.args) ? o.args : []).map(a => typeof a === 'string' ? a : a?.value ?? '');
        runs([o.command, ...args].join(' '), 'as soon as the folder opens in VS Code', '.vscode/tasks.json', tasks, o.command);
      }
    }
  }
  const vs = read('.vscode/settings.json');
  if (vs != null) { let v; try { v = jsonc(vs); } catch {} if (v?.['task.allowAutomaticTasks'] === 'on') facts.push({ cap: 'autorun-allowed', detail: 'lets folder-open tasks run without asking first', file: '.vscode/settings.json', ...at(vs, 'allowAutomaticTasks'), scope: '.vscode/settings.json#0' }); }
  // the scripts those commands run, and any script sitting in those folders: settings folders, not code folders
  const loose = ['.claude', '.claude/hooks', '.vscode'].flatMap(d => { try { return readdirSync(join(project, d), { withFileTypes: true }).filter(e => e.isFile() && SCRIPT.test(e.name)).map(e => `${d}/${e.name}`); } catch { return []; } });
  for (const f of new Set([...[...ran].filter(f => SCRIPT.test(f)), ...loose])) {
    const text = read(f); if (text == null) continue;
    if (!ran.has(f)) facts.push({ cap: 'stray-script', detail: `${f} sits in a settings folder, and nothing here runs it`, file: f, line: 1, scope: `${f}#0`, code: text.split(/\r?\n/)[0].trim().slice(0, 160) });
    const own = /\.[cm]?js$/.test(f) ? fileFacts(text, f) : { facts: scriptFacts(text, f) };
    facts.push(...own.facts.map(x => ({ ...x, chain: f })));
    if (own.error) errors.push(`${f} (${own.error})`);
  }
  return { facts, files: [...files], coverage: { files: files.size, read: files.size - errors.length, skipped: [], errors } };
}
/** The project's "runs on open" item, or null when opening it runs nothing. Its fingerprint covers every file it read. */
export function findAutorun(project) {
  const r = autorunFacts(project);
  if (!r.facts.some(f => ['autorun', 'stray-script', 'autorun-allowed'].includes(f.cap))) return null;
  const h = createHash('sha256');
  for (const f of r.files.sort()) h.update(f).update(readFileSync(join(project, f)));
  return { kind: 'autorun', key: `autorun:${project}`, name: basename(project), dir: project, claim: '', fp: `autorun-${h.digest('base64')}`, noModel: true, read: () => r };
}

// ---------- who can spend your money ----------
// Keys to outside accounts that an agent's tools read in their code or are handed in an editor's MCP config. Each can
// run up a bill or act as you. Only names are kept: a key's value is never read.
// known accounts, anywhere in the name: REMOTION_AWS_ACCESS_KEY_ID is an AWS key
const SERVICE = [[/(^|_)OPENAI_/, 'OpenAI'], [/(^|_)(GEMINI|GOOGLE_(AI|GENAI))_/, 'Google Gemini'], [/^GOOGLE_APPLICATION_CREDENTIALS$/, 'Google Cloud'],
  [/(^|_)GOOGLE_/, 'Google'], [/(^|_)AWS_/, 'AWS'], [/(^|_)AZURE_/, 'Azure'], [/(^|_)(GITHUB|GH)_/, 'GitHub'], [/(^|_)(HF|HUGGING_?FACE(_HUB)?)_/, 'Hugging Face'],
  [/(^|_)ELEVEN_?LABS_/, 'ElevenLabs'], [/(^|_)HEYGEN_/, 'HeyGen'], [/(^|_)NPM_/, 'npm'], [/(^|_)OPENROUTER_/, 'OpenRouter']];
const SUFFIX = /_?(API_?KEY|ACCESS_?TOKEN|AUTH_?TOKEN|SECRET(_?KEY)?|TOKEN|PASSWORD|PASSWD|PRIVATE_?KEY|CREDENTIALS?|KEY)$/i;
// a key's name ends in what it is: MAX_TOKENS or LOG_TOKENS isn't a key, GITHUB_TOKEN and AWS_ACCESS_KEY_ID are
const KEY_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|_KEY|CREDENTIALS?|_AUTH|ACCESS_KEY_ID)$/i;
const AUTH_HEADER = /^(authorization|x-api-key|api-key|x-auth-token)$/i;
const givenKeys = (names, server) => [...new Set(names.filter(n => KEY_NAME.test(n) || AUTH_HEADER.test(n)))].map(name => ({ name, service: serviceOf(name, server) }));
/** A readable name for whatever a key belongs to: known ones by prefix, the rest from the name (TINKER_API_KEY → Tinker). */
export function serviceOf(key, server = '') {
  if (AUTH_HEADER.test(key)) return server || 'its server';
  const hit = SERVICE.find(([re]) => re.test(key));
  if (hit) return hit[1];
  const base = key.replace(SUFFIX, '') || key;
  return base.toLowerCase().split('_').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}
/** The secret keys a tool's own code reads, from its facts: [{ name, service, file, line }], one per key. */
export function keysFrom(facts, named = []) {
  const out = new Map();
  for (const f of facts) {
    if (f.cap !== 'env-secret') continue;
    for (const [name] of `${f.detail} ${f.code}`.matchAll(/\b[A-Z][A-Z0-9_]*\b/g))
      if (isKey(name) && !out.has(name)) out.set(name, { name, service: serviceOf(name), file: f.file, line: f.line });
  }
  for (const k of named) if (!out.has(k.name)) out.set(k.name, k);  // what its code reads comes first
  return [...out.values()];
}
// a key needs a name before what it is: OPENAI_API_KEY is one, a bare API_KEY placeholder in the docs isn't
const isKey = name => KEY_NAME.test(name) && /^[A-Z][A-Z0-9_]+$/.test(name) && name.replace(SUFFIX, '') !== '';
/** Keys a skill's instructions tell the agent to use ("Set ELEVENLABS_API_KEY, then call the API"). */
export function keysNamed(text, file) {
  const out = [];
  text.split(/\r?\n/).forEach((l, i) => {
    for (const [name] of l.matchAll(/\b[A-Z][A-Z0-9_]{2,}\b/g))
      if (isKey(name) && !out.some(k => k.name === name)) out.push({ name, service: serviceOf(name), file, line: i + 1, how: 'docs' });
  });
  return out;
}

/** Where an MCP server's code can be read from, without ever starting it. */
export function resolveServer(s, { fetch = true } = {}) {
  if (s.url && !s.command) return { readable: false, why: 'remote server: its code runs elsewhere and can\'t be read' };
  const cmd = basename(s.command || '').toLowerCase().replace(/\.(cmd|exe)$/, '');
  if (['npx', 'bunx', 'pnpx'].includes(cmd) || (cmd === 'pnpm' && s.args[0] === 'dlx')) {
    const spec = s.args.find(a => !a.startsWith('-') && a !== 'dlx');
    if (!spec) return { readable: false, why: 'npx with no package name' };
    if (!fetch) return { readable: false, why: `npm package ${spec} (not fetched: --offline)` };
    return quarantine(spec);
  }
  if (['node', 'python', 'python3', 'deno', 'bun'].includes(cmd)) {
    const script = s.args.find(a => /\.(m?js|cjs|ts|py)$/.test(a));
    if (script && existsSync(script)) return { readable: true, dir: dirname(script) };
  }
  if (['uvx', 'pipx', 'uv'].includes(cmd)) return { readable: false, why: 'Python package run by uvx/pipx: not fetched in this version' };
  if (cmd === 'docker' || cmd === 'podman') return { readable: false, why: 'container image: not inspected' };
  if (s.command && existsSync(s.command) && isBinary(s.command))
    return reaScript() ? { readable: true, binary: s.command }
      : { readable: false, why: `${basename(s.command)} is a compiled program: install REA (npm i -g rea-agents) to see what it was built from` };
  return { readable: false, why: `${basename(s.command || '?')} is a compiled program: its source can't be read here` };
}

/** Unpack an npm .tgz in Node (no system tar: GNU tar reads "D:\…" as a host name). Drops the leading "package/"
 *  and refuses any entry that would land outside `dest` (a malicious tarball can try "../../" paths). */
export function untar(tgz, dest) {
  const buf = gunzipSync(tgz), root = resolve(dest);
  let longName = null;
  for (let off = 0; off + 512 <= buf.length;) {
    const h = buf.subarray(off, off + 512);
    if (h.every(b => b === 0)) break;
    const field = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(field(124, 136).trim() || '0', 8), type = field(156, 157) || '0';
    const body = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') { longName = body.toString('utf8').match(/\d+ path=(.*)\n/)?.[1] ?? null; continue; }  // pax long path
    const name = longName ?? [field(345, 500), field(0, 100)].filter(Boolean).join('/');
    longName = null;
    if (type !== '0' && type !== '') continue;  // regular files only: no links, devices or directories needed
    const rel = name.replace(/^[^/]+\//, ''), target = resolve(root, rel);
    if (!rel || !target.startsWith(root + sep)) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
}

// only a plain package spec may reach npm: name, optional scope, optional version
const PLAIN_SPEC = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~<>=*|+-]+)?$/i;
const notPlain = spec => ({ readable: false, why: `not a plain npm package name: ${String(spec).slice(0, 60)}` });
const cantFetch = (spec, e) => ({ readable: false, why: `couldn't fetch ${spec}: ${String(e.message).split('\n')[0].slice(0, 80)}` });

/** npm with no shell anywhere: on Windows npm is a .cmd wrapper, so run npm's own JavaScript with this Node instead. */
function npm(args, cwd, timeout = 120_000) {
  if (process.platform !== 'win32') return execFileSync('npm', args, { cwd, encoding: 'utf8', timeout });
  const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!existsSync(cli)) throw new Error('couldn\'t find npm next to node');
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout });
}

/** Fetch an npm package's tarball into a quarantine folder. npm pack downloads; it never runs install scripts. */
function quarantine(spec) {
  if (!PLAIN_SPEC.test(spec)) return notPlain(spec);
  const root = join(HOME, 'quarantine'), safe = spec.replace(/[^\w.@-]/g, '_'), dir = join(root, safe);
  if (existsSync(join(dir, 'package.json'))) return { readable: true, dir };
  try {
    mkdirSync(dir, { recursive: true });
    const tgz = npm(['pack', spec, '--silent', '--ignore-scripts'], root).trim().split(/\r?\n/).pop();
    untar(readFileSync(join(root, tgz)), dir);
    return { readable: true, dir };
  } catch (e) { return cantFetch(spec, e); }
}

/** What `npm install <spec>` would bring aboard, the package and its whole tree, installed into a quarantine folder
 *  with every script off. Fresh each time (an old lockfile would pin an old version), and only the latest check stays
 *  on disk: a big tree shouldn't pile up. Its results stay remembered by their bytes. */
export function quarantineInstall(spec) {
  if (!PLAIN_SPEC.test(spec)) return notPlain(spec);
  const dir = join(HOME, 'quarantine', 'install');
  try {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{ "private": true }\n');
    npm(['install', spec, '--ignore-scripts', '--no-bin-links', '--no-audit', '--no-fund', '--silent'], dir, 300_000);
    return { readable: true, dir };
  } catch (e) { return cantFetch(spec, e); }
}
