---
url: /settings?tab=chat&section=taboo
---

# Taboo — Phrases Not Uttered in This House

> **[Open this setting in Quilltap](/settings?tab=chat&section=taboo)**

Every age has its verbal tics: the turn of phrase that arrives sounding clever, is repeated by everyone within the month, and by the third month has all the freshness of a boiled handkerchief. Language models, having read rather a lot of the age, are especially prone to them. One morning your dour sea-captain, your Edwardian governess, and your dyspeptic house-elf all independently observe that a thing is "not nothing," and the illusion goes out like a gaslamp in a draught.

**Taboo** is the house register of such phrases. Enter one and no character will say it again.

## What the prohibition actually covers

Rather more than the literal string, which is the whole point. Every character receives the list as part of their standing instructions, with orders to avoid each entry:

- **word for word**, obviously;
- in every **inflection** of it — the tense changed, the number changed, the participle swapped in;
- in every **rewording and near-variant** that reaches for the same tired formula. Ban "weight-bearing" and "load-bearing" goes with it.

They are further instructed, when one of the forbidden phrases would have been the easy thing to reach for, to **say what they actually mean instead** — plainly, and in particular words. A prohibition on its own merely leaves a vacancy, and a vacancy tends to be filled by the banned phrase's nearest cousin.

Finally, characters are forbidden to **mention, quote, or allude to the list itself**. Without that clause you shortly acquire a household of wits making arch remarks about the things they have been told not to say, which is worse than the original complaint.

## Adding and removing phrases

1. Open **Settings → Chat Settings → Taboo**
2. Type a phrase into the box and press **Enter**, or use **Add**
3. To lift a prohibition, click the small **×** beside the phrase

One phrase at a time, please. Commas are perfectly welcome *inside* a phrase, so they cannot also serve as separators between them.

**The particulars:** up to 500 phrases, each up to 200 characters. Surrounding whitespace is trimmed, and a phrase already on the list is quietly discarded rather than duplicated — capitalisation notwithstanding, since the prohibition never cared about capitalisation in the first place. Your ordering is preserved exactly as you arranged it; nothing is sorted behind your back.

## Where it applies

The register is **instance-wide** — one list for the whole establishment. There is deliberately no per-character or per-chat exception: a phrase that grates in one room grates in all of them.

It governs your characters' **conversational replies**: the ordinary turn in the Salon, a regenerated or swiped alternative, and the turns characters take among themselves in autonomous rooms. It does not currently reach short Staff announcements, inline lookups addressed to a character with `@Name:`, or the help chat — none of which are quite the same act of speech, and all of which are candidates for a later hand.

An empty list adds **nothing whatever** to any prompt. If you never touch this page, your characters' instructions are precisely as they were.

## A word on cost and caution

The list is small and it never changes mid-conversation, so it sits inside the portion of a character's instructions that providers keep warm between turns — meaning it is paid for approximately once rather than on every message. Editing the list does retire that warm copy, so make your revisions in a sitting rather than one phrase per hour if you are watching the meter closely.

Do keep the register short and specific. It is presented to characters as a list of exhausted clichés beneath their dignity, which is a far better defence against parroting than a neutral mention would be — but a hundred entries is still a hundred phrases you have read aloud to every character before they open their mouth. Strike the ones that genuinely offend, not every phrase you have ever tired of.

The list travels with your instance: it is included in exports and full backups, and restores with them.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this setting:

`help_navigate(url: "/settings?tab=chat&section=taboo")`

## Related Settings

- [Chat Settings](chat-settings.md) — The rest of the chat-wide defaults
- [Text Replacement](chat-settings.md) — Corrections applied to *your* typing, not your characters' speech
- [Roleplay Templates](roleplay-templates.md) — Per-chat instructions on style and formatting
