---
url: /settings?tab=system&section=import-export
---

# Import & Export Data

> **[Open this page in Quilltap](/settings?tab=system&section=import-export)**

The Import & Export tool lets you save your Quilltap data to files and load data from files back into your system.

## Export: Saving Your Data

Export lets you save characters, chats, memories, and templates to files in Quilltap format.

**What can you export:**

An export carries exactly one kind of thing, and the picker now offers the full
roster — for a good while it offered only seven of them, and the rest sat in the
cellar with no bell-pull:

- **Characters** and their configurations
- **Chats** — histories, messages, annotations, and Document Mode panes
- **Memories**, riding along with either of the above
- **Roleplay Templates** and **Prompt Templates** (your own; the house's built-ins
  stay with the house)
- **Connection**, **Image**, and **Embedding Profiles** — minus the keys, always
- **Tags**, **Projects**, and **Groups**
- **Document Stores** — the Scriptorium's shelves, contents and all
- **Files & Folders** — the general file library, bytes included
- **Provider Models** — the catalogue of models, for instances that cannot reach
  out and fetch it themselves
- **Plugin Settings** — with every password-shaped setting left behind on purpose
- **Instance Settings** — the "move my setup" export

**Why export:**

- Share characters or chats with others
- Back up specific data (not a full system backup)
- Migrate to another Quilltap instance
- Create archives of completed projects
- Share setups with other users

### How to Export

**Step-by-Step:**

1. **Go to the **AI Providers** tab in Settings** (`/settings?tab=providers`)

2. **Find the Import / Export card**

3. **Click "Export Data"** button

4. **Select what to export:**
   - Choose which characters, chats, or templates to include
   - Check/uncheck items you want included

5. **Choose export options:**
   - **Include Memories:** Whether to include associated memories
   - Shows how many memories will be included — and, for character exports, what the characters' vaults add to the luggage (documents, images, and an estimated size)

6. **Review your selection**
   - Verify the items you're exporting
   - Confirm memory inclusion setting

7. **Click "Export"**
   - System creates the export file
   - May take several minutes for large exports

8. **Download the file**
   - A `.quilltap` file downloads to your computer
   - Store it in a safe location
   - Share it if needed

**Export file contains:**

- All selected data in Quilltap format
- Metadata about characters, chats, memories
- Images and media (if included)
- Complete chat histories
- Memory data

## Import: Loading Data

Import lets you load exported data from `.quilltap` files back into your system.

**What can you import:**

- Exported characters
- Exported chats
- Associated memories
- Templates and settings

**Why import:**

- Restore from an export file
- Use characters/chats shared by others
- Migrate from another instance
- Add previously exported data back

### How to Import

**Step-by-Step:**

1. **Go to the **AI Providers** tab in Settings** (`/settings?tab=providers`)

2. **Find the Import / Export card**

3. **Click "Import Data"** button

4. **Select import file**
   - Click to choose a `.quilltap` file from your computer
   - Or drag and drop the file
   - System reads the file and previews contents

5. **Review what will be imported**
   - List of characters, chats, memories to import
   - Count of each entity type
   - File sizes and metadata

6. **Choose conflict resolution strategy:**
   - **Keep Existing:** Don't overwrite if item already exists
   - **Replace:** Overwrite existing items with imported versions
   - **Create New:** Always create new items (rename if necessary)

7. **Choose memory handling:**
   - **Include Memories:** Import associated memories if included in export
   - **Skip Memories:** Don't import memories (import only items)

8. **Select which items to import**
   - You can deselect specific characters, chats, or templates
   - Only checked items will be imported

9. **Review your choices** and click "Import"

10. **Wait for import to complete**
    - System processes the import
    - May take several minutes
    - Creates new items in your system

11. **Import complete**
    - Success message shows what was imported
    - New items appear in your system
    - Memories may be queued for processing

### Understanding Conflict Resolution

**Keep Existing (Recommended for merging):**

- If you already have a character named "Alice", the import is skipped
- Use this to add new items without overwriting
- Safe option that won't lose existing work

**Replace (Recommended for updating):**

- If you already have a character named "Alice", it's overwritten with the imported version
- Use this to update items with newer versions
- Replaces completely, no merging

**Create New (Recommended for duplicating):**

- Creates a copy even if item exists
- Imported character becomes "Alice 2" if "Alice" exists
- Useful for having multiple versions

## Understanding Import Results

After import completes, you see:

**Summary of what was imported:**

- Number of characters created
- Number of chats created
- Number of templates created
- Number of memories queued (if included)

**Next steps:**

- New items appear in your system immediately
- Memories may take time to process
- You can review imported items

## Exporting from Chats

You can also export individual chats directly from within a chat:

1. **Open a chat**
2. **Look for export option** (usually in chat menu)
3. **Click "Export Chat"**
4. **Choose export options**
5. **Chat is exported** to a file

This creates a quick export of just that chat.

## Relationship Preservation

When you import data, Quilltap automatically preserves and updates relationships between entities:

**Character relationships:**

- Default connection profile (for LLM selection)
- Default image profile (for image generation)
- Default roleplay template (for conversation style)
- Default partner character (for paired conversations)
- Tags assigned to the character

**Chat relationships:**

- All participant characters
- Each participant's connection and image profiles
- Each participant's roleplay template
- Project association
- Tags assigned to the chat

**Memory relationships:**

- Associated character
- Associated chat
- Associated project
- Tags assigned to the memory

**Profile relationships:**

- Tags assigned to connection, image, and embedding profiles

**Template relationships:**

- Tags assigned to roleplay templates

When using the "Create New" conflict strategy, all internal references are automatically updated to point to the newly created copies.

## What Travels, and What Stays Behind

First, a recent and welcome addition to the manifest: **a character's vault now
travels with the character.** A character export used to carry the dossier but
not the steamer trunk — the portrait, the photograph album, the correspondence
in `Mail/`, the wardrobe, the conversation summaries all stayed home, and the
character stepped off the train faceless. The whole vault now rides along, and
on arrival the avatar and every photograph resolve exactly as they did at the
point of departure.

A few things, however, are deliberately left on the platform when an export
departs. None of this is an oversight, and in each case the receiving instance
rebuilds or already owns what was withheld.

**Memories arrive without their search indexes.** A memory's embedding — the
numerical impression by which semantic search finds it — is meaningful only
against the very model that produced it. Carried into a house that keeps a
different model, it is not merely useless but actively misleading: search would
return confident nonsense and nothing anywhere would notice. So embeddings no
longer travel at all.

The practical effects are two, and both are to your advantage. Exports that once
ran to hundreds of megabytes now run to a few, since the vectors were better
than nine-tenths of the weight. And on arrival, Quilltap immediately queues each
imported memory for re-indexing against *your* embedding profile. Watch the
Tasks Queue; semantic search over the newcomers warms up as the queue drains. If
no embedding profile is configured, you will be told so plainly, and the
memories are indexed the moment you set one up.

(Should you import an older `.qtap` file that still carries embeddings, they are
discarded at the door rather than admitted.)

**Plugin settings arrive without their secrets.** Any setting a plugin declares
as a password is stripped at export time, and the import preview names exactly
which ones went missing so you know what to type back in. Everything else is
merged into whatever configuration this instance already holds — so a secret you
have already entered here is left undisturbed. If the plugin is not installed on
the exporting instance, Quilltap cannot tell which settings are sensitive and
therefore withholds all of them: it would rather ask you to re-enter a harmless
setting than gamble with a live one.

**Instance settings overwrite, on purpose.** That is what "move my setup" means.
A handful of keys never travel regardless — the pointers to this instance's own
document stores, the housekeeping clock, and the version guard — because they
name things that exist only here.

**Files arrive re-shelved.** File contents travel in full, but the *address*
where they were stored does not: it names a shelf in the exporting instance's
own storage. Each file is re-filed here and given a fresh address. Attachments
pointing at characters or chats not present on this instance are quietly
unhooked, and you are told how many.

**Provider models are a convenience, not a source of truth.** The catalogue
rebuilds itself the moment you refresh models from a provider. Export it when an
instance cannot reach the outside world; otherwise a refresh knows better.

## Import/Export File Format

**File format:** `.qtap` — streaming newline-delimited JSON (NDJSON).

**Structure:**

- First line is an envelope carrying the manifest (`{"format":"qtap-ndjson","version":1,"manifest":{...}}`)
- Each subsequent line is a single tagged record — one character, one memory, one message, and so on — so nothing in the pipeline has to hold the whole export in memory at once
- Large binary blobs (document-store attachments) are split across multiple chunk lines and stitched back together on import. (Time was, the reader declared a large attachment complete the instant its *first* parcel arrived — the remainder was left standing on the platform, and the import ended in a bewildered complaint about a chunk with no blob to belong to. Anything under 3 MB travelled as a single parcel and so came through unharmed; anything larger did not. The reader now waits for every parcel before it signs for the delivery.)
- A trailing footer line carries authoritative record counts
- Relationships stored as references that are remapped on import
- Because every line is independently valid JSON, a `.qtap` file can be browsed or grepped with any text tool
- The manifest may carry a `preserveIds` flag, under which every record is restored at its original ID (refusing outright, before any writes, if a preserved ID would collide with something already in residence). This flag is set by Quilltap's own archive machinery; the wizard offers no such option and never sets it

**Compatibility:**

- Version 4.3+ writes the streaming NDJSON format. Older versions wrote a single monolithic JSON object; those files still import just fine, though exports above ~450 MB that were produced by those older versions cannot be read — re-export them from a current Quilltap build first
- Export files are version-tagged, so older clients refusing a newer file is the expected behavior
- Contact support if import fails

## Troubleshooting

**Export failed**

- Check that you selected at least one item
- Ensure sufficient disk space for the download
- As of version 4.3 the export streams record-by-record, so even characters with tens of thousands of memories export cleanly — if a modern export still fails, check the server log for a specific error
- Contact support if issue persists

**Import failed**

- Verify file is a valid `.qtap` file (either streaming NDJSON or a legacy monolithic JSON export)
- Check that file hasn't been corrupted (a truncated NDJSON file will report a specific line number)
- An export that fails with **"doc_mount_blob_chunk received without preceding doc_mount_blob"** was written by a build predating this fix and read by one predating it too; the file itself is sound. Import it again on a current build and its large attachments will arrive whole
- A genuinely truncated export now says so plainly — *"NDJSON export truncated"*, naming the attachments that never finished arriving — rather than complaining about an orphaned chunk
- Very old exports above ~450 MB that used the monolithic JSON format are too large to import on modern runtimes — re-export them from a newer Quilltap build first
- Try changing conflict resolution strategy
- Contact support if error persists

**Import very slow**

- Large imports take time (importing 1000+ messages can be slow)
- Don't close browser tab during import
- Check Tasks Queue to see import progress

**Memories didn't import**

- Memories import as separate queue items
- Check Tasks Queue to see memory processing jobs
- Memories may take time to process
- Check if "Include Memories" was selected during import

**Imported memories don't turn up in search**

- Expected, briefly: every imported memory is re-indexed against your own
  embedding profile rather than arriving with the sender's. Check the Tasks
  Queue — search over them warms up as the re-indexing jobs drain
- If the import warned that no embedding profile is configured, set one in the
  Commonplace Book tab; the memories are indexed once one exists
- The memories themselves are present and readable throughout; it is only
  semantic search that has to catch up

**Duplicate items created**

- If using "Create New" strategy, duplicates are expected
- To avoid duplicates, use "Replace" or "Keep Existing"
- Delete duplicates manually if not wanted

## Best Practices

**For Sharing:**

- Export specific characters or chats
- Test import in test instance before sharing
- Document any customizations in export

**For Backups:**

- Export regularly alongside full backups
- Export by feature/topic for organization
- Store exports with descriptive names

**For Migration:**

- Export all data from old instance
- Import into new instance
- Verify all items imported successfully
- Compare item counts

**For Collaboration:**

- Share specific exports with team members
- Use "Keep Existing" when importing collaborative exports
- Coordinate who owns which items

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=system&section=import-export")`

## Related Topics

- [System Tools](system-tools.md) - Overview of all system tools
- [Backup & Restore](system-backup-restore.md) - Full system backup and restore
- [Managing Tasks](system-tasks-queue.md) - Monitoring import/export jobs
