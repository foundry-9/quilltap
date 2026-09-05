---
url: /aurora
---

# Refine from Memories

> **[Open this page in Quilltap](/aurora)** — then select a character and click **Refine from Memories**

The Character Optimizer — known in polite society as **Refine from Memories** — is rather like hiring a particularly astute biographer to read through your character's accumulated experiences and suggest how their official dossier might better reflect who they've actually become. Characters, you see, have a habit of growing beyond their original descriptions, and this tool ensures the paperwork catches up with the personality.

## How It Works

Over the course of many conversations, a character's Commonplace Book fills with memories — observations, habits, emotional patterns, and relational dynamics that emerge naturally through interaction. Some of these memories are reinforced multiple times, indicating patterns of genuine significance rather than passing fancies.

The optimizer reads these heavily-reinforced memories alongside the character's current configuration and, with the assistance of an AI analysis, identifies behavioral patterns that aren't yet captured in the character's fields. It then proposes specific, concrete modifications — not vague suggestions, but actual text changes — that you review one at a time.

## Accessing the Optimizer

1. Navigate to the **Aurora** page (`/aurora`)
2. Select the character you wish to refine
3. In the character header, click the **Refine from Memories** button (the lightbulb icon)
4. The optimizer opens in a full-screen overlay

## Prerequisites

- The character must have at least **2 memories** that have been **reinforced 2 or more times**. Characters with thin dossiers in their Commonplace Book will be politely informed that there isn't yet enough material to work with.
- You must have at least one **connection profile** configured. The optimizer uses a capable model for its analytical work — this is not a job for the office intern.

## The Four Phases

### Phase 1: Preflight

Before the analysis begins, you'll see a summary of the character and a dropdown to select which connection profile (and thus which AI model) should perform the analysis. The character's default profile is pre-selected, but you may choose another if you prefer a different analytical temperament.

Click **Commence Refinement** when ready.

#### Memory Count

A slider allows you to choose how many memories the optimizer should consider — from 5 to 200, in increments of 5. The default is 30. A character with thousands of memories may benefit from a broader analysis, while a focused review might warrant fewer.

#### Filtering Memories

Expand the **Filter Memories** section to narrow which memories are analysed:

- **Search Query** — Enter a word or phrase. With "Use semantic search" enabled (the default), the optimizer will find conceptually related memories using embeddings; with it disabled, it performs a simple text match.
- **Since / Before** — Date filters that restrict analysis to memories created within a specific window.

Filters are applied before the memory count limit, so if 142 memories match your query but the slider is set to 30, the top 30 by weight will be selected and the remainder noted.

### Phase 2: Analysis & Progress

The optimizer works through three stages, each reported with an animated progress bar and elapsed timer:

1. **Loading** — Retrieves the character's configuration and their most significant memories (filtered to those reinforced at least twice, limited by your slider setting)
2. **Analyzing** — The AI reads through the character data and memories, identifying 3–8 behavioral patterns not fully reflected in the current configuration
3. **Generating** — Based on the analysis, the AI proposes concrete field modifications with significance scores

The progress bar shows three segments — one per stage — that fill as each proceeds. An elapsed timer counts up below. When filters narrow the results, you'll see a message such as "142 memoirs matched; top 30 selected for analysis."

During **Generating**, the optimizer makes *one focused pass per subject* rather than pooling everything into a single verdict. A first pass handles the general fields (identity, description, manifesto, personality, example dialogues, talkativeness); then each of the character's existing scenarios is considered on its own terms, as is each existing system prompt; a dedicated pass refines the physical description (the prose appearance and its tiered image prompts); a wardrobe pass considers whether the memoirs establish a habitual garment or accessory worth adding (or an existing item's description worth sharpening); an aliases pass listens for nicknames other characters repeatedly use; and a final pass asks whether any genuinely new system prompts are warranted by the patterns the memoirs reveal. The optimizer no longer invents new scenarios — existing scenarios may be refined, but new ones are out of scope. The modal shows a sub-step label such as "Scenario 2 of 5 — Tea Room" so you can see which subject is currently under consideration. This is more thorough (and, in candour, more costly in model calls) than a single sweeping pass, but it means per-subject quirks are no longer averaged out across siblings.

When the analysis completes, you'll see a summary of the behavioural patterns discovered.

### Phase 3: Suggestion Review

Suggestions are presented one at a time, each showing:

- **Field badge** — Which field would be modified (description, personality, system prompt, etc.)
- **Current vs. proposed text** — A clear comparison of what exists and what's suggested. Empty fields are marked as additions rather than changes.
- **Rationale** — Why the change is recommended, referencing specific behavioral patterns
- **Memory excerpts** — The actual memories that support the suggestion
- **Significance indicator** — How substantial the change would be (low, medium, or high)

For each suggestion, you may:

- **Accept** — Take the proposed change as-is
- **Reject** — Decline the suggestion
- **Edit & Accept** — Modify the proposed text before accepting

Navigate between suggestions freely — you needn't review them in order, and you may revisit any decision before proceeding.

### Phase 4: Apply

A final summary shows all accepted changes. Review them once more, then click **Apply** to update the character. The changes are saved as a batch, and the character's view refreshes to reflect the new configuration.

For characters whose properties are read from a document-store vault (the "Read from document store" switch on the character edit page, with a linked character vault), accepted changes route through the existing write overlay — they are written back to the relevant vault files (e.g. `personality.md`, `Prompts/<Name>.md`, `Scenarios/<Title>.md`) rather than to the database row. No extra step is required; the apply flow detects the vault and does the right thing.

## Saving Proposals to the Vault Instead of Applying

For characters that have a linked document-store vault, a second output mode is available. Tick **Save as suggestions in the vault (for later discussion)** in the Preflight phase and the optimizer will, instead of presenting the usual review-and-apply flow, inscribe its findings as a single markdown dossier at:

```
Suggestions/refinement-<YYYYMMDD-HHMMSS>.md
```

inside the character's vault. The dossier opens with YAML frontmatter identifying the run, then carries the analysis summary, the observed behavioural patterns, and each proposed change as its own section — grouped as General Fields, Scenario Refinements, Physical Description, Wardrobe, Aliases, System Prompt Refinements, and Proposed New System Prompts. Each proposal shows the current and proposed text in fenced blocks, its significance score, the rationale, and the supporting memoir excerpts.

Nothing is applied to the character in this mode — the dossier exists for the author and the character to read together (or for the character to consult via `doc_read_file` in-chat) and then commission piecemeal at leisure. To actually commission a proposal, edit the relevant vault file (or re-run the optimizer in its default apply-and-review mode with the proposal as your guide). The checkbox only appears when the character is vault-backed; it has no effect on characters whose properties live solely in the database.

## Fields Eligible for Suggestions

The optimizer may propose changes to:

- **Identity** — The surface, public-knowledge view of the character: name, station, occupation, reputation. What strangers know on sight or by hearsay.
- **Description** — How acquaintances perceive the character: behaviour, mannerisms, frequent verbal patterns. Not physical appearance, not internal monologue.
- **Manifesto** — The character's axiomatic core and load-bearing truths. *Suggestions are rare and high-stakes.* The optimizer only proposes manifesto edits when memory contradicts a basic tenet or reveals a foundational fact not yet captured — never for stylistic improvements. Manifesto instability is treated as a red flag warranting careful review.
- **Personality** — The character's own self-knowledge: the internal driver of speech and behaviour. Not visible to others unless shared.
- **Scenarios** — Refinements to the content of *existing* named scenarios where the established setting no longer reflects how the character actually behaves in that context. The optimizer will **not** invent new scenarios.
- **Example Dialogues** — Sample conversations demonstrating voice
- **Physical Description** — The character's appearance: the prose `fullDescription` and the tiered image-generation prompts (`shortPrompt`, `mediumPrompt`, `longPrompt`, `completePrompt`). Only refined when the memories genuinely reveal a visible, physical trait.
- **System Prompts** — Existing named system prompts may be refined, and the optimizer may also propose an *entirely new* system prompt (with a suggested name) when the memories reveal an interaction style the existing set doesn't cover. New prompts are saved under their proposed name.
- **Wardrobe** — When the memoirs establish a signature garment or accessory the wardrobe lacks, the optimizer may propose adding it (as a proper slot-typed item, image cue and all), or sharpening an existing item's description. It never proposes bodily features as wardrobe (those belong to the physical description), and never proposes removing items.
- **Aliases** — Nicknames or alternate names that other characters repeatedly use may be proposed as additions to the alias list — one suggestion per alias, additions only.
- **Talkativeness** — The character's verbosity setting (a number between 0.1 and 1.0)

The optimizer will **not** touch names, pronouns, titles, first messages, or other structural fields — though it now *sees* all of them (along with the full wardrobe) as context, so its suggestions no longer collide with what's already on record. Pronouns in particular are read-only: the optimizer will never propose changing them.

The optimizer enforces these vantage points strictly: it will not, for instance, slip a private mannerism into Identity, nor put public reputation into Personality. Each suggestion is sorted into the field whose vantage point matches the underlying memory.

It also preserves each field's established form of address. Fields the character alone reads (Manifesto, Personality, System Prompts) are written to the character — *"You keep your worry behind your teeth"* — while fields only others read (Identity, Description) speak of the character from outside, and physical-description prompts remain bare descriptive phrases. Proposed text keeps to the voice its field already speaks in; if a suggestion seems to have wandered into the wrong register, that alone is fair grounds for Edit & Accept.

## What Counts as "About This Character"

The optimizer only learns from memories *about the character themselves* — self-knowledge stored in their Commonplace Book. Memories the character holds about other participants (the user, other characters in a scene) are excluded, because letting another person's habits seep into a behavioural-pattern analysis would distort the character's own portrait. The strict cut also excludes a small legacy pile of unattributed memories from older Quilltap versions; if you find your candidate count surprisingly low, that may be why.

## Tips for Best Results

- **More memories, better analysis.** Characters with dozens of reinforced memories will receive more nuanced and useful suggestions than those with the bare minimum.
- **Use a capable model.** This is analytical and creative work — a more capable model will produce better insights and more natural-sounding suggestions.
- **Don't accept everything.** The optimizer's suggestions are just that — suggestions. You know your character best. Accept what rings true and reject what doesn't.
- **Edit liberally.** The "Edit & Accept" option exists because the AI's proposed text might capture the right idea in slightly the wrong voice.
- **Use filters for focused refinements.** Search for a specific topic ("betrayal", "relationship with the duke") to get suggestions that lean into that particular aspect of the character's history.
- **Date ranges help with arcs.** If a character went through a significant shift in recent sessions, narrow the date range to focus on that period.
- **Increase the memory count for broad analysis.** The default 30 is good for most characters, but long-running characters with hundreds of reinforced memories may benefit from 100 or more.
- **Run it periodically.** As a character accumulates more memories from new conversations, running the optimizer again may reveal new patterns.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora")`

## Related Topics

- [Characters](characters.md) — Character overview
- [Character Editing](character-editing.md) — Manual field editing
- [Character System Prompts](character-system-prompts.md) — System prompt management
- [Connection Profiles](connection-profiles.md) — Setting up AI providers
