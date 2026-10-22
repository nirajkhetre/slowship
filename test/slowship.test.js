// Rules-only checks (no model needed): run with `npm test`. Fixtures are inert and never executed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { condense, dirFacts, fileFacts } from '../src/facts.js';
import { assess, combos, keysOf, risk } from '../src/policy.js';
import { resolveServer, skillFacts } from '../src/agents.js';
import { binaryFacts, reaScript } from '../src/binary.js';

const FX = join(import.meta.dirname, 'fixtures');
const verdict = ({ facts }, labels = {}) => {
  const found = combos(facts), short = condense(facts, 40, keysOf(found), risk);
  return { ...assess(short, found, labels), short };
};

test('a package that reads ~/.npmrc and posts it is held, with evidence', () => {
  const v = verdict(dirFacts(join(FX, 'evil-pkg')));
  assert.equal(v.level, 'hold');
  const f = v.findings.find(x => x.kind === 'exfil');
  assert.ok(f && f.evidence.length >= 2);
});

test('nothing the model says can lower a hold', () => {
  const r = dirFacts(join(FX, 'injected-pkg'));
  const allExpected = Object.fromEntries(verdict(r).short.map(f => [f.id, { label: 'expected', why: 'the README says so' }]));
  assert.equal(verdict(r, allExpected).level, 'hold');
});

test('the model alone can raise a single fact to review, never to hold', () => {
  const r = { facts: fileFacts("const cp = require('child_process'); cp.spawn('ls');", 'a.js').facts };
  const ids = verdict(r).short.map(f => f.id);
  const v = verdict(r, Object.fromEntries(ids.map(id => [id, { label: 'unexpected', why: '' }])));
  assert.equal(v.level, 'review');
});

test('a token next to a request is review, and hold only if the model calls it unexpected', () => {
  const src = "const https = require('https');\nconst t = process.env.GITHUB_TOKEN;\nhttps.request({ headers: { authorization: t } });";
  const r = { facts: fileFacts(src, 'a.js').facts };
  assert.equal(verdict(r).level, 'review');
  const ids = verdict(r).short.map(f => f.id);
  assert.equal(verdict(r, Object.fromEntries(ids.map(id => [id, { label: 'unexpected', why: '' }]))).level, 'hold');
});

test('regex .exec() is not running a program; aliases and destructuring are followed', () => {
  const caps = src => fileFacts(src, 'a.js').facts.map(f => f.cap);
  assert.ok(!caps("const m = /x/.exec(s);").includes('exec'));
  assert.ok(caps("const { execSync } = require('node:child_process'); execSync('id');").includes('exec'));
  assert.ok(caps("require('https').request(o);").includes('net'));
  assert.ok(caps("function constructor() {} constructor();").length === 0);  // plain-object alias bug
});

test('decode and run must be in the same function to count', () => {
  const apart = "function a(){ return atob(x); }\nfunction b(){ return eval(y); }";
  const together = "function a(){ return eval(atob(x)); }";
  assert.notEqual(verdict({ facts: fileFacts(apart, 'a.js').facts }).level, 'hold');
  assert.equal(verdict({ facts: fileFacts(together, 'a.js').facts }).level, 'hold');
});

test('Persian text with zero-width joiners is fine; bidi overrides are held', () => {
  assert.equal(verdict({ facts: fileFacts("const s = 'می\u200Cبایست';", 'a.js').facts }).level, 'info');
  assert.equal(verdict({ facts: fileFacts("const isAdmin = false; /* \u202E } \u2066 */", 'a.js').facts }).level, 'hold');
});

test('a skill that hides a step and ships keys out is held; one using its own API key is not', () => {
  const evil = verdict(skillFacts(join(FX, 'evil-skill')));
  assert.equal(evil.level, 'hold');
  assert.ok(evil.findings.some(f => f.kind === 'conceal'));
  assert.ok(evil.findings.some(f => f.kind === 'exfil'));
  assert.notEqual(verdict(skillFacts(join(FX, 'good-skill'))).level, 'hold');
});

test('an MCP package name that could reach a shell is refused before anything runs', () => {
  const r = resolveServer({ command: 'npx', args: ['-y', 'x & calc'] });
  assert.equal(r.readable, false);
  assert.match(r.why, /not a plain npm package name/);
  assert.equal(resolveServer({ command: 'C:/tools/server.exe', args: [] }).readable, false);
  assert.equal(resolveServer({ url: 'https://example.invalid/mcp', args: [] }).readable, false);
});

test('your own build: a shipped key is held and never printed in full', async () => {
  const { appFacts } = await import('../src/app.js');
  const r = appFacts(join(FX, 'my-electron-app'), { rea: false });
  const v = verdict(r);
  assert.equal(v.level, 'hold');
  const kinds = v.findings.map(f => f.kind);
  for (const k of ['electron-open', 'secret', 'env-file', 'electron-websec-off', 'devtools', 'sourcemap']) assert.ok(kinds.includes(k), k);
  assert.ok(!JSON.stringify(r.facts).includes('AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'), 'the full key must never appear');
});

const ipcGraph = () => JSON.parse(readFileSync(join(FX, 'rea', 'ipc-app.graph.json'), 'utf8'));

test('IPC map: an unchecked handler a page can reach that opens a computed URL is held; a checked one is quiet', async () => {
  const { ipcMap, ipcFacts } = await import('../src/app.js');
  const map = ipcMap(ipcGraph()), by = Object.fromEntries(map.map(h => [h.channel, h]));
  assert.deepEqual(Object.keys(by).sort(), ['log', 'open-link', 'read-note']);
  assert.equal(by['read-note'].checked, true);
  assert.deepEqual(by['open-link'].via, ['window.notes.openLink']);
  const v = verdict({ facts: ipcFacts(map, join(FX, 'ipc-app')) });
  assert.equal(v.level, 'hold');
  assert.deepEqual(v.findings.map(f => f.kind), ['ipc-open', 'ipc-unchecked']);
  assert.ok(!v.short.some(f => f.detail.includes('read-note')), 'a handler that checks its sender is not flagged');
});

test('REA, live: the recorded IPC graph still matches what REA says today', { skip: !reaScript() && 'REA not installed (set SLOWSHIP_REA)' }, async () => {
  const { ipcMap, reaApp } = await import('../src/app.js');
  const sort = m => m.sort((a, b) => a.channel.localeCompare(b.channel));
  assert.deepEqual(sort(ipcMap(reaApp(join(FX, 'ipc-app')).graph)), sort(ipcMap(ipcGraph())));
});

test('a compiled Go server: its build record is read, a swapped module and a dirty build stand out', () => {
  const asked = [], go = { normalized_result: { build_info: { go_version: 'go1.26.0', module: {
    path: 'example.invalid/weather-mcp', main: { path: 'example.invalid/weather-mcp', version: 'v1.2.0' },
    dependencies: [{ path: 'github.com/mark3labs/mcp-go', version: 'v0.40.0', replacement: null },
      { path: 'golang.org/x/net', version: 'v0.44.0', replacement: { path: '../net-fork', version: null } }],
    settings: [{ key: 'CGO_ENABLED', value: '0' }, { key: 'vcs.revision', value: 'abc123' }, { key: 'vcs.modified', value: 'true' }] } } } };
  const r = binaryFacts('server.exe', 'server.exe', args => (asked.push(args), args[0] === 'inspect-go-binary' ? go : null));
  assert.equal(r.built.lang, 'go');
  assert.equal(r.built.deps.length, 2);
  assert.deepEqual(r.facts.map(f => f.cap), ['built-from', 'swapped-dep', 'dirty-build']);
  assert.match(r.facts[1].detail, /golang\.org\/x\/net v0\.44\.0 is swapped for \.\.\/net-fork/);
  assert.ok(asked.every(a => a[0].startsWith('inspect-') && a.includes('--filter-output')), 'only static inspectors, always filtered');
  assert.equal(verdict(r).level, 'notable');
});

test('a .NET assembly: P/Invoke into CreateProcess is "starts programs"; harmless imports say nothing', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const dll = join(mkdtempSync(join(tmpdir(), 'slowship-')), 'Helper.dll');
  writeFileSync(dll, 'MZ inert test bytes, not a real program');
  const answers = {
    'inspect-go-binary': { normalized_result: { build_info: null } },
    'inspect-rust-binary': { normalized_result: { auditable_metadata: null, rustc_commit: null } },
    'inspect-managed-artifact': { normalized_result: { classification: { status: 'managed' }, assembly: { name: 'Helper', version: '1.0.0.0' },
      target_frameworks: ['.NETCoreApp,Version=v8.0'], references: [{ name: 'System.Runtime', version: '8.0.0.0' }] } },
    'inspect-managed-native-boundaries': { normalized_result: { pinvoke_imports: [
      { import_name: 'CreateProcessW', member_name: 'CreateProcess', import_scope_name: 'kernel32.dll' },
      { import_name: 'GetTickCount64', member_name: 'Ticks', import_scope_name: 'kernel32.dll' }] } },
  };
  const r = binaryFacts(dll, 'Helper.dll', args => answers[args[0]]);
  assert.equal(r.built.lang, 'dotnet');
  assert.deepEqual(r.built.native, ['kernel32.dll']);
  assert.deepEqual(r.facts.map(f => f.cap), ['built-from', 'exec']);
  assert.match(r.facts[1].detail, /CreateProcess in kernel32\.dll: starts programs/);
});

test('.NET, method by method: decode-and-load and read-and-post are held; an update check and Load(name) are not', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const dll = join(mkdtempSync(join(tmpdir(), 'slowship-')), 'Loader.dll');
  writeFileSync(dll, 'MZ inert stand-in: REA\'s recorded answers describe test/fixtures/dotnet-loader/Loader.cs');
  const answers = JSON.parse(readFileSync(join(FX, 'rea', 'dotnet-loader.json'), 'utf8'));
  const r = binaryFacts(dll, 'Loader.dll', args => answers[args[0]]);
  const v = verdict(r), kinds = v.findings.map(f => f.kind);
  assert.equal(v.level, 'hold');
  assert.ok(kinds.includes('hidden-code') && kinds.includes('exfil'), kinds.join());
  const code = r.facts.filter(f => f.cap === 'code');
  assert.deepEqual(code.map(f => f.code), ['in Loader.Start'], 'Assembly.Load(name) in LoadPlugin is ordinary');
  assert.ok(!v.findings.some(f => f.level === 'hold' && f.evidence.some(id => v.short.find(s => s.id === id)?.code === 'in Loader.CheckForUpdates')));
});

test('Electron fuses as shipped: RunAsNode, NODE_OPTIONS and --inspect are worth a glance', async () => {
  const { fuseFacts } = await import('../src/binary.js');
  const answer = JSON.parse(readFileSync(join(FX, 'rea', 'electron-fuses.json'), 'utf8'));
  const r = fuseFacts('app.exe', 'app.exe', () => answer);
  assert.deepEqual(r.facts.map(f => f.cap), ['fuse-node', 'fuse-node', 'fuse-node', 'fuse-asar']);
  assert.equal(verdict(r).level, 'review');
  assert.equal(fuseFacts('tool.exe', 'tool.exe', () => ({ normalized_result: { slices: [{ sentinels: [] }] } })), null, 'not Electron: nothing to say');
});

test('who can spend your money: key names from code and MCP configs, never their values; MAX_TOKENS is no key', async () => {
  const { findMcpServers, keysFrom, scriptFacts, serviceOf } = await import('../src/agents.js');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const k = keysFrom(scriptFacts('key = os.environ["TINKER_API_KEY"]\nMAX_TOKENS = int(os.environ.get("MAX_TOKENS", 512))\n', 'train.py'));
  assert.deepEqual(k.map(x => `${x.name} ${x.service} ${x.line}`), ['TINKER_API_KEY Tinker 1']);
  assert.equal(serviceOf('GITHUB_TOKEN'), 'GitHub');
  const { keysNamed } = await import('../src/agents.js');
  assert.deepEqual(keysNamed('Set API_KEY, then REMOTION_AWS_ACCESS_KEY_ID and $ELEVENLABS_API_KEY', 'SKILL.md').map(x => x.service), ['AWS', 'ElevenLabs'],
    'a bare API_KEY placeholder is no account; a vendor prefix still finds AWS');
  const dir = mkdtempSync(join(tmpdir(), 'slowship-'));
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { pay: { command: 'npx', args: ['pay-mcp'],
    env: { STRIPE_SECRET_KEY: 'sk_test_inert', LOG_LEVEL: 'debug' }, headers: { Authorization: 'Bearer inert' } } } }));
  const pay = findMcpServers(dir).find(s => s.name === 'pay' && s.source.startsWith(dir));
  assert.deepEqual(pay.given, [{ name: 'STRIPE_SECRET_KEY', service: 'Stripe' }, { name: 'Authorization', service: 'pay' }]);
  assert.ok(!JSON.stringify(pay).includes('inert'), 'a key\'s value is never kept');
});

test('unpacking a tarball never writes outside the quarantine folder', async () => {
  const { untar } = await import('../src/agents.js');
  const { gzipSync } = await import('node:zlib');
  const { mkdtempSync, existsSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const entry = (name, data) => {
    const h = Buffer.alloc(512);
    h.write(name, 0); h.write('0000644\0', 100); h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('0', 156); h.write('ustar\0', 257);
    let sum = 0; h.fill(' ', 148, 156); for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return Buffer.concat([h, Buffer.from(data), Buffer.alloc((512 - data.length % 512) % 512)]);
  };
  const dest = join(mkdtempSync(join(tmpdir(), 'slowship-')), 'q');
  untar(gzipSync(Buffer.concat([entry('package/ok.js', 'ok'), entry('package/../../escape.js', 'bad'), Buffer.alloc(1024)])), dest);
  assert.equal(readFileSync(join(dest, 'ok.js'), 'utf8'), 'ok');
  assert.ok(!existsSync(join(dest, '..', 'escape.js')) && !existsSync(join(dest, '..', '..', 'escape.js')));
});

test('the morning report answers only this machine, and only JSON from its own page', async () => {
  const { serve } = await import('../src/server.js');
  const { request } = await import('node:http');
  const { once } = await import('node:events');
  const port = 47000 + Math.floor(Math.random() * 1000), server = serve(port), host = `localhost:${port}`;
  const req = (method, path, headers, body) => new Promise((ok, no) => {
    const r = request({ host: '127.0.0.1', port, method, path, headers }, res => { res.resume(); ok(res.statusCode); });
    r.on('error', no); r.end(body);
  });
  await once(server, 'listening');
  try {
    assert.equal(await req('GET', '/', { host: `evil.example:${port}` }), 403);  // DNS rebinding
    assert.equal(await req('GET', '/', { host }), 200);
    assert.equal(await req('GET', '/fonts/..%2Fserver.js', { host }), 404);
    assert.equal(await req('POST', '/api/approve', { host, origin: 'http://evil.example', 'content-type': 'application/json' }, '{}'), 403);
    assert.equal(await req('POST', '/api/approve', { host, 'content-type': 'text/plain' }, '{}'), 415);  // a plain cross-site form
  } finally { server.close(); }
});

test('code shown around a finding stays inside the item and never shows a secret', async () => {
  const { codeWindow } = await import('../src/server.js');
  const app = join(FX, 'my-electron-app');
  const w = codeWindow(app, 'main.js', 3);
  assert.ok(w && w.lines.length > 1 && w.start === 1);
  assert.ok(!JSON.stringify(w).includes('AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'), 'the full key must never be served');
  assert.equal(codeWindow(app, '../evil-pkg/index.js', 1), null);
  assert.equal(codeWindow(app, join(FX, 'evil-pkg', 'index.js'), 1), null);
});

test('the folder picker lists folders only, marks projects, and refuses relative paths', async () => {
  const { browse } = await import('../src/server.js');
  const { mkdirSync, mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const root = mkdtempSync(join(tmpdir(), 'slowship-browse-'));
  mkdirSync(join(root, 'app')); writeFileSync(join(root, 'app', 'package-lock.json'), '{}');
  mkdirSync(join(root, 'node_modules')); mkdirSync(join(root, '.git')); writeFileSync(join(root, 'secret.txt'), 'never listed');
  const b = browse(root);
  assert.deepEqual(b.entries.map(e => e.name), ['app']);
  assert.equal(b.entries[0].lock, true);
  assert.ok(!JSON.stringify(b).includes('never listed') && !JSON.stringify(b).includes('secret.txt'));
  assert.equal(browse('relative/path'), null);
  assert.ok(browse('').entries.length >= 2, 'home and at least one drive or /');
});

test('the nightly watch: quoted paths, a real time, and anything shell-like refused', async () => {
  const { windowsTask, cronLine, flagsOf } = await import('../src/schedule.js');
  const argv = ['C:/Program Files/nodejs/node.exe', 'C:/x/bin/slowship.js', 'D:/my project', ...flagsOf({ model: false, app: 'D:/build' })];
  const w = windowsTask('03:00', argv, 'D:/home');
  assert.ok(w.launcher.includes('"C:/Program Files/nodejs/node.exe" "C:/x/bin/slowship.js" "D:/my project" "--no-model" "--app" "D:/build" >> '), w.launcher);
  assert.match(w.task, /<StartBoundary>2026-01-01T03:00:00<\/StartBoundary>/);
  assert.match(w.task, /<StartWhenAvailable>true<\/StartWhenAvailable>/);
  assert.match(cronLine('23:15', ['/usr/bin/node', '/x/slowship.js', '/home/me/app'], '/home/me/.slowship'), /^15 23 \* \* \* SLOWSHIP_HOME='\/home\/me\/\.slowship' '\/usr\/bin\/node' /);
  assert.throws(() => windowsTask('3am', argv, 'D:/home'), /HH:MM/);
  assert.throws(() => windowsTask('03:00', [...argv, 'D:/a & calc'], 'D:/home'), /can't be scheduled safely/);
  assert.throws(() => cronLine('03:00', ["/x/it's"], '/h'), /can't be scheduled safely/);
});
