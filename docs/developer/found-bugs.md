# Found Bugs — defects surfaced by the v5 port

**Last Updated**: 2026-07-28
**Codebase**: Quilltap v4.8.0-dev (HEAD `e8a49597`)
**Provenance**: the quilltap-v5 native port's differential harness, and its
dogfood walks against a copy of real data
**Status**: Bugs 1–6 are **fixed in v4** (see [Status](#status)). Bug 5 was
added and fixed on 2026-07-27; it was surfaced by a v5 dogfood walk rather than
by the harness, and **v5 still owes the mirror change**. Bug 6 was added and
fixed on 2026-07-28, surfaced by a dogfood measurement pass against the Friday
copy; v5 owes the mirror of its reconcile if/when that subsystem is ported.

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

## Status

| # | Bug | Fixed in v4? | Fix site | v5 status |
|---|---|---|---|---|
| 1 | Mount points / file links rejected | **Yes** (2026-07-26) | `lib/backup/restore/mount-index-coercion.ts`, applied at `restore.ts` 22a / 22d | Converged — v4 now restores them too |
| 2 | `backupFormat === 2` gate | **Yes** (2026-07-26) | `lib/backup/restore/archive.ts:333` | Converged — gate is `>= 2` on both sides |
| 3 | Files phase ordering | **Yes** (2026-07-26) | `lib/backup/restore/restore.ts` — step 5 moved to 22a-bis | Converged — files run after 22a on both sides |
| 4 | Sparse-array blob finalization | **Yes** (2026-07-26) | `lib/import/quilltap-import-stream.ts:284` | Converged — both readers wait for every chunk |
| 5 | Composer run consults the first participant's sheet | **Yes** (2026-07-27) | `app/api/v1/chats/[id]/custom-tools/route.ts` — `operatorCharacterIds` + `preferOperator`, applied at the single-variant listing and at POST's fallback | **Owed** — reproduced faithfully on purpose (finding #30); the mirror change is due in the same round |
| 6 | Boot reconcile re-embeds the cold tier every restart | **Yes** (2026-07-28) | `lib/startup/reconcile-conversation-rendering.ts` — stale chats skipped via the shared `isStale` gate; `isStale` param narrowed in `lib/background-jobs/maintenance/collapse-stale-chat-assets.ts` | Inherit the fixed semantics when the reconcile is ported — see the entry's note |

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
