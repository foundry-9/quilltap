# Bug 108 — a `doc_str_replace` call that omits `find` is reported as "Text not found in file"

| | |
|---|---|
| **Status** | FIXED in v4 (2026-08-29) |
| **Found** | 2026-08-29 |
| **Fixed** | 2026-08-29 |
| **Severity** | Medium (no data is harmed, but the character is told to fix the one thing that is not wrong, and the agent loop burns its remaining iterations repeating the identical malformed call) |
| **Who it bites** | Any character editing a document with a model that drops a required argument — cheap and fast models especially, and any model under a long tool-call payload |
| **Provenance** | Watched live in the Salon: Friday's turn in *The Same Hand That Made the Spear* (`f77a332e-1abc-4180-8bc9-97d031d93005`), 2026-08-29 21:20:31–21:21:17, five agent-loop iterations against `Z.AI glm-5.3-flash`, two of them this failure back to back |
| **Defect site** | `lib/tools/handlers/doc-edit/text-handlers.ts` (`handleStrReplace`, which had no argument guard) × `lib/tools/handlers/doc-edit-handler.ts:157` (the raw-input fallback that lets an unparsed call through) × `lib/doc-edit/diacritics.ts` (`findAllMatches` answering `[]` for an absent needle) |
| **Fix site** | `lib/tools/handlers/doc-edit/text-handlers.ts` — `find` / `replace` guards in `handleStrReplace`, `position` / `content` guards in `handleInsertText` |
| **v5 status** | Not investigated. **The shape applies** to any port that falls back to unvalidated input when a schema parse fails: the guard belongs at the point of use, because that is the only place that knows which argument was needed |
| **Index** | [../bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-29).** `handleStrReplace` now checks its own arguments
before it opens the file, and says which one is missing. `handleInsertText`
gained the same guards for `position` and `content` — the identical hole, and
the likely cause of two older `Cannot read properties of undefined` failures in
the same corpus. The raw-input fallback in the dispatcher was **left in place
deliberately**: it is what lets a `qtap://` URI stand in for `scope` +
`mount_point` + `path`, and it is not the defect. The defect was that no one
downstream of it ever asked whether the arguments had arrived.

## Symptom

Friday, editing `Arming Rail Protocol - Revenant Instrument.md` in the document
store *Project Files: The Estate*, made three `doc_str_replace` calls in one
agent loop. The first named no mount point and was told so. The second and third
came back with

```
Error: Text not found in file. The exact text to find was not present in
Arming Rail Protocol - Revenant Instrument.md. Make sure you are using the
exact text from your most recent read of this file.
```

Between them she re-read the file, exactly as instructed, and repeated the same
call. The text she was looking for was in the file the whole time — the read she
had just performed contains it at lines 36–38, and so does the file on disk:

```
[L36] ## Open items
[L37]
[L38] - Sylvain's first entry (his tempo).
```

The recorded arguments of both failing calls are `mount_point`, `path`,
`replace`, `scope`. **There is no `find` at all.**

## Root cause

Three things line up, none of them wrong on its own.

1. **The dispatcher passes raw input through on a failed parse.**
   `executeDocEditTool` runs each tool's Zod schema and falls back to the
   unvalidated object when it fails:

   ```ts
   case 'doc_str_replace':
     return await handleStrReplace(validateDocStrReplaceInput(input) ?? (input as unknown as DocStrReplaceInput), context);
   ```

   `find` is a **required** field of `docStrReplaceToolInputSchema`, so a call
   without it fails the parse — and then arrives at the handler anyway, with
   `find` undefined. The fallback is deliberate and its comment says why: the
   handlers' own lenient checks produce friendlier errors, and pre-schema flows
   such as a `qtap://` URI standing in for `path` keep working.

2. **The handler guards `path` and nothing else.** It reads the file and hands
   `input.find` straight to the matcher.

3. **The matcher answers an absent needle with "no matches".**
   `findAllMatches` opens with `if (!needle) return []`, which is correct for a
   *search*: nothing was asked for, so nothing was found. `findUniqueMatch`
   turns the empty array into `{ found: false, count: 0 }`, and `count === 0`
   is the branch that prints the sentence above.

So a fault in the **call** is reported as a fault in the **file**, in a sentence
whose remedy — re-read and use the exact text — cannot possibly help, and which
is exactly the advice a model will act on. The loop is stable: read, retry,
fail, read.

## Why it survived

Because every reading of the failure is locally reasonable. The schema says
`find` is required, so "a call without it cannot reach the handler" is a fair
assumption to hold while reading the handler. The matcher's empty-needle guard
is right in isolation. The error sentence is right for the case it was written
for — a genuinely stale find text, which is the common case and the one everyone
has seen.

And it is invisible in aggregate: the tool result says `success: false` with a
sentence about the file, so a scan of failures files it under "model used stale
text", which is where 26 of the other 33 instances in this corpus genuinely
belong. Only reading the recorded `arguments` object shows the absent key.

The Zod schema is not consulted twice, either — nothing logs *that* the parse
failed, so the one signal that would have named this immediately is discarded at
the point where it is generated.

## The fix

`handleStrReplace` checks its arguments before touching the file:

```ts
if (typeof input.find !== 'string' || input.find.length === 0) {
  const what = typeof input.find === 'string' ? 'empty' : 'missing';
  return { success: false, error: `The \`find\` argument was ${what}. doc_str_replace needs \`find\` … This is a problem with the call, not with the file — re-issue it with both arguments.` };
}
if (typeof input.replace !== 'string') { … }
```

`replace` is guarded by `typeof` rather than truthiness, because `''` is a
legitimate deletion; without the guard an omitted `replace` splices the string
`"undefined"` into the document, which is the worse failure of the two and had
never been reported because nothing looked for it.

`handleInsertText` gained the same treatment for `position` (which was read as
`input.position.at` and would throw a `TypeError` on an omitted argument — the
shape of two `Cannot read properties of undefined (reading 'split')` failures
in the same corpus, from 2026-05-18, whose recorded arguments are `{}`) and for
`content`.

The dispatcher's fallback stays. Making it fatal would trade this bug for a
worse one: every lenient pre-schema flow the comment names would start failing,
and a model that got *one* optional field slightly wrong would lose the whole
call rather than the field.

## How to verify

`__tests__/unit/lib/tools/handlers/doc-edit-handler-str-replace-arguments.test.ts`
drives the real dispatcher with the malformed calls as recorded and asserts both
halves: the error names the missing argument, and it does **not** contain the
sentence `Text not found`. A companion case pins that an empty `replace` is
still accepted as a deletion, and one pins that a genuine miss is still reported
as a miss.

By hand, in a Salon chat with a document store attached, ask a character to
issue `doc_str_replace` with `path` and `replace` but no `find`. The reply names
the argument.
