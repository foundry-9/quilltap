# Bug 110 — a configured `lora_preset` is discarded whenever no adapter sits beside it

| | |
|---|---|
| **Status** | FIXED in v4 (2026-08-30) |
| **Found** | 2026-08-30 |
| **Fixed** | 2026-08-30 |
| **Severity** | Medium (nothing errors and nothing is harmed: the generation **succeeds**, is charged for, and returns a stock image with none of the requested style — the only evidence of the loss is the picture itself) |
| **Who it bites** | Anyone on a NanoGPT image profile in the fal-hosted `flux-lora` family who sets a LoRA Preset without also filling the adapter editor |
| **Provenance** | Friday, live, 2026-08-30, while diagnosing three consecutive NanoGPT image failures. Profile `1588ec71-df8d-4d5c-b718-1ab4853f8075` ("Persephone Latex Dress"), generation `e28c9245-f7f8-452c-979d-4268bc69be6e` at 05:27:08.985Z — succeeded, and applied nothing |
| **Defect site** | `plugins/dist/qtap-plugin-nanogpt/image-loras.ts` — `applyLoras`'s `if (!loras \|\| loras.length === 0)` early return, which sits **above** the branch that attaches `lora_preset` |
| **Fix site** | `plugins/dist/qtap-plugin-nanogpt/image-loras.ts` — `applyLoras` restructured so a known family applies its scoped keys independently of the adapter list |
| **v5 status** | Not investigated. **The shape applies** to any port that groups a standalone option with the list it merely travels beside — the guard must ask about the option, not about its neighbour |
| **Index** | [../bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-30).** `applyLoras` now resolves the family first and
applies each scoped key on its own terms: `lora_preset` whenever the family is
known, `hf_api_token` only alongside the weights it authorises. The early
return is gone; an unknown family still writes nothing, which was never the
defect.

## Symptom

A user chasing a Persephone style through NanoGPT set up a `flux-lora` profile
and typed the adapter's HuggingFace id into the **LoRA Preset** box:

```json
{"size":"1024x768","lora_preset":"Muapi/persephone-latex-dress-flux"}
```

Note there is no `loras` array. The generation ran and **succeeded** —

```
IMAGE_GENERATION  flux-lora  7717ms
response: {"content":"Generated 1 image(s)","error":null}
[Image Profiles v1] Image generation complete  imageCount: 1
```

— and the posted body carried no LoRA key of any kind. The request was a plain
`flux-lora` generation: `model`, `prompt`, `n`, `response_format`, `size`, and
nothing else. The user reasonably read the returned image as the feature
working.

## Root cause

Two individually correct decisions, and no third one covering the seam between
them.

1. **`applyLoras` treats an empty adapter list as "nothing to do at all."**

   ```ts
   if (!loras || loras.length === 0) {
     return { keys: [], dropped: [], dialect: null };
   }
   ```

   True of adapters. Not true of `lora_preset`, whose attachment lives further
   down, inside the `url`-dialect `else` branch that this return skips.

2. **`lora_preset` is deliberately excluded from the general passthrough
   list.** It sits in `NANOGPT_LORA_SCOPED_KEYS` rather than
   `NANOGPT_PASSTHROUGH_KEYS`, with a comment explaining why: it means
   something only to the fal-hosted family, so it must not be broadcast to
   whatever model a profile happens to point at. Correct — and it means
   `applyPassthroughParameters` will not carry it either.

So the only code path that can put `lora_preset` on the wire is the one behind
the adapter guard, and a preset configured alone reaches neither.

The conflation is the actual mistake. A **preset** is a named style the host
already hosts; it is valid on its own. A **credential** (`hf_api_token`)
authorises the fetch of caller-supplied weights; with no weights it has no
errand. They look alike in the options panel — two loose strings beside the
adapter editor — and the code applied one rule to both.

## Why it survived

- **The failure mode is a success.** No error, no warning, no `dropped` entry;
  the job completes and the image is charged for. Nothing in the logs
  distinguishes this from a working generation.
- **The test suite asserted the buggy case as correct.** `nanogpt-image-loras.test.ts`
  already had *"writes nothing for an empty or absent list"* — but it passes
  `undefined` for `profileParameters`, so the preset was never in the frame.
  The assertion is still true and still passes; it simply never asked the
  question that mattered.
- **The panel invites it.** The LoRA Preset field's help text reads *"applied
  alongside whatever adapter you list below"* — which describes the intended
  arrangement, not a requirement, and is easy to read as the place a LoRA goes.

## The fix

`applyLoras` resolves `matchLoraFamily(model)` first. An unknown family returns
early exactly as before, writing nothing and naming any dropped sources — that
refusal was right and is untouched. A **known** family then applies:

- adapters, when there are any, in its own dialect;
- `lora_preset`, whenever the family is `url`, adapter or no adapter;
- `hf_api_token`, only inside the `weights` branch's `kept.length > 0`, with
  the asymmetry spelled out in a comment so the next reader does not
  "consistency"-fix it back.

`AppliedLoras.dialect` now reports a known family's spelling even when no keys
were written, because *"nothing was configured"* and *"nothing could be
spelled"* are different diagnoses and the log should not blur them.

A blank preset (`''`) stays off the wire — an empty string is how the options
panel spells "unset", the same convention `applyPassthroughParameters` follows.

## How to verify

Five cases in `__tests__/unit/plugins/nanogpt-image-loras.test.ts`, under
*"applyLoras — scoped keys without an adapter (bug 110)"*: a preset alone is
forwarded (with `dialect: 'url'`), a preset with an absent list is forwarded, a
token alone is withheld, an unknown family still writes nothing, and a blank
preset is skipped.

Live, the tell is **duration**. The same profile and prompt, run once with the
adapter dropped and once with it applied:

| run | adapter on the wire | duration |
|---|---|---|
| `e28c9245` 05:27:08 | none (this bug) | 7,717 ms |
| `47a2487d` 05:32:30 | `lora_url` + `lora_strength` | 13,338 ms |

Fetching and merging the adapter costs about three-quarters again as long.
That gap is the only externally visible difference between an applied LoRA and
a silently dropped one, and it is worth knowing when a bug report says an
adapter "did nothing."
