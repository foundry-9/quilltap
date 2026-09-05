---
url: /settings?tab=chat
---

# Chat Settings

> **[Open this page in Quilltap](/settings?tab=chat)**

Chat Settings control global behavior for all your chats in Quilltap, including how conversations look, how they're stored, and which services are used for special features.

## Accessing Chat Settings

1. Click **Settings** (gear icon) in the left sidebar
2. Click the **Chat Settings** tab
3. You'll see multiple setting cards for different aspects of chat behavior

## Global vs. Per-Chat

The Chat Settings page is where you set *defaults* — the standing instructions that apply to every chat unless one of them politely asks to do otherwise. The per-chat overrides (Image Provider, Announce Generated Images, Auto-generate Avatars, Roleplay Template, Project, Agent Mode, and the like) used to live in a Chat Settings modal, but now hold court in the **Chat** drawer of the right-hand **Chat Sidebar** inside any open conversation. See [Chat Sidebar](chat-participants.md) for the full tour of that cabinet.

## Understanding Chat Settings Sections

### Composition Mode

Decides whether each new chat is delivered to your blotter pre-poised for prose. When the toggle is enabled, every fresh chat opens in composition mode — Enter inserts a newline, and Ctrl/Cmd+Enter sends the message — which suits leisurely paragraphs, formatted scenes, and other unhurried correspondence. When disabled (the factory default), new chats open in chat mode, where Enter sends and Shift+Enter inserts a newline, in the brisk fashion of a telegram clerk.

**Setting Options:**

- **Start New Chats in Composition Mode** — A simple boolean. On: new chats begin in composition mode. Off: new chats begin in chat mode.

**How to configure:**

1. Tick or untick the box at the top of the Chat tab in Settings
2. The change applies to chats created after the toggle, not to existing ones
3. The composer's toolbar still lets you flip the mode for any individual chat at any time

**When useful:**

- You favor multi-paragraph messages and would rather not bump Shift each time
- You're using Quilltap chiefly for long-form roleplay or co-writing rather than rapid-fire chat

**The raw-Markdown view.** While a chat is in composition mode, the formatting
toolbar offers a source toggle — a peek behind the curtain at the raw Markdown
of whatever you are drafting, laid bare in a plain writing box. Edit it there as
freely as you like: what you can see is what gets sent, and the Send button
attends to the source box while it is showing, then hands your revisions back to
the rich editor when you flip the toggle again. (Before 4.9.0 the two surfaces
were at cross purposes, and a message sent from the source view arrived in its
*pre*-edit state; that discourtesy has been dealt with.)

### Composer

A small but civilising amenity: red-pencil underlines beneath any word the dictionary fails to recognise, kept switched on by default for the saving of one's dignity. The toggle governs both the Salon composer (where one's daily correspondence is conducted) and the Document Mode rich editor (where longer compositions are mustered into shape). It does **not** disturb the raw-Markdown or plain-text source views, which are left blissfully unsquiggled so that one's punctuation and tagging are not mistaken for misspellings.

In the Quilltap desktop application — that more dignified vessel than the bare browser — a right-click upon any flagged word produces a small menu of suggestions in the manner of an attentive sub-editor, together with the option to add the offending coinage to your personal dictionary. The browser, alas, offers no such courtesy.

When running inside the desktop application, Quilltap also discreetly feeds the names of all characters in your Aurora into the spellchecker's custom dictionary, so that the invented appellations of your cast (Aristarchus, Theophilus, Penwallow, &c.) do not appear unjustly accused. New characters are added on the next reload; deletions remove them in turn.

**Setting Options:**

- **Spellcheck in the composer** — A single toggle. On: red squiggles appear beneath misspelled words in the rich-text composer and the Document Mode editor. Off: silence prevails.

**How to configure:**

1. Open the **Composer** card on the Chat tab in Settings
2. Tick or untick the box
3. The change applies at once to all open composers; no reload required

**When useful:**

- You suffer the occasional typographical lapse and would rather be told than not
- You are drafting fiction in Document Mode and want a steady second pair of eyes
- (Desktop only) You have a cast of invented names and would rather not see them all flagged as misspellings

**When to turn it off:**

- The squiggles distract you in flow
- You are writing in a language Chromium does not recognise (you may also configure additional languages in the desktop app's developer console — a refinement we will dress up in a proper picker in a later issue)

#### Emoji Shortcuts

Also lodged in the **Composer** card, and quite the most cheerful amenity we have yet installed: type a colon followed by **at least two letters** — `:smi`, `:rock`, `:tada` — and a small brass-cornered menu unfurls beside the caret, offering every emoji whose name or keyword answers to what you have typed. Arrow keys to browse, Enter or a click to insert, Escape to dismiss without the slightest fuss. Should you happen to know the shortcode outright, type it entire and close it with a second colon — `:smile:` — and the character is set at once, the menu never having been troubled at all.

Two letters is the minimum, and deliberately so. A single letter would summon half the catalogue; and `:)` — that ancient and honourable glyph — must be permitted to remain exactly what it is. By the same reasoning the menu declines to appear after `http://`, inside `10:30`, in `C:\Users`, or anywhere a colon is merely doing punctuation's ordinary work. It also holds its peace inside code fences and `inline code`, where an uninvited pictograph would be a positive menace.

What lands in your document is **the plain Unicode character itself** — not a shortcode, not a picture, not some contraption of ours. This matters more than it sounds: the emoji you insert is ordinary text to every other part of the house. It exports intact, it survives a round trip through Markdown untouched, it is searchable, and the model at the other end of the conversation reads it exactly as you wrote it. One tap of Cmd/Ctrl+Z removes the character and restores the literal `:smi` you typed, in the customary single gesture.

No trailing space is added — an emoji sits closer to punctuation than to a word, and `word😄` and `😄😄` are both perfectly respectable constructions we decline to interfere with.

There is also a **button** in the formatting toolbar (the small `☺`), which opens a searchable picker with a browsable grid and a **Recently used** row of your last two dozen selections. A caution worth stating plainly: that toolbar appears only in composition and document-editing modes, so the button is a convenience rather than the feature proper. The colon is always at your disposal; the button is not. Your recents are kept in this browser alone, and are quite deliberately never sent anywhere.

The emoji catalogue is fetched only the first time you actually want it — instances whose correspondents never type a colon never pay for it at all. Should the catalogue prove unreachable, nothing whatever is impeded: the menu simply declines to appear, the picker says so, and your typing proceeds unmolested.

**Setting Options:**

- **Emoji shortcuts** — A single toggle, on by default. On: the `:` menu appears as described. Off: the colon does nothing untoward, and remains an honest colon.

**How to configure:**

1. Open the **Composer** card on the Chat tab in Settings
2. Tick or untick **Emoji shortcuts**
3. The change applies at once; no reload required

**When useful:**

- You want an emoji by *name* without leaving the keyboard or hunting through a grid
- You are on a platform whose own emoji picker is an inconvenience, or absent entirely

**When to turn it off:**

- Your prose is thick with colons — script formatting, timestamps, ratios — and you would rather the menu never stirred
- Note that the toolbar's emoji button is **not** governed by this toggle. The switch restrains the *automatic* colon, which is the part capable of surprising you; a button pressed on purpose never is.

#### Symbol Shortcuts

Sitting directly beneath its cheerful cousin in the **Composer** card, and addressed to a rather more scholarly appetite: type a **backslash** followed by a name, and the appropriate character presents itself. `\to` yields →. `\phi` yields φ. `\leq` yields ≤, `\infty` yields ∞, `\dagger` yields †. The vocabulary is the one every mathematician, physicist and long-suffering thesis-writer already carries in their fingers — the LaTeX commands — some three thousand two hundred characters across twenty-six regions of the Unicode catalogue, arrows and operators and box-drawing pieces and Greek and dingbats and all.

You may also describe what you are after in plain words: `\right arrow`, `\greek phi`, `\em dash`. And should you know a character only by its number, `\u2192`, `\u+2192` and `\u{1D538}` will fetch it directly, without consulting any catalogue at all — which means **every** character in Unicode remains within reach, including the great many we did not see fit to list.

**A matter of capitalisation, and it is not a trifle.** `\phi` is φ and `\Phi` is Φ. Likewise `\gamma` and `\Gamma`, `\delta` and `\Delta`, `\sigma` and `\Sigma`, `\omega` and `\Omega`, `\theta` and `\Theta`. The house observes the distinction scrupulously, as any respectable house must; type the capital and you shall have the capital.

Two ways to commit, precisely as with emoji: pick from the menu with Enter or a click, or — knowing the name outright — type it entire and follow it with a **space**. `\to ` becomes `→ `, space and all, the menu never having been troubled. Should the name mean nothing to us, your text is left exactly as you wrote it and the menu withdraws; we do not guess.

**Your mathematics is safe.** Quilltap renders LaTeX, and `$$\phi$$` is a formula, not a request. The backslash therefore holds its peace inside any formula you have opened — `$$…`, `$…`, `\(…`, `\[…` — so a formula being typed is never quietly mangled into a character. A dollar sign followed by a figure is understood to be money and not mathematics, so `costs $5 and \to ` behaves perfectly normally. As with the colon, nothing whatever fires inside code fences or `inline code`.

The backslash and the markdown escape do not collide, and cannot: an escape is a backslash followed by *punctuation* — `\*`, `\_`, `\[` — while a symbol name must begin with a *letter*. The two occupy entirely separate quarters of the house.

There is a **button** in the formatting toolbar as well (the small `Ω`), which opens the same catalogue as a browsable grid arranged by Unicode block, with its own **Recently used** row — kept quite separately from your emoji recents, since a drawer holding both 😄 and ∮ would serve neither. The catalogue is fetched only the first time you want it, and pressing the space bar — the most-pressed key on the board — never summons it.

**Setting Options:**

- **Symbol shortcuts** — A single toggle, on by default. On: the `\` menu appears as described. Off: the backslash does nothing untoward, and remains an honest backslash.

**How to configure:**

1. Open the **Composer** card on the Chat tab in Settings
2. Tick or untick **Symbol shortcuts**
3. The change applies at once; no reload required

**When useful:**

- You write mathematics, linguistics, or anything else that wants → ≤ ∈ ∞ φ Σ ∮ without a trip to a character map
- You want an em dash, a proper ellipsis, a degree sign or a non-breaking space and would rather not memorise an operating-system incantation for each

**When to turn it off:**

- Your prose is thick with backslashes — file paths, regular expressions, LaTeX you intend to keep verbatim — and you would rather the menu never stirred
- As with emoji, the toolbar's `Ω` button is **not** governed by this toggle. The switch restrains the *automatic* backslash; a button pressed on purpose is never a surprise.

### Auto-Scroll

A question of etiquette: when a character at last lays down the pen at the close of a long reply, should the page hurry you down to the final flourish, or leave you precisely where you were reading? This toggle decides.

Left unchecked — and the factory leaves it so — the Salon is a patient host. As a reply streams in and a new message takes its place in the conversation, the page holds its station; a windy three-page soliloquy can no longer spirit your place off the bottom of the screen mid-sentence. Whenever you have wandered up the page to revisit earlier remarks, a discreet **jump to latest** button presents itself in the lower corner, ready to whisk you back down at a single tap.

Switch it on, and the Salon resumes the eager old manners: each time a reply concludes (or a fresh message arrives), it glides to the newest line — but only when you were already loitering near the bottom. Should you have scrolled up to read, it has the courtesy to stay put regardless.

Two courtesies are constant in either mode: dispatching a message of your own settles you at the foot of the conversation, and first opening a chat deposits you at its end.

**Setting Options:**

- **Chase each reply to its end** — A single toggle. On: the Salon scrolls to the newest message when a reply completes, provided you were near the bottom. Off (default): the page stays where you left it, and a *jump to latest* button appears when you're scrolled up.

**How to configure:**

1. Open the **Auto-Scroll** card on the Chat tab in Settings
2. Tick or untick the box
3. The change applies at once to open chats; no reload required

**When useful:**

- You read replies as they stream and resent being yanked to the bottom the instant they finished — leave it off
- You prefer the conversation to always present its freshest line without lifting a finger — switch it on

### Text Replacement

A scribe's tireless apprentice for the rich-text surfaces: when you type a registered trigger word and then strike a word-boundary character (a space, a comma, a full stop, what have you), Quilltap quietly swaps the trigger for its appointed replacement. `teh` becomes `the`; `Aris` blossoms into `Aristarchus the Wise`; `omw` rises into `on my way`. The transformation is wrought as a single editorial gesture, so one tap of Cmd/Ctrl+Z restores the literal letters you typed (a second tap then walks back the typing itself, in the customary manner).

Replacements fire only on **typed** input — pasted prose passes through unmolested, the better to preserve what you have copied from elsewhere. Triggers are matched as whole words against the *end* of a text node, so mid-word edits are politely declined. Source-mode surfaces (the raw Markdown view, the plain-text view) are left untouched, lest a perfectly good `#heading` find itself rewritten en route.

The feature is, at present, deliberately modest: literal triggers, literal replacements, no regex, no multi-line snippets, no cursor-positioning conjuring tricks. The aim is the cross-platform substitute for OS autocorrect that the browser otherwise withholds — and to do that one task well before reaching for more.

**Setting Options:**

- **Master toggle** — *Text replacement (autocorrect)*. On: rules fire. Off: rules sit quietly while preserving the list, so you may A/B the feature without losing your work.
- **Add a rule** — A small form for the trigger, the replacement, and a per-rule **Case-sensitive** flag. When case-sensitive, only the exact casing matches (`URL` is honoured; `url` is not). When case-insensitive (the default), any casing matches and the replacement is written verbatim.
- **Rules** — The full ledger of registered replacements. Each row may be edited in place (changes save on blur or Enter), temporarily disabled with the **On** checkbox, or struck out entirely with **Delete**.
- **Try it** — A scratch textarea at the bottom of the card. Type a trigger plus a space to confirm a rule fires as intended. Nothing typed here is saved.

**How to configure:**

1. Open the **Text Replacement** card on the Chat tab in Settings
2. Tick the master toggle on (it is on by default)
3. Add rules one at a time, or edit the rows already present
4. Test in the **Try it** box, or stroll over to the Salon composer or Document Mode

**When useful:**

- Frequent typographic stumbles you'd like silently corrected (`teh → the`, `recieve → receive`)
- Long invented names you'd prefer to invoke by a short pet form (`Aris → Aristarchus the Wise`)
- Shorthand for stock phrases you write daily (`omw → on my way`, `eta → estimated time of arrival`)

**When to turn it off:**

- You're drafting in a context where literal triggers must remain literal (technical notes, code comments inside prose)
- A particular replacement is firing where you didn't intend it — switch its **On** checkbox off, or refine the trigger
- You'd like to compare a session with and without the feature engaged — that's exactly what the master toggle is for

**Notes for the careful:**

- Newline (Enter) is **not** a word-boundary trigger in this version. Type a space before pressing Enter if you want a replacement to fire on the last word of your message.
- A rule's order in the list is presentational, not load-bearing: case-sensitive rules always win over case-insensitive rules with the same trigger.
- You cannot register two case-insensitive rules with the same trigger (the system politely declines with a conflict notice). Two rules with the same trigger but different case-sensitivity flags are perfectly legal.

### Smart Typography

The Text Replacement card's near neighbour, and its temperamental opposite in one important respect. Here reside the small civilities of the compositor's trade — curled quotation marks, the en dash, the em dash, the ellipsis — arranged in **two groups**, and the difference between those groups is not a filing convenience but the whole substance of the thing.

**The first group changes only what you see.** Tick *Curly quotes when displaying messages* and the conversation acquires proper “curly quotes” where before it wore the typewriter's flat little strokes. What is *stored*, however, and what is dispatched to the model, remains character for character what you typed. Not one byte of your correspondence is altered. Untick the box and the whole of your history reverts on the instant, as though the matter had never been raised. This is a question of dress, not of substance, and the house treats it accordingly.

Code is never touched — neither fenced blocks nor `inline code`. Mathematics is never touched. The address inside a link is never touched. And should your roleplay template have claimed the quotation mark for its own purposes as a delimiter, the curling stands aside in that chat entirely, rather than trampling arrangements you made deliberately.

One acknowledged imperfection, and we would rather name it than have you discover it: a word opening with an apostrophe — `'tis`, `'80s`, `'n'` — will be given an opening quotation mark instead. Every typesetter's engine ever built makes this same mistake, the poor thing having no way to distinguish an elision from a quotation. Because nothing is written down, the blemish is cosmetic only: your text still says `'tis`, and one flick of the toggle sets the appearance right again.

**The second group changes your text.** Type two hyphens and you get an en dash (`–`); a third promotes it to an em dash (`—`); three full stops become a proper ellipsis (`…`). These are **real characters, written into what you have composed**, and they are meant to be: a writer who types `--` wants a dash, the hyphen being merely the keyboard's apology for a key it does not possess. A fourth hyphen leaves matters exactly as they are, which doubles as your escape hatch. One tap of **Backspace** immediately after any substitution restores the literal characters; one tap of Cmd/Ctrl+Z does the same.

**Why dashes are not offered in the first group, and never will be.** Consider `run it with --verbose`. A display-time dash rule would render that as `–verbose` — the source correct, the screen wrong, and the writer with no earthly way to discover why. At the keystroke there is no such trouble: you see the dash arrive and press Backspace once. The arrangement is deliberate and permanent.

Nothing in the second group fires inside code fences or `inline code`, nor in the source-mode views, nor upon pasted text, nor while an input method editor is mid-composition.

**Setting Options:**

- **Curly quotes when displaying messages** — Off by default. On: the conversation displays curly quotes. Your stored text and the model's input are unaffected either way.
- **Dashes (`--` → `–`, `---` → `—`)** — On by default. Applies in the Salon composer and the Document Mode rich editor.
- **Ellipsis (`...` → `…`)** — On by default. Same two surfaces.
- **Try it** — A scratch textarea for the second group. Type a couple of hyphens or three full stops and watch. Nothing typed here is saved.

**How to configure:**

1. Open the **Smart Typography** card on the Chat tab in Settings
2. Tick or untick each toggle as suits you
3. The quote setting applies to every message at once — the Salon, the help chat, thinking blocks, the Brahma console alike
4. The dash and ellipsis settings apply to the next thing you type

**When useful:**

- You want your prose to *look* properly typeset without your archives being quietly rewritten to suit the fashion
- You write long-form fiction, in which the em dash is not a luxury but a load-bearing member
- You are on a platform whose operating system declines to supply these substitutions on your behalf

**When to turn it off:**

- **Curly quotes:** you are writing about code, measurements in inches, or anything where the straight mark is the correct mark on screen as well as on disk
- **Dashes:** you routinely write command-line flags in plain prose and would rather they never be disturbed — though note the ladder gives you a fourth hyphen as an escape, and Backspace as another
- **Ellipsis:** you have a use for exactly three separate full stops

**Notes for the careful:**

- Turning the quote setting on or off does not alter a single stored message, does not disturb any model's input, does not shift a prompt cache, and does not change what an export contains. It is the one setting in this house that can be flipped with no consequence whatever beyond the visible.
- Exports and backups always carry the straight quotes you actually typed.
- Dashes and ellipsis, by contrast, *do* become part of the message and travel with it everywhere.
- Neither group has any bearing on your characters' documents. Curly punctuation does find its way into files all the same — your characters write like authors and Quilltap records them faithfully — and the [document editing tools](document-editing-tools.md) now read past a difference of punctuation when hunting for a passage to amend, so an edit is never refused over the shape of an apostrophe.

### Avatar Settings

Controls how your user avatar appears in chats.

**Setting Options:**

- **Avatar Mode** — Choose how to display your avatar:
  - **Initials** — Show your initials (e.g., "JD" for John Doe)
  - **Image** — Use an image from your image library
  - **Emoji** — Use a single emoji character

- **Display Style** — Customize appearance:
  - **Circle** — Round avatar
  - **Square** — Square with rounded corners
  - **Rounded Square** — Square with more rounded corners
  - **Full Square** — Sharp square corners

- **Background Color** — Pick a background color for the avatar

**How to change:**

1. Choose your preferred mode and style
2. Changes apply immediately to all chats
3. If using image mode, select which image to display

### Cheap LLM Configuration

Configure a fallback LLM for lower-cost operations. Quilltap can use a cheaper model for certain operations, reserving your main profile for complex tasks.

**Setting Options:**

- **Enable Cheap LLM** — Toggle this feature on/off
- **Cheap LLM Profile** — Select which connection profile to use for cheaper operations
- **Operations** — Controls which operations use the cheap profile:
  - Summary generation
  - Memory indexing
  - Title generation for chats
  - Other low-complexity tasks

Image description is *not* among them, though it is thrifty by disposition: it never consults this setting, and instead prefers a profile marked **Cheap** when it has to choose a describer for itself. Name a profile in [Image Description Settings](#image-description-settings) and that choice governs, cheap or dear.

**How to configure:**

1. Click **Enable Cheap LLM**
2. Choose a connection profile from the dropdown (must be created in Connection Profiles tab)
3. The selected profile is used for cost-saving operations
4. Your main profile is used for actual chat interactions

**Allow a Similar-Tier Stand-In**

Background work goes wrong quietly. A cheap route that stops answering takes your
chat titles, memory extraction and summaries down with it, and says nothing about
it in the Salon.

When a cheap task runs through a connection profile, that profile's own
**Fallback** arrangement applies — see
[Connection Profiles](connection-profiles.md#the-understudies-fallback). But
some cheap routes have no profile behind them at all: a local model picked up
directly, or a cheapest-available route Quilltap assembled on the spot. There is
nothing there to hang an understudy on.

Tick **Allow a Similar-Tier Stand-In** and those routes may have one drafted
from your profiles marked *Cheap*. One attempt, and one only. Off by default,
since a drafted stand-in may spend money where a local model spent none.

**Benefits:**

- Save on API costs
- Use fast models for background operations
- Reserve expensive models for direct chat

**Prerequisites:**

- At least two connection profiles must exist
- Must have an API key for the cheap provider

### Image Description Settings

Not every model has eyes. When you attach a photograph to a conversation whose model cannot see — an Ollama text model, an OpenRouter profile pointed at something wordy but sightless — Quilltap does not simply shrug and drop the picture on the floor. It engages a second model, one that *can* see, to **describe** the image in prose, and hands that description to your correspondent in the picture's place. The conversation proceeds as though you had described the thing yourself, at length, without once being asked to.

These settings govern which model is called upon to do the describing.

**When this happens at all:** only when the profile answering the message has its **Supports image attachments (vision input)** checkbox *unticked* (see [Connection Profiles](connection-profiles.md)). A profile with the box ticked receives the image itself and no describer is troubled. That checkbox — not the provider's name on the door — is the whole of how Quilltap decides who can see.

**Setting Options:**

- **Primary image description profile** — the model that describes your images. Only profiles with the vision checkbox ticked appear in the list. Leaving it on **Auto-select vision-capable profile** does *not* disable descriptions; it lets Quilltap choose for you, preferring a profile you have marked **Cheap** and otherwise taking the first sighted profile it finds. Since the choice is then somewhat arbitrary, naming one explicitly is the wiser course.
- **Uncensored fallback profile** — optional, and consulted only when the primary refuses the commission or returns something unusable. A more permissive model is the usual choice: a local Ollama LLaVA variant, an uncensored model by way of OpenRouter. Left blank, there is no second attempt, and a refusal stands as a refusal. Unlike the primary, this one is **never** auto-selected; if you have not named it, it does not exist.

**How to configure:**

1. Tick **Supports image attachments (vision input)** on at least one connection profile whose model can actually read pictures — otherwise both dropdowns will be empty.
2. Select that profile as your **primary**. Small, quick, inexpensive models do this job admirably: `gpt-4o-mini`, `claude-haiku-4-5`, `gemini-2.0-flash`. Reasoning models are a poor fit — slow, dear, and inclined to spend their whole allowance thinking rather than answering.
3. Optionally name an **uncensored fallback**, if your chats venture where a well-mannered describer will decline to follow.

**What happens:**

- For portraits and scenes conjured by the establishment's own hand — a character's avatar, a story backdrop, an image summoned by the tools — no describer is troubled at all: the very prompt that painted the picture is kept on file and read back verbatim, instantly and without charge. The same courtesy extends to any uploaded image that already carries a description on its file record.
- Failing that, the primary profile is sent the image with an instruction to describe it in thorough detail — every visible element, colour, composition, mood, and scrap of text.
- The resulting description is inserted into the message as plain words, plainly labelled as an AI's description of an attachment. Your correspondent reads about the picture; it does not see it.
- Should the primary refuse — or return an empty answer, or something so terse and hedged that it reads as a refusal ("I cannot…", "unable to…") — the uncensored fallback, if you have named one, is given its turn. If both decline, the message explains as much rather than pretending the attachment never arrived.
- Every consultation is entered in the LLM logs as an **IMAGE_DESCRIPTION** call, so its cost, its latency, and its refusals are all a matter of record.
- Should a describer prove sluggish, the consultation is abandoned after a minute so a single slow portrait can never hold your correspondent's reply hostage.
- **The describer's word is checked before it is believed.** A gateway that fronts hundreds of models — NanoGPT, OpenRouter and their kind — may accept your picture with every appearance of politeness and route it to a model that quietly disregards it. The model, asked to describe an image it was never shown, will describe *an* image: fluently, at length, in tidy sections, and entirely out of its own head. Quilltap now examines the bill. A consultation charged for the instruction alone did not look at your picture, whatever prose came back, and the answer is discarded unread rather than filed. So too when the provider itself reports the attachment as never sent. In either case the failure names the offending profile and the fallbacks take their turn as they would after any other refusal.

**Elsewhere in the house:** the primary profile is also the model consulted by the wardrobe's image analyser (see [Wardrobe](wardrobe.md)) and Aurora's *Describe from image* step. Those features prefer a *more* capable model when left to choose for themselves, on the reasoning that reading a garment's cut from a photograph is finer work than summarising a snapshot.

**Prerequisites:**

- At least one connection profile with **Supports image attachments (vision input)** ticked, and a working API key for it
- The describing model must genuinely accept images. Ticking the box on a model that cannot see is now caught rather than believed — the consultation fails by name and passes to the fallbacks — but it still costs you a wasted call, so tick it only where it is true

### Memory Cascade Settings

Controls how chat memory is managed, summarized, and stored over time.

**Setting Options:**

- **Memory Mode** — Choose how memory is handled:
  - **Full History** — Keep all messages in memory
  - **Sliding Window** — Keep only recent messages
  - **Summarization** — Summarize old messages to preserve context
  - **Hybrid** — Combination of summarization and recent messages

- **Retention Settings:**
  - **Keep Recent Messages** — How many recent messages to always remember
  - **Summarization Threshold** — When to start summarizing old messages
  - **Summary Length** — How detailed summaries should be

- **Cascade Behavior:**
  - **Character Memory** — How memory affects character knowledge
  - **Chat Memory** — How memory affects individual chat history
  - **Search Behavior** — How memory affects semantic search

**How to configure:**

1. Select a memory mode based on your needs
2. Adjust thresholds for when summarization occurs
3. Settings apply to all new chats created after changing

**When to use each mode:**

- **Full History** — Short, focused conversations
- **Sliding Window** — Medium-length chats with varied topics
- **Summarization** — Long-running, complex conversations
- **Hybrid** — Best for most use cases

**Prerequisites:**

- Embedding profiles may be required for semantic memory operations
- Memory cascade requires embedding search to be functional

### Context Compression Settings

Optimizes how conversation context is managed for efficiency.

**Setting Options:**

- **Enable Compression** — Toggle context compression on/off
- **Compression Method:**
  - **Simple** — Basic token counting
  - **Intelligent** — Learns which parts of context matter
  - **Aggressive** — Removes more context for cost savings

- **Compression Threshold** — When to start compressing context:
  - Token limit before compression starts
  - Prevents token limit overages
  - Helps manage API costs

**How it works:**

Context compression applies only to **conversation history** — the message log that accumulates as you chat. Each character's system prompt (their identity, personality, and instructions) is never compressed, ensuring characters always maintain their distinct voice and personality.

In multi-character chats, each character maintains their own compression cache. This is necessary because different characters may have different views of the conversation — a character who joined late only sees messages after their arrival, whispers are filtered per-recipient, and absent characters don't see messages that occurred while they were away.

**Two clocks, and why:**

Compression is ordinarily done in the quiet after a turn has already been delivered, so that a tidy history is waiting when you next press send. Nobody is standing about while that happens, and it is allowed a generous interval to finish in — long conversations make for long prompts, and a compression that runs slowly is not a compression that has gone wrong.

Occasionally there is no result waiting: you have sent two messages in quick succession, or the conversation has grown since the last pass. Quilltap then compresses on the spot, and here you *are* standing about, so the interval is deliberately the shorter one. If it runs out, the turn simply goes out with its history uncompressed and a note to that effect in the warnings — which costs tokens, but costs them promptly.

The same principle governs everything the cheap LLM is asked to do: the interval follows whoever is waiting on it. Work done in the quiet after a turn — memory extraction, the scene tracker, titling — is given a long rope, since a slow pass there costs nobody anything and a short rope turns it into a lost one. Work done while a turn is assembling, such as the memory recap and its compressions, keeps the shorter interval, and forgoes the second attempt a background pass would be granted. The background intervals were widened considerably after it emerged that they had been set inside the range of ordinary healthy work.

**How to configure:**

1. Enable compression if dealing with long conversations
2. Choose compression method (Intelligent is usually best)
3. Set threshold based on your model's token limits
4. Monitor token usage to optimize

### Token Display Settings

Controls whether token counts are shown in the UI.

**Setting Options:**

- **Show Token Counts** — Toggle token display on/off
- **Show in Messages** — Display tokens per message
- **Show Totals** — Display total tokens for entire chat
- **Detailed Breakdown** — Show input/output token split

**How to configure:**

1. Enable token display to see usage
2. Choose what level of detail to show
3. Helpful for monitoring API costs
4. Can be toggled per chat if enabled globally

**When useful:**

- Monitoring API usage and costs
- Debugging token limit issues
- Optimizing prompts for efficiency

### LLM Logging Settings

Controls whether interactions with AI providers are logged and stored.

**Setting Options:**

- **Enable LLM Logging** — Toggle logging on/off
- **Log Level:**
  - **Full** — Log complete interactions
  - **Summary** — Log only key information
  - **Minimal** — Log only errors and usage stats

- **Retention:**
  - **Keep logs for** — How long logs are stored (7 days, 30 days, forever)
  - **Auto-cleanup** — Automatically delete old logs

**How to configure:**

1. Enable logging to track all LLM interactions
2. Choose log level based on your needs
3. Set retention policy for storage

**When useful:**

- Debugging conversation issues
- Auditing AI behavior
- Analyzing token usage patterns
- Troubleshooting provider problems

**Privacy Note:** Logs contain your chat content. Keep retention period reasonable if privacy is a concern.

### Story Backgrounds Settings

Configure AI-generated atmospheric background images for your chats.

**Setting Options:**

- **Enable Story Backgrounds** — Toggle automatic background generation on/off
- **Image Generation Profile** — Select which image profile to use for generating backgrounds:
  - Choose from available image generation profiles
  - If not set, uses the character's image profile or your default profile

**How it works:**

1. When enabled, Quilltap generates a landscape scene image after each chat title update
2. The scene features your characters based on their physical descriptions
3. The chat title provides context for the scene (e.g., "Sunset conversation on the beach")
4. Generated images appear as subtle backgrounds (30% opacity) behind chat content

**Benefits:**

- Creates immersive visual context for roleplay and storytelling
- Backgrounds automatically update as the story progresses
- Preserves readability with semi-transparent overlay

**Prerequisites:**

- At least one image generation profile configured
- Valid API key for your image provider
- Characters with physical descriptions produce better results

**Learn more:** See [Story Backgrounds](story-backgrounds.md) for detailed information.

### Per-Conversation Avatar Generation

Controls whether Quilltap generates unique AI portraits for each character in a chat. When enabled, character avatars are created automatically based on their physical descriptions and current outfits, giving each conversation its own visual identity — rather like commissioning a portrait painter for every new gathering.

**Setting Options:**

- **Enable Avatar Generation** — Toggle per-conversation avatar generation on or off. Available both when creating a new chat and (as **Auto-generate Character Avatars**) in the Chat Sidebar's **Chat** drawer during active conversations.
- **Regenerate Avatar** — In the Chat Sidebar's **Participants** drawer, click the refresh button on any character's portrait to queue a new avatar. Useful after outfit changes or when the muse simply failed to capture the right likeness the first time.

**How it works:**

1. When enabled on chat creation, avatars are generated for all LLM-controlled characters as soon as the chat begins
2. When toggled on during an active chat, generation is queued for all LLM characters
3. Avatars update automatically when outfit changes occur (if enabled)
4. Generated avatars appear in the Chat Sidebar's **Participants** drawer and are specific to that conversation

**Prerequisites:**

- At least one image generation profile configured
- Characters with physical descriptions produce significantly better results
- The wardrobe system enhances avatar accuracy — equipped outfits are included in the generation prompt

### Automation Settings

Controls automatic behavior during chat interactions.

**Setting Options:**

- **Auto-Detect RNG Calls** — Automatically detect and execute dice rolls, coin flips, and "spin the bottle" commands in both your messages and character responses:
  - **Dice notation**: Patterns like "2d6", "d20", "3d10" are detected and rolled automatically
  - **Coin flips**: Phrases like "flip a coin" trigger automatic coin flips
  - **Spin the bottle**: Phrases like "spin the bottle" randomly select a chat participant

**How it works:**

1. When enabled (default), Quilltap scans both your messages and character responses for RNG patterns
2. For your messages: patterns are executed before sending, results appear before your message
3. For character responses: patterns are executed after the response, results appear after
4. Results appear as tool messages in the chat, visible to all participants

**Why this is useful:**

- When a character says "I roll a d20 to attack", the dice actually get rolled
- Creates immersive tabletop RPG experiences where dice mentions become real rolls
- Both you and the AI can trigger random events naturally through conversation

**When to disable:**

- When discussing dice or probability without wanting actual rolls
- When you prefer to use the manual RNG tool via **Run Tool…** in the Chat Sidebar's Chat drawer
- When writing content that mentions dice notation without wanting it executed

**Example patterns detected:**

- "I roll 2d6 for damage" → Executes 2d6 roll
- "Let's flip a coin" → Executes coin flip
- "Spin the bottle to see who goes next" → Randomly selects a participant
- Character: *"I roll a d20"* → Executes d20 roll after the response

### Timestamp Injection & Timezone

Controls whether Quilltap injects the current date and time into the system prompt sent to the LLM, so the character knows what time it is — rather like winding a pocket watch before a conversation.

**Timestamp Mode:**

- **Disabled** — No timestamp is injected
- **Conversation Start** — Include the time only in the initial system prompt
- **Every Message** — Update the timestamp with each message sent
- **Every X Minutes** — The Host announces the time only when at least the configured number of minutes (defaulting to fifteen, like a stationmaster glancing at his pocket watch each quarter-hour) have elapsed since the last announcement. The first message of a conversation always receives an announcement.

**Timestamp Format:**

- **Friendly** — Human-readable (e.g., "February 22, 2026 at 2:30 PM")
- **ISO 8601** — Machine-readable with timezone offset (e.g., "2026-02-22T14:30:00-05:00")
- **Date Only** — Just the date, no time
- **Time Only** — Just the time, no date
- **Custom** — Use your own format string with date-fns tokens

**Timezone:**

By default, Quilltap shows timestamps in the server's timezone — which, if you're running in Docker, is quite likely to be UTC. This is rather like a clock permanently set to Greenwich Mean Time while you're sipping cocktails in New York.

To remedy this situation:

1. **Automatic detection (Electron app):** The desktop app detects your operating system's timezone and passes it through to the server automatically. No action required on your part.
2. **Per-chat override:** In the timestamp configuration for any chat, set a specific timezone from the searchable list.
3. **Salon-level default:** In Chat Settings, set a default timezone that applies to all timestamp formatting.
4. **Docker users:** Set the `QUILLTAP_TIMEZONE` environment variable when starting the container:
   ```
   docker run -e QUILLTAP_TIMEZONE=America/New_York ...
   ```
   The container obligingly winds its own clock to match, so the one variable settles the whole household.

The timezone resolution follows a courteous chain of precedence: per-chat setting wins, then the Salon default, then the `QUILLTAP_TIMEZONE` environment variable, and finally the server's system timezone.

A word on why the container's own clock matters, and not merely the formatting: some of the establishment's business consults the wall clock directly rather than asking how to phrase things. Rooms that wake on a schedule, the daily token allowance that turns over at midnight, and the Commonplace Book's notion of what counts as "today" all take their cue from the server's hour. Set the timezone in the Salon alone and your timestamps will read handsomely while a room scheduled for seven in the morning rings at two — a discrepancy that has ruined many a well-planned breakfast. The environment variable sets both at once and spares you the arithmetic.

**Fictional Time:**

For those engaged in period dramas or interstellar adventures, toggle "Use fictional time" to inject a made-up timestamp that advances in real time from a base you specify. The timezone setting still applies to how the fictional time is formatted.

The base timestamp is read as a clock face in the chat's own timezone — set 10:15 for a tale in Constantinople and your characters will be told it is a quarter past ten there, regardless of what hour it happens to be in the room where the server sits. From that moment the fictional clock keeps step with the real one, minute for minute: an hour of your conversation is an hour of theirs. The clock is wound when the chat is created, so a chat begun this morning and resumed this evening will find that the afternoon has passed in the story as surely as it did outside your window.

A caution for the impatient: because the fictional clock is anchored at the chat's creation, it cannot be re-wound afterwards. Should you wish to begin a tale at a different hour, begin a new chat.

### Data Retention

Sets how many days a chat may sit with nobody actually speaking in it (Staff announcements don't count) before Quilltap's nightly housekeeping tidies away its regenerable working data — compression caches, pre-rendered pages, model scratch-work, superseded generated images, and semantic-search embeddings. The conversation itself is never touched, keyword search keeps working, and a tidied chat re-indexes itself for semantic search the moment you reopen it.

- **Keep inactive chats' working data for N days** — 1 to 3650; the default is 30. Global only — no per-chat dial.

Full particulars, including what precisely is and isn't tidied: [Data Retention](data-retention.md).

### Taboo

A standing list of phrases nobody in the house is to utter — the stock verbal tics of the age, the borrowed cleverness that arrives already exhausted. Every character receives the list as part of their standing instructions, with orders to avoid each entry not merely word for word but in all its inflections, rewordings, and near-variants, and to say the plain thing instead. They are likewise forbidden to mention the list, which spares you characters remarking archly upon what they've been told not to say.

- **Add a phrase** — one at a time; commas belong inside a phrase, so they cannot serve as separators
- **Remove a phrase** — the small × beside it
- Up to 500 phrases, each up to 200 characters. Duplicates are quietly discarded regardless of capitalisation; your ordering is left exactly as you arranged it

The list is instance-wide — one register for the whole establishment, no per-character or per-chat exceptions. An empty list adds nothing whatever to any prompt.

Full particulars: [Taboo](taboo.md).

## Saving Chat Settings

Most settings save automatically as you make changes. You'll see:

- **Checkmark icon** — Setting was saved
- **Loading spinner** — Setting is being saved
- **Error message** — Setting failed to save (try again)

## Common Chat Setting Workflows

### Optimizing for Cost

1. **Enable Cheap LLM** — Use a cheaper model for background work
2. **Set Context Compression** — Reduce token usage
3. **Enable Token Display** — Monitor your usage
4. **Review LLM Logs** — See where tokens are being used

### Optimizing for Quality

1. **Disable Memory Summarization** — Keep full conversation history
2. **Disable Context Compression** — Don't remove context
3. **Use high-quality profile** — In Connection Profiles
4. **Increase token limits** — Allow longer responses

### Long-Running Character Development

1. **Enable Memory Cascade** — Preserve context over time
2. **Set Summarization** — Summarize old memories
3. **Configure Cheap LLM** — For memory operations
4. **Enable LLM Logging** — Track development progress

### Privacy-Focused Setup

1. **Disable LLM Logging** — Or set minimal retention
2. **Use local LLM** — If using Ollama (no cloud)
3. **Manage Memory Cascade** — Control what's stored
4. **Review API provider** — Choose privacy-respecting options

## Troubleshooting Chat Settings

### Settings won't save

**Solution:**

- Check your internet connection
- Try refreshing the page
- Look for error message explaining the issue
- Contact support if problem persists

### Token counts seem wrong

**Solution:**

- Token counting varies by model
- Some providers round differently
- This is normal and expected
- Check provider's documentation for exact counting method

### Memory cascade isn't working

**Solution:**

- Verify embedding profiles are configured
- Check that memory cascade is enabled
- Ensure sufficient embeddings vocabulary
- May require restart of chat

### Cheap LLM not being used

**Solution:**

- Verify cheap LLM is enabled
- Check that profile exists and is valid
- Only certain operations use cheap profile
- Chat messages always use main profile

### Image descriptions missing, refused, or wrong

**Solution:**

- Confirm at least one connection profile has **Supports image attachments (vision input)** ticked — with none, the describer dropdowns are empty and no description can be produced
- Confirm that profile's model can genuinely read images; a ticked box on a sightless model yields an empty answer, which Quilltap reports rather than passes off as a description
- If the description reads like a polite refusal, name an **uncensored fallback profile** — without one, a refusal is final
- If descriptions appear for uploads but a Quilltap-generated image seems described oddly, remember that generated images are described by the prompt that painted them rather than by any describer
- If nothing appears and no error does either, check the LLM logs for an **IMAGE_DESCRIPTION** entry: a minute-long call that ends in a timeout means the describing model is too slow for inline duty
- Reasoning models (`o1`, `o3`, `gpt-5`, and kin) make poor describers — they spend their tokens thinking. Prefer `gpt-4o-mini`, `claude-haiku-4-5`, or `gemini-2.0-flash`

## In-Chat Settings Access

Characters with help tools enabled can read your current chat settings during a conversation using the `help_settings` tool with `category: "chat"`. This returns your token display, context compression, memory cascade, timestamp, agent mode, dangerous content, automation, and LLM logging settings. Simply ask a help-tools-enabled character something like "What are my chat settings?" and it will look them up for you.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=chat")`

## Related Settings

- [Connection Profiles](connection-profiles.md) — Choose which LLM to use
- [API Keys](api-keys-settings.md) — Store credentials for providers
- [Image Generation Profiles](image-generation-profiles.md) — Configure image generation (separate from descriptions)
- [Embedding Profiles](embedding-profiles.md) — Required for memory cascade and semantic search
- [Appearance Settings](appearance-settings.md) — Control chat UI appearance (separate from behavior)
- [Story Backgrounds](story-backgrounds.md) — AI-generated atmospheric backgrounds for chats
