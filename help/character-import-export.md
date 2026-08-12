---
url: /aurora
---

# Importing and Exporting Characters

> **[Open this page in Quilltap](/aurora)**

This guide covers how to export characters for sharing or backup, and how to import characters created by others or from other tools.

## Character Export

### Why Export Characters

Export characters for:

- **Backup** — Save characters as backup files
- **Sharing** — Share characters with other users
- **Transfer** — Move characters to another device
- **Archival** — Keep permanent records
- **Modification** — Edit exported file, re-import with changes
- **Publishing** — Share character with community

### How to Export a Character

**Method 1: From Character View**

1. Open character to view
2. Click menu (⋮ or ⋯) at top
3. Select **Export** or **Download**
4. Export options appear
5. Choose format (usually JSON)
6. File downloads to computer
7. Saved as "[Character Name].json"

**Method 2: From Character List**

1. Go to Characters page
2. Hover over character or right-click
3. Click **Export**
4. Format options appear
5. Select desired format
6. File downloads

**Method 3: From Character Edit**

1. Open character edit
2. Click menu at top
3. Select **Export**
4. Choose format
5. File downloads

### Export Formats

**JSON Format** (Recommended)

- Format: `.json` file
- Compatibility: Quilltap can re-import
- Content: Complete character data
- Portability: Works across devices
- Editability: Can edit with text editor

**SillyTavern Format** (Compatibility)

- Format: `.json` or `.card.png`
- Compatibility: Import to SillyTavern
- Use: Sharing with SillyTavern users
- Note: Some Quilltap-specific features may not transfer

**Text Format** (Archive)

- Format: `.txt` or `.md` file
- Compatibility: Human-readable
- Use: Archival, human reference
- Note: Cannot re-import

**Multiple Formats Available:**
Some views allow exporting in multiple formats:

- Quilltap native format (most complete)
- SillyTavern format (compatibility)
- Text format (human-readable)
- Markdown format (formatted text)

### Bulk Export

If supported by your view:

1. Select multiple characters
2. Right-click or click **Bulk Actions**
3. Select **Export All**
4. Choose format
5. Exported as `.zip` file containing all characters
6. Download `.zip` with all character files

### Export File Structure

When you export, the file contains:

**Quilltap format (.json):**

```json
{
  "name": "Alice",
  "title": "The Wanderer",
  "description": "...",
  "manifesto": "...",
  "personality": "...",
  "scenarios": [
    { "title": "The Brass Lantern Tavern", "content": "..." },
    { "title": "The Road to Vienna", "content": "..." }
  ],
  "firstMessage": "...",
  "exampleDialogues": "...",
  "systemPrompt": "...",
  "avatar": "...",
  "tags": [...],
  "connectionProfile": "...",
  "imageProfile": "..."
}
```

All character data in one JSON file. The Manifesto field round-trips with Quilltap exports and imports.

### The Vault Travels Too

A Quilltap `.qtap` character export carries more than the dossier above — it
packs the character's entire document vault into the same file:

- **The avatar** (and every alternate portrait), so the character arrives with
  their face rather than a blank silhouette
- **The photograph album** — every image in the vault
- **Correspondence** — the character's `Mail/` folder in full
- **The wardrobe** — `wardrobe.json` and every garment file
- **Conversation summaries** and all other vault documents

When you export characters, the wizard's options step shows what the vaults
add to the bundle — how many documents and images, and roughly how large the
file will be. On import, the vault is restored whole and the avatar resolves
immediately; nothing needs re-uploading. (Exports made by older Quilltap
versions carried no vault; importing one still works, but the character
arrives without photographs or correspondence, and without a face.)

### Backing Up Your Characters

**Best practice backup workflow:**

1. **Periodic bulk export:**
   - Every month/week, export all characters
   - Save as "[Date] Character Backup.zip"
   - Store in safe location

2. **Before major changes:**
   - Export individual characters before major edits
   - Keep backup named "[Character Name] v1.json"
   - Can restore if changes don't work out

3. **Cloud backup:**
   - Download exported files
   - Upload to cloud storage (Drive, Dropbox, etc.)
   - Ensures characters survive computer loss

## Character Import

### Where Do Imported Characters Come From

Import characters from:

- **Your own exports** — Characters you previously exported
- **Other users** — Characters friends shared with you
- **Character libraries** — Public character collections
- **SillyTavern** — Characters from SillyTavern
- **Community sources** — Characters shared online
- **Modified exports** — Your own characters modified as JSON

### How to Import a Character

**Method 1: From Characters Page**

1. Go to **Characters** page
2. Click **Import** or **+ Import Character**
3. Select file from your computer
4. Choose what to import:
   - Create new character from file
   - Or merge with existing character
5. Review import preview
6. Click **Import** or **Confirm**
7. Character imported

**Method 2: Using Drag and Drop**

1. Open Characters page
2. Find character file on computer
3. Drag and drop onto Characters page
4. Import dialog appears
5. Confirm options
6. Character imported

**Method 3: From File Manager**

1. Right-click character file
2. Select "Open with" if available
3. Opens in Quilltap
4. Automatically imports

### Import File Formats

**Quilltap Format (.json)**

- Full compatibility
- All character data imports perfectly
- Recommended for backup/restore

**SillyTavern Format**

- Generally compatible
- Most data transfers over
- Some features may not transfer
- Image handling may differ

**Other JSON Formats**

- May be partially compatible
- Import attempt may work
- May need manual adjustment after import

### Import Preview

Before finalizing import, see preview of:

- Character name
- Description
- Key attributes
- Tags
- Avatar/image

**Option to:**

- Import as-is
- Change character name during import
- Adjust settings
- Cancel import

### Handling Import Issues

**Issue: Character imports but name is weird**

1. Edit character after import
2. Change name as desired
3. Save

**Issue: Avatar/image doesn't import**

1. Character imports without image
2. Edit character
3. Upload new avatar
4. Re-save

**Issue: System prompt looks wrong**

1. Character imported with original prompt
2. Edit System Prompts tab
3. Correct or replace prompt
4. Save

**Issue: Tags don't exist in new Quilltap**

1. Import creates tags automatically
2. Tags appear if needed
3. Can reorganize after import

### Importing Multiple Characters

**Bulk Import:**

1. Have exported `.zip` file with characters
2. Go to Characters page
3. Click **Import Multiple** or drag `.zip`
4. All characters import
5. Creates any necessary tags
6. Characters now available in system

### SillyTavern Compatibility

If importing from SillyTavern:

**What imports well:**

- Character name ✓
- Description ✓
- Personality ✓
- Scenario ✓ (imported as a single scenario in the scenarios list)
- First message ✓
- Example dialogues ✓
- Avatar image ✓

**What may not transfer:**

- Manifesto (SillyTavern has no equivalent — the field will be empty on round-trip)
- Custom system prompts (may need re-creation)
- External links (may break)
- Special formatting (may lose structure)
- Character relationships (need manual setup)

**Best practice for SillyTavern import:**

1. Import character
2. Review system prompt
3. Adjust if needed for your LLM
4. Test character in chat
5. Make any necessary adjustments

## Sharing Characters

### How to Share Exported Characters

**Send to Friend:**

1. Export character as JSON
2. Email the `.json` file to friend
3. Friend downloads file
4. Friend imports in their Quilltap

**Share on Forum/Community:**

1. Export character
2. Post `.json` file to community
3. Others download and import
4. Character shared with community

**Share as Attachment:**

1. Export character
2. Share via messaging app
3. Recipient imports when downloaded
4. Works cross-platform

### Sharing Best Practices

| Do | Don't |
|----|-------|
| Include character description with file | Share without context |
| Note any special setup required | Assume others know character |
| Include version number | Keep overwriting old versions |
| Test before sharing | Share untested character |
| Note any dependencies | Assume character works standalone |

### Collaboration Workflow

**When collaborating on character:**

1. One person creates and exports character
2. Sends to collaborator
3. Collaborator imports and makes edits
4. Exports modified version
5. Original person imports updated version
6. Continue back and forth as needed

## Advanced Import/Export

### Editing Exported Characters (JSON)

If you're comfortable with JSON, you can edit directly:

1. Export character
2. Open the `.qtap` file in a text editor — it's newline-delimited JSON, one entity per line
3. Find the line whose first field is `"kind":"character"` and edit fields inside its `"data":{...}` object:

   ```json
   {"kind":"character","data":{"name":"New Name","description":"New description..."}}
   ```

4. Save file (keep the newline-per-record structure intact)
5. Re-import in Quilltap

**Caution:** JSON syntax must be valid on every line or the import will fail with a specific line number.

### Creating Characters from JSON

If you know JSON structure:

1. Create new `.json` file
2. Follow Quilltap character JSON structure
3. Fill in all required fields
4. Save as `.json`
5. Import in Quilltap

**Quilltap Character JSON Structure:**

```json
{
  "name": "Character Name",
  "title": "Character Title",
  "description": "Full description text",
  "manifesto": "Foundational tenets and load-bearing truths",
  "personality": "Personality traits",
  "scenarios": [
    { "title": "Scenario Title", "content": "Setting/scenario description" }
  ],
  "firstMessage": "Opening message",
  "exampleDialogues": "Example conversations",
  "systemPrompt": "AI instructions",
  "avatar": "image or URL",
  "tags": ["tag1", "tag2"],
  "connectionProfile": null,
  "imageProfile": null
}
```

Note that `scenarios` is an array of objects with `title` and `content` fields. A character may have zero, one, or many scenarios. The SillyTavern format uses a single `"scenario"` string field, which Quilltap imports as a single entry in the scenarios list. The `manifesto` field is optional and Quilltap-specific.

### Batch Import/Export with Scripts

For power users with technical knowledge:

1. Character files can be processed with scripts
2. Automate batch operations
3. Transfer characters between systems
4. Requires command-line knowledge

**Not covered in this guide** — See technical documentation if needed.

## Cloud Backup Strategy

### Using Cloud Storage

**Setup:**

1. Export all characters regularly
2. Save exports to computer
3. Upload to cloud storage (Google Drive, Dropbox, iCloud)
4. Automatic sync ensures backup

**Recovery:**

1. If needed, download from cloud storage
2. Import characters back into Quilltap
3. Restore full collection

**Benefits:**

- Automatic backup
- Access from multiple devices
- Safe offsite storage
- Easy to share backups

### Backup Naming Convention

Use clear naming for backups:

```
Character Backups/
├── 2024-01-15 Full Backup.zip
├── 2024-02-01 Full Backup.zip
├── Alice v1.json (original)
├── Alice v2.json (revised)
└── Alice v3.json (final)
```

This makes it easy to:

- Find backups by date
- Track character versions
- Restore specific versions

## Troubleshooting Import/Export

### Problem: Export File Won't Download

**Solution:**

1. Check browser settings
2. Allow downloads
3. Check download location
4. Try again
5. Try different format

### Problem: Import Says File is Invalid

**Solution:**

1. Ensure file is `.json` or `.json.png`
2. Check file isn't corrupted
3. Try exporting fresh character
4. Try importing to test

### Problem: Character Imports But Data is Wrong

**Solution:**

1. Check original character
2. If export was wrong, re-export
3. Manually edit character after import
4. Test character

### Problem: SillyTavern Character Won't Import

**Solution:**

1. Ensure file is valid SillyTavern format
2. Try re-export from SillyTavern
3. Import may partially work — fix manually after
4. Contact support with specific format issue

### Problem: Bulk Import Creates Duplicates

**Solution:**

1. Check if characters already exist
2. If accidental duplicates, delete extras
3. Be careful importing same file twice
4. Always check before bulk import

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora")`

## Related Topics

- [Characters Overview](characters.md) — About the character system
- [Creating Characters](character-creation.md) — Making new characters
- [Character Management](character-management.md) — Deletion and relationships
- [Organizing Characters](character-organization.md) — Tags and filtering
- [Chats](chats.md) — Using characters in conversations
