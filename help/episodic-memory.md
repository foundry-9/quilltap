---
url: /settings?tab=memory
---

# The Book Remembers When and Where

> **[Open this page in Quilltap](/settings?tab=memory)**

For the longest time, the Commonplace Book kept splendid notes on *what* happened and rather shabby ones on *when* and *where*. Ask a character "remember that place we visited last week?" and the poor thing was left rifling through undated pages — it might draw a blank, or worse, invent an answer with perfect confidence. No longer. The Book has taken up the habits of a proper diarist: every memory now carries the date the thing *happened* (not merely the date it was written down), the places and persons involved, and — for stories that keep their own calendar — the in-story hour as well.

## What Changed on the Shelves

- **Every memory is dated by the event.** A recollection formed today about last month's outing is filed under last month, where it belongs. When a character's memories are whispered into a conversation, each arrives with its age on its sleeve — *[3 days ago]*, *[last week]* — so the character can actually confirm "yes, last Tuesday" instead of guessing.
- **Outings become episodes.** A real excursion spans many turns of conversation, and used to survive only as scattered one-line fragments. Now, as the Librarian folds a chapter of your chat into the running summary, the Book composes a proper episode entry — a short, dated narrative of what happened, where, and with whom — and ties the fragments to it with ribbon. The running summary itself gains a dated **Timeline** of events, kept in every character's vault.
- **Two visits are two memories.** Previously, visiting the same harbor in spring and again in winter could collapse into a single confused entry. The Book now checks the dates before merging: same activity, different occasion — both are kept.
- **Old memories are not punished for being old — when you ask about old times.** Ordinarily the Book favors the fresh and the current. But the moment a conversation turns retrospective ("remember when…?"), it reverses course: memories of the past are *promoted*, the referenced time period is searched directly, and the usual courtesy of not repeating itself is suspended — because when you re-ask, you want the same memory found, not politely withheld.
- **"Today" and "yesterday" are now understood without consultation.** There was an awkward interval in which a character could recall an outing of a fortnight past and yet draw a perfect blank on the expedition of that very afternoon — the phrase *"the mission today"* being read, by the Book's junior clerk, as idle present-tense chatter. The common turns of the calendar — *today, this morning, last night, yesterday, the day before yesterday, three days ago, last week* — are now resolved by the Book itself, on your own clock rather than Greenwich's, without asking the clerk's opinion at all. Say "how did it go this morning?" and the morning is what gets searched.
- **The very recent is kept warm.** Quite apart from any phrasing, a memory of something that happened within the last day or two is now given a lift in the running order, so that the events of yesterday afternoon are not quietly outranked by a settled truth from a fortnight ago. (Recollections drawn from the conversation you are presently *in* are exempted — they are already before you on the table, and need no announcement.)
- **A dated reading list, on demand.** On such retrospective turns the Book also produces a small extra whisper: the past conversations that cover the period in question, each with its date and a conversation ID the character can open with the `read_conversation` tool to reread the original scene.
- **Honest tools, honest answers.** Characters' `search` tool now accepts a time period (`since`/`until`) and a subject (`aboutCharacter`), returns each memory's event date and source conversation, and `read_conversation` can fetch just a slice of a long transcript. And the standing instruction is now written plainly into every character's orders: if the search turns up nothing, say you don't recall — never invent the particulars.

## Stories on Their Own Calendar

If your chat is a work of fiction that runs on its own clock — the third night at sea, the eve of the coronation — the Book can keep *that* calendar too. A chat may be set to **narrative** timeline mode (the default is **realtime**), in which case in-story time phrases are preserved alongside the wall-clock date and shown with each memory.

The switch lives in the Salon: open the chat sidebar, unfold the **Chat** card, and find **The Story's Clock**. *Real time* files memories by the calendar on the wall; *Story time* lets the narrative's own reckoning govern. Flip it whenever you please — the setting is per chat, takes effect on the next turn, and memories already on the shelves keep whatever dates they were filed under.

## For the Mechanically Inclined

The `quilltap recall-replay <chatId>` command (with the dev server running) replays any turn's memory recall and prints the full ranking table — old behavior and new, side by side — so you can see precisely why a given memory surfaced or sank. See the [CLI reference](cli-memories.md) for its sibling tools.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=memory")`

## Related Settings

- [Recall Relevance](memory-recall-relevance.md) — how the Book decides which memories may surface where
- [Memory Housekeeping](memory-housekeeping.md) — pruning the shelves (episodes now enjoy a measure of protection)
- [Conversation Summaries](conversation-summary-regenerate.md) — the folded summaries whose Timeline the episodes ride in
