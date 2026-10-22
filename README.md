# slowship

**Ship safe, slowly.** A local, overnight check of everything your project brings aboard: its npm packages, your AI agent's skills and MCP servers, and your own build. For each one it asks a single question:

> **Does this do what it says it does?**

It reads the code (it never runs it), lets a small open model on your own laptop compare what the code does with what the description claims, and leaves you one verdict in the morning: **cleared to sail**, **ready after a glance**, or **held in port**, with the exact line of code behind every finding.

Nothing is uploaded. The model runs on your machine through [Ollama](https://ollama.com). The one exception is optional and off until you connect it: a morning ping to your own Discord channel or Telegram chat, with the verdict and nothing else (see below).

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
slowship                      # read the packages, skills and MCP servers, then review them right there
slowship --app dist/          # also check your own build before it ships
slowship review               # review the last watch again, in the terminal
slowship ui                   # open the morning report in the browser
slowship schedule             # do all of this every night, by itself
```

To get the model: `ollama pull gemma4:e2b`. Choose another with `SLOWSHIP_MODEL`.

## What it reads

| What | Where it looks |
|---|---|
| **Packages** | your lockfile (`package-lock.json`), so it reads what you'll actually ship |
| **Agent skills** | the skill folders that coding agents use, in your home folder and in the project (for example `~/.agents/skills` and `~/.codex/skills`), plugin folders included |
| **MCP servers** | the MCP configs of the popular coding agents and editors (Cursor, VS Code, Codex and others). `npx` servers are downloaded into a quarantine folder with scripts disabled and read there; compiled servers are read as far as their build record (see below). None are ever started |
| **Compiled files** (with [REA](https://github.com/morluto/rea)) | Go and Rust programs and .NET assemblies, whether a compiled MCP server or a `.node`, `.exe` or `.dll` inside a package: what they were built from (modules or crates and their versions, the toolchain, dependencies swapped in at build time, builds from uncommitted changes) and, for .NET, the native functions they declare (starting programs, raw network, keystroke hooks, writing into other programs, decrypting what Windows protects for the user) plus, method by method, the framework calls each method makes and the strings it loads. So a .NET method that decodes base64 and loads it as code, or names the browser's password file and posts, is held just like the same JavaScript function |
| **Your build** (`--app`) | secrets that slipped in (redacted in every output), shipped `.env` files and source maps, Electron switches like `nodeIntegration` or `contextIsolation: false`, DevTools left on, and, if REA is installed, a map of every IPC handler: which page function (`window.api.x`) reaches it, whether it checks who sent the message, and what it does. A packaged Electron executable gets its fuses read: whether it still lets anyone run it as plain Node.js, inject code through `NODE_OPTIONS`, attach a debugger with `--inspect`, or change its code after signing |

## Storm watch

Some of the worst days aren't a bad package. They're a hole in what everything runs on, like PHP2Shell (CVE-2026-109618 and CVE-2026-109619, fixed on 21 October 2026), where any PHP site could be taken over with no bug in its own code. Storm watch answers three questions about your project on a day like that:

- **Is it in this storm?** It finds what the project runs on: Dockerfile `FROM` lines, `.nvmrc`, `.tool-versions`, `engines`, `composer.json`, `go.mod`, the Gemfile, CI versions and more. Each is checked against the runtime storms slowship knows about and against the date that runtime's fixes stop (from [endoflife.date](https://endoflife.date)). A floating tag like `php:8.3-fpm` is flagged as "check your build", because it only gets the fix when you pull and rebuild.
- **Is anything aboard already named in an advisory?** Every package in your lockfile is matched against the public advisories in [OSV](https://osv.dev), malware reports included.
- **What would a takeover get?** Each finding says which keys that part of the project can read, so you know what to rotate first.

Every finding comes with the fix: the exact version to move to, plus what people forget, like rebuilding the image and restarting every PHP worker. Distros that ship a fix without changing the version number are named, so you know to check the package changelog.

The advisories are downloaded whole (`slowship storm --sync`, once) and matched on this computer, so the list of what your project uses never leaves it. After that, only what changed is fetched, at most once every 20 hours. Measured on 22 October 2026:

| | |
|---|---|
| npm advisories on this computer | 229,935 (a 35.8 MB index) |
| First download | 219 MB in 80 s, then only the index is kept |
| Next sync, nothing new | 4.8 s |
| Loading the index and matching a project | 0.7 s |
| REA's 174 dependencies | 0 in a storm |

Runtime storms are a short file in the repository (`src/storms.json`) that gets a new entry when a big one breaks.

## How it works

A funnel that goes from cheap to expensive, so a night's work stays small:

1. **Inventory.** Find everything aboard, in one pass, with no setup.
2. **Memory by content.** Every item is fingerprinted. Anything whose bytes haven't changed since last time is skipped, and anything you've cleared stays cleared until its code changes.
3. **Facts from the syntax tree.** An AST pass finds what the code can actually do: network calls, running programs, writing files, reading secrets, building code at runtime, install scripts, hidden characters. Each fact keeps its file and line.
4. **Combinations, in code.** Some pairs mean more than their parts: a credential file read next to a network call, decoding then running code in the same function, a skill that tells your agent to keep something from you, an IPC handler a page can reach that never checks the sender and starts programs or opens a computed URL. Only these can **hold** the ship.
5. **Claim against behaviour, on your laptop.** For anything worth a second opinion, the local model gets the item's own description and the short fact list (marked as untrusted data) and says, fact by fact, whether the description calls for it. It must cite fact ids that exist.
6. **Severity stays in code.** The model can move a single fact one step up or down, never past "worth a glance". Only a combination found in code can hold the ship, and the model can never lower one, so a README that tells AI scanners to approve everything gets nowhere.
7. **The morning report.** One verdict, a short queue of what to look at, the real code around each finding, and an honest map of what couldn't be read.

## In your terminal

Run `slowship` in a terminal and it draws instead of printing (no dependencies, true colour where the terminal has it):

- **The mark.** The mochi captain (pill eyes, a captain's cap, a hard sticker shadow) beside a wordmark drawn letter by letter in half blocks.
- **The watch, live.** A ship crosses a row of containers, one per thing aboard, each turning the colour of what was found; its flag flies the worst colour so far. Under it the water moves. The step it's on (find, fingerprint, read, model, verdict) is lit, with counts of what's held, worth a glance and read from memory.
- **The verdict.** A card with the headline, a wave under its accent, the whole manifest as coloured containers, and one key to press: review here, open the browser report, or done.
- **The review, full screen.** Four tabs (Review, Aboard, Keys, Blind spots), a list of cards with a rail in each one's colour, and an inspector beside it: what it says, what its code does with the real lines around each finding (the flagged one lit), the model's note, the IPC map, what compiled files are built from, and the keys it holds. `c` clears an item (it slides away; `u` brings it back), `/` searches, `f` filters by kind, `o` opens the browser report, `r` watches again, `?` shows every key. The mouse works too: click to pick, wheel to scroll. When the last one is cleared, she sails.
- **Kind to small and odd terminals.** Below 110 columns the inspector opens over the list; below 60×16 it asks for room. Esc only ever steps back; `q` quits, and the terminal is always put back as it was.

Piped, in CI, overnight, with `NO_COLOR` or with `--plain`, it prints plain text exactly as before, and the exit code is the same. `--no-motion` (or `SLOWSHIP_NO_MOTION`) keeps everything still.

## Morning ping (optional)

The overnight watch can send its verdict to where you'll see it when you wake: a Discord channel or a Telegram chat. It's off until you connect one, and only a summary ever leaves this computer: the verdict, the counts, the names of what needs you and slowship's own words for why. Never code, file paths, key names or any text a scanned package wrote. Discord mentions are switched off, so a package called `@everyone` pings nobody.

- **Discord:** a webhook you make in a channel's settings (Integrations, Webhooks, New Webhook, Copy Webhook URL). No bot to run.
- **Telegram:** a bot you make with @BotFather. Paste its token, press Start in its chat, and slowship finds where to write.

Set it up in the browser report (Settings, Morning ping): each step has a short animated film of exactly what to click, the one thing to paste, and a test you can send. Or in the terminal, with `slowship discord` or `slowship telegram`, or `/discord` and `/telegram` inside `slowship review`. The webhook or token stays in a file only you can read (`notify.json` in slowship's folder); pages and the terminal only ever see a hint.

It sends after each nightly watch. You can make it send only when something needs you, and also after watches you start; `slowship notify` shows what's connected, `slowship notify test` sends one, `slowship notify off` stops it.

## For your coding agent (optional)

Your coding agent installs packages, skills and MCP servers for you now, usually without reading them. slowship can be what it asks first. `slowship connect` prints the exact line to add slowship to your agent as a local MCP server (`slowship mcp`), with your agent's own command or in any editor's MCP settings. It also puts a short skill where your agents keep theirs, saying when to ask and what a hold means. The agent gets three tools:

- **check**, before something comes aboard. Give it an npm package, and slowship installs it into a quarantine folder with every script off and reads it with its whole dependency tree: exactly what `npm install` would bring. Or give it a downloaded skill, plugin or MCP server folder.
- **watch**, before shipping. It's the same watch as `slowship`, read from memory when nothing has changed (2.4 s on the project measured below). The run lands in `slowship review` and `slowship ui`, for you.
- **storm**, on a day like PHP2Shell. It runs Storm watch and gives back each finding with its fix, so the agent can make the change and you only have to look.

There is no tool to clear anything, on purpose. The agent is reading text a package wrote, and that text can be written to talk it into things. It's the same reason the model can't lower a hold: clearing stays with you. Answers use slowship's own words and the file and line to open, never the scanned code itself, and they say plainly that names and paths are data.

It talks over stdin and stdout, with no network port. The only download is the package you asked it to check, from npm. The model is off by default for these calls, because some agents give a tool a minute at most. Answers the nightly watch already got from the model are reused either way.

## The morning report

`slowship ui` serves the report on `127.0.0.1` only.

- **The verdict.** *Held in port*, *ready after a glance* or *cleared to sail*, with one button for what to do next. Your project is drawn as a ship in harbour, with one container per thing aboard. It stays moored while something is held, and sails out once everything is clear.
- **What it read.** Where everything came from: the project's lockfile, plus the skill folders and editor settings your AI agents use on this computer, plus your build.
- **A review list with an inspector.** For each finding, it shows what the item says it does next to what its code does, the real lines from the file with the flagged one lit, and what the model thought. For your build there is a map of how pages reach the main process, drawn as lock gates: a handler that checks its sender shuts its gate, one that doesn't lets the current run through. Compiled files get a manifest of what they were built from. Clear it and a ship takes it aboard, a painter rolls it green, and the next one comes up. Undo rewinds the scene and puts it back in the list.
- **A command bar.** One box at the top, `Ctrl K` or `⌘K` from anywhere: search everything aboard (what needs you comes first) or type what you want to do, like "run", "settings" or "connect your agent". The skipper sits beside it with the verdict on its face and a count of what's waiting.
- **A project switcher and Settings.** Switch to a recent project, or browse to any folder on this computer. Settings hold the nightly watch, what to read, your build folder, the model and the theme, and save as you change them.
- **Who can spend your money.** A ledger of every key to an outside account that your agent's skills and MCP servers read in their code, name in their instructions, or are handed in an editor's MCP config, by account (OpenAI, GitHub, ElevenLabs…), with the tools that hold each one. Agents with paid keys can run up a bill on their own. Only key names are read, never their values.
- **Everything aboard, Blind spots, How it works.** Each is a tab under the verdict, so nothing is a long scroll away. You can filter by kind or by what the code can touch, see an honest list of what couldn't be read, and watch a live run: the ship docks, a gantry scans each thing aboard, and every step from fingerprint to verdict lights up as it happens.

Colours come from signal flags and shipping containers: hot magenta marks what's held (no red anywhere), signal yellow what's worth a glance, mint what's cleared, and cobalt is slowship itself, all on sailcloth with navy ink. Everything you can press has an ink outline and sits on a hard shadow, like a hull on its waterline, and the verdict sits on a navy sea that meets the page in a moving wave. Behind the report is a live sea chart of the watch: every open finding is a shoal on it, and it sinks once you clear it. Come near one to read its name, click it to open it. A `?` next to any part explains it, and a short tour runs on your first visit.

## Measured so far

These are measured on one real project folder: the 174 dependencies of REA's own npm package, plus 77 installed skills, 1 MCP server and a deliberately risky test build. Laptop with a 6 GB GPU, `gemma4:e2b`.

| | |
|---|---|
| Things found | 275 (252 distinct) |
| Settled by rules alone | 202 |
| Same bytes as another copy, read once | 23 |
| Sent to the local model | 50, in 4 min 23 s of model time |
| Re-run with nothing changed | about 4 s |
| Code that runs, actually read | 3,827 of 3,829 files (99.95%); 454 test and example files left out on purpose |
| Compiled files read by REA | 4, about 2 to 4 s each: the MCP server (Rust, built without a crate list) and 3 native addons with no Go, Rust or .NET record |
| Who can spend your money | 9 of the agent's tools hold 18 keys to 13 outside accounts: 3 read 10 keys in their own code (one media skill alone reads keys for 6: Gemini, Google, Google Cloud, HeyGen, Hyperframes and ElevenLabs), the rest are named in their instructions |
| Verdict | held: the test build (an inert fixture with a fake key, risky Electron settings and an IPC handler that opens any URL). 10 more worth a glance, 0 holds among real packages and skills |

The model isn't repeatable bit for bit: between this run and the one before it, it moved 4 package verdicts by one step. Rules-only verdicts didn't change at all ([eval/EVAL.md](eval/EVAL.md) has more on this).

Reading compiled programs installed on the same laptop (REA 6.7.0, nothing started):

| File | What its build record says | Time |
|---|---|---|
| `ollama.exe` | Go 1.26.0, 54 modules | 1.2 s |
| `uv.exe` | Rust, 572 crates | 2.6 s |
| PowerShell's `System.Management.Automation.dll` | .NET, 62 references, 192 native imports, two flagged: `CreateProcess` and `CryptUnprotectData` | 5.6 s |
| a C++ `.node` addon (node-pty) | no record: named, not read | 3.8 s |
| VS Code's `Code.exe` (a packaged Electron app) | fuses as shipped: run as Node, `NODE_OPTIONS` and `--inspect` on, asar integrity off | 1.5 s |
| slowship's inert `test/fixtures/dotnet-loader/Loader.cs`, compiled | held twice: decode-then-load in one method, "Login Data" then a POST in another. Its update check and `Assembly.Load(name)` are left alone | 6.1 s |

### Against known malware

Measured on 200 agent skills from [MalSkillBench](https://github.com/lxyeternal/MalSkillBench) (100 malicious, 100 benign, a fixed and reproducible subset). The full write-up, every miss explained and how to rerun it are in [eval/EVAL.md](eval/EVAL.md).

| | rules only | rules + gemma4:e2b |
|---|---|---|
| **Held** | 12 of 100 malicious skills (95% range 7–20%), 2 of 100 benign | 13 malicious (8–21%), 3 benign |
| **Held or worth a glance** | 53 malicious (43–62%), 17 benign (11–26%) | 33–36 malicious (25–43% to 27–46%), 8–9 benign (4–15% to 5–16%), two runs |
| Benign npm packages flagged (REA's 174 dependencies) | 0 held, 18 worth a glance (7–16%) | 0 held, 3 worth a glance (1–5%) |

Each rate has a range it is 95% likely to sit in, because 100 samples can't pin it to the decimal. Both columns score the same 200 skills, so `node eval/run.mjs compare` also lines the runs up skill by skill: the model's changes go one way far too often to be luck (19–22 attacks let through against 2 newly caught; 9 false alarms removed against 0–1 added).

Put plainly: a hold is usually right (12 of 14, so 60–96%), but it catches about one malicious skill in eight. Most misses are attacks written as plain English in SKILL.md, or code inside a markdown code block, and slowship doesn't read those as code yet. The model cuts false alarms by half or more, and it also lets more attacks through, because those attacks come with a description written to make them look expected. Malicious npm packages haven't been measured yet.

## What it can't see

slowship reads code; it never runs it. So:

- Code fetched or built while a program runs is invisible. It reports the capability ("downloads and runs code") but not the payload.
- Compiled code isn't decompiled. With REA installed, Go and Rust files are read as far as their build record: what they were built from, not what they do. .NET is read further, method by method, unless an assembly is too big for REA's member reader (PowerShell's 13 MB engine is). C and C++ leave no record, so those are only named.
- REA's map of an Electron app is slow on very big builds: on VS Code's 6,187 files it got through 156 in 13 minutes. slowship gives it 5 minutes and says so when it gives up. A packaged app gets its fuses read, but its `app.asar` isn't mapped; point `--app` at the unpacked build for the IPC map.
- In your build, only inline IPC handler bodies are searched for what they do; a handler that hands off to a function elsewhere isn't followed.
- Python and shell inside skills are read line by line, not with a full parser. Treat quiet there as "nothing obvious".
- TypeScript isn't read yet, and code inside markdown code blocks isn't read as code.
- Instructions in SKILL.md are checked for four narrow things: hiding something from you, ignoring other instructions, downloading and running a script, and sending your data somewhere. Other prompt injection passes unnoticed.
- Files over 2 MB (usually generated bundles) are skipped and named.

**No findings is not proof of nothing.** The report says so too.

## Safety

- **It never executes scanned code.** No `require`, no install scripts, no starting MCP servers.
- **REA runs only its static readers** (`analyze-javascript-application`, `inspect-go-binary`, `inspect-rust-binary`, `inspect-managed-artifact`, `inspect-managed-native-boundaries`, `inspect-managed-members`, `inspect-electron-fuses`), with fixed arguments, a timeout and a cap on output. None of them loads or starts the file it reads.
- **No shell anywhere.** Programs are started with `execFile` and fixed arguments. Package names are validated before `npm pack`, and tarballs are unpacked by our own reader, which refuses paths that try to leave the quarantine folder.
- **The report server answers only this machine.** It checks the `Host` header (no DNS rebinding) and the `Origin`, takes JSON only, and caps request bodies.
- **Code context is safe to serve.** The code shown around a finding is read only from inside that item's own folder, and secrets are cut down before they reach the page.
- **Your agent can look, never clear.** Its three tools read and report; clearing is only in `slowship review` and `slowship ui`.
- **Nothing is uploaded.** The only network use is downloading `npx` MCP packages from npm so they can be read (`--offline` turns that off), a package your agent asks slowship to check, the public advisory files from `osv-vulnerabilities.storage.googleapis.com` (downloaded whole, so nothing about your project is sent), and the morning ping if you connect one: it talks only to `discord.com` and `api.telegram.org`, with the summary described above.
- **Key names, never values.** The "who can spend your money" ledger keeps only the names of keys an MCP config hands a server (`env` and auth headers); their values are never read into the report.

## Command reference

```text
slowship [dir] [--no-model] [--packages-only | --agents-only] [--offline] [--app build/] [--json out.json] [--approve <name|notable|review>] [--plain] [--no-motion] [--notify]
slowship review
slowship storm [dir] [--sync]
slowship discord | telegram
slowship notify [test | off [discord|telegram|all] | when needs|always | manual on|off]
slowship connect
slowship mcp
slowship ui [--port 7798] [--no-open]
slowship schedule [dir] [--at 03:00] [same flags] | --status | --off
```

The exit code is `2` when the verdict is "held", so it can gate CI. For `slowship storm` it's `2` when a storm or a known-malicious package is held. The nightly task always exits cleanly; the verdict waits in the report.

## Development

```bash
npm test
node site/record.mjs <project>   # record one real watch for the web demo (public packages + the inert fixtures only)
node site/shots.mjs              # the site's pictures: terminal output as HTML, and screenshots of a running `slowship ui`
node site/build.mjs              # build the site into site/dist: the landing page, the docs and the live demo
```

The website lives in `site/web`: the landing page (`index.html`), one file per docs page (`docs/`), and the pictures `shots.mjs` makes. The live demo at `demo/` is the real report page answered from the recording, so nothing in it touches a visitor's computer.

There are 28 tests: held fixtures, prompt injection that can't lower a hold, parser traps, path traversal, secret redaction, server guards, the folder picker, schedule quoting, the IPC map, Go and .NET build records, .NET read method by method, Electron fuses (those four from recorded REA answers), the "who can spend your money" ledger, which must never keep a key's value, the terminal review, which must fill the screen exactly at every size whatever keys and clicks arrive, and always put the terminal back, its `/` commands, and the morning ping, which must send only slowship's own words, only to Discord or Telegram, never ping anyone, and never show a page the webhook or the token, and the MCP server for your agent, which has no tool to clear anything, repeats only slowship's own words, and passes its own skill, and Storm watch, which must find what a project runs on, tell a PHP2Shell branch that's fixed from one that isn't, and match advisories without the network. `node eval/run.mjs selftest` checks the eval's unzipper and its statistics. One of them checks that recording against REA itself, so it runs only when `SLOWSHIP_REA` points at REA's `scripts/rea.mjs`. The test fixtures are inert and point at `.invalid` domains.

## Credits

- [REA](https://github.com/morluto/rea) (MIT) maps the structure of Electron builds and reads compiled Go, Rust and .NET files and Electron fuses, all without running them.
- [acorn](https://github.com/acornjs/acorn) (MIT) parses JavaScript.
- [OSV](https://osv.dev) gathers the public advisories Storm watch matches against, and [endoflife.date](https://endoflife.date) says when each runtime's fixes stop.
- [Ollama](https://ollama.com) and Google's Gemma 4 (under the Gemma terms) are the local model.
- Fonts (SIL Open Font License): [Eczar](https://github.com/rosettatype/eczar) for the verdict, printed a little off register like a riso poster, [Fraunces](https://github.com/undercasetype/Fraunces) at its softest and heaviest for headings and big numbers, [Martian Mono](https://github.com/evilmartians/mono) for counts and labels, and [Atkinson Hyperlegible Next and Mono](https://www.brailleinstitute.org/freefont/) for everything else, drawn so that 0/O and 1/l/I can't be mistaken. They're bundled, so the report makes no outside requests.

## About this project

This was built for the DEV Hacktoberfest 2026, week 3 challenge ("Slow and Steady"). The repository was started on 20 October 2026. Any commit after the deadline (25 October, 11:59 PM PDT) will be listed here.

## License

MIT
