// What a piece of code can touch, read with a real parser (never run): files, network, environment, processes,
// dynamic code, obfuscation. Each fact carries its evidence (file:line, the line itself) and the function it sits in,
// so combinations ("decodes data, then runs it") can require that the parts are actually together.
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import * as acorn from 'acorn';
import * as loose from 'acorn-loose';
import * as walk from 'acorn-walk';
import { binaryFacts, isBinary } from './binary.js';

// Node built-ins worth knowing about, and what importing them means.
const MODULES = {
  fs: 'fs', 'fs/promises': 'fs', child_process: 'exec', net: 'net', tls: 'net', dgram: 'net', http: 'net', https: 'net',
  http2: 'net', dns: 'net', os: 'os', vm: 'code',
};
const WHAT = { fs: 'files', exec: 'runs programs', net: 'network', os: 'system info', code: 'runs code' };
const FS_READ = /^(readFile|readFileSync|createReadStream|readdir|readdirSync|opendir|opendirSync|open|openSync)$/;
const FS_WRITE = /^(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|rm|rmSync|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync)$/;
const EXEC = /^(exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)$/;
const NET_CALL = /^(request|get|connect|createConnection|lookup|resolve|send)$/;
// Where credentials live. (.env is left out: loading it is a common, legitimate job.)
const SECRET_PATH = /(\.ssh[\\/]|\bid_rsa\b|\bid_ed25519\b|\.npmrc\b|\.pypirc\b|\.netrc\b|\.git-credentials\b|\.aws[\\/]credentials|\.docker[\\/]config\.json|\.kube[\\/]config|Login Data\b|Local State\b|\.bash_history\b|\.zsh_history\b|wallet\.dat\b|Keychains[\\/])/i;
// Where code goes to start again on its own.
// Dotfiles only when they look like paths (~/.profile), and case-sensitive: settings.Profile is not a shell profile.
// Also what a coding agent or VS Code runs when a project opens: its hooks file, tasks.json, and scripts beside them (ChainDrop).
export const PERSIST_PATH = /((?:^|[~\\/])\.(?:bashrc|zshrc|bash_profile|profile|zprofile)\b|[\\/]authorized_keys\b|LaunchAgents[\\/]|LaunchDaemons[\\/]|Start Menu[\\/]Programs[\\/]Startup|CurrentVersion\\Run\b|\.claude[\\/](?:settings(?:\.local)?\.json|[\w.-]+\.[cm]?js)\b|\.vscode[\\/](?:tasks\.json|[\w.-]+\.[cm]?js)\b)/;
// Environment variable names that hold secrets (not npm_config_*, not *_PATH).
const SECRET_ENV = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|CREDENTIAL|_AUTH\b|AUTH_?TOKEN)/i;
// Bidirectional overrides and isolates ("Trojan Source"). Zero-width joiners are left alone: many scripts need them.
const BIDI = /[‪-‮⁦-⁩]/;
const BLOB = /^[A-Za-z0-9+/=_-]{160,}$/;  // base64 / base64url / hex shaped
const MAX_BYTES = 2_000_000;
const FUNCS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

export function entropy(s) {
  const n = {}; for (const c of s) n[c] = (n[c] || 0) + 1;
  return Object.values(n).reduce((h, k) => h - (k / s.length) * Math.log2(k / s.length), 0);
}

/** What a string literal points at: credential files, places that start code again, web addresses, encoded blobs.
 *  Shared with compiled .NET code, whose string literals REA lists (binary.js). */
export function stringFacts(s) {
  const out = [], sec = s.match(SECRET_PATH), per = s.match(PERSIST_PATH);
  if (sec) out.push(['secret-path', `mentions "${sec[0]}"`]);
  if (per) out.push(['persist-path', `mentions "${per[0]}"`]);
  const url = s.match(/\b(?:https?|wss?):\/\/([a-z0-9.-]+\.[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?/i);
  if (url) out.push(['url', `URL to ${url[1]}`]);
  if (BLOB.test(s) && entropy(s) > 4.5) out.push(['obfuscated', `${s.length}-character encoded blob`]);
  return out;
}

function parse(src) {
  const opts = { ecmaVersion: 'latest', locations: true, allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true };
  for (const sourceType of ['module', 'script']) {
    try { return { ast: acorn.parse(src, { ...opts, sourceType }), loose: false }; } catch { /* try the next */ }
  }
  return { ast: loose.parse(src, { ...opts, sourceType: 'module' }), loose: true };  // half-broken code still gets read
}

const str = n => n && (n.type === 'Literal' && typeof n.value === 'string' ? n.value
  : n.type === 'TemplateLiteral' ? n.quasis.map(q => q.value.cooked ?? '').join('${}') : null);
const lit = n => str(n) != null && !(n.type === 'TemplateLiteral' && n.expressions.length);  // text written out whole

// A program run with a command written out in the code is one you can read; one built while it runs could be anything.
// Fixed means: the command (and every argument) is literal text, a const holding it, or a file in the package's own
// folder (path.join(__dirname, 'x')). A fixed command that downloads, pipes into a shell or installs stays a full flag.
const RISKY_CMD = /\b(curl|wget|Invoke-WebRequest|iwr|Invoke-Expression|iex|Invoke-RestMethod|bitsadmin|certutil|mshta|rundll32|regsvr32|base64|nc|ncat|netcat|ssh|scp|osascript)\b|https?:\/\/|\|\s*(sh|bash|zsh|iex|pwsh|powershell|cmd|python3?|node|perl)\b|\b(sh|bash|zsh|cmd(\.exe)?|powershell|pwsh|python3?|node|perl|ruby)\s+(-c|\/c|-e|-Command|-EncodedCommand)\b|\b(npm|pnpm|yarn|bun|pip3?|gem)\s+(i|install|add|dlx|x|exec)\b|\b(npx|bunx|pnpx|uvx|pipx)\b|\bdeno\s+(run|install)\b/i;  // fetch-and-run tools
function fixedCommand(node, fn, consts) {
  const text = n => lit(n) ? str(n) : n?.type === 'Identifier' && consts.get(n.name)?.text != null ? consts.get(n.name).text : null;
  const own = n => text(n) != null || (n?.type === 'Identifier' && /^__(dirname|filename)$/.test(n.name))
    || (n?.type === 'MemberExpression' && n.object.type === 'Identifier' && n.object.name === 'process' && n.property.name === 'execPath')
    || (n?.type === 'CallExpression' && n.callee.type === 'MemberExpression' && /^(join|resolve)$/.test(n.callee.property.name) && n.arguments.every(own));
  const [cmd, rest] = node.arguments;
  if (!own(cmd)) return null;
  const parts = [text(cmd) ?? 'a file in its own folder'];
  if (!/^exec(Sync)?$/.test(fn) && rest) {  // execFile / spawn / fork: an argument list, or the options
    if (rest.type === 'ArrayExpression') { if (!rest.elements.every(e => text(e) != null)) return null; parts.push(...rest.elements.map(text)); }
    else if (!(rest.type === 'ObjectExpression' || /Function/.test(rest.type) || (rest.type === 'Identifier' && consts.get(rest.name)?.object))) return null;
  }
  const line = parts.join(' ');
  return RISKY_CMD.test(line) ? null : line;
}
const reqName = n => n?.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'require' ? str(n.arguments[0]) : null;
const bare = m => m?.replace(/^node:/, '');

/** Facts for one file's source text. */
export function fileFacts(src, file) {
  const out = [], lines = src.split(/\r?\n/);
  let scope = 0;
  const add = (cap, detail, node, line = node?.loc?.start.line) =>
    out.push({ cap, detail, file, line, scope: `${file}#${scope}`, code: (lines[line - 1] || '').trim().slice(0, 160) });

  const bidi = lines.findIndex(l => BIDI.test(l));
  if (bidi >= 0) add('hidden-chars', 'bidirectional control characters that can make code read differently than it runs', null, bidi + 1);

  let parsed;
  try { parsed = parse(src); } catch { return { facts: out, error: 'unparseable' }; }
  const alias = new Map();  // a Map, not {}: code may call functions named constructor or toString
  const consts = new Map();  // const name = 'text' / { … }: enough to see a command or its options are fixed
  // ponytail: one map for the whole file, so a shadowing const in another function can mislead it; scope it if that bites
  const bind = (id, mod, member) => { if (id?.type === 'Identifier') alias.set(id.name, member ? `${mod}.${member}` : mod); };
  const importOf = (mod, node, how) => {
    const m = bare(mod);
    if (m && MODULES[m]) add('imports', `${how} '${m}' (${WHAT[MODULES[m]]})`, node);  // a hint; the calls carry the weight
  };

  walk.fullAncestor(parsed.ast, (node, _state, ancestors) => {
    const fn = ancestors.slice(0, -1).findLast(a => FUNCS.has(a.type));
    scope = fn ? fn.start : 0;
    switch (node.type) {
      case 'ImportDeclaration': {
        const m = bare(node.source.value);
        importOf(m, node, 'imports');
        for (const s of node.specifiers) s.type === 'ImportSpecifier' ? bind(s.local, m, s.imported.name) : bind(s.local, m);
        break;
      }
      case 'ImportExpression': {
        const m = str(node.source);
        m == null ? add('dynamic-load', 'import() of a computed name', node) : importOf(m, node, 'imports');
        break;
      }
      case 'VariableDeclarator': {
        if (node.id.type === 'Identifier' && ancestors.at(-2)?.kind === 'const')
          lit(node.init) ? consts.set(node.id.name, { text: str(node.init) }) : node.init?.type === 'ObjectExpression' && consts.set(node.id.name, { object: true });
        const m = bare(reqName(node.init) ?? (node.init?.type === 'MemberExpression' ? reqName(node.init.object) : null));
        if (!m) break;
        if (node.id.type === 'ObjectPattern') for (const p of node.id.properties) p.key && bind(p.value, m, p.key.name ?? p.key.value);
        else bind(node.id, m, node.init.type === 'MemberExpression' ? node.init.property.name : undefined);
        break;
      }
      case 'CallExpression': {
        const c = node.callee;
        if (c.type === 'Identifier' && c.name === 'require') {
          const m = str(node.arguments[0]);
          m == null ? add('dynamic-load', 'require() of a computed name', node) : importOf(m, node, 'requires');
        } else if (c.type === 'Identifier' && c.name === 'eval') add('code', 'eval() runs a string as code', node);
        else if (c.type === 'Identifier' && c.name === 'fetch') add('net', 'fetch()', node);
        const target = c.type === 'Identifier' ? alias.get(c.name)
          : c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && alias.has(c.object.name)
            ? `${alias.get(c.object.name).split('.')[0]}.${c.property.name}`
            : c.type === 'MemberExpression' && !c.computed && reqName(c.object) ? `${bare(reqName(c.object))}.${c.property.name}` : null;
        if (target) {
          const [mod, fn] = target.split('.');
          if (mod === 'child_process' && EXEC.test(fn)) {
            const fixed = fixedCommand(node, fn, consts);
            fixed != null ? add('exec-fixed', `${fn}() runs one fixed command: ${fixed.slice(0, 80)}`, node) : add('exec', `${fn}() runs a program`, node);
          }
          else if ((mod === 'fs' || mod === 'fs/promises') && FS_READ.test(fn)) add('fs-read', `${fn}()`, node);
          else if ((mod === 'fs' || mod === 'fs/promises') && FS_WRITE.test(fn)) add('fs-write', `${fn}()`, node);
          else if (['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns'].includes(mod) && NET_CALL.test(fn)) add('net', `${mod}.${fn}()`, node);
          else if (mod === 'os' && /^(homedir|userInfo|networkInterfaces|hostname)$/.test(fn)) add('os', `os.${fn}()`, node);
          else if (mod === 'vm' && /^(runIn|compileFunction|Script)/.test(fn)) add('code', `vm.${fn}() runs a string as code`, node);
        }
        if (c.type === 'MemberExpression' && c.object.type === 'Identifier' && c.object.name === 'Buffer'
          && c.property.name === 'from' && /^(base64|hex)$/.test(str(node.arguments[1]) ?? '')) add('decode', `Buffer.from(…, "${str(node.arguments[1])}")`, node);
        if (c.type === 'Identifier' && c.name === 'atob') add('decode', 'atob()', node);
        break;
      }
      case 'NewExpression':
        if (node.callee.type === 'Identifier' && node.callee.name === 'Function') add('code', 'new Function() builds code at runtime', node);
        if (node.callee.type === 'Identifier' && node.callee.name === 'WebSocket') add('net', 'new WebSocket()', node);
        break;
      case 'MemberExpression': {
        const o = node.object;
        if (o.type === 'MemberExpression' && o.object.type === 'Identifier' && o.object.name === 'process' && o.property.name === 'env') {
          const key = node.computed ? str(node.property) : node.property.name;
          if (key && SECRET_ENV.test(key) && !/^npm_config_/i.test(key)) add('env-secret', `reads process.env.${key}`, node);
        } else if (o.type === 'Identifier' && o.name === 'process' && node.property.name === 'env') add('env', 'reads process.env', node);
        break;
      }
      case 'Literal': case 'TemplateLiteral': {
        const s = str(node);
        if (s) for (const [cap, detail] of stringFacts(s)) add(cap, detail, node);
        break;
      }
    }
  });
  return { facts: out, error: parsed.loose ? 'partly unparseable' : null };
}

const CODE = new Set(['.js', '.cjs', '.mjs']);
const TESTY = /(^|\/)(test|tests|__tests__|spec|specs|example|examples|bench|benchmark|benchmarks|fixtures?|demo|docs?)\/|\.(test|spec|bench)\.[cm]?js$/;

/** Facts for a whole package (or skill / app directory), plus what we couldn't read, plus what compiled files are built from. */
export function dirFacts(root, { manifest } = {}) {
  const facts = [], coverage = { files: 0, read: 0, skipped: [], errors: [] }, binaries = [];
  const visit = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') visit(p); continue; }
      const rel = relative(root, p).replaceAll('\\', '/');
      if (isBinary(p) && !TESTY.test(rel)) {
        const b = binaryFacts(p, rel);
        facts.push(...b.facts); binaries.push({ file: rel, ...b.built });
        continue;
      }
      if (!CODE.has(extname(e.name)) || e.name.endsWith('.d.ts')) continue;
      coverage.files++;
      // tests, examples and benchmarks ship in many packages but never run when you use them
      if (TESTY.test(rel)) { coverage.tests = (coverage.tests || 0) + 1; continue; }
      if (statSync(p).size > MAX_BYTES) { coverage.skipped.push(`${rel} (over 2 MB)`); continue; }
      const { facts: f, error } = fileFacts(readFileSync(p, 'utf8'), rel);
      if (error) coverage.errors.push(`${rel} (${error})`);
      if (error !== 'unparseable') coverage.read++;
      facts.push(...f);
    }
  };
  visit(root);
  const pkg = manifest ?? (() => { try { return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); } catch { return null; } })();
  for (const k of ['preinstall', 'install', 'postinstall'])
    if (pkg?.scripts?.[k]) facts.unshift({ cap: 'install-script', detail: `runs "${pkg.scripts[k]}" on install`, file: 'package.json', line: 0, scope: 'package.json#0', code: '' });
  return { facts, coverage, map: binaries.length ? { binaries } : undefined };
}

/** One fact per (capability, detail, file), with how many times it occurred: short enough for a small model.
 *  Combination evidence is decided before condensing (see policy.combos), so nothing that matters is merged away. */
export function condense(facts, limit = 40, keep = new Set(), rank = () => 0) {
  const seen = new Map();
  for (const f of facts) {
    const k = `${f.cap}|${f.detail}|${f.file}`;
    seen.has(k) ? seen.get(k).count++ : seen.set(k, { ...f, count: 1 });
  }
  // what a combination rests on comes first, then the riskier facts: the cap only ever drops the least important
  const all = [...seen.entries()].sort(([ka, a], [kb, b]) => (keep.has(kb) - keep.has(ka)) || (rank(b) - rank(a)));
  return all.slice(0, limit).map(([, f], i) => ({ id: `E${i + 1}`, ...f }));
}
