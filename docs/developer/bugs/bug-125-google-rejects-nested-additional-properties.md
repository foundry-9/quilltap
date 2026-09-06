# Bug 125 — Google refuses every tool-enabled turn whose slate holds the wardrobe tools (`additionalProperties` under `items`)

| | |
|---|---|
| **Status** | **Open — UNCONFIRMED on live v4.** Found on the v5 port's dogfood copy of Friday (2026-09-06) against the real Google API; the v4 side is established by reading the shipped code — both apps send the same declarations. One live gesture confirms or refutes it (see Verification). |
| **Found** | 2026-09-06 |
| **Fixed** | — |
| **Severity** | **High if confirmed** (a Google-seated character cannot take a single tool-enabled turn while `wardrobe_wear`/`wardrobe_take_off` are in its slate — the whole request is a 400 before any token streams; the help slate always carries them, and any Salon character with a wardrobe does too) |
| **Who it bites** | every GOOGLE connection profile with `allowToolUse` whose character has wardrobe tools in the slate |
| **Provenance** | Live on the v5 port: a Gemini 2.5 Flash profile seated in a help chat died in 192 ms with Google's `400 Invalid JSON payload received. Unknown name "additionalProperties" at 'tools[0].function_declarations[19].parameters.properties[0].value.items': Cannot find field.` (and `[21]`). Declarations 19 and 21 of the help slate are `wardrobe_wear` and `wardrobe_take_off`. v4's shape is read from source: the declarations are built from the same tool JSON through the same sanitizer. |
| **Defect site** | `plugins/dist/qtap-plugin-google/provider.ts:63` `sanitizeSchemaForGoogle` strips only `UNSUPPORTED_SCHEMA_FIELDS` (`:33`), which does not include `additionalProperties`; `:511`/`:670` forward `properties` + `required` (so the top-level `additionalProperties: false` is dropped by construction, but the one nested under `operations.items` survives). The nested key comes from the tools' Zod schemas — `operations: z.array(z.object(…))` (`lib/tools/wardrobe-wear-tool.ts:68`, `lib/tools/wardrobe-take-off-tool.ts:63`) — which the JSON-schema conversion emits with `additionalProperties: false` on the item object. |
| **v5 status** | **Reproduces faithfully** — v5's `sanitize_schema_for_google` mirrors the list entry for entry and the tool JSON is byte-copied. Blocks the v5 live proof of Google keeping id-less tool rows. v5 absorbs the fix at the next drift catch-up; the google-wire corpus needs a row with the shape (it has none — a blind spot on both sides). Dogfood finding #114. |
| **Index** | [bugs.md](../bugs.md) |

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
