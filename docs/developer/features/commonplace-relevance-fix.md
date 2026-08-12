# Commonplace Book Relevance Fix — Make Auto-Whispered Memories Actually On-Topic

**Status:** Implemented (4.8-dev) — pending empirical tuning before release
**Owner:** Charlie
**Drafted:** 2026-06-24
**Supersedes the open questions left by:** [commonplace-whisper-overhaul.md](./complete/commonplace-whisper-overhaul.md)

## Implementation notes (2026-06-24)

F1–F5 landed. Starting constants (still to be tuned per §3 before `tag-for-release`):

- **F1** — `RANKING_RELEVANCE_WEIGHT = 0.75`, `RANKING_PRIORITY_WEIGHT = 0.25`,
  centralized in `lib/memory/memory-weighting.ts` (`computeRankingBlend`). Ranking
  uses the no-floor `rawWeight` (approach a); the 0.70 floor stays for housekeeping.
- **F2** — provider-aware cosine floor (no migration), resolved from
  `EmbeddingProfile.provider`: `DEFAULT_MIN_COSINE_NEURAL = 0.30`,
  `DEFAULT_MIN_COSINE_TFIDF = 0.10`. Empty head was already honored downstream
  (writer omits the empty block). Dimension-mismatch fallback now warns once per
  (character, dimension pair).
- **F3** — recent-window prose base query (`buildRecentWindowQuery`, ~600 chars)
  + a `paraphrase` field added to `MemorySearchExtraction`, embedded in place of
  the keyword bag on both the dynamic-head fallback and the proactive pre-compute
  paths. **F3c (per-character anchor) was deferred** — a faithful low-weight blend
  needs a vector-combination path that doesn't exist yet, and the spec flags it
  "measure before shipping." Folded into the deferred follow-up below.
- **F4** — `recentlyWhispered = 0.6` penalty in `recall-tags.ts`, applied in the
  one auditable multiplier loop via `RecallContext.recentlyWhisperedIds`. Ring
  buffer (`RECALL_HISTORY_TURNS = 3`) in new ephemeral `chats.commonplaceRecallHistory`
  column (`lib/memory/recall-history.ts`; stored as `{ turns: string[][] }`).
- **F5** — `__tests__/unit/lib/memory/ranking-blend.test.ts` pins the blend +
  floor + anti-repetition + empty-head; structured per-candidate debug log at the
  dynamic-head site (`logger.debug('[ContextManager] Dynamic-head ranking', …)`).

**Deferred follow-up (before release):** the §3 CLI replay/tuning harness, then
tune the constants above + reconsider F3c against real Friday turns.

A handoff spec for Claude Code. The 4.7 whisper overhaul reworked where recall
material comes *from* (vault-sourced summaries, half-relevance inter-char, fold
refresh) and how it's *rendered*. It did **not** touch the retrieval scoring
math. That math is why the same handful of "important" memories keep getting
whispered regardless of what the scene is actually about. This spec fixes the
math.

Read §1 (diagnosis) before touching code — the fixes only make sense against the
specific failure mode, and several plausible-looking changes would make it worse.

---

## 1. Diagnosis — why relevance is still bad

All line references verified against the working tree on 2026-06-24.

### 1.1 The load-bearing bug: importance drowns relevance in the ranking blend

Every semantic retrieval path ranks candidates by the same blended key
([`lib/memory/memory-service.ts:795,831-833,912,1075-1077`](../../lib/memory/memory-service.ts)):

```
finalScore = 0.4 · cosineSimilarity + 0.6 · effectiveWeight
```

`effectiveWeight` is **not** a relevance signal. It is importance with a time
decay and — critically — an **importance floor of 0.70**
([`lib/memory/memory-weighting.ts:24-27,57-89`](../../lib/memory/memory-weighting.ts)):

```
effectiveWeight = max(baseImportance · 0.5^(daysOld/30),  baseImportance · 0.70)
```

So a memory's weight never falls below 70 % of its importance, **forever**. Work
the numbers for a typical turn:

| Memory | importance | cosine | 0.4·cos | 0.6·weight | **blended** |
|---|---|---|---|---|---|
| High-importance, **off-topic** | 0.90 | 0.30 | 0.120 | 0.6·(0.9·0.70)=0.378 | **0.498** |
| Ordinary, **strongly on-topic** | 0.50 | 0.80 | 0.320 | 0.6·(0.5·0.70)=0.210 | **0.530** |
| High-importance, **on-topic** | 0.90 | 0.80 | 0.320 | 0.378 | **0.698** |

The off-topic-but-important memory (0.498) nearly ties the genuinely relevant one
(0.530) and **beats** any relevant memory whose importance is ≤ ~0.45. Because the
floor guarantees `0.6·0.7·importance` of score with **zero** topical match, the
high-importance memories form a permanent floor under the rankings. They are
whispered every turn, on every topic. That is the user-visible symptom.

Embedding cosine makes it worse: real sentence-embedding similarities live in a
compressed band (≈0.25 for unrelated, ≈0.45–0.75 for related). The 0.4
coefficient sits on that *compressed* range, so the relevance term's *usable*
spread is roughly `0.4 · (0.75−0.25) = 0.20`, while the weight term's spread for
high-importance memories is near zero (pinned at the floor). Relevance simply
cannot move the ranking enough.

### 1.2 No relevance floor — `minScore` defaults to `0.0`

[`lib/memory/memory-service.ts:650`](../../lib/memory/memory-service.ts):
`const minScore = options.minScore || 0.0`. Nothing in the per-turn dynamic-head
path ([`context-manager.ts:1077-1087`](../../lib/chat/context-manager.ts)) passes
a `minScore`. The head pulls `DYNAMIC_HEAD_DEFAULT_SIZE * 3 = 15` candidates and
formats the top 5 — **always 5**, even when the best cosine in the pool is 0.22
(i.e. nothing in memory is actually about this turn). On an off-topic turn the
whisper is *guaranteed* to be filler. There is no "say nothing" branch.

### 1.3 The query is reductive, and built from a thin slice

Per-turn query construction
([`context-manager.ts:963-1040`](../../lib/chat/context-manager.ts)):

* Base query = the **single** new user message, or in continue-mode the last
  message (`:963-964`).
* If `cheapLLMSelection` is on, that's distilled to a **bare keyword string**
  via `extractMemorySearchKeywords`
  ([`lib/memory/cheap-llm-tasks/memory-tasks.ts:913-981`](../../lib/memory/cheap-llm-tasks/memory-tasks.ts))
  over the last 12–20 messages, each truncated to 500 chars, and the result is
  `keywords.join(' ')` (`:1031-1035`).

Two failure modes: (a) with distillation **off**, a one-line user message
("ok, go on") produces a near-useless query; (b) with it **on**, you embed a
keyword bag, which throws away the sentence structure that sentence-embedding
models are trained on — keyword bags land in a mushy region of embedding space
and depress *every* cosine, which then loses even harder to the importance floor
(§1.1). The character's own persona/manifesto never enters the query, so "what is
this character likely to find relevant" is never asked.

### 1.4 Inter-character relevance inherits all of the above

The half-relevance inter-char path
([`context-manager.ts:1268-1289`](../../lib/chat/context-manager.ts)) calls the
same `searchMemoriesSemantic` with the same `memorySearchQuery` and **no
`minScore`**, and is skipped entirely when `memorySearchQuery` is empty
(continue-mode opener). Same blend, same floor, same filler-on-off-topic-turns.

### 1.5 What is *not* broken (don't "fix" these)

* **Fold-triggered relevant-conversations refresh**
  ([`lib/services/commonplace-notifications/relevant-conversations-refresh.ts`](../../lib/services/commonplace-notifications/relevant-conversations-refresh.ts))
  uses the **raw fold summary** as its query — a good, rich query — and searches
  the chunked vault summaries via `searchDocumentChunks`. This is the *healthiest*
  retrieval in the system. Leave its query alone; only align its `minScore`.
* The recall-tag multipliers
  ([`lib/memory/recall-tags.ts`](../../lib/memory/recall-tags.ts)) are applied
  *after* the blend and are bounded/auditable. They're fine and orthogonal.
* Embeddings, chunking of memories, dedup against the frozen archive — all fine.

---

## 2. Fixes, in priority order

Land these as independent commits. **F1 is ~80 % of the win**; if only one thing
ships, ship F1.

### F1 — Rebalance the ranking blend so relevance leads (highest leverage)

**Goal:** semantic relevance becomes the primary sort key; importance/recency is
a tie-breaker and a floor-protector, not the dominant term.

**Change the blend** in `searchMemoriesSemantic`
([`memory-service.ts:795,831-833`](../../lib/memory/memory-service.ts)) and the
matching literal-boost/text paths (`:912,1075-1077`) so all four sites stay
identical. Pull the coefficients into named constants — they are currently
hard-coded `0.4`/`0.6` in four places, which is exactly how they drifted out of
view.

Recommended starting point (tune against §3 once a relevance floor exists):

```
RELEVANCE_WEIGHT = 0.75
PRIORITY_WEIGHT  = 0.25
finalScore = RELEVANCE_WEIGHT · cosine + PRIORITY_WEIGHT · effectiveWeight
```

**Decouple the importance floor from the *ranking* weight.** The 0.70 floor in
`calculateEffectiveWeight` exists to protect important memories from *housekeeping
deletion* — that's a legitimate, separate concern (note the file already
distinguishes a housekeeping "protection score"). It should **not** leak into
retrieval ranking. Two acceptable approaches; pick one:

* **(a, preferred)** In the *ranking* blend only, replace `effectiveWeight` with
  a no-floor variant `rawWeight = baseImportance · timeDecayFactor` (already
  computed and returned by `calculateEffectiveWeight` as `rawWeight`). Importance
  still helps, but it *decays*, so a 90-day-old "important" memory stops being
  whispered on unrelated turns. Keep `effectiveWeight` (with floor) for
  housekeeping/protection where it belongs.
* **(b)** Keep `effectiveWeight` but drop the floor to ~0.15 *for ranking
  purposes* via a ranking-specific `MemoryWeightingConfig`.

Either way the priority term must be allowed to fall toward zero with age, or
high-importance memories keep their permanent floor and F1 only half-works.

**Acceptance:** on the §3 replay, a memory with cosine ≥ 0.7 must outrank any
memory with cosine ≤ 0.35 regardless of importance. Verify with a unit test that
pins the blend (see F5).

### F2 — Add a real relevance floor (`minScore`) and allow an empty head

**Goal:** when nothing in memory is actually about this turn, whisper *nothing*
rather than filler.

* Give `searchMemoriesSemantic` a sane default floor on the **raw cosine** (not
  the blended score), e.g. `DEFAULT_MIN_COSINE = 0.30`, and pass an explicit
  per-turn floor from the dynamic-head call
  ([`context-manager.ts:1077`](../../lib/chat/context-manager.ts)). Filter on
  cosine *before* the blend so importance can't smuggle a 0.1-cosine memory past
  the gate (today's `:771` filters the raw `score`, which is cosine — keep it
  there, just stop defaulting it to 0).
* `formatDynamicMemoryHead` must accept an **empty** result and emit no head
  section (and the writer must omit the "relevant" sub-block rather than printing
  an empty heading).
* Apply the same floor to the inter-char relevance half
  ([`context-manager.ts:1268-1289`](../../lib/chat/context-manager.ts)).

Tune the exact floor against §3; 0.30 is a starting guess for typical
sentence-embedding scales and **will differ** for the local TF-IDF profile —
make the floor a property of the embedding profile, not a global constant, or at
minimum scale it. (TF-IDF cosines distribute very differently from neural
embeddings; a single hard-coded floor will be wrong for one of them.)

### F3 — Make the per-turn query richer and sentence-shaped

**Goal:** stop embedding one-line messages and keyword bags; embed something that
actually represents "what this moment is about."

* Replace the single-message base query with a short **recent-window** query: the
  last 1–2 user turns plus the last assistant turn, concatenated as prose (cap
  ~600 chars). This is cheap (no LLM) and immediately better than `:963-964`.
* When `cheapLLMSelection` is on, change `extractMemorySearchKeywords` to return a
  **one-sentence topical paraphrase** ("a natural-language description of what the
  characters are currently focused on") *instead of / in addition to* a keyword
  list, and embed the sentence. Keep keywords only to feed the existing literal
  phrase-boost path (`applyLiteralPhraseBoost`), where exact tokens genuinely
  help — that's the right place for keywords, not the embedding query.
* Optionally blend in a stable per-character relevance anchor (manifesto/persona
  one-liner) at low weight so retrieval is steered toward what *this* character
  cares about. Gate behind a flag; measure before shipping.

### F4 — Don't whisper the same memory turn after turn

**Goal:** even with F1–F3, a top memory can stay top across several turns and
read as a stuck record. Add light anti-repetition.

* Track the last K memory IDs whispered in this chat (in `sceneState` or a small
  per-chat ring buffer) and apply a **recently-whispered penalty** (a bounded
  multiplier, like the recall-tags, e.g. ×0.6 if whispered in the last 2 turns)
  *after* the blend. Don't hard-exclude — a memory that's still the best match
  should still win, just not trivially.

### F5 — Lock it down with tests + structured logging

* **Unit test the blend** with synthetic candidates that encode the §1.1 table:
  assert on-topic-ordinary beats off-topic-important, and that an empty pool
  yields an empty head. This is the regression guard that keeps the coefficients
  from drifting back.
* **Structured per-turn debug log** at the dynamic-head site: for each candidate,
  log `{cosine, rawWeight, effectiveWeight, blendedBefore, recallMultiplier,
  blendedAfter, selected}`. This is what lets you tune §3 against the live Friday
  instance later without guessing, and it's cheap to leave behind a debug level.

---

## 3. How to validate (offline replay, no live instance needed)

Charlie opted to proceed from the static diagnosis, but the numbers in F1/F2
(coefficients, cosine floor) **must** be tuned against real data before release.
Cheapest path that doesn't require me to reach the encrypted instance:

1. Add a CLI subcommand or a `scripts/` harness that, given a `chatId` and a turn
   index from the Friday instance, reconstructs the per-turn query and prints the
   full candidate table from the F5 log (cosine / rawWeight / blended / selected)
   for the **old** blend vs. the **new** blend side by side.
2. Charlie runs it against 8–10 real turns he remembers as "the whisper was
   off-topic," and confirms the new blend drops the filler and surfaces the
   on-topic memory (or correctly empties the head).
3. Tune `RELEVANCE_WEIGHT`, the cosine floor, and the F4 penalty from that table.
   Record the chosen constants and the reasoning in this doc before
   `tag-for-release`.

This keeps tuning empirical without me needing instance access, and the harness
is reusable next time relevance drifts.

---

## 4. Cross-cutting / don't-break list

* **Four blend sites must stay identical** (`memory-service.ts:795,831-833,912,
  1075-1077`). Centralize the coefficients + the no-floor ranking weight in one
  helper and call it from all four, or they *will* drift again.
* **`effectiveWeight` is still correct for housekeeping/protection** — only the
  *ranking* use of it changes. Don't lower the 0.70 floor globally; that would
  start deleting important memories.
* **Two embedding scales coexist** (neural API profiles vs. local TF-IDF). Any
  absolute cosine floor (F2) must be profile-aware or it silently breaks one of
  them. The dimension-mismatch path already falls back to text search silently
  ([`memory-service.ts:662-680`](../../lib/memory/memory-service.ts)) — surface a
  one-time user-visible warning while you're here; a degraded relevance "fix"
  that's actually just a silent text-search fallback would waste a release.
* **User-facing copy** (any new Memory-settings toggle for F3/F4) is steampunk
  voice; **CHANGELOG** is plain. Document user-visible changes in `help/*.md`
  with the `url` frontmatter + In-Chat Navigation block per CLAUDE.md.
* **Logging** on every touched backend path per CLAUDE.md conventions.

---

## 5. One-paragraph summary for the commit body

The 4.7 overhaul fixed where recall comes from but left the ranking math
unchanged: candidates are sorted by `0.4·cosine + 0.6·effectiveWeight`, and
`effectiveWeight` carries a 0.70 importance floor that never decays, so
high-importance memories keep a permanent score floor and are whispered every
turn regardless of topic — and with `minScore` defaulting to 0 the head always
emits 5 entries even when nothing matches. This change makes relevance the
primary sort key (with importance/recency as a decaying tie-breaker, not a
floor), adds a real cosine relevance gate that lets the head be empty, enriches
the per-turn query from a one-line message to a sentence-shaped recent-window
query, and adds anti-repetition plus a blend regression test.
