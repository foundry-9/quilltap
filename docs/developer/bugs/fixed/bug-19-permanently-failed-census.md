# Bug 19 — the `permanentlyFailed` embedding census is structurally always zero

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low (broken diagnostic) |
| **Who it bites** | anyone reading the Almanack's embedding health |
| **Provenance** | Faithful |
| **Fix site** | `lib/tools/almanack/phase3-ledgers.ts` — `collectEmbeddingPipeline` filters the real terminal `FAILED`; `EmbeddingPipelineInfo.permanentlyFailed` → `failed` |
| **v5 status** | **Owed** (Faithful) — v5 reproduces the always-zero cell |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — `collectEmbeddingPipeline`
(`lib/tools/almanack/phase3-ledgers.ts`) now filters `status === 'FAILED'` (the
real terminal state) instead of the never-stored `'PERMANENTLY_FAILED'`. The
cell/label is renamed from "Permanently failed rows" to "Failed rows" (noted as
permanent for the current embedding profile), and the type field
`EmbeddingPipelineInfo.permanentlyFailed` → `failed`. Pinned by
`__tests__/unit/lib/tools/almanack/ledgers.test.ts` (real in-memory SQLite:
FAILED rows are counted, PENDING/EMBEDDED are not). **Faithful** — v5 reproduces
the always-zero cell, so the mirror is owed the same round.

**Severity: Low** (a broken diagnostic, not user data).

### Root cause

The phase-3 Almanack census
(`lib/tools/almanack/phase3-ledgers.ts`) filters
`embedding_status.status === 'PERMANENTLY_FAILED'` — a value the
`EmbeddingStatusEnum` (`PENDING` / `EMBEDDED` / `FAILED`) can never store. The
cell is therefore always 0, whatever the real state. v5 carries it faithfully.

### The fix

Filter on a value the enum can hold (or drop the census). Worth a v4-side look.
