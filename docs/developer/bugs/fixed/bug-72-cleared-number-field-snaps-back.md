# Bug 72 — a cleared provider-option number field snaps back to the schema default and swallows the next keystroke

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-16 (the v5 port's `93ed8abf` dogfood walk, step A4 — a human clearing Ollama's Request Timeout on a real instance; measured in v4's own component the same day) |
| **Fixed** | 2026-08-16 |
| **Severity** | Medium (a wrong value reaches a real server silently — the cleared field re-reads as the default, so nothing on screen says the keystroke was eaten) |
| **Who it bites** | anyone editing a numeric provider option (Ollama's Request Timeout, every Sampling knob, OAC's numeric fields) who clears the box to type a new value |
| **Provenance** | Faithful — v5 ports `NumberField` line for line and reproduces it exactly |
| **Defect site** | `components/settings/connection-profiles/ProviderOptionsPanel.tsx` — `NumberField` (`:274-313`) against `fieldValue` (`:43-47`) |
| **Fix site** | `components/settings/connection-profiles/ProviderOptionsPanel.tsx` — `NumberField` holds a draft string reconciled against `syncedFrom`; `fieldValue` returns `undefined` for number fields so `field.default` renders as `placeholder`; new `toInputString` helper |
| **v5 status** | Owed (Faithful) — v5 reproduces it identically and must absorb the draft in a drift catch-up; retires dogfood finding #87 |
| **Index** | [bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-16)** by taking **both** halves of the filing's first
option, which turned out to be one repair rather than two.

**The draft.** `NumberField` now owns the string it displays: it seeds a
`draft` from the value prop and renders *that*, so emptying the box leaves it
empty. The deeper reason the input cannot be driven off the prop is that a
half-typed number is not a value the bag can hold — a `type="number"` input
reports `''` for `1.` and for `-` alike — so any input re-deriving its display
from what the host stored will fight the person typing, and the cleared-field
case is merely the loudest instance.

The subtlety is telling our own echo from a genuine outside change. A second
piece of state, `syncedFrom`, records the prop value the draft was last
reconciled against, and every write-through sets it to the value the host is
about to hand back. A prop arriving equal to `syncedFrom` is our own round trip
and leaves the draft alone; a prop arriving different is someone else moving
the parameter — a different profile, a schema swap reusing the component — and
re-seeds it. Without that distinction the naive "re-sync when the prop changes"
spelling reintroduces the bug for any field that had a *stored* value before
the clear (500 → clear → prop becomes 300 → re-seed → 300 painted back).

**The placeholder.** The draft alone does *not* close the second consequence,
which is easy to miss: a fresh mount still seeds from `fieldValue`, which folds
in `field.default`, so an untouched Ollama profile still opened with `300`
sitting in the box as a value — indistinguishable from someone having chosen
`300`, and reappearing on every reopen after a deliberate clear. (Measured in
the running app during verification: `value:"300", placeholder:"300"` on first
open.) So `fieldValue` now returns `undefined` for `type: 'number'` and
`NumberField` renders `field.default` as the input's `placeholder`. An unset
numeric option is an empty box with the default behind it in grey, on first
open and on every reopen.

That narrowing is deliberately keyed to the field type rather than applied
across the panel, which is where the filing's second option would have gone:
`EnumField` relies on the fallback being a real value to preselect its default
option, so a blanket change is the whole panel's blast radius for a defect that
lives in one control.

Coverage: five cases in
`__tests__/unit/components/settings/provider-options-panel.test.tsx`, driven
through a `ParameterHost` that reproduces `ProfileModal`'s `setParameter`
(delete-on-`undefined`) — the bug only exists in the round trip between the two.
Checked against the pre-fix component: the repro cases fail there; the
outside-change guard must pass both ways.

**Verified in the running app** (V4test, a fresh Ollama profile): unset opens
`value:"", placeholder:"300"`; typing `300` stores `300`; clearing leaves the
box empty with the key gone from the bag; typing `5` gives `5`, not `3005`; the
saved row holds `request_timeout_seconds: 5`; reopening shows `5` against the
grey `300`; and clearing then saving removes the key from `parameters`
altogether rather than writing the default. The clear itself had to be driven
as a native `input` event — the harness's key action does not deliver
Backspace — so the keystroke-level assertion rests on the jsdom test, where
`user.clear()` dispatches real key events. Everything downstream of the clear,
which is where the defect lived, was observed in the real browser.

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
