# Bug 125 — Google refuses every tool-enabled turn whose slate holds the wardrobe tools (`additionalProperties` under `items`)

| | |
|---|---|
| **Status** | Fixed in v4 (2026-09-06). Filed against the real Google API from the v5 port; the v4 side was confirmed by source reading — `zodToOpenAISchema` puts `additionalProperties: false` on both wardrobe tools' `operations.items`, and the strip list did not name it — and pinned by unit test against the real wardrobe schemas |
| **Found** | 2026-09-06 |
| **Fixed** | 2026-09-06 |
| **Severity** | **High if confirmed** (a Google-seated character cannot take a single tool-enabled turn while `wardrobe_wear`/`wardrobe_take_off` are in its slate — the whole request is a 400 before any token streams; the help slate always carries them, and any Salon character with a wardrobe does too) |
| **Who it bites** | every GOOGLE connection profile with `allowToolUse` whose character has wardrobe tools in the slate |
| **Provenance** | Live on the v5 port: a Gemini 2.5 Flash profile seated in a help chat died in 192 ms with Google's `400 Invalid JSON payload received. Unknown name "additionalProperties" at 'tools[0].function_declarations[19].parameters.properties[0].value.items': Cannot find field.` (and `[21]`). Declarations 19 and 21 of the help slate are `wardrobe_wear` and `wardrobe_take_off`. v4's shape is read from source: the declarations are built from the same tool JSON through the same sanitizer. |
| **Defect site** | `plugins/dist/qtap-plugin-google/provider.ts:63` `sanitizeSchemaForGoogle` strips only `UNSUPPORTED_SCHEMA_FIELDS` (`:33`), which does not include `additionalProperties`; `:511`/`:670` forward `properties` + `required` (so the top-level `additionalProperties: false` is dropped by construction, but the one nested under `operations.items` survives). The nested key comes from the tools' Zod schemas — `operations: z.array(z.object(…))` (`lib/tools/wardrobe-wear-tool.ts:68`, `lib/tools/wardrobe-take-off-tool.ts:63`) — which the JSON-schema conversion emits with `additionalProperties: false` on the item object. |
| **Fix site** | `plugins/dist/qtap-plugin-google/provider.ts` — `additionalProperties` heads `UNSUPPORTED_SCHEMA_FIELDS`; the list and `sanitizeSchemaForGoogle` are now exported so the pin can hold them against the schemas we send (**qtap-plugin-google 1.1.51**) |
| **v5 status** | **Reproduces faithfully** — v5's `sanitize_schema_for_google` mirrors the list entry for entry and the tool JSON is byte-copied. v4 is now fixed; v5 adds the same entry at the next drift catch-up, which also unblocks the live proof of Google keeping id-less tool rows. The google-wire corpus still needs a nested-object row on both sides. Dogfood finding #114 |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-09-06).** `additionalProperties` is now the first entry
in `UNSUPPORTED_SCHEMA_FIELDS`, so the existing recursion strips it at every
depth — the top level (already dropped by construction), an array's `items`,
and any nested object under `properties`. Nothing is lost: Google's own tooling
discards the key, and the runtime Zod validation on the tool side still
rejects unknown keys. The list and `sanitizeSchemaForGoogle` are exported, and
`__tests__/unit/plugins/google-schema-sanitizer.test.ts` feeds the **real**
`wardrobe_wear` and `wardrobe_take_off` parameters (derived from their Zod
schemas through `zodToOpenAISchema`, so the pin cannot drift from what ships)
through the sanitizer and asserts no `additionalProperties` survives anywhere
while the item schema's `properties` are intact; a second case holds every
listed field at depth. Loading the plugin's provider under jest needed a
manual mock for the ESM-only `@google/genai` SDK (`__mocks__/@google/genai.ts`,
mapped in `jest.config.ts` beside the older `@google/generative-ai` one). Plugin
version 1.1.51 in `package.json` and `manifest.json`, rebuilt.

---

### Symptom

Seat a Google profile (any Gemini model) in a help chat, or in a Salon chat
whose character has a wardrobe, and send one line. The stream errors
immediately with Google's `INVALID_ARGUMENT` above, naming
`function_declarations[N].parameters.properties[0].value.items`. No tokens, no
row.

### Root cause

Google's function-declaration schema is an OpenAPI subset that does not accept
`additionalProperties` inside an array's `items`. `sanitizeSchemaForGoogle`
walks every declaration recursively and removes the fields in
`UNSUPPORTED_SCHEMA_FIELDS` — `propertyNames`, `additionalItems`, `contains`,
`patternProperties`, `dependencies`, `if`/`then`/`else`, `allOf`/`anyOf`/`oneOf`,
`not`, `$schema`, `$id`, `$ref`, `$comment`, `definitions`, `$defs`,
`examples`, `default`, `const`, `contentMediaType`, `contentEncoding` — and
`additionalProperties` is not among them. Most tools never trip it because
their only `additionalProperties: false` sits at the top level of `parameters`,
which the declaration builder never forwards (it copies `properties` and
`required` only). The two wardrobe tools take an `operations` array of objects,
and the converted item schema carries its own `additionalProperties: false`,
which the recursion keeps and Google refuses.

### Why it survived

Google is the least-used seat on the live instance, and the failure needs the
wardrobe tools in the slate. The plugin's unit tests do not cover a nested
object schema, and nothing in the v5 port's google-wire corpus carries one
either — so both sides' differentials pass while both fail live.

### The fix

Add `'additionalProperties'` to `UNSUPPORTED_SCHEMA_FIELDS` (the recursion
already reaches nested schemas), or strip it in the item branch specifically.
Google's own tooling drops the key; nothing is lost by removing it.

### Verification

Live: the gesture in Symptom, before and after. Unit: feed
`sanitizeSchemaForGoogle` the `wardrobe_wear` parameters and assert no
`additionalProperties` key survives anywhere in the result; then one real
Gemini call with the help slate.
