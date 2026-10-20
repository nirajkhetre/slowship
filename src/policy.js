// Severity is decided here, in plain code, from what the code can do. The model's labels can raise attention
// ("this isn't what it says it does") but can never lower a dangerous combination: text in a README can't talk it down.
const RISK = {
  'hidden-chars': 3, obfuscated: 1, code: 2, exec: 2, net: 2, 'install-script': 2,
  'fs-write': 1, 'env-secret': 1, 'secret-path': 1, 'persist-path': 1, 'dynamic-load': 1, imports: 0,
  decode: 0, 'fs-read': 0, fs: 0, os: 0, env: 0, url: 0,
};

// Combinations that mean more than their parts. `within` says how close the parts must be: the same function
// ('scope'), the same function or within 60 lines ('near'), or anywhere in the package. In a 40,000-line bundle
// "same file" means nothing, so tightening this is what keeps big, legitimate bundles quiet.
const COMBOS = [
  { id: 'exfil', level: 3, within: 'near', needs: [['secret-path', 'env-secret'], ['net']],
    says: 'reads credentials or secrets and sends network requests from the same file' },
  { id: 'hidden-code', level: 3, within: 'scope', needs: [['decode', 'obfuscated'], ['code']],
    says: 'decodes hidden data and runs it as code in the same function' },
  { id: 'persistence', level: 3, within: 'near', needs: [['persist-path'], ['fs-write']],
    says: 'writes to a place that makes code start again on its own (shell profile, startup folder, SSH keys)' },
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
      const g = c.within === 'scope' ? f.scope : c.within === 'package' ? '*' : f.file;
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
        const close = fs.filter(f => f.scope === a.scope || Math.abs(f.line - a.line) <= 60);
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
  for (const { combo, keys } of found)
    findings.push({ kind: combo.id, level: combo.level, says: combo.says, evidence: short.filter(f => keys.has(factKey(f))).map(f => f.id) });
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
