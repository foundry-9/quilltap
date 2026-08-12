# Release Checklist 12 — Quilltap CLI Docs, Completions & Tooling

If you have not already done so, read [CLAUDE.md](../../CLAUDE.md) for how to work in this repository.

**Goal (checklist item 12 of 13):** Verify that documentation, shell completions, and tooling for the [Quilltap CLI](../../packages/quilltap/) are up to date.

## Steps

1. See what changed in the CLI since the last release:
   ```bash
   LAST_TAG=$(git describe --tags --abbrev=0 --match '[0-9]*.[0-9]*.[0-9]*' 2>/dev/null)
   git diff --name-only "${LAST_TAG}"..HEAD -- 'packages/quilltap/**' | sort -u
   ```
2. Enumerate the CLI's current commands/subcommands and options (read `packages/quilltap/`'s command definitions, or run the help):
   ```bash
   node packages/quilltap/bin/quilltap.js --help
   ```
3. Confirm each new/changed command, flag, or subcommand is reflected in:
   - [CLI.md](../../docs/developer/CLI.md) — the full reference. Every new subcommand/flag documented, examples current.
   - **Shell completions** shipped with the CLI (look for completion scripts under `packages/quilltap/`). New commands/flags must appear there.
   - Any other CLI tooling (man pages, `--help` text, README for the package).
4. Sanity-check the CLI still runs against a real instance (read-only by default; `--write` gates changes, and per project convention it's fine to `cd packages/quilltap && npm rebuild` if you hit a better-sqlite3 ABI mismatch):
   ```bash
   node packages/quilltap/bin/quilltap.js --data-dir <instance-root> --help
   ```
5. Update CLI.md / completions / help text for anything that drifted.

## Report

List CLI changes this cycle and, for each, confirm **DOCS / COMPLETIONS / HELP** are current or note what you updated. Do not commit.
