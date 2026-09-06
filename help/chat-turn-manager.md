---
url: /salon/:id
---

# Turn Manager

> **[Open this page in Quilltap](/salon)**

The Turn Manager controls who speaks next in multi-character chats. It ensures conversations flow naturally, with each character getting opportunities to contribute while preventing any single character from dominating.

## What Is the Turn Manager?

The Turn Manager is the system that:

- **Selects Speakers** — Determines which character speaks next
- **Tracks Rounds** — Knows who has spoken since your last message
- **Manages Fairness** — Ensures balanced participation using talkativeness weights
- **Handles Queues** — Processes manual queue requests first
- **Signals Your Turn** — Tells you when all characters have spoken

## How Turn Cycles Work

### The Basic Cycle

A complete turn cycle looks like this:

1. **You Send a Message**
   - Your message triggers the auto-response phase
   - All active characters become eligible to speak

2. **Characters Take Turns**
   - Each character speaks once per cycle
   - Turn Manager selects who goes next
   - Characters speak one at a time

3. **Cycle Completes**
   - When all active characters have spoken once
   - Turn indicator shows "Your turn"
   - You can send your next message

4. **Repeat**
   - Your next message starts a new cycle

### Example Cycle

With three characters (Alice, Bob, Carol):

1. You: "Hello everyone!"
2. Alice: "Hi there!" (selected first)
3. Carol: "Nice to meet you!" (selected second)
4. Bob: "Greetings!" (selected third)
5. **Your turn** — All have spoken, you can respond

## Speaker Selection

### Priority Order

The Turn Manager selects the next speaker in this order:

1. **Queued Characters First**
   - If you've manually queued someone, they speak next
   - Queue is first-in-first-out (FIFO)

2. **Weighted Random Selection**
   - Among eligible characters (those who haven't spoken this cycle)
   - Based on talkativeness weights
   - Higher talkativeness = higher chance of being selected

3. **Your Turn**
   - When no eligible characters remain
   - All have spoken since your last message

### Eligibility Rules

A character is eligible to speak if:

- They are **active** or **silent** (not absent or removed)
- They are **LLM-controlled** (not impersonated, unless queued)
- They have **not spoken** since your last message
- They are **not the previous speaker** (except in single-character situations)

**Note:** Silent characters are still selected for turns — the difference is that their prompt instructs them to observe without speaking aloud. They may describe inner thoughts and physical reactions but not audible dialogue.

### Talkativeness Weights

Each character has a talkativeness setting (0 to 1):

- **0.0** — Never volunteers to speak (can still be nudged/queued)
- **0.25** — Quiet, speaks occasionally
- **0.5** — Balanced participation (default)
- **0.75** — Talkative, speaks often
- **1.0** — Very talkative, speaks as often as possible

The selection formula considers all eligible characters' weights. A character with weight 0.8 is roughly four times more likely to be selected than one with weight 0.2.

## Manual Turn Control

### Nudge

**What it does:** Forces a character to speak immediately.

**How to use:**

1. Find the character in the Participants drawer of the Chat Sidebar
2. Click the **Nudge** button
3. They respond immediately, regardless of the normal queue

**When to use:**

- A character should react to something specific right now
- You want to hear from a particular character next
- Breaking the normal flow for dramatic effect

**Notes:**

- Nudged character speaks even if they already spoke this cycle
- Nudge takes priority over the queue
- Only works for LLM-controlled characters
- The Host announces the summons in the transcript ("The Host turns to _Name_ … and invites them to take the floor"), so the invitation is a permanent part of the conversation rather than a note that vanishes on reload

### Queue

**What it does:** Adds characters to an ordered speaking list.

**How to use:**

1. Click **Queue** on a character's card
2. They're added to the back of the queue
3. Badge shows their queue position (1, 2, 3...)
4. Queued characters speak in order before random selection resumes

**When to use:**

- Planning a sequence of speakers
- Ensuring specific characters respond to something
- Setting up a deliberate conversation flow

**Managing the queue:**

- Queue is processed in order (first queued speaks first)
- After queue empties, normal weighted selection resumes
- Click **Dequeue** to remove someone from the queue
- Queue persists across your messages until cleared

### Dequeue

**What it does:** Removes a character from the pending queue.

**How to use:**

1. Find the queued character (they'll have a position badge)
2. Click **Dequeue** button
3. They're removed from the queue
4. Other characters' positions adjust accordingly

## Turn Indicators

### Turn Order Display

The participant sidebar shows a **predicted turn order** for all participants. Each participant has a numbered position badge indicating when they're expected to speak:

**Position Badges:**

1. **Generating (green, pulsing)** — Currently generating a response (#1 during generation)
2. **Next (green, static)** — Selected as the next speaker
3. **Queued (blue)** — Manually queued to speak
4. **Eligible (neutral)** — Available to speak this cycle, sorted by talkativeness
5. **Your Turn (amber)** — Indicates the user's position in the cycle
6. **Spoken (dimmed)** — Already spoke this cycle
7. **Silent (no badge, muted)** — Present but observing silently, still receives turns
8. **Absent (no badge, dimmed)** — Away from the scene, turns skipped entirely

Participants are automatically sorted in the sidebar by their predicted turn position, so you can see at a glance who's speaking, who's next, and who has already spoken.

### Interrupt/Stop Button

When a character is generating a response, their card shows a **Stop** button instead of the usual Nudge/Queue button. Click it to interrupt the current generation. In multi-character chats, the stop button appears on the generating character's card in the sidebar rather than in the chat composer.

### Visual Feedback

The UI shows turn status in several ways:

**Current Speaker:**
- Glowing/animated avatar border
- Green pulsing position badge (#1)
- Stop button on their card
- Active highlight on their card

**Your Turn:**
- Header shows "Your turn to speak"
- Amber position badge on your user character card
- Input field may have focus indicator

**Queued Characters:**
- Blue position badge with queue position
- Queue position visible in both expanded and collapsed sidebar

**Eligible Characters:**
- Neutral position badge with predicted position
- Sorted by talkativeness (higher talkativeness = earlier position)

**Silent Characters:**
- Muted appearance with "Silent" badge
- Still receive turns (shown in turn order)
- Messages styled with dotted borders and muted tones

**Absent Characters:**
- Dimmed/greyed appearance
- No position badge
- Shown at the bottom of the participant list

### Turn Status Messages

The sidebar header shows current status:

- "Your turn to speak" — Ready for your input
- "Generating response..." — AI is creating a response
- "Waiting for [Character]..." — Waiting for LLM response
- "[Character] is thinking..." — Character actively generating
- "2 in queue" — Shows queue count if characters are queued

## Special Situations

### Single Active Character

When only one character is active:

- Normal "no repeat speaker" rule is suspended
- Character can speak multiple times in a row
- Creates a back-and-forth between you and one character

### All Characters Have Spoken

When everyone in the rotation (including any user-controlled characters) has taken a turn this cycle, the cycle wraps and the next round starts fresh with a new weighted-random pick — the previous speaker can't go twice in a row.

- For chats with at least one user-controlled character, your turn typically comes up via the rotation banner rather than after every cycle wrap
- The cycle is persisted per chat so reloads and reopened sessions keep the same rotation state

### User-Controlled Characters

Characters you're impersonating sit in the same weighted rotation as the LLM characters. When the rotation lands on one of them, the chat waits for you, and the banner above the composer says so — "Alice's turn — type as them, or skip…" The banner and its **Skip** button are present whenever you could speak as a character at all, not only on that character's turn; between turns it reads "Speaking as Alice — type, or skip to let someone else take the floor."

- Type your character's response in the composer and send normally
- Or hit **Skip** to record their turn as taken (no message) and let the next character respond — on their turn or off it. If the conversation was paused, Skip resumes it first
- Talkativeness applies to user characters too — a chatty user character will come up more often than a quiet one
- Other LLM characters continue their turns normally; you can still queue an impersonated character with the sidebar's Queue button if you want them up sooner
- When the rotation reaches a seat you're driving, the composer defaults the voice above the input to *that* seat, so you're already speaking as whoever's turn it is. Taking up a character's pen also hands them the floor at once, rather than making you wait for the rotation to come round. A voice you pick by hand for the turn still stands; the composer only re-defaults as the turn moves on.

### All-LLM Chats

When no characters are user-controlled:

- Characters take turns automatically
- No user input required between turns
- **Auto-pause** activates after several turns:
  - Prevents infinite conversation loops
  - Notification asks if you want to continue
  - Click Resume or Pause to control flow

### Characters with Zero Talkativeness

If talkativeness is set to 0:

- Character never volunteers to speak
- Can still be nudged or queued
- Useful for "background" characters who speak only when prompted

### All Remaining Characters at Zero

If all eligible characters have zero talkativeness:

- No one is automatically selected
- It becomes your turn (or the cycle ends)
- Use nudge or queue to make someone speak

## Pause and Resume

### For All-LLM Chats

**Pause:**

- Click **Pause** in sidebar header
- Characters stop responding
- Current generation (if any) completes
- Use to read, think, or take a break

**Resume:**

- Click **Resume** to continue
- Turn manager resumes normal operation
- Next eligible character speaks

### When a Turn Fails

If a character's turn fails outright — its connection profile errors and every understudy in the fallback chain comes back empty — the Turn Manager pauses the conversation rather than knock on the same broken door turn after turn. A notice says so, and the sidebar button reads **Resume**. Mend the profile (or pick another from the character's card), then press **Resume**, nudge someone, or Skip your own turn; any of the three lifts the pause. Until you do, each message you send draws a single reply and the rotation goes no further.

### Auto-Pause

Triggers automatically when:

- Multiple LLM characters are active
- No user messages for several turns
- Prevents runaway conversations

You'll see a notification with options:

- **Resume** — Continue the conversation
- **Stop** — End auto-responses, take manual control

## Configuration

### Adjusting Talkativeness

1. Expand the Chat Sidebar (and, if needed, open the Participants drawer)
2. Find character's card
3. Use the slider to adjust:
   - Drag left for quieter (speaks less)
   - Drag right for chattier (speaks more)
4. Changes apply immediately

### Turn Settings

Some turn behavior can be configured:

- **Auto-pause threshold** — How many turns before pausing all-LLM chats
- **Queue behavior** — Whether queue persists across your messages

Access these in Chat Settings if available.

## Troubleshooting

### Character never speaks

**Causes:**

- Talkativeness set to 0
- Character is inactive
- Character already spoke this cycle
- Connection profile issue

**Solutions:**

- Increase talkativeness slider
- Check Active status
- Wait for your turn, then send another message
- Use Nudge to force a response
- Verify connection profile is valid

### Same character always speaks first

**Causes:**

- Very high talkativeness compared to others
- Others have very low talkativeness
- Small sample size (random selection variance)

**Solutions:**

- Balance talkativeness across characters
- Use Queue to control specific order
- Raise other characters' talkativeness

### Queue not processing

**Causes:**

- Queued character is inactive
- Queued character has connection issues
- UI not updated

**Solutions:**

- Check character is active
- Verify connection profile works
- Refresh the page
- Clear queue and re-queue

### Turn indicator stuck

**Causes:**

- Generation failed silently
- Network issue
- Server problem

**Solutions:**

- Refresh the page
- Check network connection
- Try sending a new message
- Check if response eventually appears

### All-LLM chat won't pause

**Causes:**

- Pause threshold not reached
- Pause feature disabled
- Quick responses cycling fast

**Solutions:**

- Click Pause button manually
- Wait for auto-pause notification
- Refresh if button doesn't respond

## Tips for Effective Turn Management

### For Roleplay

- **Set protagonist high** — Main characters should talk more
- **Supporting cast lower** — Background characters chime in less
- **Use nudge for reactions** — When someone should specifically respond
- **Queue for set pieces** — Plan important conversation sequences

### For Group Dynamics

- **Balance talkativeness** — For equal ensemble participation
- **Vary by scene** — Adjust who's prominent based on scene focus
- **Mark absent** — Set characters not in the scene to Absent
- **Silence observers** — Use Silent for characters who should watch but not speak

### For Pacing

- **Pause to read** — Don't let scenes rush past
- **Queue for timing** — Set up dramatic reveals
- **Single character mode** — Focus on one-on-one within group chat

### For Cost Control

- **Fewer active characters** — Less API calls per cycle
- **Lower talkativeness** — Some characters speak less often
- **Pause between cycles** — Read before continuing

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon/:id")`

## Related Pages

- [Chats Overview](chats.md) — Basic chat functionality
- [Multi-Character Chats](chat-multi-character.md) — Setting up group conversations
- [Nothing to Add — Turn Skipping](turn-skipping.md) — Letting a character pass a turn
- [Chat Sidebar](chat-participants.md) — Managing participants and per-chat settings
- [Message Actions](chat-message-actions.md) — Editing and managing messages
