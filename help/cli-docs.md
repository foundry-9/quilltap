---
url: /scriptorium
---

# The Command Line and the Document Stores

Should you find yourself in possession of a terminal, a willingness to type, and a desire to interrogate your Scriptorium without going through the trouble of opening a browser, the `quilltap docs` subcommand is at your service. It exposes a parallel rear entrance to the same document stores you ordinarily curate through the Scriptorium settings page — convenient for backups, scripts, or simply for the satisfaction of confirming, with one's own eyes, that a particular file is precisely where one expects it to be.

A second arrival in the same release: the `quilltap db --mount-points` flag, which allows you to issue raw SQL against the encrypted mount-index database the way one already could with `--llm-logs`.

## Two Modes of Operation

The commands operate in one of two modes, chosen automatically depending on what you ask for:

- **Direct database access** — Listing mount points, inspecting one in detail, enumerating files, reading a file's contents, and exporting a whole mount to a directory all open the encrypted `quilltap-mount-index.db` file directly. The Quilltap server need not be running, and indeed any number of these commands may be issued against an instance whose server is taking the afternoon off.
- **Through the running server** — Triggering a rescan, writing or deleting files, creating folders, moving and copying — these need the embedding pipeline, the watchers, and the rest of the apparatus, so the CLI makes a polite HTTP request to the server (defaulting to `http://localhost:3000`; pass `--port` for a non-default arrangement). If the server cannot be reached, write commands fall back to a best-effort filesystem-only mode for filesystem-backed mounts, and politely refuse the like for database-backed mounts (where the index machinery is indispensable).

Semantic search remains, for the moment, only available through the chat interface and the API. A future arrival may add `quilltap docs search` once the embedding pipeline is plumbed into the CLI; until then, ask a character to consult their commonplace book in the usual way. For more rough-and-ready searching by filename or by literal text, see *Searching* below.

## Wherever Mount Names Appear

Anywhere a `<mount>` argument is called for, you may furnish either a name (case-insensitive, exactly as it appears in the Scriptorium) or a UUID. Should a name be ambiguous — the unfortunate fate of, say, three mounts called *Notes* — the CLI will print the candidates with their UUIDs and stand down rather than guess.

## The Subcommands

```text
# Read
quilltap docs list                                   # All mount points (table)
quilltap docs show <mount>                           # One mount, with live counts
quilltap docs files <mount> [--folder <path>]        # Files in a mount
quilltap docs ls <mount> [path] [--links]            # POSIX-flavoured listing (alias: dir)
quilltap docs read <mount> <relativePath>            # Raw bytes/text → stdout
quilltap docs read --rendered <mount> <relativePath> # Extracted plaintext → stdout
quilltap docs export <mount> <outputDir>             # Whole mount → a directory
quilltap docs scan <mount>                           # Rescan via the running server
quilltap docs find <pattern>                         # Substring search on file names (see Searching)
quilltap docs grep <pattern>                         # Substring search inside extracted text
quilltap docs status                                 # Per-mount extraction + embedding rollup

# Server-required
quilltap docs reindex <mount> [path] [--force]       # Re-extract text + re-chunk affected files
quilltap docs embed <mount> [path] [--force] [--wait]
                                                     # Enqueue embedding jobs for un-embedded chunks

# Write
quilltap docs write [--force] <mount> <path> [file]  # Stdin or file → mount
quilltap docs delete <mount> <path>                  # Idempotent file delete
quilltap docs mkdir <mount> <path>                   # Idempotent folder create
quilltap docs move <srcMount> <srcPath> <dstMount> <dstPath>           # Move (relocates the entry; no byte copy)
quilltap docs copy [--force] <srcMount> <srcPath> <dstMount> <dstPath> # Copy (independent document)
quilltap docs link <srcMount> <srcPath> <dstMount> <dstPath>           # Hard link (one document, two addresses)
```

### Hard Links, Byte Copies, and Verification

`link` is the one command that makes two addresses into **one document**. Between two database-backed mounts it adds an entry to `doc_mount_file_links` pointing at the existing content row and enrols both entries in a link group; between two filesystem mounts on the same device it calls `link(2)` and records the same grouping. Thereafter an edit through either address is an edit to both — the content row is repointed for every member of the group, and each member's chunks and embeddings are rebuilt. Cross-storage and cross-device links are refused outright rather than quietly degraded to a copy; that refusal is the entire point of `link` as against `copy`.

`move` and `copy` never establish such a relationship. `move` simply relocates the existing entry. `copy` produces a genuinely independent document, which — because the store files bytes by their fingerprint — shares a content row with its original until one side or the other is written, at which point they part company. This is also why two unrelated documents that happen to be byte-identical are not linked in any meaningful sense: they share storage, not identity.

Every write — `write`, `move`, `copy`, and `link` alike — computes a SHA-256 on both ends and refuses to declare success unless the two digests agree. Linked files match trivially; byte copies match because the bytes were faithfully transcribed.

`write` and `copy` both honour `--force`. For `write`, the flag means "overwrite the destination if it already exists." For `copy`, it additionally means "skip the shared-content path and copy bytes for real" — the end state is the same either way.

Deleting one address of a linked pair leaves the survivor an ordinary unlinked document.

### A POSIX-flavoured Listing — `ls` and `dir`

`quilltap docs ls <mount> [path]` (with the alias `dir`, for those who came up on the other side of the operating-system aisle) produces a listing arranged after the long-form `ls -l`: a type indicator, a hard-link count, the file size, the last-modified timestamp, two slim status columns (about text extraction and embedding state), and the entry's name. Folders carry a trailing slash and report `-` for the numeric/state columns, since folders in this universe are not first-class hard-link targets. Without a `[path]` argument, the listing is rooted at the top of the mount; with one, you may name either a folder (to inspect its contents) or a file (to inspect it alone).

The `links` column counts the **deliberate** hard links to the file — the other addresses of the same document, established with `docs link`. A file with a `links` of `1` stands alone. A `2` indicates one other address somewhere; a `20` indicates considerable popularity. Entries that merely share storage with an unrelated byte-identical document are not counted, since they are not links: editing one would leave the other untouched, and reporting them as links was thoroughly misleading. Pass `--links` to have the other addresses listed beneath each entry.

The `text` column describes the file's textual representation, in a single character:

| Mark | Meaning |
| --- | --- |
| `=` | The raw bytes already are the text. Markdown, plain text, JSON, and JSON-Lines all wear this badge. |
| `T` | A separate plaintext extraction is stored on the link row (for PDFs, DOCX, image descriptions, and the like). |
| `~` | An extraction is pending — the kettle is on, as it were. |
| `!` | An extraction was attempted and failed. |
| `-` | No text is available for this file, and none is needed. |

The `emb` column reports whether the file's chunks carry embedding vectors:

| Mark | Meaning |
| --- | --- |
| `Y` | Every chunk on this file has an embedding. The semantic search is well-fed. |
| `~` | Chunks exist but the embeddings are still being generated, or only some are present. |
| `-` | No chunks at all — either because the file is unindexed or because it is binary with no extracted text. |

Add `--links` to expand, beneath each multi-linked file, the inventory of its siblings: each one printed as `mountName:relativePath`, with the mount name discreetly omitted when the sibling lives in the same mount as the current listing. In JSON mode, the `links` array is always reported in full — every sibling, with mount UUID, mount name, and relative path — regardless of whether `--links` is passed; the JSON also reports `textRepresentation` and `embedding` objects with the underlying `extractionStatus`, `chunkCount`, `embeddedChunkCount`, and `fullyEmbedded` fields rather than the compact single-character marks.

#### Recursive Listing

Pass `--recursive` (or `-R`) to list every file in the mount or beneath a folder, grouped by directory:

```bash
quilltap docs ls -R "Quilltap General"              # every file, grouped
quilltap docs ls "Quilltap General" Knowledge -R    # Knowledge/* only
```

The output shows a folder header followed by the files within it, each in the same column format as a single-folder listing.

#### Sorting and Reversing

By default, `ls` sorts case-insensitively by filename. Pass `--sort` to reorder:

```bash
quilltap docs ls --sort time <mount>       # newest first
quilltap docs ls --sort size <mount>       # largest first
quilltap docs ls --sort links <mount>      # most-linked first
quilltap docs ls --sort name -r <mount>    # alphabetical, oldest to newest
```

The `-r` or `--reverse` flag flips the order. Time, size, and link count sort descending by default (newest/largest/most-linked first); name sorts ascending (A to Z). Reverse inverts either.

Sort flags work alongside `--recursive`, so you may sort a recursive listing by mtime:

```bash
quilltap docs ls -R --sort time <mount>    # all files, newest first
```

### A Tree View — `tree`

For a visual hierarchy of folders and files, `quilltap docs tree` renders an ASCII box-drawing tree:

```bash
quilltap docs tree "Quilltap General"             # whole mount
quilltap docs tree "Quilltap General" Knowledge   # Knowledge/ subtree
quilltap docs tree "Quilltap General" --depth 3   # only 3 levels deep
quilltap docs tree "Quilltap General" --json      # nested JSON structure
```

The tree shows folders first (alphabetically), then files (alphabetically) beneath each. By default it renders up to 1000 nodes; pass `--max-nodes <N>` to change the cap. When the cap is hit, a truncation message appears at the end. The `--depth` flag (default 20) limits nesting depth; even with unlimited nodes, trees deeper than about 50 tend to exceed most terminals' comfort. Both flags cap themselves at sensible maximums to prevent runaway output.

When the depth limit is reached, that level's children are still enumerated but not descended further. When the node limit is reached, the tree halts and prints a truncation message for clarity.

### Raw vs. Rendered

`docs read` outputs whatever bytes are stored — a Markdown file produces its Markdown source, a PDF produces its binary header and all that follows. `docs read --rendered` instead outputs the plaintext that was extracted for embedding: for a PDF or DOCX, that is the text the chunker actually saw; for a Markdown or plain-text file, raw and rendered are the same.

When `read` would dump binary bytes to a TTY (rather than to a file or pipe), the command politely refuses and suggests redirecting the output. Pass `--force` to override this safety net if you really do enjoy looking at raw PDF bytes scrolling across your terminal.

### Examples

```bash
# List every mount point with file/chunk counts
quilltap docs list

# Same, but in JSON suitable for jq
quilltap docs list --json

# Inspect one mount in detail (live counts cross-checked against cache)
quilltap docs show 0123abcd-...

# All files in a particular folder of a mount
quilltap docs files 0123abcd-... --folder research/2026

# A POSIX-flavoured listing of the same folder
quilltap docs ls 0123abcd-... research/2026

# … and again, expanding every multi-linked file to show its siblings
quilltap docs ls 0123abcd-... research/2026 --links

# Recursive listing of every file in the mount
quilltap docs ls -R 0123abcd-...

# Sort by modification time, newest first
quilltap docs ls --sort time 0123abcd-...

# Sort by file size, smallest first
quilltap docs ls --sort size -r 0123abcd-...

# ASCII tree view of a folder
quilltap docs tree 0123abcd-... research/2026

# Tree of the whole mount, limited to 3 levels deep
quilltap docs tree 0123abcd-... --depth 3

# Tree as JSON
quilltap docs tree 0123abcd-... --json

# Read a Markdown file
quilltap docs read 0123abcd-... notes/today.md

# Read a PDF — must be redirected
quilltap docs read 0123abcd-... papers/foo.pdf > /tmp/foo.pdf

# Read the extracted text the LLM actually saw
quilltap docs read --rendered 0123abcd-... papers/foo.pdf

# Export the entire mount to a fresh directory
quilltap docs export 0123abcd-... ~/backups/quilltap-mount-2026-04-25

# Trigger a rescan (server must be running)
quilltap docs scan 0123abcd-...

# Write a Markdown file from a local draft, refusing to overwrite
quilltap docs write notes today.md draft.md

# Same, but pipe it in from stdin (and force-overwrite)
cat draft.md | quilltap docs write --force notes today.md

# Idempotent folder creation — running twice is harmless
quilltap docs mkdir notes 2026/may

# Move a file from drafts to notes
quilltap docs move drafts foo.md notes 2026/foo.md

# Copy — an independent document from here on
quilltap docs copy notes today.md archive 2026-05/today.md
quilltap docs copy --force notes today.md archive 2026-05/today.copy.md

# Hard link — ONE document at two addresses; edit either, both change
quilltap docs link notes today.md archive 2026-05/today.md

# Idempotent delete
quilltap docs delete notes today.md
```

## Searching

For occasions when you know roughly *what* you want and only fuzzily *where* it lives, `docs find` and `docs grep` are the appropriate tools. Both are read-only — they consult the encrypted `quilltap-mount-index.db` directly, without troubling the server in the slightest.

`docs find` performs a case-insensitive substring match against the relative path of every file in scope:

```bash
quilltap docs find Manifesto                                    # every mount
quilltap docs find --mount notes --ext md Knowledge             # only one mount, .md files
quilltap docs find --type folder --mount notes "Wardrobe"       # folders only
```

`docs grep` performs the same substring match, but inside the *extracted text* of each file (for PDFs and DOCX, the plaintext stored on the link row; for Markdown and similar text-native files, the file's own bytes; for everything in between, the concatenation of chunks):

```bash
quilltap docs grep --mount notes "five-point Calvinist"         # literal, case-sensitive
quilltap docs grep --mount notes --ignore-case "calvinist"      # case-insensitive
quilltap docs grep --mount notes -l "TODO"                      # paths only, suitable for piping
quilltap docs grep --mount notes --max 1 --context 1 "TODO"     # one match per file, with surrounding lines
```

A frank confession on performance: both verbs use `LIKE` and JavaScript string searches, with no FTS5 index lurking in the background. On a Scriptorium of modest size this is perfectly comfortable; against many gigabytes of extracted text, `grep` may take a moment longer than is dignified. Should that ever become a real complaint, a future arrival will add proper full-text indexing; until then, the simplicity has its own appeal.

When `--mount` is omitted (or set to `all`), results from every mount are printed with a leading mount-name column. When you've narrowed to a single mount, the column is dropped for tidiness.

`--limit` (default 100) caps `docs find` output; `--max` (default 5) caps how many matches `docs grep` prints per file. Pass `--json` to either for the full structured object — sizes, modification times, line numbers, snippets, the lot.

### Semantic Search with `grep --semantic`

When the words you remember are not quite the words on the page — when you recall a *concept* but cannot summon the exact phrase — `docs grep` accepts a `--semantic` flag and conducts an altogether different kind of search:

```bash
quilltap docs grep --semantic "five-point Calvinist soteriology"
quilltap docs grep --semantic --mount notes --top 5 "regulative principle of worship"
quilltap docs grep --semantic --threshold 0.7 "imputed righteousness"
```

In this mode, the CLI posts the query to the running Quilltap server, which embeds the text via the configured embedding profile, performs a cosine-similarity sweep against every chunk's pre-computed vector, and returns the most similar passages ranked by score. The server is required — without it, the CLI emits a stern but courteous refusal and exits.

- `--top N` — return the top *N* matches (default 20).
- `--threshold <0..1>` — minimum cosine similarity (default 0.5). Pass a higher value when you want to be strict; pass a lower one when the matter at hand is obscure.
- `--mount <name|id>` — narrow the search to a single mount; otherwise every mount with chunks is in scope.
- `--json` — the structured object, including embedding model and dimensions, for the benefit of pipes and scripts.

Should the embedding provider have changed dimensions since the corpus was indexed (a 768-d model swapped for a 1024-d one, say), the CLI surfaces the precise dimension mismatch and points the way to `docs reindex` and `docs embed`. The literal `grep` (without `--semantic`) remains undisturbed.

## Reindexing and Embedding

Two complementary verbs exist for taking matters into one's own hands when the background pipelines lag, fail, or merely produce results one wishes to reproduce afresh.

`docs reindex <mount> [path] [--force]` re-extracts plaintext and re-chunks the files in scope. Without a `[path]`, the entire mount is in scope. With one, the scope narrows to that file (if `[path]` names a file) or to every file beneath it (if it names a folder). Without `--force`, only files whose extraction is `none`, `pending`, `failed`, or `skipped` are touched — chiefly the PDFs and DOCX that the conversion machinery has yet to digest, or that it tried and gave up on. With `--force`, every file in scope is re-extracted, even those already `converted`. The result is synchronous — when the verb returns, the work is done.

`docs embed <mount> [path] [--force] [--wait]` enqueues embedding jobs for chunks that lack an embedding vector. Without `--force`, only chunks whose `embedding IS NULL` are queued; with `--force`, every chunk in scope is queued (though the queue itself politely deduplicates anything already pending). With `--wait`, the CLI follows each job to its conclusion and reports the score; without it, the verb prints the job identifiers and returns promptly.

Both verbs require the Quilltap server to be running, because the background-job queue and the embedding pipeline both live inside the server's parent process. If the server is unavailable, the verbs refuse to do anything at all rather than risk a half-applied state.

```bash
quilltap docs reindex notes Knowledge                         # re-extract pending/failed in Knowledge/
quilltap docs reindex notes --force                           # re-extract everything in the mount
quilltap docs embed notes                                     # queue any un-embedded chunks
quilltap docs embed notes Knowledge --wait                    # queue, then wait for completion
quilltap docs embed notes --json                              # job ids in JSON
```

## Status — the Rollup View

For a glance at where every mount stands with respect to extraction and embedding, without scanning each folder by hand:

```bash
quilltap docs status                                  # all mounts
quilltap docs status --mount notes                    # only one mount
quilltap docs status --top 10                         # widen the oldest-pending / failed lists
quilltap docs status --json                           # structured output
```

Each mount block reports counts of text-native files, extracted files, files still pending extraction, files where extraction failed, plus chunk totals and embedding state. When any "pending" or "failed" rows exist, the oldest few are listed by relative path and timestamp — the same data that drives the `~` and `!` marks in `docs ls`, lifted up to instance-wide scale.

## SQL Against the Mount-Index Database

For ad-hoc queries that go beyond what `docs` exposes, point the existing `db` subcommand at the mount-index database with `--mount-points`:

```bash
quilltap db --mount-points --tables
quilltap db --mount-points "SELECT id, name, fileCount FROM doc_mount_points"
quilltap db --mount-points --repl
```

The `--data-dir` and `--passphrase` flags work identically to the standard `db` invocation. `--llm-logs` and `--mount-points` are mutually exclusive — pick one database per session.

## Common Flags

| Flag | Purpose |
| --- | --- |
| `-d, --data-dir <path>` | Use a non-default data directory |
| `-i, --instance <name>` | Use a registered instance (see `quilltap instances`) |
| `--passphrase <pass>` | Decrypt a peppered `.dbkey` file |
| `--port <number>` | Server port for write commands (default 3000) |
| `--json` | Machine-readable output |
| `--rendered` | For `read`: extracted plaintext instead of raw bytes |
| `--folder <path>` | For `files`: narrow to a folder prefix |
| `--recursive, -R` | For `ls`: list all files recursively, grouped by folder |
| `--sort name\|time\|size\|links` | For `ls`: sort by name (default), modification time, size, or hard-link count |
| `-r, --reverse` | For `ls` / `tree`: reverse the sort order |
| `--links` | For `ls` / `dir`: expand siblings under each multi-linked file |
| `--depth N` | For `tree`: maximum nesting depth (default 20) |
| `--max-nodes N` | For `tree`: maximum nodes to render (default 1000) |
| `--force` | For `read`: dump binary to TTY anyway; for `write`: overwrite; for `copy`: overwrite and force a byte copy |
| `-h, --help` | Per-subcommand help text |

## See Also

- `quilltap memories --help` — the same shape, applied to a character's memories instead of documents ([CLI: The Command Line and the Commonplace Book](cli-memories.md)).

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/scriptorium")`
