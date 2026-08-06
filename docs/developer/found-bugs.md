# Found Bugs — defects surfaced by the v5 port

**Last Updated**: 2026-08-06
**Codebase**: Quilltap v4.8.0-dev (HEAD `3adefeba`)
**Provenance**: the quilltap-v5 native port's differential harness, and its
dogfood walks against a copy of real data
**Status**: Bugs **1–18** plus **22–27, 36–38, and 43** are **fixed in v4** — each
fixed bug's section below carries a **FIXED in v4** marker (see
[Status](#status)). The remaining bugs **19–21, 28–35, and 39–42** are **NOT yet
fixed in v4** — they are the defects the port has surfaced in the weeks since.
They are catalogued in
[Bugs found since — not yet fixed in v4](#bugs-found-since--not-yet-fixed-in-v4),
and summarised in the [Status](#status) table with a **No** in the "Fixed in
v4?" column.

**Fix plan:** the open bugs are batched into nine session-sized, dependency-
ordered specs under [bugfix-sessions/](bugfix-sessions/README.md) — hand a
session file to a fresh session to execute it.

---

## What this file is

The v5 port runs every ported unit against v4's **real** `lib/` code and diffs
the results field by field. That process occasionally finds a defect in v4
itself — a case where v5 and v4 disagree and **v4 is the one that is wrong**.

Those are recorded here with a fix plan. Each entry states the symptom, the
root cause with file and line, why it survived this long, the fix, and how to
verify it.

**These are bugs, not preferences.** They are distinct from the port's much
longer list of *v4-faithful papercuts*, where v5 reproduces a v4 annoyance
exactly and any change is a product decision to be made in v4 first. That list
lives in the v5 repo (`docs/developer/porting/dogfood-findings.md`, "post-5.0
product improvements"). Nothing here is a matter of taste.

**Scope note:** this file was opened to plan the fix for **Bug 4** (the 3 MB
import bug). Bugs 1–3 come from the same audit, are listed first because they
are more urgent, and are included so the backup/restore family can be fixed in
one pass rather than three.

---

## Summary

| # | Bug | Who it bites | Severity | Fix size |
|---|---|---|---|---|
| 1 | Restore rejects every `doc_mount_points` and `doc_mount_file_links` row — character vaults, project stores and group stores all come back **unreachable** | **every** restore of a modern backup | **Critical** | ~10 lines |
| 2 | Restore looks for user files under `backupFormat === 2`, but modern manifests declare `4` — **no user file is restored** | **every** restore of a modern backup | **Critical** | 1 line |
| 3 | Restore runs the files phase (5) before the stores that must receive the bytes exist (13 / 22a) — so **even with Bug 2 fixed, no file lands** | every restore into a fresh or wiped target | **Critical** | move one block |
| 4 | Import cannot read v4's own export of a document-store blob larger than **3 MB** — silent truncation, then a hard failure | any instance with a store blob > 3 MB | High | 1 line |
| 5 | A custom tool run from the composer tests **the first participant's** fact sheet, not the operator's own character — so metadata gates and `$state` group scope resolve as the wrong character | any operator running a shared/global tool in a chat not led by their own character | Medium | ~5 lines |
| 6 | The startup render/embed reconcile reads deliberately **cold-tiered** chats as damage and re-embeds the entire cold tier on every boot — which the next maintenance sweep clears again, forever | any long-lived instance with chats older than the stale window, on **every restart**; real money on a paid embedding profile | High | ~25 lines |
| 7 | `embeddingStatus.markAsEmbedded` / `markAsFailed` are find-then-update and **silently no-op** when no status row exists — and nothing creates status rows anymore, so every embedding outcome is dropped; downstream, the reconcile keeps re-attempting permanently-unembeddable (>8k-token) chunks every boot | every instance — no `EMBEDDED`/`FAILED` outcome has landed since the enqueue-time upserts were removed; on the measured instance, 76 active chats re-render and re-fail on every restart | High | ~60 lines |

Bugs 1–3 are one repair: **all three must land together** or restore is still
broken. Bug 2 alone changes nothing, because Bug 3 means there is nowhere to
put the bytes.

Bug 5 is unrelated to the backup/restore family and stands alone. It is the
first entry here that did **not** come from the differential harness — the
harness could not have found it, because v5 reproduces the behaviour exactly.
It took a human running a tool in a real chat and getting the wrong answer.

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

## Bug 1 — restore rejects every mount point and file link

**Severity: Critical.** Every character vault, project store and group store
comes back unreachable.

### Symptom

Restore a modern backup. The folders, file rows, documents and chunks all
arrive — but no `doc_mount_points` and no `doc_mount_file_links`. The result is
a graph that holds all of the content and none of the stores or links that
reach it. Warnings are logged per row; the restore reports success.

### Root cause

`dumpMountIndexTable` (`lib/backup/backup-service.ts:72`) is a raw passthrough:

```ts
return db.prepare(`SELECT * FROM "${table}"`).all() as T[];
```

SQLite hands back storage types, so the archive carries:

- `includePatterns` / `excludePatterns` as **JSON text**, not `string[]`
- `enabled` / `allowEmbed` as **INTEGER 0/1**, not `boolean`

`restore.ts` then feeds those rows to the repository `create`s at steps 22a and
22d, whose Zod schemas demand `string[]` and `boolean`. Every row is rejected.

The `as T[]` cast is what hides it: the function is *typed* as returning
`DocMountPoint[]`, so nothing downstream questions the shape.

### Why it survived

The backup path is exercised far more often than the restore path, and the
failure is per-row and warning-shaped — the restore still reports success. The
damage only shows up later, when a vault turns out to be unreachable.

### The fix

Two viable sites; **pick one, do not do both**:

- **Backup side (preferred)** — parse the JSON columns and coerce the booleans
  in `dumpMountIndexTable`, so the archive is correct at the source. Newly
  written archives are then readable by an *unfixed* v4, which is worth having.
  Needs a per-table column map, since the function is generic.
- **Restore side** — coerce immediately before the `create` calls at 22a/22d.
  Fixes old archives too, which the backup-side fix does not.

**Recommendation: do the restore side, and consider the backup side as well.**
The restore-side fix is the one that repairs archives users already have;
without it, every backup taken before the fix stays unrestorable. If both are
done, the restore-side coercion must tolerate already-correct input (parse only
when the value is a string, coerce only when it is a number).

### Verification

- Round-trip an instance that has at least one character vault and one project
  store: back up, wipe, restore, then confirm `doc_mount_points` and
  `doc_mount_file_links` are non-empty and the vault opens.
- v5's `system_restore_state` differential diffs 43 tables across all three
  partitions over four archives and will confirm the fix — expect it to fail
  first with the "FIXED upstream" message above.

---

## Bug 2 — restore looks for files under the wrong format number

**Severity: Critical.** No user file is restored.

### Symptom

Every file row restores; not one byte of file content does. The log fills with
`File not found in extracted backup`.

### Root cause

`getFileFromExtractedBackup` (`lib/backup/restore/archive.ts:334`):

```ts
// New format (backupFormat: 2): files stored by storageKey path
if (backupFormat === 2 && file.storageKey) {
```

The format number has since moved on; a modern manifest declares
`backupFormat: 4`. The equality test excludes every archive newer than the one
it was written for, so the lookup falls through to the pre-format-2 layout
(`files/{CATEGORY}/{fileId}_{originalFilename}`), which modern archives do not
use. Nothing is found.

### Why it survived

An equality test against a format number is only correct until the next format
bump, and nothing failed loudly when that happened — the fallback path exists
precisely to be quiet.

### The fix

One line:

```ts
if (backupFormat >= 2 && file.storageKey) {
```

Apply the same change to the `triedPaths` diagnostic at `:352`, so the log
reports the paths actually attempted.

**Also audit for siblings.** Grep for other `backupFormat ===` comparisons
before closing this out; the same pattern anywhere else has the same latent
bug.

### Verification

Covered by the same round-trip as Bug 1 — but only once **Bug 3** is fixed too.
On its own this change is unobservable.

---

## Bug 3 — the files phase runs before anything can receive the bytes

**Severity: Critical.** This is the broadest of the three, and the reason
fixing Bug 2 alone would appear to do nothing.

### Symptom

Restoring into a fresh or wiped target restores no user file, in **either**
mode (`replace` and `new-account`).

### Root cause

`restore.ts` restores in a numbered list its own comment calls *"dependency
order"* (`:65`). Files are **step 5** (`:128`). At that moment neither bridge to
a store can resolve:

- a **project-less** file needs the Quilltap Uploads mount — which
  `deleteUserData` has just `DELETE`d (`lib/backup/delete-service.ts:72`
  truncates `doc_mount_points`). `instance_settings` is deliberately *not*
  cleared, so the pointer survives and dangles.
- a **project-bound** file needs a project store, which does not restore until
  **step 13** (`:292`) — eight phases later.

The document-store mount points themselves do not arrive until **22a**
(`:430`).

### Why it survived

The order is correct for an in-place restore over a populated instance, where
the stores happen to already exist. It only fails when the target is fresh or
wiped — which is exactly the disaster-recovery case restore exists for.

### The fix

Move the step-5 files block to run **after 22a** (document store mount points),
which also puts it after projects (13) and groups (13a). **No write changes —
only when it happens.** Renumber the comment so the list stays readable, and
keep the block's internal order intact.

This is what the v5 port does, and its restore differential passes against v4's
own archives with it.

### Verification

Restore into a **fresh** instance (not an in-place restore — that is the case
that already works) and confirm file bytes land in the right store. Do this for
a project-less file and a project-bound file, in both `replace` and
`new-account` modes.

---

## Bug 4 — import cannot read its own export of a blob over 3 MB

**Severity: High.** Bites any instance with a document-store blob larger than
the 3 MB chunk size.

### Symptom

Importing a `.qtap` export fails outright with:

```
doc_mount_blob_chunk received without preceding doc_mount_blob
```

The export that produced it was written by v4 itself, and reports no error.
Worse than the visible failure: the blob has already been **silently truncated**
before the throw.

### Root cause

`lib/import/quilltap-import-stream.ts:257` allocates the chunk accumulator as a
**sparse** array:

```ts
received: new Array(blobRec.data.chunkCount),
```

and `:284` decides the blob is complete with:

```ts
const allReceived = accum.received.every((v) => typeof v === 'string');
```

`Array.prototype.every` **skips holes**. On a sparse array it returns `true`
immediately — the moment the *first* chunk lands, whatever `chunkCount` says.
v4 then joins what it has (holes render as `''`), pushes the truncated blob, and
**deletes the accumulator**. Chunk 2 arrives with no accumulator and throws.

The writer chunks at `BLOB_CHUNK_BYTES = 3 MB`, so a blob at or under 3 MB is a
single chunk and behaves correctly. Over 3 MB, v4 cannot re-read its own output.

The sharpest detail: v4 **already has** an end-of-stream truncation check with
its own error message (`:318`). The sparse `every` is precisely what made that
code unreachable.

### Why it survived

Sparse-array hole-skipping is a genuine JavaScript trap — `every` on
`new Array(3)` returning `true` surprises most readers. And the guard that
should have caught it was rendered dead by the same bug.

### The fix

One line at `:284`:

```ts
const allReceived =
  accum.received.filter((v) => typeof v === 'string').length === accum.chunkCount;
```

`filter` also skips holes, but counting the survivors against `chunkCount` is
the test that was intended. `accum.chunkCount` must be the value carried on the
accumulator, not `received.length`.

With this in place, a genuinely short stream now reaches the truncation error at
`:318` — v4's own message, finally reachable.

### Verification

- Export an instance holding a document-store blob **larger than 3 MB**
  (a modest PDF or image will do), then import it into a fresh instance and
  confirm the blob arrives byte-identical. Check the sha256, not just the size.
- Truncate an NDJSON export mid-blob and confirm the import fails with the
  truncation message at `:318` rather than the "without preceding" throw.
- Note for anyone touching the chunk size: chunks are base64-encoded
  **separately** and the reader rejoins the *encoded* strings, so only the last
  chunk may carry padding. `BLOB_CHUNK_BYTES` must stay a multiple of 3.

### Note on the format

This is a **reader** fix. The writer is untouched and its bytes do not change,
so archives stay compatible in both directions. v5 already reads a strict
superset of what v4 reads, having taken this fix on its own side.

---

## Bug 5 — a composer run consults the wrong character's fact sheet

**Severity: Medium.** Bites any operator who runs a shared or global custom tool
from the composer in a chat whose first participant is not the character they
are playing. Added and fixed 2026-07-27; **the v5 mirror is still owed.**

### Symptom

The operator plays Charlie and runs the global tool `lambda` from the composer's
Custom Tools button. Charlie's fact sheet lists `toolAbilities: programmable`,
so the tool should take its success branch. Instead it resolves the
`toolAbilities ncontains programmable` outcome — "API Listening Agent not
installed" — which is the branch matching **Friday**, an LLM character in the
same chat whom the operator is not playing.

The run's own record proves what was consulted. From the stored `pascalMeta`:

```
metadataTested: { toolAbilities: "analyze, display, architect" }   // Friday's sheet
outcomeIndex:   2
invokedBy:      "user"
value:          1.9958                                             // passed gte:1
```

The roll would have succeeded against Charlie's sheet. It was tested against
someone else's.

This usually looks correct, which is why it went unnoticed: the first
participant is *usually* the operator's own character. It diverges whenever the
chat was created leading with an LLM character.

### Root cause

Three correct-looking steps compose into the wrong one.

1. **The roster records an arbitrary perspective.** When every character
   resolves a name to the same file — which is exactly the case for a global or
   shared store — `handleList` emits one unlabelled row
   (`app/api/v1/chats/[id]/custom-tools/route.ts:216-223`):

   ```ts
   const { perspective, entry } = sightings[0];
   tools.push(buildListing(entry, perspective, undefined));
   ```

   The comment says so plainly: *"The perspective is arbitrary but must still be
   recorded — POST needs someone to run as."*

2. **`sightings[0]` is the first participant.** `loadPerspectives` (`:107-139`)
   walks `chat.participants` in stored array order. It does not prefer the
   operator's `controlledBy: 'user'` character, and it does not consult
   `isActive` — the field is declared in its parameter type and never read.

3. **The dialog sends that perspective back, and POST believes it.**
   `CustomToolRunDialog.tsx:243` posts `asCharacterId: selectedTool.asCharacterId`,
   and the handler resolves the run against it (`route.ts:356`):

   ```ts
   const metadata = body.asCharacterId ? perspective.metadata : {};
   ```

**The sharpest detail is the comment above that very line.** It explains that a
run naming nobody rolls against an empty sheet *"rather than borrowing some
arbitrary participant's secrets to decide it"* — and then observes, correctly,
that the popup always names someone. For a shared tool, the someone it names
**is** an arbitrary participant. The safeguard is stated and then defeated one
layer up, by a listing that had to write down a name it admits is meaningless.

The same asymmetry governs the state cascade immediately below (`:365-369`): the
`$state` group tier is scoped to `body.asCharacterId`'s groups, so a `$state`
reference in a composer-run tool reads the wrong character's group state by the
same route.

### Scope — what is and is not affected

- **Affected:** a run made from the composer dialog, of a tool every participant
  resolves identically (global store, shared project/group store). Both the
  metadata tests and the `$state` group tier.
- **Not affected — a character rolling mid-turn.** `run_custom` reads
  `context.characterId`, "the rolling character's fact sheet"
  (`lib/tools/handlers/run-custom-handler.ts:115-125`). That path is correct and
  should not be touched.
- **Not affected — a tool whose name means different things to different
  characters.** Those emit one labelled row per variant (`route.ts:229-236`), so
  `asCharacterId` is meaningful and the operator chose it.

Note the interaction with the availability gate (`6864bf0e`): gates are answered
per perspective, before the dedup, so `sightings` holds only characters who
**passed**. For a gated shared tool the arbitrary perspective is therefore the
first *eligible* participant. An operator checking that a gate withholds a tool
can see it succeed from the composer, because it silently ran as someone who
passes.

### Why it survived

The rule is "first participant", and the first participant is usually the
character the operator plays — so the behaviour is right most of the time and
wrong quietly. When it is wrong, the failure is a *plausible outcome*: a tool
that resolves someone else's branch still returns a well-formed result with a
sensible-sounding narration. Nothing errors, and the only place the truth is
written down is `pascalMeta.metadataTested`, which no screen shows.

The v5 differential harness could not have found it: v5 ports this logic
faithfully, line for line, so both sides agree and every case passes. It took a
human running a tool and recognising the answer as belonging to the wrong
character.

### The fix

Prefer the operator's own character when the perspective is arbitrary. The
choice is only made in one place — step 1 above, where the unlabelled row is
built — so the repair belongs there rather than at the POST, which is right to
trust what the listing gave it.

Sketch, at `route.ts:216-223`:

```ts
if (distinct.size === 1) {
  // Prefer the operator's own played character: for a tool everyone resolves
  // identically the perspective is arbitrary, and "arbitrary" should not mean
  // "whoever happens to be first" when one of the candidates is the person
  // actually pressing the button.
  const own = sightings.find(({ perspective }) =>
    userControlledCharacterIds.has(perspective.characterId));
  const { perspective, entry } = own ?? sightings[0];
  tools.push(buildListing(entry, perspective, undefined));
  continue;
}
```

`userControlledCharacterIds` comes from the chat's participants
(`controlledBy === 'user'`), which `handleList` already has in hand as
`chat.participants`. Falling back to `sightings[0]` preserves today's behaviour
for a chat the operator plays no character in, and for a gated tool their own
character does not qualify for.

Two decisions worth making deliberately rather than by omission:

- **Multiple user-controlled characters.** Prefer the *active speaker*
  (`chat.activeTypingParticipantId`) when it names one of them, then fall back to
  the first. Otherwise this trades one arbitrary choice for another.
- **A gate the operator's own character fails.** Falling through to
  `sightings[0]` means the run silently succeeds as someone else — the trap
  described above. It is arguably better to omit the row entirely, or to label
  it with the character it will run as, so the operator can see whose sheet is
  about to be consulted. This is a product call, not a mechanical one.

*As shipped:* both were taken — see
[Decisions taken while fixing](#decisions-taken-while-fixing). The sketch's
`userControlledCharacterIds` set became an ordered candidate list,
`operatorCharacterIds`, because the active-speaker preference needs an order;
the pick itself is `preferOperator`, which also reports whether it had to fall
back, so the row can label itself when it did.

### Verification

- In a chat created **leading with an LLM character** (so the operator's own
  character is not participant[0]), give the two characters fact sheets that
  select different outcomes of the same global tool. Run it from the composer
  and confirm `pascalMeta.metadataTested` records the **operator's** sheet.
- Confirm the character-invoked path is unchanged: have a character roll the
  same tool mid-turn and check `metadataTested` is that character's sheet.
- Confirm a labelled (per-variant) listing still runs as the character on its
  label — that path must not start preferring the operator.
- Check a `$state`-referencing tool run from the composer resolves the group
  tier against the same character the metadata came from.

### Note for the v5 side

v5 reproduces all of this exactly (`crates/quilltap-core/src/api/custom_tools.rs`
— `sightings[0]` at `:293`, the metadata selection at `:418-422`; the rolling
character's sheet at `src/tools/run_custom.rs:545`). It is recorded there as
dogfood finding #30, ruled **v4-faithful and deliberately not fixed** on
2026-07-24, and queued on that repo's "post-5.0 product improvements (v4-first)"
list. **The two sides must move together**: v5's copy is a verbatim port, and
changing it alone would put the port out of step with its own oracle. When this
lands in v4, the v5 mirror follows in the same round, and the m6 parity note for
the composer popup should be updated with it.

---

## Bug 6 — the reconcile and the cold-tier sweep fight, re-embedding the cold tier on every boot

**Severity: High.** Bites every long-lived instance on every restart, and the
bill scales with history: the whole cold tier is re-embedded through the
default profile (on Friday, OpenAI `text-embedding-3-large`) just for the next
maintenance sweep to throw the vectors away again. Added and fixed 2026-07-28.

### Symptom

On the Friday copy, `conversation_chunks` held 11,357 rows with 9,652 (85%)
`embedding IS NULL`, 9,609 of them "recoverable" by the reconcile's own
predicate, and 671 chats matched `SELECT_INCOMPLETE_CHATS` — on an instance
with a working key, a working default profile, and sibling entity types
(`doc_mount_chunks` 0 / 6,598 unembedded, `memories` 13 / 27,132) in perfect
health. No `EMBEDDING_GENERATE` job was PENDING or RUNNING; 67,727 had
COMPLETED.

The job history shows the loop directly: **8,762 chunks were embedded exactly
six times each** (a cohort of 363 sits at 32, the worst single chunk at 54),
and the last wave tells the whole story in one day — a re-embed backlog
finished at 2026-07-28 03:42 UTC, and by that morning the maintenance sweep
had stamped 9,623 chunks back to NULL.

### Root cause

Two subsystems each behave exactly as documented, and their documented
behaviours are mutually hostile:

1. **The stale-chat cache collapse**
   (`lib/background-jobs/maintenance/collapse-stale-chat-caches.ts`)
   cold-tiers every chat with no *played* message inside the retention window:
   it NULLs `chats.renderedMarkdown` and NULLs every
   `conversation_chunks.embedding` for the chat, deliberately, keeping
   `content` for keyword search. The designed recovery is on-demand: the Salon
   chat-open path (`lib/scriptorium/cold-chunk-reembed.ts`) re-embeds a cold
   chat when somebody actually visits it.

2. **The startup reconcile**
   (`lib/startup/reconcile-conversation-rendering.ts`) scans for exactly two
   signals of a half-finished pipeline: `renderedMarkdown IS NULL` with real
   messages, and chunks with `embedding IS NULL`. Both signals are precisely
   the state the sweep just manufactured on purpose. The reconcile cannot tell
   "cold-tiered" from "broken", so it enqueues a `CONVERSATION_RENDER` for
   every cold chat, each of which re-renders the Markdown and re-enqueues an
   `EMBEDDING_GENERATE` per unembedded chunk.

So the steady state is a pendulum: **boot → re-render and re-embed the entire
cold tier (paid) → daily sweep → NULL it all again → next boot.** Between
swings the instance sits at "85% unembedded with nothing queued", which is how
the dogfood pass caught it.

The DEAD-row population is historical, not part of this loop: 1,796 are June
2026 Ollama `llama-server binary not found` failures from before the profile
moved to OpenAI, plus startup orphan kills — the retry-storm class that
`isPermanentEmbeddingError` already ended. The oversize-cap hypothesis
(`EMBEDDING_MAX_CHARS` = 128 KiB chars vs the model's 8,191-token limit) is
also dead on the same evidence: zero token/context-length errors anywhere in
the job history, and zero FAILED `embedding_status` rows for chunks.

### Why it survived

Each half is locally correct and individually tested, and each one's
docstring promises the other's premise away: the sweep says cold chats are
"re-embedded on demand", the reconcile says it is "a no-op on a healthy
instance". Both were written believing NULL meant only one thing. The waste is
also silent — every job COMPLETES, nothing errors, the chat list looks fine,
and the money leaves through a metered API nobody watches per-boot. It took
measuring a real instance's NULL ratio, then noticing the per-chunk completed
job counts were *identical across thousands of chunks* (six each — six
boot/sweep cycles), to see the pendulum.

### The fix

The reconcile now consults the same staleness gate as the sweeps — `isStale`
(`lib/background-jobs/maintenance/collapse-stale-chat-assets.ts`) with the
cutoff from `resolveStaleChatDays()` — and **skips stale chats**: for them,
cold is the desired state, and healing belongs to the reopen path. A chat
whose staleness cannot be determined is also skipped, not healed — the failure
mode of skipping is "re-embedded when next visited", while the failure mode of
healing is this bug.

- `lib/startup/reconcile-conversation-rendering.ts` — the scan carries
  `chats.updatedAt` along, each candidate passes through `isStale` before
  enqueue, and the result gains a `skippedStale` counter (logged).
- `lib/background-jobs/maintenance/collapse-stale-chat-assets.ts` —
  `isStale`'s parameter narrowed to `Pick<ChatMetadata, 'id' | 'updatedAt'>`
  (the two fields it reads) so the raw-SQL scan can call it without hydrating
  full chat rows; no behaviour change.

Genuine mid-conversation gaps keep their safety net: an **active** chat with
unembedded chunks (embedder outage, killed render) is still healed at boot
exactly as before.

**Follow-up (same day):** a smaller pendulum remained on the read path. A cold
chat the user *reads* without playing a message is re-embedded on open by
`cold-chunk-reembed`, but reading never counts as activity, so the chat stays
stale and the next sweep discarded the fresh vectors — one paid re-embed per
read/sweep cycle. Fixed by giving `clearEmbeddingsForChat`
(`lib/database/repositories/conversation-chunks.repository.ts`) an optional
`olderThan` cutoff which the sweep binds to its staleness cutoff: the reopen
re-embed stamps the rows' `updatedAt`, so embeddings younger than the window
are recognized as deliberate warmth and survive. A chat read once stays
semantically searchable for a full retention window from the visit; a chat
unvisited for a window is cold-tiered as designed. No schema change — the
embedding write timestamp is the signal. Nothing else writes chunk rows on a
stale chat: renders fire only on played messages, and the boot reconcile now
skips stale chats (the main fix above).

### Verification

- Unit: `__tests__/unit/lib/startup/reconcile-conversation-rendering.test.ts`
  gains two regression tests — a stale chat in the scan result is skipped (not
  enqueued, counted in `skippedStale`), and a staleness-check failure skips
  rather than heals.
- Against the Friday copy (read-only SQL), simulating the fixed predicate:
  the same 671 incomplete chats split into **595 skipped** (stale, cold-tiered)
  and **76 still healed** (active); of the 9,608 recoverable NULL chunks,
  9,458 belong to the cold tier and stop being re-embedded at boot, 150 belong
  to active chats and still heal. Per boot that retires ~69 M chars (~17 M
  tokens, roughly $2 of `text-embedding-3-large`) of pure churn.
- On a live instance: after restart, the reconcile log line reports
  `skippedStale` ≈ the cold-tier size and `enqueued` only for active gaps;
  opening a cold chat still triggers `cold-chunk-reembed` as before.

### Note for the v5 side

This fix changes `lib/` behaviour that is measurable from job tables and chunk
state, so the oracle baseline moves (families touching
`reconcile-conversation-rendering` and the `isStale` signature). v5 should
inherit the *fixed* semantics — a ported reconcile must gate on the shared
staleness predicate from day one, or the port re-creates the pendulum with the
same wallet attached.

---

## Bug 7 — embedding outcomes never land: the mark methods no-op without a row nobody creates

**Severity: High.** Every `EMBEDDED` and `FAILED` outcome reported by the
embedding pipeline has been silently dropped since the enqueue-time status
upserts were removed, and the boot reconcile re-attempts the same
permanently-unembeddable chunks forever because the `FAILED` marks it would
gate on never exist. Added and fixed 2026-07-28.

### Symptom

The first post-Bug-6 boot of the live Friday instance (2026-07-28T10:59Z)
logged 156 `Permanent embedding error — marked failed, skipping retry` lines
from the `EMBEDDING_GENERATE` handler after OpenAI rejected >8,192-token
conversation chunks — yet `embedding_status` held **zero** FAILED rows, for
any entity type. `EMBEDDED` for `CONVERSATION_CHUNK` sat frozen at 3,586
across ~67k completed jobs. The chunk embedding BLOB writes from the very same
handler, buffered in the very same child write batch, landed normally.

The initial suspicion was the job child's write-buffering pipeline dropping or
misclassifying the `embeddingStatus.*` writes — the `docMountFileLinks`
family had failed that way before. That was wrong: the proxy classifies both
methods as writes, the parent replays them, and the partition commits.

### Root cause

`markAsEmbedded` and `markAsFailed`
(`lib/database/repositories/embedding-status.repository.ts`) were
find-then-update: look up the row for `(entityType, entityId, profileId)`,
and **return `null` when it is missing** — no write, no log, no error.

Three removals over time made "missing" the universal case:

1. `scheduleEmbedding` — which upserted a PENDING row before enqueueing —
   was deleted as dead code (2026-05-27, correctly: it had no callers).
2. The reindex handler's per-entity `upsertByEntity` loop became a
   batch-insert of bare jobs (4.3.0); it now only flips *existing* rows
   via `markAllPendingByProfileId`.
3. The live chunker (`conversation-render.ts`) enqueues `EMBEDDING_GENERATE`
   with no status row at all.

On the Friday copy the kill shot is visible in one query: **every one of the
18,811 surviving `embedding_status` rows references a profileId that no longer
exists.** The current default profile has zero rows, so every single mark call
— embedded or failed, chunk or memory or help doc — resolved to
`findByEntity → null → return null`. 7,771 of 11,357 chunks have no status row
under any profile.

Consequence downstream: Bug 6's fix left condition (B) of the reconcile
guarded only by `LENGTH(content) BETWEEN 1 AND 131072`. A chunk can sit under
that 128 KiB transport cap and still exceed the model's token context
(>8,192 tokens ≈ ~31k chars for `text-embedding-3-large`); 554 such chunks
exist on Friday, 76 active chats carry them, and each boot re-rendered those
chats and re-attempted the embeds, failing identically every time — with no
FAILED row ever landing to break the cycle.

### Why it survived

The methods' contract *looks* like an upsert ("mark entity as failed") but
isn't, and the null return is indistinguishable from success at every call
site — the handler awaits it and moves on. The job COMPLETES (permanent
errors are deliberately swallowed so they don't retry to DEAD), so the job
table shows green. Bug 6's own diagnosis was partially misled by this bug: it
ruled the oversize-cap hypothesis dead partly on "zero FAILED
`embedding_status` rows for chunks" — evidence this bug manufactures. And the
child-write-pipeline priors (the `docMountFileLinks` misclassification, the
Float32Array IPC mangling) made the buffering layer the obvious suspect, when
it was innocent: the write replayed perfectly and then no-oped inside the
repository.

### The fix

- `markAsEmbedded` / `markAsFailed` now **upsert**: update the existing row
  when there is one, create it otherwise. Both take a required `userId` (the
  schema requires one to mint a row); the `EMBEDDING_GENERATE` handler
  (`lib/background-jobs/handlers/embedding-generate.ts`) passes `job.userId`
  at all 13 call sites. No IPC or classification change — the buffered write
  carries the same method name with one more argument.
- With FAILED rows landing, `SELECT_INCOMPLETE_CHATS` in
  `lib/startup/reconcile-conversation-rendering.ts` condition (B) gains a
  `NOT EXISTS` over `embedding_status` rows with `status = 'FAILED'` for the
  profile a re-embed would actually use (default, else first — the same
  selection the render handler makes; covered by
  `idx_embedding_status_entityType_entityId`). No resolvable profile → a
  sentinel is bound that matches nothing and behavior is unchanged.
- The stale rows pointing at deleted profiles are left in place: they match
  no current-profile lookup, so they are inert, and the new upsert mints
  correct rows beside them as jobs complete.

### Verification

- Unit: `__tests__/unit/lib/database/repositories/embedding-status-mark-upsert.test.ts`
  — create-when-missing for both methods, update-when-present, and the
  different-profile-row case that masked the live failure. Three new cases in
  `__tests__/unit/lib/startup/reconcile-conversation-rendering.test.ts` — the
  FAILED exclusion is present in the scan SQL, the no-profile sentinel bind,
  and exclusion-disabled when profile resolution throws.
- Against the Friday copy (read-only SQL): the new scan runs on the real
  schema (671 incomplete pre-gate, matching Bug 6's number), and simulating
  landed FAILED rows for the >31k-char chunks drops the incomplete set to
  596 — the 75 chats whose only "recoverable" chunks are permanently
  unembeddable stop re-rendering; the token-cap tail then belongs entirely to
  the sub-chunking follow-up.
- On a live instance: after one boot's embed attempts,
  `SELECT status, COUNT(*) FROM embedding_status WHERE entityType =
  'CONVERSATION_CHUNK' GROUP BY 1` shows FAILED rows for the oversize cohort
  and a moving EMBEDDED count; the boot after that, those chats leave the
  reconcile's incomplete set.

### Note for the v5 side

This is oracle-moving `lib/` behaviour: `embedding_status` goes from
write-only-in-theory to actually tracking outcomes, and the reconcile's
incomplete-chat set shrinks by the permanently-FAILED cohort. The files
changed are `lib/database/repositories/embedding-status.repository.ts`,
`lib/background-jobs/handlers/embedding-generate.ts`, and
`lib/startup/reconcile-conversation-rendering.ts`. A ported status store must
be an upsert at the mark chokepoint (not a create-at-enqueue plus
update-at-completion pair — that shape is exactly what drifted apart here),
and a ported reconcile must carry the per-profile FAILED exclusion from day
one. The true fix for the oversize chunks themselves remains renderer-side
sub-chunking (tracked separately).

---

# Bugs found since — not yet fixed in v4

Everything below was surfaced by the port **after** Bugs 1–7 were fixed, and is
still present in v4 HEAD `3adefeba`. The same discipline applies: these are
**bugs, not preferences** — cases where v5 and v4 disagree and v4 is wrong, or
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

## Summary

| # | Bug | Who it bites | Severity | Provenance |
|---|---|---|---|---|
| 8 | A character's `properties.json`, if present-but-unparseable, is **silently and permanently overwritten** with defaults on the next save — six fields lost | any instance whose vault file was truncated (iCloud conflict, interrupted write) | **Critical** (silent data loss) | Pinned |
| 9 | Deleting a document store leaves **orphaned** link/folder/document rows (non-atomic, dead delete steps, group-links never touched) — later restores fail with `FOREIGN KEY constraint failed` | every store delete; every restore of a backup taken after one | **High** | Pinned |
| 10 | `conversation_annotations` is wiped by **no delete path at all** — a privacy leak on delete-all, and `UNIQUE constraint failed` on restore into a migrated instance | delete-all; restore | **High** | Pinned |
| 11 | `.qtap` import overwrite: folders not cleared (stale husks), store matched by **name** (a rename misdirects it), and create mints a **fresh id** (no archive is ever re-recognised) | anyone re-importing or overwriting a document store | **High** | Pinned |
| 12 | Restoring a **second-generation** archive loses the archived link ids and re-duplicates store rows every generation | disaster-recovery of an instance that was itself restored | Medium | Pinned |
| 13 | `gcOrphanedFileRow` issues an unconditional `DELETE FROM doc_mount_blobs` and **throws `no such table`** on any mount index that predates the lazily-created blobs table | any store write against an old/hand-built/restored mount index | **High** (crash on 2nd write) | Faithful |
| 14 | A single entity export is **99.7% embeddings** — the real characters `.qtap` is 789.6 MB of regenerable vectors | anyone exporting a character with memories | High | Faithful |
| 15 | `reindexLinkGroupSiblings` is **dead code** (`queryJoined` never selects `linkGroupId`) — editing a hard-linked file leaves its siblings serving **stale chunks** to search and context | anyone using hard-linked documents | Medium | Pinned |
| 16 | `countNonconformingMountChunks` reads `doc_mount_points` from the **wrong database**, always returns 0 — the dimension reconcile never notices non-conforming mount chunks | embedding-dimension changes on document stores | Low | Pinned |
| 17 | 515 conversation chunks are **too large to ever embed** and re-fail every boot — the renderer has no interchange sub-chunking | any long-history instance | Medium | Faithful |
| 18 | A `help/` directory whose only file is **whitespace-only** wipes the **entire** `help_docs` table | a corrupt/blank help doc on disk | Medium (latent) | Faithful |
| 19 | The `permanentlyFailed` embedding census filters `status === 'PERMANENTLY_FAILED'`, a value the enum can never hold — **structurally always 0** | anyone reading the Almanack's embedding health | Low (broken diagnostic) | Faithful |
| 20 | Almanack "Cast sizes" histogram `GROUP BY`s the raw JSON column, so it lists one row per chat instead of per cast size | anyone reading the Almanack | Low | Pinned |
| 21 | Almanack wardrobe-permission counts test `= 1` where the runtime permission is `!== false` (NULL = allowed) — **under-reports** | anyone reading the Almanack | Low | Pinned |
| 22 | Chat GET **omits four controlled-select fields** (Story's Clock, lantern-image alerts, show-thinking, answer-confirmation override) — the select reverts to default after a successful save and never survives a reload | anyone changing those four settings | Medium | Faithful |
| 23 | A participant patch carrying `controlledBy` **returns early**, making `compileAllIdentityStacks` and the status/`isActive` sync below it dead code | changing who controls a participant | Medium | Faithful |
| 24 | `remove-participant` returns a **stale chat** — the response still shows the removed participant as impersonating | removing an impersonated participant | Low | Faithful |
| 25 | "Stop impersonating" is **unreachable from v4's own client**: the client sends `DELETE`, the action is registered only on `POST` | anyone trying to end an impersonation | Medium | Faithful (v5 correct) |
| 26 | On `INSERT_RELATED`, the fold pass starts `relatedMemoryIds` from `[]` and **clobbers** the links the gate just wrote | memory extraction that relates memories | Medium | Faithful |
| 27 | "Speak as &lt;AI character&gt;" flips a badge but the **next message still lands as your own character** — a dead affordance | multi-character chats | Medium | Faithful |
| 28 | A **Staff-signed** ad-hoc announcement reaches the model **anonymous** — the exact anonymous block the attribution feature exists to abolish | operator-authored Staff announcements | Medium | Faithful |
| 29 | A **user-initiated** tool card is headed with the **last speaker's face and name** | anyone running a tool from the composer | Medium | Faithful |
| 30 | A user-initiated private run renders "**whispered to unknown**" instead of the operator's name | composer custom-tool runs | Low | Faithful |
| 31 | OpenRouter's **non-streaming** SDK path refuses vision messages at input validation — v4 sends **no image at all** on regenerate/continuation legs | OpenRouter + images on non-streaming legs | Medium | Faithful |
| 32 | `lib/llm/attachment-support.ts`'s hardcoded map says **OpenRouter can't do vision** while the plugin emits image parts | client-side vision gating for OpenRouter | Low | Faithful |
| 33 | Grok's **text/\*** and **PDF** attachment branches are **dead code** (an images-only mime gate runs first) — Grok always answers "Unsupported file type" | text/PDF attachments to Grok | Low | Faithful |
| 34 | The Anthropic/Grok text-document base64 `catch` is **dead** (`Buffer.from` never throws) — a newline-free base64-charset text attachment ships as **mojibake** | rare text attachments to Anthropic/Grok | Low | Faithful |
| 35 | The Ollama SSE splitter splits each network read on `\n` with **no cross-read buffer** — a JSON object split across two reads is **silently lost** | Ollama streaming | Low | Faithful |
| 36 | The "tools disabled by connection profile" warning box is **dead code** (`undefined === false`) — no v4 user has ever seen it | chats whose profile forbids tools | Low | Faithful (v5 gated) |
| 37 | `AllLLMPauseModal` is **unreachable** — the pause fires and writes `isPaused`, but the client is never told, so it stops with no explanation | chats that hit the all-LLM pause threshold | Low | Faithful |
| 38 | The library picker lists a store's **markdown documents**, but attaching one **404s** ("Mount-point file blob not found") — in both apps | attaching a native-text store document | Low | Faithful |
| 39 | `.qt-text-danger` is **defined in no CSS file** — inline error text renders in ordinary body colour | anyone reading a startup/creation error | Low (cosmetic) | Pinned |
| 40 | The toolbar search dialog **won't close on an outside click** — `.qt-page-toolbar`'s `backdrop-filter` makes it the containing block for the `fixed` backdrop | anyone using the toolbar search | Low | Faithful |
| 41 | `Content-Disposition` leaves the **apostrophe unescaped** in `filename*=UTF-8''…`, so a title with `'` **and** a non-ASCII char downloads with underscores | exporting a chat whose title has both | Low | Pinned |
| 42 | Toasts have **no entry animation** — the markup names keyframes (`slideInUp`) defined nowhere and a Tailwind plugin that isn't loaded | every toast | Low (cosmetic) | Faithful |
| 43 | Orphaned `_thumbnails/` files are **never collected** when a file leaves by any route but in-app delete | long-lived instances | Low (disk leak) | Faithful/shared |

Bugs 9–12 are one family (backup / restore / import integrity) and are best
fixed together, the way Bugs 1–4 were. Bug 8 is the single most urgent item on
this page — it runs against live data and the loss is silent and permanent.

An [Inert dead code](#inert-dead-code) appendix lists a further set of
faithfully-ported-but-dead v4 code paths that bite no user today.

---

## Bug 8 — a corrupt `properties.json` is silently overwritten, losing six fields

**FIXED in v4 (2026-08-06)** — `readCharacterVaultPropertiesForWrite` in
`lib/database/repositories/vault-overlay/vault-readers.ts` distinguishes a
genuinely absent file from a present-but-corrupt one; the RMW seed in
`managed-fields.ts` refuses the write (throws `CharacterVaultUnavailableError`)
rather than seeding defaults over a corrupt sidecar. v5 obligation: retire the
`corrupt` arm pin of `characters_update_tier2_equivalence`.

**Severity: Critical** — silent, permanent data loss against live data. This is
the most urgent item on the page. Surfaced by a dogfood pass (finding #47) and
**ruled URGENT, not post-5.0** (2026-07-31).

### Symptom

A character's `properties.json` becomes unparseable or truncated — an iCloud
sync conflict, an interrupted write. Nothing on the read side shows a problem
(the overlay is fail-soft). The next time that character is saved, six fields —
`pronouns`, `aliases`, `title`, `firstMessage`, `talkativeness`, and
`canChooseOutfit` — are silently overwritten with their defaults, permanently.
The save reports success (`message === null`).

### Root cause

The write overlay's read-modify-write reads the current `properties.json` to
merge the incoming patch over it. On a **parse failure** the read returns
"nothing", and the write path treats "nothing" identically to "the file is
absent" — it seeds an empty-properties default and projects the defaults over
the six fields.

The stale safety comment in
`lib/database/repositories/vault-overlay/managed-fields.ts` (around `:236`) still
reasons from the pre-vault world:

> *"Every other field above has a DB column, so 'the caller passed nothing'
> safely reads as 'the value is empty'."*

That was true once. The vault cutover moved these six fields **out** of the
`characters` table and into `properties.json`, which is now their only home — the
real Friday `characters` table has 28 columns and none of the six. So "the
caller passed nothing" no longer safely reads as "empty"; for a
present-but-corrupt file it means "I could not read the values that already
exist", and defaulting over them destroys them.

This is the exact shape `dcd9440a` fixed for the two `StoreEntity`s (groups,
projects). The character vault is the **third** bag and was missed.

### Why it survived

The read side is fail-soft and shows nothing wrong, and the trigger (a corrupt
file) is rare and looks like ordinary absence to the write path. The loss only
shows the next time that one character is edited.

### The fix

Two edits: (1) in the RMW seed, distinguish a `properties.json` that is
**present but unparseable** from one that is **absent** — refuse the write (or
preserve the unreadable file) in the corrupt case; genuine absence must still
seed defaults. (2) Delete the stale `:236` comment.

### Verification

Corrupt a character's `properties.json`, then save an unrelated field, and
confirm the six fields survive. v5's `characters_update_tier2` differential pins
this in both directions (its `corrupt` arm): v5 refuses with
`properties.json unparseable: …` and writes nothing, while the oracle is
asserted to have clobbered the bag. **Both assertions go red the moment v4 lands
this fix** — retire the divergence then.

---

## Bug 9 — deleting a document store leaves orphaned rows

**Severity: High.** Non-atomic, with two dead delete steps and a whole table
never touched. The orphans it mints are what make later restores fail with
`FOREIGN KEY constraint failed` (dogfood #58).

### Symptom

Delete a document store (a character vault, a project/group store). Measured on
the Friday copy: **43 orphaned `doc_mount_file_links` rows** across 21 vanished
mount points, plus **118 orphaned `doc_mount_folders`**. Nothing errors — read
connections don't enable foreign keys, and a `generateDDL` link table declares
none — so the orphans sit quietly until a backup carries them (raw `SELECT *`)
and a restore inserts them where constraints **are** live
(`PRAGMA foreign_keys = ON`), at which point restore fails.

### Root cause

`app/api/v1/mount-points/[id]/route.ts` `DELETE` (`:185`–`:205`) runs seven
independent awaited repo calls with no surrounding transaction — a partial
failure is exactly how a permanent orphan is minted. Within them:

- **`docMountDocuments.deleteByMountPointId` (`:191`) runs *after*
  `docMountFiles.deleteByMountPointId` (`:188`)** has already emptied the link
  table it reads — a dead step, so native-text documents leak.
- **`docMountBlobs.deleteByMountPointId` (`:192`)** is a copy-paste of the files
  step that never actually names `doc_mount_blobs`. (Blobs happen to survive this
  because they die via the `fileId … ON DELETE CASCADE` FK — so no *blob* leak,
  but the step itself does nothing.)
- **`group_doc_mount_links` is never deleted.** The route deletes
  `projectDocMountLinks` (`:199`–`:201`) only; v4's sole group-link delete is
  `deleteByGroupId`, which no store delete calls.

### Why it survived

Foreign keys are off on the connections that do the deleting, so the orphans are
invisible until a restore turns constraints on — and the restore path is
exercised far less than the delete path.

### The fix

Wrap the cascade in a single transaction; route content through the orphan GC;
delete `group_doc_mount_links`; and add a boot/daily orphan reaper for the rows
already stranded on existing instances. This is what v5 does
(`db::doc_mount_file_links::sweep_orphaned_store_children`, joined to the daily
sweep).

### Verification

v5's `store_delete_equivalence` (7 arms) pins this both ways — v5 → 0 orphans,
v4 → the measured 2/4/3. Each arm carries a "v4 has CONVERGED — retire this
divergence" message that fires when v4 stops leaking.

**Fixed 2026-08-06.** New `lib/mount-index/delete-store-cascade.ts` runs the whole
teardown in one mount-index transaction (chunks → links → GC'd file/document/blob
content → folders → project *and* group links → the store row), skipping tables a
lean instance never created; wired at the DELETE route. Group links get a
`GroupDocMountLinksRepository.deleteByMountPointId`. The reaper lives in
`lib/mount-index/orphan-store-reaper.ts`, is exposed as
`DocMountFileLinksRepository.sweepOrphanedStoreChildren`, and runs at boot
(`instrumentation.ts` Phase 3.3b) and in the daily maintenance sweep.

---

## Bug 10 — `conversation_annotations` is wiped by no delete path

**Severity: High.** A privacy leak on delete-all and a hard restore failure on a
migrated instance (dogfood #57).

### Symptom

"Delete all my data" leaves `conversation_annotations` rows behind. And a
restore into a migrated instance fails with
`UNIQUE constraint failed: conversation_annotations.chatId, messageIndex,
characterName`.

### Root cause

`conversation_annotations` appears on **no** delete path in v4:

- it is absent from `clearFormat3Entities`' `mainTables`
  (`lib/backup/restore/delete-service.ts:34`),
- `deleteUserData` never collects it, and
- `chats.repository.delete()` sweeps only the message rows.

The `UNIQUE` constraint that turns this into a restore failure is a migration
artifact — `migrations/scripts/sqlite-initial-schema.ts` and
`create-conversation-tables.ts` both declare
`UNIQUE("chatId","messageIndex","characterName")` (the older adds
`FOREIGN KEY("chatId") … ON DELETE CASCADE`), while `generateDDL` emits neither.
So only a *migrated* instance reproduces the restore failure; every instance
leaks on delete-all.

### The fix

Add `conversation_annotations` to the delete-all table list. v5 does this via
`delete_all.rs`'s `V5_EXTRA_MAIN_TABLES`, pinned both directions by
`ANNOTATION_DIVERGENCE_KEY` in `system_delete_data_equivalence` (v5 must be 0,
the oracle must be non-zero — v4 converging fails the test).

**Fixed 2026-08-06.** Added to `clearFormat3Entities`' `mainTables`
(`lib/backup/restore/delete-service.ts`, which covers `deleteUserData` since it
routes through it) and a per-chat sweep via `deleteAllForChat` in
`chats.repository.ts#delete()`.

**DDL drift confirmed (out of scope, noted per the session spec).** The
`UNIQUE("chatId","messageIndex","characterName")` constraint and the
`FOREIGN KEY … ON DELETE CASCADE` are declared only by the migrations
(`sqlite-initial-schema.ts` / `create-conversation-tables.ts`), not by
`generateDDL` — which builds `conversation_annotations` from the Zod field
metadata and expresses neither a composite UNIQUE nor a foreign key. So a
*migrated* instance hard-fails restore on the UNIQUE and gets FK-cascade cleanup
on chat delete, while a *fresh* (generateDDL) instance has neither — which is
exactly why the leak-on-delete bites every instance but the restore hard-fail
only migrated ones. `DDL.md` documents the migrated shape and stays accurate;
reconciling `generateDDL` to emit the same constraint is a separate follow-up.

---

## Bug 11 — `.qtap` import overwrite mishandles store identity three ways

**Severity: High.** Three distinct defects on one path, all in
`lib/import/quilltap-import/import-document-stores.ts` (dogfood-driven, ruled
2026-08-04; v5 landed the fixes as `p4.33`).

### The three defects

1. **Overwrite-clear leaves `doc_mount_folders` standing** (`:63`–`:67`). An
   overwrite clears documents but not folders, so an identical re-import leaves
   stale folder husks and logs `UNIQUE` warnings.
2. **Overwrite matches the target store by NAME** (`:55`–`:57`). Rename a store
   and an overwrite silently redirects onto an unrelated store that now happens
   to share the old name.
3. **Import CREATE mints a fresh store id** (`:89`–`:105`), discarding the
   archive's id. Because identity is the id, no archive can ever be
   re-recognised on a later import — every import is a stranger.

### The fix

Clear folders on overwrite; match the target store by **id**; preserve the
archive's id on create. v5 does all three, pinned by `system_import_state`'s
`FOLDER_CLEAR_DIVERGENCE`, `STORE_ID_PRESERVED_ON_CREATE`, the
`execute_folder_overwrite` arm, and the four `store_identity_*` arms — each
fails the day v4 converges.

**Fixed 2026-08-06** in `lib/import/quilltap-import/import-document-stores.ts`:
the overwrite path now also `docMountFolders.deleteByMountPointId(existing.id)`;
the target store is matched via a `byId` map; create passes `{ id: mp.id }` when
the id is free (a `duplicate` import onto an id clash still mints a fresh id).
Preserving ids means a re-import of the same archive now takes the (now-correct)
overwrite path.

## Bug 12 — a second-generation restore loses archived link ids

**Severity: Medium.** This is the residue named at the end of Bug 3
(the "Known residue from Bug 3's placement" note below), promoted to its own
entry because v5 has since **fixed** it and v4 has not (P4.d23, 2026-07-26).

### Symptom

Restore a backup taken from an instance that was **itself** restored. v4 emits
`UNIQUE constraint failed` for the `restored` folder and for
`restored/<name>` link rows; the archived link ids are lost and the store rows
duplicate again — one more copy on every restore generation.

### Root cause

v4 re-ingests **every** user file in an archive unconditionally, so its replay
writes into `restored/<name>` — exactly where the **archived** link rows for
those files already live. The replay gets there first, so the archived rows
collide and are refused. The bytes survive (the replay wrote its own copy); the
link ids do not.

### The fix

Teach the replay to recognise that the archive already carries the store rows for
a file and skip re-ingesting it — the repair v4's own notes name and put out of
scope (this file, "Known residue from Bug 3's placement"). v5 does exactly this
(`orchestrator.rs` → `carried_store_rows`), pinned by
`system_restore_state`'s dedupe arms as evidence the check is small and needs no
phase-order change.

**Fixed 2026-08-06.** `lib/backup/restore/carried-store-rows.ts`
(`makeCarriedStoreRowsResolver`) is consulted by the 22a-bis replay in
`restore.ts`: a project-less file whose archived `storageKey` is a `mount-blob:`
key pointing at a carried blob skips re-ingest and keeps the (remapped)
storageKey, so the archived rows restore intact at 22b–22f. No phase reorder;
first-generation archives (non-`mount-blob:` keys) still run the replay.

## Bug 13 — `gcOrphanedFileRow` throws on a mount index without the blobs table

**FIXED in v4 (2026-08-06)** — `gcOrphanedFileRow` now guards each payload
delete (`doc_mount_documents`, `doc_mount_blobs`) behind a `sqlite_master`
table-existence check, so a document-only / restored / hand-built index that
never held a blob no longer throws on the second write. v5 obligation
(**Faithful**): mirror the guard in `gc_orphaned_file_row` in the same round.
Fix site: `lib/database/repositories/doc-mount-file-links.repository.ts`
(`tableExistsSync` + guarded deletes).

**Severity: High** — a hard throw on the **second** write to any path, on any
mount index that predates the lazily-created blobs table (a restore from an old
backup, a hand-built index). It broke twenty of the port's own fixture families
before v5 was even consulted.

### Root cause

`gcOrphanedFileRow`
(`lib/database/repositories/doc-mount-file-links.repository.ts:144`) runs inside
every content-addressed rewrite and issues `DELETE FROM doc_mount_blobs`
**unconditionally**. But `doc_mount_blobs` has no Zod schema — v4's blobs
repository creates it lazily from hand-written DDL on first access — so on an
index that has never held a blob, the GC hits a table that does not exist:

```
no such table: doc_mount_blobs
  at gcOrphanedFileRow (…/doc-mount-file-links.repository.ts:144:6)
  at DocMountFileLinksRepository.linkDocumentContent (…:1097:71)
  at writeDatabaseDocument (…/database-store.ts:121:3)
```

The first write to a path creates a link; the second orphans a content row and
reaches the GC. Provisioned instances are safe because `doc_mount_blobs` is in
`fresh_schema.json`'s mountIndex — but restored or hand-built indexes are not.

### The fix

Guard the `DELETE` behind existence of the table (or ensure the blobs table
eagerly). v5's `gc_orphaned_file_row` is a faithful port and throws identically —
recorded here rather than diverged, since it is v4's bug to fix.

---

## Bug 14 — an entity export is 99.7% regenerable embeddings

**FIXED in v4 (2026-08-06)** — `stripEmbedding` in
`lib/export/ndjson-writer.ts` drops the `embedding` off every exported memory
before it is serialised (commit `7189a968`, which landed before this bug was
catalogued). `public/schemas/qtap-export.schema.json` documents the field as
deliberately absent and the importer drops any embedding arriving from older
archives. Pinned by `ndjson-roundtrip.test.ts` ("never writes an embedding, in
any form" + "drops embeddings arriving from older archives"). v5 obligation:
the same-round mirror is owed — v5 reproduced the bloat faithfully, and omitting
the field moves the oracle.

**Severity: High** in practice — the real characters `.qtap` is **789.6 MB**, of
which 789.6 MB is memory embeddings (29,030 records at ~29.6 KB each, the
`embedding` field 29,602 bytes of that).

### Root cause

`MemorySchema.embedding` (`lib/schemas/memory.types.ts:73`–`84`) validates to a
`Float32Array`, and `JSON.stringify` of a typed array emits a **1024-key JSON
object** (`{"0":…,"1":…}`), not an array. Every exported memory carries its full
vector, serialised in the most verbose form possible.

The embeddings are **derived data**: both apps carry an `EMBEDDING_GENERATE`
worker and a boot reconcile that refill them from memory text, and the importer's
reconcile already schedules a re-embed. So the export ships ~789 MB of data it can
regenerate for free.

### The fix

Omit embeddings from entity exports (Backup & Restore may keep its own policy).
Shrinks the archive roughly 300× (789.6 MB → ~2.5 MB). v5 reproduces the bloat
faithfully today; this is a v4-first change because omitting the field moves the
oracle.

---

## Bug 15 — `reindexLinkGroupSiblings` is dead code; hard-linked siblings serve stale chunks

**FIXED in v4 (2026-08-06)** — `queryJoined` now selects `l.linkGroupId` and its
mapper carries it, so the joined read no longer reports `linkGroupId: undefined`
and `reindexLinkGroupSiblings` fans the chunk reindex out to every group member.
Retire the `CHUNK_DIVERGENCES` arm of `doc_mount_file_links_tier2_equivalence`
(it goes red now that v4 renders fresh sibling chunks). Fix site:
`lib/database/repositories/doc-mount-file-links.repository.ts` (`queryJoined`).

**Severity: Medium.** The commit that introduced hard-link groups claims to keep
siblings in sync; the chunk half of that sync never runs.

### Symptom

A file hard-linked into two document-store locations is edited in one. The other
location keeps serving the **previous** revision's chunks to semantic search and
to character context.

### Root cause

`reindexLinkGroupSiblings` begins with `findByMountPointAndPath(...)` and returns
early unless the row carries a `linkGroupId`. But every joined read goes through
`queryJoined`
(`lib/database/repositories/doc-mount-file-links.repository.ts`), whose `SELECT`
list ends at `l.lastModified, l.createdAt, l.updatedAt` and **never selects
`l.linkGroupId`**. So the read always yields `linkGroupId: undefined` and the
reindex returns 0. The *content* fan-out works — it runs on raw SQL inside the
write transaction (`:587`–`:598`, `:664`–`:671`) — so rows move; only the chunk
reindex is dead.

### The fix

A one-liner: add `l.linkGroupId` to `queryJoined`'s `SELECT` list (and its
mapper). v5's joined read already carries the column, so its pass runs. Pinned
both directions by `CHUNK_DIVERGENCES` in
`doc_mount_file_links_tier2_equivalence` — named paths show fresh content on v5,
stale on v4; the moment v4 adds the column, the test fails.

---

## Bug 16 — the dimension reconcile counts mount chunks from the wrong database

**FIXED in v4 (2026-08-06)** — `countNonconformingMountChunks` now reads
`doc_mount_points` (the ENABLED filter) and the chunk scan from the mount-index
handle, not the main DB; only the FAILED-status exclusion still comes from the
main DB. The wrong `:351` comment is corrected, and the unit test now places
`doc_mount_points` in the mount-index test DB (the real two-database layout), so
it no longer passes for the wrong reason. Retire the v5 `mountChunks == 0`
tripwire in `embedding_dimension_reconcile`. Fix site:
`lib/startup/reconcile-embedding-dimensions.ts`.

**Severity: Low** — the chunks are not permanently stranded (the reindex
handler's phase 4 heals them whenever a reindex runs for any other reason), but
the reconcile will never enqueue a reindex *for them alone*.

### Root cause

`countNonconformingMountChunks`
(`lib/startup/reconcile-embedding-dimensions.ts:354`) opens with
`tableExists(mainDb, 'doc_mount_points')`, and its comment (`:351`) asserts
"mount point config lives in the main DB". It does not — `doc_mount_points` is a
**mount-index** table (`fresh_schema.json` lists it under `mountIndex`). So on
every real instance the guard is false and the function returns 0 before it ever
opens the mount-index handle. v4's own unit test misses it because it creates
`doc_mount_points` in its *main* test database.

### The fix

Read `doc_mount_points` from the mount-index handle. v5 reproduces the dead count
behind a tripwire (`embedding_dimension_reconcile` asserts `mountChunks == 0`
across every case) — do not "fix" v5 unilaterally; that turns the family red.

---

## Bug 17 — oversize conversation chunks can never embed

**FIXED in v4 (2026-08-06)** — the Scriptorium renderer
(`lib/scriptorium/markdown-renderer.ts`) now splits any interchange whose
rendered text exceeds a per-chunk char budget into several sequential in-context
chunks (`enforceChunkBudget` / `splitInterchange`), and the boot reconcile
(`lib/startup/reconcile-conversation-rendering.ts`) re-renders the existing
oversize cohort once via a new arm (C). v5 obligation flagged loudly below — the
chunk-shape change moves the oracle **significantly**; v5 inherits the
sub-chunking and its landing owes a same-round mirror.

**Severity: Medium.** 515 conversation chunks on the Friday copy are permanently
unembeddable and re-attempted every boot.

### Root cause

The renderer has no interchange sub-chunking, so a long interchange can produce a
single chunk of 34k–117k chars. That is under v5's 131,072-char transport cap but
over the model's context (`text-embedding-3-large` ≈ 8,192 tokens ≈ ~31k chars),
so the embed fails deterministically and the chunk is marked FAILED — and stays
unsearchable. (Distinct from the ~9,098 chunks cold-tiered *by design* and the 43
empty/over-cap chunks both apps correctly exclude.)

### The fix

Renderer-side interchange sub-chunking, so a long interchange embeds as several
in-context chunks. v4-side; v5 inherits it.

### Decisions taken while fixing

- **Char budget: `CHUNK_CHAR_BUDGET = 24,000` chars** (exported from
  `lib/scriptorium/markdown-renderer.ts`). A deliberately conservative proxy for
  ~6k tokens against the ~8,192-token model context (~31k chars at ~4 chars/tok),
  leaving headroom for denser prose. Not a per-model token count — a single
  named char constant with a comment tying it to the 8,192-token limit.

- **Boundary scheme:** split at **message boundaries first** — whole message
  blocks are packed greedily into sub-chunks up to the budget. Only when a
  *single* message block alone exceeds the budget is that block split within, at
  natural boundaries in preference order **paragraph (`\n\n`) → sentence
  (`. `) → any whitespace → hard char cut** (the last only for a pathological
  single token; never silently over budget). Concatenating the pieces reproduces
  the message exactly.

- **Chunk identity / ordering:** each emitted chunk gets its own **sequential
  `interchangeIndex`** (a chunk ordinal, not the interchange ordinal), so the
  `(chatId, interchangeIndex)` chunk key stays unique and `ORDER BY
  interchangeIndex` still yields render order. In the common case (no interchange
  over budget) each interchange is exactly one chunk and the chunk ordinal equals
  the old interchange ordinal, so **output is byte-identical** to the previous
  renderer — the oracle surface for normal history is untouched. `messageIds`
  ride per sub-chunk (a message split across pieces repeats its id);
  `participantNames` are the sub-chunk's own speakers. The `## Interchange N`
  header keeps the interchange ordinal on the first sub-chunk; continuation
  sub-chunks are labelled `(continued k)`. The metadata header stays on chunk 0
  even when interchange 0 is itself split.

- **Embedding preservation on re-key:** `ConversationChunksRepository.upsert`
  now **NULLs a preserved embedding when a chunk's content changes** (and no new
  embedding is supplied). Splitting a formerly-oversize interchange shifts every
  downstream chunk onto new content at an existing index; without this, those
  rows would keep the previous occupant's stale vector. Content-identical
  re-renders (the normal case) still preserve the embedding, so no spurious
  re-embed.

- **Healing the existing cohort — one-shot startup reconcile (option 2).**
  `reconcile-conversation-rendering.ts` gains **arm (C)**: a chat holding an
  un-embedded chunk **over `CHUNK_CHAR_BUDGET` but within `EMBEDDING_MAX_CHARS`**
  is re-rendered once (which now sub-chunks it). FAILED status is *not* excluded
  here — these are exactly the chunks arm (B) skips. It is **self-limiting** (a
  re-rendered chat has no over-budget chunk left, so it stops matching) and reuses
  the existing **stale-chat gate** (Bug 6) in the enqueue loop, so a cold-tiered
  chat is left for its reopen/next-played heal rather than resurrected at boot.
  The >131,072-char / empty cohort (the 43 both apps correctly exclude) is left
  untouched by arm (C) — it stays out of the transport cap window. Verified: the
  cohort re-renders once, then the next boot finds nothing to do.

---

## Bug 18 — a whitespace-only help file wipes the whole `help_docs` table

**FIXED in v4 (2026-08-06)** — the prune guard in `lib/help/help-doc-sync.ts`
now refuses the destructive pass when no file on disk parsed to usable content
while the table is non-empty, not only when the directory is literally empty.
v5 obligation: mirror the guard (pinned by `help_doc_sync_guards_equivalence`).

**Severity: Medium (latent).** Measured: a `help/` directory whose single `.md`
is whitespace-only produced `totalOnDisk 1`, `deleted 3`, rows left 0 — the
table wiped.

### Root cause

`syncHelpDocs` (`lib/help/help-doc-sync.ts`) guards the destructive path with
`if (files.length === 0)` (`:155`) — an empty *directory* is protected, but a
directory holding one whitespace-only file is not: `files.length` is 1, so the
sync proceeds, finds no usable content, and deletes everything already in the
table.

### The fix

Extend the guard to "no file has usable content", not "no file exists". v5
reproduces faithfully, pinned bidirectionally by
`help_doc_sync_guards_equivalence`.

---

## Bug 19 — the `permanentlyFailed` embedding census is structurally always zero

**Severity: Low** (a broken diagnostic, not user data).

### Root cause

The phase-3 Almanack census
(`lib/tools/almanack/phase3-ledgers.ts`) filters
`embedding_status.status === 'PERMANENTLY_FAILED'` — a value the
`EmbeddingStatusEnum` (`PENDING` / `EMBEDDED` / `FAILED`) can never store. The
cell is therefore always 0, whatever the real state. v5 carries it faithfully.

### The fix

Filter on a value the enum can hold (or drop the census). Worth a v4-side look.

---

## Bug 20 — Almanack "Cast sizes" histogram groups by the raw JSON column

**Severity: Low** (dogfood #67). Pinned.

### Symptom

The Cast sizes table lists one row per **chat** (`participants 1 / chats 1`
repeated) instead of a histogram rolled up by cast size; only the empty-cast row
(`0 / 48`) aggregates.

### Root cause

`collectChatBreakdown` (`lib/tools/almanack/phase3-ledgers.ts:183`–`186`) selects
`json_array_length("participants") AS participants` but writes
`GROUP BY participants ORDER BY participants`. SQLite binds the bare name to the
raw `participants` **JSON column**, not the `json_array_length` alias, so every
distinct cast string is its own group. Proven in v4's own
`better-sqlite3-multiple-ciphers` (SQLite 3.53.2), not just system sqlite3.

### The fix

`GROUP BY json_array_length("participants")` (and the matching `ORDER BY`). v5
groups by the length expression; `reconcile_ledger_divergences` in
`almanack_tier2_equivalence` folds v4's per-cast rows to v5's shape and
self-retires when v4's histogram is no longer per-cast (unit test
`participant_histogram_rolls_up_by_cast_size`).

---

## Bug 21 — Almanack wardrobe-permission counts under-report

**Severity: Low** (dogfood #68). Pinned.

### Symptom

"May dress themselves: 0" and "May create outfits: 0" on a 38-character instance.

### Root cause

The query
(`lib/tools/almanack/phase3-ledgers.ts:401`–`402`) counts
`canDressThemselves = 1` / `canCreateOutfits = 1` — explicit opt-in. But the
**runtime** permission is null-safe: `canDressThemselves !== false`
(`lib/services/chat-message/pseudo-tool.service.ts:124`), so a NULL flag means
**allowed**. Every character left at the default is permitted at runtime and
uncounted in the census. ("With a Core-whisper override: 0" is genuinely correct
— it counts explicit `coreWhisperEnabled IS NOT NULL`, and Friday truly has
none.)

### The fix

Count the effective permission (`IS NOT 0`), or keep explicit opt-in by design
— a v4 product call. v5 counts `IS NOT 0`; the same both-directions self-retiring
pin + unit test `dress_outfit_counts_are_effective_permission`.

---

## Bug 22 — chat GET omits four controlled-select fields

**FIXED in v4 (2026-08-06)** — the chat GET projection
(`app/api/v1/chats/[id]/handlers/get.ts`) now emits `timelineMode`,
`alertCharactersOfLanternImages`, `showThinking`, and
`answerConfirmationOverride` (each `?? null`), so the controlled selects survive
a reload. Pinned by `handlers/get.test.ts` ("projects the four controlled-select
fields"). v5 obligation (**Faithful**): re-port the projection in the same round.

**Severity: Medium.** The write lands; the display never reflects it.

### Symptom

Change the Story's Clock (timeline mode), lantern-image alerts, show-thinking, or
the answer-confirmation override. The save succeeds, but the select snaps back to
its default, and a reload can never show the true value — for the Story's Clock,
v4 cannot tell you which clock a chat is on.

### Root cause

The chat GET projection (`app/api/v1/chats/[id]/handlers/get.ts`, ~`:528`–`:568`)
builds an explicit object that **omits** `timelineMode`,
`alertCharactersOfLanternImages`, `showThinking`, and
`answerConfirmationOverride`, though `app/salon/[id]/types.ts:253`–`262` declares
all four on the `Chat` type. So the controlled selects read `undefined`.

### The fix

Add the four fields to the GET projection. v5 ports the projection faithfully but
its SPA works around the gap by keeping the in-session choice (v4's own
`selectedTemplateId` idiom) rather than reverting on a successful save; when v4
grows the projection, v5 re-ports it.

---

## Bug 23 — a `controlledBy` patch returns early, skipping the identity recompile

**FIXED in v4 (2026-08-06)** — `handleParticipantUpdate` (`helpers.ts`) no longer
returns inside the `controlledBy !== undefined` block; it falls through to the
shared tail so the status/`isActive` back-compat sync and
`compileAllIdentityStacks(finalChat)` run for a `controlledBy` patch too, fed by
the post-write re-read. Pinned by `helpers.participant-update.test.ts`. v5
obligation (**Faithful**): the v5 ruling
`update_controlled_by_with_status_early_return` — which pins the early-return
behaviour — must be re-ruled when this lands; mirror in the same round.

**Severity: Medium.**

### Symptom

Changing who controls a participant skips the status/`isActive` back-compat sync
and the identity-stack recompile that a participant update is supposed to run.

### Root cause

`handleParticipantUpdate` re-reads the chat and **returns** inside the
`controlledBy !== undefined` block (`helpers.ts:196`–`199`), so a patch carrying
`controlledBy` never reaches the code below it — including v4's own
`compileAllIdentityStacks(finalChat)` call, which is thereby dead. v5 pins this
with `update_controlled_by_with_status_early_return`.

---

## Bug 24 — `remove-participant` returns a stale chat

**FIXED in v4 (2026-08-06)** — `handleRemoveParticipantAction`
(`actions/participants.ts`) now captures the chat returned by the impersonation
clean-up `repos.chats.update` and returns that, so the response no longer lists
the removed participant in `impersonatingParticipantIds`. Pinned by
`participants-impersonation.test.ts`. v5 obligation (**Faithful**): mirror in the
same round (v5 diffs this as `remove_impersonating_promotes`).

**Severity: Low.**

### Symptom

After removing an impersonated participant, the response body still lists them in
`impersonatingParticipantIds` while the DB does not — the client shows stale
impersonation state until a refetch.

### Root cause

The impersonation clean-up `repos.chats.update` runs **after** `result.chat` is
captured, so the returned object predates the cleanup. v5 diffs this with
`remove_impersonating_promotes`.

---

## Bug 25 — "stop impersonating" is unreachable from v4's own client

**FIXED in v4 (2026-08-06)** — the `stop-impersonate` action is now registered on
the **DELETE** map (`handlers/delete.ts`), matching the verb the client already
sends; the stale **POST** registration was removed (nothing else called it).
Pinned by `handlers/delete.test.ts`. v5 already models it correctly — nothing to
change there.

**Severity: Medium.** v5 already models it correctly — nothing to change there;
this is purely a v4-side defect.

### Root cause

The client sends `DELETE ?action=stop-impersonate`
(`useImpersonation.ts:94`, `:121`), but the action is registered only on the
**POST** map (`handlers/post.ts:129`), and the DELETE handler hard-rejects
unknown actions (`handlers/delete.ts:32`–`35`). So pressing "stop impersonating"
never reaches the server.

### The fix

Register the action on the DELETE map (or move the client to POST).

---

## Bug 26 — `INSERT_RELATED` clobbers the related-memory links it just wrote

**FIXED in v4 (2026-08-06)** — the `INSERT_RELATED` arm of
`createMemoryWithGate` (`lib/memory/memory-service.ts`) now returns the
**post-link** row (`{ ...memory, relatedMemoryIds: linkedIds }`) instead of the
stale pre-link object, and the fold-episode pass's union comment
(`lib/memory/fold-episode-pass.ts`) is corrected to name that dependency. Pinned
by `memory-service.test.ts` ("returns the POST-LINK row so relatedMemoryIds
carries the gate links"). v5 obligation: same-round mirror owed — v5 reproduces
the clobber faithfully.

**Severity: Medium.**

### Root cause

On an `INSERT_RELATED` memory action, the gate links related memories, then the
fold pass's `relatedMemoryIds` union **starts from `[]`** and overwrites those
links — because on `INSERT_RELATED` the gate returns the memory object as it was
**before** `linkRelatedMemories` ran, despite v4's own comment claiming the
opposite. Every other action reads the persisted row and is fine. v5 reproduces
faithfully.

### The fix

Have the gate return the post-link row (or have the fold pass re-read it) on
`INSERT_RELATED`.

---

## Bug 27 — "Speak as an AI character" is a dead affordance

**FIXED in v4 (2026-08-06) — decision: the preferred path (wire "Speak as"
through impersonation, honoured for real).**

*Investigation.* "Speak as" was already wired to the impersonation start path
(`onImpersonate` → `POST ?action=impersonate` → `addImpersonation`), but
`addImpersonation` never flipped `controlledBy`. The connection-profile "User
(you type)" option, by contrast, goes through `handleParticipantUpdate`, which
**couples** `controlledBy: 'user'` ⇔ impersonation. And the client's
stop-impersonate flow prompts for an LLM profile to hand the character back —
which only makes sense if starting impersonation had made the character
user-controlled. So the intended design is `impersonate ⇔ controlledBy: 'user'`;
the impersonate **action** simply forgot to flip it. This was not genuinely
ambiguous, so the preferred fix was taken (no user prompt needed).

*Fix.* `handleImpersonate` now sets the participant to `controlledBy: 'user'`
(and `handleStopImpersonate` hands it back to `'llm'`), restoring that invariant.
Both recompile the identity stacks (`controlledBy` alters `{{user}}`/`{{persona}}`
for everyone). This leaves the differential-verified `findActiveUserParticipant`
**untouched** — attribution now works because the seat is genuinely
user-controlled while impersonated, and the "You"/"Speaking as" badge becomes
truthful without further change. Pinned by `participants-impersonation.test.ts`
(the action flips control) and `turn-manager.test.ts` ("honours a formerly-LLM
character once impersonation flips it to user-controlled"). v5 obligation
(**Faithful**): mirror in the same round; this is the v4 decision that
`chat_cast_routes_equivalence` was waiting for.

**Severity: Medium** — the UI offers an action it does not perform.

### Symptom

Click "Speak as &lt;AI character&gt;". The card flips to a "You" badge, but the
next message you type still lands as your existing user-controlled character.

### Root cause

"Speak as" is offered on **any** non-user participant
(`ParticipantCard.tsx:600`, `!isUserParticipant`), but attribution goes through
`findActiveUserParticipant` (`turn-manager/utils.ts:99`–`107`), which honours
`activeTypingParticipantId` **only** when that participant is
`controlledBy === 'user'`, else falls back to the first user-controlled seat. So
selecting an AI character changes the badge and nothing else. (The misleading
"You" badge is also v4 — `ParticipantCard.tsx:358` shows it for user-controlled
participants *or when impersonating*.)

### The fix

Either restrict the "Speak as" affordance to participants attribution can honour,
or extend `findActiveUserParticipant` to impersonate the chosen character. This
touches differential-verified turn resolution, so v5 ports it faithfully and
waits for the v4 decision (covered by `chat_cast_routes_equivalence`).

---

## Bug 28 — a Staff-signed ad-hoc announcement reaches the model anonymous

**Severity: Medium.** Ruled a bug in **both** apps (2026-08-02).

### Symptom

An ad-hoc announcement signed as the Host / Suparṇā reaches the LLM as a bare
`user` turn with no attribution — the same anonymous block the whole announcement
attribution feature exists to abolish.

### Root cause

Attribution keys on `customAnnouncer`, which the Insert Announcement dialog
writes only in `character` and `custom` modes. **`staff` mode** carries a
`systemSender` and no `customAnnouncer`, so it passes through untouched
(`lib/chat/context/announcement-attribution.ts` — `resolveAnnouncerName` at
`:45`, keyed on `customAnnouncer` at `:65`/`:88`; the doc-comment at `:75` says
"Staff announcements carry their identity in their prose already", which holds
only when Staff *wrote* the prose, not when an operator signed an ad-hoc one as
Staff).

### The fix

Widen `resolveAnnouncerName` to take the message's `systemSender` when
`customAnnouncer` is absent, resolve the display name from the existing staff
table (`lib/chat/staff-display-names.ts`), and emit the `[Name] ` prefix. v5
mirrors this exactly and must move in the same round.

---

## Bug 29 — a user-initiated tool card wears the last speaker's face

**Severity: Medium.**

### Symptom

Run an RNG/tool from the composer. Its own line correctly reads "You ran rng.",
but the card is headed with an unrelated character's avatar and bold name — the
last participant to speak.

### Root cause

The pending tool result is persisted with `initiatedBy: 'user'` and **no**
`participantId` (`orchestrator.service.ts:611`–`630`). The renderer does a
positional borrow — a TOOL row with no participant takes the nearest preceding
assistant's participant, stopping at a USER boundary
(`VirtualizedMessageList.tsx:228`–`247`) — and because the tool row is written
*before* the user's message, that's whoever spoke last. The name block is
`ToolMessage.tsx:428`–`443`.

### The fix

Suppress the positional borrow when `initiatedBy === 'user'` and head the row
with the operator. v5's borrow (`chat-view-model.ts::resolveToolAvatar`) is a
verbatim port; the two sides move together.

---

## Bug 30 — "whispered to unknown" for a user-initiated private run

**Severity: Low.**

### Root cause

A standalone user-initiated Pascal custom-tool run whispers to `ctx.user.id` —
the operator's userId, deliberately not a participant id
(`app/api/v1/chats/[id]/custom-tools/route.ts:318`–`320`). The renderer resolves
each `targetParticipantId` via `participantNames?.[id] || 'unknown'`
(`MessageRow.tsx:323`–`324`), and `participantNames` is keyed only by
character-participant ids, so the operator's own userId never resolves and falls
to "unknown".

### The fix

When a `targetParticipantId` equals the operator's own userId, render "you" /
"yourself". v5 mirrors `message-row.ts:490`.

---

## Bug 31 — OpenRouter's non-streaming path refuses vision sends

**Severity: Medium.** Re-confirmed at `@openrouter/sdk` **1.2.2**.

### Root cause

On the **non-streaming** legs (regenerate, continuation), the `@openrouter/sdk`
request path rejects v4's own content-parts (image) messages at input
validation, client-side — so v4 sends **nothing** and the image never reaches the
model. (The streaming path is fine.) v5 reproduces the refusal; pinned by two
entries in `EXPECTED_REFUSALS` in the request-builder differential.

### The fix

A v4-side SDK/message-shape reconciliation for the non-streaming vision path.

---

## Bug 32 — a stale client capability map hides OpenRouter vision

**Severity: Low.**

### Root cause

`lib/llm/attachment-support.ts`'s hardcoded capability map declares OpenRouter
**unsupported** for attachments, while the OpenRouter plugin actually emits image
parts. The client's vision-capability gating for OpenRouter is therefore wrong.
v5 was not bent to match the stale map.

### The fix

Update the map to match the plugin (or derive it from the plugin manifest).

---

## Bug 33 — Grok's text and PDF attachment branches are dead code

**Severity: Low.**

### Root cause

Grok's `text/*` and PDF handling never runs: its supported-mime gate is
images-only and runs first, so text/PDF attachments always fall to
"Unsupported file type", and the "requires Grok Files API" arm is likewise
unreachable. Ported as written per the vestigial-cruft rule; pinned by the grok
`unsupported-attachment` vector. (Grok Files API support remains v4's own
deferral.)

---

## Bug 34 — a dead base64 `catch` ships text attachments as mojibake

**Severity: Low.**

### Root cause

For a newline-free, base64-charset **text** file attached to Anthropic or Grok,
v4 wraps the decode in a `try/catch` — but `Buffer.from(s, 'base64')` **never
throws**; it leniently mangles (`"hello" → "��e"`, `"x=1" → ""`). The
catch is dead code, so the mangled bytes ship. v5 now reproduces v4's mojibake
byte-for-byte (via `node_lenient_base64`, pinned by
`text-attachment-mangled-b64`) rather than shipping the raw content.

### The fix

Detect the mangle (round-trip check) rather than relying on a throw.

---

## Bug 35 — the Ollama SSE splitter drops JSON split across reads

**Severity: Low.**

### Root cause

The Ollama stream decoder splits each network read on `\n` with **no cross-read
buffer**, so a JSON object that straddles two network reads is silently lost —
occasional dropped content on Ollama streaming, by design of the splitter. v5
reproduces the boundary-sensitivity (Rust-side unit test).

### The fix

Buffer the tail of each read until the next newline.

---

## Bug 36 — the "tools disabled by profile" warning box is dead code

**FIXED in v4 (2026-08-06)** — `getConnectionProfile`
(`lib/services/chat-enrichment.service.ts`) now projects `allowToolUse` (and the
mirror `getEnrichedConnectionProfile` in `helpers.ts` does too), so
`ChatModals.tsx`'s `allowToolUse === false` condition can finally be true and the
warning box fires for a tools-forbidding profile. The box was kept, not deleted.
Pinned by `chat-enrichment.service.test.ts` ("projects allowToolUse when the
profile forbids tools"). v5 obligation (**Faithful**, v5 keeps a gated box):
mirror the projection in the same round.

**Severity: Low.** No v4 user has ever seen it.

### Root cause

`ChatModals.tsx` renders the warning when an LLM participant's profile has
`allowToolUse === false` (the box explains the tool-settings dialog is moot). But
`getConnectionProfile` (`lib/services/chat-enrichment.service.ts:354`–`379`)
projects only `{ id, name, provider, modelName, apiKey }` — never `allowToolUse`
— so the condition is always `undefined === false` and can never be true. A chat
whose profile really does forbid tools looks identical to one that allows them.

### The fix

Add `allowToolUse` to the enrichment projection (the warning starts working) or
delete the box. v5 keeps a gated box + input so one binding turns it on if v4
grows the projection.

---

## Bug 37 — `AllLLMPauseModal` is unreachable; the pause is silent

**FIXED in v4 (2026-08-06)** — the chat GET projection now emits `isPaused` and
`allLLMPauseTurnCount` (`handlers/get.ts`), and `SalonView` gained an opener
effect that opens `AllLLMPauseModal` whenever `chat.isPaused && isAllLLM`. Because
the chain-complete SSE event already triggers `fetchChat`, that one effect covers
both a live pause and loading an already-paused all-LLM room — no new SSE event,
the transport is left alone. The modal was kept, not deleted. Pinned by
`handlers/get.test.ts` ("projects isPaused and allLLMPauseTurnCount"). v5
obligation (**Faithful**): mirror the projection + opener in the same round.

**Severity: Low.**

### Root cause

The all-LLM-pause **does** fire — the chat stops at the turn-count threshold and
writes `isPaused` — but the dialog that would explain it can never open:
`ChatModals.tsx:423` mounts `AllLLMPauseModal` and `SalonView` wires all three
handlers, yet `setAllLLMPauseModalOpen(true)` appears **nowhere** in v4 (every
occurrence passes `false`). `allLLMPauseTurnCount` / `isPaused` are in neither
app's chat-GET projection, so the client is never told; the user gets a silent
pause with no explanation. (`ChatModals.tsx:427` even computes the dead modal's
`nextPauseAt`.)

### The fix

Either give the modal an opener (and project the fields it needs) or delete it.

---

## Bug 38 — the library picker lists markdown documents that 404 on attach

**FIXED in v4 (2026-08-06)** — took the preferred path: `handleAttachMountFile`
(`app/api/v1/chats/[id]/files/route.ts`) now serves a native-text document when
no blob exists, and the LLM-side resolver `loadMountFileAsAttachment`
(`lib/chat-files-v2.ts`) loads the document text as a text `FileAttachment`, so
an attached `.md`/`.txt`/`.json` document actually reaches the model. The chat
file-list GET was taught the same fallback. Clean-mime helper
`nativeTextAttachmentMime` in `lib/mount-index/path-utils.ts`. v5 obligation
(**Faithful**): mirror the document-serving attach path in the same round.

**Severity: Low.** Affects both apps.

### Root cause

A `.md`/`.txt`/`.json` PUT into a database store takes the native-text
**document** branch (`lib/mount-index/store-file.ts:202`, `writeDatabaseDocument`
— no `doc_mount_blobs` row), but `handleAttachMountFile` requires a **blob**
(`app/api/v1/files/route.ts:271`–`279`, `notFound('Mount-point file blob')`). So
the picker's browse panel shows the document and attaching it fails with
"Mount-point file blob not found".

### The fix

Filter native-text documents out of the picker's store browse, or teach
attach-mount-file to hand the Librarian a document (it has `extractedText`).

---

## Bug 39 — `.qt-text-danger` is defined in no CSS, so error text is body-coloured

**Severity: Low (cosmetic).** Pinned.

### Root cause

The class `qt-text-danger` is referenced by markup (`StartupProgress.tsx`,
`ChatCreationProgressModal.tsx`) but has **no CSS rule anywhere** — an exhaustive
search of v4's CSS finds nothing — so each site inherits ordinary body colour.
Inline errors like "Connection lost. The server may still be starting." read as
informational.

### The fix

Define `.qt-text-danger { color: var(--color-destructive) }`. v5 fixed it in
`_utilities.css` and records the identical v4 one-liner.

---

## Bug 40 — the toolbar search dialog won't close on an outside click

**Severity: Low.**

### Root cause

`.qt-page-toolbar` sets `backdrop-filter: var(--qt-app-header-blur)`
(`_layout.css:709`), which makes the toolbar a containing block for
`position: fixed` descendants. v4's `SearchBar` renders `SearchDialog` **inline,
with no portal**, inside `<div className="qt-page-toolbar">`, so the dialog's
`fixed inset-0` backdrop resolves against the toolbar (~`56,0 1224×64`), not the
viewport — there is no backdrop outside the toolbar to click. Only the
document-level `Esc` handler closes it.

### The fix

Portal the dialog host out of the toolbar (to `document.body`), as v5 does.

---

## Bug 41 — `Content-Disposition` mangles a filename with an apostrophe and non-ASCII

**Severity: Low.** Pinned.

### Symptom

Export a chat titled `Wings Over Suparṇā's Quiet Governance`; it downloads with
the two non-ASCII characters replaced by underscores (the ASCII fallback)
instead of the real UTF-8 name.

### Root cause

`lib/api/content-disposition.ts:16`–`17` builds `filename*=UTF-8''${…}` with
`encodeURIComponent`, which leaves `'` **unescaped**. In RFC 8187 the apostrophe
is the delimiter in `charset'lang'value`, so an unescaped `'` inside the value
makes `filename*` ungrammatical; the browser discards it and falls back to the
ASCII substitution (`filename.replace(/[^\x00-\x7F]/g, '_')`). Affects any title
with an apostrophe **and** a non-ASCII character.

### The fix

Percent-encode `'` in the ext-value. v5 fixed it (`encode_ext_value`), pinned by
the corpus vector `ascii-apostrophe-with-non-ascii` — a vanished divergence fails
loudly, so the carve-out self-retires when v4 ships.

---

## Bug 42 — toasts have no entry animation

**Severity: Low (cosmetic).**

### Root cause

The toast body carries `animate-in fade-in slide-in-from-bottom-3 duration-300`
plus an inline `animation: 'slideInUp 0.3s ease-out'`, but `slideInUp` is defined
**nowhere** in v4 (`grep -rn slideInUp app lib components` returns only the call
site) and `animate-in` belongs to `tailwindcss-animate`, which v4's
`tailwind.config.ts` does not load. So the toast appears instantly. v5
reproduces the instant appearance.

### The fix

Define the `slideInUp` keyframes (or load the Tailwind plugin).

---

## Bug 43 — orphaned thumbnails are never collected

**FIXED in v4 (2026-08-06)** — the daily maintenance pass now runs an
orphan-thumbnail sweep (`lib/background-jobs/maintenance/sweep-orphaned-thumbnails.ts`,
wired into `lib/background-jobs/scheduled-maintenance.ts` as step 7): it lists
`_thumbnails/`, parses the leading `fileId` (`parseThumbnailStorageKey` in
`lib/files/thumbnail-utils.ts`, the inverse of the key builder), and deletes
entries whose `files` row is gone; unparseable names are skipped and logged, not
deleted. **v5's half is still open**: v5 additionally skips v4's
`cleanupThumbnails` on its four delete/overwrite paths (`api/files.rs:537`,
`:1123`), so a v5-driven instance still leaves per-delete thumbnails behind —
v5 must call `cleanupThumbnails` at those two sites *and* mirror this sweep.

**Severity: Low (disk leak).** Partly a shared gap.

### Root cause

`files/_thumbnails/` only ever grows. **Neither app** has a sweep for a
thumbnail whose source file left by some route other than an in-app delete
(a restore, a delete-all, an out-of-app edit) — which is the residue actually
observed on the real copy. (Separately, v5 skips v4's `cleanupThumbnails`
— `lib/files/thumbnail-utils.ts:138` — on all four of its delete/overwrite paths,
`api/files.rs:537` and `:1123`, so a v5-driven instance also leaves per-delete
thumbnails behind; that half is v5's to close.) The cache is otherwise
self-healing — `_thumbnails/{fileId}_{size}.webp` is derived and regenerated on
demand.

### The fix

Add the orphan-thumbnail sweep neither app has; on the v5 side, also call
`cleanupThumbnails` at the two skipped sites for v4 parity.

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

---

## Status

| # | Bug | Fixed in v4? | Fix site | v5 status |
|---|---|---|---|---|
| 1 | Mount points / file links rejected | **Yes** (2026-07-26) | `lib/backup/restore/mount-index-coercion.ts`, applied at `restore.ts` 22a / 22d | Converged — v4 now restores them too |
| 2 | `backupFormat === 2` gate | **Yes** (2026-07-26) | `lib/backup/restore/archive.ts:333` | Converged — gate is `>= 2` on both sides |
| 3 | Files phase ordering | **Yes** (2026-07-26) | `lib/backup/restore/restore.ts` — step 5 moved to 22a-bis | Converged — files run after 22a on both sides |
| 4 | Sparse-array blob finalization | **Yes** (2026-07-26) | `lib/import/quilltap-import-stream.ts:284` | Converged — both readers wait for every chunk |
| 5 | Composer run consults the first participant's sheet | **Yes** (2026-07-27) | `app/api/v1/chats/[id]/custom-tools/route.ts` — `operatorCharacterIds` + `preferOperator`, applied at the single-variant listing and at POST's fallback | **Owed** — reproduced faithfully on purpose (finding #30); the mirror change is due in the same round |
| 6 | Boot reconcile re-embeds the cold tier every restart | **Yes** (2026-07-28) | `lib/startup/reconcile-conversation-rendering.ts` — stale chats skipped via the shared `isStale` gate; `isStale` param narrowed in `lib/background-jobs/maintenance/collapse-stale-chat-assets.ts`; follow-up: `clearEmbeddingsForChat` age guard in `lib/database/repositories/conversation-chunks.repository.ts` + `lib/background-jobs/maintenance/collapse-stale-chat-caches.ts` so reopen re-embeds survive the sweep | Inherit the fixed semantics when the reconcile is ported — see the entry's note |
| 7 | Embedding outcomes never land — mark methods no-op without a status row nobody creates; reconcile re-attempts permanently-FAILED chunks every boot | **Yes** (2026-07-28) | `lib/database/repositories/embedding-status.repository.ts` — `markAsEmbedded`/`markAsFailed` upsert (required `userId`); `lib/background-jobs/handlers/embedding-generate.ts` — `job.userId` threaded at all 13 call sites; `lib/startup/reconcile-conversation-rendering.ts` — condition (B) excludes chunks FAILED for the current default profile | Inherit the fixed semantics — the status store's mark chokepoint must upsert, and the reconcile carries the per-profile FAILED exclusion from day one; see the entry's note |
| 8 | Corrupt `properties.json` silently overwritten with defaults on next save — six fields lost | **Yes** (2026-08-06) | `lib/database/repositories/vault-overlay/vault-readers.ts` — new `readCharacterVaultPropertiesForWrite` returns null only on `NOT_FOUND`, throws `CharacterVaultUnavailableError` on unreadable/unparseable/schema-invalid; `lib/database/repositories/vault-overlay/managed-fields.ts` — RMW seed uses it (refuse, don't seed defaults), stale `:236` comment rewritten | **Owed** — retire the `corrupt` arm pin of `characters_update_tier2_equivalence`; v4 now refuses + writes nothing, so the arm converges to plain equality |
| 18 | Whitespace-only help file wipes the whole `help_docs` table | **Yes** (2026-08-06) | `lib/help/help-doc-sync.ts` — prune guard extended from "no file exists" to "no file has usable content while the table is non-empty" | **Owed** — mirror the guard; pinned bidirectionally by `help_doc_sync_guards_equivalence` |
| 9 | Deleting a store leaks orphan link/folder/document rows (non-atomic, dead steps, group-links never deleted) | **Yes** (2026-08-06) | `lib/mount-index/delete-store-cascade.ts` (single-transaction cascade, group-links included) wired at `app/api/v1/mount-points/[id]/route.ts` DELETE; `lib/mount-index/orphan-store-reaper.ts` + `DocMountFileLinksRepository.sweepOrphanedStoreChildren` joined to the daily sweep (`lib/background-jobs/scheduled-maintenance.ts`) and run at boot (`instrumentation.ts` Phase 3.3b); `GroupDocMountLinksRepository.deleteByMountPointId` added | **Owed** — retire the 7 `store_delete_equivalence` arms; v4 now leaks 0 |
| 10 | `conversation_annotations` on no delete path — privacy leak on delete-all, `UNIQUE constraint failed` on restore into a migrated instance | **Yes** (2026-08-06) | `lib/backup/restore/delete-service.ts` — added to `clearFormat3Entities` `mainTables` (covers `deleteUserData`); `lib/database/repositories/chats.repository.ts` `delete()` — per-chat `deleteAllForChat` sweep | **Owed** — retire `system_delete_data_equivalence` → `ANNOTATION_DIVERGENCE_KEY` (v5 = 0, oracle non-zero) |
| 11 | `.qtap` import overwrite mishandles store identity three ways | **Yes** (2026-08-06) | `lib/import/quilltap-import/import-document-stores.ts` — clear folders on overwrite, match target by **id**, preserve archive id on create | **Owed** — retire `system_import_state` → `FOLDER_CLEAR_DIVERGENCE`, `STORE_ID_PRESERVED_ON_CREATE`, `execute_folder_overwrite`, four `store_identity_*` |
| 12 | Second-generation restore loses archived link ids, re-duplicates store rows | **Yes** (2026-08-06) | `lib/backup/restore/carried-store-rows.ts` (`makeCarriedStoreRowsResolver`) consulted by the 22a-bis replay in `lib/backup/restore/restore.ts` — carried project-less store rows skip re-ingest | **Owed** — retire `system_restore_state` dedupe arms (ruled `REPLAY_DEDUPE`) |
| 13 | `gcOrphanedFileRow` throws on a mount index without the blobs table | **Yes** (2026-08-06) | `lib/database/repositories/doc-mount-file-links.repository.ts` — payload deletes guarded behind a `sqlite_master` existence check (`tableExistsSync`) | **Owed** (Faithful) — mirror the guard in `gc_orphaned_file_row` |
| 15 | `reindexLinkGroupSiblings` dead code; hard-linked siblings serve stale chunks | **Yes** (2026-08-06) | `lib/database/repositories/doc-mount-file-links.repository.ts` — `queryJoined` selects + maps `l.linkGroupId` | **Owed** — retire `doc_mount_file_links_tier2_equivalence` → `CHUNK_DIVERGENCES` |
| 16 | Dimension reconcile counts mount chunks from the wrong database | **Yes** (2026-08-06) | `lib/startup/reconcile-embedding-dimensions.ts` — `doc_mount_points` + chunk scan read from the mount-index handle; comment + unit-test DB placement corrected | **Owed** — retire `embedding_dimension_reconcile` `mountChunks == 0` tripwire |
| 38 | Library picker lists markdown documents that 404 on attach | **Yes** (2026-08-06) | `app/api/v1/chats/[id]/files/route.ts` + `lib/chat-files-v2.ts` — serve native-text documents (no blob) as text attachments; `nativeTextAttachmentMime` in `lib/mount-index/path-utils.ts` | **Owed** (Faithful) — mirror the document-serving attach path |
| 43 | Orphaned thumbnails never collected | **Yes** (2026-08-06) | `lib/background-jobs/maintenance/sweep-orphaned-thumbnails.ts` wired into `scheduled-maintenance.ts`; `parseThumbnailStorageKey` in `lib/files/thumbnail-utils.ts` | **Owed** (Faithful) — mirror the sweep **and** call `cleanupThumbnails` at v5's two skipped delete/overwrite sites (`api/files.rs:537`, `:1123`) |
| 22 | Chat GET omits four controlled-select fields | **Yes** (2026-08-06) | `app/api/v1/chats/[id]/handlers/get.ts` — project `timelineMode`, `alertCharactersOfLanternImages`, `showThinking`, `answerConfirmationOverride` | **Owed** (Faithful) — re-port the projection |
| 23 | `controlledBy` patch returns early, skipping the recompile | **Yes** (2026-08-06) | `app/api/v1/chats/[id]/helpers.ts` — `handleParticipantUpdate` falls through to the shared sync + `compileAllIdentityStacks` tail | **Owed** (Faithful) — re-rule `update_controlled_by_with_status_early_return` |
| 24 | `remove-participant` returns a stale chat | **Yes** (2026-08-06) | `app/api/v1/chats/[id]/actions/participants.ts` — return the post-cleanup chat from `repos.chats.update` | **Owed** (Faithful) — mirror; v5 `remove_impersonating_promotes` |
| 25 | "Stop impersonating" unreachable (client sends DELETE) | **Yes** (2026-08-06) | `app/api/v1/chats/[id]/handlers/delete.ts` — register `stop-impersonate` on DELETE; removed the stale POST registration | Converged — v5 already models it correctly |
| 27 | "Speak as an AI character" is a dead affordance | **Yes** (2026-08-06) | `app/api/v1/chats/[id]/actions/participants.ts` — `handleImpersonate`/`handleStopImpersonate` flip `controlledBy` (`user` ⇔ `llm`) + recompile stacks | **Owed** (Faithful) — the v4 decision `chat_cast_routes_equivalence` was waiting for |
| 36 | "Tools disabled by profile" warning box is dead code | **Yes** (2026-08-06) | `lib/services/chat-enrichment.service.ts` (+ `helpers.ts`) — project `allowToolUse` on the connection profile | **Owed** (Faithful) — mirror the projection; v5 keeps a gated box |
| 37 | `AllLLMPauseModal` unreachable; the pause is silent | **Yes** (2026-08-06) | `handlers/get.ts` — project `isPaused` + `allLLMPauseTurnCount`; `app/salon/[id]/SalonView.tsx` — opener effect on `isPaused && isAllLLM` | **Owed** (Faithful) — mirror the projection + opener |

**Bugs 22–25, 27, 36, 37 are now fixed in v4 (2026-08-06), joining 13, 15, 16, 38,
43; bugs 14, 17, 19–21, 28–35, 39–42 remain `No` — not yet fixed in v4** (bugs
8–12, 18, and 26 fixed earlier). Their
per-bug fix sites and v5 status are in
[Bugs found since](#bugs-found-since--not-yet-fixed-in-v4); they are not repeated
row-by-row here. The coordination surface, when they are taken, is these
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

### Known residue from Bug 3's placement (not a regression; follow-up)

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
