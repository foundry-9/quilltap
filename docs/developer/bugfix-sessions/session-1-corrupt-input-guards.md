# Session 1 — Corrupt-input guards (Bugs 8, 18)

**Run first.** Bug 8 is the most urgent item in `found-bugs.md`: silent,
permanent data loss against live data. Bug 18 is batched here because it is
the same defect shape — *present-but-unusable input treated as absent, followed
by a destructive default* — so the same reviewer mindset covers both.

Read the standing rules in [README.md](README.md) before starting. Full root
causes: `../found-bugs.md` → "Bug 8" and "Bug 18".

---

## Bug 8 — a corrupt `properties.json` is silently overwritten, losing six fields

**Severity: Critical (silent data loss). Provenance: Pinned.**

### What happens

A character's `properties.json` (vault sidecar) becomes unparseable or
truncated — iCloud conflict, interrupted write. Reads are fail-soft, so nothing
looks wrong. The next save of that character seeds empty-properties defaults
and permanently clobbers the six fields whose **only** home is that file:
`pronouns`, `aliases`, `title`, `firstMessage`, `talkativeness`,
`canChooseOutfit`.

### Where

`lib/database/repositories/vault-overlay/managed-fields.ts` — the
read-modify-write seed, and the stale safety comment around `:236` that still
reasons from the pre-vault world ("every other field above has a DB column…").
Those columns no longer exist; the real `characters` table has none of the six.

### The fix

1. In the RMW seed, distinguish three read outcomes:
   - **File absent** → seed defaults (unchanged, correct).
   - **File present and parseable** → merge patch over it (unchanged).
   - **File present but unparseable/truncated** → **refuse the write**. Do not
     seed defaults; do not touch the unreadable file. Throw so the save fails
     loudly — this matches the established vault failure semantics (reads
     already throw `CharacterVaultUnavailableError` on a broken vault; see the
     project convention that there is no "silent hollow" character). The error
     message should name the file and say it is unparseable, so the user knows
     to repair or delete it.
2. Delete the stale `:236` comment (and rewrite it to state the *current*
   truth: these six fields live only in `properties.json`, so an unreadable
   file must never read as empty).

Note the adjacent trap already on record: `writeCharacterVaultManagedFields`
must skip fields with no DB column when they are absent from the patch —
don't regress that while editing this file.

This is the third instance of a shape already fixed twice: commit `dcd9440a`
fixed the identical bug for the group and project `StoreEntity` bags. Read
that commit first and mirror its approach where it fits.

### Verification

- Unit test: corrupt a fixture `properties.json` (truncate mid-token), save an
  unrelated field, assert the save **throws** and the file is untouched.
  Companion cases: absent file still seeds defaults; healthy file still merges.
  Check the test fails against pre-fix code.
- Manual: corrupt a scratch character's `properties.json`, edit its
  description in the UI, confirm the six fields survive and the user sees an
  error rather than a silent success.

### v5 coordination (Pinned)

v5's `characters_update_tier2` differential pins this in both directions (its
`corrupt` arm): v5 refuses with `properties.json unparseable: …`, the oracle is
asserted to clobber. **Both assertions go red when this lands** — report that
the v5 side must retire the divergence. Match v5's observable behaviour
(refuse + write nothing) so the arm converges to a plain equality.

---

## Bug 18 — a whitespace-only help file wipes the whole `help_docs` table

**Severity: Medium (latent). Provenance: Faithful (v5 tripwire
`help_doc_sync_guards_equivalence` exists — check both directions).**

### What happens

`syncHelpDocs` (`lib/help/help-doc-sync.ts`) guards its destructive
delete-stale pass with `if (files.length === 0)` (`:155`). An empty `help/`
directory is protected; a directory whose only `.md` is whitespace-only is
not — the sync proceeds, extracts no usable content, and deletes every row
already in the table. Measured: `totalOnDisk 1, deleted 3, rows left 0`.

### The fix

Extend the guard from "no file exists" to "**no file has usable content**":
compute the set of docs that actually parsed to non-empty content, and refuse
the destructive pass when that set is empty while the table is non-empty. A
genuinely emptied help set on disk plus a populated table should be treated as
suspicious, not as an instruction to wipe.

Remember help docs are keyed publicly by filename slug (UUID PK internal) —
don't disturb that identity while editing the sync.

### Verification

- Unit test: directory with one whitespace-only file + populated table →
  nothing deleted; directory with one real file → normal sync; empty
  directory → still protected as today. Fails pre-fix.

### v5 coordination

v5 reproduces the wipe faithfully, pinned bidirectionally by
`help_doc_sync_guards_equivalence` — the v5 mirror is owed in the same round.

---

## Definition of done

- [ ] Both fixes in, with regression tests verified failing on pre-fix code
- [ ] `npx tsc` and `npm run lint` clean; full `npm run test:unit` green
- [ ] `docs/CHANGELOG.md` entries (plain voice)
- [ ] `found-bugs.md` Status rows for 8 and 18 flipped to Yes with date + fix site
- [ ] Final report names the v5 obligations: retire the `corrupt` arm pins
      (Bug 8) and mirror the help-sync guard (Bug 18) in the same round
