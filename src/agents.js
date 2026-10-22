// Your agent's supply chain: installed skills (instructions + scripts) and configured MCP servers.
// A skill is read as both code and instructions, because a skill attacks through either, or through the two together.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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

export function findSkills(project) {
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
  for (const r of SKILL_ROOTS(project)) visit(r, 0);
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
const PERSIST_LIT = /((?:^|[~\\/"'\s])\.(?:bashrc|zshrc|bash_profile|profile|zprofile)\b|[\\/]authorized_keys\b|LaunchAgents[\\/]|Start Menu[\\/]Programs[\\/]Startup|\bcrontab\b)/;

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

/** Fetch an npm package's tarball into a quarantine folder. npm pack downloads; it never runs install scripts. */
function quarantine(spec) {
  // npm.cmd needs a shell on Windows, so only a plain package spec may reach it: name, optional scope, optional version
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~<>=*|+-]+)?$/i.test(spec)) return { readable: false, why: `not a plain npm package name: ${spec.slice(0, 60)}` };
  const root = join(HOME, 'quarantine'), safe = spec.replace(/[^\w.@-]/g, '_'), dir = join(root, safe);
  if (existsSync(join(dir, 'package.json'))) return { readable: true, dir };
  try {
    mkdirSync(dir, { recursive: true });
    // No shell anywhere: on Windows npm is a .cmd wrapper, so run npm's own JavaScript with this Node instead.
    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const [bin, pre] = process.platform === 'win32' ? [process.execPath, [npmCli]] : ['npm', []];
    if (process.platform === 'win32' && !existsSync(npmCli)) return { readable: false, why: `couldn't find npm next to node to fetch ${spec}` };
    const out = execFileSync(bin, [...pre, 'pack', spec, '--silent', '--ignore-scripts'], { cwd: root, encoding: 'utf8', timeout: 120_000 });
    const tgz = out.trim().split(/\r?\n/).pop();
    untar(readFileSync(join(root, tgz)), dir);
    return { readable: true, dir };
  } catch (e) {
    return { readable: false, why: `couldn't fetch ${spec}: ${String(e.message).split('\n')[0].slice(0, 80)}` };
  }
}
