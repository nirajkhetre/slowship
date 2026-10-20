#!/usr/bin/env node
// slowship: ship safe, slowly. Run it before you ship (or let it run overnight) and read one verdict in the morning.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { approve, scanProject } from '../src/scan.js';
import { terminal } from '../src/report.js';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? (args.splice(i, 1), true) : false; };
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };

const noModel = flag('--no-model'), json = opt('--json'), approveWhat = opt('--approve');
const onlyPackages = flag('--packages-only'), onlyAgents = flag('--agents-only'), offline = flag('--offline');
const app = opt('--app');
const [cmd = 'scan', target = '.'] = args[0] === 'scan' ? args : ['scan', ...args];
if (cmd !== 'scan' || flag('--help') || flag('-h')) {
  console.log(`slowship [dir] [--no-model] [--packages-only | --agents-only] [--offline] [--app build/] [--json out.json] [--approve <name|notable|review>]

  Checks every installed package in dir (default: here), and your AI agent's skills and MCP servers:
  does each one do what it says?
  Reads code, never runs it. Uses a local model through Ollama when it's there (SLOWSHIP_MODEL, default gemma4:e2b).
  --app checks your own build before it ships: secrets, Electron settings, source maps, .env files.
  --approve marks current results as seen, so they stop asking until the code changes.`);
  process.exit(cmd === 'scan' ? 0 : 1);
}

const project = resolve(target);
let n = 0;
const run = await scanProject(project, {
  model: !noModel, packages: !onlyAgents, agents: !onlyPackages, fetch: !offline, app: app && resolve(app),
  onItem: () => process.stderr.isTTY && process.stderr.write(`\rreading ${++n} packages…`),
});
if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');
console.log(terminal(run));
if (json) writeFileSync(json, JSON.stringify(run, null, 1));
if (approveWhat) console.log(`approved ${approve(run, approveWhat)} item(s); they won't ask again until their code changes.`);
process.exitCode = run.level === 'hold' ? 2 : 0;
