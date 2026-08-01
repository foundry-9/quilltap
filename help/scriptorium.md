---
url: /settings?tab=chat
---

# The Scriptorium

Imagine, if you will, a tireless scribe seated in the corner of every conversation you have — the sort of fellow who never spills the ink, never loses his place, and never once complains about the hours. The Scriptorium is precisely that: a system that renders your conversations into persistent, deterministic Markdown documents, complete with numbered messages, grouped interchanges, and the capacity for your characters to scribble annotations in the margins like so many well-read academics arguing over a first edition.

## How It Works

After each turn in a conversation, the Scriptorium automatically renders the entire exchange into a clean Markdown document. This is not a rough sketch on a cocktail napkin — it is a precise, reproducible rendering where every message receives a sequential number and every back-and-forth is gathered into tidy interchanges. Each rendered conversation is crowned with a metadata header — a brief dossier listing the conversation's title, creation date, participants, and vital statistics — ensuring that even the most casual reader can determine precisely what they are looking at before committing to the full text.

### Message Numbering

Messages are numbered sequentially starting from 0, because even scribes must bow to the conventions of computer science. Each message in the conversation receives exactly one number, assigned in the order it was spoken (or typed, or dramatically declaimed, depending on your style).

### Interchanges

Messages are grouped into **interchanges** — logical clusters that represent a turn of conversation. When you say something and a character responds, that exchange forms an interchange. In multi-character chats, an interchange encompasses the full chain of responses that follows a single prompt. Think of it as a scene in a play: the curtain rises, the dialogue unfolds, the curtain falls, and the Scriptorium dutifully records the whole affair before the next act begins.

### Searchable Chunks

Each interchange is embedded as a searchable chunk through the existing embedding pipeline. This means that the substance of your conversations becomes discoverable — one can search not merely for keywords but for the semantic meaning of what was discussed, like a librarian who actually read every book in the collection rather than just filing them by spine color.

### Editing Beside the Conversation

When Document Mode is open in the Salon, the Scriptorium also serves as your in-chat writing desk. For Markdown manuscripts you may work in rich text or flip over to raw source, and the formatting controls remain close at hand for either style of composition. If a Markdown file begins with YAML frontmatter, rich mode presents that metadata as a read-only Document Info table (with list-like values shown as separate chips), while source mode continues to show the raw `---` block for direct editing. Files that are not Markdown — JSON configurations, YAML recipes, plain text correspondence, and so forth — open in a monospaced textarea with no rich-text scaffolding whatsoever, which spares them the indignity of being quietly reformatted by a Markdown serializer. The split view remembers its layout for each chat, and the divider may be adjusted with the mouse or the keyboard — a small courtesy, perhaps, but a civilized one.

**Lists and their offspring.** A list item may be tucked beneath the one above it — a sub-list, in the vernacular — by pressing **Tab**, and lifted back out again with **Shift+Tab**. The formatting bar offers the same service in button form (**⇥** to nest, **⇤** to lift), and both attend to list items only: Markdown has no notion of an indented paragraph, so the editor declines to pretend otherwise and leaves your prose where you put it. Elsewhere in the editor Tab behaves as it always has, carrying your focus onward, so nobody is trapped at the keyboard. Whatever indentation your document already favours — two spaces, four, or an honest tab — is the indentation it is saved with, so a single edit no longer reflows every nested line in the file.

Should you wish to rechristen a document, click the title at the top of the editor pane, type the new name, and press Enter — the file itself is renamed in place, whether it lives on disk or inside a database-backed vault. Path separators and parent-directory escapes are politely refused, and if you omit the extension the previous one is tacked back on for you (so "backstory" becomes "backstory.md" if that is what the file was in the first place). A pending autosave is flushed before the rename, so no keystrokes are lost in the exchange. The Librarian then posts a brief note in the chat announcing the new name and path, so any characters present are apprised without your having to interrupt the scene.

Should a volume have outlived its usefulness, the header also offers a small trash-can button beside Close. A single click, a polite request for confirmation, and the underlying file is removed — whether it resides on disk or in a database-backed vault — the document pane is closed, and the Librarian announces the deletion in the chat so present characters know the volume is gone from the shelves. The action is irreversible; do reserve it for files you truly mean to dismiss.

Nor must a conversation always be in attendance: the left rail offers a **Document Mode** button of its own, which opens the same dialog and the same editor with no chat attached — and, having no audience, makes no announcements. The particulars are set out in [The Tabbed Workspace](tabbed-workspace.md).

### The Open Document picker

When you summon a document in the Salon — by the toolbar's Open-Document button, or by **⌘⇧D / Ctrl+Shift+D** when no manuscript is yet at hand — a picker presents itself in two columns. Down the left run the dependable standbys: **New blank document**, the **Project library** (when the chat belongs to a project), and the **General library**, and beneath them a **Recent** accordion. That recent list leads with the volumes you have lately had open in this very chat and then, rather than forgetting everything the instant you wander off, continues with those you opened in other chats — so a manuscript you were lately tending is never more than a glance away. It holds the ten most recent in all.

Down the right, the document stores at your disposal are sorted onto three shelves, each an accordion you may expand or fold away as suits you: **Character Vaults**, the private libraries of the characters presently in the chat; **Database-backed document stores**, those kept tidily inside Quilltap itself; and **Filesystem-backed document stores**, those that live as folders on disk. The instance-wide **Quilltap General** store always appears here (among the database-backed shelves), so its `Scenarios/` and other curated contents are never more than a click away — the left-column "General library" button, by contrast, opens the older catch-all store of loose non-project files, which is a different shelf entirely. By default only the stores actually reachable from this chat are paraded. Should you wish to range further afield, tick the **Look everywhere** box at the top of the shelves and the accordions widen to every store in the house — the vaults of all your characters, present in this chat or not, and every document store besides. Choose any store and its contents open for browsing, with a **Back** step to return you to the shelves.

When the chat belongs to a project that keeps an official document store, the **Project library** button browses and opens that very store, so what you see and what you save land in the same place.

When you are browsing a document store from the Open Document picker and find that no shelf yet exists for the volume you have in mind, the picker offers a discreet **New folder** entry just above the listing. Type the name, press Enter, and a fresh folder appears at your present location, ready to be entered and populated; press Escape to think better of it. The folder is created on the spot — in the database for database-backed stores, or on disk for filesystem mounts — so the next document you save into it lands precisely where you intend.

Just above the **New folder** entry sits its companion, **New document here**. Click it from any folder you have navigated to, and a fresh blank manuscript named "Untitled Document.md" is set out on the desk at that very location, ready for your first words. Should an Untitled Document already occupy that shelf, the next blank takes the next number — "Untitled Document 2.md", and so on — so you may create as many drafts as the moment calls for without colliding with the previous one. The document is committed to its location the instant you click, which means you may rename it on the spot from the editor's title bar; the file is moved in place, the extension is preserved for you, and the Librarian announces the new name in the chat as ever.

Opening, saving, renaming, or deleting a document in the chat no longer costs you your turn. The Librarian — that preternaturally discreet personified feature — steps in to announce the event on your behalf, noting the document's whereabouts (and, when a character is the one who reached for it via `doc_open_document`, `doc_delete_file`, `doc_create_folder`, or `doc_delete_folder`, attributing the act to the character in question). The announcements appear as attributed chat messages so everyone present is apprised of what has just happened at the desk, but the conversational floor remains yours to hold or yield as you see fit.

### Pinning a document for the next character to read

When you wish to draw a character's attention to a particular volume or illustration from a document store — perhaps a reference image you would like them to look at, or a chapter you have been working on and want consulted before they reply — open the **+ Attach** menu in the chat composer, choose the project whose Scriptorium holds the file, and select it. The Librarian then steps in once more, posting a brief announcement that the volume (or illustration) has been set out upon the table for the character's perusal. The file rides along on that announcement message, so the very next character to take a turn sees it natively: vision-capable providers receive the image bytes themselves, and the announcement also carries a written description of the illustration in its body so even providers without vision know what is on the table. The description is composed once via your configured image-description model (Settings → Chat → Image Description Profile) and tucked into the document store's catalogue, so subsequent attachments — in this chat or any other — reuse the same description without paying for another reading. Because the file is read fresh from the document store at each turn, any edits you make in Document Mode after pinning are reflected the next time the character sees it.

## The Tools

The Scriptorium provides three tools that characters can use during conversation. These are not tools you call directly — rather, your AI characters employ them as the situation demands, much like a well-trained butler who simply knows when to bring the tea.

### read_conversation

This tool allows a character to read the full rendered conversation document. It can be called with or without annotations included, giving the character a complete view of everything that has transpired — every message, every interchange, every dramatic revelation and quiet aside.

When supplied with a `conversationId` — perhaps one unearthed by the `search` tool — it can read any conversation in the archive, not merely the one currently in progress. Without a `conversationId`, it reads the present conversation, as one would naturally expect.

When annotations are included, the character sees not only the conversation itself but also any commentary that has been affixed to specific messages by any character in the chat.

The result of a `read_conversation` call is **whispered to the calling character** — the operator sees it in the Salon transcript, but peer characters at the same table do not receive the transcript in their LLM context. If a character wishes to share what she's read, she may quote or summarise it in her own narration; what we prevent is the silent injection of one character's archival lookup into another character's prompt.

### upsert_annotation

Characters can attach persistent annotations to specific messages, identified by message number. Each character may have exactly **one annotation per message** — calling this tool again on the same message replaces the previous annotation rather than stacking them up like an overenthusiastic reviewer's sticky notes.

Annotations appear as fenced code blocks within the rendered Markdown, clearly attributed to the character who wrote them. They serve as a character's private marginalia — observations, reactions, analytical notes, or the occasional sardonic aside that one simply cannot keep to oneself.

### delete_annotation

Should a character decide that a particular annotation has outlived its usefulness — perhaps the observation was premature, or the sardonic aside was a touch too sardonic — this tool removes it cleanly. The annotation vanishes as though it had never been, which is more than can be said for most regrettable remarks made at parties.

### search

This is the tool that transforms the Scriptorium from a mere record-keeping operation into something rather more resembling an actual research library. When invoked, it casts its net across no fewer than four distinct waters at once: a character's personal memories, the full archive of rendered conversations, every document store the character can reach (their own vault, every store linked to the active chat's project, and the instance-wide Quilltap General), and — narrower still — the `Knowledge/` folders inside those same stores. Results return as a single unified ledger, ranked by relevance.

One may optionally restrict the search to particular `sources` (which layers to query) and to a particular `scope` (which stores to look in). The results include sufficient metadata to identify the provenance of each finding: for memories, the importance and summary; for conversations, the title, interchange number, and participants; for documents and knowledge entries alike, the file path and the vault or mount that produced them. Armed with a conversation ID, a character may call `read_conversation` to review the full text; armed with a path and mount-point, `doc_read_file` will fetch the document itself.

Like `read_conversation`, every `search` result is **whispered to the calling character** — peer characters in the same chat do not receive the body of the search result in their LLM context. Since `search` can reach into memories and conversation archives that are inherently per-character, the whisper closes that channel unconditionally; the Shared Vaults toggle does not override it.

#### Choosing a scope

The `scope` parameter controls which document stores the `documents` and `knowledge` sources will reach into. It has no effect on memories or conversations. There are three values:

- **`all`** (the default) — every store the character can see at once: their own vault, every document store linked to the chat's project, and Quilltap General. Use this when one is not sure where the answer lies, or wishes the relevance ranking to choose the best source.
- **`project`** — only the document stores linked to the active project. Use this when the question is plainly about the work at hand and one wishes to exclude both personal vault clutter and the wider house style. Returns nothing if no project is attached to the chat.
- **`character`** — only the character's own vault. Use this to consult one's private notes, kept images, and personal research without admixture from the project or the instance.

#### Knowledge at three scopes

The fourth source — `knowledge` — deserves particular notice, for it draws not from one well but from three, each at a different remove from the responding character. A `Knowledge/` folder (case quite irrelevant — `Knowledge/`, `knowledge/`, `KNOWLEDGE/` all answer the call) may live in any of the following places, and every one of them will be searched in turn:

- **Character knowledge** — the character's own vault, a private archive arranged inside the Scriptorium. Research notes, dossiers, glossaries, the careful reckonings a writer keeps to ensure their character does not forget a detail mid-conversation.
- **Project knowledge** — the `Knowledge/` folder inside *every* document store linked to the active chat's project. Useful for material that the entire project should know but that does not belong to any one character: the lore bible, the campaign's rulings, the gazetteer of place-names.
- **General knowledge** — the `Knowledge/` folder inside the instance-wide Quilltap General store, available to every character in every chat regardless of project. The natural home for one's house style guide, master glossary, or the rules by which all one's worlds abide.

When the search tool returns a knowledge result, the tier is plainly labelled (character, project, or general) so that one knows at a glance whether the source is intimate, communal, or institutional. The ranking favours the closer voice: a verbatim hit in a character's own vault outranks the same hit in a project mount, which in turn outranks the same hit in Quilltap General. A search whose query has no literal substring match anywhere is ranked purely by semantic similarity, with no tier preference applied — vector relevance carries the day.

These knowledge files may be plain markdown, plain text, PDFs, or DOCX documents — anything the indexing already recognises. Markdown files may carry YAML frontmatter at their head (`tags:`, `topics:`, and so forth) to assist in retrieval; the format is delightfully forgiving. Beyond explicit `search` invocations, the Commonplace Book consults all three knowledge tiers on every turn alongside its usual recall of memories, whispering the most relevant pages — or pointers to them — directly to the responding character. Brief files arrive inline, ready to consult at a glance; longer ones arrive as a `doc_read_file` template, the equivalent of a librarian's note saying *the matter you want is in this volume, on these shelves; do let us know if you'd care to fetch it*.

## A Précis in Every Character's Vault

Alongside the full transcript, the Scriptorium keeps a running *précis* of each conversation — a tidy summary that grows as the talk does, folded and refreshed at sensible intervals so it never falls behind the plot. Whenever that summary is brought up to date, a copy is quietly filed into the private vault of *every* character at the table, in a folder named **Conversation Summaries**. (The folder is conjured on first need; you need not lay it out yourself.)

Each filed summary wears a small dossier at its head — frontmatter, in the vernacular — recording the conversation's own identifier, the cast assembled for it, the tally of messages exchanged (the genuine remarks of the players and characters, never the Staff's announcements or whispered asides), and the timestamps of the first and last words spoken. Because the conversation's identifier travels in that dossier, each refresh finds its own prior copy and replaces it — even should you have rechristened the conversation in the meantime, so you are never left with a drawer full of stale duplicates under old names. And should you retire a conversation altogether, its précis is swept from every character's vault along with it.

Like every other page in a character's vault, these summaries are embedded into searchable chunks — which is precisely the point. A character may thus recall the gist of a long-finished conversation without re-reading every line of it, and the Commonplace Book has one more well-indexed shelf to consult when it goes looking for what a character ought to remember.

## Why It Matters

The Scriptorium transforms ephemeral chat messages into structured, searchable documents. Characters can review what has been said with perfect fidelity, annotate the record with their own perspectives, and the entire corpus becomes discoverable through semantic search. It is, in short, the difference between a conversation that evaporates like morning fog and one that is preserved in the archives for future reference — indexed, annotated, and ready for consultation at a moment's notice.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=chat")`

## Related Topics

- [Chat Settings](chat-settings.md)
- [Using Tools in Chat](tools-usage.md)
- [Scene State Tracker](scene-state-tracker.md)
- [Embedding Profiles](embedding-profiles.md)
