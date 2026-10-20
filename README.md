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
6. **Severity stays in code.** The model can raise a single fact to "worth a glance". It can never lower a hold, and a README that tells AI scanners to approve everything gets nowhere.
7. **The morning report.** One verdict, a short queue of what to look at, the real code around each finding, and an honest map of what couldn't be read.

## The morning report

`slowship ui` serves the report on `127.0.0.1` only.

- **The verdict.** It changes colour with its signal flag: yellow Q when held, Blue Peter blue when you're cleared to sail.
- **A review queue with an inspector.** For each finding, it shows what the item says it does next to what its code does, the real lines from the file with the flagged one lit, and what the model thought. Clear it and the next one comes up.
- **The cargo.** One container per thing aboard, plus your project's power signature: what its code can touch.
- **Run again.** A live view of the watch: what's being read right now, and whether rules or the model settled each item.
- **A nightly switch.** One tap and it runs every night.

Every part has an (i) button that explains it, and a short tour runs on your first visit.

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

A precision and recall evaluation against known-malicious samples is in progress (`eval/`). Numbers will appear here only once they're measured.

## What it can't see

slowship reads code; it never runs it. So:

- Code fetched or built while a program runs is invisible. It reports the capability ("downloads and runs code") but not the payload.
- Compiled programs and native addons can't be read. They're listed, not guessed at.
- Python and shell inside skills are read line by line, not with a full parser. Treat quiet there as "nothing obvious".
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
- Fonts (SIL Open Font License): [Unbounded](https://github.com/googlefonts/unbounded), [Schibsted Grotesk](https://github.com/schibsted/schibsted-grotesk) and [IBM Plex Mono](https://github.com/IBM/plex), bundled so the report makes no outside requests.

## About this project

This was built for the DEV Hacktoberfest 2026, week 3 challenge ("Slow and Steady"). The repository was started on 20 October 2026. Any commit after the deadline (25 October, 11:59 PM PDT) will be listed here.

## License

MIT
