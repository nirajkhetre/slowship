# INERT TEST FIXTURE

A project shaped like what the ChainDrop worm (August 2026) left in the repositories it reached: a hook in
`.claude/settings.json` and a folder-open task in `.vscode/tasks.json`, each starting a `setup.mjs` beside it.

Nothing here does anything. The "payload" decodes to an English sentence, the network address is `example.invalid`
(which never resolves), and slowship only reads these files; it never runs them. Opening this folder by itself in an
editor that runs folder-open tasks would try to run `node .vscode/setup.mjs`, which would fail to reach anything.
