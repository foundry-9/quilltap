# Bug 88 — the prompt's last block speaks of the character in the third person, ungrammatically

| | |
|---|---|
| **Status** | **FIXED in v4** (2026-08-22) |
| **Fixed** | 2026-08-22 |
| **Found** | 2026-08-22, while auditing grammatical person across the assembled system prompt (see [prompt-person-consistency.md](../../features/complete/prompt-person-consistency.md)) |
| **Severity** | Low — nothing errors. A malformed sentence occupies the prompt's recency slot, and disagrees in person with every block above it |
| **Who it bites** | every character in every chat with tools available. The ungrammatical variant bites every character with **no pronouns recorded** — which is the default state, since `pronouns` is optional and unset on most characters |
| **Provenance** | v4's own. Introduced third-person-by-placeholder at `3f4d7a78a` (2026-02-05); the ungrammatical default arrived with `11c4d6c2d` (2026-03-19), the same commit that made the disagreement possible by adding the second-person identity preamble |
| **Symptom** | The final block of the system prompt reads *"When {{char}} uses workspace tools, **she** CALLS them"* — third person, immediately after several blocks addressing the character as "you". When the character has no pronouns, it reads *"**they CALLS them** — they does not merely describe calling them"* |
| **Defect site** | `lib/chat/context/system-prompt-builder.ts:381-383` and its hand-copied twin `lib/help-chat/system-prompt-builder.ts:89-91` |
| **Fix site** | Both builders — the block is now second person and the `character.pronouns?.subject \|\| 'they'` lookup is gone. Pinned by a named assertion in `__tests__/unit/cache-determinism/system-prompt.test.ts` and `__tests__/unit/context-management.test.ts`; both cache-determinism goldens updated |
| **v5 status** | Owed — v5's builder is a faithful port pinned by `system_prompt_equivalence`, so it is expected to reproduce both defects and to absorb the fix at the next drift round. Not verified against the v5 tree in this pass |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-22).** The block now reads:

> When you use workspace tools, you CALL them — you do not merely describe
> calling them. Every tool action produces a tool_use block, not prose.

Second person agrees with every block above it, and needs no pronoun at all —
which is why the fix *deletes* the grammar bug rather than patching it. There is
no longer a code path that can produce a subject-verb disagreement here, because
there is no longer a variable subject.

Applied identically in `lib/help-chat/system-prompt-builder.ts`, which is a
separate builder carrying its own hand-copied version of the same strings and
had the same two defects.

No `PROMPT_CACHE_STRUCTURE_VERSION` bump: wording inside an existing block rather
than a layout change, per the bump policy in `lib/llm/cache-key.ts`. The
reinforcement is a per-turn addition rather than part of the cached
`compiledIdentityStacks`, so the fix takes effect immediately on existing chats
with no rebuild.

---

## Symptom

Two defects in one sentence, the second strictly worse than the first.

**Person disagreement.** The assembled system prompt opens with `## Character
Identity` — *"You are {{char}}. Everything that follows defines who you are…"* —
and continues in second person through the Taboo section (*"beneath you… anything
you say"*) and the standing-instructions preamble (*"groups you belong to… who
you are"*). The tool reinforcement, which is the **last** block emitted, then
switches to the third person and refers to the reader by name and pronoun.
Whatever weight the final position carries, it was carrying it while
contradicting everything above it.

**Subject-verb disagreement.** The subject was interpolated:

```ts
const subject = character.pronouns?.subject || 'they'
`When {{char}} uses workspace tools, ${subject} CALLS them — ${subject} does not merely describe calling them. …`
```

The verbs are conjugated for a third-person *singular* subject, but the fallback
is plural. Every character with no pronouns recorded — the default state, since
the field is optional — ended its system prompt on:

> When Iris Volney uses workspace tools, **they CALLS them** — **they does not**
> merely describe calling them.

## Root cause

Neither defect was a decision. The blame history shows the person was inherited
and the grammar bug was introduced by a fix aimed at something else.

`3f4d7a78a` (2026-02-05, *"Add native tool execution rules to system prompt"*)
introduced the block with literal placeholders:

```
When {{char}} uses his/her workspace tools, he/she CALLS them — …
```

The comment called it "character-voiced tool reinforcement", but `his/her` is
placeholder text, not a considered choice of person. At this point the prompt had
no second-person preamble, so nothing disagreed with it yet.

`11c4d6c2d` (2026-03-19, *"Character identity reinforcement — preamble bookend
and pronoun-aware tools"*) did two things in one diff:

1. Added the `## Character Identity` preamble — *"You are {{char}}…"* — as the
   first content in the prompt.
2. Replaced `his/her` / `he/she` with the character's real pronouns, defaulting
   to `they`.

Its commit message is explicit that the second change targeted the **generic
pronoun**, not the person. So the same commit that established second person as
the prompt's opening register left the closing block in third person, and swapped
a grammatically-consistent placeholder for a subject that disagrees with its own
verbs whenever it falls back.

## Why it survived

- **Nothing errors.** A malformed sentence in a prompt produces no exception, no
  log line, and no failed request. Its only cost is whatever it does to the
  model's reading, which is unobservable from inside the system.
- **A unit test asserted the broken string.** `__tests__/unit/context-management.test.ts`
  contained `expect(prompt).toContain('they CALLS them')` with the comment *"Tool
  reinforcement uses character pronouns (defaults to 'they')."* The test pinned
  the defect as though it were the contract, so any accidental fix would have
  failed CI.
- **The defect is invisible in the common read.** The `${subject}` interpolation
  looks correct in source; you only see the disagreement by rendering the string
  with the fallback value.
- **The two builders drifted independently.** The help-chat copy is a separate
  file that nothing links back to the Salon builder, so a reader fixing one had
  no signal that the other existed.

## The fix

1. Rewrite the block in second person in
   `lib/chat/context/system-prompt-builder.ts`, deleting the `subject` lookup.
2. Apply the identical change to `lib/help-chat/system-prompt-builder.ts`.
3. Record the blame finding as a `WHY` comment at the site, so the next reader
   does not have to re-derive whether the third person was deliberate.
4. Replace the test assertion that pinned the defect. **When a test pins a
   defect, changing the assertion is the fix, not a weakening of it** — the new
   assertions require the second-person sentence and forbid `CALLS them`
   outright.
5. Update both cache-determinism goldens (`bd27b1ca407d9901` →
   `7517f7d9b496d20b`, `911204033cd41164` → `74c9b488b4a1517c`), after confirming
   from `git diff` that the sentence was the sole output-affecting delta, and
   record the transition in an inline golden-history comment.

## Verification

Build a system prompt for a character with **no pronouns recorded** and any tool
instructions present. Before the fix the prompt ends on *"they CALLS them — they
does not merely describe calling them"*; after it, on *"When you use workspace
tools, you CALL them — you do not merely describe calling them."*

Mechanically: `__tests__/unit/cache-determinism/system-prompt.test.ts` →
*"the tool reinforcement addresses the character directly, with no pronoun
lookup"*, which asserts the new sentence and the absence of both `CALLS them` and
`<name> uses workspace tools`. The fixture carries `she/her/hers`, so a
reintroduced pronoun lookup fails there in either spelling.

## Related

The wider audit that found this is
[prompt-person-consistency.md](../../features/complete/prompt-person-consistency.md). It
records three further person inconsistencies in the same prompt — the aliases,
pronouns, and physical-appearance blocks — of which the **pronouns block is the
one whose literal reading is wrong**: *"Always use these pronouns when referring
to this character"*, addressed to that character, is a sentence written for a
narrator and delivered to the subject. Those are not fixed here.
