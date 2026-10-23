// Severity is decided here, in plain code, from what the code can do. The model's labels can raise attention
// ("this isn't what it says it does") but can never lower a dangerous combination: text in a README can't talk it down.
const RISK = {
  'hidden-chars': 3, conceal: 3, override: 2, obfuscated: 1,
  // your own build
  secret: 3, 'secret-maybe': 2, 'secret-public': 1, 'env-file': 2, sourcemap: 1, devtools: 1, 'open-external': 1,
  'electron-node': 2, 'electron-isolation-off': 2, 'electron-sandbox-off': 1, 'electron-websec-off': 2,
  'ipc-unchecked': 2, 'ipc-sink': 1, bridge: 0, native: 0,
  // compiled files, from their build record (binary.js)
  'built-from': 0, 'swapped-dep': 1, 'dirty-build': 1, keys: 2, inject: 2, dpapi: 1, 'fuse-node': 2, 'fuse-asar': 1,
  code: 2, exec: 2, net: 2, 'install-script': 2,
  // what opening a project runs on its own (agents.js autorunFacts): always worth a look, and again whenever it changes
  autorun: 2, 'stray-script': 1, 'autorun-allowed': 1,
  'fs-write': 1, 'env-secret': 1, 'secret-path': 1, 'persist-path': 1, 'dynamic-load': 1, imports: 0,
  decode: 0, 'fs-read': 0, fs: 0, os: 0, env: 0, url: 0,
};

// Combinations that mean more than their parts. `within` says how close the parts must be: the same function
// ('scope'), the same function or within 60 lines ('near'), one hook or task and the script it starts ('chain'),
// or anywhere in the package. In a 40,000-line bundle
// "same file" means nothing, so tightening this is what keeps big, legitimate bundles quiet.
const COMBOS = [
  { id: 'exfil', level: 3, within: 'near', needs: [['secret-path'], ['net']],
    says: 'reads credential files and sends network requests right next to it' },
  // A token from the environment next to a request is often just a CLI using its own API key, and also exactly how
  // token-stealing worms work. Code says review; it becomes hold only when the model finds it isn't the stated job.
  { id: 'token-net', level: 2, raise: true, within: 'near', needs: [['env-secret'], ['net']],
    says: 'reads a secret token from the environment and sends network requests right next to it' },
  { id: 'hidden-code', level: 3, within: 'scope', needs: [['decode', 'obfuscated'], ['code']],
    says: 'decodes hidden data and runs it as code in the same function' },
  { id: 'persistence', level: 3, within: 'near', needs: [['persist-path'], ['fs-write']],
    says: 'writes to a place that makes code start again on its own (shell profile, startup folder, SSH keys, or the files a coding agent or VS Code runs when a project opens)' },
  // ChainDrop's return path: a hook or folder-open task whose script hides its code or reaches for secrets
  { id: 'autorun-payload', level: 3, within: 'chain', needs: [['autorun'], ['obfuscated', 'code', 'secret-path', 'env-secret', 'dynamic-load', 'hidden-chars']],
    says: 'runs on its own when the project opens, and what it runs hides code, builds code at runtime or reaches for secrets' },
  { id: 'electron-open', level: 3, within: 'file', needs: [['electron-node'], ['electron-isolation-off']],
    says: 'a window with Node.js on and isolation off: any page it loads can run code on your users\' computers' },
  { id: 'ipc-open', level: 3, within: 'scope', needs: [['ipc-unchecked'], ['ipc-sink']],
    says: 'a page in your app can call this IPC handler, nothing checks who sent the message, and it starts programs, runs code or opens a computed URL' },
  { id: 'install-runs', level: 2, within: 'package', needs: [['install-script'], ['exec', 'net']],
    says: 'runs code at install time that downloads or starts programs' },
];

const LEVELS = ['info', 'notable', 'review', 'hold'];
const factKey = f => `${f.cap}|${f.detail}|${f.file}`;

/** Combinations found in the raw (uncondensed) facts: [{ combo, keys: Set of fact keys }]. */
export function combos(raw) {
  const found = [];
  for (const c of COMBOS) {
    const groups = new Map();
    for (const f of raw) {
      if (!c.needs.flat().includes(f.cap)) continue;
      const g = c.within === 'scope' ? f.scope : c.within === 'package' ? '*' : c.within === 'chain' ? f.chain ?? f.file : f.file;
      groups.has(g) ? groups.get(g).push(f) : groups.set(g, [f]);
    }
    const keys = new Set();
    for (const fs of groups.values()) {
      if (c.within !== 'near') {
        if (c.needs.every(group => fs.some(f => group.includes(f.cap)))) fs.forEach(f => keys.add(factKey(f)));
        continue;
      }
      // near: every needed part sits in the same function as, or within 60 lines of, a fact of the first part
      for (const a of fs.filter(f => c.needs[0].includes(f.cap))) {
        // line 0 is "no line" (a compiled file, a manifest): there only the same function counts as near
        const close = fs.filter(f => f.scope === a.scope || (f.line > 0 && a.line > 0 && Math.abs(f.line - a.line) <= 60));
        if (c.needs.every(group => close.some(f => group.includes(f.cap)))) close.forEach(f => keys.add(factKey(f)));
      }
    }
    if (keys.size) found.push({ combo: c, keys });
  }
  return found;
}

/** short: condensed facts (with ids); found: combos(raw); labels: {id: {label, why}} from the model (may be empty). */
export function assess(short, found, labels = {}) {
  const findings = [];
  for (const { combo, keys } of found) {
    const evidence = short.filter(f => keys.has(factKey(f))).map(f => f.id);
    const raised = combo.raise && evidence.some(id => labels[id]?.label === 'unexpected');
    findings.push({ kind: combo.id, level: raised ? 3 : combo.level, says: combo.says, evidence });
  }
  const used = new Set(findings.flatMap(f => f.evidence));
  for (const f of short) {
    if (used.has(f.id)) continue;
    const base = RISK[f.cap] ?? 0, label = labels[f.id]?.label;
    // unexpected bumps one step (a date formatter on the network); expected drops one (a fetch library on the network).
    // The model alone can reach 'review' at most: only a combination found in code can reach 'hold'.
    const level = label === 'unexpected' ? Math.max(base, Math.min(2, base + 1))
      : Math.max(0, base - (label === 'expected' ? 1 : 0));
    if (level > 0) findings.push({ kind: f.cap, level, says: f.detail, evidence: [f.id] });
  }
  for (const f of findings) {  // combos show the model's view, but it never changes their level
    const ls = f.evidence.map(id => labels[id]?.label).filter(Boolean);
    f.matches_claim = ls.length ? (ls.includes('unexpected') ? 'no' : ls.every(l => l === 'expected') ? 'yes' : 'unclear') : 'unknown';
  }
  findings.sort((a, b) => b.level - a.level);
  return { level: LEVELS[findings[0]?.level ?? 0], findings: findings.map(f => ({ ...f, level: LEVELS[f.level] })) };
}

export const risk = f => RISK[f.cap] ?? 0;
export const keysOf = found => new Set(found.flatMap(x => [...x.keys]));

export const worst = levels => LEVELS[Math.max(0, ...levels.map(l => LEVELS.indexOf(l)))];
