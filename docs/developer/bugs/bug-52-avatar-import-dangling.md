# Bug 52 — a cross-instance character import produces a faceless character with a dangling avatar id

| | |
|---|---|
| **Status** | **OPEN** |
| **Found** | 2026-08-09 |
| **Fixed** | — |
| **Severity** | Medium (silent data loss on every cross-instance character import; the avatar bytes never travel and the reference dangles) |
| **Who it bites** | anyone importing a `characters` `.qtap` into a different instance — sharing a character with another person, or moving one between their own instances |
| **Provenance** | Faithful — found by inspection during the archive/export-fidelity scoping pass (a real 4.8.0-dev.186 export measured 18 KB with no vault records), not by the v5 harness |
| **Defect site** | `lib/export/ndjson-writer.ts:143` (`streamCharacters` exports no vault records or bytes) + `lib/import/quilltap-import/reconcile.ts:46–129` (`reconcileRelationships` never remaps or nulls `defaultImageId` / `avatarOverrides[].imageId`) |
| **Fix site** | WP A2 of [character-archive-spec.md](../features/character-archive-spec.md) — export the character's vault via a shared `streamOneStore`, carry link ids, remap avatars in reconcile |
| **v5 status** | Owed (Faithful) — v5 reproduces the omission; it inherits the A2 fix as a drift catch-up |
| **Index** | [bugs.md](../bugs.md) |

---

### Symptom

Export a character (`characters` `.qtap`), import it into any other instance.
The character arrives with **no avatar** — everywhere an avatar should render,
resolution fails — and its `defaultImageId` points at a record that does not
exist on the target. The rest of the vault (photos, `Mail/`, free notes, image
history) is silently absent too; only the managed fields materialize.

### Root cause

Two halves, either of which alone would break the avatar:

1. **The bytes never travel.** `streamCharacters`
   (`lib/export/ndjson-writer.ts:143–226`) emits `character`, `wardrobe_item`,
   `character_plugin_data`, and optionally `memory` — no `doc_mount_*` records
   at all. The character's vault, including the avatar blob, stays behind.
2. **The reference is exported verbatim and never reconciled.**
   `characters.defaultImageId` is a `doc_mount_file_links.id` into the *source*
   instance's vault (see the layout comment in
   `lib/file-storage/character-vault-bridge.ts`). The character-loop of
   `reconcileRelationships` (`lib/import/quilltap-import/reconcile.ts:46–129`)
   remaps `tags`, `defaultPartnerId`, `defaultConnectionProfileId`,
   `defaultImageProfileId`, `defaultRoleplayTemplateId`, and
   `characterDocumentMountPointId` — but not `defaultImageId` and not any
   `avatarOverrides[].imageId`. They import as dangling foreign-instance ids.

`resolveCharacterAvatar` (`lib/photos/resolve-character-avatar.ts:77`) then
finds neither a vault link nor a legacy `files` row for the id and returns
null. Note the dual shape: a legacy avatar id can be a `files.id`, which the
fix must leave alone rather than mis-remap.

### Why it survived

Same-instance round-trips mask both halves: re-importing into the instance that
exported (the common duplicate/restore-a-tweak flow) leaves the dangling id
*accidentally valid*, because the original vault link still exists there and
Path 1 of `resolveCharacterAvatar` resolves it against the old character's
mount. Only a genuinely foreign target exposes the loss, and character exports
have mostly been exercised same-instance. The wider vault loss (photos, mail)
is invisible unless you go looking for the files.

### The fix

Deliverable A of the archive/export-fidelity plan
([character-archive-spec.md](../features/character-archive-spec.md), WP A2):

- Extract the per-store body of `streamDocumentStores` into a shared
  `streamOneStore(mountPointId)` generator and have `streamCharacters` emit the
  character's own store (mount point, folders, documents, blobs + chunks) after
  its child records, carrying file/link row ids as optional fields.
- On import, replace the scaffold vault `create()` provisions with the bundle's
  store (bundle wins, whole-store), and in `reconcileRelationships` remap
  `defaultImageId` and every `avatarOverrides[].imageId` through the new
  link-id map — leaving legacy `files.id` avatars untouched, and nulling with a
  warning (never dangling) when the referenced link did not travel.

### Verification

Export a character with an avatar and a populated `photos/` folder; import
into a **clean** instance. The avatar renders (both `resolveCharacterAvatar`
paths exercised: vault-link and legacy-file), every vault path exists, blob
sha256s match, and no `defaultImageId` / `avatarOverrides[].imageId` on the
imported row references a nonexistent record. Also verify the legacy case: a
character whose avatar id is a `files.id` imports with the id intact.

### v5 coordination

v5's port of the export writer and reconcile mirrors the omission, so it
carries the same defect. It inherits the A2 fix as a drift catch-up, with a new
fixture for a store-bearing character bundle.
