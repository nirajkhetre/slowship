#!/usr/bin/env node
// slowship: ship safe, slowly. Run it before you ship (or let it run overnight) and read one verdict in the morning.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { approve, scanProject } from '../src/scan.js';
import { terminal } from '../src/report.js';
import { saveRun, serve } from '../src/server.js';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? (args.splice(i, 1), true) : false; };
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };

const noModel = flag('--no-model'), json = opt('--json'), approveWhat = opt('--approve');
const onlyPackages = flag('--packages-only'), onlyAgents = flag('--agents-only'), offline = flag('--offline');
const app = opt('--app'), at = opt('--at'), off = flag('--off'), status = flag('--status');
const [cmd = 'scan', target = '.'] = ['scan', 'ui', 'schedule'].includes(args[0]) ? args : ['scan', ...args];
const options = { project: resolve(target), model: !noModel, packages: !onlyAgents, agents: !onlyPackages, fetch: !offline, app: app && resolve(app) };
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
} else if (cmd !== 'scan' || flag('--help') || flag('-h')) {
  console.log(`slowship [dir] [--no-model] [--packages-only | --agents-only] [--offline] [--app build/] [--json out.json] [--approve <name|notable|review>]

  Checks every installed package in dir (default: here), and your AI agent's skills and MCP servers:
  does each one do what it says?
  Reads code, never runs it. Uses a local model through Ollama when it's there (SLOWSHIP_MODEL, default gemma4:e2b).
  --app checks your own build before it ships: secrets, Electron settings, source maps, .env files.
  --approve marks current results as seen, so they stop asking until the code changes.

slowship ui [--port 7798]   opens the morning report for the last run
slowship schedule [dir] [--at 03:00] [same flags]   reads it every night by itself (--off to stop, --status to check)`);
  process.exit(cmd === 'scan' ? 0 : 1);
} else {

const project = options.project;
let n = 0;
const run = await scanProject(project, {
  ...options,
  onItem: () => process.stderr.isTTY && process.stderr.write(`\rreading ${++n} packages…`),
});
if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');
console.log(terminal(run));
if (json) writeFileSync(json, JSON.stringify(run, null, 1));
saveRun(run, options);
console.log('morning report: npx slowship ui');
if (approveWhat) console.log(`approved ${approve(run, approveWhat)} item(s); they won't ask again until their code changes.`);
process.exitCode = run.level === 'hold' ? 2 : 0;
}
