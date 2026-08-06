# Session 5 — Almanack ledgers (Bugs 19, 20, 21)

Three defects, one file: `lib/tools/almanack/phase3-ledgers.ts`. Short
session; all three are broken diagnostics in the Almanack (the system report,
`/settings?tab=providers&section=capabilities-report` — API actions keep the
`capabilities-report-*` names).

Read the standing rules in [README.md](README.md). Full root causes:
`../found-bugs.md` → Bugs 19, 20, 21.

---

## Bug 19 — the `permanentlyFailed` embedding census is structurally always zero

**Severity: Low. Provenance: Faithful.**

The phase-3 census filters `embedding_status.status === 'PERMANENTLY_FAILED'`
— a value `EmbeddingStatusEnum` (`PENDING` / `EMBEDDED` / `FAILED`) can never
hold. Always 0.

**Fix:** filter on `'FAILED'` and rename the census cell/label accordingly
("failed" rather than "permanently failed"), or drop the cell if the FAILED
count is already surfaced elsewhere. Since Bug 7's fix, FAILED rows genuinely
land (the >8k-token cohort), so the corrected cell now shows real data — and
Session 4's Bug 17 will drain it; a note in the cell's wording that FAILED
means "permanent for the current profile" is worth adding.

---

## Bug 20 — "Cast sizes" histogram groups by the raw JSON column

**Severity: Low. Provenance: Pinned.**

`collectChatBreakdown` (`:183`–`:186`) selects
`json_array_length("participants") AS participants` but writes
`GROUP BY participants ORDER BY participants` — SQLite binds the bare name to
the raw JSON **column**, so every distinct cast string is its own row.

**Fix:** `GROUP BY json_array_length("participants")` and the matching
`ORDER BY`. Add unit test (mirror v5's
`participant_histogram_rolls_up_by_cast_size`): three chats with the same cast
size but different casts roll up into one row.

**v5 tripwire:** `almanack_tier2_equivalence` →
`reconcile_ledger_divergences` folds v4's per-cast rows and **self-retires**
when v4's histogram stops being per-cast.

---

## Bug 21 — wardrobe-permission counts under-report

**Severity: Low. Provenance: Pinned.**

The census counts `canDressThemselves = 1` / `canCreateOutfits = 1` (explicit
opt-in), but the runtime permission is null-safe: `!== false`
(`lib/services/chat-message/pseudo-tool.service.ts:124`) — NULL means
allowed. Every default-state character is permitted at runtime and uncounted.

**Fix (decision recommended in found-bugs and taken here):** count the
**effective** permission — `IS NOT 0` — matching both the runtime check and
v5. Do not touch the Core-whisper-override count (it is genuinely correct as
explicit-only). Unit test mirroring v5's
`dress_outfit_counts_are_effective_permission`.

**v5 tripwire:** same self-retiring `reconcile_ledger_divergences` pin.

---

## Definition of done

- [ ] Three fixes with unit tests failing pre-fix
- [ ] Check the Almanack help doc (`help/*.md`) — if it names the affected
      cells, make sure the wording still matches (especially 19's relabel)
- [ ] `npx tsc`, `npm run lint`, full `npm run test:unit` green
- [ ] `docs/CHANGELOG.md` entries; `found-bugs.md` Status rows flipped, with
      the Bug 21 "effective permission" decision recorded
- [ ] Final report: v5 self-retiring pins for 20/21 will fire; Bug 19 is
      Faithful — mirror owed same round
