---
url: /salon/:id
---

# Nothing to Add — Turn Skipping

> **[Open this page in Quilltap](/salon)**

In a lively Salon with several characters present, not every voice has something worth saying on every turn. Rather than press each character to manufacture a remark it does not have, Quilltap grants the company leave to hold their peace: a character may **pass** its turn, the Host makes a graceful note of it, and the conversation carries on to the next speaker.

This is a courtesy for a crowd, not a tête-à-tête. It comes into play only in a genuine group scene — a conversation with **more than two characters present**, or with **at least two AI-driven characters**. A quiet one-on-one between you and a single companion is left exactly as it was: there is no one else for the floor to pass to, so no pass is offered.

## How a Pass Works

On any turn but the very first character turn of a fresh conversation, each thinking character is quietly offered the option to pass. Should it genuinely have nothing to add to the moment, it replies with a single agreed phrase and nothing else. The Host then inclines his head — *"so-and-so waves the turn graciously by — nothing to add for the moment, it seems"* — and the floor moves on. No empty bubble is left behind; only the Host's brief note remains in the transcript, marked **nothing to add**.

A pass is never an invitation to be coy or mysterious. A brief in-character remark is always the better contribution; the pass exists only for the genuine case of *nothing to say*.

Occasionally a character says its piece — a gesture, a quiet observation, a real contribution to the moment — and *then* tacks the pass phrase on at the very end, as a sort of afterthought. That is not a pass: there is genuine communication above it, and it is kept and remembered in full. Quilltap simply strikes the stray closing phrase from the message, so what remains in the transcript is the remark the character actually made, with no dangling *"nothing to add"* line trailing beneath it.

### When a character is expected to speak

If a character has been addressed or mentioned by name since it last spoke, its turn note carries a gentle caution to answer rather than pass. Someone spoke to you; the courteous thing is to reply.

### The stall guard

A room where everyone passes would fall silent forever, so a single rule prevents it: when every *other* active character has already passed since the last real remark, the next speaker is **not** offered the option — the floor falls to them, and they must say something. This guarantees the conversation always finds its footing again.

## The Skip Button

When the rotation lands on a character *you* control, the composer shows a small banner with a **Skip** button. Pressing it passes your turn exactly as a character's pass does: the Host notes it, and play advances. Because your passes feed the same stall guard as everyone else's, the Skip button quietly disappears — and a direct request is refused — when every other character has already passed and it truly falls to you to speak. The banner then reads *"Everyone else has passed — it falls to \<name\> to say something."*

## Turning It On or Off

Turn skipping is **on by default**. To change it for a single conversation, open the **Chat Sidebar → Visibility** drawer and toggle **Turn Skipping**. When it is off, no character is ever offered the pass option, and your Skip button behaves as it always did — the stall guard never blocks you.

The setting travels with a conversation: it is preserved in `.qtap` exports and restored on import.

## In Autonomous Rooms

Passes work in autonomous character rooms just as they do in ordinary chats. A pass still consumes one turn from the run's budget — an autonomous room advances by counting turns, and a quiet turn is a turn all the same — and the stall guard keeps a room of reticent characters from looping endlessly.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon/:id")`

## Related Pages

- [Multi-Character Chats](chat-multi-character.md) — How several characters share a scene
- [Turn Manager](chat-turn-manager.md) — Who speaks next, and why
- [Autonomous Rooms](autonomous-rooms.md) — Self-running character rooms
- [Chat Sidebar](chat-participants.md) — The Visibility drawer and its toggles
