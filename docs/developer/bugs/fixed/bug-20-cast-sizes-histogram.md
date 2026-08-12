# Bug 20 — Almanack "Cast sizes" histogram groups by the raw JSON column

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-06) |
| **Found** | 2026-08-06 |
| **Fixed** | 2026-08-06 |
| **Severity** | Low |
| **Who it bites** | anyone reading the Almanack |
| **Provenance** | Pinned |
| **Fix site** | `lib/tools/almanack/phase3-ledgers.ts` — `collectChatBreakdown` groups by `json_array_length("participants")` |
| **v5 status** | `reconcile_ledger_divergences` self-retires now that v4's histogram is no longer per-cast |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-06)** — `collectChatBreakdown`
(`lib/tools/almanack/phase3-ledgers.ts`) now writes
`GROUP BY json_array_length("participants")` and the matching `ORDER BY`, so the
histogram rolls up by cast size. Pinned by
`__tests__/unit/lib/tools/almanack/ledgers.test.ts` →
`participant_histogram_rolls_up_by_cast_size` (real in-memory SQLite: three
chats with the same cast size but different casts fold into one row). v5's
`reconcile_ledger_divergences` self-retires now that v4's histogram is no longer
per-cast.

**Severity: Low** (dogfood #67). Pinned.

### Symptom

The Cast sizes table lists one row per **chat** (`participants 1 / chats 1`
repeated) instead of a histogram rolled up by cast size; only the empty-cast row
(`0 / 48`) aggregates.

### Root cause

`collectChatBreakdown` (`lib/tools/almanack/phase3-ledgers.ts:183`–`186`) selects
`json_array_length("participants") AS participants` but writes
`GROUP BY participants ORDER BY participants`. SQLite binds the bare name to the
raw `participants` **JSON column**, not the `json_array_length` alias, so every
distinct cast string is its own group. Proven in v4's own
`better-sqlite3-multiple-ciphers` (SQLite 3.53.2), not just system sqlite3.

### The fix

`GROUP BY json_array_length("participants")` (and the matching `ORDER BY`). v5
groups by the length expression; `reconcile_ledger_divergences` in
`almanack_tier2_equivalence` folds v4's per-cast rows to v5's shape and
self-retires when v4's histogram is no longer per-cast (unit test
`participant_histogram_rolls_up_by_cast_size`).
