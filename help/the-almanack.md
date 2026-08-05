---
url: /settings?tab=providers&section=capabilities-report
---

# The Almanack

> **[Open this page in Quilltap](/settings?tab=providers&section=capabilities-report)**

The Almanack — formerly, and rather more prosaically, the Capabilities Report — is the annual compendium of your establishment, compiled on demand rather than annually, which is the only liberty it takes with the form. In the tradition of Whitaker's and Wisden, it sets down the state of things: what is installed, what is configured, what has accumulated in the cellars, and which of the boilers is making that noise. It is assembled with the thoroughness of a particularly zealous butler taking inventory after a weekend house party, and it is meant to be shared — in a bug report, in a support thread, or with anyone who asks how much you have actually built.

## Compiling an Almanack

**Step by step:**

1. **Go to the AI Providers tab** in Settings (`/settings?tab=providers`)
2. **Find The Almanack** section
3. **Click "Compile the Almanack"**
4. **Watch the progress bar.** The compilation runs in seven named phases, and the bar tells you which one is under way:
   - *Taking the measure of the premises* — the machine, the databases, the backups
   - *Cataloguing the machinery* — plugins, providers, models, keys, themes
   - *Auditing the ledgers* — the main database's census
   - *Touring the Scriptorium* — the document stores, where most of your data actually lives
   - *Assembling the dramatis personae* — characters, projects, groups
   - *Reading the wire records* — the LLM logs
   - *Binding the volume* — rendering and filing the result
5. **The edition is filed** and appears in the list below the button, with its date and size.

You may collapse the card mid-compilation and come back; the progress channel keeps its place and the bar picks up where it left off.

## What's in an Almanack?

### The Premises

The vital statistics of the machine itself — Quilltap version, Node version, operating system and architecture, memory, runtime type (Docker, Lima, Electron, or plain Node), uptime, timezone and data directory. Then the three databases and their sizes (main, LLM logs, and the mount index — the last being where character content, wardrobe, photographs, mail and every document byte now live), whether they are behind a passphrase, the state of their physical backups, and how far up the migration ladder this installation has climbed.

### The Machinery

Every installed plugin — enabled or not, npm-installed or shipped with the app — broken down by what each one declares itself capable of. Then the LLM providers and what each can do, the models available from each, and the freshness of the model-discovery cache (a cache that has not moved in months is precisely how a silently broken discovery endpoint presents itself). API keys are counted per provider, with the never-used ones called out, and never printed. Also: the designated background workers (Cheap LLM, Image Prompt LLM, Embedding Provider), image and embedding providers, MCP servers **by name only**, and Calliope's themes — including how many icons each theme overrides, and how many of those overrides name an icon that does not exist and therefore take effect on nothing.

### The Ledgers

The census of the main database: characters, chats, memories, tags, projects, groups, profiles and templates. Then the shape of it all —

- **Chats** by kind (salon, help, autonomous, Brahma), a histogram of cast sizes, how many are paused, in Document Mode, carrying an equipped outfit or a backlog of outfit notifications, running on the narrative clock, or holding chat state.
- **Autonomous rooms** by run state, how many are scheduled and how many of those are overdue, which budgets are set, and how visibility is distributed.
- **The Commonplace Book** split by kind (semantic versus episodic), by source, by witnessed context; how many memories carry an event time, a narrative time, extracted entities, an embedding; and the total reinforcement across the whole book.
- **Characters** — vault-linked or not, NPCs, your own personas, Carina answerers, who may see the Staff, who may dress themselves.
- **Every feature dial** with its effective value: the Concierge, context compression, Prospero, the Lantern, Aurora's Core whisper, Pascal, timestamps, Saquel Ytzama's auto-lock, memory cascade and housekeeping, Salon behaviour, text replacements.
- **Instance settings**, including the stale-chat retention window and how many chats the next maintenance sweep would actually touch.
- **Background jobs** by status and type, with the failures and their most recent errors.
- **The embedding pipeline** — what is indexed, what permanently failed, and whether the vectors on disk match the width of the profile that would be used to query them (a mismatch is flagged, because recall against mismatched vectors is simply wrong).
- **Ariel's terminal sessions**, and the legacy file ledger.

### The Scriptorium

Entirely new, and overdue: the document stores. How many there are by kind, which are wedged mid-scan or mid-conversion, and the three global stores resolved by name. Then the contents — content rows, links, text documents, binary blobs by MIME type (blobs are now the largest single consumer of disk and appeared nowhere in the old report), and chunks with their token totals. Then the hard-link groups and the dedup ratio, the per-document policy counts, the health of the character vaults (a vault missing its keystone file is a hard failure for that character, not a quiet one), the wardrobe by tier, Pascal's Workbench inventory **including definitions that failed to parse**, Suparṇā's Post Office, the photograph albums, the scenarios by tier and the state cascade.

### Dramatis Personae

The ten busiest characters, with the chats they have been in, the memories they hold and the size of their vaults. Then every project — its linked stores, chats, files and documents — and every group, with its members **by name**, its linked stores, and whether its official store was ever provisioned.

### The Wire Records

Drawn from the LLM logs: requests by type with token totals and measured latency, per-profile usage both lifetime (from the profile rows) and within the retention window (from the logs), and the prompt-cache hit and miss figures by provider and by profile.

> **A note on richness.** This section is only as good as your logging settings. If the numbers look thin, that is the retention window talking, not the establishment. Enable LLM logging and lengthen the window (Settings → Chat → LLM Logging) and the Almanack's arithmetic grows correspondingly richer. The section prints your current setting at the top so you can see why.

Two honesty notes are printed with the figures rather than buried here. Latency averages always carry the count they were averaged over, because a great many older log rows carry no timing at all. And if your database predates the per-row profile columns, per-profile attribution falls back to grouping by provider and model — which cannot tell two profiles apart if they share a pair — and says so.

## Reading an Almanack

**In the app:** find the edition in the list, click the eye. It opens in a formatted view.

**On your machine:** click the download arrow. It saves as Markdown, named for the moment it was compiled.

## Using an Almanack for troubleshooting

The Almanack was designed with bug reports in mind. When something goes sideways — and in any sufficiently advanced system, something eventually will — a fresh edition captures the exact state of affairs at the moment of the mishap.

**Filing a bug report:**

1. Compile a fresh edition immediately after the trouble
2. Attach it to your report
3. It contains everything a developer needs to understand your environment without a lengthy back-and-forth interrogation

**Comparing before and after:** compile one before a change and one after. The two together tell the story of what shifted.

## Privacy & Security

The Almanack is designed to be safe to share publicly. It has been constructed to include everything useful for diagnosis while excluding everything sensitive.

**What is NOT in an Almanack:**

- API keys or authentication tokens
- MCP server URLs or credentials
- Your database passphrase
- Your email or name
- Message contents, document contents, memory contents, letter contents
- Photograph filenames, captions or titles
- Connection profile base URLs

**What IS in an Almanack:**

- System configuration and version information
- Database sizes, backup status and migration state
- Provider configurations and capabilities
- Every feature setting and its current value
- Usage statistics — counts, totals, sizes and latencies
- Theme information and installed themes
- **Names you have written**: character names (in the ten-busiest table and in group membership), project names, group names, document-store names, connection- and image-profile names, and MCP server display names

That last point is worth reading twice. The report contains counts and names, never contents — but if you have named a character or a project something you would rather not publish, look before you share.

## Managing editions

Each entry shows the filename, the date compiled and the size, with buttons to view, download or delete. Delete freely; each edition is a snapshot, and a fresh one is thirty seconds away.

## Troubleshooting

**Compilation failed**

- Check that you have disk space available
- Try again after a moment
- If it persists, check your logs

**A section looks thin or says it is unavailable**

- Sections for unconfigured features are naturally sparse
- The Wire Records section is bounded by your LLM logging settings (see the note above)
- If the Scriptorium section reports itself unreachable, the mount-index database could not be opened — that is a real problem worth reporting, since most of your data lives there

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=providers&section=capabilities-report")`

## Related Topics

- [System Tools](system-tools.md) - Overview of all system tools
- [LLM Logs](system-llm-logs.md) - The logging the Wire Records section reads
- [Connection Profiles](connection-profiles.md) - Configuring providers
- [Plugins](plugins.md) - Installing and managing plugins
