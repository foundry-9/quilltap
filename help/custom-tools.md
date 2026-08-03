---
url: /settings?tab=chat&section=custom-tools
---

# Custom Tools — Pascal's Table

> **[Open this setting in Quilltap](/settings?tab=chat&section=custom-tools)**

There comes a moment in every story when the outcome ought not to be anybody's decision. Can she pick the lock? Does the detector register anything at all? What, precisely, does one draw from a deck of many things? You could decide. Your characters could decide. But a story in which the interesting questions are settled by whoever is most eager to settle them is not, in the end, a story with much suspense in it.

This is what Pascal the Croupier is for. A **custom tool** is a small contrivance of your own design — a named action, a roll of chance, and a table telling Pascal what each result means. You write it once, as a modest JSON document. Thereafter your characters may reach for it, and so may you, and neither of you gets to argue with the wheel.

**The wheel cannot be argued with.** This is the entire point, so it bears stating plainly: the roll happens on the server, and Pascal announces the outcome himself, in his own message. Your characters do not write that message. A model that would dearly love to have picked the lock will find the lock has not been picked, and will have to go on from there. Regenerating a reply does not spin again — a roll, once fallen, has fallen.

## Pascal's Workbench

You need not write the JSON by hand at all. **[Pascal's Workbench](pascals-workbench.md)** (`/custom-tools`) is a visual editor for everything on this page: a library of every definition in every store, a form that cannot produce an invalid file, a proving bench for dry-run rolls and a ten-thousand-hand audit, and a repair mode for files that would not read. The hand-format below remains fully supported — the Workbench is sugar, and its live JSON preview is a fine way to learn the format.

## Where the tools live

Pascal looks for a folder called `Tools` at the top of any document store, and reads every file in it whose name ends in `.tool.json`. One tool per file.

The folder is not made for you and need not exist; if you want one, simply create `Tools/` in a store and put a file in it. The filename itself carries no weight — a tool's identity is the `name` inside it, so `lockpicking.tool.json` may perfectly well contain a tool named `unlock`.

## A first tool

Here is a complete one. Copy it, put it in `Tools/unlock.tool.json` in any store your character can reach, and it is available immediately — there is nothing to restart and no button to press.

> Should you prefer to see every key at once rather than meet them one at a time, there is an annotated specimen at `docs/developer/CUSTOM_TOOL_SPEC.json` that exercises the lot, and a dice-form companion beside it at `docs/developer/CUSTOM_TOOL_SPEC_DICE.json`. Both are valid and may be copied wholesale.

```json
{
  "$schema": "/schemas/qtap-custom-tool.schema.json",
  "name": "unlock",
  "description": "Attempt to pick the lock.",
  "parameters": {
    "bonus": {
      "type": "number",
      "default": 0,
      "description": "Skill bonus added to the roll.",
      "min": 0,
      "max": 10
    }
  },
  "roll": { "min": 0, "max": 1, "offset": { "$param": "bonus" } },
  "outcomes": [
    { "when": { "gt": 0.60 }, "message": "The lock clicks open.",   "state": "success" },
    { "when": { "lt": 0.30 }, "message": "Still locked.",            "state": "failure" },
    { "when": true,           "message": "The lock is giving way…",  "state": "partial"  }
  ]
}
```

That `$schema` line at the top is worth keeping. It is what lets a decent text editor complete the field names for you and complain before Quilltap has to.

### `title` — what the thing is called in polite company

The `name` is the tool's identity: lowercase, no spaces, and the string your characters actually call. It is not, however, a thing anyone wants to read. Add a `title` and Pascal will announce that instead:

```json
{ "name": "scan_hawking_radiation", "title": "Scan Hawking Radiation" }
```

Omit it and Quilltap derives one from the name — underscores and hyphens become spaces, and each word is given its capital — which for the example above produces precisely the same string, and for a great many tools will do perfectly well. Write a `title` when the derivation isn't what you'd have said yourself: `saving_throw` might be *Save vs. the House*.

Your characters never see the title. They know the tool as `unlock` and ask for it by that name, which spares them the confusion of a thing with two names and spares you a model that guesses wrong about which one to use.

### `description` — write it for the story, not for the machinery

This is the single most consequential sentence in the file, because it is how a character decides whether this tool is the thing they want. Write what the tool *does in the fiction*: "Attempt to pick the lock." Do not write what it does arithmetically: "rolls 0–1 against thresholds." Your character is picking a lock; they are not consulting a probability distribution, and describing it as one is a reliable way to get stilted results.

### `parameters` — optional, and always optional in practice

Up to eight, each with a name, a `type` (`number`, `integer`, `string`, or `boolean`), and — required, without exception — a `default`. The default is required so that a character who reaches for the tool without thinking too hard about it still gets a sensible roll rather than an error.

On numeric parameters you may set `min` and `max`. These are not suggestions: a value arriving from anywhere is clamped into that range before it is used for anything. A character feeling optimistic about a `bonus` of 900 will find it has become 10.

### `roll` — two ways to leave it to chance

**A range.** A number drawn evenly between `min` and `max` (0 and 1 if you don't say), then put through a small, fixed transformation:

```
value = raw × multiplier
value = value + offset
if round: value = the nearest whole number
```

That order matters and does not vary. Any of `min`, `max`, `multiplier`, and `offset` may be a plain number, a `{ "$param": "bonus" }` referring to one of your numeric parameters, or a `{ "$state": "path", "fallback": 0 }` drawing on persistent state (of which more below). In rolls and tests these two references are the *only* indirection — no formulas, no expressions, nothing that gets evaluated. (The one place the format keeps a small arithmetic grammar is a side effect's `value`, of which more below.) You will find this restriction generous rather than mean: it means a typo is caught when the file loads, not three hours into a scene.

**Dice.** Or simply write dice, as dice are written:

```json
{ "roll": "1d20" }
```

`3d6+2`, `2d10-1`, `d20` — all understood, modifiers and all, rolled by the same dice Quilltap rolls everywhere else. Between 2 and 1000 sides, up to 100 of them. With dice, the value your outcomes test against is the total, modifier included.

If you leave `roll` out altogether, you get a plain number between 0 and 1.

### `outcomes` — an ordered table, first match wins

Each entry has a `when`, a `message`, and a `state`.

`when` is either the word `true` — meaning "anything" — or a small object of comparisons: `gt`, `gte`, `lt`, `lte`, `eq`, `neq`, and — for text — `contains` and `ncontains`. Several in one object must *all* hold, so a middling band is written:

```json
{ "when": { "gte": 0.30, "lte": 0.60 }, "message": "…", "state": "partial" }
```

There is deliberately no "or". You will not need it: the table is read from the top and the first entry that matches wins, so ordering says everything an "or" would have said, and says it more legibly.

#### Asking about more than the number

Written bare like that, the comparisons are about the rolled value. Four other things may be asked about in the same breath, and everything you name must hold:

| | |
|---|---|
| bare `gt`, `gte`, … | the final value, after the transformation |
| `roll` | the raw number, *before* it |
| `params` | what the tool was actually called with, by parameter name |
| `metadata` | what the *character doing the rolling* carries on their fact sheet |
| `llm` | what the consulted oracle answered, if the tool keeps one — see below |

So *"the value exceeded 1, and the scale was set past 12"* is written:

```json
{ "when": { "gt": 1, "params": { "scale": { "gt": 12 } } }, "message": "…", "state": "success" }
```

`roll` earns its keep when a multiplier or an offset has carried the value some distance from what the dice actually did — a raw draw in the bottom fiftieth is a fumble whatever you have since multiplied it by, and only `roll` can say so.

`params` will compare numbers with any of the ordering four, and will compare a string or a boolean with `eq` and `neq` — `{ "params": { "material": { "eq": "brass" } } }` is a perfectly good question. It will not pretend to *order* a string: asking whether `"brass"` is greater than 1 is refused when the file loads rather than quietly never happening.

For text, equality is often too blunt an instrument, and so there is `contains` — and its opposite number, `ncontains` — which ask whether a string *holds* a substring rather than whether it *is* one. `{ "params": { "cargo": { "contains": "opium" } } }` matches a manifest of `"silk, opium, brandy"` without requiring the whole inventory verbatim. The substring must be actual text: something to look for (an empty one is refused when the file loads, on the grounds that everything contains nothing), and pointing it at a number parameter is refused the same way. On `params` and `metadata` the search is exact and case-minded, like `eq` there; the oracle's answer is treated more forgivingly, as you will see below.

A comparison may also be made against a parameter instead of a number you fixed in advance, by writing `{ "$param": "difficulty" }` where the number would go. This is the opposed check, and it is written thus:

```json
{ "when": { "gte": { "$param": "difficulty" } }, "message": "Beaten, by exactly enough.", "state": "success" }
```

The same trick serves a substring: `{ "contains": { "$param": "searchTerm" } }` looks for whatever text the caller supplied, so one input may be sought inside another — or, as below, inside an oracle's answer.

Still no formulas, still nothing evaluated — only a flat list of comparisons, all of which must hold. It is a smaller box than you might like for about a week, and a considerable comfort thereafter.

#### Asking what the character is carrying

`metadata` asks about the roller's **fact sheet** — the `metadata.json` file at the root of their character vault, holding whatever keys you troubled to write there. (See *[Editing Characters](character-editing.md)* for the file itself.) It is how one table deals differently to different people:

```json
{ "when": { "gt": 0.60, "metadata": { "hasAnsibleAccess": { "eq": true } } },
  "message": "The ansible flickers to life.", "state": "success" }
```

The same comparisons, ANDed the same way — `contains` and `ncontains` included, when the key holds text — and `{ "$param": "…" }` operands work here too — `{ "metadata": { "clearanceLevel": { "gte": { "$param": "required" } } } }` weighs what the character *has* against what the caller *asked for*, which is a great deal of drama for one line of JSON.

**And now the important part: a character who hasn't got the key.** Suppose Bertie, who has never in his life heard of an ansible, reaches for that tool. The `hasAnsibleAccess` test simply does not match — no error, no complaint, no bubble in the transcript. The row is passed over, the table reads on, and Bertie lands wherever your catch-all sends him. This is not Quilltap being lenient; it is the only sensible reading. Metadata keys are yours to invent, per character, and no file could possibly know which characters have which. A table branching on a key **must** still deal to whoever lacks it, and the `true` at the bottom of your table is precisely where you say what that means.

The same quiet non-match covers every way a sheet can decline to answer:

- **The key isn't there at all.** Including under `neq` — absence is not inequality, and `{ "faction": { "neq": "Ordo Ferrum" } }` will not match a character who has no `faction` whatsoever. `ncontains` follows the same rule: a character with no `faction` does not thereby *lack the substring* — they lack the sheet entry, which is a different thing. If you want "hasn't got it" to be *interesting*, put it in the catch-all, or order a row above it that tests something they do have.
- **The key holds a list or an object.** `knownLanguages: ["Trade Cant"]` is a perfectly good thing to keep on a sheet, but there is no sensible way to ask whether a list is greater than 3, so no comparison against it matches — `contains` included, which searches a single string, not a list's members.
- **The key holds the wrong sort of thing.** Ordering a string (`{ "faction": { "gt": 1 } }`) doesn't match; nor does comparing a number against a string. Note the contrast with `params`, where the very same mistake is refused when the file loads: there, the tool declares its own parameters, so the types are knowable and a nonsense comparison is certainly a typo. Here the file has never met the character, so it cannot be told apart from a perfectly deliberate test of a key that some characters keep as a number and others don't keep at all.
- **`null` cannot be tested.** There is no way to write `{ "eq": null }`, and that is deliberate: an empty key and an absent one both simply fail to match, which spares you having to decide which of the two you meant.

One consequence worth stating plainly: because a row only wins when its metadata tests *held*, a metadata branch is silent in the failure direction. It cannot tell you *why* a character fell through. If a table isn't behaving, check the sheet, not the tool.

#### Drawing on persistent state — `$state`

A table may also consult the chat's **persistent state** — the same JSON ledger the `state` tool keeps, and the same four-tier cascade (chat → project → group → general) described in *[Chat State](chat-state.md)*, resolved from the rolling character's own vantage. Wherever a `{ "$param": "…" }` may go — a roll bound, a comparator operand, or a parameter's default — a `$state` reference may go instead:

```json
{ "$state": "weather.wind", "fallback": 0 }
```

The **`fallback` is required**, and it earns its keep twice over. It fixes the reference's *type* when the file loads — a number in a roll field, a string for a `contains` needle — so the same load-time checks that catch a mistyped `$param` catch a mistyped `$state`. And it guarantees the reference can never fail at run time: should the path be absent, or hold a value of the wrong sort, the fallback stands in. A roll is therefore always dealable, whatever state does or does not hold.

The path is read with the same dot-and-bracket notation the `state` tool uses — `player.health`, `inventory[0].name`. (One quiet limitation, shared with the `state` tool: a key containing spaces or literal dots cannot be reached by a path, so name your state keys plainly.)

You may also render state straight into a message with `{{state.path}}`, exactly as you would `{{metadata.key}}` — and it observes the same courtesy: a path that is absent, or holds a list or an object rather than a plain value, leaves the placeholder standing in the sentence rather than swallowing it.

In **Pascal's Workbench**, the proving bench carries a **Mock state** field beside the fact sheet: type a JSON object there to stand in for the cascade while you dry-run or audit a `$state`-using table. Leave it empty and every reference simply takes its fallback — which is, after all, what a run does when there is nothing to draw on.

#### Asking an oracle

Chance settles a great many questions, but not all of them are chance's to settle. *Does the forged invitation pass inspection?* is partly a roll and partly a judgment — and for judgment, a tool may keep an oracle. Add an `llm` block beside your `roll`:

```json
"llm": {
  "prompt": "A forged invitation scored {{value}} out of 10 for craftsmanship, presented by someone whose composure is {{metadata.composure}}. In one word, YES or NO: does the doorman wave it through?",
  "errorMessage": "The doorman squints at the card, and the moment stretches on unresolved."
}
```

With that in place, every run pauses after the roll and puts the rendered `prompt` to your instance's **cheap utility model** — the same modest engine that titles your chats and files your memories, chosen in your cheap-model settings. The prompt takes every placeholder a message does — `{{value}}`, `{{roll}}`, `{{dice}}`, `{{params.…}}`, `{{metadata.…}}`, `{{state.…}}` — everything except `{{llm}}` itself, the oracle being in no position to quote an answer it has not yet given. Ask for the shape of answer your table means to test: a bare word, a number, a sentence.

What comes back is a pair — *did the oracle answer*, and *what did it say* — and the outcome table may ask about both under the `llm` subject:

```json
{ "when": { "llm": { "ok": false } },  "message": "{{llm}}",                       "state": "failure" },
{ "when": { "llm": { "eq": "YES" } },  "message": "The rope lifts. \"{{llm}},\" says the doorman.", "state": "success" },
{ "when": true,                        "message": "The doorman is unmoved.",       "state": "partial" }
```

The comparisons are forgiving in exactly the ways an oracle requires. `eq` and `neq` compare the answer trimmed and without regard to case, and forgive a trailing full stop — you asked for `YES`, and a model that says `yes.` has still said yes. `contains` and `ncontains` are the natural fit for an oracle allowed whole sentences: `{ "llm": { "contains": "west door" } }` matches *"You will find the West Door unbarred"* without demanding the sentence verbatim, the search being every bit as indifferent to case as `eq` is here. The ordering four (`gt`, `gte`, `lt`, `lte`) apply when the answer reads as a number — ask the oracle to *rate the attempt from 1 to 10* and band the table on the rating — and when the answer is not a number they simply decline the row, fail-soft, exactly as a metadata test declines for a character without the key. And `ok` is the one extra: `{ "ok": true }` holds only when the consult produced an answer, `{ "ok": false }` only when it did not.

**When the oracle is silent** — the provider is down, no cheap model is configured, the call times out, the answer comes back empty — the run does **not** fail, and no error bubble interrupts the scene. Instead the answer *becomes your `errorMessage`*, word for word, with `ok` set false, and the table deals with it like anything else. The technical reason is kept for the roll record and the logs; the fiction only ever hears what you wrote. Every table that keeps an oracle should decide what silence means — an `ok: false` row near the top, or simply trust in the catch-all, which as ever answers for everything.

A word on length: by default the answer is kept to eight thousand characters. If your oracle is the laconic sort — a verdict, a rating — or the opposite — a consult whose answer *is* the deliverable, a generated document at full length — set `maxOutput` in the block (`"maxOutput": 50000`, up to one hundred thousand) and the answer is trimmed to *that* instead, with the call's token budget scaled to match. Your `errorMessage` is never subject to it; those are your words, kept whole.

Two practicalities. First, the consult costs one cheap-model call per run — real money on a metered provider, though of the smallest denomination, and rather more of it if you set a generous `maxOutput` and the oracle uses the room. Second, the models *playing* in your scene are told only that the tool consults an oracle; the prompt itself is never shown to them, and `revealOdds: false` hides the branching along with everything else. Quilltap insists, and refuses to load a tool that ends any other way. The reason is that a table with a gap in it is a table that will one day produce a roll matching nothing at all, at the worst possible moment, in front of everybody. Requiring a catch-all at the end makes that impossible rather than merely unlikely. For the same reason, a `true` anywhere *except* the end is refused too — everything below it could never be reached, which is never what anyone meant.

`state` is one of `success`, `partial`, `failure`, or `info`. It tints Pascal's announcement accordingly — the bar above the outcome carries the same coloured edge and the same coloured mark beside Pascal's name, so a reader scrolling past a long scene can tell how a roll went without stopping to read it. The four states wear the same colours here as they do on the outcome rows in Pascal's Workbench and in the proving bench's preview. You never write any styling yourself.

### Putting things in the message

Six things may be dropped into a `message`:

| | |
|---|---|
| `{{value}}` | the final number, after the transformation |
| `{{roll}}` | the raw number, before it |
| `{{dice}}` | the dice breakdown, e.g. `3d6+2: [4, 2, 6] + 2 = 14` (empty if you're not rolling dice) |
| `{{params.bonus}}` | a parameter, as it was actually used — after defaulting and clamping |
| `{{metadata.faction}}` | a key from the roller's fact sheet |
| `{{state.weather.wind}}` | a path into persistent state (the four-tier cascade) |
| `{{llm}}` | what the oracle answered — or, after a failed consult, your `errorMessage`, word for word |

Anything else in braces is left exactly as you typed it — as is a `{{metadata.…}}` naming a key the roller hasn't got, or one holding a list or an object. The placeholder stands there in the sentence looking conspicuous, which is the point: it tells you exactly which key is missing, where an empty space would merely leave you puzzled. If a message leans on `{{metadata.faction}}`, gate its row on `faction` and let the catch-all speak for the factionless.

```json
{
  "$schema": "/schemas/qtap-custom-tool.schema.json",
  "name": "measure_hawking_radiation",
  "description": "Take a Hawking-radiation reading from the detector.",
  "parameters": {
    "baseline": { "type": "number", "default": 0,       "description": "Lowest plausible reading." },
    "ceiling":  { "type": "number", "default": 1000000, "description": "Highest plausible reading." }
  },
  "roll": { "min": { "$param": "baseline" }, "max": { "$param": "ceiling" }, "round": true },
  "outcomes": [
    { "when": true, "message": "The detector reads {{value}} µK.", "state": "info" }
  ]
}
```

And a tool that rolls honest dice:

```json
{
  "$schema": "/schemas/qtap-custom-tool.schema.json",
  "name": "saving_throw",
  "description": "Roll a d20 saving throw against DC 12.",
  "roll": "1d20",
  "outcomes": [
    { "when": { "gte": 12 }, "message": "Saved! ({{dice}})",  "state": "success" },
    { "when": true,          "message": "Failed. ({{dice}})", "state": "failure" }
  ]
}
```

## Naming each run — `chipLabel`

The Salon labels every outcome with the tool that produced it — the chip above the bubble reads *Force the Lock*, and so does the bold heading of Pascal's announcement. For most tools that is exactly right. But a tool that does many *different* things per run — a dispatcher, a generator, a drawer of many things — wants each run named for what it did, not merely for the machinery that did it.

Give it a `chipLabel`: a small template, rendered *after* the outcome is chosen, with every placeholder a message takes:

```json
{ "chipLabel": "Agent lambda — {{params.label}}" }
```

One string then labels both the chip and the announcement heading, so the transcript and the chip can never disagree. Leave it out (or let it render blank) and the title labels the chip, as it always has.

Your characters never see the template — like `title`, it is display furniture, not vocabulary. If you want the *model* to name the run, do it the honest way: declare a string parameter whose `description` invites a short label, then quote it —

```json
{
  "parameters": {
    "label": { "type": "string", "default": "", "description": "A short human label for this run — who or what it concerns." }
  },
  "chipLabel": "Agent lambda — {{params.label}}"
}
```

## Recording consequences — side effects

A roll can now leave a mark. A tool may carry an `effects` array — up to sixteen entries, applied in order after the table has dealt — each writing one value into the story's **persistent state** or onto the rolling character's own **fact sheet**. The third failed lockpick really can break the pick, and nobody has to *ask* the model to record it — the write happens on the server, as part of the roll, entirely beyond a model's power to fudge:

```json
"effects": [
  { "when": { "outcome": { "eq": "failure" } }, "target": "state.lockpicking.failures",
    "value": "{{state.lockpicking.failures}} + 1" },
  { "when": { "outcome": { "eq": "failure" } , "gte": 3 }, "target": "metadata.lockpick",
    "value": "'broken pick'" }
]
```

Each effect has three parts:

- **`when`** — optional; omit it and the effect fires on every run. It takes everything an outcome's `when` takes, plus one subject only an effect can ask about: `outcome`, the winning row's state — `{ "outcome": { "eq": "failure" } }` fires only on a failure, `{ "neq": "success" }` on anything short of one.
- **`target`** — where to write. `state.<path>` reaches into the persistent-state cascade, and the write lands **at the tier where the key already lives** — a counter kept in project state stays in project state — defaulting to the chat (the most local ledger) for a key found nowhere. `metadata.<key>` writes onto the rolling character's `metadata.json`; the part after `metadata.` is taken whole, dots and all. Keys beginning with an underscore are yours alone, and no tool may write them — see *[Chat State](chat-state.md)*.
- **`value`** — what to write. A JSON number or `true`/`false` is stored as it stands. A JSON **string is always an expression**: a little closed arithmetic of `+ − × ÷`, parentheses, quoted text, and the same `{{…}}` references a message takes — `"{{value}} * 2"`, `"'rolled ' + {{dice}}"`.

**The one trap, stated in bold so you meet it here and not in a rejection badge: literal prose must be quoted *inside* the expression.**

```json
{ "target": "metadata.lockpick", "value": "'broken pick'" }     ✓
{ "target": "metadata.lockpick", "value": "broken pick" }       ✗ refused when the file loads
```

The bare form is two words where the grammar expects an expression, and the file is refused on the spot — loudly, when the file loads, never silently mid-scene.

A few civilities, all in the fail-soft family you know from `metadata`: an expression that cannot be evaluated at run time (a division by zero, a `{{metadata.key}}` the roller hasn't got) skips *that one effect* and never sinks the roll; a run with no character attached skips the `metadata.` writes (a run nobody made writes to nobody's sheet — which includes an unattributed roll of your own from the composer); and everything that *was* written rides in the roll's permanent record, previous value and all. The oracle's answer may be written too — `"value": "{{llm}}"` files the consult's text — but it is never treated as a number; route numeric judgments through the outcome table instead.

Your characters are told a tool records side effects and *where* it writes (the targets are vocabulary, like a parameter's name) — never the values or the conditions, and under `revealOdds: false` not even the targets. The run dialog names them too, under **What this tool can quote**. And on the Workbench, the proving bench shows every would-be write as a dry run — `→ state.lockpicking.failures = 3 (would write)` — while applying, as ever, nothing at all.

## Which tool wins: the matter of tiers

The same tool name may reasonably exist in several stores, and Quilltap resolves the question by proximity. Nearest to the character wins:

**their own vault → another participant's vault → a group store → a project store → Quilltap General**

So an `unlock` in a character's own vault quietly supersedes the project's `unlock`, for that character only. This is how one gives a locksmith better odds than everybody else without anybody else noticing.

To switch off an inherited tool rather than replace it, define it nearer and mark it `"disabled": true`:

```json
{ "name": "unlock", "description": "Not for this one.", "disabled": true,
  "outcomes": [{ "when": true, "message": "-", "state": "info" }] }
```

The name is then suppressed at that tier and every tier beyond it.

If two stores at the *same* distance both define a name, Quilltap picks one deterministically and notes the fact — but this is a coin-toss you did not intend to write, and is worth tidying up.

## Who may reach for it at all

A tier decides *which* `unlock` a character gets. Sometimes the question is prior to that: whether this character has any business being offered the tool in the first place. An automaton with a programming port may reprogram things; the parlourmaid, whatever her other gifts, may not, and she should not be handed the option and left to discover it politely refuses her.

Two optional keys settle it, and only one of them may appear in a file:

```json
{
  "name": "reprogram",
  "description": "Rewrite the instructions of a mechanism you can reach.",
  "availableWhen": { "metadata": { "toolAbilities": { "contains": "programmable" } } },
  "outcomes": [ … ]
}
```

- **`availableWhen`** — offer this tool *only* to a character whose fact sheet passes every test in it.
- **`withheldWhen`** — the mirror: keep it *from* a character whose sheet passes every test in it.

The tests are written exactly as an outcome's `metadata` clause is, and several of them AND together. What is different is *when* they are asked: before the deal, before there is a roll or a parameter or an oracle's answer to speak of. That is why the subject can only ever be `metadata` — a character's fact sheet is the one thing they carry into the room — and why the values compared against must be plain literals rather than `{ "$param": … }` or `{ "$state": … }` references. There is nothing yet for those to refer to.

**A withheld tool is not merely greyed out. It is not there.** The model is never told it exists, the composer's run dialog does not list it, and `run_custom` will not run it if the model asks for it by name. (The gate is asked of each character severally, so a tool withheld from *your* character but offered to another still appears in your own dialog — labelled with the character it would run as. See *Whose fact sheet* below.) There is nothing to be tempted by, which is the humane arrangement: a tool a character can see and cannot use is an invitation to spend a turn being refused.

**A key the character lacks never matches** — the same fail-soft rule the outcome table follows. Read through the gate, this cuts opposite ways for the two clauses, which is precisely why both exist:

| The character's sheet | `availableWhen` | `withheldWhen` |
| --- | --- | --- |
| passes the test | offered | withheld |
| fails the test | withheld | offered |
| has no such key at all | withheld | offered |
| has no sheet whatever | withheld | offered |

So `availableWhen` is the cautious key — a stranger with no fact sheet gets nothing — and `withheldWhen` is the permissive one, which excludes only those you have positively identified.

**A gated-out tool does not claim its name**, and this is quietly the most useful thing about the arrangement. Should a character's own vault hold a clever `unlock` gated to picklock-carrying characters, and Quilltap General hold a plain one gated to nobody, then the picklock carries the clever version and everyone else falls through to the plain one — same name, same call, different contrivance. Contrast `disabled`, which suppresses a name outright at its tier and beyond. (You may combine them, and it reads as it says: a `disabled` definition with a `withheldWhen` is a tombstone that only tombstones for the characters it names.)

You need not write any of this by hand. Pascal's Workbench puts it at the top of the recipe as **Who may reach for it** — *Anyone*, *Only show if…*, or *Do not show if…* — and its proving bench will tell you whether the fact sheet on the bench would have been dealt the tool at all.

## Rolling in secret

Some rolls should not be public knowledge. Set `"defaultVisibility": "whisper"` and Pascal will whisper the outcome to the character who rolled, and to nobody else — the other characters' contexts simply do not contain it. A character may also whisper a single roll by asking privately, and you may tick **Roll privately** in the run dialog, which hides the outcome from every character at once.

**You always see it.** Whoever the whisper is for, it renders for you. This establishment has one proprietor, and there is nothing to be gained by keeping you in the dark about your own dice.

## On keeping the odds to yourself

Set `"revealOdds": false` and a character is told only the tool's name, its description, and its parameters. The roll spec and the outcome table are withheld — they know they may attempt the lock; they do not know what it takes.

**Fact sheets are never enumerated to anybody, whatever `revealOdds` says.** A character is told, in general terms, that a table may consult their metadata; they are never handed a list of their keys, nor anyone else's, nor the values. Those belong to each character severally, and printing them into every participant's tool listing would be a poor way to keep a secret. Do note the other half of this, though: when `revealOdds` is left at its default of `true`, that table's `when` clauses are shown — *including* its metadata clauses. A character reading `your hasAnsibleAccess = true → success` has learned what the lock wants, if not whether they have it. If the condition itself is the secret, set `revealOdds: false`.

**One honest caveat, which you should read before relying on this.** `revealOdds` hides the odds from the *tool listing*. It does not make the file secret. A `.tool.json` is an ordinary document in an ordinary store, and a character with read access to that store can simply open it and read the odds for themselves, as they could any other document.

If the odds must genuinely be secret, put the file in a store the character cannot read. Quilltap's per-document and per-store permissions already do this properly; `revealOdds` is a courtesy, not a lock.

## Rolling one yourself

When a scene has any custom tools, a button appears in the composer's left-hand gutter. It opens a proper dialog — one you may dismiss with Escape, with the backdrop, or with **Cancel**, and which does not close itself the moment your attention wanders.

It arrives in two acts. First the table: every tool available to this scene, with its description and the file it came from, and a search box once there are more than a handful. Choose one and the dialog's contents give way to that tool's own form — its parameters laid out with their descriptions and their declared bounds, a **Roll privately** tick, and a Run button. **Choose another tool** takes you back to the table, as often as you like.

It remembers. Close the dialog and reopen it, and you are back on the tool you last used, with the figures you last set still in their boxes. This is deliberate: the same roll is usually wanted twice, and re-typing it is a tax on the second one.

### Presets — hands set aside for later

Memory of the last hand is all very well, but some tools are run the same three ways for a season at a stretch, and for those the dialog offers **presets**. Beneath a tool's parameters — provided it has any, and provided the roll runs as a character with a vault to keep things in — you will find a modest row of conveniences: a dropdown of hands set aside earlier, a box for naming a new one, **Save preset**, and **Reset to defaults**.

**Save preset** files the figures currently in the boxes under the name you give, as a small JSON document in the running character's vault: `Tools/{tool}.{preset}.settings.json`, sitting companionably beside the tool definitions themselves. It is an ordinary file — you may read it, edit it, or discard it from [The Scriptorium](scriptorium.md) like any other, and it travels with the character wherever the vault goes. Saving under a name already taken quietly replaces the earlier hand, which is usually what you meant.

The name itself is kept respectable by force: lowercase letters, digits, hyphens, and underscores, and nothing else — no spaces, no dots, and certainly no directory separators. The box simply declines to accept anything the filename could not carry.

Choosing a preset from the dropdown deals it back into the form. The binding is deliberately loose: each entry in the file lands in the parameter of the same name, entries naming no current parameter are ignored without comment, and parameters the file does not mention keep whatever they held. A preset saved against an older draft of a tool therefore ages gracefully rather than refusing to load. **Reset to defaults** returns every box to what the definition itself prescribes, as though you had opened the tool for the first time.

### What a tool can quote

At the foot of the dialog is **What this tool can quote** — the placeholders *this particular tool* actually uses when Pascal writes the outcome.

The emphasis is on *actually*. Nothing is listed because the format allows it: a tool that rolls dice but never writes `{{dice}}` is not offered `{{dice}}`, and a parameter you are filling in appears here only if some message or prompt quotes it back. What you get is one entry for each of `{{value}}`, `{{roll}}`, `{{dice}}`, and `{{llm}}` the tool genuinely writes, one per parameter it genuinely quotes, and — the useful part — one for every metadata key and state path the definition genuinely reads, named. If a table branches on `hasAnsibleAccess`, the dialog says so, and you need not go opening files to find out what the thing wants to know about your character. A tool that quotes nothing gets no panel at all.

**These are the author's to place, not yours to type.** The placeholders belong to the tool's own outcome messages and oracle prompt, which are written on Pascal's Workbench. What you type into the form above is sent exactly as written — braces and all — so `{{metadata.rank}}` in a parameter box is the literal text `{{metadata.rank}}`, not a substitution waiting to happen.

The wrench beside any tool opens it on the Workbench, should reading the file settle the question faster than reading about it.

Rolling this way posts one thing: the outcome, exactly as it would have appeared had a character rolled it themselves. Pascal is a croupier and not a raconteur — he lays out the result and says nothing else about it.

**Which means nothing records that it was you.** Should you nudge a parameter before rolling, that is between you and the wheel: the transcript does not note that the operator reached for the tool, nor what figures you chose, and no character can read what you did to arrange the odds. They see what befell. This seems to us the correct division of information.

Should a tool be defined differently for different characters, you'll see each variant listed with the character's name beside it, and running it rolls that character's version — fact sheet and all, so a metadata-gated table deals to that character exactly as it would have done had they reached for it themselves.

**Whose fact sheet, when the tool is everyone's.** A tool is listed *once* when it resolves to the same file for everyone at the table — and metadata lives on the character, not in the file, so a metadata-gated tool that everyone shares is listed exactly that way. Running it still rolls as *somebody*, and that somebody is you: the character you are playing in this scene, or the one you are presently typing as when you are playing several. Your sheet is the one the table tests, and your character's groups are the ones a `$state` reference resolves through.

**And when it cannot be you, the row says so.** Two cases: a room in which you are playing nobody at all, and a tool whose gate your own character did not pass. Neither leaves anything to run as except another participant, so rather than borrow their sheet in silence the listing puts their name beside the tool — *as Friday* — exactly as it does for a tool defined differently per character. The pick is still not yours to make, but you can see it before you commit to it; where it matters, have that character reach for the tool in the fiction instead of reaching for it yourself from the gutter.

## When something is wrong with a file

A tool that cannot be loaded is simply left out of the roster, and appears under **Would not read** at the foot of the run dialog's table, with a badge explaining why (click it to open the file on the Workbench in repair mode). It is never half-loaded and never guessed at. Common causes: the JSON doesn't parse; the last outcome isn't `true`; a `$param` names a parameter that doesn't exist, or one that isn't a number; an outcome asks after a parameter you never declared, or asks whether a string is greater than a number; the dice notation has a typo; two files in the same store claim the same name.

Misspelled keys are refused too, rather than ignored. A `when` containing `gt3` is not a `when` with an eccentric extra key in it; it is a comparison you meant to make and didn't, and had Quilltap shrugged and loaded the file, that outcome would have sat in your table for months looking like a branch that simply never comes up.

If a roll fails while it's actually running — a bound that ended up above its own ceiling, say — **Prospero** reports it, not Pascal. Pascal announces outcomes, and only outcomes. A roll that didn't happen doesn't get one.

## Limits

Sixty-four tools per scene, eight parameters and thirty-two outcomes per tool, a thousand characters per message, five hundred per description, eighty per title. An oracle's prompt runs to four thousand characters and its error line to a thousand; its answer is trimmed to eight thousand before anything tests or prints it, unless the tool's own `maxOutput` says otherwise — anywhere from one character to a hundred thousand, with the call's token budget following along. If a scene somehow exceeds the roster limit, the surplus is dropped and said so out loud — never silently.

## Turning it off

The **Custom tools** setting on Settings → Chat governs the whole arrangement. Switched off, `run_custom` is never offered to any model and the gutter button goes away. Your files stay exactly where they are.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this setting:

`help_navigate(url: "/settings?tab=chat&section=custom-tools")`

## Related Settings

- **[Pascal's Workbench](pascals-workbench.md)** — the visual editor, library, and proving bench at `/custom-tools`.
- **Settings → Chat → Automation** — auto-detection of dice rolls (`2d6`, `3d6+2`) written plainly in a message.
- **The Scriptorium** — the document stores your `Tools/` folders live in.
