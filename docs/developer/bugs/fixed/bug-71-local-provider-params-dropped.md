# Bug 71 — the two local-model providers silently drop every profile parameter, and `OPENAI_COMPATIBLE` can never call a tool

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-15 (benchmarking `Qwen3.8-27B` on an M4 Pro against both `llama-server` and `localhost:11434`, trying to reach `reasoning_effort` and the model's documented sampling settings from a connection profile) |
| **Fixed** | 2026-08-15 |
| **Severity** | **Medium** (no data loss; a persisted setting that silently does nothing, and every local model runs at sampling settings its own publisher says are wrong) |
| **Who it bites** | anyone running `OLLAMA` or `OPENAI_COMPATIBLE` — i.e. every local-model user, which is the deployment Quilltap exists to serve |
| **Provenance** | human, from a live session; the differential harness could not have found it (v5 inherits the same closed body builders) |
| **Fix site** | new `packages/plugin-utils/src/providers/profile-parameters.ts` (`applyProfileParameters`) + `openai-compatible.ts` (allowlist hooks + both tool legs) in **@quilltap/plugin-utils 2.3.0**; new `plugins/dist/qtap-plugin-ollama/profile-options.ts` (1.0.43); `qtap-plugin-openai-compatible/` provider + first options schema (1.0.40); the DeepSeek (1.0.19) and Z.AI (1.1.22) collapses |
| **v5 status** | not yet assessed — v5's declarative provider manifests must carry a per-provider profile-param allowlist or they inherit the same gap; a `packages/` + `plugins/` change here moves the oracle baseline and obliges a drift catch-up (the `request-envelopes` corpus will move) |
| **Index** | [bugs.md](../bugs.md) |

---

## FIXED in v4 (2026-08-15)

All five units landed. `applyProfileParameters` is the one mechanism, exported
from `@quilltap/plugin-utils` 2.3.0 exactly as the plan specified — a free
function, because the inheritance measurement below still holds. Four
deviations from the plan, each forced by something measured rather than
assumed:

**The normalizer takes the body.** `ProfileParamNormalizer` is
`(key, value, params, body) => unknown | undefined`, not the three-argument
form sketched below. Unit 3 requires `reasoning_effort` to land inside
`chat_template_kwargs` rather than under its own key, and a normalizer that can
only return a value for its own key cannot express that. It writes into `body`
and returns `undefined`, which the helper already treats as "omit". The
allow-list is applied in order and `chat_template_kwargs` is listed first, so a
profile that sets both gets a merge rather than a clobber. `null` skips
alongside `undefined` and the empty string — a JSON `null` reaching a local
runtime is an error, and no editor path can produce one.

**Ollama's think levels are real, and the level rides a second key.** Measured
against a live Ollama 0.32.1: `think: "medium"` is accepted and produces
reasoning, and an unrecognised value is refused outright with *"invalid think
value: "bogus" (must be "high", "medium", "low", "max", true, or false)"* — so
the level set is the server's own, not a guess. The plan's suggestion to widen
`enable_thinking` from boolean to enum was **not** taken: the host's enum
renderer reads a stored value only when it is a string
(`ProviderOptionsPanel.tsx`, `EnumField`), so every existing profile holding
`enable_thinking: true` would have displayed as blank while going on thinking.
The level is a separate `thinking_effort` key, shown by the existing `showIf`
mechanism only while thinking is on.

**`keep_alive`'s sentinels go out as numbers.** Also measured live:
`keep_alive: "-1"` is rejected — *"time: missing unit in duration \"-1\""* —
while the number `-1` is honoured. So the enum stores the strings the schema
can express and the normalizer converts anything numeric-looking to a number,
leaving `5m` / `30m` / `1h` as the duration strings Go parses. The default is
empty and empty omits the key entirely, with a test asserting the **absence**;
that is the regression guard for anyone running `OLLAMA_KEEP_ALIVE`.

**Unit 5's first part was already true.** The filing reads
`ProfileModal.tsx:231-232` as clamping `allowToolUse` on every provider change;
it is in fact inside `if (!profile?.id)` and only seeds a *new* profile, and
`useProfileForm.ts:32`'s `supportsToolUse` is consumed by nothing at all — the
checkbox has never been disabled. So there was no clamp to remove. What was
added instead is a comment saying the capability is a seed and never a clamp
(so it is not "corrected" into one later) and a line under the checkbox telling
an OAC user that their endpoint may well support tools even though the provider
declines to vouch for it. Parts 2 and 3 were the real work and are as
described: `tools` / `tool_choice` outbound on both body builds,
`choice.message.tool_calls` parsed non-streaming, and index-keyed accumulation
of `delta.tool_calls` fragments while streaming, with a synthesized
`rawResponse` only when there are calls to report. DeepSeek's `sendMessage`
override was **not** deleted — it carries `reasoning_content` round-tripping,
cache-token accounting and `response_format`, none of which the base does.

**Deliberately not done:** `keep_alive` on the embedding path. `/api/embed`
accepts it on the same terms, but the Ollama embedding provider is handed no
profile parameters at all (`EmbeddingOptions` is ignored on every call), so
reaching it means widening the embedding interface — a larger change than this
bug, recorded in `OLLAMA_CONTROL_PARAMS`' comment so the asymmetry is a
decision rather than an oversight.

**Verification.** `npx tsc`, `npm run lint`, `npm run build:plugins` (which
typechecks each plugin) and the full unit suite are green — 10,538 tests, with
the usual isolated SIGSEGV worker flake that passes on its own. New
`__tests__/unit/plugins/local-provider-params.test.ts` (26 cases) asserts, for
both providers: an allow-listed key lands in the right place, a
non-allow-listed key does not, an empty string omits, and a bag trying to set
`model` / `messages` / `stream` / `tools` cannot retarget the request. The
neutrality gate for Unit 2 could not be run as the plan describes — v4 has no
request corpora, those live on the v5 side — so it is discharged instead by the
existing Z.AI suite (unchanged and green) plus DeepSeek's **first** request-body
coverage, added here, asserting the thinking reshape, the allow-list and the
blank-omits rule survive the collapse. The provider-options snapshot gained its
OAC entry; the Ollama entry gained `thinking_effort`, `keep_alive` and the
Sampling group, and lost nothing.

**Left for a live check:** step 4 below, against `llama-server --jinja`. Nothing
was listening on `:8080` when this landed, so that
`chat_template_kwargs: { reasoning_effort: … }` actually shortens the thinking
block — the *effect*, which is the assertion that matters — is unconfirmed
end-to-end. Ollama's half of step 5 was confirmed against the live server.

---

## Symptom

Three faces of one defect.

**1. A saved parameter that does nothing.** `connection_profiles.parameters` is
free-form JSON (`lib/schemas/profile.types.ts:72`, `parameters: JsonSchema.default({})`)
and the PATCH route accepts any non-array object
(`app/api/v1/connection-profiles/[id]/route.ts:219-223`). Arbitrary keys can be
written, are persisted, and read back as saved. For `OLLAMA` all but three of
them, and for `OPENAI_COMPATIBLE` **all** of them, are dropped on the way to the
wire without a log line. The setting reads as applied and has no effect — the
same silent-no-op class as Bugs 36, 37 and 19.

**2. No local model can be run at its documented settings.** Qwen3.8-27B's
publisher specifies `top_k=20` and `min_p=0.0` in both modes, and
`presence_penalty=1.5` in non-thinking mode. Quilltap can send **none** of the
three to Ollama, because the `options` object is a fixed literal. Every local
chat since the plugin was written has run at whatever those parameters default
to, with no way to correct it from the app.

**3. `reasoning_effort` is unreachable on exactly the providers that need it.**
DeepSeek exposes it (`qtap-plugin-deepseek/provider.ts:46`) and Z.AI exposes it
(`qtap-plugin-z-ai/provider.ts:40`). Qwen3.8 supports it, and on a
bandwidth-bound machine it is the single largest wall-clock control available —
`xhigh` versus `medium` is minutes per turn on a 27B at ~11.5 tok/s. Neither
local provider can send it.

**4. `OPENAI_COMPATIBLE` can never call a tool, by two independent blockers.**
The capability is declared off (`qtap-plugin-openai-compatible/index.ts:61`,
`toolUse: false`) *and* the body builds never add a `tools` key — so even a
profile that somehow got `allowToolUse: true` would still send no tools. Against
`llama-server --jinja`, which supports native tool calls, Prospero silently
degrades to the XML/pseudo-tool modes. See [Unit 5](#unit-5--openai_compatible-can-opt-in-to-native-tool-calling)
for why the capability default is nonetheless **correct** and stays `false`.

This is the direct sibling of [Bug 68](fixed/bug-68-ollama-prefill-kills-thinking.md),
filed the day before against the same model on the same instance, and it wants
the same ruling: **the right answer is a property of the model on the other end,
not of the provider.** Bug 68 made one such property configurable. This one is
about the fact that there is no general route for the rest.

## Root cause

### `OPENAI_COMPATIBLE` never reads the bag at all

`plugins/dist/qtap-plugin-openai-compatible/provider.ts` is a three-line
re-export; the implementation is
`packages/plugin-utils/src/providers/openai-compatible.ts`. Both body builds —
`:302-310` (non-streaming) and `:383-393` (streaming) — are closed literals:

```ts
const response = await client.chat.completions.create({
  model: params.model,
  messages,
  temperature: params.temperature ?? 0.7,
  max_tokens: params.maxTokens ?? 4096,
  top_p: params.topP ?? 1,
  stop: params.stop,
  ...(params.cacheKey ? { user: params.cacheKey } : {}),
}, this.buildRequestOptions(params));
```

`params.profileParameters` is **never referenced anywhere in that file.** The
plugin also declares no `getProviderOptionsSchema`, so its profile editor
renders no provider-specific fields at all — confirmed by the absence of an OAC
entry in
`__tests__/unit/plugins/__snapshots__/provider-options-schema-snapshot.test.ts.snap`.

### `OLLAMA` reads three keys and hardcodes the rest

`plugins/dist/qtap-plugin-ollama/provider.ts:141-163` (and the identical
`:278-299` for streaming):

```ts
const requestBody: any = {
  model: params.model,
  messages,
  stream: false,
  think: enableThinking,
  options: {
    temperature: params.temperature ?? 0.7,
    num_predict: params.maxTokens ?? 4096,
    top_p: params.topP ?? 1,
    stop: params.stop,
    num_ctx: resolveNumCtx(params),
  },
};
```

Exactly three keys are ever read off `profileParameters`: `enable_thinking`
(`:21`), `request_timeout_seconds` (`:44`), `num_ctx` (`:68`). The options
schema (`qtap-plugin-ollama/index.ts:100-131`) declares only the first two.
`keep_alive`, `chat_template_kwargs` and `cache_prompt` do not appear anywhere
in the repository; `top_k`, `min_p` and `repeat_penalty` appear nowhere as
request fields.

### The duplication that guarantees a third copy

The passthrough pattern exists twice, hand-rolled:

- `qtap-plugin-deepseek/provider.ts:40-47` — `DEEPSEEK_PROFILE_PARAM_ALLOWLIST`,
  applied by a private `applyProfileParameters` at `:152-171`
- `qtap-plugin-z-ai/provider.ts:40` — `Z_AI_PROFILE_PARAM_ALLOWLIST`, same shape

**Measure the inheritance graph before designing against it.** Only *one* plugin
in the repo extends the base:

```
qtap-plugin-deepseek/provider.ts:78   export class DeepSeekProvider extends OpenAICompatibleProvider
qtap-plugin-z-ai/provider.ts:68       export class ZAIProvider implements TextProvider
qtap-plugin-openrouter/provider.ts:79 export class OpenRouterProvider implements TextProvider
```

Z.AI and OpenRouter import only *helpers* from `@quilltap/plugin-utils`
(`buildSdkClientOptions`, `createPluginLogger`, `getQuilltapUserAgent`) and
implement the interface directly. So a `protected` method on the base would
reach DeepSeek and nothing else, and Z.AI's copy could not collapse into it
without reparenting the class — a much larger change than this bug warrants.

That drives the shape in [Unit 1](#unit-1--the-allowlist-helper): the mechanism
is an **exported free function**, usable by inheritance *and* composition, not a
protected method.

### Tool calling is blocked twice over

`capabilities.toolUse` is **never read at runtime.** Its only consumers are the
profile editor — `ProfileModal.tsx:231-232`, which sets `allowToolUse` to the
capability whenever the provider changes, and `useProfileForm.ts:32`, which
exposes it as `supportsToolUse` to gate the checkbox. The runtime gate is the
separate first-class column: `streaming.service.ts:213`,
`if (connectionProfile.allowToolUse === false)`, against a schema default of
`true` (`lib/schemas/profile.types.ts:81`).

So for OAC the two blockers are independent, and fixing either alone changes
nothing:

1. the editor forces `allowToolUse` off the moment the provider is selected, and
2. the body builds (`:302-310`, `:383-393`) have no `tools` key, so tools would
   not be sent even if it were on.

Half the wire plumbing does already exist: the message mappers at `:283-287`
and `:364-368` (the streaming twin) know how to serialize assistant **tool-call
history** back onto the request. Both occurrences of `tool_calls` in the file
are outbound. What is missing is the outbound `tools` array and the whole
inbound parse — the response mapping returns `content` / `finishReason` /
`usage` and never reads `choice.message.tool_calls`, and the stream loop never
touches `delta.tool_calls`.

## Why it survived

The OAC provider was written against hosted OpenAI-compatible endpoints, where
the four standard sampling fields are the whole useful surface. Local runtimes
moved past that: `llama-server` accepts `chat_template_kwargs`, `cache_prompt`,
`top_k`, `min_p` and `repeat_penalty` on its `/v1/chat/completions` route, and
Ollama's `options` object has always been much wider than the five keys we fill.

Nothing failed loudly because the free-form `parameters` column accepts every
key without complaint. A user who added `reasoning_effort` by hand got a clean
save, a clean reload, and silence.

## The fix

Five units. Units 1–2 are the mechanism; 3–4 are the two providers that need it;
Unit 5 is the tool-calling gap and is **separable** — it can land in its own
commit, and should, since it carries risk the parameter work does not.

**Units 1 and 5 touch `packages/` — bump the version and STOP for the human to
`npm publish` before anything installs it** (CLAUDE.md hard stop). Units 3–4 are
plugin changes: bump the patch version in `package.json` (and `manifest.json` if
its shape changes) and re-run `npm run build:plugins`, which typechecks each
plugin and is the only thing checking plugin types.

No migration, no DDL change, no `.qtap`/export-schema change: `parameters` is
already free-form JSON and already round-trips. Say so in the commit rather than
leaving a reader to re-derive it.

### Unit 1 — the allowlist helper

**An exported function, not a protected method** — see the inheritance
measurement above. Only DeepSeek extends the base; Z.AI and OpenRouter implement
`TextProvider` directly and must be able to reach the same logic by calling it.

New export from `@quilltap/plugin-utils` (alongside `buildSdkClientOptions` and
the other helpers those two already import):

```ts
export type ProfileParamNormalizer =
  (key: string, value: unknown, params: LLMParams) => unknown | undefined;

/**
 * Copy allow-listed keys from `params.profileParameters` onto a request body.
 * Returning `undefined` from the normalizer omits the key.
 */
export function applyProfileParameters(
  body: Record<string, unknown>,
  params: LLMParams,
  allowlist: readonly string[],
  normalize?: ProfileParamNormalizer,
): void { /* … */ }
```

`OpenAICompatibleProvider` then gains a thin `protected profileParamAllowlist:
readonly string[] = []` plus an overridable `normalizeProfileParam`, and calls
the free function — so DeepSeek inherits it, and Z.AI/OpenRouter can adopt it by
composition whenever someone touches them. Do **not** reparent Z.AI or
OpenRouter as part of this bug.

Rules, all of which the two existing copies already imply:

- **Allowlist, never spread.** `model`, `messages`, `stream`, `stream_options`
  and `tools` must be unreachable from a profile — a misconfigured bag cannot be
  allowed to retarget the request.
- **`undefined` skips.** So does the empty string, which is what the
  schema-driven editor stores for "omit this and use the model default"
  (`qtap-plugin-deepseek/provider.ts` documents the same rule inline).
- **Default is empty**, so every existing subclass is byte-identical on the wire
  until it opts in. That property is what makes this safe to land in a shared
  base, and it should be asserted by a test, not assumed.

Call it in **both** body builds (`:302-310` and `:383-393`). The streaming and
non-streaming shapes have drifted apart before; keep them fed from one place.

Note the OpenAI Node SDK's types will reject non-standard keys such as
`chat_template_kwargs` at compile time. Widen through the body object the
allowlist writes into rather than scattering `as any` at the call sites.

### Unit 2 — collapse the one real subclass, convert the other by composition

**DeepSeek** (the only subclass) declares `profileParamAllowlist`, moves its
`thinking` string→object normalization (`"enabled"` → `{ type: 'enabled' }`)
into `normalizeProfileParam`, and deletes its private `applyProfileParameters`.

**Z.AI** keeps its own class but swaps its private copy for a call to the
exported helper, passing `Z_AI_PROFILE_PARAM_ALLOWLIST` and a normalizer
carrying its model-gated `reasoning_effort` — honoured only on
glm-5.2-and-newer, `undefined` below that. This is a same-file substitution, not
a hierarchy change.

**OpenRouter** is untouched. It has no allowlist today and nothing in this bug
gives it one.

The four provider corpora must come back **byte-identical** after this. That is
the acceptance test for the refactor, and it is worth stating as a gate rather
than a hope: a wire change here is a regression, not an improvement.

### Unit 3 — `OPENAI_COMPATIBLE` gains an allowlist and its first options schema

Allowlist: `top_k`, `min_p`, `repeat_penalty`, `presence_penalty`,
`frequency_penalty`, `seed`, `cache_prompt`, `chat_template_kwargs`.

Schema (`qtap-plugin-openai-compatible/index.ts`, which currently has no
`getProviderOptionsSchema` at all). `ProviderOptionField.type` is limited to
`boolean | enum | multi-enum | string | number`
(`packages/plugin-types/src/plugins/provider-options.ts:16-21`) — there is no
JSON or key/value field type, and **this bug is not the place to invent one.**
So:

| Field | Type | Notes |
|---|---|---|
| `reasoning_effort` | enum — `xhigh` / `high` / `medium` / `low` / `none`, plus empty for the model default | **Not sent as a top-level key.** `normalizeProfileParam` wraps it into `chat_template_kwargs: { reasoning_effort: … }`, which is how `llama-server` reaches a Jinja template's kwargs |
| `top_k` | number | |
| `min_p` | number | |
| `repeat_penalty` | number | |
| `presence_penalty` | number | |
| `seed` | number | |
| `cache_prompt` | boolean | `llama-server` already defaults this on; the field is an escape hatch, and its description should say so rather than implying the user must set it |

The enum-wrapped-into-a-nested-object shape is the load-bearing decision here.
Record it in the plugin as a comment: a future reader will otherwise "simplify"
`reasoning_effort` into a flat body key, where the template will never see it.

### Unit 4 — `OLLAMA` widens `options`

Ollama's shape needs **two** lists, because its parameters live at two levels:

- **Into `options`:** `top_k`, `min_p`, `repeat_penalty`, `presence_penalty`,
  `frequency_penalty`, `seed`, `mirostat`, `mirostat_tau`, `mirostat_eta`
- **Top-level:** `keep_alive`

#### `keep_alive` is a first-class field, not an allowlist entry

Ollama evicts an idle model after five minutes. On a 27B that is a ~20–30
second reload on the next message, and the only remedy today is the
`OLLAMA_KEEP_ALIVE` environment variable — i.e. telling a Quilltap user to go
administer their Ollama server. That is the wrong place for the knob. Residency
is a property of *this profile's* model, and the API already accepts it
per-request.

**Type: `enum`, not `number` or `string`.** Ollama parses a bare number as
*seconds* and a suffixed string via Go's `time.ParseDuration` (`30m`, `1h`),
with negative meaning "never unload" and `0` meaning "unload immediately". A
number field would silently mean seconds and invite `30` for half an hour; a
string field would accept typos the server rejects at request time. An enum
removes the question:

| Label | Sent |
|---|---|
| *(empty — the default)* | key omitted |
| Unload immediately | `0` |
| 5 minutes | `5m` |
| 30 minutes | `30m` |
| 1 hour | `1h` |
| Keep loaded | `-1` |

**⚠ The default must be empty, and empty must omit the key entirely.** A
per-request `keep_alive` **overrides** `OLLAMA_KEEP_ALIVE`, so shipping any
default other than "don't send it" would silently seize residency control from
every user who has already configured their server — a regression dressed as a
feature. This is the same "empty string means use the model default" rule the
DeepSeek allowlist documents inline; here it is load-bearing rather than
cosmetic, and it wants a test that asserts the key's **absence** on an
unconfigured profile.

Because the value rides each request and resets the timer, per-profile control
is strictly better than the environment variable: a 27B chat profile can hold
memory for an hour while a small utility profile unloads immediately. Worth
saying in the help text, since it is not obvious.

**Consider the embedding path too.** `qtap-plugin-ollama/embedding-provider.ts`
calls `/api/embed`, which accepts `keep_alive` on the same terms. Embedding
models are small and called often, so their residency answer differs from the
chat model's. Not required for this bug — but decide it deliberately rather than
leaving the asymmetry to be discovered later.

Both `resolveNumCtx` and the existing three-key reads should route through the
same allowlist rather than staying as bespoke lookups beside it, so there is one
answer to "what can a profile set."

**One open question, to be measured and not assumed:** newer Ollama accepts
`think` as a *level* string for some models rather than a bare boolean. If that
holds for the Qwen3.8 template on the target Ollama version, `enable_thinking`
should widen from boolean to an enum and give Ollama the same reasoning-effort
control as Unit 3 gives OAC. Verify against a live `localhost:11434` before
changing the schema — Bug 68's write-up is the model for how to establish this
kind of claim.

### Unit 5 — `OPENAI_COMPATIBLE` can opt in to native tool calling

**The capability default stays `false`.** `OPENAI_COMPATIBLE` points at an
arbitrary user-supplied endpoint; assuming tool support would break every
endpoint that lacks it, and the failure mode (a 400, or a model that ignores the
array and hallucinates a call) is worse than the pseudo-tool fallback. What is
wrong is not the default — it is that the default is currently a **ceiling**
with no way past it.

Three parts, all required; any one alone changes nothing:

1. **The editor's capability read becomes a default, not a clamp.**
   `ProfileModal.tsx:231-232` currently does
   `form.setField('allowToolUse', providerConfig?.capabilities?.toolUse ?? false)`
   on every provider change. It should seed the field from the capability on a
   *provider switch* and otherwise leave the user's choice alone, with
   `useProfileForm.ts:32`'s `supportsToolUse` demoted from "can this be checked"
   to "is this the recommended setting". A checkbox the user ticks against a
   `false` capability is them asserting something about *their* endpoint, which
   is exactly the knowledge the app does not have.
2. **The outbound `tools` array.** Both body builds add
   `...(params.tools?.length ? { tools: params.tools, tool_choice: 'auto' } : {})`.
   `params.tools` only arrives when the runtime gate at
   `streaming.service.ts:213` has already passed, so no separate guard is
   needed — and an endpoint with tool support but nothing to call still sends
   nothing.
3. **The inbound parse, which is the real work.** Read
   `choice.message.tool_calls` in the non-streaming path, and accumulate
   `delta.tool_calls` across chunks in the streaming one — index-keyed, since
   the arguments arrive as string fragments split across deltas in no
   guaranteed order. Check how `DeepSeekProvider`'s `sendMessage` override
   already does this before writing a second implementation; if it is
   equivalent, that override may be deletable, which would be the second
   duplication this bug retires.

A profile whose endpoint lies about tool support is now a configuration the user
chose, and it should fail legibly. Do not add a silent fallback to pseudo-tools
on a 400 — surface the provider error.

**Deliberately out of scope:** capability *probing* (asking an unknown endpoint
what it supports). It is the right long-term answer and the wrong thing to
smuggle into a bug fix. Raise it as a feature.

## Scope note — what this bug is *not*

**No new field type.** Every parameter above fits the existing five
(`boolean | enum | multi-enum | string | number`). A JSON or key/value editor
would let a user reach anything — including `model` and `messages` — and that is
a separate design conversation with a security dimension.

## How to verify

1. **The wire body, both providers.** `__tests__/unit/plugins/ollama-thinking.test.ts`
   already asserts Ollama's body shape and is the pattern to follow. Add sibling
   assertions: an allow-listed key lands, a non-allow-listed key does **not**, an
   empty string omits the key, and `model`/`messages`/`stream` cannot be
   overridden from a profile bag that tries.
2. **The neutrality gate for Unit 2.** Regenerate the DeepSeek, Z.AI, OpenAI and
   OpenRouter request corpora and diff: byte-identical, or the refactor is wrong.
3. **The snapshot.** `__tests__/unit/plugins/__snapshots__/provider-options-schema-snapshot.test.ts.snap`
   currently has no OAC entry, and that absence is itself an assertion. Run
   `npx jest -u` on it and confirm the new entry is the one intended.
4. **Live, against `llama-server`.** Set `reasoning_effort` to `medium` on an
   OAC profile and confirm through the LLM Inspector that the outgoing body
   carries `chat_template_kwargs: { reasoning_effort: "medium" }` — and, on the
   server side, that the thinking block actually shortens. A kwarg the template
   ignores fails silently, so the *effect* is the assertion, not the presence of
   the key.
5. **Live, against Ollama.** Set `top_k` and `presence_penalty` on an Ollama
   profile; confirm they appear inside `options` in the logged request.
   Separately for `keep_alive`: an unconfigured profile must send **no**
   `keep_alive` key at all (assert the absence — this is the regression guard
   for anyone running `OLLAMA_KEEP_ALIVE`), and a profile set to *Keep loaded*
   must leave the model resident past the five-minute default. `ollama ps` on
   the server is the witness for the second half.
6. **Unit 5's default is unchanged.** A *newly created* OAC profile must still
   come up with `allowToolUse` unchecked — assert it, because the whole point of
   the unit is that the conservative default survives being made overridable.
   Then tick it, point at `llama-server --jinja`, and run a Prospero tool: the
   request carries `tools`, and a returned `tool_calls` is executed rather than
   rendered as text.
7. `npx tsc` (not `npm run build`), `npm run lint`, `npm run build:plugins`.

## Documentation owed

- `docs/CHANGELOG.md` — plain American English, no steampunk voice.
- `help/*.md` — this is a user-visible change (new fields in the profile
  editor). The help file needs its `url` frontmatter with the
  `?tab=`/`&section=` deep link and an "In-Chat Navigation" section whose
  `help_navigate(url: "…")` call matches it.
- Both new schemas belong in whatever help page documents connection profiles;
  `reasoning_effort`'s wrapping into `chat_template_kwargs` is an
  implementation detail and should **not** leak into user-facing text.
