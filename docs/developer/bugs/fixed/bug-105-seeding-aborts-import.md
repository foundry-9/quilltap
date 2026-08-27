# Bug 105 — the legacy-field seeding sits outside the per-item try, so one malformed profile aborts a whole import

| | |
|---|---|
| **Status** | FIXED in v4 (2026-08-27) |
| **Found** | 2026-08-27 |
| **Fixed** | 2026-08-27 |
| **Severity** | Medium (a `.qtap` bundle carrying one malformed connection-profile record now imports **nothing at all** instead of naming the bad item and continuing) |
| **Who it bites** | Anyone importing a hand-edited or third-party-authored `.qtap` bundle whose `connectionProfiles` array carries a record with a non-string `provider` |
| **Provenance** | Found by the v5 port's differential — `system_import_state`'s named-item-failures arm (whose corpus deliberately carries malformed records) went from five per-item warnings to one abort sentence and an empty write when its oracle was regenerated at `e000d6bfc` |
| **Defect site** | `lib/import/quilltap-import/import-profiles.ts:41` (the call outside the try) × `lib/llm/connection-profile-legacy-fields.ts:60` (the throwing expression) |
| **Fix site** | `lib/import/quilltap-import/import-profiles.ts` (seeding moved inside the per-item `try`; the catch names `rawProfile`) × `lib/llm/connection-profile-legacy-fields.ts` (`typeof` guard in place of `??`) |
| **v5 status** | Not affected — v5 parses before it seeds, and its helper reads the provider as `as_str().unwrap_or("")`; pinned v5-side by `a_non_string_provider_is_named_and_does_not_abort_the_import` |
| **Index** | [../bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-27).** Both halves named in *The fix* were taken, because
they answer different questions and only one of them is about this helper. The
`??` became a `typeof` guard, so the helper is now total over junk input — a
number, boolean, object or array `provider` seeds `supportsImageUpload: false`
rather than throwing, which is what a *seeding* helper owes a caller reading an
archive. And the call moved inside `importConnectionProfiles`'s per-item `try`,
which is the half that would have contained this defect and any future one like
it: the catch now names `rawProfile`, since `profile` is block-scoped to the try.
Each half was verified to fail the other's test in isolation — the helper's four
new junk-provider cases throw against the old `??`, and the import-path test
survives the old helper only because the try now wraps it — so neither is
decoration. The restore path was checked as the bug asked and needed nothing:
`restore.ts`'s per-profile loop already try-wraps its whole body, seeding
included, which is exactly why the two paths diverged in the first place. No v5
change is owed.

## Symptom

Importing a `.qtap` bundle whose `connectionProfiles` array contains one
record with a non-string `provider` (for example `provider: 42`) fails the
**entire** import with

```
Import failed: (seeded.provider ?? "").toUpperCase is not a function
```

and writes nothing. Before `e000d6bfc` (bug 103's fix) the same bundle
produced one per-item warning naming the bad profile and imported everything
else.

## Root cause

`e000d6bfc` introduced `seedLegacyConnectionProfileFields` and calls it at
the **top of the loop body** in `importConnectionProfiles`
(`lib/import/quilltap-import/import-profiles.ts:41`) — **outside** the
per-item `try` that wraps the rest of the iteration. The helper's provider
normalisation is

```ts
(seeded.provider ?? '').toUpperCase()
```

(`lib/llm/connection-profile-legacy-fields.ts:60`), and `??` guards only
`null`/`undefined` — a number, boolean, or object reaches `.toUpperCase`
and throws a `TypeError`. Nothing between the loop and `executeImport`'s
outer catch handles it, so the whole import aborts.

This is the `v4-helper-outside-the-per-item-try` class the port has met
before (`e000d6bfc` is its second instance on this exact file — see the
v5 repo's P4.D126 lane record).

## Why it survived

`restore-field-fidelity.test.ts`'s new 4.9 block and the helper's own
16-case suite all feed the helper records whose `provider` is a string or
absent — the malformed-record path only exists in the v5 port's
differential corpus, which is what caught it.

## The fix

Move the `seedLegacyConnectionProfileFields` call inside the per-item
`try` (one-line move), or make the helper total over junk input
(`typeof seeded.provider === 'string' ? seeded.provider : ''`). Either
restores the pre-`e000d6bfc` behaviour: the bad item is named in a
warning, the rest of the bundle imports. The restore path
(`lib/backup/restore/restore.ts`) has the same call shape but its
per-profile loop already try-wraps the whole body — verify while there.

## Verification

Two regression tests, one per half:

- `__tests__/unit/lib/llm/connection-profile-legacy-fields.test.ts` — four
  junk-provider cases (number, boolean, object, array) assert the helper seeds
  `false` rather than throwing. All four throw against the pre-fix `??`.
- `__tests__/unit/lib/import/quilltap-import-service.test.ts` — a bundle whose
  `connectionProfiles` array holds one record with `provider: 42` beside a
  healthy one asserts the malformed item is named in a warning, the healthy one
  is created, and `imported.connectionProfiles` is 1. It pins the try
  placement: with the helper reverted it still passes, because the try now
  catches the TypeError and the repository — the layer that is *meant* to reject
  a malformed record — produces the named warning instead.

## v5 coordination

v5 deliberately does **not** reproduce this (the standing 2026-08-03
backup/restore/import ruling: v5 fixes v4's bugs on these paths). When
this bug is fixed v4-side, no v5 change should be needed — v5's
`a_non_string_provider_is_named_and_does_not_abort_the_import` pin
already asserts the post-fix behaviour, and the drift catch-up should
find the differential green.
