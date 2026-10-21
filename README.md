# slowship

**Ship safe, slowly.** A local, overnight check of everything your project brings aboard: its npm packages, your AI agent's skills and MCP servers, and your own build. For each one it asks a single question:

> **Does this do what it says it does?**

It reads the code (it never runs it), lets a small open model on your own laptop compare what the code does with what the description claims, and leaves you one verdict in the morning: **cleared to sail**, **ready after a glance**, or **held in port**, with the exact line of code behind every finding.

Nothing is uploaded. The model runs on your machine through [Ollama](https://ollama.com).

---

## Why

Most of us never read our dependencies, and almost nobody reads the skills and MCP servers their coding agent runs. Those are now a real supply chain:

- [Snyk's ToxicSkills study](https://snyk.io) found 13.4% of 3,984 agent skills had critical issues and 76 were confirmed malicious.
- Koi Security found 341 malicious skills out of 2,857 on ClawHub (Feb 2026).
- npm keeps getting hit by worms that publish hundreds of malicious versions in a day.

Scanners exist, but most either send your code to a cloud, start the very servers they're checking, or cry wolf until you stop reading them. slowship is built the other way round: **local, read-only, and quiet**. It says little, and shows its evidence when it does.

## Quick start

You need Node.js 22.19 or newer. Ollama with `gemma4:e2b` is optional but recommended: without it slowship runs on its rules alone and says so.

```bash
git clone https://github.com/nirajkhetre/slowship
cd slowship && npm install && npm link
```

Then, in the project you're about to ship:

```bash
slowship                      # read the packages, skills and MCP servers
slowship --app dist/          # also check your own build before it ships
slowship ui                   # open the morning report
slowship schedule             # do all of this every night, by itself
```

To get the model: `ollama pull gemma4:e2b`. Choose another with `SLOWSHIP_MODEL`.

## What it reads

| What | Where it looks |
|---|---|
| **Packages** | your lockfile (`package-lock.json`), so it reads what you'll actually ship |
| **Agent skills** | the skill folders that coding agents use, in your home folder and in the project (for example `~/.agents/skills` and `~/.codex/skills`), plugin folders included |
| **MCP servers** | the MCP configs of the popular coding agents and editors (Cursor, VS Code, Codex and others). `npx` servers are downloaded into a quarantine folder with scripts disabled and read there; they are never started |
| **Your build** (`--app`) | secrets that slipped in (redacted in every output), shipped `.env` files and source maps, Electron switches like `nodeIntegration` or `contextIsolation: false`, DevTools left on, and, if [REA](https://github.com/morluto/rea) is installed, IPC handlers that never check who sent the message |

## How it works

A funnel that goes from cheap to expensive, so a night's work stays small:

1. **Inventory.** Find everything aboard, in one pass, with no setup.
2. **Memory by content.** Every item is fingerprinted. Anything whose bytes haven't changed since last time is skipped, and anything you've cleared stays cleared until its code changes.
3. **Facts from the syntax tree.** An AST pass finds what the code can actually do: network calls, running programs, writing files, reading secrets, building code at runtime, install scripts, hidden characters. Each fact keeps its file and line.
4. **Combinations, in code.** Some pairs mean more than their parts: a credential file read next to a network call, decoding then running code in the same function, a skill that tells your agent to keep something from you. Only these can **hold** the ship.
5. **Claim against behaviour, on your laptop.** For anything worth a second opinion, the local model gets the item's own description and the short fact list (marked as untrusted data) and says, fact by fact, whether the description calls for it. It must cite fact ids that exist.
6. **Severity stays in code.** The model can move a single fact one step up or down, never past "worth a glance". Only a combination found in code can hold the ship, and the model can never lower one, so a README that tells AI scanners to approve everything gets nowhere.
7. **The morning report.** One verdict, a short queue of what to look at, the real code around each finding, and an honest map of what couldn't be read.

## The morning report

`slowship ui` serves the report on `127.0.0.1` only.

- **The verdict.** *Held in port*, *ready after a glance* or *cleared to sail*, with one button for what to do next. Your project is drawn as a ship in harbour, with one container per thing aboard. It stays moored while something is held, and sails out once everything is clear.
- **What it read.** Where everything came from: the project's lockfile, plus the skill folders and editor settings your AI agents use on this computer, plus your build.
- **A review list with an inspector.** For each finding, it shows what the item says it does next to what its code does, the real lines from the file with the flagged one lit, and what the model thought. Clear it and the next one comes up.
- **A project switcher and Settings.** Switch to a recent project, or browse to any folder on this computer. Settings hold the nightly watch, what to read, your build folder, the model and the theme, and save as you change them.
- **Everything aboard, Blind spots, How it works.** Each is a tab under the verdict, so nothing is a long scroll away. You can filter by kind or by what the code can touch, see an honest list of what couldn't be read, and watch a live run as the lighthouse sweeps the cargo.

Colours come from nautical charts: magenta marks what's held (no red anywhere), amber what's worth a glance, green what's cleared. A `?` next to any part explains it, and a short tour runs on your first visit.

## Measured so far

These are measured on one real project folder: the 174 dependencies of REA's own npm package, plus 77 installed skills, 1 MCP server and a deliberately risky test build. Laptop with a 6 GB GPU, `gemma4:e2b`.

| | |
|---|---|
| Things found | 274 (251 distinct) |
| Settled by rules alone | 200 |
| Same bytes as another copy, read once | 23 |
| Sent to the local model | 51, in 4 min 32 s of model time |
| Re-run with nothing changed | about 4 s |
| Code that runs, actually read | 3,827 of 3,828 files (99.97%); 454 test and example files left out on purpose |
| Verdict | held: the test build (an inert fixture with a fake key and risky Electron settings). 11 more worth a glance, 0 holds among real packages and skills |

### Against known malware

Measured on 200 agent skills from [MalSkillBench](https://github.com/lxyeternal/MalSkillBench) (100 malicious, 100 benign, a fixed and reproducible subset). The full write-up, every miss explained and how to rerun it are in [eval/EVAL.md](eval/EVAL.md).

| | rules only | rules + gemma4:e2b |
|---|---|---|
| **Held** | 12 of 100 malicious skills, 2 of 100 benign | 13 malicious, 3 benign |
| **Held or worth a glance** | 53 malicious, 17 benign | 33–36 malicious, 8–9 benign (two runs) |
| Benign npm packages flagged (REA's 174 dependencies) | 0 held, 18 worth a glance | 0 held, 3 worth a glance |

Put plainly: a hold is usually right (12 of 14), but it catches about one malicious skill in eight. Most misses are attacks written as plain English in SKILL.md, or code inside a markdown code block, and slowship doesn't read those as code yet. The model cuts false alarms by half or more, and it also lets more attacks through, because those attacks come with a description written to make them look expected. Malicious npm packages haven't been measured yet.

## What it can't see

slowship reads code; it never runs it. So:

- Code fetched or built while a program runs is invisible. It reports the capability ("downloads and runs code") but not the payload.
- Compiled programs and native addons can't be read. They're listed, not guessed at.
- Python and shell inside skills are read line by line, not with a full parser. Treat quiet there as "nothing obvious".
- TypeScript isn't read yet, and code inside markdown code blocks isn't read as code.
- Instructions in SKILL.md are checked for four narrow things: hiding something from you, ignoring other instructions, downloading and running a script, and sending your data somewhere. Other prompt injection passes unnoticed.
- Files over 2 MB (usually generated bundles) are skipped and named.

**No findings is not proof of nothing.** The report says so too.

## Safety

- **It never executes scanned code.** No `require`, no install scripts, no starting MCP servers.
- **No shell anywhere.** Programs are started with `execFile` and fixed arguments. Package names are validated before `npm pack`, and tarballs are unpacked by our own reader, which refuses paths that try to leave the quarantine folder.
- **The report server answers only this machine.** It checks the `Host` header (no DNS rebinding) and the `Origin`, takes JSON only, and caps request bodies.
- **Code context is safe to serve.** The code shown around a finding is read only from inside that item's own folder, and secrets are cut down before they reach the page.
- **Nothing is uploaded.** The only network use is downloading `npx` MCP packages from npm so they can be read; `--offline` turns that off.

## Command reference

```text
slowship [dir] [--no-model] [--packages-only | --agents-only] [--offline] [--app build/] [--json out.json] [--approve <name|notable|review>]
slowship ui [--port 7798] [--no-open]
slowship schedule [dir] [--at 03:00] [same flags] | --status | --off
```

The exit code is `2` when the verdict is "held", so it can gate CI. The nightly task always exits cleanly; the verdict waits in the report.

## Development

```bash
npm test
node site/record.mjs <project>   # record one real watch for the web demo (public packages + the inert fixtures only)
node site/build.mjs              # build the demo into site/dist: the real report page, answered from the recording
```

There are 14 tests: held fixtures, prompt injection that can't lower a hold, parser traps, path traversal, secret redaction, server guards and schedule quoting. The test fixtures are inert and point at `.invalid` domains.

## Credits

- [REA](https://github.com/morluto/rea) (MIT) maps the structure of Electron builds.
- [acorn](https://github.com/acornjs/acorn) (MIT) parses JavaScript.
- [Ollama](https://ollama.com) and Google's Gemma 4 (under the Gemma terms) are the local model.
- Fonts (SIL Open Font License): [Besley](https://github.com/indestructible-type/Besley) for the verdict, and [Atkinson Hyperlegible Next and Mono](https://www.brailleinstitute.org/freefont/) for everything else, drawn so that 0/O and 1/l/I can't be mistaken. They're bundled, so the report makes no outside requests.

## About this project

This was built for the DEV Hacktoberfest 2026, week 3 challenge ("Slow and Steady"). The repository was started on 20 October 2026. Any commit after the deadline (25 October, 11:59 PM PDT) will be listed here.

## License

MIT
