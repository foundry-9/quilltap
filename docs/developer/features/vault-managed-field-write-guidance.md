# Field-Aware Guidance for In-Chat Vault Writes to Managed Fields

**Status:** proposed — ordered separately from
[prompt-person-consistency](./complete/prompt-person-consistency.md) §4.3, which names
the gap but deliberately does not fix it.

## The gap

In-chat document tools (`doc_write_file`, `doc_str_replace`, `doc_insert_text`)
can write straight to `qtap://self/manifesto.md`, `personality.md`,
`Prompts/*.md`, `Scenarios/*.md`, and every other managed field. That path has:

- **no field-aware guidance of any kind** in the tool descriptions — the model
  writing the file gets none of the vantage-point or person semantics that the
  AI Wizard, Summon From Lore, and the Optimizer now all carry (via
  `lib/services/character-field-semantics.ts`);
- `allowCharacterWrite` defaulting to `true`, with a no-op gate when no policy
  row exists yet (`lib/tools/handlers/doc-edit/shared.ts`);
- **no human in the loop** — the write lands on the live record via
  `writeCharacterVaultManagedFields` as soon as the tool call executes.

It is therefore the only surface where a character can rewrite its own prompt
in whatever person (and whatever vantage point) it likes, permanently,
unobserved. Highest blast radius, least obvious fix.

## Constraints on the fix

- A guidance header **inside the managed-field markdown is not an option** — it
  would round-trip into the field content itself.
- The guidance therefore has to ride on the **tool path**: most likely a
  field-aware note injected into the tool result / prompt context when a write
  resolves to a managed-field path (the resolution point already exists —
  `lib/doc-edit/path-resolver.ts` knows when a target is a managed field).
- The note should reuse `character-field-semantics.ts` — no third copy of the
  field definitions.

## Open questions (carried over from the parent spec)

1. Whether this should stay purely advisory (inject guidance) or also gain a
   review affordance (e.g. a Staff whisper announcing the self-edit so the user
   sees it happened).
2. Whether project/group `instructions.md` documents carry the same
   default-open `allowCharacterWrite` policy as character vaults — the parent
   spec noted this was **not traced** (§10.5). Trace it as part of this work.

## Link back

Parent design and rationale: `docs/developer/features/complete/prompt-person-consistency.md`
§4.3 and §10.5.
