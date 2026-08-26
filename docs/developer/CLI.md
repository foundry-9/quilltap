# Quilltap CLI (`npx quilltap`)

The Quilltap CLI is the primary way to inspect and repair a Quilltap instance. Databases are encrypted with SQLCipher, so the standard `sqlite3` binary **cannot** open them — use this CLI instead.

**Prefer the high-level subcommands over raw SQL.** They auto-pick the right database, resolve names to UUIDs, and avoid the schema trial-and-error loop.

## Inspecting data

### Schema lookup (instead of `PRAGMA table_info`)

- `npx quilltap db schema <table>` — columns, FKs, indexes, and a link back to [DDL.md](DDL.md).
- `npx quilltap db schema --grep <text>` — search tables/columns by substring.
- `npx quilltap db schema` (no args) — grouped overview.

SQLite columns are **camelCase**, mirroring the Zod/TypeScript types (`createdAt`, `updatedAt`, `chatType`, `messageCount`, `projectId`) — **not** `snake_case`. When in doubt, run `db schema <table>` or check [DDL.md](DDL.md).

### Find by name

- `npx quilltap db find character <name>` (also `find chat`, `find project`) — fuzzy substrings and aliases; returns the UUID.

### Drill-down (no hand-written JOINs)

- `npx quilltap db chats --character <name|id>` — chats containing a character
- `npx quilltap db chats --project <name|id>` — chats in a project
- `npx quilltap db messages --chat <name|id> --last N [--full]`
- `npx quilltap db logs --chat <name|id>` / `--message <id>` / `--character <name|id>` / `--tail N`
- `npx quilltap db memories --character <name|id> [--about <name|id>] [--source AUTO|MANUAL]`
- `npx quilltap db characters status [--id <name|id>] [--diverged] [--blocked]` — per-character vault readiness (vault present, files N/8, prompt/scenario/wardrobe counts, DB-vs-vault divergence)

### Character archive (`db characters archives|archive|rehydrate|export`)

- `npx quilltap db characters archives [--json]` — list archived characters and the `ARCHIVE` bundle files on the shelf, flagging **loose** bundles (survivors of a "keep archived bundles" wipe: importable, not rehydratable). Read-only.
- `npx quilltap db characters archive <name|id> --write [--port N]` — archive a character. Runs **through the running server's API** (default port 3000): the export pipeline and the unlocked passphrase live only in the server process, so the server must be up (and it, not the CLI, holds the instance lock). `--write` is still required as the explicit opt-in.
- `npx quilltap db characters rehydrate <name|id> --write [--port N]` — wake an archived character, same transport: the server decrypts the bundle, restores the pruned material at its original ids (skip-if-present), clears the tombstone, and queues re-embedding. Reports what came back and notes that the bundle stays in the file library as a spare copy. On failure (wrong-era passphrase, missing bundle, import refusal) the character stays archived and re-running is safe.
- `npx quilltap db characters export <name|id> [--out <path>] [--port N]` — write a **plaintext** `.qtap` for a character. For an **archived** character this decrypts the bundle straight off the disk, offline (tries the internal no-passphrase key, then `QUILLTAP_DB_PASSPHRASE`, then prompts) — the only way to reach packed-away mail, photographs and summaries without rehydrating. For a **live** character it runs the server's export pipeline, so the server must be up. Read-only; no `--write`.

  **Pre-emptive, not recovery:** exporting an archive needs an instance that can still decrypt it. It does not help someone holding only a restored backup and a forgotten passphrase — which is also why a passphrase *change* rewrites every archive bundle (see the settings card's warning); a bundle reported left behind by a partial rewrite still wants the old passphrase.

### Single records

- `npx quilltap db message <id>` and `npx quilltap db log <id>` — full content/request/response.

## Maintenance + health

- `npx quilltap db optimize [target]` — VACUUM + ANALYZE + PRAGMA optimize. Refuses while the server holds the lock.
- `npx quilltap db backup [target] [--out <dir>]` — online encrypted snapshot. Safe alongside a running instance; the destination inherits the source's key. Default destination is `<dataDir>/backups/<timestamp>/`.
- `npx quilltap db integrity [target]` — `cipher_integrity_check` + `integrity_check`. Read-only. Exit 0/1/2.

## Document-store CLI (`npx quilltap docs`)

Read-only verbs: `list`, `show`, `files`, `ls`/`dir`, `tree` (ASCII folder hierarchy), `read`, `export`, `find` (substring on filename), `grep` (substring on extracted text), `status` (per-mount extraction + embedding rollup), `docker-mounts` (bind mounts filesystem stores need under Docker).

Server-required verbs: `scan`, `reindex` (re-extract + re-chunk), `embed` (enqueue embedding jobs — `--wait` polls to completion), `grep --semantic`, and the write verbs (`write`/`delete`/`mkdir`/`move`/`copy`/`link`/`rmdir`/`mvdir`). `reindex` and `embed` are explicit triggers for the two background pipelines; they refuse to run when the server is unreachable.

**`link` vs `copy`:** `docs link` makes two addresses into one document — it shares the content row *and* enrols both link rows in a `linkGroupId`, so a later write through either path repoints both and re-chunks the sibling. `docs copy` produces an independent document that merely shares a deduped content row until the first write. The `links` column in `ls` counts group members, not rows sharing a `fileId` (identical bytes are not a link). See [DDL.md](DDL.md#doc_mount_file_links).

**Semantic search:** `npx quilltap docs grep --semantic [--mount <name|id|all>] [--top N] [--threshold 0..1] <query>` runs an embedding search over indexed chunks instead of a substring match (defaults: `--top 20`, `--threshold 0.5`, `--port 3000`). It goes through `POST /api/v1/mount-points?action=semantic-search` because the embedding provider lives in the server, so the server must be up.

**Docker binds:** `npx quilltap docs docker-mounts [--format args|json]` reports the bind mounts an instance's filesystem/Obsidian stores need to be reachable inside a container. Binds are path-identical (`-v /host/vault:/host/vault`) so the `basePath` in the database resolves the same inside and out. The planner (`packages/quilltap/lib/docker-mounts.js`, pure and unit-tested) collapses stores sharing a path to one bind, drops paths nested inside another bind, **skips** non-existent paths rather than letting Docker fabricate an empty source, warns for macOS paths outside Docker Desktop's default shares and for Linux uid mismatch, and refuses on Windows (no path-identical binds). `--format args` puts only flags on stdout and all advice on stderr. `scripts/start-quilltap-docker.ts` consumes it; see [Docker startup](#docker-startup-scripts-start-quilltap-dockerts).

### Addressing documents with `qtap://` URIs

Anywhere a verb takes a positional `<mount> <relativePath>` pair (`read`, `write`, `delete`, `mkdir`, `ls`/`dir`, `tree`, `files`, `move`, `copy`, `link`, `rmdir`, `mvdir`), you may pass a single `qtap://…` URI in its place:

```
npx quilltap docs read qtap://notes/today.md
npx quilltap docs move qtap://drafts/foo.md qtap://notes/2026/foo.md
npx quilltap docs grep --mount qtap://notes/ "TODO"
```

The URI authority is matched name-first, UUID as fallback — the same rule as a bare `<mount>` (`qtap://<store name>/…` or `qtap://<uuid>/…`). Two-target verbs (`move`/`copy`/`link`/`mvdir`) accept two `qtap://` URIs or the legacy four positionals. `find`/`grep` take the URI via `--mount`.

**CLI limitation:** the CLI addresses document stores only. `qtap://self/…` needs a character context (there is none at the shell) and is rejected with guidance; `qtap://project/…` and `qtap://general/…` are likewise not CLI-addressable — pass a store name or UUID instead.

**Emitting URIs:** `--json` output for `find`, `grep`, `ls`, `files`, and `tree` carries a `uri` field per row/node. `--uri` switches the text output of `find`, `grep`, and `files` to show the canonical `qtap://` URI as the locator (name form, UUID when the store name is ambiguous).

## Docker startup (`scripts/start-quilltap-docker.ts`)

`npm run start:docker` builds and runs the container. Beyond the data-directory bind it also passes through every filesystem/Obsidian document store, so their `basePath` values resolve inside the container.

| Flag | Effect |
|---|---|
| `-i, --instance NAME` | Resolve the data dir from the instance registry, and let the CLI unlock an encrypted instance when enumerating stores |
| `--recreate` | `docker rm -f` the existing container and build a new one (the only way to change binds) |
| `--no-store-mounts` | Skip store enumeration entirely |
| `--dry-run` | Print the `docker run` argv without executing |

Store enumeration shells out to `quilltap docs docker-mounts --format json`. **A failure there is non-fatal** — it warns and starts without store binds, because an unreadable store list is a poor reason to refuse to start Quilltap. The usual cause is an encrypted instance reached by `--data-dir`; pass `--instance` instead.

Because binds are fixed at container creation, a store added later is invisible to a running container. When the container already exists, the script diffs its `.Mounts` against the current plan and names the stores that are unreachable, pointing at `--recreate`.

## Memories CLI (`npx quilltap memories`)

Read-only namespace. Verbs: `ls`, `find` (substring on summary/content), `grep` (pattern search inside content with snippets), `show <id|prefix>` (full record + related-memory neighbors), `tree <id|prefix>` (ASCII walk of the bidirectional related-memory graph with cycle handling), `status` (per-holder rollup including AUTO/MANUAL split, about-distribution, embedding presence, graph stats, dangling-edge count), `validate` (read-only health check; exit 1 on any dangling edge — `--list` prints offending source IDs and dangling targets).

Shared filter flags: `--character` (default `all`), `--about` (with `self`/`none` shortcuts), `--source`, `--chat` (with `none` for manual entries), `--project`, `--since`/`--until`, `--min-importance`/`--min-reinforced`, `--has-embedding`/`--no-embedding`.

`grep --semantic --character <name|id> [--top N] [--threshold 0..1] <query>` swaps the substring match for an embedding search via `POST /api/v1/memories?action=search` (defaults `--top 20`, `--threshold 0.5`, `--port 3000`). The server must be running, and it scopes to **one holder at a time** — `--character all` is rejected. Still read-only.

Sort flags on `ls`/`find`/`grep`: `--sort reinforced|importance|created|accessed|reinforcement-count|links`, `-r` to reverse. **Default sort is `reinforcedImportance DESC`** (what the recall path uses), not `createdAt DESC` like the legacy `db memories` verb. The legacy verb remains undisturbed.

## Logs CLI (`npx quilltap logs`)

Tail or print an instance's log files without remembering where they live. Flags: `--stream combined|error|stdout|stderr|startup` (comma-separated for multi-stream output with `[stream]` prefixes), `--tail N` (default 100; `0` = full file), `--follow`/`-f` (survives `combined.0.log`-style rotation), `--grep <pattern>` (JS regex). Resolves the logs directory via the same `--instance` / `--data-dir` plumbing the rest of the CLI uses. **Use this rather than `tail -f` on `<instance>/logs/combined.log`** — it follows across rotations and prefixes multi-stream output.

## Migrations CLI (`npx quilltap migrations`)

Read-only verbs: `status` (in-source count vs recorded-applied count vs not-yet-recorded, with retired-from-active counter), `pending` (just the not-yet-recorded list), `run --dry-run` (lists pending; refuses without `--dry-run` because the actual runner stays at startup where the loading screen lives). `--json` on all three.

Note: "not yet recorded" includes migrations whose `shouldRun()` returns `false` on this instance — the CLI does not invoke the predicate, so it cannot distinguish "would skip" from "would run."

## Maintenance sweeps (`npx quilltap maintenance`)

Runs the same retention/cleanup sweeps as the server's daily housekeeping tick, on demand. `status` is a read-only dry run that prints what *would* be reaped; `run` performs the sweep and is **lock-gated** (refuses while a live instance holds the lock). It reaps finished background jobs (`COMPLETED` older than 7 days, `DEAD` older than 30 days), closed terminal sessions older than 30 days plus their transcripts, and orphaned mount-index file rows. `--json` on both verbs. (Stale-chat asset collapse needs server machinery and only runs on the daily tick, not here.)

## Cloud-file download (`npx quilltap file-verify`)

Force-downloads an instance's cloud-evicted (dataless) database files so they are fully local before anything opens them. Instances stored in a cloud-synced folder (iCloud Drive today; OneDrive / Google Drive File Stream later) can have files evicted to dataless placeholders; opening one before the provider rehydrates it yields `file is not a database` or a partially-materialized read that wedges startup. The command reads each placeholder's bytes to nowhere, which faults it in. It needs no passphrase and never decrypts anything. Only **top-level** files of the data directory are considered (the `backups/` subdirectory is left alone). Flags: `--all` (read every top-level file, not just dataless ones), `--stall-ms <ms>` (per-chunk stall threshold — a download is abandoned after this many ms with no bytes, not a per-file deadline; default 30000), `--json`. macOS only for now (detection seam). The server runs the same pass automatically at boot, before the `.dbkey` is read; this is the manual/diagnostic twin. See `npx quilltap file-verify --help`.

## Memory extraction dry-run (`npx quilltap memory-diff <chatId>`)

Diagnostic tool: dumps a chat's existing memories and dry-runs re-extraction against it **without writing anything**, so you can compare what the extractor *would* produce now against what is stored. Needs a running server (`--port`, default 3000) to reach the extraction pipeline. `--out <dir>` sets the report destination (default: cwd); `--concurrency N` bounds parallel turns (default 4, max 32).

## Recall replay (`npx quilltap recall-replay <chatId>`)

Episodic-recall tuning harness: replays a chat turn's memory recall against the running server and prints the full candidate table twice — the pre-overhaul ranking (episodic signals inert) and the episodic ranking (retrospective flip, time-window, entity anchors, multi-probe) — including cosine, ranking blend, every multiplier that fired, the final score, and head selection. The distillation's clock is anchored to the replayed turn's own timestamp, so historical "the character forgot" turns resolve "last week" against their own date. Read-only; nothing is persisted. Flags: `--turn <n>` (1-based interchange, default last), `--char <characterId>`, `--limit <n>` (rows per path, default 25), `--port` (default 3000), `--json`. Wraps `POST /api/v1/chats/[id]?action=recall-replay`.

## Themes CLI (`npx quilltap themes`)

Manage installed theme bundles from the shell. Verbs: `list`, `install <bundle.qtap-theme>`, `validate <bundle.qtap-theme>`, `uninstall <id>`, `export <id> [--output <path>]`, `create <name>` (scaffolds via `create-quilltap-theme`), `search <query>` (across registries), `update [id]` (check for / apply updates). Registry operators also get `themes registry <list|add|remove|refresh|keygen|sign>` for managing remote registries and Ed25519 signing (`--key`/`-k`, `--name`/`-n`, `--output`/`-o`). See `npx quilltap themes --help`.

## Instances and resolution

### Named instances

Register an instance once with `npx quilltap instances add <name> <path>` (and optionally a passphrase, prompted hidden and verified against the `.dbkey` before saving); then every subcommand accepts `--instance <name>` in place of `--data-dir`. The registry lives at `~/Library/Application Support/Quilltap/instances.json` (mode 0600 enforced). See `npx quilltap instances --help`.

### Default instance

- `npx quilltap instances default <name>` — marks a registered instance as the fall-through target so flag-free `quilltap` invocations use it.
- `instances default --clear` — reverts to the OS platform default.
- `instances rename <old> <new>` — preserves the stored passphrase and updates the `*` marker.

**Resolution precedence:** `--data-dir` > `--instance` > registered default > `QUILLTAP_DATA_DIR` env > OS platform default. The default-instance hint only fires when truly falling back to the OS default (not when the registered default is honored).

### Custom data dir

`npx quilltap db --data-dir ~/iCloud/Quilltap/Friday <subcommand-or-sql>` — pass the **instance root**, not the `data/` subdirectory. The CLI appends `data/quilltap.db` itself, so `--data-dir ~/iCloud/Quilltap/Friday/data` will fail looking for `data/data/quilltap.db`.

## Read-only by default; `--write` makes changes (lock-gated)

The `db` command opens the database **read-only** unless you pass `--write`. So if you need to fix data with an `UPDATE`/`INSERT`/`DELETE`, the move is **`npx quilltap db --write "UPDATE ..."`** — *not* "the CLI can't write." A bare write fails with a hint pointing at `--write`.

`--write` opens the database read-write **only if the instance lock is free**: it claims `<dataDir>/quilltap.lock` (the same lockfile the server uses) for the duration and releases it on exit. It **refuses with no override** if a running server or another instance holds the lock — stop the server first (`npm run dev` holds the lock while it runs). `--repl` is likewise read-only unless combined with `--write` (`npx quilltap db --repl --write`).

**Never reach for `--lock-override` to work around this; it defeats the protection.**

## Low-level (still supported)

- List tables: `npx quilltap db --tables`
- Raw SQL (read-only): `npx quilltap db "SELECT COUNT(*) FROM characters;"`
- Write a change (lock-gated): `npx quilltap db --write "UPDATE characters SET title = 'rival' WHERE id = '...';"`
- Interactive REPL: `npx quilltap db --repl` (read-only; add `--write` for read-write) (plus `.cols <table>` and `.find <text>` shortcuts)
- LLM logs DB: `npx quilltap db --llm-logs --tables`
- Mount-index DB: `npx quilltap db --mount-points --tables`

## Global flags and shell completion

- All subcommands accept `--json` for piping and `--limit N` (default 50). Names are case-insensitive; ambiguous matches print all candidates and exit non-zero.
- `npx quilltap completion bash|zsh|fish` emits a completion script. Dynamic completions for `--instance` shell out to `quilltap instances list --names-only`; mount/character completions similarly use hidden `--names-only` flags. See `packages/quilltap/README.md` for per-shell install instructions.
- **Completions parse the line, they never count words.** A flag may sit anywhere the CLI itself accepts one, so `quilltap docs --instance Friday <TAB>` still offers the `docs` verbs. zsh gets this from `_arguments` positional specs — `(-)` on the top-level `'(-): :->subcommand'` / `'(-)*::arg:->args'` pair is what stops the outer `_arguments` swallowing a flag typed *after* the subcommand — and bash from a scanner that knows which flags take a value. Two traps to respect when editing the templates: `-o` is the valueless global `--open` but themes' valued `--output`, and `memories` reserves `-i` for `--ignore-case` rather than `--instance`.
- **Store names complete from the addressed instance.** Wherever a verb takes a `<mount>` (`docs ls`, `docs read`, both ends of `docs move`/`copy`/`link`, and `--mount`), bash and zsh offer live store names, re-using the `-i`/`-d`/`--passphrase` already on the line so the lookup reads the instance being addressed rather than the default one. fish completes `--mount` but not the positionals, and always reads the default instance.
- `packages/quilltap/lib/__tests__/completion-behavior.test.js` drives the bash script for real (sourcing it and reading `COMPREPLY` back) and checks the zsh template structurally. `completion-coverage.test.js` guards the surface on three levels: every subcommand in `SUBCOMMANDS` reaches `--help` and all three templates, every subcommand has its own completion arm, and **every long flag a subcommand's `--help` advertises is offered by all three templates** — the help text is the contract, so adding a flag to it without teaching the templates fails the build. It also checks bash's `vf_*` value-flag lists against zsh's `:value:` specs, since bash alone cannot infer which flags swallow the next word.

## See also

- [DDL.md](DDL.md) — full database schema and how to query it.
- [DATABASE_ENCRYPTION.md](DATABASE_ENCRYPTION.md) — SQLCipher key handling.
