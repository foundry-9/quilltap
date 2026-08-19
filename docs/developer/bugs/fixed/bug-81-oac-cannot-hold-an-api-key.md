# Bug 81 — an OpenAI-Compatible profile can never hold an API key

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-19 (v5 dogfood walk: trying to point an `OPENAI_COMPATIBLE` profile at a hosted OpenAI-compatible endpoint, to exercise the OAC tool path against something other than a local server) |
| **Fixed** | 2026-08-19 |
| **Severity** | Medium (a whole class of providers is unreachable; no data loss, nothing silently wrong — it simply cannot be configured) |
| **Who it bites** | anyone pointing Quilltap at a hosted OpenAI-compatible service that needs a bearer token — Together, Fireworks, Groq, DeepInfra, OpenRouter-alikes, a self-hosted vLLM/llama.cpp behind auth, or any corporate gateway. Local unauthenticated servers (llama.cpp, LM Studio, Ollama's OpenAI shim) are unaffected and work today |
| **Provenance** | Faithful-by-omission: the OAC plugin has declared `requiresApiKey: false` since it was written, and every key-related surface reads that one boolean as if it answered two different questions |
| **Fix site** | `packages/plugin-types` (`ProviderConfigRequirements.acceptsApiKey`, 2.5.7); `lib/llm/api-key-support.ts` (the pure predicate both sides read); `lib/plugins/provider-validation.ts` (`acceptsApiKey(provider)`); `lib/services/api-key.service.ts` (`resolveConnectionProfileApiKey`, now used by the chat, Brahma and help-chat paths); `ApiKeyModal.tsx`, `ProfileModal.tsx`, `useProfileForm.ts`; the OAC plugin's `config` and `manifest.json` |
| **Defect site** | `plugins/dist/qtap-plugin-openai-compatible/index.ts:45` — `requiresApiKey: false`; `components/settings/api-keys/ApiKeyModal.tsx:68` — the Add-New-API-Key provider list is `providers.filter((p) => p.configRequirements?.requiresApiKey)`, so **OpenAI-Compatible is not offered and no such key can be created**; `components/settings/connection-profiles/ProfileModal.tsx:467` — the profile form renders the API Key selector only `if (reqs.requiresApiKey)`, and labels it `API Key *`, so even a key that existed would have nowhere to be attached |
| **v5 status** | **Owed** — v5 reproduced this exactly (same dropdown contents, same absent field) and now owes the flag split, both UI gates, and the server-side key forwarding |
| **Index** | [bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-19).** The flag was split as prescribed, and one thing
the write-up below did not see was fixed with it.

`ProviderConfigRequirements` gained an optional `acceptsApiKey`
(`@quilltap/plugin-types` 2.5.7). Omitted, it means "the same answer as
`requiresApiKey`", so every plugin that predates it is unchanged; the OAC plugin
declares `requiresApiKey: false, acceptsApiKey: true` in both its `config` and
its `manifest.json`, and Ollama declares neither and stays keyless. Both flags
are read through one pure module, `lib/llm/api-key-support.ts`
(`providerRequiresApiKey` / `providerAcceptsApiKey`), which the settings UI asks
of a `/api/v1/providers` payload and the server asks of the plugin registry via
`acceptsApiKey(provider)` in `lib/plugins/provider-validation.ts`. The Zod
manifest schema and the generated JSON Schema carry the field so an external
plugin can declare it too.

On the two UI gates: `ApiKeyModal` filters the Add-New-API-Key list on
`providerAcceptsApiKey`, so **OpenAI-Compatible** is offered; `ProfileModal`
renders the key selector on the same question, labels it `API Key` without the
star when `requiresApiKey` is false, and titles the empty option *"None — the
endpoint needs no key"*. `useProfileForm`'s `outboundApiKeyId` — the Bug 76
guard that refuses to send a key the select cannot display — now judges
"keyless" by `acceptsApiKey` as well, which is what lets an optional key reach
the wire at all.

**What the write-up missed: the key was being dropped server-side too.** Four
call sites gated the *lookup* on `requiresApiKey` —
`lib/services/chat-message/orchestrator.service.ts`,
`lib/services/brahma-console/{one-shot,orchestrator}.service.ts` and
`lib/services/help-chat/orchestrator.service.ts` — so even with both UI gates
open, an OAC profile's key stayed in the database and the request still went
out bare. All four now go through one resolver,
`resolveConnectionProfileApiKey` in `lib/services/api-key.service.ts`, which
asks both questions: it refuses when a *requiring* provider names no key,
forwards the key wherever a provider *accepts* one, and — deliberately — fails
loudly on a dangling `apiKeyId` even where the key is optional, because a key
the user attached on purpose must not silently become an unauthenticated
request. (`carina.service.ts` already read the column without asking the
provider anything, and needed no change; `auto-associate.ts` keeps
`requiresApiKey`, since auto-attaching a key to a local llama.cpp profile would
be wrong.)

Regression cover: `__tests__/unit/components/settings/profile-modal-optional-api-key.test.tsx`
drives the real modal over the real hook (field present and unstarred, key sent
on Connect, save succeeds with no key, still hidden on Ollama, and no OAC key
carried onto Ollama); `__tests__/unit/lib/services/api-key-service.test.ts`
covers the resolver's six cases; `api-key-modal.test.tsx` gained the
accepts-but-does-not-require case.

---

## Symptom

Create a connection profile with provider **OpenAI-Compatible**, give it the
base URL of a hosted service that requires a bearer token, and there is no way
to supply the token:

- the profile form shows **no API Key field at all** for that provider;
- Settings → API Keys → **Add New API Key** offers Anthropic, DeepSeek, Google
  Gemini, Grok (xAI), OpenAI, OpenRouter and Z.AI — **no OpenAI-Compatible
  entry**, so a key of that provider cannot be created in the first place.

The request then goes out unauthenticated and the endpoint answers 401.

## Root cause

One boolean, `configRequirements.requiresApiKey`, is being asked two different
questions:

1. *Must* this provider have a key before the profile is valid?
2. *May* this provider have a key at all?

For OpenAI-Compatible the honest answers are **no** and **yes** — it is the one
provider that legitimately spans authenticated and unauthenticated endpoints.
With a single flag, `false` is the only workable value (a `true` would break
every local llama.cpp/LM Studio user by demanding a key they do not have), and
`false` then silently removes the provider from both key surfaces.

Nothing below the UI has this problem. The data model already carries
`apiKeyId` on every connection profile regardless of provider, and both write
paths already validate the pairing —
`app/api/v1/connection-profiles/route.ts:230` and
`app/api/v1/connection-profiles/[id]/route.ts:227` return
`API key provider does not match profile provider`. So the plumbing for an
OAC key exists end to end; only the two UI gates that decide whether such a key
may be *created* and *shown* are missing.

## Why it survived

Every OAC profile anyone has actually built has pointed at localhost. The
keyless path works perfectly, so the gap only appears the moment someone aims
the provider at a hosted endpoint — which is exactly what a v5 dogfood walk
tried to do, and what the tester confirmed had never been tested
("I'm not sure I've ever tested the OpenAI-compatibility with an API key").

## The fix

Split the one flag into the two questions it is really answering. Concretely:

1. Add a second capability alongside `requiresApiKey` — `acceptsApiKey` (or
   `supportsApiKey`) — defaulting to the value of `requiresApiKey` so every
   existing plugin keeps its present behavior with no edit.
2. Set the OAC plugin to `requiresApiKey: false, acceptsApiKey: true`
   (`plugins/dist/qtap-plugin-openai-compatible/index.ts:45`). Ollama stays
   `false`/`false` — its endpoints are unauthenticated by definition.
3. `ApiKeyModal.tsx:68` filters on **`acceptsApiKey`**, so OpenAI-Compatible
   appears in the Add-New-API-Key provider list.
4. `ProfileModal.tsx:467` renders the API Key selector when
   **`acceptsApiKey`**, and drops the `*` from the label (and any required-field
   validation) when `requiresApiKey` is false — i.e. **the key becomes optional
   for OAC**: supply one for a hosted endpoint, leave it blank for a local one.

The server-side provider-match validation needs no change; it already does the
right thing once an `OPENAI_COMPATIBLE` key can exist.

⚠ The `requiresApiKey` flag is also read by
`lib/plugins/provider-validation.ts:108` (`requiresApiKey(provider)`, which
defaults to `true` "for safety") and by the Almanack's provider phase
(`lib/tools/almanack/phase2-machinery.ts:128,161`). Neither should change
meaning — they are asking question 1, which keeps its current answer. Only the
two UI gates move to question 2.

## Verification

- With no key attached, an OAC profile pointed at a local llama.cpp still works
  exactly as before (the regression that matters).
- An OpenAI-Compatible key can be created in Settings → API Keys.
- Attaching it to an OAC profile saves, and the outbound request carries
  `Authorization: Bearer …`.
- Detaching it saves too — the field is optional, not merely present.

## v5 coordination

v5 is faithful today and should stay that way until v4 moves; the v5 port then
absorbs the flag split and both UI gates in a drift catch-up. Recorded on the
v5 side in `docs/developer/porting/dogfood-walks/2026-08-19-owed-pass.md` (D6c).
