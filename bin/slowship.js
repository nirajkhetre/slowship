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
const asksHelp = flag('--help') || flag('-h');
const COMMANDS = ['scan', 'ui', 'schedule', 'review', 'help'];
const [cmd = 'scan', target = '.'] = COMMANDS.includes(args[0]) ? args : ['scan', ...args];
const options = { project: resolve(target), model: !noModel, packages: !onlyAgents, agents: !onlyPackages, fetch: !offline, app: app && resolve(app) };
// drawn only where a person is watching: a real terminal both ways, colour allowed, and not asked for plain text
const drawn = !plain && process.stdout.isTTY && process.stdin.isTTY && !process.env.NO_COLOR;
const tilde = p => p.toLowerCase().startsWith(homedir().toLowerCase()) ? '~' + p.slice(homedir().length) : p;

if (cmd === 'ui') {  // the morning report, on this machine only
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
  let n = 0;
  const run = await scanProject(options.project, {
    ...options,
    onItem: () => process.stderr.isTTY && process.stderr.write(`\rreading ${++n} packages…`),
  });
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');
  console.log(terminal(run));
  finish(run);
  console.log('morning report: npx slowship ui');
  process.exitCode = run.level === 'hold' ? 2 : 0;
} else {
  const tui = await import('../src/tui.js');
  tui.banner(`Keeping watch over ${tilde(options.project)}`);
  const run = await watchOnce(tui);
  await interactive(run, options, tui, true);
}

function finish(run) {
  if (json) writeFileSync(json, JSON.stringify(run, null, 1));
  saveRun(run, options);
  if (approveWhat) console.log(`approved ${approve(run, approveWhat)} item(s); they won't ask again until their code changes.`);
}
async function watchOnce(tui) {
  const t0 = Date.now(), run = await tui.watch(scanProject, options.project, options);
  finish(run);
  tui.card(run, Date.now() - t0);
  return run;
}
/** The card's choice, then the review; r in the review watches again. Leaves the exit code: 2 while something is held. */
async function interactive(run, opts, tui, fresh = false) {
  tui ??= await import('../src/tui.js');
  let next = fresh ? await tui.choose() : 'review';
  while (next === 'review') {
    const how = await tui.review(run);
    if (how !== 'rerun') break;
    Object.assign(options, opts);
    run = await watchOnce(tui);
    next = await tui.choose();
  }
  if (next === 'browser') { tui.openBrowser(); console.log('  Opening the morning report in your browser…'); }
  tui.bye(run);
  process.exitCode = run.level === 'hold' ? 2 : 0;
}
