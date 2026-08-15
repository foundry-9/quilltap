# Bugs — defects surfaced by the v5 port

**Last Updated**: 2026-08-14
**Codebase**: Quilltap v4.9.0-dev
**Provenance**: the quilltap-v5 native port's differential harness, its
dogfood walks against a copy of real data, and — from Bug 62 — v4's own
feature-spec work
**Status**: Bugs **1–65** are **fixed in v4**; bugs **66–67** are **open** (both filed 2026-08-14 by the v5 port's help-drift round — 66 from the archive beats' live run, 67 from the composer-toolbar lane's send-path survey). Bug 65
(filed and fixed 2026-08-13, noticed while verifying bug 64 on a fresh
instance): the version guard had been silently inert since 2026-08-12.
`version-guard.ts` reached into `migrations/lib/database-utils` with a
synchronous `require()`, and that module became an **async module** in
Turbopack's graph when the bug 58 fix added a static `instance-lock` import to
it — a sync `require()` of an async module returns an exports object that is
never populated, so every call threw `isSQLiteBackend is not a function` into a
catch that allowed startup anyway. `highest_app_version` was never stored and
`minServerVersion` never reached `.dbkey`, so an older binary would open a
newer database without complaint. Both functions are now `async` and use
`await import`; failures are announced through the migration-warnings channel
instead of dying in the log; a `no-restricted-syntax` rule fails the build on
the next sync `require` of `migrations/` from app code; and the tests assert
the *effect* rather than the absence of a throw. Bug 64
(filed and fixed 2026-08-13, from dogfooding a fresh Docker instance):
first-run encryption setup closed the main SQLite client out-of-band, but the
backend and manager singletons kept the dead handle cached — every repository
call failed with `The database connection is not open` until the process was
restarted. Teardown now runs through new `suspendDatabase()` /
`resumeDatabase()` chokepoints that recycle every handle while keeping the
backend instance (a rebuilt backend would drop the `ensureCollection` column
maps that live repositories never re-register), all three databases are
converted, and auto-lock got the same treatment. Bug
63 (filed and fixed 2026-08-13): text replacements fired inside fenced code
blocks and inline code; both the replacement plugin and the emoji typeahead
now share a `$isInCodeContext` guard. Bug 62 (filed and fixed
2026-08-13): the fallback roleplay dialogue pattern and dialogue detection both
spelled their "straight and curly" quote sets with the straight quote
duplicated, so curly-quoted dialogue had never been highlighted in any chat that
falls through to the defaults. Found while spec'ing
[composer-smart-typography](features/composer-smart-typography.md), which curls
quotes upstream of the roleplay layer and was therefore blocked on it; that
spec is now **unblocked**. Both defaults now carry the real curly code points
as `“` / `”` escapes, with fallback-path regression coverage on the
server *and* client renderers. Bug 61 (filed and fixed
2026-08-12 by the v5 port while deflaking its wardrobe e2e walk: an outfit edit
staged in the in-chat Wardrobe dialog before the worn snapshot arrives was
discarded, and the dialog closed as though it saved) is fixed by recording the
pre-snapshot gestures and **replaying them onto the snapshot** when it lands —
preserving the staged slots alone would have committed a hat and nothing else —
plus a flush that tells "nothing changed" from "we never learned what clean
was". It is **Owed** to the v5 side as a drift catch-up. Bug 57 (filed and
fixed 2026-08-11 by the v5 port's round-2 unification: the preserveIds preflight
refused a rehydrate bundle whose store carries one blob linked at two paths —
the per-link export duplication meeting an undeduped `carriedBlobIds`) converges
v4 onto the dedupe v5 had been carrying as a pinned divergence. Bug 56 came out of
dogfooding under Docker: folder creation in a filesystem store ran a recursive
`mkdir` without first checking the store's own base path existed. Bugs 52–55 all
came out of the character-archive work: 52 (cross-instance character imports
lost the vault and dangled the avatar id) was fixed 2026-08-10 by WP A2's
vault-carrying export; 53 (reconciliation clobbering and deleting archive
bundle rows), 54 (rehydrate refusing any character who shared a content row
with another vault) and 55 (a file row that outlived its bytes serving 500
instead of 404) were all found and fixed the same day, 54 and 55 by dogfooding
the merged feature on real data. Bug 51 (chat GET omitting
impersonation state, so a reload showed an impersonated seat as not impersonated)
was found and fixed 2026-08-08 while verifying Bug 50. Bugs 47–49 — the Brahma Console
giving up silently when its turn budget is exhausted, and two sibling
impersonation turn/speaking-as facets (impersonating does not hand the character
the current turn; the speaking-as seat does not follow the current user-driven
turn), all surfaced on the 2026-08-08 v5 dogfood walk — were fixed 2026-08-08.
Bug 50 (found the same day dogfooding a real roleplay: with two user-driven seats
and a single LLM, that LLM answered every human turn) was fixed 2026-08-08 too.
Each is **Owed** to the v5 side as a drift catch-up (the fixes move the oracle
baseline; Bug 47 also retires `dogfood-findings.md` #73).

**This page is the index.** Every bug lives in its own file under
[`bugs/`](bugs/); what stays here is the [Status](#status) table that points at
them and the cross-cutting v5-coordination notes.

---

## How these are filed

- **One bug, one file.** An open bug is
  `docs/developer/bugs/bug-<n>-<short-title>.md`; once its fix has landed in v4
  the same file moves to `docs/developer/bugs/fixed/`. `<short-title>` is a two-
  or three-word dashed description of the *problem*
  (`bug-9-store-delete-orphans.md`), enough to tell the files apart in a
  directory listing.
- **Numbers are permanent and sequential.** A bug keeps its number forever,
  including when it moves into `fixed/`. A new bug takes the next unused number.
- **Every file opens with a metadata table** — Status, Found, Fixed, Severity,
  Who it bites, Provenance, Fix site, v5 status, and a link back to this index —
  followed by the entry proper: symptom, root cause with file and line, why it
  survived, the fix, and how to verify it.
- **The [Status](#status) table here is the register.** Filing a new bug means
  writing the file *and* adding its row. Fixing one means `git mv`-ing the file
  into `fixed/`, filling in the Fixed date, fix site and v5 status in **both**
  the file's metadata table and its row here, and leaving a
  **`FIXED in v4 (date)`** paragraph at the top of the entry as the account of
  what was actually done.
- **Nothing is deleted.** Fixed entries keep their full root-cause write-up —
  they are the record of why the code looks the way it does, and the v5 port
  reads them.

---

## What this file is

The v5 port runs every ported unit against v4's **real** `lib/` code and diffs
the results field by field. That process occasionally finds a defect in v4
itself — a case where v5 and v4 disagree and **v4 is the one that is wrong**.

Those are recorded here with a fix plan — **one file per bug**, indexed by the
[Status](#status) table below. Each entry states the symptom, the root cause
with file and line, why it survived this long, the fix, and how to verify it.

**These are bugs, not preferences.** They are distinct from the port's much
longer list of *v4-faithful papercuts*, where v5 reproduces a v4 annoyance
exactly and any change is a product decision to be made in v4 first. That list
lives in the v5 repo (`docs/developer/porting/dogfood-findings.md`, "post-5.0
product improvements"). Nothing here is a matter of taste.

**Scope note:** this file was opened to plan the fix for **Bug 4** (the 3 MB
import bug). Bugs 1–3 come from the same audit, are listed first because they
are more urgent, and are included so the backup/restore family can be fixed in
one pass rather than three.

**Fix plan (historical):** bugs 8–43 were batched into nine session-sized,
dependency-ordered specs under [bugfix-sessions/](bugfix-sessions/README.md).
All nine have been executed; the specs are kept for the record.

---

## Provenance — Pinned, Faithful, Inert

Bugs 8 onward were surfaced by the port **after** Bugs 1–7 were fixed. The same
discipline applies throughout this catalogue: these are **bugs, not
preferences** — cases where v5 and v4 disagree and v4 is wrong, or
where v4 carries dead/broken code that silently does nothing (or the wrong
thing). The purely-taste items (a colour you'd prefer, a default you'd change)
are **not** here; they live on the v5 repo's "post-5.0 product improvements
(v4-first)" list.

Provenance is mixed. Many come from the differential harness *and are pinned in
both directions* — v5 has already taken the fix, and a v5 test asserts both "v5
is right" and "v4 is still wrong", so the day v4 converges the pin trips and
tells the v5 side to retire it. Those are flagged **Pinned**. Others were found
only by a human dogfooding real data (the harness cannot find a bug v5 reproduces
faithfully); those are flagged **Faithful** — v5 mirrors the defect exactly, so
the two sides must move together when v4 is fixed. A handful are **Inert**: dead
or unreachable code in v4 that costs no user anything today, recorded only so a
future reader does not "correct" the faithful port toward v4's broken original.

> **The coordination rule from Bugs 1–7 still holds.** A `lib/` fix here moves
> the v5 oracle baseline and obliges a v5 drift-catch-up. Land these when the v5
> side is between rounds, and expect the named tripwires to fire — a red
> differential after an upstream fix is the tripwire *working*, not a regression.

---

## The constraint that shapes the sequencing

**v4 is the oracle for the v5 port.** The port pins an oracle baseline commit
and regenerates its fixtures from it; changing v4's `lib/` moves that baseline
mid-flight and obliges a v5 drift-catch-up round.

Consequences:

- **Do not land these quietly.** Coordinate with the v5 side: a `lib/` change
  here is drift debt there. (A docs-only commit — including this file — is not:
  the port dispositions docs-only v4 commits as no-debt.)
- **Fixing v4 will turn parts of the v5 harness RED, by design.** v5 already
  diverges from v4 on all four bugs, and those divergences are asserted in
  **both** directions so that an upstream fix cannot pass unnoticed. When these
  land, the v5 side must retire the corresponding tripwires:

  | v4 fix | v5 tripwire that fires | Expected message |
  |---|---|---|
  | Bugs 1–3 | `crates/quilltap-harness/tests/system_restore_state.rs` → `assert_divergences` | *"v4 restored N rows from an archive that carries them — the v4 bug this differential pins has been FIXED upstream; re-rule the divergence"* |
  | Bug 4 | `crates/quilltap-harness/tests/system_import_equivalence.rs` → `EXPECTED_DIVERGENCES` | the `throw_ndjson_truncated_blob` case stops diverging; remove it from the list |

  A red differential after these land is **the tripwire working**, not a
  regression. The v5 work is to delete the divergence entries and let the cases
  become plain equalities.

**Suggested order:** one branch, bugs 1–3 in a single commit (they are one
repair), bug 4 in a second. Land both at a point where the v5 side is between
rounds, so the baseline moves once.

---

## Status

One row per bug, newest last. **Bug** links to the entry; **Fix site** and
**v5** are abbreviated — each bug's own file carries them in full.

| # | Bug | Found | Fixed | Severity | What goes wrong | Fix site | v5 |
|---|---|---|---|---|---|---|---|
| 1 | [restore rejects every mount point and file link](bugs/fixed/bug-1-restore-rejects-mount-points.md) | 2026-07-26 | 2026-07-26 | **Critical** | Restore rejects every `doc_mount_points` and `doc_mount_file_links` row — character vaults, project stores and group stores all come back **unreachable** | `lib/backup/restore/mount-index-coercion.ts` +1 more | Converged |
| 2 | [restore looks for files under the wrong format number](bugs/fixed/bug-2-wrong-backup-format-gate.md) | 2026-07-26 | 2026-07-26 | **Critical** | Restore looks for user files under `backupFormat === 2`, but modern manifests declare `4` — **no user file is restored** | `lib/backup/restore/archive.ts:333` | Converged |
| 3 | [the files phase runs before anything can receive the bytes](bugs/fixed/bug-3-files-phase-ordering.md) | 2026-07-26 | 2026-07-26 | **Critical** | Restore runs the files phase (5) before the stores that must receive the bytes exist (13 / 22a) — so **even with Bug 2 fixed, no file lands** | `lib/backup/restore/restore.ts` | Converged |
| 4 | [import cannot read its own export of a blob over 3 MB](bugs/fixed/bug-4-large-blob-import.md) | 2026-07-26 | 2026-07-26 | High | Import cannot read v4's own export of a document-store blob larger than **3 MB** — silent truncation, then a hard failure | `lib/import/quilltap-import-stream.ts:284` | Converged |
| 5 | [a composer run consults the wrong character's fact sheet](bugs/fixed/bug-5-wrong-character-fact-sheet.md) | 2026-07-27 | 2026-07-27 | Medium | A custom tool run from the composer tests **the first participant's** fact sheet, not the operator's own character — so metadata gates and `$state` group scope resolve as the wrong character | `app/api/v1/chats/[id]/custom-tools/route.ts` | Owed |
| 6 | [the reconcile and the cold-tier sweep fight, re-embedding the cold tier on every boot](bugs/fixed/bug-6-cold-tier-re-embedding.md) | 2026-07-28 | 2026-07-28 | High | The startup render/embed reconcile reads deliberately **cold-tiered** chats as damage and re-embeds the entire cold tier on every boot — which the next maintenance sweep clears again, forever | `lib/startup/reconcile-conversation-rendering.ts` +3 more | Inherit the fixed semantics when the reconcile is ported |
| 7 | [embedding outcomes never land: the mark methods no-op without a row nobody creates](bugs/fixed/bug-7-embedding-marks-no-op.md) | 2026-07-28 | 2026-07-28 | High | `embeddingStatus.markAsEmbedded` / `markAsFailed` are find-then-update and **silently no-op** when no status row exists — and nothing creates status rows anymore, so every embedding outcome is dropped; downstream, the reconcile keeps re-attempting permanently-unembeddable (>8k-token) chunks every boot | `lib/database/repositories/embedding-status.repository.ts` +2 more | Inherit the fixed semantics |
| 8 | [a corrupt `properties.json` is silently overwritten, losing six fields](bugs/fixed/bug-8-corrupt-properties-overwrite.md) | 2026-08-06 | 2026-08-06 | **Critical** (silent data loss) | A character's `properties.json`, if present-but-unparseable, is **silently and permanently overwritten** with defaults on the next save — six fields lost | `lib/database/repositories/vault-overlay/vault-readers.ts` +1 more | Owed |
| 9 | [deleting a document store leaves orphaned rows](bugs/fixed/bug-9-store-delete-orphans.md) | 2026-08-06 | 2026-08-06 | **High** | Deleting a document store leaves **orphaned** link/folder/document rows (non-atomic, dead delete steps, group-links never touched) — later restores fail with `FOREIGN KEY constraint failed` | `lib/mount-index/delete-store-cascade.ts` +4 more | Owed |
| 10 | [`conversation_annotations` is wiped by no delete path](bugs/fixed/bug-10-annotations-never-deleted.md) | 2026-08-06 | 2026-08-06 | **High** | `conversation_annotations` is wiped by **no delete path at all** — a privacy leak on delete-all, and `UNIQUE constraint failed` on restore into a migrated instance | `lib/backup/restore/delete-service.ts` +1 more | Owed |
| 11 | [`.qtap` import overwrite mishandles store identity three ways](bugs/fixed/bug-11-import-store-identity.md) | 2026-08-06 | 2026-08-06 | **High** | `.qtap` import overwrite: folders not cleared (stale husks), store matched by **name** (a rename misdirects it), and create mints a **fresh id** (no archive is ever re-recognised) | `lib/import/quilltap-import/import-document-stores.ts` | Owed |
| 12 | [a second-generation restore loses archived link ids](bugs/fixed/bug-12-second-generation-restore.md) | 2026-08-06 | 2026-08-06 | Medium | Restoring a **second-generation** archive loses the archived link ids and re-duplicates store rows every generation | `lib/backup/restore/carried-store-rows.ts` +1 more | Owed |
| 13 | [`gcOrphanedFileRow` throws on a mount index without the blobs table](bugs/fixed/bug-13-missing-blobs-table.md) | 2026-08-06 | 2026-08-06 | **High** (crash on 2nd write) | `gcOrphanedFileRow` issues an unconditional `DELETE FROM doc_mount_blobs` and **throws `no such table`** on any mount index that predates the lazily-created blobs table | `lib/database/repositories/doc-mount-file-links.repository.ts` | Owed (Faithful) |
| 14 | [an entity export is 99.7% regenerable embeddings](bugs/fixed/bug-14-export-embedding-bloat.md) | 2026-08-06 | 2026-08-06 | High | A single entity export is **99.7% embeddings** — the real characters `.qtap` is 789.6 MB of regenerable vectors | `lib/export/ndjson-writer.ts` +1 more | Owed (Faithful) |
| 15 | [`reindexLinkGroupSiblings` is dead code; hard-linked siblings serve stale chunks](bugs/fixed/bug-15-stale-hardlink-siblings.md) | 2026-08-06 | 2026-08-06 | Medium | `reindexLinkGroupSiblings` is **dead code** (`queryJoined` never selects `linkGroupId`) — editing a hard-linked file leaves its siblings serving **stale chunks** to search and context | `lib/database/repositories/doc-mount-file-links.repository.ts` | Owed |
| 16 | [the dimension reconcile counts mount chunks from the wrong database](bugs/fixed/bug-16-wrong-database-chunk-count.md) | 2026-08-06 | 2026-08-06 | Low | `countNonconformingMountChunks` reads `doc_mount_points` from the **wrong database**, always returns 0 — the dimension reconcile never notices non-conforming mount chunks | `lib/startup/reconcile-embedding-dimensions.ts` | Owed |
| 17 | [oversize conversation chunks can never embed](bugs/fixed/bug-17-oversize-conversation-chunks.md) | 2026-08-06 | 2026-08-06 | Medium | 515 conversation chunks are **too large to ever embed** and re-fail every boot — the renderer has no interchange sub-chunking | `lib/scriptorium/markdown-renderer.ts` +1 more | Owed (Faithful) |
| 18 | [a whitespace-only help file wipes the whole `help_docs` table](bugs/fixed/bug-18-help-docs-wipe.md) | 2026-08-06 | 2026-08-06 | Medium (latent) | A `help/` directory whose only file is **whitespace-only** wipes the **entire** `help_docs` table | `lib/help/help-doc-sync.ts` | Owed |
| 19 | [the `permanentlyFailed` embedding census is structurally always zero](bugs/fixed/bug-19-permanently-failed-census.md) | 2026-08-06 | 2026-08-06 | Low (broken diagnostic) | The `permanentlyFailed` embedding census filters `status === 'PERMANENTLY_FAILED'`, a value the enum can never hold — **structurally always 0** | `lib/tools/almanack/phase3-ledgers.ts` | Owed (Faithful) |
| 20 | [Almanack "Cast sizes" histogram groups by the raw JSON column](bugs/fixed/bug-20-cast-sizes-histogram.md) | 2026-08-06 | 2026-08-06 | Low | Almanack "Cast sizes" histogram `GROUP BY`s the raw JSON column, so it lists one row per chat instead of per cast size | `lib/tools/almanack/phase3-ledgers.ts` | `reconcile_ledger_divergences` self-retires now that v4's histogram is no longer per-cast |
| 21 | [Almanack wardrobe-permission counts under-report](bugs/fixed/bug-21-wardrobe-permission-counts.md) | 2026-08-06 | 2026-08-06 | Low | Almanack wardrobe-permission counts test `= 1` where the runtime permission is `!== false` (NULL = allowed) — **under-reports** | `lib/tools/almanack/phase3-ledgers.ts` | `reconcile_ledger_divergences` self-retires |
| 22 | [chat GET omits four controlled-select fields](bugs/fixed/bug-22-chat-get-missing-fields.md) | 2026-08-06 | 2026-08-06 | Medium | Chat GET **omits four controlled-select fields** (Story's Clock, lantern-image alerts, show-thinking, answer-confirmation override) — the select reverts to default after a successful save and never survives a reload | `app/api/v1/chats/[id]/handlers/get.ts` | Owed (Faithful) |
| 23 | [a `controlledBy` patch returns early, skipping the identity recompile](bugs/fixed/bug-23-controlled-by-early-return.md) | 2026-08-06 | 2026-08-06 | Medium | A participant patch carrying `controlledBy` **returns early**, making `compileAllIdentityStacks` and the status/`isActive` sync below it dead code | `app/api/v1/chats/[id]/helpers.ts` | Owed (Faithful) |
| 24 | [`remove-participant` returns a stale chat](bugs/fixed/bug-24-stale-chat-response.md) | 2026-08-06 | 2026-08-06 | Low | `remove-participant` returns a **stale chat** — the response still shows the removed participant as impersonating | `app/api/v1/chats/[id]/actions/participants.ts` | Owed (Faithful) |
| 25 | ["stop impersonating" is unreachable from v4's own client](bugs/fixed/bug-25-stop-impersonate-unreachable.md) | 2026-08-06 | 2026-08-06 | Medium | "Stop impersonating" is **unreachable from v4's own client**: the client sends `DELETE`, the action is registered only on `POST` | `app/api/v1/chats/[id]/handlers/delete.ts` | Converged |
| 26 | [`INSERT_RELATED` clobbers the related-memory links it just wrote](bugs/fixed/bug-26-related-memory-clobber.md) | 2026-08-06 | 2026-08-06 | Medium | On `INSERT_RELATED`, the fold pass starts `relatedMemoryIds` from `[]` and **clobbers** the links the gate just wrote | `lib/memory/memory-service.ts` +1 more | Owed (Faithful) |
| 27 | ["Speak as an AI character" is a dead affordance](bugs/fixed/bug-27-speak-as-dead-affordance.md) | 2026-08-06 | 2026-08-06 | Medium | "Speak as &lt;AI character&gt;" flips a badge but the **next message still lands as your own character** — a dead affordance | `app/api/v1/chats/[id]/actions/participants.ts` | Owed (Faithful) |
| 28 | [a Staff-signed ad-hoc announcement reaches the model anonymous](bugs/fixed/bug-28-anonymous-staff-announcement.md) | 2026-08-06 | 2026-08-06 | Medium | A **Staff-signed** ad-hoc announcement reaches the model **anonymous** — the exact anonymous block the attribution feature exists to abolish | `lib/chat/context/announcement-attribution.ts` | Owed (Faithful, both apps — it is a bug in v5 too) |
| 29 | [a user-initiated tool card wears the last speaker's face](bugs/fixed/bug-29-tool-card-wrong-face.md) | 2026-08-06 | 2026-08-06 | Medium | A **user-initiated** tool card is headed with the **last speaker's face and name** | `app/salon/[id]/group-tool-messages.ts` | Owed (Faithful) |
| 30 | ["whispered to unknown" for a user-initiated private run](bugs/fixed/bug-30-whispered-to-unknown.md) | 2026-08-06 | 2026-08-06 | Low | A user-initiated private run renders "**whispered to unknown**" instead of the operator's name | `app/salon/[id]/whisper-visibility.ts` | Owed (Faithful) |
| 31 | [OpenRouter's non-streaming path refuses vision sends](bugs/fixed/bug-31-openrouter-vision-refusal.md) | 2026-08-06 | 2026-08-06 | Medium | OpenRouter's **non-streaming** SDK path refuses vision messages at input validation — v4 sends **no image at all** on regenerate/continuation legs | `plugins/dist/qtap-plugin-openrouter/provider.ts` | Owed |
| 32 | [a stale client capability map hides OpenRouter vision](bugs/fixed/bug-32-stale-capability-map.md) | 2026-08-06 | 2026-08-06 | Low | `lib/llm/attachment-support.ts`'s hardcoded map says **OpenRouter can't do vision** while the plugin emits image parts | `lib/llm/attachment-support.ts` | Owed |
| 33 | [Grok's text and PDF attachment branches are dead code](bugs/fixed/bug-33-grok-attachment-gate.md) | 2026-08-06 | 2026-08-06 | Low | Grok's **text/\*** and **PDF** attachment branches are **dead code** (an images-only mime gate runs first) — Grok always answers "Unsupported file type" | `plugins/dist/qtap-plugin-grok/provider.ts` +1 more | Owed (Faithful) |
| 34 | [a dead base64 `catch` ships text attachments as mojibake](bugs/fixed/bug-34-base64-text-mojibake.md) | 2026-08-06 | 2026-08-06 | Low | The Anthropic/Grok text-document base64 `catch` is **dead** (`Buffer.from` never throws) — a newline-free base64-charset text attachment ships as **mojibake** | `plugins/dist/qtap-plugin-anthropic/provider.ts` +1 more | Owed |
| 35 | [the Ollama SSE splitter drops JSON split across reads](bugs/fixed/bug-35-ollama-sse-split.md) | 2026-08-06 | 2026-08-06 | Low | The Ollama SSE splitter splits each network read on `\n` with **no cross-read buffer** — a JSON object split across two reads is **silently lost** | `plugins/dist/qtap-plugin-ollama/provider.ts` | Owed (Faithful) |
| 36 | [the "tools disabled by profile" warning box is dead code](bugs/fixed/bug-36-tools-disabled-warning.md) | 2026-08-06 | 2026-08-06 | Low | The "tools disabled by connection profile" warning box is **dead code** (`undefined === false`) — no v4 user has ever seen it | `lib/services/chat-enrichment.service.ts` +1 more | Owed (Faithful) |
| 37 | [`AllLLMPauseModal` is unreachable; the pause is silent](bugs/fixed/bug-37-silent-all-llm-pause.md) | 2026-08-06 | 2026-08-06 | Low | `AllLLMPauseModal` is **unreachable** — the pause fires and writes `isPaused`, but the client is never told, so it stops with no explanation | `app/api/v1/chats/[id]/handlers/get.ts` +1 more | Owed (Faithful) |
| 38 | [the library picker lists markdown documents that 404 on attach](bugs/fixed/bug-38-markdown-attach-404.md) | 2026-08-06 | 2026-08-06 | Low | The library picker lists a store's **markdown documents**, but attaching one **404s** ("Mount-point file blob not found") — in both apps | `app/api/v1/chats/[id]/files/route.ts` +2 more | Owed (Faithful) |
| 39 | [`.qt-text-danger` is defined in no CSS, so error text is body-coloured](bugs/fixed/bug-39-missing-danger-colour.md) | 2026-08-06 | 2026-08-06 | Low (cosmetic) | `.qt-text-danger` is **defined in no CSS file** — inline error text renders in ordinary body colour | `app/styles/qt-components/_utilities.css` +1 more | the `_utilities.css` corpus vector self-retires |
| 40 | [the toolbar search dialog won't close on an outside click](bugs/fixed/bug-40-search-dialog-outside-click.md) | 2026-08-06 | 2026-08-06 | Low | The toolbar search dialog **won't close on an outside click** — `.qt-page-toolbar`'s `backdrop-filter` makes it the containing block for the `fixed` backdrop | `components/search/search-dialog.tsx` | Owed (Faithful) |
| 41 | [`Content-Disposition` mangles a filename with an apostrophe and non-ASCII](bugs/fixed/bug-41-content-disposition-apostrophe.md) | 2026-08-06 | 2026-08-06 | Low | `Content-Disposition` leaves the **apostrophe unescaped** in `filename*=UTF-8''…`, so a title with `'` **and** a non-ASCII char downloads with underscores | `lib/api/content-disposition.ts` | the `content_disposition` vector `ascii-apostrophe-with-non-ascii` self-retires |
| 42 | [toasts have no entry animation](bugs/fixed/bug-42-toast-entry-animation.md) | 2026-08-06 | 2026-08-06 | Low (cosmetic) | Toasts have **no entry animation** — the markup names keyframes (`slideInUp`) defined nowhere and a Tailwind plugin that isn't loaded | `app/globals.css` +1 more | Owed (Faithful) |
| 43 | [orphaned thumbnails are never collected](bugs/fixed/bug-43-orphaned-thumbnails.md) | 2026-08-06 | 2026-08-06 | Low (disk leak) | Orphaned `_thumbnails/` files are **never collected** when a file leaves by any route but in-app delete | `lib/background-jobs/maintenance/sweep-orphaned-thumbnails.ts` +2 more | Owed (Faithful) |
| 44 | [Bug 27's fix chose the wrong mechanism: impersonation mutates `controlledBy` instead of overlaying it](bugs/fixed/bug-44-impersonation-overlay.md) | 2026-08-06 | 2026-08-07 | Medium | Bug 27's fix mutates `controlledBy` (mutate-and-restore) instead of overlaying impersonation | `app/api/v1/chats/[id]/actions/participants.ts` +2 more | v4-FIRST (inverse direction) |
| 45 | [an impersonated seat's message flickers to the wrong author before correcting](bugs/fixed/bug-45-impersonated-author-flicker.md) | 2026-08-07 | 2026-08-07 | Low (cosmetic, self-correcting) | An impersonated seat's just-sent message flickers to the wrong author before the refetch corrects it | `app/salon/[id]/hooks/useSSEStreaming.ts` | Owed (Faithful) |
| 46 | [impersonation and the composer turn banner don't reconcile; you can't tell who you're speaking as](bugs/fixed/bug-46-composer-turn-banner.md) | 2026-08-07 | 2026-08-07 | Low–Medium (confusing; you can post as the wrong character) | Impersonation and the composer turn banner don't reconcile — the banner announces a genuine user seat's turn while attribution follows the impersonated seat, with no on-screen cue | `app/salon/[id]/SalonView.tsx` +1 more | Owed (Faithful, v4-first) |
| 47 | [the Brahma Console gives up silently when the turn budget is exhausted](bugs/fixed/bug-47-silent-budget-exhaustion.md) | 2026-08-08 | 2026-08-08 | Low (rare at the default budget of 50, but it burns real API spend and returns nothing) | Brahma Console gives up silently when the turn budget is exhausted — an expensive run ends with no answer and no `done` event | `lib/services/brahma-console/orchestrator.service.ts` + `one-shot.service.ts` (budget-exhaustion salvage) | Owed (Faithful) — retire `dogfood-findings.md` #73 |
| 48 | [impersonating a character does not hand them the current turn](bugs/fixed/bug-48-impersonate-doesnt-take-the-turn.md) | 2026-08-08 | 2026-08-08 | Low–Medium (confusing; you opt to speak as a character but it is still someone else's turn) | Impersonating a seat writes `impersonatingParticipantIds` / `activeTypingParticipantId` but never moves the turn, so the banner stays on the previously selected seat | `app/salon/[id]/SalonView.tsx` (`handleImpersonateAndTakeTurn`) | Owed (Faithful) |
| 49 | [the speaking-as seat does not follow the current user-driven turn](bugs/fixed/bug-49-speaking-as-doesnt-follow-the-turn.md) | 2026-08-08 | 2026-08-08 | Low–Medium (confusing; on an impersonated seat's own turn you default to the wrong character) | On the impersonated character's own turn the composer stays on the previously selected seat, so you default to the wrong character (sibling of Bug 48) | `app/salon/[id]/SalonView.tsx` (turn-follow effect) | Owed (Faithful) |
| 50 | [the sole LLM answers every human turn when you drive two seats](bugs/fixed/bug-50-sole-llm-answers-every-human-turn.md) | 2026-08-08 | 2026-08-08 | Medium (unfair rotation; one LLM takes half the turns) | With 2+ user-driven seats and exactly one LLM, the first responder is picked from an LLM-only shortlist, so that LLM answers every human turn (Charlie→Kumar→Lorian→Kumar…) | `lib/chat/turn-manager/selection.ts` + `lib/services/chat-message/orchestrator.service.ts` | Owed (Faithful) |
| 51 | [chat GET omits impersonation state, so a reload shows an impersonated seat as not impersonated](bugs/fixed/bug-51-chat-get-omits-impersonation-state.md) | 2026-08-08 | 2026-08-08 | Medium (reload-only; breaks impersonation + speaking-as until re-impersonated) | GET's field allowlist omits `impersonatingParticipantIds` / `activeTypingParticipantId`, so a reload drops the overlay; restoring the latter also required a once-only client re-sync | `app/api/v1/chats/[id]/handlers/get.ts` + `app/salon/[id]/hooks/useImpersonation.ts` | Owed (Faithful) |
| 52 | [a cross-instance character import produces a faceless character with a dangling avatar id](bugs/fixed/bug-52-avatar-import-dangling.md) | 2026-08-09 | 2026-08-10 | Medium (silent loss on every cross-instance character import) | `streamCharacters` exports no vault records or bytes, and reconcile never remaps `defaultImageId` / `avatarOverrides[].imageId` — the avatar (and the whole vault: photos, mail, notes) stays behind and the id dangles | WP A2 of `features/character-archive-spec.md` (`lib/export/ndjson-writer.ts` + `lib/import/quilltap-import/reconcile.ts`) | Owed (Faithful) |
| 53 | [filesystem reconciliation clobbers and can delete archive bundle rows](bugs/fixed/bug-53-reconciliation-archive-clobber.md) | 2026-08-10 | 2026-08-10 | High (a boot can delete a bundle row and dangle `archiveFileId`; at minimum every boot strips the `/archives` folderPath) | Reconciliation "corrects" ARCHIVE rows' curated folderPath to `/`, its preservation set never read `archiveFileId` (and the plaintext-sha row can't sha-match encrypted bytes), and the watcher could adopt a freshly-written bundle as an orphaned DOCUMENT | `lib/file-storage/reconciliation.ts` + `lib/characters/archive-service.ts` (`createArchiveFileRecord`) | Owed (Faithful) |
| 54 | [rehydrate refuses any character who shared a content row with another vault](bugs/fixed/bug-54-rehydrate-shared-content-collision.md) | 2026-08-10 | 2026-08-10 | High (rehydration unreachable for any character archived out of a multi-character chat; no data loss, but the archive is one-way) | Content rows are shared across vaults (a group chat's summary is one row, one link per participant); the prune deletes the target's link, so the preflight's "is it linked in the target vault?" test reads legitimately-owned content as living elsewhere and refuses atomically — stricter than the writer, which dedups by sha256 and discards the carried id | `lib/import/quilltap-import/execute.ts` (`document store file` / `document store blob` skip classifiers) | Owed (Faithful) |
| 55 | [a file row that outlived its bytes serves 500 instead of 404](bugs/fixed/bug-55-missing-file-content-500.md) | 2026-08-10 | 2026-08-10 | Low (mislabels permanent loss as a server fault; invites endless client retries and buries real storage faults in the error log) | `downloadFile` re-wraps every failure in a generic Error, so both file routes map "no such object" and "the read blew up" alike to `serverError` | new `lib/file-storage/errors.ts` + `app/api/v1/files/[id]/actions/download.ts` and `app/api/v1/files/proxy/[...key]/route.ts` | Owed (Faithful) |
| 56 | [folder creation mkdir -p's its way up an absent mount root](bugs/fixed/bug-56-unguarded-recursive-mkdir.md) | 2026-08-10 | 2026-08-10 | Medium (an opaque 500 as observed; a silent success fabricating a directory tree divorced from the store wherever the process can write to the missing ancestors) | `createFilesystemFolder` runs `fs.mkdir(target, {recursive: true})` without checking the mount's own `basePath` exists, so a store on an unreachable path (an unmounted volume, or a host path never bound into a container) sends mkdir walking up to the topmost missing ancestor | new `lib/mount-index/base-path-availability.ts` + `lib/mount-index/scanner.ts` and both mount-point routes | Owed (Faithful) |
| 57 | [rehydrate refuses any vault that links the same bytes twice](bugs/fixed/bug-57-rehydrate-duplicate-blob-claim.md) | 2026-08-11 | 2026-08-11 | Medium (High for anyone it hits: rehydrate permanently unusable for that character; the ordinary-import workaround severs id continuity) | The export's blob leg emits one record per LINK (`listByMountPoint` joins from the links), so a twice-linked sha-deduped blob appears twice in the bundle with one `blobId` — and the preflight's `carriedBlobIds` is not deduped (unlike `carriedFileIds` one list up), so the within-bundle repeat throws before Bug 54's sha-match skip is ever consulted | `lib/import/quilltap-import/execute.ts:115` — one-line `Set` dedupe | Converged (2026-08-11) — v5's pinned divergence becomes plain equality; the marker retires at the next drift catch-up |
| 58 | [migrations open the database without the instance lock](bugs/fixed/bug-58-migrations-bypass-instance-lock.md) | 2026-08-12 | 2026-08-12 | High (two processes writing one SQLCipher database — the WAL-corruption scenario the lock exists to prevent — via the heaviest writer in the codebase) | The lock is acquired by the SQLite backend's `connect()`, so every repository read and write inherits it; the migration runner holds its own connection and opened it with a bare `new Database(dbPath)`, and `instrumentation.ts` runs migrations in PHASE 1 ahead of the backend connect that would have refused | `migrations/lib/database-utils.ts` (`getSQLiteDatabase`) | Owed (Faithful) |
| 59 | [a failed read reads as an empty database and triggers first-startup seeding](bugs/fixed/bug-59-failed-read-triggers-first-startup-seeding.md) | 2026-08-12 | 2026-08-12 | High (a populated instance sent down the new-install seeding path — default characters, duplicate embedding profile, full `.qtap` import — on a transient read failure) | `findByFilter` passes `[]` as `safeQuery`'s fallback, so "no rows" and "the database is unreachable" are the same value; `seedInitialData` read that `[]` as "first startup" and began seeding an instance holding 24 characters and 10,286 messages | `lib/startup/seed-initial-data.ts` + new `countOrThrow` in `lib/database/repositories/base.repository.ts` | Owed (Faithful) |
| 60 | [the documented key-file backup procedure copies nothing](bugs/fixed/bug-60-phantom-per-database-key-files.md) | 2026-08-12 | 2026-08-12 | High (a user follows the documented backup and both `cp` commands fail; they believe the encryption key is saved when nothing was copied, and find out when the databases can no longer be opened) | The `.dbkey` path in BACKUP-RESTORE.md and DEPLOYMENT.md omits the `data/` component, and both docs plus DDL.md describe per-database key files that were never built — `quilltap-mount-index.dbkey` has never existed, and `quilltap-llm-logs.dbkey` is written only by `changePassphrase`, read by nothing, and can hold a stale wrapping | `lib/startup/dbkey.ts` + `lib/paths.ts` + `lib/startup/version-guard.ts` and the six docs/help files naming a `.dbkey` path | Owed (Faithful) |
| 61 | [a wardrobe edit staged before the worn snapshot arrives is dropped](bugs/fixed/bug-61-staged-outfit-edit-dropped.md) | 2026-08-12 | 2026-08-12 | Medium (silent data loss — the staged outfit is discarded, nothing is sent, nothing errors, and the dialog closes exactly as it does on a successful save) | Staging in the in-chat Wardrobe dialog before `refreshOutfit`'s three-round-trip chain publishes the worn snapshot is lost twice over: the first Live seed overwrites the staged slots, and the flush skips any character with no captured baseline and then returns `true`, so Done closes as if it saved | new `lib/wardrobe/staged-live-outfits.ts` + `components/wardrobe/wardrobe-control-dialog.tsx` | Owed (Faithful) |
| 62 | [the fallback dialogue pattern matches only straight quotes](bugs/fixed/bug-62-dialogue-fallback-quotes.md) | 2026-08-13 | 2026-08-13 | Medium (cosmetic but pervasive: curly-quoted dialogue had never been highlighted on the fallback path, and most model output is curly-quoted) | `DEFAULT_RENDERING_PATTERNS`' dialogue entry and `DEFAULT_DIALOGUE_DETECTION` both spelled their "straight and curly" character sets with the straight quote **duplicated** — every byte `0x22` — so curly-quoted dialogue got no `qt-chat-dialogue` styling in any chat falling through to the defaults | `lib/chat/roleplay-rendering.ts` — both defaults respelled with `“`/`”` escapes, plus fallback-path coverage in the server suite and the `MessageContent` client suite | Owed (Faithful) — moves v5's captured markdown parity corpus |
| 63 | [text replacements fire inside code blocks and inline code](bugs/fixed/bug-63-text-replacement-in-code.md) | 2026-08-13 | 2026-08-13 | Medium (silent corruption of text as the user types it, in the one place a substitution is never wanted; nothing signals it happened and the result is a plausible word, so it reads as your own typo) | `TextReplacementPlugin`'s candidate-word read checks only `$isTextNode(anchorNode)` and cursor-at-end — but `CodeHighlightNode` **extends** `TextNode`, so fenced-block tokens satisfy it, and nothing reads `hasFormat('code')` for inline runs, so both code surfaces fall straight through into the replacement path. The block-check idiom already existed in the same directory (`FormattingCommandPlugin.tsx:223-225`) and was simply not reused; the plugin had no tests at all | new `components/chat/lexical/utils/code-context.ts` (`$isInCodeContext`) shared by `TextReplacementPlugin` and the new `EmojiTypeaheadPlugin` (renamed `CharTypeaheadPlugin` in Layer 2.0u), plus the previously-missing `TextReplacementPlugin` suite | Not yet ported — v5's `textReplacementPlugin` needs the ProseMirror equivalent when it lands |
| 64 | [first-run encryption setup wedges every database connection until restart](bugs/fixed/bug-64-setup-stale-db-handle.md) | 2026-08-13 | 2026-08-13 | High (every fresh instance, at first contact; no data loss, but the whole app errors until a manual restart and nothing on screen says so) | `handleSetup` closed the main SQLite client out-of-band before converting the files to SQLCipher, but `SQLiteBackend.db` still held the closed handle behind `_state === 'connected'` and the manager's initialized-forever cache. Riders: the llm-logs client stayed open on the unlinked pre-conversion inode (log writes lost), the mount-index DB wasn't converted until the next restart, and `handleLock` shared the same pattern. Fixed by new `suspendDatabase()` / `resumeDatabase()` manager chokepoints that recycle the handles while *keeping* the backend instance — a rebuilt backend would drop the `ensureCollection` column maps that already-initialized repositories never re-register — plus a mount-index close in `disconnect()`, all three DBs converted, and an out-of-band-close self-heal in the backend | `app/api/v1/system/unlock/route.ts` (`handleSetup`, `handleLock`, `handleUnlock`) + `lib/database/manager.ts` + `lib/database/backends/sqlite/backend.ts` + `app/setup/page.tsx` | Design note for the port's key-setup flow |
| 65 | [the version guard has been silently inert since 2026-08-12](bugs/fixed/bug-65-version-guard-async-require.md) | 2026-08-13 | 2026-08-13 | Medium-High (a safety gate that reports success while doing nothing; no corruption caused by the bug, but the only barrier between an older binary and a newer database has been off since 2026-08-12, and every instance created since then has no version floor at all) | `version-guard.ts:50-54` and `:141-145` reach `migrations/lib/database-utils` with a **synchronous `require()`**. That module became an async module in Turbopack's graph when `02821db6` (the bug 58 fix) added a static `instance-lock` import to it, and a sync `require()` of an async module returns an exports object that is never populated — measured empty even a microtask later, while `await import()` of the same specifier returns all twelve exports. Every call throws `isSQLiteBackend is not a function` into a catch that allows startup anyway, so `highest_app_version` is never stored (V4test has no row; Friday is frozen at `4.8.0`) and `minServerVersion` never reaches `.dbkey` | `lib/startup/version-guard.ts` (both functions async, `await import`, failures announced through the migration-warnings channel) + `instrumentation.ts` call sites + an `eslint.config.mjs` `no-restricted-syntax` rule banning sync `require` of `migrations/` from app code; **not** by unwinding the import edge in `database-utils.ts`, which would have left the next static import free to break it again | Design note: port the version-floor *behaviour* from the bug file, not from v4's code — v4's had never actually run |
| 66 | [the archived-seat sidebar badge cannot light on a fresh load](bugs/bug-66-archived-badge-fresh-load.md) | 2026-08-11 | — | Low | The chat GET the sidebar renders from enriches characters through `getCharacterDetail`, which `01e481f6` never extended with `archivedAt` — only the participants `?action=` replies and the chat PUT (the `helpers.ts` enrichment) carry it, so the `Archived` badge appears only after an action + refetch, never on first load | `lib/services/chat-enrichment.service.ts` (`getCharacterDetail` — mirror `helpers.ts:67`) | v5 mirrors both projections faithfully; its archive beat pins the one-badge fresh-load state and flips with this fix |
| 67 | [a send from the raw-source view discards every source edit](bugs/bug-67-source-mode-send-discards-edits.md) | 2026-08-14 | — | Medium (silent loss of typed text) | The submit reads the hidden Lexical handle unconditionally (`SalonView.tsx:1581`) while the source `<textarea>` is the visible, edited surface with the bridge suspended — the pre-edit bytes ship and the edits vanish; `hasContent` is editor-fed too, so Send never even lights for source-typed text | `app/salon/[id]/SalonView.tsx:1581` + the `hasContent` feed | v5 diverges deliberately (sends what the writer sees), mutation-pinned; converges when v4 fixes |
| 68 | [the multi-character `[Name]` prefill silently kills Ollama's thinking channel](bugs/fixed/bug-68-ollama-prefill-kills-thinking.md) | 2026-08-14 | 2026-08-14 | Medium (a paid-for feature is off with no signal — the toggle reads on, the model reasons, the reasoning is discarded before capture, and the reasoning tokens cost wall-clock either way) | Ollama's `think` support lives in the model's **chat template**, which opens the thinking block at the start of the assistant turn — so the multi-character `[Name]` assistant prefill (`context-builder.service.ts`, everything but Anthropic) means the turn has already begun with visible content and the block is never opened; `message.thinking` returns empty regardless of `think: true`. Reproduced against `localhost:11434`: same 27B, no prefill → 470 thinking chars, with prefill → 0. Ollama-only — other providers carry a protocol-level reasoning field that survives the prefill (DeepSeek 1742/5689 multi-char turns, Ollama 0/12) | The route is now the user's choice per profile: `connection_profiles.multiCharacterPrefill` (migration `add-profile-multi-character-prefill-field-v1`, backfilled Anthropic-off/rest-on) resolved through the one chokepoint `profileUsesNamePrefill` in new `lib/llm/multi-character-prefill.ts`, applied by `applyMultiCharacterTurnAnchor` in `context-builder.service.ts` with the provider hardcoding removed, and surfaced as a profile-editor checkbox. A NULL column means "never chosen" and resolves to the provider default, so a pre-4.9 Anthropic import can't come back with the prefill on. The separate greeting-path reasoning drop (`lib/chat/initial-greeting.ts` read only `chunk.content`) was fixed alongside | Not yet assessed — v5 ports the same carve-out and inherits the defect; port the per-profile setting from the bug file, not v4's pre-fix provider branch |

### Families and reading order

Bugs 1–3 are one repair: **all three must land together** or restore is still
broken. Bug 2 alone changes nothing, because Bug 3 means there is nowhere to
put the bytes.

Bug 5 is unrelated to the backup/restore family and stands alone. It is the
first entry here that did **not** come from the differential harness — the
harness could not have found it, because v5 reproduces the behaviour exactly.
It took a human running a tool in a real chat and getting the wrong answer.

Bugs 9–12 are one family (backup / restore / import integrity) and are best
fixed together, the way Bugs 1–4 were. Bug 8 was the single most urgent item in this
catalogue — it ran against live data and the loss was silent and permanent.

An [Inert dead code](#inert-dead-code) appendix lists a further set of
faithfully-ported-but-dead v4 code paths that bite no user today.

### v5 coordination

**Bugs 1–46 are fixed in v4. Bug 44 (the impersonation overlay) landed
2026-08-07; Bugs 45 and 46 landed 2026-08-07. The 1–43 close-out: the last batch, bugs 31–35,
on 2026-08-06** (bugs 8–12, 18, and 26 fixed earlier). Their
per-bug fix sites and v5 status are in the [Status](#status) table and, in full,
in each bug's own file. The coordination surface, as they were taken, is these
tripwires the v5 side must retire the day v4 converges:

| v4 fix | v5 tripwire that fires | Where |
|---|---|---|
| 8 — properties.json clobber | the `corrupt` arm of `characters_update_tier2_equivalence` | both assertions go red |
| 9 — store-delete orphans | `store_delete_equivalence` (7 arms, `reap_orphans`) | "v4 has CONVERGED — retire this divergence" |
| 10 — annotations wipe | `system_delete_data_equivalence` → `ANNOTATION_DIVERGENCE_KEY` | v5 = 0, oracle must be non-zero |
| 11 — import overwrite trio | `system_import_state` → `FOLDER_CLEAR_DIVERGENCE`, `STORE_ID_PRESERVED_ON_CREATE`, `store_identity_*` | one per defect |
| 12 — second-gen restore | `system_restore_state` dedupe arms | ruled `REPLAY_DEDUPE` |
| 15 — link-group siblings | `doc_mount_file_links_tier2_equivalence` → `CHUNK_DIVERGENCES` | fresh on v5 / stale on v4 |
| 16 — mount-chunk count | `embedding_dimension_reconcile` (`mountChunks == 0`) | mutation-tripwire |
| 20 / 21 — Almanack ledgers | `almanack_tier2_equivalence` → `reconcile_ledger_divergences` | self-retiring |
| 39 / 41 — CSS / disposition | `_utilities.css` corpus; `content_disposition` vector `ascii-apostrophe-with-non-ascii` | vanished divergence fails loud |

The **Faithful** items (13, 14, 17–19, 22–38, 40, 42, 43, and the inert list)
carry no both-directions pin — v5 reproduces them exactly, so the two sides
simply disagree once v4 is fixed. Each must be mirrored on the v5 side **in the
same round** v4 lands it, or the port falls out of step with its own oracle. Bug
8 is the exception that is also urgent: it is live data loss against real
instances, and should not wait for a convenient round.

**Bug 44 runs the OTHER way**: v5 already mirrors the shipped (wrong)
mechanism faithfully, so there is no v5 tripwire and nothing for v5 to do
first — v4 lands the overlay correction between v5 rounds and tells the
port, whose `salon_mutations` / `chat_cast_routes` / turn-chain families
then move as ordinary drift.

Bugs 1–4 had been ruled deliberate divergences on the v5 side (2026-07-24 and
2026-07-25) rather than being reproduced bug-for-bug, on the grounds that they
sit on the data-loss path. The v5 rulings are recorded in that repo's
`docs/developer/porting/status-log.md` under "Ruling — the sparse-array blob
divergence" and "Ruling — the two v4 restore bugs".

### Decisions taken while fixing

- **Bug 1 was fixed on the restore side only**, per the recommendation above.
  The backup side is untouched, so archive bytes do not change and the v5
  oracle's *backup* fixtures do not move. The coercion tolerates already-correct
  input (parse only when the value is a string, coerce only when it is a
  number), so a later backup-side normalisation can land without a second
  change here.
- **Bug 3 renumbers by insertion, not renumbering.** The moved block is
  labelled `22a-bis` and step 5 keeps a placeholder comment explaining the
  deferral — the same idiom step 19 already uses for wardrobe items deferred to
  22f-bis. Renumbering twenty-odd comments would have buried an ordering-only
  change in noise.
- **No sibling `backupFormat ===` comparisons exist**; the audit Bug 2 asks for
  turned up only the two lines it names.
- **Regression tests added**:
  `__tests__/unit/lib/backup/mount-index-coercion.test.ts`,
  `__tests__/unit/lib/backup/restore-archive-file-lookup.test.ts`,
  `__tests__/unit/lib/import/quilltap-import-stream-blobs.test.ts`. The last
  was checked against the pre-fix code: five of its seven cases fail there.

Both of Bug 5's open product calls were taken rather than left to omission:

- **Multiple user-controlled characters** — the active speaker wins, as the
  entry suggested. `activeTypingParticipantId` names a *participant* id, not a
  character id, so `operatorCharacterIds` resolves it through the participants
  array and returns an ordered candidate list (active speaker first, then the
  rest in stored order) rather than a set. A **removed** user-controlled
  participant is not a candidate at all — the operator is not playing them any
  more, whatever the roster still resolves through them.
- **A gate the operator's own character fails** — the row is kept and
  **labelled** with the character it will run as, using the `characterLabel`
  the per-variant listing already carries and the dialog already renders as
  *"as Friday"*. Omitting the row would have withheld a working tool over a gate
  that was never asked about the operator; falling through silently was the
  trap. The same label covers the other fallback case, an all-LLM room the
  operator plays nobody in. A one-character room stays unlabelled — there is
  nothing to disambiguate.
- **POST's `asCharacterId`-less fallback takes the same preference.** Strictly
  beyond the reported bug (that path rolls against `{}` by design, so no sheet
  is consulted), but it was the other place "arbitrary" meant "first", and
  leaving the two orderings different would have been a trap of its own. It
  decides only which definition of a shadowed name gets dealt.
- **Regression test added**:
  `__tests__/unit/app/api/v1/chats/custom-tools-perspective.test.ts` (10 cases).
  Checked against the pre-fix code: six of them fail there.

### Known residue from Bug 3's placement

Not a regression; a follow-up.

Immediately after 22a is the right slot, and it is worth writing down *why*,
because two nearby slots are worse:

- **After 22c** (doc-store file rows) the replay's `findOrCreateByContent`
  would match the archived content row by sha and hard-link to it, so 22f's
  `INSERT INTO doc_mount_blobs` would then violate `UNIQUE(fileId)` and the
  archived blob row would be refused.
- **After 22d** the same, plus the replay would have to unique-suffix around
  every archived link.

At 22a the doc-store has mount points and nothing else, so the replay builds an
independent set of file/link/blob rows that cannot collide with the archived
ones. What remains is narrow and warning-shaped:

- Restoring a **second-generation archive** — one taken from an instance that
  was itself restored — replays project-less files into the Quilltap Uploads
  mount at `restored/<name>`, which is exactly where the archived link rows for
  those files already live. The replay gets there first (22a-bis), so 22b's
  archived `restored` folder row and 22d's archived link rows collide with it
  and are logged as warnings. Content is present either way; the archived link
  *ids* are what get lost.
- First-generation archives are unaffected: the archived paths are `chat/`,
  `images/`, etc., and `restored/` is free.
- Project-bound files never collide at all — `projects.create` provisions a
  *fresh* official store and discards the archived `officialMountPointId`, so
  the replay and the archived rows land in different mount points. (That
  duplication predates this fix and is orthogonal to it.)

Fixing this properly means teaching the replay to recognise that the archive
already carries the store rows for a file and skip re-ingesting it, rather than
reshuffling phase order. Out of scope here.

### Owed to the v5 side

The two tripwires named above will now fire. Both are the tripwire working:
retire the divergence entries and let the cases become plain equalities.

| v4 fix | v5 tripwire | Action |
|---|---|---|
| Bugs 1–3 | `crates/quilltap-harness/tests/system_restore_state.rs` → `assert_divergences` | Re-rule the divergence as converged |
| Bug 4 | `crates/quilltap-harness/tests/system_import_equivalence.rs` → `EXPECTED_DIVERGENCES` | Remove the `throw_ndjson_truncated_blob` case |

The oracle baseline moves once, at the commit that carries these fixes.

**Bug 5 fires no tripwire, which is the point.** v5 reproduces it faithfully, so
nothing over there is asserting a divergence to catch the upstream fix — the two
sides now simply disagree, silently, until the mirror lands. What v5 owes:

- `crates/quilltap-core/src/api/custom_tools.rs` — the `sightings[0]` pick at
  `:293` becomes the operator preference, and the same fallback label; the
  metadata selection at `:418-422` is unchanged.
- `src/tools/run_custom.rs:545` is **not** touched — the rolling character's own
  sheet was always right.
- Finding #30 is re-ruled from "v4-faithful, deliberately not fixed" to fixed
  upstream, and the m6 parity note for the composer popup is updated with it.

---

## Inert dead code

These are dead or unreachable v4 code paths that cost no user anything today —
listed only so the faithful port is not "corrected" toward v4's broken original,
and so a future refactor can remove them. Each is reproduced (or omitted)
faithfully on the v5 side.

- **`roleplayTemplateName`** — set at `SalonView.tsx:140` and read nowhere; the
  only occurrences in the whole checkout are its declaration and four setters.
  Dead state.
- **The `renderedMarkdown`/`renderedHtml` fast path** — no `lib/` writer sets the
  column; the only non-schema references are the maintenance sweep that NULLs it
  and the Zod declarations. Announcements render client-side regardless.
- **`showPerMessageCost`** — unreachable for two independent reasons: the mount
  gate reads `showPerMessageTokens` only, and `MessageActionBar` passes no
  `estimatedCostUSD` (the Message type has no cost field).
- **`showSystemEvents`** — declared, parsed, and defaulted, read by no consumer.
- **`getCheapLLMProvider`'s `if (!cheapLLMSelection)` arm** — unreachable: the
  priority-5 fallback always yields the current profile, and the handler has
  already thrown if that profile is missing.
- **Provider `shouldHideChat`** — dead: zero callers, and it reads the wrong
  field name (`isDangerous` vs the real `isDangerousChat`).
- **The chat-profile `GenerateImageDialog` opener** — `useModalState.ts:63`
  exports `openGenerateImage`, which no v4 component calls; that dialog is
  unreachable (the reachable one is the standalone dialog).
- **The third recall-replay route error arm** — documented dead code.
- **`llmLoggingSettings?.retentionDays ?? 30`** — unreachable: the cell is
  Zod-parsed on read, so a NULL/absent cell arrives as the full default object and
  `retentionDays` is always present.
- **The Anthropic per-message cache arm** — dead in v4.
