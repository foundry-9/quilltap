# Bug 122 — a character is handed other people's memories as their own autobiography

| | |
|---|---|
| **Status** | Fixed in v4 (2026-09-05) |
| **Found** | 2026-09-05 |
| **Fixed** | 2026-09-05 |
| **Severity** | **High** (nothing errors; the turn succeeds and reads *well*. The character simply answers as somebody else — in the observed case a man wrote a woman's reply about breastfeeding her daughter, in her voice, with her history, and the only evidence was the prose) |
| **Who it bites** | every character whose memory store contains memories about other people — i.e. every character in every multi-character chat, plus Carina answerers and character-voiced announcements. Sharpest on weak models and on profiles with `multiCharacterPrefill: 0`, where no `[Name]` anchor sits between the memories and the first generated token |
| **Provenance** | Live (Friday, chat `9703231c` *Milk and Starlight at the East Pool*, 2026-09-05 05:13 UTC, log `f485521b`). Reported by the user noticing that Kumar had answered — well — something addressed to Marion, as Marion |
| **Fix site** | `lib/chat/context/memory-injector.ts` (`MemorySubjectContext`, `formatMemorySubjectPrefix`, threaded through all three self-facing formatters) + `lib/memory/memory-subject.ts` (new) + `CharactersRepository.findNamesByIds` |
| **v5 status** | **Applies.** Any port that stores "what I remember" and "what I remember about you" in one table keyed on the owner, and renders either under a second-person heading, inherits this exactly. The lesson is that a *pool* and a *voice* are two different questions |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-09-05).** The three self-facing memory blocks now name the
subject of any line the character holds about somebody else, the way the
inter-character block always has.

### Symptom

At 05:13:35 Marie (the user's seat) posted, in a four-way pool scene with
Marion, Kumar and Laura:

> *I look over at Marion.*
>
> You're thirty-nine? … I seen you breast-feeding Camille. It's so beautiful.
> It's a miracle is what it is… you had that baby twenty-three years ago and
> this water caused you to have milk for her again.

Kumar answered first, at 05:13:45:

> *Marie has said three things in a row to me — that I look thirty, that the
> water has done that to her too, that she watched me breastfeed Camille and
> called it a miracle.*
>
> "And you watched me feed my daughter… Do you know what it costs me to let
> someone name it that out loud? I spent twenty-three years not letting anyone
> name anything about me at all."
>
> "You are the woman who looked at a stillborn baby's mother and said
> *miracle* without flinching."

Kumar is a thirty-eight-year-old male test engineer from Glendale. Every fact
in that reply is Marion's. It is not a garbled turn — it is a *good* turn,
written for the wrong mouth, which is why it is hard to catch: the scene reads
fine until you notice the nameplate.

His system prompt was intact (`You are Kumar… You control ONLY Kumar`), as was
the identity reminder immediately after it. The contamination arrived 11,000
tokens later, at the very end of the context.

### Root cause

A character's memory store is keyed on `characterId` alone. It holds what the
character remembers about **themselves** and what they remember about
**everyone else**, side by side; `aboutCharacterId` is the only thing that
separates the two. Kumar's store, at the time:

| `aboutCharacterId` | count |
|---|---|
| himself | 215 |
| Charlie | 91 |
| Marie | 17 |
| everyone else | ~70 |

Four formatters in `lib/chat/context/memory-injector.ts` render memories into
context. Exactly one of them says whose life a line describes:

```ts
// formatInterCharacterMemoriesForContext — correct
const memoryLine = `- About ${characterName}: [${age}] ${body}${meta}`
```

The other three printed the bare summary:

```ts
// formatFrozenMemoryArchive  → "## Memory Anchors"
const memoryLine = `- ${summary}${meta}`
// formatDynamicMemoryHead    → "Most relevant memories for this turn:"
const entry = `${idTag} ${whenTag} ${summary}${meta}`
// formatMemoriesForContext   → "## Relevant Memories"
const memoryLine = `- [${age}] ${body}${meta}`
```

and the pools feeding them do not filter by subject either — the frozen
archive is top-N by weight over the whole store, and the head is
`searchMemoriesSemantic(character.id, …)` with no `aboutCharacterId`.

`buildCommonplaceLLMContext` then puts all three under a second-person
heading:

> **You remember the following entries that bear on this moment:**

So what reached Kumar, unattributed, in his own voice:

| line delivered to Kumar | actually about |
|---|---|
| `struggles to become offered mother` | **Marion** |
| `revealed chronic fatal diseases in viscera` | Charlie |
| `declared executive authority to shut door` | Charlie |
| `[m_11de] reassured Marie about her wish` | **Marion** |
| `[m_085e] offered third framing to marion` | Laura |
| `[m_7282] called marions wish answered prayer` | Laura |

Read as a block under "You remember…", that is an autobiography of Marion. The
model wrote the reply it was given the life for.

The fourth section of the same whisper — *"You also recall about the others
present"* — was busy at that moment correctly rendering `- About Marion:
[today] Marion reassured Marie that wishing she had met a better man than her
ex-husband was not shameful…`: **the same memory**, `11de858e`, attributed in
one block and confessed as Kumar's own in another, in the same message.

### Contributing conditions (not causes)

None of these is the bug, but together they removed every guardrail that had
been masking it:

- **`isRecentlyAddressed` was right**, and that is why Kumar was speaking at
  all. Marion had said `"Kumar," I say, quiet, "you said you do not know what
  to do with a place you cannot break."` four turns earlier and he had never
  answered, so the turn note carried *"you should answer rather than pass"*.
  He was correctly forbidden from passing — and then answered the wrong
  question in the wrong voice.
- **`multiCharacterPrefill: 0`** on the DeepSeek v4 Flash profile (a
  consequence of bug 85's fix — thinking-capable models 400 on a synthetic
  assistant prefill). With no trailing `[Kumar]` assistant anchor, the last
  thing in the context before the first generated token was the 12.8k-token
  block ending in Marion's memories.
- **A cheap model.** All three LLM seats ran the same `isCheap` profile.

### Why it survived

- **Every symptom is fluent prose.** No error, no warning, no log line — the
  turn completes, the tokens are billed, the message renders. The only
  detector is a human who knows the cast.
- **The attributed block exists**, and looks like the feature working. A
  reader checking whether Quilltap attributes inter-character memories finds
  `formatInterCharacterMemoriesForContext` doing it correctly and stops.
- **Self-facing blocks are named for their pool, not their subject.** "Memory
  Anchors" and "Most relevant memories for this turn" describe *how the
  entries were selected*; nothing in either name raises the question of whom
  they are about. `formatInterCharacterMemoriesForContext` is the only one
  whose name contains the answer.
- **Summaries are written in the third person** by the extractor
  (`struggles to become offered mother`), which reads perfectly naturally
  under a "you remember" heading. A first-person summary would have jarred.
- **It needs history.** A young character has few memories about others and
  the pools are mostly first-person, so the block is honest by accident. Kumar
  had ~180.

### The fix

One prefix function, required at every self-facing call site.

`MemorySubjectContext` (`{ selfCharacterId, characterNames }`) and
`formatMemorySubjectPrefix(aboutCharacterId, subject)` live in
`memory-injector.ts` beside the formatters. The prefix is `''` for the
character's own memories and for untargeted ones, `About <Name>: ` otherwise —
falling back to `About another character: ` when the id resolves to no name,
because the job is to break the first-person reading and a nameless subject
does that as well as a named one. Losing the name is a degraded line; losing
the prefix is the bug.

Both fields are **required**, not optional, and the parameter is required on
all three formatters. An optional subject would have let a new call site
reintroduce the defect by omission, which is precisely how this one arrived.

`buildMemorySubjectContext` (`lib/memory/memory-subject.ts`) is the one place
that turns a pool into that context. It lives outside `memory-injector.ts` so
that module stays pure formatting with no repository reach. It collects the
distinct `aboutCharacterId`s that are neither absent nor the owner's own — so
a purely first-person store costs no query at all — and resolves them through
the new `CharactersRepository.findNamesByIds`.

`findNamesByIds` deliberately skips the vault overlay. `name` is a plain DB
column, so the overlay has nothing to add, and skipping it is the point: this
runs on the per-turn context path, where a character with an unreadable vault
must cost the caller a *name*, not the whole turn (`findById` throws
`CharacterVaultUnavailableError` on that shelf by design). It returns an empty
map on failure, which degrades to the nameless prefix.

Names are resolved by lookup rather than taken from `participantCharacters`
because a memory's subject is very often someone not in the room — Charlie
accounted for 91 of Kumar's.

Three call sites now supply it: the per-turn build
(`context-manager.ts`, covering both the frozen archive and the dynamic head
in one lookup over the union of the pools), Carina's answerer recall
(`carina.service.ts`, whose search is explicitly documented as spanning the
answerer's whole store), and character-voiced announcements
(`announcer/character-voiced.ts`).

The frozen archive keeps its byte-stability: the prefix is derived from
`aboutCharacterId` and a name map, both stable within a compaction generation.
The prefix is built before the token estimate, so it is paid for out of the
block's budget rather than smuggled past it.

### How to verify

`__tests__/unit/lib/chat/context/memory-injector.test.ts` — the bug-122
describe block: each of the three formatters names a foreign subject, own
memories stay unprefixed in all three, an unresolvable id still gets a prefix,
the archive stays byte-identical across calls, and an attributed archive fits
strictly fewer entries in the same budget than an unattributed one.

`__tests__/unit/lib/memory/memory-subject.test.ts` — dedup, the no-query paths
(first-person pool, empty pool), and the barren-lookup degradation.

Live: in a multi-character chat where a character holds memories about the
others, the Commonplace Book whisper's *"You remember the following entries"*
section should now carry `About <Name>:` on every line that is not the
character's own.

### Not fixed here

`formatLoadedMemoriesSection` (`lib/tools/handlers/self-inventory/formatters.ts`)
renders the same mixed dynamic-head pool under `### Relevant Memories` from
the debug records, with the same lack of attribution. It is a diagnostic tool
report rather than prompt context — it does not steer a turn, and the section
sits next to an explicitly labelled `### Memories About Other Characters` — so
it is left as-is. If `DebugMemoryInfo` ever gains the subject, that report
should take it.
