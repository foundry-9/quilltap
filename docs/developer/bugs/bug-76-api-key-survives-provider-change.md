# Bug 76 — an api key survives a provider change, and the form sends a key the user cannot see and did not choose

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-08-17 (the v5 port's `d123658d` dogfood walk, step A2 — a human cycling Ollama → Anthropic → Ollama on one profile; measured in v4's own modal the same day) |
| **Severity** | Medium (loud, not silent — the save is refused rather than written wrong — but the refusal names a field the dialog does not show, and on a keyless provider there is no visible way to clear it; the probe buttons meanwhile send a key the select says is not selected) |
| **Who it bites** | anyone repointing a profile at a different provider. Sharpest toward `OLLAMA` / `OPENAI_COMPATIBLE`, where the API Key select is not rendered at all; also every hosted → hosted switch, where the select reads blank while Connect / Fetch Models / Test Message keep sending the previous provider's key |
| **Provenance** | Faithful — v5 reproduces all three layers, the rejection sentence included |
| **Defect site** | `components/settings/connection-profiles/ProfileModal.tsx` `handleProviderChange` (`:236-268`) — sets `provider`, fills `baseUrl`, re-seeds three new-profile flags, never touches `apiKeyId`; the `showApiKey = reqs.requiresApiKey` render gate (`:461`) and the `key.provider === form.formData.provider` option filter (`:481`); `hooks/useProfileForm.ts` `buildRequestBody` (`:172-176`) plus `handleConnect` (`:213`), `handleFetchModels` (`:248`) and `handleTestMessage` (`:282`), all four sending on truthiness. Rejected server-side by `app/api/v1/connection-profiles/[id]/route.ts` (`:215-227`) and `app/api/v1/connection-profiles/route.ts` (`:222-230`) |
| **Fix site** | proposed: an `outboundApiKeyId` chokepoint in `useProfileForm.ts`, the exact twin of `d123658d`'s `outboundBaseUrl` |
| **v5 status** | Faithful, unfixed by design — v5 reproduces it and stays faithful; absorbs the chokepoint in a drift catch-up. Retires v5 dogfood finding #90 |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

Open a connection profile on **Anthropic** with its API key selected. Change
the provider to **Ollama**. The API Key select disappears — Ollama needs no
key. Fill in the rest and save:

```
API key provider does not match profile provider
```

The field the message is about is not on screen, and on Ollama there is no
gesture that clears it. The profile cannot be saved until you work out that
you must switch to a provider that *renders* the select, choose the blank
"Select an API Key" option, and switch back.

The hosted → hosted case is quieter and arguably worse. Switch Anthropic →
OpenAI: the select re-renders **blank**, because its options are filtered to
the new provider and the stored id is not among them. But the id is still in
form state, so pressing **Connect** (or Fetch Models, or Test Message) sends
the Anthropic key to an OpenAI probe. The dialog says no key is selected while
the wire carries one.

## Measured, in v4's own modal

v4's real `ProfileModal` over the real `useProfileForm`, rendered in jsdom and
driven through the actual dropdown gesture with `fetchJson` captured — the
same harness as Bug 73's `profile-modal-base-url.test.tsx`:

```
ANTHROPIC -> OLLAMA
  API Key select rendered?  false
  save body                 {"provider":"OLLAMA","apiKeyId":"key-anthropic"}

ANTHROPIC -> OPENAI
  API Key select shows      ""            <- blank to the user
  connect body              {"provider":"OPENAI","apiKeyId":"key-anthropic"}
```

## Root cause

The same three-legged shape as Bug 73, one field over — and Bug 73's fix went
past this one without touching it:

1. **`handleProviderChange` never clears `apiKeyId`.** It sets `provider`,
   fills `baseUrl` when empty, and re-seeds `allowToolUse` /
   `supportsImageUpload` / `multiCharacterPrefill` for new profiles. The key
   is not in the list, and nothing else clears it — the only writer is the
   select's own `onChange` (`:476`).
2. **The select cannot express what is stored.** It is gated on
   `requiresApiKey` (`:461`), so a keyless provider does not render it at all;
   and its options are filtered to `key.provider === form.formData.provider`
   (`:481`), so on a *different* hosted provider the stored id matches no
   option and the control shows blank. Either way the value is unreachable —
   in the first case invisible, in the second actively misrepresented.
3. **All four outbound sites send it on truthiness**, not on whether the
   provider takes a key: `buildRequestBody` (`:172-176`), `handleConnect`
   (`:213`), `handleFetchModels` (`:248`), `handleTestMessage` (`:282`).

The server then does its job correctly: both the create (`route.ts:229`) and
the update (`[id]/route.ts:226`) refuse a key whose `provider` disagrees with
the profile's. The refusal is right; the request should never have been built.

## Why it survived

Bug 73's report and fix were both framed as a *base URL* problem — an
auto-filled default following the profile — so the chokepoint that came out of
it was named for that field and applied to that field. The api key reaches the
wire through the same four call sites and fails the same way, but it never
came up in the same sentence: the base URL breaks the probe *silently* (a
misdirected endpoint), while the key breaks the *save* loudly, and the two
symptoms don't look related from the outside.

The hosted → hosted half also hides behind an ordinary habit: most users
re-pick the key after changing provider, because the select is sitting there
looking empty, which repairs the state before anything is sent.

## The fix

The twin of `outboundBaseUrl`, and for the same reason — don't send what you
don't show:

```ts
const outboundApiKeyId = useCallback((): string => {
  const known = providers.find((p) => p.name === form.formData.provider)
  if (known && !known.configRequirements?.requiresApiKey) return ''
  return form.formData.apiKeyId || ''
}, [providers, form.formData.provider, form.formData.apiKeyId])
```

with the same two refinements Bug 73 arrived at:

- **An unknown provider keeps its stored id.** A provider list that has not
  loaded is not evidence that a provider takes no key.
- **The save body always sends the field**, `null` when the provider takes
  none, so a row already written with a mismatched key heals on its next
  ordinary save rather than staying broken. (The `PUT` gates on
  `apiKeyId !== undefined` and maps `null` to a cleared column, `:215-218`.)

The hosted → hosted half needs one more decision, which the base-URL fix did
not have to make: a key that is *filtered out of the select* is not the same
as a key the provider cannot use. `outboundApiKeyId` as written still sends an
Anthropic key on OpenAI, because OpenAI does require a key. The honest rule is
that the form should send only an id the select could currently display —
i.e. also drop it when it is absent from the filtered option list — which
makes the blank select and the wire agree. Worth doing in the same change;
it is the half a user actually notices.

`handleProviderChange` should stay untouched either way, exactly as Bug 73
left it: the value remains in form state, so switching back restores it, and
no rule is needed about whether a chosen key outranks a remembered one.

## Verification

- The two measurements above, inverted: after `ANTHROPIC → OLLAMA` the save
  body carries no `apiKeyId`; after `ANTHROPIC → OPENAI` the connect body
  carries none while the select is blank.
- A guard that a provider which *does* take a key still sends the one the user
  picked for it.
- A guard that an unloaded provider list does not clear a stored id.
- A round-trip: an existing profile saved with a mismatched key (written
  before this fix, or by import) clears the column on its next save rather
  than being refused forever.

## v5 coordination

v5 reproduces every layer — `handleProviderChange`'s twin, the hidden select,
the four outbound sites, and the server refusal with the identical sentence
(`crates/quilltap-core/src/api/settings.rs:1319`, `:1610`). It stays faithful
on purpose and will absorb this fix in a drift catch-up, the way it absorbed
Bug 73's chokepoint in `P4.D86`. The two sides must move together.
