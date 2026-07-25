---
url: /custom-tools
---

# Pascal's Workbench

> **[Open Pascal's Workbench](/custom-tools)**

A [custom tool](custom-tools.md) is a modest JSON document, and hand-writing JSON is a fine occupation for a certain sort of evening — but the format is strict, and one misspelled comparator will see your contrivance slide off the table with nothing but an apologetic badge to mark its passing. **Pascal's Workbench** is the fitting room: a visual editor where contrivances are built, inspected, proved against ten thousand imaginary evenings, and filed wherever they ought to live — with never an invalid file written, because the form simply cannot produce one.

Find it in the left rail, from **Settings → Chat → Custom tools**, from the composer's custom-tools dialog (the little wrench beside each listed tool, and *New contrivance…* at its foot), or from any `Tools/*.tool.json` file's row in the Scriptorium.

## The library

The Workbench opens on the library: **every definition in every enabled store, face up** — which is deliberately not what the chat popup shows you. The popup deals a resolved roster, with nearer tiers shadowing farther ones and broken files tucked behind badges; the library is the authoring surface, so nothing hides. Each card shows the tool's title and name, the store it lives in, badges for what that store is attached to (the General store, a project, a group, a character's vault, or nothing at all), and its vital statistics — disabled, whispered, dice or range, so many parameters, so many outcomes.

A name defined in more than one store is flagged — *this name is defined in 3 places* — with a reminder of the order of precedence: character, then participant, then group, then project, then global, nearest winning. The library cannot tell you which one a given chat will deal, because that depends on who is rolling; it can only point out the collision.

Files that would not read appear too, prominently, wearing the loader's own explanation verbatim. Opening one lands you in **repair mode** (below), which is precisely where you fix it.

From the library you may open a contrivance, duplicate it (a copy, opened unsaved, ready to be filed elsewhere), delete its file, or reveal its store in the Scriptorium.

## The workbench proper

The editor is a form column beside a proving bench. Everything in the form corresponds to something in the [file format](custom-tools.md) — and the bench's **exact-bytes preview** shows the JSON your form is writing as you work, which is the pleasantest way yet devised to learn the hand-format.

- **Title and name.** The title is optional finery; leave it blank and the placeholder shows what the name would be dressed up as. Typing a title first suggests a name (`Force the Lock` → `force_the_lock`) until you hand-edit the name, whereupon it stops presuming. The name field simply will not hold an illegal character.
- **Parameters.** Up to eight, each with a type, a required default (a bare invocation must still roll), an optional description, and bounds for the numeric sorts. **Renaming** a parameter rewrites every reference — roll fields, conditions, message placeholders — in one stroke. **Deleting** one does no such favour: you are shown every place it is used, and each reference breaks loudly for you to resolve, which is the honest way round.
- **The roll.** Range or dice. The range form's four fields — min, max, multiplier, offset — each toggle between a literal number and a reference to a numeric parameter, and a running sentence beneath narrates the whole arrangement: *"Draws uniformly in [0, 1), then ×20, then +bonus, rounded."* The dice form validates notation as you type and echoes what it parsed.
- **The consulted oracle.** The switch that gives the tool an [LLM consult](custom-tools.md#asking-an-oracle): a prompt — posed to your cheap utility model after every roll, taking the same placeholders a message does — and your own error line for when no answer comes. Both are required while the switch is on; switch it off and the fields keep their contents dormant, like the roll form's unused half. An optional **answer cap** trims what the oracle may say — leave it blank for the default eight thousand characters, set it low for a verdict, or high (to a hundred thousand) for an oracle whose answer is the whole point.
- **The outcome table.** An ordered cascade, checked top to bottom, first row whose every condition holds wins. Conditions are chips — a subject (the value, the raw roll, a parameter, a key on the invoking character's [fact sheet](character-editing.md), or — when the oracle is on — the consult's answer or its success), a comparator, and an operand — joined by AND. The final row is pinned: it reads *otherwise*, it cannot be moved or deleted, and so the format's mandatory catch-all simply cannot be violated. Metadata subjects take any key you care to type (the sheet is the character's vocabulary, not the file's) and offer every comparator, with the gentle reminder that an ordering test against a key that holds a string declines the row at run time — fail-soft, never an error. The consult's answer behaves the same way: order it and it matches only when the answer reads as a number. Text takes the two substring comparators besides — *contains* and *doesn't contain* — offered wherever the subject is (or might turn out to be) a string, looking for a fragment you type or for the contents of a string parameter; searches of the consult's answer are indifferent to case, as its equality already is.
- **Messages.** Each outcome's message takes placeholders — `{{value}}`, `{{roll}}`, `{{dice}}`, `{{params.x}}`, `{{metadata.key}}`, and `{{llm}}` when the oracle is on — via the *Insert value* menu or your own typing. A typo'd placeholder gets a warning, not a veto: the runtime leaves unknown placeholders as written, so the Workbench merely raises an eyebrow. `{{metadata.…}}` is never called unknown — those keys live on characters, not in the file.

## The proving bench

The right-hand panel is where a contrivance earns its place at the table. Everything it does runs **server-side through the very same machinery a live chat uses** — the bench cannot drift from the real thing, and it posts nothing to any chat.

- **Test roll.** Set the parameters (the same form the composer's run dialog uses), roll, and see a faithful miniature of Pascal's bubble — plus a debug line the real bubble never shows: the raw draw, the final value, *which row of your cascade won* (the row flashes in the form — this is the moment the cascade clicks), and any fact-sheet keys the winning row consulted.
- **The fact sheet.** Metadata-gated rows need somebody's sheet to read. Lend the bench one: **pick a character** (their real `metadata.json`, hydrated fresh — the honest "what would happen if Imogen rolled this") or **hand-type a sheet** as a JSON object, for testing keys no character carries yet. Supply nothing and every metadata test declines, exactly as for an unattributed manual roll — the bench says so rather than letting you wonder.
- **The oracle.** When the tool consults one, a card lets you **script its answer**, script a **silence** (the run shows your error line — the one path every such table must survive), or — for single rolls only — **ask it live**, spending one real cheap-model call to hear what the actual oracle says. The debug line beneath a test roll reports what the consult returned, and why, when it failed.
- **The audit.** *Deal a thousand hands* runs ten thousand draws with the current parameters and fact sheet and charts what share each outcome took. The audit never asks the oracle live — ten thousand hands must not mean ten thousand paid consults — so it deals against your scripted answer, or silence. A row that never fired is flagged — with the honest caveat that reachability depends on the parameters, the sheet, and the scripted answer you supplied: a metadata-gated row showing nought under an empty sheet is working as designed, not broken.
- **The exact bytes.** The JSON that Save would write, live. The form's teaching surface.

## JSON mode, and repair mode

The **Form ⇄ JSON** switch swaps the form for a plain JSON editor, validated as you type. Returning to the form requires the JSON to validate — the form cannot hold an invalid document. Keys this build doesn't recognize (a future format's `persist`, say) are noted and **carried through untouched**; the Workbench never strips what it doesn't understand.

Opening a file that will not parse or validate lands in **repair mode**: JSON only, the loader's complaint displayed, the form locked until the document comes right. You may save a still-broken file — with an explicit *"Save it broken?"* — because the file was already broken on disk, and refusing a partial repair would only chase you back to the raw editor.

## Where shall Pascal keep it?

Saving a new contrivance (or *Save As…*) asks where it should live, and the choices are a geography lesson in shadowing:

- **The General store** — every chat, every character.
- **A project's stores** — chats in that project.
- **A group's stores** — every member of the group.
- **A character's vault** — that character only, shadowing every farther tier.
- **Other stores** — attached to nothing; inert until linked.

A store already holding a tool of the same name is a blocked choice (two files with one name in one store would both be refused at deal time), with a one-click *open the existing one instead*. The same name in a *different* store is merely noted — nearest tier wins, as ever.

## The file on disk

The Workbench writes tidy, minimal JSON: `$schema` first, keys in their canonical order, defaults omitted — a hand-written minimal file re-saved through the form stays minimal. New files are named `Tools/<name>.tool.json`; renaming a tool offers to rename its file to match (the new file is written before the old is removed, so no failure can lose the definition). If the file changed on disk while you had it open, saving offers the civilized choice: take theirs, or press yours.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to the Workbench:

`help_navigate(url: "/custom-tools")`

## Related

- **[Custom Tools — Pascal's Table](custom-tools.md)** — the file format itself, tiers and shadowing, whispered rolls, and the composer's run dialog. Hand-authoring remains fully supported; the Workbench is sugar.
- **[The character fact sheet](character-editing.md)** — the `metadata.json` that metadata conditions read.
- **The Scriptorium** — the document stores your `Tools/` folders live in.
