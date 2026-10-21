// Compiled files, read without running them. Go and Rust programs carry a record of the modules or crates they were
// built from, and .NET assemblies declare their references and the native functions they call. REA reads those
// records statically. It is not the code, but it turns "can't read this" into "built from these, at these versions".
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

/** Where REA's entry script lives: SLOWSHIP_REA (the script, or a bin wrapper next to it), or a global npm install. */
export function reaScript() {
  const env = process.env.SLOWSHIP_REA, find = 'rea-agents/scripts/rea.mjs';
  const tries = env ? [env, join(dirname(env), '..', find)] : [];
  if (process.env.APPDATA) tries.push(join(process.env.APPDATA, 'npm', 'node_modules', find));
  return tries.find(p => /\.m?js$/.test(p) && existsSync(p)) ?? null;
}

/** One static REA command's JSON, or null when REA is missing, fails, or says more than maxBuffer. Fixed args, no shell. */
export function rea(args, maxBuffer = 8 << 20) {
  const script = reaScript(), all = [...args, '--format', 'json'];
  const opts = { encoding: 'utf8', timeout: 300_000, maxBuffer, stdio: ['ignore', 'pipe', 'ignore'] };
  try {
    // rea.cmd on Windows is only a wrapper around this script, so run it with this Node instead of a shell
    return JSON.parse(script ? execFileSync(process.execPath, [script, ...all], opts) : execFileSync('rea', all, opts));
  } catch { return null; }
}

const BIN_EXT = new Set(['', '.node', '.exe', '.dll', '.so', '.dylib']);
const MAGIC = [[0x4d, 0x5a], [0x7f, 0x45, 0x4c, 0x46], [0xcf, 0xfa, 0xed, 0xfe], [0xce, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]];
const head = p => {
  const b = Buffer.alloc(4), fd = openSync(p, 'r');
  try { readSync(fd, b, 0, 4, 0); } finally { closeSync(fd); }
  return b;
};

/** A PE, ELF or Mach-O file, by its first bytes (only for names a compiled file could have). */
export function isBinary(p) {
  if (!BIN_EXT.has(extname(p).toLowerCase())) return false;
  try { const b = head(p); return MAGIC.some(m => m.every((x, i) => b[i] === x)); } catch { return false; }
}

// Native functions a .NET assembly declares (P/Invoke), and what calling them means. Names only: A/W suffixes dropped.
const WIN32 = [
  { cap: 'exec', re: /^(CreateProcess(AsUser|WithLogon|WithToken)?|ShellExecute(Ex)?|WinExec)$/i, says: 'starts programs' },
  { cap: 'net', re: /^(WSAStartup|WSASocket|socket|connect|Internet(Open|OpenUrl|Connect)|HttpSendRequest|WinHttp(Open|Connect|SendRequest)|URLDownloadToFile)$/i, says: 'opens network connections itself' },
  { cap: 'keys', re: /^(SetWindowsHookEx|GetAsyncKeyState|RegisterRawInputDevices)$/i, says: 'can watch keystrokes outside its own window' },
  { cap: 'inject', re: /^(WriteProcessMemory|CreateRemoteThread(Ex)?|VirtualAllocEx|NtUnmapViewOfSection)$/i, says: 'writes into other programs\' memory' },
  { cap: 'dpapi', re: /^CryptUnprotectData$/i, says: 'decrypts data Windows keeps for this user (where browsers store saved passwords)' },
];

/** What a compiled file was built from: { facts, built }. `built` is for the report: language, toolchain, deps.
 *  `run` is REA (swapped for recorded answers in tests). */
export function binaryFacts(file, rel = basename(file), run = rea) {
  const facts = [], add = (cap, detail, code = '') => facts.push({ cap, detail, file: rel, line: 0, scope: `${rel}#0`, code });
  const nr = j => j && (j.normalized_result ?? {});

  const go = nr(run(['inspect-go-binary', file, '--filter-output', 'normalized_result.build_info.go_version,normalized_result.build_info.module']));
  if (!go) return { facts, built: { lang: null, note: 'REA isn\'t installed (npm i -g rea-agents), so nothing inside it was read' } };
  if (go.build_info?.module) {
    const { go_version: tool, module: m } = go.build_info, set = Object.fromEntries(m.settings.map(s => [s.key, s.value]));
    const deps = m.dependencies.map(d => ({ name: d.path, version: d.version, swap: d.replacement ? `${d.replacement.path} ${d.replacement.version ?? ''}`.trim() : null }));
    add('built-from', `Go program built from ${m.main?.path ?? m.path} ${m.main?.version ?? ''} and ${deps.length} module${deps.length === 1 ? '' : 's'} (${tool})`.replace('  ', ' '));
    for (const d of deps.filter(d => d.swap)) add('swapped-dep', `module ${d.name} ${d.version} is swapped for ${d.swap} at build time`);
    if (set['vcs.modified'] === 'true') add('dirty-build', 'built from uncommitted changes: it may not match any published source', `vcs.revision=${set['vcs.revision'] ?? '?'}`);
    return { facts, built: { lang: 'go', tool, main: `${m.main?.path ?? m.path} ${m.main?.version ?? ''}`.trim(), deps, cgo: set.CGO_ENABLED === '1', revision: set['vcs.revision'] ?? null } };
  }

  const rust = nr(run(['inspect-rust-binary', file, '--filter-output', 'normalized_result.auditable_metadata.packages,normalized_result.rustc_commit']));
  const commit = rust?.rustc_commit?.hashes?.[0]?.hash?.slice(0, 8);
  if (rust?.auditable_metadata?.packages) {
    const pk = rust.auditable_metadata.packages, root = pk.find(p => p.root) ?? pk[0];
    const deps = pk.filter(p => p !== root).map(p => ({ name: p.name, version: p.version, source: p.source }));
    add('built-from', `Rust program built from ${root.name} ${root.version} and ${deps.length} crate${deps.length === 1 ? '' : 's'}${commit ? ` (rustc ${commit})` : ''}`);
    // the project's own workspace crates are "local"; anything else off crates.io came from somewhere less checked
    for (const d of deps.filter(d => d.source !== 'crates.io' && d.source !== 'local')) add('swapped-dep', `crate ${d.name} ${d.version} comes from ${d.source}, not crates.io`);
    return { facts, built: { lang: 'rust', tool: commit ? `rustc ${commit}` : null, main: `${root.name} ${root.version}`, deps } };
  }
  if (commit) {
    add('built-from', `Rust program (rustc ${commit}) with no crate list inside: what it's built from can't be listed`);
    return { facts, built: { lang: 'rust', tool: `rustc ${commit}`, main: null, deps: [], note: 'Built without cargo-auditable, so no crate list is embedded' } };
  }

  if (head(file)[0] === 0x4d) {  // PE: maybe a .NET assembly
    const m = nr(run(['inspect-managed-artifact', file, '--filter-output', 'normalized_result.classification.status,normalized_result.assembly,normalized_result.target_frameworks,normalized_result.references']));
    if (m?.classification?.status === 'managed') {
      const deps = (m.references ?? []).map(r => ({ name: r.name, version: r.version }));
      const name = m.assembly ? `${m.assembly.name} ${m.assembly.version}` : rel;
      add('built-from', `.NET assembly ${name}${m.target_frameworks?.[0] ? ` for ${m.target_frameworks[0]}` : ''}, referencing ${deps.length} assembl${deps.length === 1 ? 'y' : 'ies'}`);
      const b = nr(run(['inspect-managed-native-boundaries', file, '--filter-output', 'normalized_result.pinvoke_imports']));
      const native = new Set();
      for (const p of b?.pinvoke_imports ?? []) {
        const fn = String(p.import_name ?? p.member_name ?? '').replace(/[AW]$/, ''), lib = p.import_scope_name ?? '?';
        native.add(lib);
        const hit = WIN32.find(w => w.re.test(fn));
        if (hit) add(hit.cap, `calls ${fn} in ${lib}: ${hit.says}`, `[DllImport("${lib}")] ${p.member_name}`);
      }
      return { facts, built: { lang: 'dotnet', tool: m.target_frameworks?.[0] ?? null, main: name, deps, native: [...native] } };
    }
  }
  add('built-from', 'compiled code with no build record REA can read: its code and what it\'s built from stay unseen');
  return { facts, built: { lang: null, note: 'No Go, Rust or .NET build record (C and C++ leave none)' } };
}
