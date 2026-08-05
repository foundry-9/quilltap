---
url: /settings?tab=system&section=backup-restore
---

# Backup & Restore

> **[Open this page in Quilltap](/settings?tab=system&section=backup-restore)**

The Backup & Restore tool lets you create complete backups of your Quilltap system and restore from previous backups.

## What Gets Backed Up?

A complete backup includes everything needed to recreate your Quilltap environment:

**Your Content**
- All characters and their configurations
- Per-character plugin data (such as Commonplace Book entries stored by plugins)
- All chat histories and messages
- Conversation annotations (marginal notes added during roleplay sessions)
- All memories and memory data
- All files you've uploaded (images, documents, attachments)
- All folder structures you've created
- Projects and their settings
- Character groups — the whole fellowship preserved intact: each group's roster of members, its description and instructions, its scenarios and linked knowledge stores. (Time was, a restored archive returned your characters as so many strangers, every association between them quietly mislaid; that oversight has been set right, and a group now travels with its membership and its stores entire.)
- Wardrobe items and outfit presets

**Profiles & Settings**
- Connection profiles (API key references — keys need re-entry after restore)
- Image generation profiles
- Embedding profiles
- Chat display and behavior settings
- Text replacement rules — your private lexicon of find-and-replace substitutions, packed up whole. (Time was, only the switch that governs them made the journey, leaving you to restore a tidy ledger of *nothing*; that small injustice has been put right, and the rules themselves now travel alongside.)
- File write permissions (LLM file access grants)
- Plugin configurations (per-plugin settings)

**Templates & Organization**
- Prompt templates (user-created)
- Roleplay templates (user-created)
- Tags and organizational data

**Plugins**
- npm-installed plugins from your `plugins/npm/` directory
- Plugin-specific configurations

**Themes**
- User-installed theme bundles (themes you have installed from registries or manually)
- Built-in bundled themes are not included as they ship with the application

**Logs & History**
- LLM request/response logs (the Inspector's records)

**Not Included in Backups**

Certain data is intentionally excluded from backups:

- **API keys** — encrypted with device-specific keys and cannot be transferred between instances. You will need to re-enter your API keys in your connection, image, and embedding profiles after a restore.
- **Encryption key (.dbkey file)** — the master encryption key for your database is not included for security. Keep your `.dbkey` file backed up separately if you use database encryption.
- **Nothing about your search indexes, ordinarily** — a full backup carries every embedding and search index intact, so semantic search is working the moment a restore finishes. This is precisely why a backup is not the same article as a portable `.qtap` export, which leaves embeddings behind on purpose. Tick **Compact backup** and the indexes are the one thing left out; see below.
- **Background jobs** — any in-flight or queued tasks (embedding generation, memory extraction, etc.) are not preserved. They will be re-triggered as needed.
- **Built-in plugins** — these ship with Quilltap and do not need backing up.
- **Cached provider model lists** — while included in backups for convenience, these are refreshed automatically from your providers.

## Creating a Backup

**Step-by-Step:**

1. **Go to the **AI Providers** tab in Settings** (`/settings?tab=providers`)

2. **Find the Backup & Restore card**

3. **Decide whether you want a compact backup**
   - Leave the **Compact backup** box unticked for the full article, which is
     the recommendation and the default
   - Tick it for a considerably slimmer archive, at the cost described below

4. **Click the "Create Backup" button**

5. **Wait for the backup to be created**
   - A progress indicator may be displayed
   - Time depends on amount of data

6. **Download the backup file**
   - Your browser will download a ZIP file
   - The file contains all your data

7. **Store the backup safely**
   - Save it to a secure location on your computer
   - Consider cloud storage (Google Drive, Dropbox, etc.) for redundancy

**Backup sizes:**

- Varies based on your data volume
- Typically 10 MB - 1 GB depending on number of characters, chats, and files
- Backups are compressed to save space

### The Compact Backup

Search indexes are, by weight, the overwhelming majority of a well-used
archive — a great silent ballast of numbers beneath a comparatively modest cargo
of actual prose. A **compact backup** declines to carry them.

**What is left behind:** every embedding vector and every table derived from
one — conversation chunks, vector indexes, TF-IDF vocabularies, indexing status,
and document-store chunks.

**What is emphatically *not* left behind:** anything you wrote. Characters,
chats, messages, memories, files, settings, and all the rest travel exactly as
they do in a full backup. Only the machinery of *finding* things quickly is
omitted, and that machinery is rebuilt from the words themselves.

**On restoring one**, Quilltap notices the archive is compact and queues a full
re-indexing pass at once. Everything is readable immediately; semantic search
warms back up as the Tasks Queue drains. Conversation and document chunks are
rebuilt as those chats and stores are next opened.

**Which should you choose?** The full backup, nearly always. A backup exists to
restore *this* instance, where the indexes are still perfectly valid on arrival,
and rebuilding them costs real time and — with a paid embedding provider — real
money, at precisely the moment you are recovering from a misfortune and least
want either. Reach for compact when the size of the archive is itself the
problem: a thin pipe, a full disc, a mail attachment that will not have it.

## Restoring from a Backup

**Important:** Restoring can either replace your current data or import alongside it.

**Step-by-Step:**

1. **Go to the **AI Providers** tab in Settings** (`/settings?tab=providers`)

2. **Find the Backup & Restore card**

3. **Click "Restore from Backup"**

4. **Select your backup file**
   - Click to browse or drag and drop
   - Supports .zip backup files

5. **Preview the backup contents**
   - See what's included (characters, chats, files, etc.)
   - Review the counts before proceeding

6. **Choose restore mode:**
   - **Replace Existing Data:** Delete all current data and replace with backup
   - **Import as New Data:** Keep existing data and import backup with new IDs

7. **Confirm and start restore**
   - For "Replace" mode, you must confirm the deletion warning
   - Click "Start Restore"

8. **Wait for restore to complete**
   - System will show progress
   - Do not close the browser tab

9. **Restore complete**
   - Your system reloads with the restored data
   - npm plugins are extracted and ready to use
   - The restore summary may mention re-indexing; see below

## After a Restore: The Indexing Sweep

Every restore now ends with a brief inspection of the search indexes it has just
laid down, and this is not idle ceremony. An archive made on one machine can
land on another that keeps a different embedding profile entirely — or be
restored in "Import as New Data" mode, which is much the same situation wearing
a different hat. Vectors made under one standard mean nothing under another, and
until now the mismatch went unnoticed until the *following* startup.

Three outcomes, all reported in the restore summary:

- **Nothing to do.** The indexes match this instance's profile. This is the
  ordinary case for restoring a backup onto the machine that made it, and it
  costs essentially nothing.
- **Re-indexing queued.** Some indexes did not match and have been sent for
  repair. Everything is readable at once; semantic search warms up as the Tasks
  Queue drains.
- **Inspection skipped.** No embedding profile is configured yet, or it is the
  built-in one, which keeps no fixed measure. The next startup will look again.

A compact backup always takes the second road, by design — it brought no indexes
to inspect.

## Restore Modes Explained

**Replace Existing Data:**
- Deletes ALL your current data
- Replaces it entirely with the backup contents
- Use when migrating to a new instance
- Use when recovering from data corruption
- Cannot be undone

**Import as New Data:**
- Keeps all your existing data
- Imports backup contents with regenerated IDs
- Use to merge data from another instance
- Use to duplicate content for testing
- Existing data remains untouched

## Understanding Backup Timing

**When to create backups:**

- **Before major changes:** System updates, configuration changes
- **Regularly:** Weekly or monthly for data protection
- **Before experiments:** Trying new features or settings
- **Before deletion:** Before deleting large amounts of data
- **Before migration:** Before moving to a different instance

**When NOT to restore with "Replace" mode:**

- Don't replace if you've made important changes since the backup was created
- Consider "Import" mode if you want to preserve current data

## Managing Your Backups

**Storing backups:**

- Save backups to your computer's documents folder
- Use cloud storage (Google Drive, Dropbox, iCloud) for redundancy
- Consider external hard drives for large backups
- Name files clearly with dates (e.g., `quilltap-backup-2026-02-03.zip`)

**Backup organization tips:**

- Keep at least 2-3 recent backups
- Delete old backups when they're no longer needed
- Archive important milestone backups separately

## Troubleshooting

**Backup failed**

- Check that your system has enough disk space
- Try again after stopping any running tasks
- Check the browser console for error details

**Restore failed**

- Ensure the backup file is not corrupted
- Try a different backup file
- Check that the file is a valid Quilltap backup (.zip format)

**Backup is very large**

- Large file collections increase backup size
- Consider archiving old files you don't need
- Backups are compressed but can still be large with many images

**Files or document stores missing after restore**

- Three faults conspired here, and all three are now mended. Your archives are not at fault — the contents were always packed correctly; it was the unpacking that went astray, and an archive taken before the fix restores perfectly well on a current build.
  - Every document store and every link within it was refused on the way back in, on a technicality of bookkeeping, and the restore reported a cheerful success regardless. The result was a house full of furniture with every door bricked over: character vaults, project stores and group stores all present in the archive and none of them reachable.
  - The unpacker looked for your uploaded files under a filing scheme three revisions out of date, and so found none of them.
  - And it looked for them *before* it had rebuilt the stores those files must be placed into — which mattered enormously when restoring into a fresh or freshly-wiped instance, that being precisely the calamity a restore is kept for. Restoring over a populated instance had concealed the whole business, the stores happening to be there already.
- If you restored on an earlier build and found your vaults unreachable or your uploads absent, restore that same archive again on this one.

**API keys missing after restore**

- API keys are not backed up for security reasons
- Re-enter your API keys in connection profiles after restore
- The connection profile settings are preserved, just not the keys

## Best Practices

**Regular Backups:**

- Create a backup at least weekly
- Create before major system changes
- Keep at least 2-3 recent backups

**Backup Retention:**

- Don't keep backups forever - they take up space
- Delete backups older than 3 months unless you have a specific need
- Archive important backups to cloud storage

**Testing Restores:**

- Periodically test that you can restore successfully
- Verify your backup strategy works before you really need it
- Use "Import" mode to test without affecting current data

**Secure Storage:**

- Store backups in a secure location
- Don't share backup files - they contain all your data
- Consider encrypting sensitive backups

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=system&section=backup-restore")`

## Related Topics

- [System Tools](system-tools.md) - Overview of all system tools
- [Import & Export Data](system-import-export.md) - Transferring data in and out
- [Managing Tasks](system-tasks-queue.md) - Background job monitoring
