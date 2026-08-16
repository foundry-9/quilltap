# Bug 72 — a cleared provider-option number field snaps back to the schema default and swallows the next keystroke

| | |
|---|---|
| **Status** | **Open** |
| **Found** | 2026-08-16 (the v5 port's `93ed8abf` dogfood walk, step A4 — a human clearing Ollama's Request Timeout on a real instance; measured in v4's own component the same day) |
| **Severity** | Medium (a wrong value reaches a real server silently — the cleared field re-reads as the default, so nothing on screen says the keystroke was eaten) |
| **Who it bites** | anyone editing a numeric provider option (Ollama's Request Timeout, every Sampling knob, OAC's numeric fields) who clears the box to type a new value |
| **Provenance** | Faithful — v5 ports `NumberField` line for line and reproduces it exactly |
| **Defect site** | `components/settings/connection-profiles/ProviderOptionsPanel.tsx` — `NumberField` (`:274-313`) against `fieldValue` (`:43-47`) |
| **v5 status** | Reproduces identically; v5 stays faithful and will absorb the fix in a drift catch-up (dogfood finding #87) |
| **Index** | [bugs.md](../bugs.md) |

---

## Symptom

Open a connection profile on a provider with a numeric option — Ollama's
**Request Timeout (seconds)**, whose schema default is `300`. Select the
contents and delete them, intending to type a new value.

The box does not go empty. `300` reappears the instant the field is cleared,
with the caret **after** it. Typing `5` next produces `3005`, and `3005` is
what gets stored and sent.

The workaround a user has to discover: move to the start of the field, type
the new value *in front of* the default, then delete the default behind it.

## Measured, in v4's own component

v4's real `ProviderOptionsPanel` rendered in jsdom with v4's own
`setParameter` host (`ProfileModal.tsx:205-216`) around it, driven with
`user.clear()` then `user.type('5')`:

```
initial          DOM="300" bag={}
after clear      DOM="300" bag={}
after typing "5" DOM="3005" bag={"request_timeout_seconds":3005}
```

## Root cause

Three faithful behaviours that combine into a trap:

1. `NumberField.onChange` (`:300-303`) maps an empty input to
   `onChange(undefined)` — the documented way to say "unset".
2. `setParameter` (`ProfileModal.tsx:208-210`) treats `undefined` as
   **delete the key**, so the bag really does lose it.
3. `fieldValue` (`:43-47`) then falls back to `field.default`, so the
   controlled input's value prop is `"300"` again — and React's
   controlled-input restore writes it straight back into the DOM.

Clearing the field is therefore self-cancelling: the act of unsetting the key
is exactly what makes the default paint back over it.

There is a second, quieter consequence. Because absent and explicitly-default
render identically, the UI cannot show the difference — and the field's own
help text ends *"Leave blank for the default,"* which is the one state the
user can never see themselves having reached.

## Why it survived

`ProviderOptionsPanel` has no test coverage for the empty-input path, and the
snap-back is invisible to anyone who *types over* a selection instead of
clearing first (the common gesture, and the one every manual check used).
The panel only reached real hands with bug 71's schemas, three days ago.

## The fix

Two candidates; the first is smaller and keeps `fieldValue` untouched:

- **Let the field hold its own string while focused.** `NumberField` keeps a
  `useState` draft seeded from the prop, renders the draft, and writes through
  on change; on blur, an empty draft stays empty (the key stays deleted) and
  the placeholder — not the value — shows the default. This also fixes the
  invisible absent-vs-default distinction, via
  `placeholder={String(field.default)}`.
- **Or render the default only as a placeholder** everywhere: `fieldValue`
  returns the stored value alone, and each field type shows `field.default`
  as placeholder text. Larger blast radius (`EnumField` relies on the
  fallback to preselect), so the first is preferred.

Either way the caret behaviour is the real acceptance test, not the stored
value.

## Verification

- A `ProviderOptionsPanel` test asserting the three-step sequence above:
  after `user.clear()` the DOM value is `""` and the key is absent from the
  bag; after typing `5` the DOM reads `"5"` and the bag holds `5` — **not**
  `3005`.
- A guard that a field left blank round-trips as absent (not as the default
  written explicitly), so a later change to the plugin's default still
  reaches profiles that never set one.
