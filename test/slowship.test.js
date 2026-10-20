// Rules-only checks (no model needed): run with `npm test`. Fixtures are inert and never executed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { condense, dirFacts, fileFacts } from '../src/facts.js';
import { assess, combos, keysOf, risk } from '../src/policy.js';
import { resolveServer, skillFacts } from '../src/agents.js';

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
