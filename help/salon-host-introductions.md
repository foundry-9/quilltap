---
url: /salon/:id
---

# The Host's Introductions

> **[Open this page in Quilltap](/salon)**

In any properly run Salon, conversation has a way of straying — names crop up that nobody present has actually met, and the company can feel suddenly outnumbered by absent acquaintances. The Host, ever observant, takes it upon herself to keep the proceedings honest.

When a character belonging to your workspace is mentioned in a chat — but is not, at the moment, a participant — the Host steps forward and introduces them, once. Their card joins the conversation as a public message, visible to you and to every character in the room.

## What Triggers an Introduction

The Host watches the conversation for the names (and aliases) of any character that already exists in your workspace but has not been added to this particular Salon. The first time a name surfaces — whether from your own remarks, another character's reply, or even the conversation summary the Librarian keeps — the Host posts an introduction.

The introduction is published as a regular Salon message authored by the Host. It carries the absent character's:

- **Name and aliases**
- **Pronouns**
- **Description** — exactly as it appears on their character sheet

The phrasing makes the Host's intent plain: *for accurate reference only; not a summons to the scene.* The character has not joined the chat. They are simply being identified, so that anyone speaking of them does so with their proper particulars in hand.

## Why Once, and Only Once

In earlier days, Quilltap re-injected absent-character cards into every single response, every turn — silently, behind the scenes. That meant the same character description was sent to the model dozens or hundreds of times in a long conversation, eating tokens for breakfast and confusing the model's prompt cache.

Now, the introduction lives in the chat history once. From that moment on, every character — and you — can refer back to it just as you would any other message. The Host does not repeat herself.

If the same workspace character is named twice, three times, fifty times across a long conversation, the Host introduces them precisely once. Subsequent mentions cost nothing.

## What This Looks Like in the Salon

The introduction appears in the conversation feed with the Host's avatar (the same one used for participant arrivals, departures, and scene-setting). It uses the Host's voice:

> *The Host begs leave to introduce a person spoken of in this conversation but not presently in the Salon — for accurate reference only; not a summons to the scene.*
>
> ### Mochi
> Pronouns: he/him/his
> A medium-sized domestic cat with a sturdy, stocky build…

When several absent characters are mentioned together for the first time in the same turn, the Host introduces them all in a single combined announcement, sorted alphabetically.

## What This Doesn't Do

- **It doesn't add the character to the chat.** The character remains absent from the participant list. To bring them into the scene, open the **Chat Sidebar** on the right, expand the **Participants** drawer, and use **Add Character** at the bottom.
- **It doesn't fire for the user-controlled character.** Your own persona is excluded.
- **It doesn't re-introduce known characters.** A character introduced earlier in the chat — even thousands of messages ago — is not reintroduced when their name comes up again.
- **It doesn't broadcast across chats.** The introduction is per-Salon. The same character may be introduced in another conversation if their name surfaces there too.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon/:id")`
