// The morning verdict: one line on top, then only what needs you. Everything else is counted, not listed.
const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { hold: s => `\x1b[1;35m${s}\x1b[0m`, review: s => `\x1b[1;33m${s}\x1b[0m`, ok: s => `\x1b[1;32m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m` }
  : { hold: s => s, review: s => s, ok: s => s, dim: s => s, b: s => s };

const VERDICT = {
  hold: 'HOLD: something here does more than it says. Look before you ship.',
  review: 'SHIP after a quick look: a few things are worth a glance.',
  notable: 'SHIP: nothing needs you. Some packages do expected-but-notable things.',
  info: 'SHIP: nothing needs you.',
};

export function terminal(run) {
  const open = run.items.filter(i => !i.approved && (i.level === 'hold' || i.level === 'review'));
  const notable = run.items.filter(i => !i.approved && i.level === 'notable');
  const color = run.level === 'hold' ? C.hold : run.level === 'review' ? C.review : C.ok;
  const s = run.stats, lines = [];
  lines.push('', color(VERDICT[run.level] ?? VERDICT.info), '');
  for (const i of open) {
    const label = i.kind === 'npm' ? i.key.replace(/^npm:/, '') : i.kind === 'skill' ? `skill ${i.name}  ${C.dim(i.key.split('@').slice(1).join('@'))}` : i.kind === 'app' ? `your build ${i.name}`
      : i.kind === 'runtime' ? `runs on ${i.name}` : `MCP server ${i.key.replace(/^mcp:/, '')}`;
    lines.push(`${i.level === 'hold' ? C.hold('hold  ') : C.review('review')} ${C.b(label)}`);
    if (i.diff?.added?.length) lines.push(C.dim(`       new since ${i.diff.version.replace(/^npm:/, '')} you approved: ${i.diff.added.join(', ')}`));
    for (const f of i.findings.filter(f => f.level === 'hold' || f.level === 'review').slice(0, 3)) {
      lines.push(`       ${f.says}${f.matches_claim === 'no' ? C.dim('  (not what it says it does)') : ''}`);
      for (const id of f.evidence.slice(0, 2)) {
        const e = i.facts.find(x => x.id === id);
        if (e) lines.push(C.dim(`         ${e.file}:${e.line}  ${e.code.slice(0, 90)}`));
      }
      const why = f.evidence.map(id => i.facts.find(x => x.id === id)?.why).find(Boolean);
      if (why) lines.push(C.dim(`         model: ${why.slice(0, 140)}`));
      if (f.fix) lines.push(`         fix: ${f.fix}`);
    }
    if (i.blast) lines.push(C.dim(`       ${i.blast.says}`));
  }
  const skipped = run.items.reduce((n, i) => n + i.coverage.skipped.length, 0);
  lines.push('', C.dim(`${s.total} checked · ${s.cached} unchanged since last run · ${s.judged} read by ${run.model ?? 'no model (rules only)'}`
    + (s.judged ? ` in ${(s.ms / 1000).toFixed(1)}s` : '') + ` · ${notable.length} notable, not listed`
    + (skipped ? ` · ${skipped} files too large to read` : '')));
  const adv = run.storm?.advisories?.npm;
  lines.push(C.dim(adv ? `storm watch: ${adv.checked} packages matched against ${adv.count.toLocaleString('en')} public advisories on this computer, ${adv.hits} in a storm`
    : 'storm watch: public advisories not downloaded yet (slowship storm --sync, once); runtimes and end-of-life were still checked'));
  for (const u of run.unread ?? []) lines.push(C.dim(`not read: ${u.key}: ${u.why}`));
  for (const w of run.warnings ?? []) lines.push(C.dim(`note: ${w}`));
  lines.push(C.dim('Nothing found is not the same as nothing there: slowship reads code, it never runs it.'), '');
  return lines.join('\n');
}
