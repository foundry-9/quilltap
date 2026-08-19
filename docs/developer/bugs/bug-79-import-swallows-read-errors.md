# Bug 79 — `.qtap` import swallows destination read errors and proceeds into a partial apply

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-08-15 (the v5 port's `P4.48` lane — ordered on the premise that v4 *propagates* these errors, refuted by measurement: v4 swallows them; filed 2026-08-18) |
| **Fixed** | — |
| **Severity** | Medium (silent; needs a damaged or partially-unreadable destination DB to fire, but when it fires the failure mode is a partial import that reports success) |
| **Who it bites** | anyone importing a `.qtap` into an instance whose database is damaged, mid-migration, or locked in a way that fails individual reads — exactly the moment a user is most likely to be importing (recovering into a fresh or repaired instance) |
| **Provenance** | Pinned — v5 deliberately DIVERGES here under its standing "fix, don't match" restore/import ruling: v5 refuses each affected step loudly with a named skip sentence; both-direction tripwires in the v5 harness retire when v4 converges |
| **Defect site** | `lib/database/repositories/base.repository.ts:65-91` — `safeQuery`'s two overloads: 3-arg REthrows, 4-arg returns the `fallback` and only logs. Nearly every repository *read* the import's reconcile/preview/apply phases lean on goes through the 4-arg form (e.g. `getEquippedOutfit` at `chats.repository.ts:548` passes `null`; `_findById`-style readers pass a fallback), so a failed read is indistinguishable from "row absent". The v5 port measured **23** distinct read sites of this class feeding its import path — v4's site list is the same family |
| **Fix site (proposed)** | import-scope reads should use `safeQuery`'s rethrow mode (or an explicit refusal): inside `lib/import/quilltap-import/**`, "the read FAILED" must not resolve to "the row does not exist". The import already has the right chokepoint shape — its per-item catch arms push named warnings — so routing read failures into those arms (rather than into fallbacks upstream of them) preserves the partial-progress UX while making the damage visible |
| **v5 status** | Fixed, deliberately divergent, as of `aa464abf`-round P4.48 (2026-08-15) — v5's importer refuses the affected step with a named skip sentence when a destination read errors, under the standing restore/import ruling that data-integrity bugs are fixed rather than matched. Both-direction pins in the v5 harness (`system_import_state` family) fire-and-retire when v4 converges |
| **Index** | [bugs.md](../bugs.md) |

---

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

## v5 coordination

v5 already refuses loudly at each of its 23 sites (named skip sentences).
The v5 harness pins the divergence in both directions; when v4 lands a fix,
the next oracle regeneration trips the pins by design and the port retires
them to plain equalities in its next drift catch-up. The v5-side site list
and sentences are in `quilltap-v5` `status-log.md` → the three P4.48
entries, if a 1:1 sentence convergence is wanted.
