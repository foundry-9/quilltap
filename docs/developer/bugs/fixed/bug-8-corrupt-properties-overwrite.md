# Bug 8 — a corrupt `properties.json` is silently overwritten, losing six fields

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | **Critical** (silent data loss) |
| **Who it bites** | any instance whose vault file was truncated (iCloud conflict, interrupted write) |
| **Provenance** | Pinned |
| **Fix site** | `lib/database/repositories/vault-overlay/vault-readers.ts` — new `readCharacterVaultPropertiesForWrite` returns null only on `NOT_FOUND`, throws `CharacterVaultUnavailableError` on unreadable/unparseable/schema-invalid; `lib/database/repositories/vault-overlay/managed-fields.ts` — RMW seed uses it (refuse, don't seed defaults), stale `:236` comment rewritten |
| **v5 status** | **Owed** — retire the `corrupt` arm pin of `characters_update_tier2_equivalence`; v4 now refuses + writes nothing, so the arm converges to plain equality |
| **Index** | [bugs.md](../../bugs.md) |

---

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
