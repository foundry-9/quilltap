# Bug 73 — a base URL survives a provider change while its field is hidden, and permanently breaks the profile it lands on

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-16 (the v5 port's `93ed8abf` dogfood walk, step A5 — a human cycling the provider dropdown on a new profile; measured in v4's own modal the same day) |
| **Fixed** | 2026-08-16 |
| **Severity** | **High** (a profile that cannot connect, with no visible cause and no visible cure — the offending value is not rendered on the provider it breaks) |
| **Who it bites** | anyone who touches `OLLAMA` or `OPENAI_COMPATIBLE` in the provider dropdown and then selects a hosted provider — including anyone merely *browsing* the list to see what is available |
| **Provenance** | Faithful — v5's modal is site-for-site equivalent and reproduces it |
| **Defect site** | `components/settings/connection-profiles/ProfileModal.tsx` `handleProviderChange` (`:219-243`) + the `showBaseUrl = reqs.requiresBaseUrl` render gate (`:437`) + `useProfileForm.ts`'s `handleConnect` (`:191`), `handleFetchModels` (`:226`), `handleTestMessage` (`:260`) and `buildRequestBody` (`:158-160`) |
| **Fix site** | new `outboundBaseUrl` chokepoint in `useProfileForm.ts` honoured by all four outbound sites, plus the two remaining provider-judging reads in `ProfileModal.tsx` |
| **v5 status** | Owed (Faithful) — v5 reproduces it identically and must absorb the chokepoint in a drift catch-up; retires dogfood finding #88 |
| **Index** | [bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-16)** by the filing's second option — *don't send what
you don't show* — which subsumes the first and needs no rule about whose URL is
whose. One new chokepoint in `useProfileForm.ts`:

```ts
const outboundBaseUrl = useCallback((): string => {
  const known = providers.find((p) => p.name === form.formData.provider)
  if (known && !known.configRequirements?.requiresBaseUrl) return ''
  return form.formData.baseUrl || ''
}, [...])
```

All four outbound sites read it instead of `form.formData.baseUrl`:
`handleConnect`, `handleFetchModels` and `handleTestMessage` send
`outboundBaseUrl() || undefined`, so a hidden field cannot reach a probe.

It asks `providers` directly rather than going through
`getProviderRequirements`, which defaults an *unknown* provider to
`requiresBaseUrl: false`. That default is right for deciding what to render —
a provider nobody can describe gets no field — but wrong for deciding what to
erase: the list not having loaded, or its fetch having failed, would otherwise
read as "this provider takes no base URL" and the next save would clear a
working local profile. Absence is not evidence, so an unknown provider keeps
what is stored.

`buildRequestBody` goes one step further and drops the `if (baseUrl)` guard
entirely — `requestBody.baseUrl` is now **always** present, carrying `''` when
the provider takes none. Omitting the key would have left the row untouched
(`PUT` gates on `baseUrl !== undefined`, `:208-210`), so every profile already
written broken would have stayed broken; an empty string maps to `NULL` on both
the create (`route.ts:278`) and the update path, which makes the next ordinary
save the cure for a row poisoned before this fix. That is the only reason the
save leg is not simply symmetric with the other three.

Two further reads judged the provider by a base URL it may not own, and were
gated the same way rather than left as a second seam: the edit-time model
fetch in `ProfileModal`'s auto-fetch effect (a *stored* row can still carry a
stale URL until its first save), and the `supportsMimeType` /
`getAttachmentSupportDescription` pair, which decide vision and attachment
support partly from the endpoint.

`handleProviderChange` is deliberately untouched. The value stays in form
state, so switching back to a provider that renders the field restores what was
there — the stale URL is now merely inert rather than destructive, and no rule
is needed about whether a typed URL outranks an auto-filled one. That also
answers the filing's open question: nothing is cleared on the way out, because
nothing needs to be.

Coverage: new
`__tests__/unit/components/settings/profile-modal-base-url.test.tsx` — the real
`ProfileModal` over the real `useProfileForm`, driven through the actual
dropdown gesture with `fetchJson` captured. Six cases: the fill-then-hide
gesture, the connect body (the filing's measurement, inverted), the save body,
a guard that a provider which *does* take a base URL still sends it, a guard
that an unloaded provider list does not clear a stored URL, and the
`OPENAI_COMPATIBLE → OLLAMA → OPENAI_COMPATIBLE` typed-endpoint guard. Checked
against the pre-fix modal: the two body assertions fail there.

**Verified in the running app** (V4test, a real OpenAI key): the filing's
measurement, run forwards. Selecting Ollama fills `http://localhost:11434` and
shows the field; selecting OpenAI hides it; **Connect** then answers
*"Successfully connected to OPENAI"* where the filing measured *"Failed to
validate connection to OpenAI"*. Saving the profile writes `baseUrl` as SQL
`NULL` on the row, confirmed by `quilltap db` — and an Ollama profile saved in
the same session keeps its `http://localhost:11434`, so the gate discriminates
rather than blanket-clearing.

---

## Symptom

In the profile modal, set the provider to **Ollama** (or OpenAI-compatible)
— the Base URL box appears and fills with `http://localhost:11434`. Now set
the provider to **OpenAI**. The Base URL box disappears, because OpenAI does
not require one.

The value does not. From that moment the profile cannot connect: **Connect**
answers `Failed to validate connection to OpenAI` with a valid key selected,
Fetch Models fails, and saving writes the ollama URL onto the OpenAI profile
row. Nothing on screen shows the base URL, so nothing on screen explains it,
and there is no gesture that clears it without switching back to a provider
that renders the field.

The reporting user's words: *"Dropping to Ollama or OpenAI-compatible destroys
the ability to connect from then on."*

## Measured, in v4's own modal

v4's real `ProfileModal` with the real `useProfileForm` hook, rendered in
jsdom, `fetchJson` captured, driven through the actual gesture:

```
after -> OLLAMA  baseUrl="http://localhost:11434"
after -> OPENAI  baseUrl="http://localhost:11434"
base URL input rendered? false
connect body = {"provider":"OPENAI","apiKeyId":"key-openai","baseUrl":"http://localhost:11434"}
```

Confirmed end-to-end against a running server: `OPENAI` + a valid key +
`baseUrl: "http://localhost:11434"` returns exactly
`Failed to validate connection to OpenAI`, while the same key with no base
URL returns `valid: true`.

## Root cause

Three independently reasonable decisions with no owner of the seam between
them:

1. **`handleProviderChange` never clears `baseUrl`.** It only *fills* one,
   and only when the box is empty (`:224` — `&& !form.formData.baseUrl`).
   The guard exists to protect a user's typed URL, and it equally protects a
   URL that now belongs to a different provider.
2. **The field is gated on `requiresBaseUrl`** (`:437`), so on OpenAI the
   stale value is not merely stale — it is unreachable.
3. **Every outbound call sends `baseUrl` unconditionally**, gated on
   truthiness rather than on whether the provider takes one:
   `handleConnect` (`:191`), `handleFetchModels` (`:226`),
   `handleTestMessage` (`:260`), and the save body (`:158-160`).

`OPENAI`'s validator then uses the raw override rather than falling back to
the manifest (`provider-validation.ts` — `baseUrl ? baseUrl.replace(/\/$/,'')
+ '/v1/moderations' : 'https://api.openai.com/v1/moderations'`), so the probe
is POSTed at the ollama port and cannot succeed.

The damage outlives the dialog: the save body carries the same value, so the
row is written broken and reopening the modal reloads it.

## Why it survived

A provider switch that lands somewhere *needing* a base URL shows the wrong
value immediately, and the user corrects it — so the bug only bites on the
transition **into** a provider that hides the field, which is the direction
nobody re-checks. It also requires visiting a local provider first, which is
a minority path on hosted setups but the **first** thing a user does when
surveying the dropdown.

## The fix

Make one of the three legs provider-aware; the first is the smallest and the
most honest about intent:

- **Clear it on the way out.** In `handleProviderChange`, when the new
  provider does not require a base URL *and* the current value equals the
  previous provider's `baseUrlDefault`, clear it. This drops the auto-filled
  case — the one that bites — without touching a URL the user typed.
- **Better, and it subsumes the above: don't send what you don't show.**
  Gate the four outbound sites on `getProviderRequirements(provider)
  .requiresBaseUrl` rather than on truthiness, so a hidden field can never
  reach the wire or the row. Keep the stored value in form state so switching
  back restores it — the value is then merely inert, not destructive.

Worth deciding alongside: whether a user-typed base URL should survive a
provider change at all. Clearing unconditionally is defensible and much
easier to explain, at the cost of a retype for someone toggling between two
local endpoints.

## Verification

- A `ProfileModal` test driving `OLLAMA → OPENAI` and asserting the connect
  body carries **no** `baseUrl` (the probe above, inverted).
- The same for the save body: an OpenAI profile created after visiting Ollama
  stores `baseUrl` empty.
- A guard that switching `OPENAI_COMPATIBLE → OLLAMA → OPENAI_COMPATIBLE`
  does not silently swap a typed endpoint for ollama's default.
