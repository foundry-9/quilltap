---
url: /settings?tab=system
---

# System Tools

> **[Open this page in Quilltap](/settings?tab=system)**

**Settings** (`/settings`) is your command center for managing and maintaining your Quilltap system. The **Data & System** tab provides utilities for backing up your data, importing/exporting, monitoring tasks, and managing your system's capabilities.

## Accessing Settings

Navigate to **Settings** in Quilltap at `/settings` or through your app's navigation menu, then click the **Data & System** tab. The page displays several utility cards, each providing different system management features.

## Available Tools

### 1. Backup & Restore

**Purpose:** Create full backups of your Quilltap data and restore from previous backups.

**What it does:**

- Creates complete snapshots of all your data (characters, chats, memories, files, settings)
- Stores backups securely
- Allows you to restore your entire system from a backup
- Lists all available backups with creation dates and file sizes

**When to use it:**

- Before making major system changes
- Regular scheduled backups for data protection
- Before trying experimental features
- To recover data if something goes wrong

For detailed instructions, see [Backup & Restore](system-backup-restore.md).

### 2. Import / Export

**Purpose:** Transfer your data in and out of Quilltap in native format.

**What it does:**

- **Export:** Save your data (characters, chats, memories, templates) to files
- **Import:** Load data from export files back into Quilltap
- Supports conflict resolution when importing (replace, keep, merge)
- Can include or exclude memories during export/import

**When to use it:**

- Sharing data with others
- Migrating between instances
- Backing up specific data (not everything)
- Transferring characters or chats to another system

For detailed instructions, see [Import & Export Data](system-import-export.md).

### 3. Memory Deduplication

**Purpose:** Find and merge semantically duplicate memories across all your characters.

**What it does:**

- Analyzes all character memories using cosine similarity on their embeddings
- Clusters duplicate memories and selects the best version to keep
- Extracts unique details from duplicates and preserves them as footnotes in surviving memories
- Removes duplicate memories and cleans up the vector store
- Provides a preview before making any changes

**How to use it:**

1. Adjust the **Similarity Threshold** slider (default 0.80). Lower values are more aggressive (find more duplicates), higher values are more conservative.
2. Click **Analyze Memories** to see a preview of what would be deduplicated.
3. Review the per-character results table showing clusters found, removable memories, and details to merge.
4. Click **Run Deduplication** to execute the cleanup, or **Cancel** to abort.

**When to use it:**

- After importing large character exports that may contain duplicates
- Periodically to keep memory databases clean and efficient
- When characters have accumulated many similar memories over time
- After changing embedding providers (which may cause duplicate entries)

### 4. Tasks Queue

**Purpose:** Monitor and manage background jobs (memory extraction, analysis, processing).

**What it does:**

- Shows all background tasks currently running or queued
- Displays task progress and estimated completion time
- Lists failed tasks with error information
- Allows pausing and resuming tasks
- Shows memory usage and system load

**Common tasks:**

- Memory extraction (analyzing chat messages for important information)
- Character analysis
- File processing
- Import operations

For detailed instructions, see [Managing Tasks](system-tasks-queue.md).

### 5. The Almanack (System Report)

**Purpose:** Compile a comprehensive compendium of your entire establishment — formerly the Capabilities Report.

**What it does:**

- Records the machine, the three databases, the backups and the migration state
- Documents every plugin, provider, model, API key and theme
- Takes the census of the main database — chats, memories, characters, every feature dial
- Tours the Scriptorium: document stores, blobs, character vaults, wardrobe, custom tools, mail, photographs
- Lists the ten busiest characters, every project and every group
- Reads the LLM logs for per-type and per-profile usage, latency and prompt-cache figures

**When to use it:**

- Troubleshooting system issues
- Documenting your setup
- Sharing configuration details with support
- Planning system upgrades

For detailed instructions, see [The Almanack](the-almanack.md).

### 6. LLM Logs

**Purpose:** View detailed logs of all AI interactions and model calls.

**What it does:**

- Displays recent LLM (Language Model) logs
- Shows each API call to AI providers
- Lists tokens used and estimated costs
- Shows success/failure status
- Allows viewing detailed log information

**When to use it:**

- Debugging AI responses
- Understanding token usage
- Reviewing cost estimates
- Troubleshooting provider issues

For detailed instructions, see [LLM Logs](system-llm-logs.md).

### 7. Delete All Data

**Purpose:** Permanently delete your entire Quilltap account and all associated data.

**Warning:** This action is irreversible and will delete:

- All characters
- All chats and messages
- All memories
- All files
- All settings and profiles
- All backups

**When to use it:**

- Completely resetting your account
- Uninstalling Quilltap and removing all traces
- Starting completely fresh

For detailed instructions, see [Deleting Your Data](system-delete-data.md).

## Quick Start Guide

**For data safety:**

1. Go to **Settings** (`/settings?tab=system`)
2. Click **Backup & Restore**
3. Create a backup

**To transfer data:**

1. Go to **Settings** (`/settings?tab=system`)
2. Click **Import / Export**
3. Choose Export to save your data

**To monitor system:**

1. Go to **Settings** (`/settings?tab=system`)
2. Check **Tasks Queue** for active jobs
3. View **LLM Logs** for recent activity

## Safety & Best Practices

**Regular Backups:**

- Create backups weekly or before major changes
- Store backups in a safe location
- Test restore functionality occasionally

**Before System Changes:**

- Create a backup
- Check Tasks Queue to ensure no jobs are running
- Note your current configuration by compiling an Almanack

**Monitoring System Health:**

- Check Tasks Queue regularly to ensure jobs complete successfully
- Review LLM Logs if experiencing issues
- Compile an Almanack periodically to document your setup

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=system")`

## Related Topics

- [Backup & Restore](system-backup-restore.md) - Detailed backup and restore guide
- [Import & Export Data](system-import-export.md) - Moving data in and out of Quilltap
- [Managing Tasks](system-tasks-queue.md) - Background job management
- [The Almanack](the-almanack.md) - The full system report
- [LLM Logs](system-llm-logs.md) - AI interaction logging and troubleshooting
- [Deleting Your Data](system-delete-data.md) - Account and data deletion
