# Release Checklist 10 — Backup/Restore Completeness

If you have not already done so, read [CLAUDE.md](../../CLAUDE.md) for how to work in this repository.

**Goal (checklist item 10 of 13):** The backup/restore system must include **everything that can be backed up** — usually everything except secrets so sensitive they must stay encrypted (e.g. API keys).

Related project convention (CLAUDE.md): data/schema changes must be reflected in `.qtap`/SillyTavern exports, [`qtap-export.schema.json`](../../public/schemas/qtap-export.schema.json), backups, and/or `migrations/`. This step is the backup half of that.

## Steps

1. Find what changed in the data model since the last release:
   ```bash
   LAST_TAG=$(git describe --tags --abbrev=0 --match '[0-9]*.[0-9]*.[0-9]*' 2>/dev/null)
   git diff --name-only "${LAST_TAG}"..HEAD -- 'lib/schemas/**' 'migrations/**' 'lib/db/**' 'docs/developer/DDL.md' | sort -u
   ```
2. Locate the backup/restore implementation (search for the backup service and its included-tables/entities list) and confirm every new table, column, entity, or on-disk asset added this cycle is covered by **both** backup and restore.
3. For anything intentionally excluded, confirm it's only genuinely-secret material (API keys, encryption secrets — Saquel Ytzama's domain). Everything else must be included.
4. Cross-check the related surfaces so backups and exports don't drift:
   - `.qtap` export/import (remember: **always include new data-model fields in import/export**).
   - [`qtap-export.schema.json`](../../public/schemas/qtap-export.schema.json).
   - [DDL.md](../../docs/developer/DDL.md) is current.
5. If you find a gap, add the missing field/entity to backup and restore, and add a round-trip test (backup → restore → assert equality) if one doesn't already cover it.

## Report

List new data-model additions this cycle and, for each, **BACKED UP** / **RESTORED** / **EXCLUDED (secret)**. Note any gaps fixed and tests added. Do not commit.
