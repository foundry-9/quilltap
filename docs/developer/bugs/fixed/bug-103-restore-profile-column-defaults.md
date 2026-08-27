# Bug 103 — restore lets the table DEFAULT decide two connection-profile settings the archive predates

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-26 (release checklist item 10 — backup/restore completeness, cross-checking the 4.9 data-model additions against restore) |
| **Fixed** | 2026-08-26 |
| **Severity** | Medium (restoring a backup older than a column silently rewrites a setting its owner chose; for `multiCharacterPrefill` on an Anthropic profile the result is a profile that 400s on **every** multi-character turn) |
| **Who it bites** | anyone restoring a backup ZIP written before 4.9 (`multiCharacterPrefill`) or before 4.3 (`supportsImageUpload`) — which is every archive taken before the column shipped, including the archives the restore path deliberately still accepts (`backupFormat` 1–4) |
| **Provenance** | Structural, and a direct consequence of what makes backup/restore cheap to extend. Restore re-inserts an entity by spreading whatever the archive held, and `ensureCollection` derives the table's JSON/array/boolean columns from the Zod schema, so a *new* column rides along for free with no restore change — the property `restore-field-fidelity.test.ts` was written to pin. The property has a silent edge: it holds for a column the archive **carries**, and says nothing about one the archive is older than. A key absent from the JSON is absent from `documentToRow`'s `Object.entries`, therefore absent from the INSERT column list, and SQLite fills it from the table DEFAULT. Both migrations that introduced these columns backfilled thoughtfully — `add-profile-multi-character-prefill-field-v1` seeds Anthropic rows to `0`, `add-profile-supports-image-upload-field-v1` seeds from the historic provider capability map — but a migration only runs on the *upgrade* path. The restore path had no equivalent, and `DEFAULT 1` / `DEFAULT 0` were left to answer a question nobody asked them. `.qtap` import had already met half of this: it seeds `supportsImageUpload` inline, which is why importing a bundle and restoring a backup carrying the same profile produced two different rows |
| **Fix site** | `lib/llm/connection-profile-legacy-fields.ts` (new); `lib/backup/restore/restore.ts`; `lib/import/quilltap-import/import-profiles.ts` |
| **v5 status** | Not investigated — any port that reconstructs rows by spreading an archive inherits the shape. The transferable part is the rule, not the two columns: a column with a non-neutral DEFAULT needs an explicit answer on the restore path, because "absent" and "unset" are not the same value |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-26).** One helper,
`seedLegacyConnectionProfileFields` (`lib/llm/connection-profile-legacy-fields.ts`),
fills in the columns an older archive cannot have carried, and both restore and
`.qtap` import call it — so the two paths land the same row for the same
profile and cannot drift again. `supportsImageUpload` is seeded from the frozen
historic provider map (the same answer the 4.3 migration gave those rows);
`multiCharacterPrefill` is seeded as an explicit `null`, the documented "never
chosen" state, so `profileUsesNamePrefill()` resolves the provider default
rather than a table default nobody picked. A key the archive *did* carry is
never touched, a stored `false` and a stored `null` included. The inline
`supportsImageUpload` seeding in `import-profiles.ts` (and its private copy of
`LEGACY_IMAGE_CAPABLE_PROVIDERS`) is gone in favour of the shared helper.

---

## Symptom

Restore a backup taken before 4.9. Every connection profile comes back with the
`[Name]` multi-character prefill switched **on** — including Anthropic
profiles, where it must be off: Anthropic 4.6+ rejects a request that ends with
an assistant message outright ("This model does not support assistant message
prefill"), so every turn in a multi-character chat fails until the user finds
the checkbox and unticks it. Nothing in the restore summary mentions it; the
profile restores "successfully".

Restore a backup taken before 4.3 and the mirror image happens to a different
column: every profile comes back with **Image Upload off**, including the
OpenAI/Anthropic/Google/Grok profiles that had vision, so characters stop being
able to look at pictures. Importing the *same* profiles from a `.qtap` bundle
kept the capability, because the import path seeded it and the restore path did
not.

## Root cause

Restore inserts a connection profile by spreading the archive record:

```ts
const { userId, createdAt, updatedAt, apiKeyId, ...profileData } = profile;
await repos.connections.create({ ...profileData, name: uniqueName, apiKeyId: null }, { id: profile.id });
```

`_create` Zod-parses that object, and `multiCharacterPrefill` is
`z.boolean().nullable().optional()` — an absent key parses to an absent key, not
to `null`. `documentToRow` builds the row from `Object.entries(document)`, so
an absent key yields no column, and `insertOne` writes:

```sql
INSERT INTO "connection_profiles" ("id", "name", "provider", …) VALUES (…)
```

with `multiCharacterPrefill` simply not named. SQLite applies the column
default, `DEFAULT 1`. The tri-state collapses to its most aggressive value on
the one path where the user's actual preference is unknowable.

`supportsImageUpload INTEGER DEFAULT 0` collapses the same way, in the other
direction.

## Why it survived

The suite argues for the wrong answer, in the way stale coverage usually does —
by testing the case that works. `restore-field-fidelity.test.ts` exists
precisely to catch a dropped column, and every one of its cases builds an
archive record that **has** the field and asserts it arrives. That is the free
half of the schema-driven property, and it is genuinely free. The half nobody
wrote a case for is the archive that predates the field, where the absence is
the input.

It is also invisible from either end. The restore reports success and warns
about nothing; the profile appears in the list, correctly named, with its model
and parameters intact. The damage is one boolean out of thirty-odd columns, and
it reads as a plausible setting rather than as corruption — the user's most
likely conclusion is that they set it that way. And the failure it causes
arrives later and elsewhere: a 400 from Anthropic during a multi-character
turn, on a profile that works fine one-on-one.

## The fix

`lib/llm/connection-profile-legacy-fields.ts` holds one exported function and
the reason it exists. Both archive-consuming paths call it immediately after
destructuring, before the create:

```ts
const profileData = seedLegacyConnectionProfileFields(rawProfileData);
```

The helper is deliberately narrow — it seeds only where the value is
`undefined`, returns a copy, and knows nothing about restore or import. The
frozen `LEGACY_IMAGE_CAPABLE_PROVIDERS` set lives there now as historic data
rather than a live capability map; a provider that gains vision today gets it
from the profile editor. The set is matched **case-insensitively**:
`ProviderEnum` is `z.string().min(1)`, a plugin-supplied id rather than a closed
enum, so nothing guarantees the stored casing — least of all in an archive old
enough to be missing the column. The inline check this replaced matched
exact-case and would have seeded a `openai` profile to `false`;
`defaultMultiCharacterPrefill()` had already normalised for the same reason.

## How to verify

- `npx jest __tests__/unit/lib/llm/connection-profile-legacy-fields.test.ts` —
  the seeding rules, including that a stored `false` and a stored `null` are
  never overwritten, and that a seeded profile resolves through
  `profileUsesNamePrefill()` to the provider default rather than to `true`.
- `npx jest __tests__/unit/lib/backup/restore-field-fidelity.test.ts` — the
  4.9 block drives `restore()` with an archive record that omits each column
  and asserts what reaches `repos.connections.create`. The three cases fail
  against the pre-fix restore.
- By hand: restore any backup written before 4.9 and open an Anthropic
  connection profile. **Announce the speaker in multi-character scenes** must
  be unticked, and a multi-character chat on that profile must produce a reply
  rather than a 400.
