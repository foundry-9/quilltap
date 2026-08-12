# Bug 5 — a composer run consults the wrong character's fact sheet

| | |
|---|---|
| **Status** | Fixed in v4 (2026-07-27) |
| **Found** | 2026-07-27 |
| **Fixed** | 2026-07-27 |
| **Severity** | Medium |
| **Who it bites** | any operator running a shared/global tool in a chat not led by their own character |
| **Fix size (as estimated)** | ~5 lines |
| **Fix site** | `app/api/v1/chats/[id]/custom-tools/route.ts` — `operatorCharacterIds` + `preferOperator`, applied at the single-variant listing and at POST's fallback |
| **v5 status** | **Owed** — reproduced faithfully on purpose (finding #30); the mirror change is due in the same round |
| **Index** | [bugs.md](../../bugs.md) |

---

**Severity: Medium.** Bites any operator who runs a shared or global custom tool
from the composer in a chat whose first participant is not the character they
are playing. Added and fixed 2026-07-27; **the v5 mirror is still owed.**

### Symptom

The operator plays Charlie and runs the global tool `lambda` from the composer's
Custom Tools button. Charlie's fact sheet lists `toolAbilities: programmable`,
so the tool should take its success branch. Instead it resolves the
`toolAbilities ncontains programmable` outcome — "API Listening Agent not
installed" — which is the branch matching **Friday**, an LLM character in the
same chat whom the operator is not playing.

The run's own record proves what was consulted. From the stored `pascalMeta`:

```
metadataTested: { toolAbilities: "analyze, display, architect" }   // Friday's sheet
outcomeIndex:   2
invokedBy:      "user"
value:          1.9958                                             // passed gte:1
```

The roll would have succeeded against Charlie's sheet. It was tested against
someone else's.

This usually looks correct, which is why it went unnoticed: the first
participant is *usually* the operator's own character. It diverges whenever the
chat was created leading with an LLM character.

### Root cause

Three correct-looking steps compose into the wrong one.

1. **The roster records an arbitrary perspective.** When every character
   resolves a name to the same file — which is exactly the case for a global or
   shared store — `handleList` emits one unlabelled row
   (`app/api/v1/chats/[id]/custom-tools/route.ts:216-223`):

   ```ts
   const { perspective, entry } = sightings[0];
   tools.push(buildListing(entry, perspective, undefined));
   ```

   The comment says so plainly: *"The perspective is arbitrary but must still be
   recorded — POST needs someone to run as."*

2. **`sightings[0]` is the first participant.** `loadPerspectives` (`:107-139`)
   walks `chat.participants` in stored array order. It does not prefer the
   operator's `controlledBy: 'user'` character, and it does not consult
   `isActive` — the field is declared in its parameter type and never read.

3. **The dialog sends that perspective back, and POST believes it.**
   `CustomToolRunDialog.tsx:243` posts `asCharacterId: selectedTool.asCharacterId`,
   and the handler resolves the run against it (`route.ts:356`):

   ```ts
   const metadata = body.asCharacterId ? perspective.metadata : {};
   ```

**The sharpest detail is the comment above that very line.** It explains that a
run naming nobody rolls against an empty sheet *"rather than borrowing some
arbitrary participant's secrets to decide it"* — and then observes, correctly,
that the popup always names someone. For a shared tool, the someone it names
**is** an arbitrary participant. The safeguard is stated and then defeated one
layer up, by a listing that had to write down a name it admits is meaningless.

The same asymmetry governs the state cascade immediately below (`:365-369`): the
`$state` group tier is scoped to `body.asCharacterId`'s groups, so a `$state`
reference in a composer-run tool reads the wrong character's group state by the
same route.

### Scope — what is and is not affected

- **Affected:** a run made from the composer dialog, of a tool every participant
  resolves identically (global store, shared project/group store). Both the
  metadata tests and the `$state` group tier.
- **Not affected — a character rolling mid-turn.** `run_custom` reads
  `context.characterId`, "the rolling character's fact sheet"
  (`lib/tools/handlers/run-custom-handler.ts:115-125`). That path is correct and
  should not be touched.
- **Not affected — a tool whose name means different things to different
  characters.** Those emit one labelled row per variant (`route.ts:229-236`), so
  `asCharacterId` is meaningful and the operator chose it.

Note the interaction with the availability gate (`6864bf0e`): gates are answered
per perspective, before the dedup, so `sightings` holds only characters who
**passed**. For a gated shared tool the arbitrary perspective is therefore the
first *eligible* participant. An operator checking that a gate withholds a tool
can see it succeed from the composer, because it silently ran as someone who
passes.

### Why it survived

The rule is "first participant", and the first participant is usually the
character the operator plays — so the behaviour is right most of the time and
wrong quietly. When it is wrong, the failure is a *plausible outcome*: a tool
that resolves someone else's branch still returns a well-formed result with a
sensible-sounding narration. Nothing errors, and the only place the truth is
written down is `pascalMeta.metadataTested`, which no screen shows.

The v5 differential harness could not have found it: v5 ports this logic
faithfully, line for line, so both sides agree and every case passes. It took a
human running a tool and recognising the answer as belonging to the wrong
character.

### The fix

Prefer the operator's own character when the perspective is arbitrary. The
choice is only made in one place — step 1 above, where the unlabelled row is
built — so the repair belongs there rather than at the POST, which is right to
trust what the listing gave it.

Sketch, at `route.ts:216-223`:

```ts
if (distinct.size === 1) {
  // Prefer the operator's own played character: for a tool everyone resolves
  // identically the perspective is arbitrary, and "arbitrary" should not mean
  // "whoever happens to be first" when one of the candidates is the person
  // actually pressing the button.
  const own = sightings.find(({ perspective }) =>
    userControlledCharacterIds.has(perspective.characterId));
  const { perspective, entry } = own ?? sightings[0];
  tools.push(buildListing(entry, perspective, undefined));
  continue;
}
```

`userControlledCharacterIds` comes from the chat's participants
(`controlledBy === 'user'`), which `handleList` already has in hand as
`chat.participants`. Falling back to `sightings[0]` preserves today's behaviour
for a chat the operator plays no character in, and for a gated tool their own
character does not qualify for.

Two decisions worth making deliberately rather than by omission:

- **Multiple user-controlled characters.** Prefer the *active speaker*
  (`chat.activeTypingParticipantId`) when it names one of them, then fall back to
  the first. Otherwise this trades one arbitrary choice for another.
- **A gate the operator's own character fails.** Falling through to
  `sightings[0]` means the run silently succeeds as someone else — the trap
  described above. It is arguably better to omit the row entirely, or to label
  it with the character it will run as, so the operator can see whose sheet is
  about to be consulted. This is a product call, not a mechanical one.

*As shipped:* both were taken — see
[Decisions taken while fixing](../../bugs.md#decisions-taken-while-fixing). The sketch's
`userControlledCharacterIds` set became an ordered candidate list,
`operatorCharacterIds`, because the active-speaker preference needs an order;
the pick itself is `preferOperator`, which also reports whether it had to fall
back, so the row can label itself when it did.

### Verification

- In a chat created **leading with an LLM character** (so the operator's own
  character is not participant[0]), give the two characters fact sheets that
  select different outcomes of the same global tool. Run it from the composer
  and confirm `pascalMeta.metadataTested` records the **operator's** sheet.
- Confirm the character-invoked path is unchanged: have a character roll the
  same tool mid-turn and check `metadataTested` is that character's sheet.
- Confirm a labelled (per-variant) listing still runs as the character on its
  label — that path must not start preferring the operator.
- Check a `$state`-referencing tool run from the composer resolves the group
  tier against the same character the metadata came from.

### Note for the v5 side

v5 reproduces all of this exactly (`crates/quilltap-core/src/api/custom_tools.rs`
— `sightings[0]` at `:293`, the metadata selection at `:418-422`; the rolling
character's sheet at `src/tools/run_custom.rs:545`). It is recorded there as
dogfood finding #30, ruled **v4-faithful and deliberately not fixed** on
2026-07-24, and queued on that repo's "post-5.0 product improvements (v4-first)"
list. **The two sides must move together**: v5's copy is a verbatim port, and
changing it alone would put the port out of step with its own oracle. When this
lands in v4, the v5 mirror follows in the same round, and the m6 parity note for
the composer popup should be updated with it.
