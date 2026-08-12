---
url: /settings?tab=chat&section=answer-confirmation
---

# Answer Confirmation — A Quiet Word With the Fact-Checker

Now and then a character reaches for something outside their own head: a rifle through the memory drawers, a peek back through the conversation, a consultation with the documents in the Scriptorium, a turn about the wider world by way of a search. Having gathered all that, they compose a reply. Answer Confirmation appoints a second, unhurried reader to glance over that reply *before it lands* and ask a single plain question: does what was written actually square with what was looked up?

## When the fact-checker stirs

Only when there is genuinely something to check. If a character has consulted their recollections (the Commonplace Book's whisper) or performed an in-scope lookup this turn — a web **search**, a **read of the conversation**, or a **document read** from the Scriptorium — the reader is roused. A reply spun from pure invention and personality, resting on no lookup at all, is left in peace; there is nothing to hold it against, so no fact-checker is summoned, and no marks are made.

The check is deliberately narrow. A character is perfectly entitled to add colour, mood, and opinion the references never mentioned — that is the whole art of the thing, and it is never counted against them. Only a genuine contradiction of the record, or a misstatement of what a lookup plainly returned, draws a frown.

## What happens when something rings false

- **All is consistent.** The reply is kept as written and wears a modest *Vouched* mark.
- **Something conflicts.** The character's *own* engine — the very same one that wrote the reply — is shown the discrepancies and given a choice. It may **stand by** its words (the reply is kept unchanged, marked *Stood by*, the objections noted), or it may **set them right** (the corrected reply is shown in place, marked *Amended*, with the original tucked away in the record for posterity).
- **The reader was indisposed** — unreachable, or too slow — or the turn was authored by a human hand (impersonation, where facts may have arrived by some private road we cannot vouch for). The reply is kept as written and marked *Unvetted*: neither blessed nor faulted, simply unconfirmed.

You will see the first reply arrive live, as always. Should the re-affirmation amend it, you will watch the first answer give way to the corrected one — this visible changing of the guard is a feature, not a flicker. The status bar keeps you company throughout: **Confirming…** while the reader reads, and **Requesting affirmation of questionable results…** while the character reconsiders.

Every checked reply carries a small badge — *Vouched*, *Amended*, *Stood by*, or *Unvetted* — and hovering over it reveals precisely what looked amiss (and, for an amended reply, what was originally written). It is metadata, not an alarm: kept quiet by design.

## Switching it on, at three levels

The whole apparatus arrives **switched off**, for it adds a round-trip or two to every qualifying turn. Turn it on wherever suits you; the more particular setting always carries the day.

- **Globally** — Settings → Chat → *Answer Confirmation*. The default for every new chat.
- **By project** — a project's *Model Behavior* card (in Prospero) offers *Inherit*, *Enabled*, or *Disabled*. Set a project to Enabled and its chats confirm automatically.
- **By chat** — the **Visibility** panel in the Salon sidebar offers an *Answer Confirmation* control: *Inherit* (defer to the project, then the global default), *On*, or *Off*. A chat's own choice overrules its project and the global default alike.

## The fine print

The consistency check is handled by your configured cheap engine (the same modest workhorse that tends to summaries and memories), so it costs little. The re-affirmation, being a matter of the character standing by their own words, always uses that character's own configured model. The reconsideration runs **at most once** — an amended reply is not sent back round again — so the whole business is bounded to a spare call or two and never loops. Answer Confirmation attends the Salon only; it does not trouble help chats, the Brahma Console, or Carina's inline asides, and it lets silent turns pass unremarked.

## In-Chat Navigation

```
help_navigate(url: "/settings?tab=chat&section=answer-confirmation")
```
