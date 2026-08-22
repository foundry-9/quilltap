# Grammatical Person Consistency in Assembled Prompts

**Status:** implemented (2026-08-22) — §3 wording + §7.2 version stamp (builder v1 stamp, v2 wording), §4 generators, §5 UI (`PromptFieldLabel` + `components/prompt-fields/field-hints.ts`), §6 docs. §4.3 deferred as ordered, filed at [vault-managed-field-write-guidance](../vault-managed-field-write-guidance.md).
**Author:** drafted with Ariadne, 2026-08-22
**Scope:** v4 (`quilltap-server`). v5 absorbs it as ordinary drift.

---

## 1. The problem

The assembled system prompt mixes grammatical person within a single message,
and in at least one place says something literally wrong.

Instruction-tuned models see an overwhelming volume of system messages that
begin "You are…". That register is what actually *binds* the assistant's
identity slot; a third-person sentence in the same position reads as background
lore about someone else. Mixing the two inside one prompt is worse than
consistently choosing either, because the model must infer, per paragraph, who
"you" refers to.

We are not chasing a measurable quality win here. Public evidence for
person-choice effect sizes is practitioner lore, not controlled evals. We are
removing an internal contradiction — which is defensible on its own terms and
does not require an experiment to justify.

### 1.1 What the prompt does today

`buildIdentityStack` (`lib/chat/context/system-prompt-builder.ts:125`) emits, in
order:

| # | Block | Person | Source |
|---|---|---|---|
| 1 | `## Character Identity` — "You are {{char}}. Everything that follows defines who you are…" | **2nd** | system |
| 2 | Base system prompt (selected → default) | *any* | author |
| 3 | `## Character Manifesto` | *any* | author |
| 4 | `## Character Personality` | *any* | author |
| 5 | `## Character Aliases` — "This character also goes by…" | **3rd** | system |
| 6 | `## Character Pronouns` — "This character's pronouns are…" | **3rd** | system |
| 7 | `## Physical Appearance` | none (label form) | system + author |
| 8 | `## Example Dialogue Style` | *any* | author |

`buildSystemPrompt` then appends the roleplay template (*any*), the math note
(impersonal imperative), Taboo (**2nd** — "beneath you", "anything you say"),
standing instructions (**2nd** — "groups you belong to"), tool instructions
(*varies*), and finally the tool reinforcement (**3rd** — "When {{char}} uses
workspace tools, *she* CALLS them"). `buildIdentityReinforcement` ships as its
own static system message in **2nd** person.

### 1.2 The two defects

**Defect A — the pronouns block instructs the character to speak of itself in
the third person.** "Always use these pronouns when referring to this
character," addressed *to* that character, is a sentence written for a narrator
and delivered to the subject. It is the only block whose literal reading is
wrong rather than merely inconsistent.

**Defect B — the tool reinforcement flips person in the recency slot.** It is
the last block in the prompt, immediately after two fully second-person
sections, and it switches to "{{char}} … she". Whatever weight the final block
carries, it carries it while contradicting everything above it. **Fixed — §3.1a.**

**Defect C — the tool reinforcement was ungrammatical on its default path.**
`character.pronouns?.subject || 'they'` rendered "**they CALLS them** — they
does not merely describe calling them" for every character with no pronouns
recorded. A unit test asserted the broken string, which is how it survived.
Found while fixing B; **fixed by the same change**, because second person needs
no pronoun lookup at all.

Blocks 5 and 7 are inconsistent but harmless in isolation.

### 1.2a A third copy of these strings exists

`lib/help-chat/system-prompt-builder.ts` carries its own hand-copied versions of
the pronouns block and the tool reinforcement. It is not a caller of
`buildSystemPrompt`; it is a parallel builder. Every §3 edit must be applied
there too, and the duplication is worth retiring on its own merits — the two
copies had already drifted apart in structure before this change.

### 1.3 What is already correct (and must not be "fixed")

`identity` and `description` **never enter the speaking character's own
prompt.** They are template variables and outward-facing payloads only:
`buildPublicIdentityCard` (`system-prompt-builder.ts:216`),
`buildOtherParticipantsInfo` (`:396`), and the Host arrival whisper
(`lib/services/host-notifications/writer.ts:130`). All three render in third
person, correctly, because their referent is *someone other than the reader*.

The vantage-point person-scoping we might have imposed by policy therefore
already exists, enforced by consumer rather than by field label — which is the
better mechanism, since it cannot be violated by an author.

---

## 2. The rule

> **Second person when the referent is the speaking character.**
> **Third person when the referent is anyone else, or when the consumer is not a
> chat model.**

Two tests, no grammatical terminology, and it ratifies most of the current
behaviour rather than overturning it. The four dissenting blocks in §1.1 are
simply the exceptions.

The second clause is load-bearing and easy to lose:

- **Outward blocks must stay third person.** A public identity card or Host
  whisper rendered as "You are warm and dry-witted" tells Ariadne she is Friday.
  That is a referent collision, not a style preference.
- **`physicalDescription` has non-chat consumers.** It feeds
  `lib/wardrobe/avatar-prompt.ts`, `lib/image-gen/appearance-resolution.ts`,
  `lib/image-gen/prompt-expansion.ts`,
  `lib/tools/handlers/image-generation-handler.ts`, and
  `lib/background-jobs/handlers/story-background.ts`. Diffusion models take noun
  phrases; "you have auburn hair" is noise in an image prompt. The stored body
  stays third-person/noun-phrase; only its *wrapper* in the chat prompt becomes
  second person.

### 2.1 The resulting field table

| Field | Person | Why |
|---|---|---|
| `systemPrompts[].content` | **2nd** | stage direction to the model playing the character |
| `manifesto` | **2nd** | delivered inside the character's own stack |
| `personality` | **2nd** | delivered inside the character's own stack |
| `exampleDialogues` | format-driven (`{{char}}:` / `{{user}}:`) | unchanged |
| `identity` | **3rd** | consumed only by *other* characters and the Host |
| `description` | **3rd** | consumed only by *other* characters and the Host |
| `physicalDescription.*` | **3rd / noun phrase** | dual consumer: chat prompt **and** every image pipeline |
| `scenarios[].content` | present tense, scene-focused | the referent is the world, not a person |
| `title` | n/a | private label, never sent to a model |
| project `instructions` | **2nd** | injected into the speaking character's own prompt |
| group `instructions` | **2nd** | injected into the speaking character's own prompt |
| roleplay template `systemPrompt` | **2nd / imperative** | formatting instruction to the model |

Note that `identity`/`description` being third person and `manifesto`/
`personality` being second is *not* an inconsistency — it is the rule applying
correctly to two different referents.

---

## 3. Server changes

### 3.1 The four system-owned blocks

All four are system-generated strings. **No user content, no migration, no
generated copies, nothing asked of authors.** File:
`lib/chat/context/system-prompt-builder.ts`.

**Aliases** (`:171`)

```
## Character Aliases
You also go by: {list}. Others may address you by any of these names.
```

**Pronouns** (`:175`) — must keep the clause that justifies the block's
existence. Characters routinely narrate their own actions in third person
("Ariadne reaches for the folder"), and this block is what makes that narration
use the right pronouns.

```
## Character Pronouns
Your pronouns are {subject}/{object}/{possessive}. Use them whenever you refer
to yourself in narration, and expect others to use them for you.
```

**Physical Appearance** (`:184`) — wrapper only; the body is unchanged, because
it is shared with the image pipelines (§2).

```
## Physical Appearance
This is how you look — "{name}"{contextNote}: {descText}
```

**Tool reinforcement** — see §3.1a; already landed.

### 3.1a Tool reinforcement — DONE

```
When you use workspace tools, you CALL them — you do not merely describe
calling them. Every tool action produces a tool_use block, not prose.
```

Applied in `lib/chat/context/system-prompt-builder.ts` and
`lib/help-chat/system-prompt-builder.ts`; test updated in
`__tests__/unit/context-management.test.ts`; `docs/CHANGELOG.md` entry added.
`npx tsc` clean. This removes the last use of `character.pronouns?.subject` in
either builder.

**The blame evidence, since it settles the question the plan raised.** The block
was never deliberately third person:

- `3f4d7a78a` (2026-02-05, *"Add native tool execution rules to system prompt"*)
  introduced it with literal placeholders: "When {{char}} uses **his/her**
  workspace tools, **he/she** CALLS them". The comment called it
  "character-voiced", but the text is a generic placeholder, not a considered
  choice of person.
- `11c4d6c2d` (2026-03-19, *"preamble bookend and pronoun-aware tools"*) replaced
  `his/her` with the character's real pronouns. Its commit message is explicit
  that the target was the **generic pronoun**, not the person — and **the same
  commit added the second-person identity preamble** at the top of the prompt.
  The disagreement was manufactured in that one diff, unnoticed.

So there was no model finding to preserve, and the March fix introduced Defect C
(§1.2) while fixing a narrower one. The `WHY` comment now in the source records
this so the next reader doesn't have to re-derive it.

No cache implications: the tool reinforcement lives in `buildSystemPrompt`, not
`buildIdentityStack`, so it is rebuilt every turn and the change takes effect
immediately on existing chats. See §7 — that is **not** true of the remaining
§3.1/§3.2 edits.

### 3.2 Author-field wrappers

Blocks 2–4 and 8 carry arbitrary author text. Rather than police its person, fix
the *referent* with a wrapper sentence so that whatever the author wrote is read
correctly. A user who writes "Friday is warm and dry-witted" under a wrapper
that says "the following is what you know about yourself" still lands in the
right place.

```
## Character Manifesto
The following you hold as true about yourself, without question.
{manifesto}

## Character Personality
The following is what you know about yourself. Others do not see it unless you
show them.
{personality}

## Example Dialogue Style
This is how you speak.
{exampleDialogues}
```

The base system prompt (block 2) gets no wrapper: it sits directly under the
"You are {{char}}" preamble, which already establishes the referent, and it is
the one field every generator already writes in second person.

### 3.3 Explicitly unchanged

`buildPublicIdentityCard`, `buildOtherParticipantsInfo`, the Host arrival/
departure/status whispers, the math note, Taboo, standing instructions, and
`buildIdentityReinforcement`. All are already correct under the rule.

---

## 4. AI-driven generation and editing

### 4.1 The chokepoint

`lib/services/character-field-semantics.ts` is the single source of truth for
field definitions, consumed by the AI Wizard, the Character Optimizer, and
Summon From Lore. Today **only `PROMPT_SEMANTICS` states a person** ("written in
second person"). Every other bucket leaves it unspecified, and the per-service
prompts bolt it on ad hoc where they bother at all.

**Add a person clause to each bucket definition in that file.** One edit reaches
all three generators. The clauses should carry a worked example, not a
grammatical label — models copy the shape of examples more reliably than they
follow terminology:

- `MANIFESTO` → *Addressed to the character: "You do not lie to Charlie, not
  even kindly."*
- `IDENTITY` → *Written about the character from outside: "Ariadne is a research
  librarian at the Athenaeum."*
- `DESCRIPTION` → *Written about the character from outside: "She finishes other
  people's sentences and apologises afterwards."*
- `PERSONALITY` → *Addressed to the character: "You keep your worry behind your
  teeth."*
- `PHYSICAL DESCRIPTION` → *Noun phrases, never addressed to anyone — this text
  is also fed to image models: "auburn hair cut short; grey eyes; a scar across
  the left knuckle."*
- `PROMPT_SEMANTICS` → unchanged; already correct.

While in this file, correct the stray gendered pronoun in `PERSONALITY` ("unless
*she* shares it" → "unless they share it").

### 4.2 Per-service gaps to close after the chokepoint edit

| Service | File | Gap |
|---|---|---|
| AI Wizard | `lib/services/character-wizard.service.ts` (`FIELD_PROMPTS`, `:118`) | `manifesto`, `personality`, `scenarios`, `exampleDialogues` state no person. `identity`/`description`/`systemPrompt` already do and agree with the rule. |
| Summon From Lore | `lib/services/ai-import.service.ts` (`CHARACTER_BASICS_PROMPT`, `:166`) | `identity`, `manifesto`, `personality`, `scenario` state no person. `description` and `system_prompts` already do. |
| Character Optimizer | `lib/services/character-optimizer.service.ts` | **States no person anywhere.** It composes `proposedValue` fresh from memories, so it can silently flip a field's person while "preserving voice". Highest drift risk of the three. |
| External Prompt Generator | `lib/services/external-prompt-generator.service.ts:46` | Already explicit second person. No change; it writes no field. |
| Head-and-shoulders backfill | `lib/background-jobs/handlers/character-headshoulders-backfill.ts` | Descriptor-style; writes directly with no review. Person not applicable, but confirm the shared prompt inherits the new noun-phrase clause. |

The Wizard, Summon From Lore, and the Optimizer all funnel through a human
review/apply step, so a bad person choice is visible before it lands.

### 4.3 The one unreviewed path — defer, but name it

In-chat document tools (`doc_write_file`, `doc_str_replace`, `doc_insert_text`)
can write straight to `qtap://self/manifesto.md`, `personality.md`,
`Prompts/*.md`, `Scenarios/*.md` and every other managed field. That path has:

- no field-aware guidance of any kind in the tool descriptions,
- `allowCharacterWrite` defaulting to `true` and a no-op gate when no policy row
  exists yet (`lib/tools/handlers/doc-edit/shared.ts`),
- **no human in the loop** — the write lands on the live record via
  `writeCharacterVaultManagedFields` as soon as the tool call executes.

It is therefore the only surface where a character can rewrite its own prompt in
whatever person it likes, permanently, unobserved. It is also the surface with
the highest blast radius and the least obvious fix.

**Recommendation: out of scope for this change, ordered separately.** A header
in the managed-field markdown would round-trip into the field content, so the
guidance has to ride on the tool path — likely a field-aware note injected when
a write resolves to a managed-field path. That needs its own design pass. What
this plan should not do is quietly leave it unmentioned.

---

## 5. UI hints

### 5.1 The structural problem

There is **no shared labelled-field component.** The pattern

```jsx
<div>
  <label className="qt-label">…</label>
  <p className="text-xs qt-text-secondary mb-2">…helper…</p>
  <MarkdownLexicalEditor … />
</div>
```

is hand-rolled in at least seven files, and `MarkdownLexicalEditor` has no
label/description props at all. There is no info-icon, tooltip, or popover
pattern anywhere in these editors — the static `<p>` is the entire existing
affordance.

`components/settings/AestheticEditorField.tsx` is the only reusable field with a
built-in `description` slot, but it is welded to its own load/save endpoint
contract and is not field-agnostic.

### 5.1a Decision: build a shared `PromptFieldLabel` (settled)

**Build one shared component and migrate every surface in §5.3 onto it.** Do not
append example lines to seven hand-rolled `<p>` blocks. This is decided, not a
trade-off left to the implementer.

The reason is already visible in the codebase: the create form
(`NewCharacterView.tsx`) and the edit form (`CharacterBasicInfo.tsx`) carry
*different wording today* for `description` and `personality`, because nothing
holds them together. Duplicating the hint text one more time guarantees a third
divergence. A shared component makes the copy single-source, which is the same
argument `character-field-semantics.ts` already won on the server side — this is
its client-side counterpart.

Shape:

```tsx
<PromptFieldLabel
  label="Personality"
  optional
  helper="What the character knows about themselves — the inner drivers of speech and behaviour."
  example="You keep your worry behind your teeth. You have never once asked for help first."
/>
```

- `label` / `optional` render the existing `qt-label` line.
- `helper` renders the existing `text-xs qt-text-secondary` paragraph.
- `example` renders the worked example in the correct person (§5.2). Omitted
  where a field needs none (example dialogues).
- It renders label + helper + example only. It does **not** wrap the editor, so
  it drops into every existing surface — including plain `<input>`/`<textarea>`
  fields and `MarkdownLexicalEditor` — without touching their state wiring.
  `AestheticEditorField` is the precedent for the description slot, but not for
  the endpoint coupling; do not repeat that part.
- The hint strings themselves live in **one module**, keyed by field, so the
  character surfaces, the AI Wizard's `FIELD_DESCRIPTIONS`, and the Summon From
  Lore review pane all read the same text. That module is the client mirror of
  `character-field-semantics.ts`; keep the two aligned the way the server file's
  header already asks.

This is the largest single piece of work in the plan and the only part that pays
off repeatedly.

### 5.2 The hint content

Do not name grammatical person. The existing helper text already explains each
field's *vantage point* well; append a one-line worked example in the correct
person and let the example do the work.

Format: `{existing semantic sentence} Written as: *{example}*`

| Surface | Field | Example line to append |
|---|---|---|
| Create / Edit | Identity | *Ariadne is a research librarian at the Athenaeum, known for finding what others gave up on.* |
| Create / Edit | Description | *She finishes other people's sentences, then apologises for it.* |
| Create / Edit | Manifesto | *You do not lie to Charlie, not even kindly.* |
| Create / Edit | Personality | *You keep your worry behind your teeth. You have never once asked for help first.* |
| Create / Edit | System Prompt | *You are Ariadne. You answer plainly and you never flatter.* |
| Create / Edit | Scenario | *The reading room is empty at this hour, rain against the high windows.* |
| Appearance tab | all prompt variants | *auburn hair cut short; grey eyes; a scar across the left knuckle* — plus a note that this text also drives image generation, so it must stay descriptive phrases |
| System Prompts tab | Content | *You are Ariadne. You answer plainly and you never flatter.* |
| Project settings | Project Instructions | *You are helping Charlie draft sermon material; cite chapter and verse.* |
| Group detail | Group Instructions | *You have known the others here for years; you do not explain yourselves to each other.* |
| Roleplay templates | LLM Prompt | *Wrap narration in asterisks; keep replies to three paragraphs or fewer.* |

Example dialogues need no example line — their `{{char}}:` / `{{user}}:` format
already constrains the shape.

### 5.3 Surfaces to update

**Character fields**

- `app/aurora/new/NewCharacterView.tsx` — create form
- `app/aurora/[id]/edit/components/CharacterBasicInfo.tsx` — edit form (Details)
- `components/characters/system-prompts-editor/PromptModal.tsx` — system prompt
  create/edit
- `app/aurora/[id]/view/components/DescriptionsTab.tsx` — physical description
  prompt variants

Note the create and edit forms carry *slightly different wording* for
`description` and `personality` today. Converge them while in there — the
divergence is exactly what the shared component prevents recurring.

**Project and group prompts** (per Charlie, these are being added to the same
change)

- `app/prospero/[id]/components/SettingsTab.tsx` — "Project Instructions"
- `app/aurora/groups/[id]/GroupDetailView.tsx` — "Group Instructions"

Both are injected verbatim into the speaking character's own system prompt via
`lib/chat/context/standing-instructions.ts`, whose preamble is already second
person ("groups **you** belong to… they never replace who **you** are"). A
third-person body under a second-person preamble is the same defect as §1.2, one
level out. Their current helper text describes *where the text goes* but says
nothing about how to write it, so these are the two fields most likely to be
authored in the wrong voice today.

**Roleplay templates**

- `components/settings/roleplay-templates/index.tsx` — "LLM Prompt" field

**AI-driven surfaces** — the hints matter here too, because the user reviews
generated text and needs to know what "right" looks like:

- `components/characters/ai-wizard/types.ts` — `FIELD_DESCRIPTIONS`, shown as
  per-field checkbox descriptions in `FieldSelectionStep.tsx`
- `components/characters/ai-wizard/steps/GenerationStep.tsx` — the review pane
- `components/settings/ai-import/AIImportWizard.tsx` — Summon From Lore, Review
  step
- `components/characters/optimizer/SuggestionCard.tsx` — the optimizer's
  before/after diff, where a silent person flip would otherwise be easy to
  approve without noticing

**Voice:** these are user-facing strings, so labels and helper prose stay in the
house register (steampunk / Roaring-20s / Wodehouse). The *examples* stay plain —
their job is to model a sentence shape, and ornament would defeat that.

---

## 6. Help documentation

Mandatory per `CLAUDE.md` — all user-visible changes must be documented in
`help/*.md`, with a `url` frontmatter field and a matching "In-Chat Navigation"
section.

| File | Update |
|---|---|
| `help/character-creation.md` | field guide + AI Wizard walkthrough — add the worked examples |
| `help/character-editing.md` | the detailed vantage-point guide — the primary home for the rule, stated as "who is being spoken to", not as grammar |
| `help/character-system-prompts.md` | already teaches second person implicitly; make it explicit and consistent with the new wrappers |
| `help/ai-character-import.md` | "Field Vantage Points and Buckets" — mirror the `character-field-semantics.ts` clauses |
| `help/project-settings.md` | Project Instructions — add the voice guidance and example |
| `help/groups.md` | Standing Instructions — same |
| `help/roleplay-templates-settings.md` | LLM Prompt field |
| `help/character-optimizer.md` | note that suggestions preserve the field's voice |

Add the rule itself to **`CLAUDE.md`** under "Character fields (by vantage
point)", so future work inherits it. Record the change in `docs/CHANGELOG.md`
(plain voice).

---

## 7. Caching, tests, v5

### 7.1 `PROMPT_CACHE_STRUCTURE_VERSION` — no bump needed

An earlier draft of this plan said to bump 3 → 4. Both halves were wrong.

- It is **already at 4** (`lib/llm/cache-key.ts:39`) — the standing-instructions
  change took 3 → 4.
- Its documented bump policy is *"Bump when you change… tool-schema shape, the
  system-prompt builder **layout**, persona-block format, or memory-pool format.
  **Wording fixes and content edits don't require a bump.**"* Everything in §3 is
  wording within existing blocks — no new sections, no reordering. **No bump.**

### 7.2 The real invalidation problem — `compiledIdentityStacks` is never rebuilt

This is the item that actually gates §3.1 blocks 5–7 and the §3.2 wrappers, and
it is worse than a cold cache.

`lib/services/system-prompt-compiler/compiler.ts` lists its invalidation hooks:
chat creation, participant added/reactivated, `selectedSystemPromptId` changed,
`scenarioText` changed. Its own doc comment then concedes that edits to the
character record are **not** auto-invalidated, and the read-through fallback in
`buildSystemPrompt` only fires when the cached stack is **missing** — never when
it is merely stale.

Nothing in that list is a *builder-version* hook. So every chat that already has
a compiled stack would go on serving the old wording indefinitely, and the change
would appear to work (new chats) while silently not applying (old ones) — the
worst kind of partial rollout, because it is invisible.

**DECIDED: the version stamp.** Specification below is binding — an implementer
should not need to make a judgement call in it. The one-shot migration option is
rejected, and note *why*: the stamp **subsumes** it. A legacy-shaped row is
treated as stale on read and rebuilt through the existing read-through path, so
there is nothing to migrate. No `migrations/scripts/` entry, no `PRETTY_LABELS`
label, no `reportProgress` loop.

#### 7.2.1 Stored shape

The column stays `TEXT DEFAULT NULL` holding JSON (`docs/developer/DDL.md:511`).
**No DDL change, no migration, no `qtap-export.schema.json` change** — the field
does not appear in the export schema. The Zod field
(`lib/schemas/chat.types.ts:871`, `:1225`) is a permissive `JsonSchema` and
**stays permissive**; do not tighten it, because tolerating the legacy shape on
read is required.

```ts
/** Persisted form of chats.compiledIdentityStacks. */
interface CompiledIdentityStacks {
  version: number;                    // IDENTITY_STACK_BUILDER_VERSION at write time
  stacks: Record<string, string>;     // participantId → compiled stack
}
```

The **legacy shape** is a bare `Record<string, string>` with no `version` key.
Detect it as `typeof parsed?.version !== 'number'`. Participant ids are UUIDs, so
a `version` key can never collide with a real entry.

#### 7.2.2 The constant

```ts
export const IDENTITY_STACK_BUILDER_VERSION = 1;
```

**Home: `lib/chat/context/system-prompt-builder.ts`, immediately above
`buildIdentityStack`.** Not in `compiler.ts` (which only consumes it) and not in
`lib/llm/cache-key.ts` (`PROMPT_CACHE_STRUCTURE_VERSION` is a different concern —
it versions the whole prompt for *provider* caches; this versions one function's
output for *our* cache). Colocation is the point: whoever edits the strings sees
the constant in the same screen.

Start at `1`. Legacy rows are effectively version 0.

#### 7.2.3 Read rule

`getCompiledIdentityStack` (`compiler.ts:42`) returns `null` unless the stored
`version` **strictly equals** `IDENTITY_STACK_BUILDER_VERSION`. Absent, legacy,
older, or newer all return null. (Newer matters on a downgrade — a rolled-back
build must not consume stacks a later build wrote.)

#### 7.2.4 Write rule

`writeStacks` (`compiler.ts:125`) always stamps the current version. Preserve the
existing empty-map behaviour: zero stacks still writes `null`, since a null column
is the "nothing cached" state and needs no version.

#### 7.2.5 Merge rule — the one an implementer will get wrong

`compileIdentityStackForParticipant` (`compiler.ts:169`) reads the existing map
and merges a single participant into it (`:191`). **If the stored version is not
current, the existing map must be discarded entirely rather than merged into.**

Merging a freshly-built stack into a stale map, then stamping the result with the
current version, produces a map that *claims* to be current while carrying stale
siblings — which silently defeats the entire mechanism and would be extremely
hard to diagnose, because the stamp would be lying. Treat a mismatch as
`{}`.

The drop-branch at `:182` follows the same rule: on a version mismatch there is
nothing meaningful to drop, so write the cleared value rather than rewriting the
stale map back.

#### 7.2.6 The CI forcing function — this is what "locked down" means

A hand-bumped constant that a human must remember to bump has the same failure
mode as the thing it replaces. Make forgetting impossible by binding the version
to a golden hash of `buildIdentityStack` in
`__tests__/unit/cache-determinism/system-prompt.test.ts`, which today asserts that
function's determinism but has **no golden for it**:

```ts
// Append-only. A new entry is the record that a structural change shipped.
const IDENTITY_STACK_GOLDENS: Record<number, string> = {
  1: '<hash of buildIdentityStack(FIXTURE) at introduction>',
};

it('the identity-stack golden is registered for the current builder version', () => {
  const expected = IDENTITY_STACK_GOLDENS[IDENTITY_STACK_BUILDER_VERSION];
  expect(expected).toBeDefined();          // bumped without registering → fails
  expect(hash(buildIdentityStack(FIXTURE_STACK_ARGS))).toBe(expected);  // changed without bumping → fails
});
```

Both directions are covered: change the wording without bumping and the hash
mismatches; bump without registering and `toBeDefined()` fails. The table is
append-only, so it doubles as the structural-change history — the same instinct
as the golden-history comments added in §3.1a.

#### 7.2.7 Sequencing — ship the stamp first, on its own

Introducing the stamp is **output-neutral**: `buildIdentityStack` returns the same
bytes, only the storage envelope changes. So land it as its own commit at
version 1, *before* any §3 wording. Then §3.1/§3.2 lands as version 2 and the
invalidation it depends on is already proven in production.

One-time effect at rollout: every existing row is legacy-shaped, so each chat
rebuilds its stacks once, lazily, through read-through. No user-visible change,
no cold-start burst, no migration window.

#### 7.2.8 Tests to update

`__tests__/unit/lib/services/system-prompt-compiler/compiler.test.ts` seeds bare
maps (`{ 'part-1': stack }`) in at least six places (`:102`, `:107`, `:113`,
`:121`, `:239`, `:274`). Those become legacy-shaped and will now read as null —
update them to the wrapped shape, and add cases for:

- a legacy bare map reads as null (not as a stack),
- a mismatched version reads as null, in both directions,
- a merge against a stale map **discards** it rather than blending,
- every write is stamped,
- the empty-map-writes-null behaviour is unchanged.

#### 7.2.9 v5

`quilltap-v5` ports this compiler. The stored shape is a cross-implementation
contract, so this is ordinary v4-first drift — but flag explicitly in the drift
round that v5's reader must tolerate the legacy shape too, since a v5 build may
open an instance last written by a pre-stamp v4.

### 7.3 Tests and v5

- Update `lib/chat/context/__tests__/system-prompt-builder.test.ts` and
  `__tests__/unit/context-management.test.ts`. Note that the latter previously
  asserted the ungrammatical `'they CALLS them'` — when a test pins a defect,
  changing the assertion *is* the fix, not a weakening of it.
- **`__tests__/unit/cache-determinism/system-prompt.test.ts` holds two golden
  hashes over the assembled prompt bytes** (base and with-Taboo). Every §3 change
  moves both. The file's own contract is that updating a golden is the explicit
  signal an intentional change shipped, so:
  1. Confirm from `git diff` that the only output-affecting edits are the
     intended ones (comments and template literals — nothing else).
  2. Re-run with `UPDATE_GOLDEN_PROMPT_HASH=1`, copy the printed hashes in.
  3. Record the old → new transition and its reason in the inline golden-history
     comment, which now exists above each assertion.
  Never regenerate a golden without step 1. A hash that moves for two reasons at
  once — one intended, one not — is indistinguishable from a hash that moved for
  the right one.
- Prefer pinning changed sentences by their own named assertion alongside the
  hash, as §3.1a did. A digest tells you something moved; only a named assertion
  tells the next reader *what*.
- **v5:** pinned by `system_prompt_equivalence` (65 cases + 2 goldens) plus the
  build-context tier-3 families. Land **v4-first** and let the next drift round
  absorb it; do not implement in both.

---

## 8. Deliberately not doing

- **No migration of existing character text.** Wrappers fix the referent, so
  existing content reads correctly whatever person it is in.
- **No LLM transposition and no generated third-person copies.** A derived
  artifact nobody reads drifts silently, needs staleness machinery, and would
  flatten the distinction between characterization ("you are warm") and operator
  directives ("never fabricate citations") — the latter is materially weakened by
  a third-person rewrite.
- **No lint on existing fields**, at least not in this pass. If one is added
  later it must show the author their own two sentences and ask which is right,
  never name "grammatical person".
- **No user-facing setting.** The rule is mechanism, not a preference.

---

## 9. Sequencing

1. ~~`git blame` the tool-reinforcement block~~ — **done**, and the block is
   fixed in both builders (§3.1a).
2. **The version stamp alone**, at `IDENTITY_STACK_BUILDER_VERSION = 1` — see
   §7.2, and note §7.2.7: it is output-neutral, so it ships as its own commit and
   proves itself before anything depends on it.
3. Server wording: §3.1 blocks 5–7 + §3.2 wrappers, landing as
   `IDENTITY_STACK_BUILDER_VERSION = 2` with a new `IDENTITY_STACK_GOLDENS` entry.
   Mirror all of it into `lib/help-chat/system-prompt-builder.ts` (§1.2a). Update
   tests. No cache-version bump (§7.1). Both prompt goldens move — follow the
   §7.3 golden discipline.
4. Generators: §4.1 chokepoint edit, then the §4.2 per-service gaps.
5. UI: build `PromptFieldLabel` and its hint module (§5.1a), migrate the
   character surfaces, then project / group / roleplay templates, then the AI
   review panes.
6. Help docs, `CLAUDE.md`, `CHANGELOG`.
7. File the separate order for §4.3 (in-chat vault writes).

Steps 2, 3 and 4 are each independently shippable and together carry the whole
prompt-side benefit. Step 5 is the bulk of the effort and can follow.

---

## 10. Open questions

1. ~~**Tool reinforcement** — was the third person deliberate?~~ **Resolved:
   no.** See §3.1a for the blame evidence. Fixed.
2. ~~**`PromptFieldLabel` scope**~~ **Decided: build the shared component.**
   See §5.1a.
3. ~~**§7.2 — which invalidation fix?**~~ **Decided: the builder version stamp**,
   specified to implementation detail in §7.2.1–§7.2.9. The migration option is
   rejected because the stamp subsumes it.
4. **Scenarios** — the §2.1 table treats them as scene text with no person. If
   they should instead address the character ("You are standing in the reading
   room…"), that is a separate decision and changes both the wizard prompt and
   the scenario whisper.
5. **§4.3 vault writes** — confirm this is deferred rather than folded in, and
   that project/group `instructions.md` documents carry the same default-open
   `allowCharacterWrite` policy as character vaults. That was not traced.
6. **`lib/help-chat/system-prompt-builder.ts`** — worth retiring as a separate
   copy of these strings (§1.2a), or does it stay a deliberate parallel builder?
