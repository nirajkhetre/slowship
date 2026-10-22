#!/usr/bin/env node
// slowship: ship safe, slowly. Run it before you ship (or let it run overnight) and read one verdict in the morning.
// In a terminal it draws: the watch live, the verdict, and a full-screen review. Piped, in CI, overnight or with
// --plain, it prints plain text instead, exactly as before.
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { approve, scanProject } from '../src/scan.js';
import { terminal } from '../src/report.js';
import { lastRun, saveRun, serve } from '../src/server.js';
import { load } from '../src/state.js';
import { worst } from '../src/policy.js';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? (args.splice(i, 1), true) : false; };
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };

const noModel = flag('--no-model'), json = opt('--json'), approveWhat = opt('--approve');
const onlyPackages = flag('--packages-only'), onlyAgents = flag('--agents-only'), offline = flag('--offline');
const app = opt('--app'), at = opt('--at'), off = flag('--off'), status = flag('--status');
const plain = flag('--plain'); flag('--no-motion');  // read by term.caps()
const asksHelp = flag('--help') || flag('-h'), forcePing = flag('--notify'), sync = flag('--sync');
const COMMANDS = ['scan', 'ui', 'schedule', 'review', 'help', 'discord', 'telegram', 'notify', 'mcp', 'connect', 'storm'];
const [cmd = 'scan', target = '.'] = COMMANDS.includes(args[0]) ? args : ['scan', ...args];
const options = { project: resolve(target), model: !noModel, packages: !onlyAgents, agents: !onlyPackages, fetch: !offline, app: app && resolve(app) };
// drawn only where a person is watching: a real terminal both ways, colour allowed, and not asked for plain text
const drawn = !plain && process.stdout.isTTY && process.stdin.isTTY && !process.env.NO_COLOR;
const tilde = p => p.toLowerCase().startsWith(homedir().toLowerCase()) ? '~' + p.slice(homedir().length) : p;

if (cmd === 'storm') {  // Storm watch: is this project in a known storm, what a takeover would get, and the fix
  const st = await import('../src/storm.js');
  if (sync) console.log('  Fetching the public advisories (OSV). Your inventory stays here: they are matched on this computer.');
  if (sync || !offline) await refresh(sync);
  const run = await scanProject(options.project, { ...options, model: false });
  finish(run);
  console.log(st.stormText(run));
  process.exitCode = run.items.some(i => !i.approved && i.level === 'hold' && i.findings.some(f => f.kind === 'storm' || f.kind === 'malicious')) ? 2 : 0;
} else if (cmd === 'mcp') {  // for your coding agent: a local MCP server on stdin and stdout
  (await import('../src/mcp.js')).serveMcp();
} else if (cmd === 'connect') {  // how to plug that server into your agent, and its skill
  console.log((await import('../src/mcp.js')).connect());
} else if (cmd === 'ui') {  // the morning report, on this machine only
  const port = Number(opt('--port') || process.env.SLOWSHIP_PORT || 7798), url = `http://127.0.0.1:${port}/`;
  serve(port);
  console.log(`morning report: ${url}  (Ctrl+C to stop)`);
  const open = { win32: ['explorer.exe', [url]], darwin: ['open', [url]] }[process.platform] ?? ['xdg-open', [url]];
  if (!flag('--no-open')) execFile(open[0], open[1], () => {});  // no shell; a missing opener just means open it yourself
} else if (cmd === 'schedule') {  // let the system wake it every night
  const { schedule, unschedule, scheduleOf } = await import('../src/schedule.js');
  if (off) { unschedule(); console.log('the nightly watch is off.'); }
  else if (status) { const s = scheduleOf(); console.log(s ? `watching ${s.project} every night at ${s.at}. log: ${s.log}` : 'no nightly watch. turn it on with: slowship schedule [dir] [--at 03:00]'); }
  else { const s = schedule({ project: options.project, at: at || '03:00', options }); console.log(`every night at ${s.at}, slowship will read ${s.project} (or when this computer next wakes). the report waits in: slowship ui
turn it off with: slowship schedule --off`); }
} else if (cmd === 'discord' || cmd === 'telegram') {  // the morning ping: set it up
  const tui = await import('../src/tui.js');
  process.exitCode = (await tui.connect(cmd, drawn ? undefined : { depth: 0, motion: false })) ? 0 : 1;
} else if (cmd === 'notify') {  // the morning ping: see it, test it, change it, turn it off
  const n = await import('../src/notify.js'), [, what, arg] = args;
  try {
    if (what === 'test') {
      const r = await n.send(n.summary(lastRun() ?? { items: [] }, { test: true }));
      if (!Object.keys(r).length) console.log('  Nothing connected yet: slowship discord, or slowship telegram');
      for (const [p, v] of Object.entries(r)) console.log(`  ${p}: ${v.ok ? 'sent' : v.error}`);
    } else if (what === 'off') { n.off(arg || 'all'); console.log(`  The morning ping is off${arg && arg !== 'all' ? ` for ${arg}` : ''}.`); }
    else if (what === 'when') { n.prefs({ when: arg }); console.log(arg === 'needs' ? '  It sends only when something needs you.' : '  It sends after every nightly watch.'); }
    else if (what === 'manual') { n.prefs({ manual: arg === 'on' }); console.log(arg === 'on' ? '  It also sends after watches you start.' : '  It sends only after the nightly watch.'); }
    if (!what || ['when', 'manual', 'off'].includes(what)) await (await import('../src/tui.js')).pingStatus(drawn ? undefined : { depth: 0, motion: false });
  } catch (e) { console.log(`  ${e.message}`); process.exitCode = 1; }
} else if (cmd === 'help' || asksHelp) {
  if (drawn) (await import('../src/tui.js')).help();
  else console.log(`slowship [dir] [--no-model] [--packages-only | --agents-only] [--offline] [--app build/] [--json out.json] [--approve <name|notable|review>] [--plain]

  Checks every installed package in dir (default: here), and your AI agent's skills and MCP servers:
  does each one do what it says?
  Reads code, never runs it. Uses a local model through Ollama when it's there (SLOWSHIP_MODEL, default gemma4:e2b).
  --app checks your own build before it ships: secrets, Electron settings, source maps, .env files.
  --approve marks current results as seen, so they stop asking until the code changes.
  --plain prints plain text even in a terminal (it does anyway when piped, in CI, or with NO_COLOR).

slowship review             reviews the last watch in the terminal
slowship discord | telegram   sends the verdict after each nightly watch (optional: only the summary, never code, paths or keys)
slowship notify [test | off [discord|telegram|all] | when needs|always | manual on|off]
slowship storm [dir] [--sync]   Storm watch: what it runs on, known advisories matched here, what a takeover gets, the fix
slowship connect           lets your coding agent ask slowship before it installs anything (a local MCP server, slowship mcp)
slowship ui [--port 7798]   opens the morning report for the last run
slowship schedule [dir] [--at 03:00] [same flags]   reads it every night by itself (--off to stop, --status to check)`);
  process.exitCode = cmd === 'help' || asksHelp ? 0 : 1;
} else if (cmd === 'review') {
  const run = lastRun();
  if (!run) { console.log('No watch yet. Run slowship in a project first.'); process.exitCode = 1; }
  else if (!drawn) { console.log(terminal(run)); }
  else {
    const st = load();
    for (const i of run.items) i.approved = st.approved[i.key] === i.fp;
    run.level = worst(run.items.filter(i => !i.approved).map(i => i.level));
    await interactive(run, run.options ?? options);
  }
} else if (!drawn) {  // plain text: piped, in CI, overnight, or asked for
  if (!offline) await refresh();
  let n = 0;
  const run = await scanProject(options.project, {
    ...options,
    onItem: () => process.stderr.isTTY && process.stderr.write(`\rreading ${++n} packages…`),
  });
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');
  console.log(terminal(run));
  finish(run);
  const pinged = await ping(run, false);  // the nightly watch lands here: it sends, if a ping is connected
  for (const [p, v] of Object.entries(pinged ?? {})) console.log(`morning ping, ${p}: ${v.ok ? 'sent' : v.error}`);
  console.log('morning report: npx slowship ui');
  process.exitCode = run.level === 'hold' ? 2 : 0;
} else {
  const tui = await import('../src/tui.js');
  tui.banner(`Keeping watch over ${tilde(options.project)}`);
  const run = await watchOnce(tui);
  await interactive(run, options, tui, true);
}

async function ping(run, manual) { return (await import('../src/notify.js')).after(run, { manual }); }
/** Advisories: the first download only when asked (--sync); after that, what changed, at most once a day. Never fatal. */
async function refresh(force = false) {
  const st = await import('../src/storm.js'), m = st.advisoryStatus('npm');
  if (!force && (!m || Date.now() - Date.parse(m.synced) < 20 * 3600e3)) return;
  try {
    const r = await st.syncAdvisories('npm', { log: t => process.stderr.write(`  ${t}\n`) });
    console.log(`  advisories: ${r.count.toLocaleString('en')} for npm on this computer${r.changed != null ? `, ${r.changed} changed since last time` : ''}`);
  } catch (e) { console.log(`  couldn't update the advisories (${e.message}); using the copy here`); }
}
function finish(run) {
  if (json) writeFileSync(json, JSON.stringify(run, null, 1));
  saveRun(run, options);
  if (approveWhat) console.log(`approved ${approve(run, approveWhat)} item(s); they won't ask again until their code changes.`);
}
async function watchOnce(tui) {
  if (!offline) await refresh();
  const t0 = Date.now(), run = await tui.watch(scanProject, options.project, options);
  run.options = { ...options };  // the card says what was read, and from where
  finish(run);
  run.pinged = await ping(run, !forcePing);  // a watch you started sends only if you asked (or said --notify)
  tui.card(run, Date.now() - t0);
  return run;
}
/** The card's choice, then the review; r in the review watches again. Leaves the exit code: 2 while something is held. */
async function interactive(run, opts, tui, fresh = false) {
  tui ??= await import('../src/tui.js');
  let next = fresh ? await tui.choose() : 'review';
  while (next === 'review') {
    const how = await tui.review(run);
    if (how.startsWith?.('cmd:')) {  // /discord, /telegram or /notify from the review: set it up here, then back
      const what = how.slice(4);
      if (what === 'notify') await tui.pingStatus(); else await tui.connect(what);
      console.log('  ↵ back to the review    q done');
      if ((next = await tui.choose()) === 'review') continue;
      break;
    }
    if (how !== 'rerun') break;
    Object.assign(options, opts);
    run = await watchOnce(tui);
    next = await tui.choose();
  }
  if (next === 'browser') { tui.openBrowser(); console.log('  Opening the morning report in your browser…'); }
  tui.bye(run);
  process.exitCode = run.level === 'hold' ? 2 : 0;
}
