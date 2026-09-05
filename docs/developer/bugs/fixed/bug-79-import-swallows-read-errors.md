# Bug 79 — `.qtap` import swallows destination read errors and proceeds into a partial apply

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-15 (the v5 port's `P4.48` lane — ordered on the premise that v4 *propagates* these errors, refuted by measurement: v4 swallows them; filed 2026-08-18) |
| **Fixed** | 2026-08-18 |
| **Severity** | Medium (silent; needs a damaged or partially-unreadable destination DB to fire, but when it fires the failure mode is a partial import that reports success) |
| **Who it bites** | anyone importing a `.qtap` into an instance whose database is damaged, mid-migration, or locked in a way that fails individual reads — exactly the moment a user is most likely to be importing (recovering into a fresh or repaired instance) |
| **Provenance** | Pinned — v5 deliberately DIVERGES here under its standing "fix, don't match" restore/import ruling: v5 refuses each affected step loudly with a named skip sentence; both-direction tripwires in the v5 harness retire when v4 converges |
| **Defect site** | `lib/database/repositories/base.repository.ts:65-91` — `safeQuery`'s two overloads: 3-arg REthrows, 4-arg returns the `fallback` and only logs. Nearly every repository *read* the import's reconcile/preview/apply phases lean on goes through the 4-arg form (e.g. `getEquippedOutfit` at `chats.repository.ts:548` passes `null`; `_findById`-style readers pass a fallback), so a failed read is indistinguishable from "row absent". The v5 port measured **23** distinct read sites of this class feeding its import path — v4's site list is the same family |
| **Fix site** | `lib/database/repositories/strict-failures.ts` (new) — an `AsyncLocalStorage` scope, `withStrictRepositoryFailures` / `withRepositoryFallbacks`; `lib/database/repositories/safe-query.ts` — fallback and silent mode re-throw inside that scope; `lib/import/quilltap-import/execute.ts` and `preview.ts` — both entry points wrapped, with the trailing embedding-enqueue phase deliberately wrapped back out; `import-entities.ts` / `import-profiles.ts` — the five importers that logged a failure without recording it (`importTags`, `importRoleplayTemplates`, and the three profile importers) now take `warnings` and push a named sentence like every other importer; `execute.ts` — the preserveIds preflight's refusal reaches `warnings` instead of returning `success: false` with nothing in it |
| **v5 status** | Fixed, deliberately divergent, as of `aa464abf`-round P4.48 (2026-08-15) — v5's importer refuses the affected step with a named skip sentence when a destination read errors, under the standing restore/import ruling that data-integrity bugs are fixed rather than matched. Both-direction pins in the v5 harness (`system_import_state` family) fire-and-retire when v4 converges |
| **Index** | [bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-18).** The filing's own framing named the obstacle: the
import never *chose* the fallback, it inherited it, and the fallback lives 23
call sites deep behind readers that nest inside one another
(`getEquippedOutfitForCharacter` → `getEquippedOutfit` → `findById`, each with
its own). Rewriting those sites would have meant deciding the same question
over and over, in files whose other callers still want the degraded answer. So
the fix carries the one bit that distinguishes the two situations —
*who is asking* — rather than editing the readers: a `withStrictRepositoryFailures`
scope, and a single `&& !strict` in `safeQuery`'s catch. Inside it a repository
call that throws keeps throwing; outside it nothing changes at all, which is
what keeps the render paths' degrade-and-log intact.

That is only half of "make the damage visible", and the other half is where the
filing's premise needed correcting: it credits the import with per-item catch
arms that "push named warnings", and most do — but five (`importTags`,
`importRoleplayTemplates`, and all three profile importers) only ever logged,
and were not even handed the `warnings` array. Under the new strictness those
five would have converted a silent wrong branch into a silent *skip*, which is
better data and the same silence. They now take `warnings` and name what they
dropped, and so does the preserveIds preflight, whose refusal previously
returned `success: false` with an empty warnings array — the one path that
aborts the entire import was the one saying least about why. (Rehydrate reads
that same array for its `CharacterRehydrationError` detail, so it stops
reporting "unknown import error" too.)

Two scope decisions worth keeping: `previewImport` is wrapped as well, since a
preview that under-reports collisions is precisely what talks a user into the
strategy that duplicates their data, and it has no catch arms to soften a
refusal into a wrong count. And the closing `enqueueImportedMemoryEmbeddings`
phase is wrapped back *out* with `withRepositoryFallbacks` — it schedules
follow-up jobs rather than deciding an import branch, and an `AsyncLocalStorage`
context follows anything scheduled from inside it, so the import's strictness
had no business riding out into the job queue.

The strictness covers writes as well as reads, which is wider than the filing
asked for and deliberate: a write that fails into a fallback during an import
is the same silence with the same consequence.

## Symptom

Import a `.qtap` into an instance whose database fails some reads (a
corrupt page, a missing table after a bad migration, a competing writer).
The import completes and reports success, but the result is partial and
skewed: entities that *exist* in the destination were read as *absent* —
so the reconcile takes the wrong branch (creating duplicates, or skipping
merges), and nothing in the warnings says a single read went wrong.

## Root cause

`safeQuery`'s 4-arg fallback mode (`base.repository.ts:74-79`) converts any
thrown read into the caller's fallback value — `null`, `[]`, `false` — and
the import's reconcile/preview logic consumes those values as facts about
the data ("no such row", "no existing outfit", "no collision") rather than
as failures. The fallback mode is a fine default for render paths, where a
degraded answer beats a crash; on the import path it destroys the one
distinction that matters — *absent* versus *unreadable* — right before a
write is committed based on the answer.

## Why it survived

The fallback is the repository default, so the import never chose it — it
inherited it. Every test exercises a healthy destination DB, where the
fallback arms are dead code. The v5 port only noticed because its own port
of these readers (`.ok().flatten()`, the literal Rust translation of the
fallback mode) was flagged as a hazard, an escalation claimed v4 propagated
the errors, and the lane's measurement refuted the escalation: both sides
swallowed. v5 then fixed its side under its restore/import ruling and filed
this so the sides can converge.

## Verification

Plant a destination that fails reads (the v5 lane used two cheap plants on
fixture copies: an in-memory DB with no tables at all, and a `projects` row
with a NULL `officialMountPointId`). Run an import. Pre-fix: success, no
warnings, partial/duplicated apply. Post-fix: the affected steps refuse (or
warn) by name, and the summary says what was skipped and why.

In the suite:
`__tests__/unit/lib/database/repositories/strict-failures.test.ts` pins the
mechanism (fallback intact outside the scope, re-thrown inside, restored for a
nested opt-out, and no leak past the scope in either the resolved or the thrown
case), and the "unreadable destination" block in
`__tests__/unit/lib/import/quilltap-import-service.test.ts` pins the effect: a
throwing existence check names the entity in `warnings` and creates nothing, a
preflight that cannot read says why it refused, and one test observes the scope
flag from *inside* a repository call so that unwrapping `executeImport` fails
loudly rather than quietly.

## v5 coordination

v5 already refuses loudly at each of its 23 sites (named skip sentences).
The v5 harness pins the divergence in both directions; when v4 lands a fix,
the next oracle regeneration trips the pins by design and the port retires
them to plain equalities in its next drift catch-up. The v5-side site list
and sentences are in `quilltap-v5` `status-log.md` → the three P4.48
entries, if a 1:1 sentence convergence is wanted.
