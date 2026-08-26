---
url: /settings?tab=system&section=tasks-queue
---

# Managing Tasks

> **[Open this page in Quilltap](/settings?tab=system&section=tasks-queue)**

The Tasks Queue shows all background jobs running in your Quilltap system. These include memory extraction, imports, exports, and other long-running operations.

## Understanding the Tasks Queue

**What are background tasks:**

- Operations that run in the background without blocking the UI
- Memory extraction from chat messages
- Import and export operations
- File processing
- System analysis jobs
- Anything that takes significant time

**Why they run in background:**

- Allows you to keep using Quilltap while tasks run
- Prevents UI freezing
- Processes data efficiently

## Viewing the Tasks Queue

**Go to the **Data & System** tab in Settings** (`/settings?tab=system&section=tasks-queue`) and expand the **Tasks Queue** card.

The Tasks Queue displays:

**Active Jobs:**

- Jobs currently running
- Current progress (percentage or count)
- Estimated time remaining
- Resource usage (memory, CPU)

**Queued Jobs:**

- Jobs waiting to run
- Estimated start time
- Priority level

**Completed Jobs:**

- Recent completed jobs
- Success/failure status
- Completion time

**Failed Jobs:**

- Jobs that encountered errors
- Error messages
- Retry options

## Setting How Many Tasks Run at Once

At the top of the Tasks Queue card sits the **Simultaneous Labours** dial — a single lever governing how many background errands the engine may undertake at the same moment, across *every* sort of task (memory extraction, imports, image conjuring, autonomous turns, and the rest).

- The factory setting is **four**, a figure that suits most households handsomely.
- A stouter machine — a generous local model, or a cloud provider that tolerates a flurry of simultaneous requests — may be permitted up to **two-and-thirty**.
- Slide it down to **one** when you would rather the works proceed in stately single file, sparing a modest backend from being overrun.

Drag the slider and release; the new allowance takes hold within a breath or two — no restart required — and persists across restarts. Bear in mind that a single ravenous task type, set loose at a high allowance, may monopolise the works and leave lighter errands waiting their turn.

## Task Types

**Memory Extraction**

- Processes chat messages to extract important memories
- Triggered manually or during import
- Shows progress (e.g., "Processing 50/200 messages")

**Import Operations**

- Running import from export file
- Shows how many items have been imported
- Progress includes character, chat, and memory counts

**Export Operations**

- Creating export files
- Shows progress of data collection
- Completes with download link

**Analysis Jobs**

- System analysis and optimization
- Memory cleanup
- Database maintenance

**Backup/Restore**

- Full system backup creation
- Restore from backup operations
- Shows percentage complete

## Monitoring Tasks

### Task Details

Click on a task to see more information:

- **Task ID** - Unique identifier
- **Type** - What kind of job it is
- **Status** - Running, queued, completed, failed
- **Progress** - Percentage or items processed
- **Started At** - When task began
- **Estimated Time** - How long until completion
- **Resources** - Memory and CPU usage

### Task Status

**Running (Blue/Active)**

- Task is currently processing
- Progress continues in real time
- Can usually be paused

**Queued (Gray)**

- Task waiting to run
- Will start when resources available
- Can be reordered or cancelled

**Completed (Green)**

- Task finished successfully
- Results available
- Can be viewed or downloaded

**Failed (Red)**

- Task encountered error
- Error details shown
- May be retryable

**Paused (Yellow)**

- Task temporarily stopped
- Can be resumed
- Progress saved

## Controlling Tasks

### Pause a Task

**To pause a running task:**

1. Find the task in the queue
2. Click the **Pause** button
3. Task pauses and can be resumed later
4. Progress is saved

**Why pause tasks:**

- Free up system resources
- Temporarily stop a task
- Pause during peak usage times

### Resume a Task

**To resume a paused task:**

1. Find the paused task in the queue
2. Click the **Resume** button
3. Task continues from where it paused
4. Progress resumes

### Cancel a Task

**To cancel a task:**

1. Find the task in the queue
2. Click the **Cancel** or **Delete** button
3. Confirm cancellation
4. Task is removed from queue

**What happens when cancelled:**

- For running tasks: Processing stops
- For queued tasks: Removed from queue
- Any partial results are discarded
- Task won't resume

**When to cancel:**

- Task is taking too long
- Task appears stuck
- You changed your mind about the operation
- High priority task needs to run

### Retry a Failed Task

**To retry a failed task:**

1. Find the failed task (marked in red)
2. Click **Retry** button
3. Task is re-queued to run again
4. May have different result this time

**When to retry:**

- Temporary network failure
- Resource temporarily unavailable
- After system configuration change

## Understanding Task Resources

**The Tasks Queue shows:**

**Memory Usage**

- RAM being used by the task
- If too high, system may slow down
- Excessive memory may indicate problem

**CPU Usage**

- Processing power being used
- 0-100% scale
- High usage = resource intensive task

**Estimated Time**

- Based on current speed and remaining work
- May be inaccurate for first tasks
- Updates as task progresses

## Managing System Load

**When system is overloaded:**

- Pause non-critical tasks
- Cancel low-priority tasks
- Let high-priority tasks complete
- Restart system if needed

**Task priority levels (if shown):**

- **High:** Imports, critical operations
- **Normal:** Most memory extraction
- **Low:** Cleanup, analysis tasks

**To reduce system load:**

1. Check Tasks Queue
2. Pause background music or other apps
3. Cancel non-urgent tasks
4. Give system time to catch up

## Common Task Scenarios

**Import taking too long:**

- Large imports take time (normal)
- Don't cancel unless stuck
- Check if system resources are available
- Consider splitting large imports

**Memory extraction seems slow:**

- Processing hundreds of messages takes time
- Rate depends on provider and system
- Can pause to free up resources
- Won't affect chat functionality

**Multiple tasks running:**

- System queues tasks and processes them
- Tasks run serially or in parallel depending on resources
- Restarting can help clear stuck tasks

**Task disappeared:**

- May have completed and been archived
- Check "Completed Jobs" section
- Some tasks clear after finishing

## Troubleshooting

**Task is stuck**

- Check if system has resources available
- Try pausing and resuming
- Cancel task and retry
- Restart system if necessary

**Task failed with error**

- Read error message carefully
- Common causes: network issues, insufficient space, permissions
- Retry task if error was temporary
- Contact support if error persists

**Can't see my tasks**

- Refresh the page
- Task may have completed and been cleared
- Check completed/failed sections
- Very old tasks may be archived

**Tasks queue won't process**

- Ensure background processor is running
- Check system health
- Try restarting
- Contact support if queue remains stuck

## The live wire

The Tasks Queue does not sit there going stale until you prod it. Quilltap keeps
a slender private line open between the engine room and every window you have
open — a speaking-tube, if you like — and the moment a task is entered, taken
up, finished, or abandoned, word travels up it at once. The list you are looking
at redraws itself within the same breath. Nothing is *sent* along the tube but
the news that something has changed; the page then asks for the particulars
through the ordinary channels, so what you read is always the genuine article
and never a rumour.

The same wire serves the chips in the toolbar, the autonomous-room badges, the
progress readouts on the housekeeping levers, and the little status lamps beside
a conversation being filed in the Scriptorium.

**Fallback polling (5s).** Beneath the queue controls sits a switch by that
name. It governs what happens when the wire is *down* — a server restarted
beneath you, a network hiccup, a laptop lid closed and reopened. With it on, the
page falls back to the old arrangement and asks for fresh figures every five
seconds until the line is restored; with it off, the page waits quietly for the
line to come back. Either way you lose nothing: the instant the wire is
reconnected, every readout re-asks for the truth, so a spell of silence costs
you a little delay and never a wrong number.

There is nothing to configure beyond that switch, and nothing to restart. If you
ever find a readout that seems becalmed, reloading the page is the whole of the
remedy.

### Clocks, not wires

A phrase like *"4m ago"* goes out of date for an entirely different reason: not
because anything happened at the engine, but because the clock on your wall
moved. Those readings now advance on their own, all together, on the stroke of
each minute — in the queue, on the conversation cards, wherever they appear —
and a card that says *Today* becomes *Yesterday* at midnight without being
asked. No line to the server is involved, and none is wanted.

## The chips on the mantelpiece

You need not open Settings to know whether the household is busy. A small row of
chips sits in the page toolbar, wherever you happen to be — **Mem**, **Emb**,
**Sum**, **Dgr**, **Img** — each bearing a count of the work of that kind
presently in hand.

| Chip | What it watches |
|---|---|
| **Mem** | the Commonplace Book — memories being formed, regenerated, or tidied away |
| **Emb** | embeddings being minted, whether for the index or to answer a search you just typed |
| **Sum** | summaries, titles, scene-state, conversation rendering — the quiet work after a turn |
| **Dgr** | the Concierge, weighing content for danger |
| **Img** | images, end to end: reading one with a vision model, deciding what a picture should contain, crafting the prompt, waiting on the provider, and landing the result |

A chip counts the *whole errand*, not merely its queued portion. An image
requested by a character lights **Img** from the first moment its prompt is
being considered until the picture has landed (or failed) — and if the Concierge
is consulted along the way, **Dgr** ticks up inside that span and back down
again, quite as it should. Two things of the same kind at once read as `2`.

Work that begins and ends between two glances would otherwise pass unnoticed, so
a chip gives a brief double-blink to mark that something went through. A chip at
rest is dimmed; it is never merely stale — the chips ride the same live wire
described above, and light the instant work starts rather than at the next
glance.

Not everything appears here. Pure housekeeping the Estate performs on its own
account is left off, and autonomous rooms keep their own [row of
badges](autonomous-rooms.md) rather than crowding these.

## Best Practices

**Monitor Important Tasks:**

- Check queue when importing large data
- Watch memory extraction after import
- Verify critical operations complete

**Avoid Overloading:**

- Don't queue too many tasks at once
- Let imports complete before starting others
- Monitor system resources

**Use Pause Strategically:**

- Pause non-critical tasks during peak times
- Resume when less busy
- Keeps important work flowing

**Regular Cleanup:**

- Clear very old completed tasks
- Archive results
- Remove failed tasks after retrying

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=system&section=tasks-queue")`

## Related Topics

- [System Tools](system-tools.md) - Overview of all system tools
- [Import & Export Data](system-import-export.md) - Importing and exporting
- [Backup & Restore](system-backup-restore.md) - Backup operations
