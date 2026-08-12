# Bug 21 — Almanack wardrobe-permission counts under-report

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low |
| **Who it bites** | anyone reading the Almanack |
| **Provenance** | Pinned |
| **Fix site** | `lib/tools/almanack/phase3-ledgers.ts` — `collectCharacterBreakdown` counts the effective permission (`IS NOT 0`), matching the runtime `!== false` |
| **v5 status** | `reconcile_ledger_divergences` self-retires |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — `collectCharacterBreakdown`
(`lib/tools/almanack/phase3-ledgers.ts`) now counts the **effective** permission
`"canDressThemselves" IS NOT 0` / `"canCreateOutfits" IS NOT 0`, matching the
runtime null-safe check (`!== false`: NULL and 1 both mean allowed, only an
explicit 0 denies). **Decision taken:** count the effective permission rather
than keep explicit opt-in — the census should reflect what the runtime actually
permits, and it now agrees with `pseudo-tool.service.ts:124` and with v5. The
Core-whisper-override count is left untouched (genuinely explicit-only). Pinned
by `__tests__/unit/lib/tools/almanack/ledgers.test.ts` →
`dress_outfit_counts_are_effective_permission` (real in-memory SQLite: NULL and
1 count, 0 does not). v5's `reconcile_ledger_divergences` self-retires.

**Severity: Low** (dogfood #68). Pinned.

### Symptom

"May dress themselves: 0" and "May create outfits: 0" on a 38-character instance.

### Root cause

The query
(`lib/tools/almanack/phase3-ledgers.ts:401`–`402`) counts
`canDressThemselves = 1` / `canCreateOutfits = 1` — explicit opt-in. But the
**runtime** permission is null-safe: `canDressThemselves !== false`
(`lib/services/chat-message/pseudo-tool.service.ts:124`), so a NULL flag means
**allowed**. Every character left at the default is permitted at runtime and
uncounted in the census. ("With a Core-whisper override: 0" is genuinely correct
— it counts explicit `coreWhisperEnabled IS NOT NULL`, and Friday truly has
none.)

### The fix

Count the effective permission (`IS NOT 0`), or keep explicit opt-in by design
— a v4 product call. v5 counts `IS NOT 0`; the same both-directions self-retiring
pin + unit test `dress_outfit_counts_are_effective_permission`.
