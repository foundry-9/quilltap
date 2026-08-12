---
url: /settings?tab=chat&section=autonomous-rooms
---

# Autonomous Rooms — Private Character-to-Character Salons

There are evenings when the proceedings ought, by all rights, to continue without one's stewardship — when the characters in residence have business between themselves that does not require, and indeed would suffer from, the host's presence at the fire. For these occasions the Estate offers the **Autonomous Room**: a private salon whose participants are characters alone, whose budget is set by the householder in advance, and whose proceedings unfold either on demand or on a faithful nightly schedule, while one is otherwise engaged (with sleep, with breakfast, with the impertinent business of the day).

Autonomous rooms preserve the full panoply of one's ordinary salon — memories, project context, document stores, wardrobes, the Concierge's careful eye — but with no human composer in the room. They produce a transcript, they file memories, they speak in characters' own voices, and they conclude themselves cleanly when their allotted resources run dry.

## What an autonomous room is, and isn't

An autonomous room is, technically, an ordinary chat with the `autonomous` discriminator quietly affixed to its lapel. It uses the same speaker-selection that drives multi-character salons, the same per-turn prompt assembly, the same tool dispatch and Concierge classification — but the loop runs without waiting for the householder to type. The character whose turn it is responds, the next is selected, and so on, until one of the budgets is exhausted or a stop condition is reached.

As the evening lengthens, the Librarian keeps a running précis of all that has passed, folding the older exchanges into a faithful summary so the characters need not re-read the whole night's transcript with every remark. This thrift now keeps proper pace in an autonomous room — a long nightly run stays coherent and does not quietly squander its token allowance re-reading itself, as once it could. (A character who wishes to revisit some particular earlier passage in full may always call for it with the reading tools.)

An autonomous room is **not** a free-running improvisation. Every run is bounded. Every transcript is inspectable. Every memory is correctly attributed — auto-extracted memories from autonomous rooms carry an explicit `autonomous_room` provenance so the householder can always tell what was witnessed in person and what was merely overheard at a distance.

## Budgets — every bottle decanted, accounted for

A run ends gracefully on the first of the following budgets to be reached:

- **Turns.** A hard cap on the number of character responses in a single run.
- **Tokens (per run).** A hard cap on the cumulative input + output tokens spent across all turns of a single run — the characters' own deliberations and any tools they take up mid-turn. The Estate's quiet background staff (the memoirist who keeps the Commonplace Book, the scene-watcher, the Concierge at the door) keep their own ledgers, and their expenditures are not charged against this purse. Whether a prompt-cache hit counts against this cap is now the householder's to decide, by the tickbox **Count only the dear tokens**, set just beneath the budget fields:
  - **Ticked (the default).** Where a provider extends the courtesy of a prompt cache, the portion of each prompt it serves back from that cache — having cost a pittance, or nothing at all — is struck from the tally before it reaches this ledger; only the freshly-read input you truly pay full freight for, together with the newly-written output, are counted against the cap. This is the thrifty reckoning, charging the purse only for what is genuinely dear.
  - **Unticked.** Every token is counted against the cap, cached and uncached alike — the older, plainer reckoning, in which the ledger makes no allowance for the cache's kindness. Choose this if you would sooner have the cap track raw throughput than billable expense.
- **Wall-clock duration.** A maximum elapsed time, in minutes, after which the run is brought to a polite stop.
- **Estimated spend (USD, optional).** A convenience cap evaluated against the running cost of the LLM calls.
- **Daily user-token budget.** A house-level cap that applies across every autonomous room belonging to a single account, evaluated against the instance's local-time midnight. When this cap is reached, every active room pauses; they resume of their own accord after the next midnight. The same courtesy applies here: cached prompt tokens are struck from this tally as well.

Reaching a per-run cap ends that particular run cleanly with `budgetExhausted` status. Reaching the daily user cap pauses the room (`paused` status); the scheduler will resume it the next day. The household may, of course, intervene at any time with **Pause**, **Resume**, or **Stop** controls.

A word on how a **token allowance now paces the evening.** Where once each turn was furnished with as much of the night's history as its character's chosen model could be persuaded to hold — and a sufficiently capacious model could, on a single turn, all but drain a modest purse — the Estate now portions the *remaining* token allowance across the turns the run still has before it, and trims each turn's recollection to its fair share. A room granted a turn budget alongside its token one divides the purse across the turns remaining; a room granted only a token budget aims, by default, to see some six turns through. No instruction is needed to invoke this thrift: any room bearing a per-run token cap is paced thus of its own accord, while rooms left uncapped — and every ordinary salon — carry on precisely as before. (A sensible floor is kept beneath the portioning, that even a nearly-spent run may furnish its final turn with enough of the night to speak coherently, rather than a starved scrap.)

A small but consequential distinction between **Resume** and **Start**, lest the household be startled. **Resume** picks a *paused* room up precisely where it set itself down: the very same run carries on, its turn and token tallies continue climbing from where they paused, and no fresh "the run has begun" fanfare is sounded — the conversation simply resumes mid-breath. The minutes spent paused are not charged against any wall-clock budget; only the time actually spent conversing counts. **Start**, by contrast, opens a *brand-new* run with its tallies reset to nought, and is what one reaches for with a room that is idle, stopped, or has exhausted its budget. (A room whose budget is spent cannot meaningfully continue, so resuming it would only begin anew in any case.)

Should the Estate suffer an abrupt outage — the power cut, the server felled mid-sentence — a run caught in motion is not lost. On the next startup the room is set gently to *paused*, its tallies and transcript intact, awaiting your **Resume** to carry on as though nothing had happened; the dark interval of the outage is not charged against any time budget. (A scheduled room left thus paused will still keep its next appointment on the clock, beginning afresh then if you have not resumed it in the meantime.)

And should a single turn prove impossible to commit to the ledger — some rare disagreement between a character's handiwork and the Estate's filing system — that turn is struck out whole rather than left half-written, and the room is set gently to *paused*, the cause noted in its status, awaiting your **Resume** rather than freezing mid-sentence. (As with an outage, a scheduled room so paused still keeps its next appointment, beginning afresh then if you have not resumed it.)

## The Host calls the hour — pacing announcements

A conversation that does not know when the hour grows late is apt to be cut off mid-flourish, its finest sentiment left forever unsaid. So that the assembled company may pace themselves and bring matters to a graceful close, **the Host marks two moments aloud** as a run draws on toward its limit:

- **The midpoint.** When the run has spent half of whatever budget binds it, the Host raps a glass and observes that the gathering has reached its halfway mark — *there is room yet, but let the conversation begin to find its way toward what matters most.*
- **The near-end.** When but a tenth of the budget remains, the Host consults a pocket-watch and warns that the gathering must soon close — *say now what most needs saying, and bring your threads to a graceful rest.*

The Host measures these moments against the **binding** budget — whichever of turns, tokens, wall-clock time, or the daily user-token allowance stands closest to exhaustion, and so will halt the run first — and phrases the announcement to suit it ("our time together," "the exchanges allotted to us," "the gathering's allowance," "the day's allowance"). Each is sounded but once per run.

A nicety of manners attends the **daily user-token cap**, for it does not *end* a run so much as set the room down for the night, to resume of its own accord once the allowance comes round again. So when the daily allowance is the binding budget, the Host's near-end announcement is framed as a *pause* rather than a farewell: the company are told to finish what most needs saying *for now*, with the assurance that they shall reconvene — not that the gathering closes for good. They are asked to wrap up the present scene all the same.

And what of the evening that ends too suddenly for any warning at all? A single lavish turn can spend the budget's last tenth and overrun it in one breath, so that the near-end bell never has the chance to ring. For just such occasions the Host keeps a final courtesy in reserve: when a run reaches its budget *without* the near-end warning ever having sounded, the Host rises, allows that the company has run past its allowance, and grants **one last turn** — a single grace round, over budget though it be — so that no guest is cut off mid-thought. (Should the near-end warning have sounded earlier in the run, no grace turn is given; the company had their notice, and the run closes on schedule.)

Only the **estimated-spend cap** is left out of this reckoning entirely: it is a convenience tally rather than a hard stop on the loop, and so is not counted toward the milestones.

A word on who hears what. As with every announcement from the Estate's staff, the householder watching the transcript hears the Host in full voice. The characters themselves, in a room where any participant keeps the staff opaque, receive instead a plain, unattributed note to the same effect — so the gentle pressure to wrap up reaches them whether or not they may perceive the Host by name.

## Scheduling — cron, plain and proper

A scheduled autonomous room runs on a five-field cron expression and a **freshness window** — the maximum interval after a scheduled fire time during which a late catch-up is still considered timely. If the server was unavailable at the scheduled moment but comes back within the freshness window, the run will start as soon as the scheduler ticks. Beyond the freshness window the missed slot is recorded and skipped; the next scheduled run is computed forward from the cron.

Default freshness window is **12 hours**; per-room overrides are permitted. A manual start that happens close enough to the next scheduled slot (i.e., within that window) **consumes** that slot — the next scheduled run advances past it. This prevents a 4 AM scheduled conversation from firing on top of an evening conversation the household has just reviewed.

## Creating a room

From the Salon, click **New Autonomous Room** (next to *New Chat*); from the homepage, click **Start Autonomous Room** in the quick-actions row. Either route lands one on the ordinary new-chat form, with the **Make this an autonomous room** toggle already flipped on.

Two distinctions follow from that flip:

- The *Play As* selection is removed — autonomous rooms have no user character. (The reverse holds on an ordinary new-chat form: the instant you set a *Play As* character to take the user's chair, the **Make this an autonomous room** toggle greys itself out, since a room with a human at the table cannot run itself. Return that character to LLM control to restore the option.)
- The right-hand card swaps **Reality Injection Mode** for **Autonomous Room**, where the household sets the cron expression (optional), the freshness window, the four budget caps (turns, tokens, wall-clock minutes, USD), whether the token cap counts only the dear (non-cached) tokens, the per-room visibility, and whether destructive tools are pre-authorized.

Selection rules: at least two LLM-controlled characters, no user-controlled participants, every LLM character must have a connection profile. On submit, an **ad-hoc room** (one without a cron expression) takes itself in hand at once: the first run begins immediately, in the spirit of the householder who set it on its way and then turned to other matters. A **scheduled room** (one with a cron expression) waits, idle, for its first scheduled tick. Either kind of room appears in the **Autonomous Rooms** management list under the Chat tab, where **Pause**, **Resume**, and **Stop** are at one's disposal at all hours.

## Editing a room — the same dials, turned after the fact

A room's standing arrangements need not be fixed at its christening. The very card that sets a room's schedule, budgets, visibility, and tool authorizations may be summoned again at any hour to **revise** them, by way of the **Edit Enclave** dialog. ("Enclave" is the Estate's fond name for an autonomous room; the dialog wears it on its brass plate.) Two bell-pulls ring for the same butler:

- From **Data & System → Chat → Scheduled Autonomous Rooms**, each room in the management list now carries an **Edit** button beside its Pause and Stop.
- From within a room's own transcript, the chat sidebar's **Organize** card offers an **Edit Enclave** button — shown only when the chat at hand is, in fact, an autonomous room.

The dialog presents the familiar settings — the room's title, the cron expression and freshness window, the four budget caps, the dear-tokens tickbox, the visibility, and the destructive-tool authorization — filled in with the room's present arrangements. Adjust whichever you please and click **Save Changes**.

Two courtesies are worth noting:

- **Edits take effect at once.** A revision lands on the room directly, and a run *already in motion* honors the new budget caps, the new dear-tokens reckoning, and the new tool authorization on its very next turn — there is no need to stop and restart the gathering. Visibility likewise updates the moment the Salon list is next consulted. The one caveat the thrifty householder should keep in mind: should you tighten a cap *below what the present run has already spent*, that run will conclude itself, with all due grace, on its next turn — exactly as it would had the cap been set so from the first.
- **A title set here is a title kept.** Naming a room through this dialog pins the name; the Estate's automatic titler, which otherwise renames a room as its conversation finds its subject, will thereafter leave your chosen title undisturbed.

Revising the cron expression recomputes the next appointment straightaway; clearing it altogether returns the room to manual-only, to be started by hand. An expression the clockwork cannot parse is refused outright, and the room's standing schedule is left exactly as it was.

Note that the dialog governs a room's *settings* — its schedule, its purse, its visibility, its tools. To change *who* is in the room, or which model each character speaks through, attend instead to the **Participants** card in the same chat sidebar.

## Tools — what characters may, and may not, deliberately undo

In an autonomous room, characters may invoke any tool they would ordinarily be permitted to invoke, with one narrowing: tools that **mutate** or **destroy** files on disk — at present, vault-file deletion — are disabled unless the room's owner has pre-authorized them at room creation. The rationale is straightforward: the householder is not present to confirm; the conservative default is to refuse.

The user-level **destructive-tool policy** (`/settings?tab=chat`, *Autonomous Rooms* → *Destructive tools*) acts as a ceiling. Setting it to **Always refuse** disables the destructive set across every autonomous room regardless of any permissive per-room flag. Setting it to **Opt in per room** honors the per-room authorization, when granted.

A character invoking the image-generation tool deliberately is unaffected — that path runs as in any chat. What is suppressed in autonomous rooms is the *automatic* image pipelines: the Lantern's story-background trigger does not fire, and wardrobe changes do not regenerate avatars. (Wardrobe state still advances. Only the image generation is skipped.)

## A glance at the mantelpiece — the toolbar badges

Just to the left of the background-job-queue indicators in the page toolbar, the Estate now keeps a small row of badges, one per autonomous room currently *idle*, *paused*, or *running*. Each badge is a study in compression: the chat's title is abbreviated to its initial letters (a chat called *Chat With Amy and Friday* becomes `CWAaF`), and if the room belongs to a project, that project is likewise initialed and set before a colon (*Quilltap Plans* → `QP:CWAaF`).

Hard upon the abbreviation sits a single readout of how much budget remains. The Estate picks one to display, in order: tokens, then messages, then time. Tokens are abbreviated with proper 1024-based mathematics (`936K`, `1.5M`); message counts are written out plain; time counts down in `MM:SS`, refreshing each second for rooms actually running. A small play button starts or resumes a stilled room; a small pause button quiets one in motion. These controls answer at once: the badge changes its colours and its emblem the very instant you press, without the discourtesy of leaving you to wonder whether your wish was heard — even should a turn in some other room happen to be mid-sentence at the time. (The same promptness attends the **Start**, **Resume**, and **Pause** controls in the management list.) A click anywhere *but* on the button opens the transcript.

A running room wears green; a paused or idle one wears slate. Hover, and the tooltip discloses the full project name, the full chat title, the precise used-versus-total of whichever budget is binding, and the current status. Rooms in *stopped*, *budget-exhausted*, or *error* states do not appear in the toolbar; they remain reviewable in the management list.

## Visibility — discoverable, not surfaced

Autonomous-room transcripts are by default **hidden from the main Salon chat list**. They are findable, exportable as `.qtap` archives, and reviewable from a dedicated **Autonomous Rooms** subsection under Data & System settings. Other households may choose a more open default at the Chat-tab setting:

- **Owner only** (default) — autonomous-room chats are hidden from the main Salon list; surface from the Autonomous Rooms subsection of Data & System.
- **Household** — visible to authorized household members per the existing chat-sharing rules.
- **Open** — visible in the main Salon chat list alongside ordinary chats.

A per-room override is also offered at room creation and lives on the chat itself.

## The Concierge in an autonomous room

The Concierge continues to do its work — classification, rerouting, refusal — exactly as in an ordinary chat. The one adjustment is that, in the absence of a householder to address, the Concierge's "ask the operator to confirm" path is treated as a refusal. The character's turn ends with the refusal recorded; the loop advances to the next speaker. Sustained refusals on the same speaker will trip the loop-detection rule and bring the run to an error stop, exactly as designed.

## Memories — provenance kept honest

Every memory auto-extracted from an autonomous room is written with `witnessedContext: 'autonomous_room'`. The extraction prompts are also adjusted: characters may form memories about their shared experience freely, but memories that name or address the user — who, after all, wasn't there — are explicitly out of scope.

This dual safeguard (a prompt-level instruction *and* a structural provenance flag) means later audits can re-check what was extracted from autonomous rooms without relying on the conversational content alone.

## Settings reference

- `/settings?tab=chat&section=autonomous-rooms` — user-level defaults:
  - **Daily token budget** (left empty by default — no daily allowance is imposed until the householder sets one)
  - **Default freshness window** (default 12h)
  - **Default visibility** (Owner only / Household / Open)
  - **Destructive-tool policy** (Always refuse / Opt in per room)
- `/settings?tab=chat&section=autonomous-room-schedules` — autonomous-room management list:
  - Per-room run-state badge, last run, next run, run budgets consumed
  - **Pause**, **Resume**, **Stop**, and **Edit** controls
  - Direct link to the chat transcript and `.qtap` export
  - Cron-scheduled rooms always appear here; ad-hoc rooms appear while they are idle, running, or paused, and fall off the list once stopped, errored, or budget-exhausted

## In-Chat Navigation

```
help_navigate(url: "/settings?tab=chat&section=autonomous-rooms")
```

```
help_navigate(url: "/settings?tab=chat&section=autonomous-room-schedules")
```

## Related Pages

- [Nothing to Add — Turn Skipping](turn-skipping.md) — Characters may pass a turn; in a run, a pass still consumes one turn of the budget
