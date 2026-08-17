# Bug 77 — the Salon's tool-execution notice pins itself above the composer and can never be dismissed

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-17 (user report: "Successfully generated 1 image!" still sitting above the composer long after the turn ended) |
| **Fixed** | 2026-08-17 |
| **Severity** | Low (cosmetic, but permanent — the notice occupies composer space for the rest of the session and no affordance removes it) |
| **Who it bites** | anyone who generates an image in the Salon by any route other than a plain single-turn send: a tool chain, continue mode, an aborted or errored turn |
| **Provenance** | Pinned — reported from a live Salon session |
| **Defect site** | `app/salon/[id]/hooks/useSSEStreaming.ts` — the only teardown for `toolExecutionStatus` was a bare `setTimeout(..., 3000)` inside `sendMessage`'s terminal `onDone`; `triggerContinueMode`'s `onDone`, the intermediate-done chain leg, and every error path left the banner set. `ChatComposer.tsx` rendered it with no close control |
| **Fix site** | `useSSEStreaming.ts` — `publishToolExecutionStatus` (self-expiring on a settled status, timer held in a ref and cleared on unmount), `dismissToolExecutionStatus`, and `clearPendingToolExecutionStatus` for turn boundaries; `ChatComposer.tsx` — a dismiss button plus `role="status"` / `aria-live="polite"` |
| **v5 status** | Not yet assessed — any v5 surface that pins a tool notice from a stream event needs the auto-expiry to live with the notice, not with one caller's completion path |
| **Index** | [bugs.md](../bugs.md) |

---

**FIXED in v4 (2026-08-17).**

## Symptom

Ask a character for an image in the Salon. `Generating image...` appears above
the composer, then flips to `Successfully generated 1 image!` — and stays. It
survives the rest of the turn, the next turn, and every turn after; nothing in
the UI removes it, and the banner keeps eating a row of composer real estate for
as long as the chat stays open.

## Root cause

`toolExecutionStatus` was raised in `trackToolsDetected` / `trackToolResult`
(both shared by every streaming path) but torn down in exactly one place: a
fire-and-forget `setTimeout(() => setToolExecutionStatus(null), 3000)` at the
bottom of `sendMessage`'s terminal `onDone`. Any turn that reached its end by a
different route never ran it —

- `triggerContinueMode`'s `onDone` (continue mode, multi-character advance),
- the `onIntermediateDone` leg of a tool chain, where the image tool fires on an
  intermediate turn and the final `onDone` belongs to a later participant,
- the `catch`/error arms on both paths.

The banner also had no close control, so a stuck notice had no manual escape.
The lifetime of the notice was owned by one of its consumers rather than by the
notice itself.

## Why it survived

The one path that *did* clear it is the common one — a single-character chat,
one send, one image, done — so the happy case looked correct. And because the
clear was a detached `setTimeout` rather than state the component could observe,
nothing in the render tree revealed that other paths had skipped it.

## The fix

Ownership moves to the status itself, in `useSSEStreaming.ts`:

- **`publishToolExecutionStatus(status)`** is the single door for raising the
  notice. A `pending` status stays up; a settled (`success` / `error`) one
  schedules its own dismissal after `TOOL_STATUS_DISMISS_MS` (6 s), with the
  timer held in a ref, superseded on each new publish, and cleared on unmount so
  no state is set after teardown.
- **`clearPendingToolExecutionStatus()`** runs at each turn boundary and drops
  only a still-`pending` notice whose result never arrived — a settled one is
  left to its own countdown rather than being cut short. Both `onDone` paths
  call it; the old `setTimeout` is gone.
- **`dismissToolExecutionStatus()`** is exported and wired through `SalonView`
  into `ChatComposer`, which now renders a close button on the alert and marks
  it `role="status"` / `aria-live="polite"`. `stopStreaming` calls it directly.

## How to verify

In the Salon, ask for an image mid-chain (a turn that also calls another tool,
or a multi-character continue). The notice appears, settles to
`Successfully generated 1 image!`, and clears itself within ~6 seconds. Click
the ✕ before then and it goes immediately. Abort a turn while
`Generating image...` is up (Stop) and the notice clears at once.
