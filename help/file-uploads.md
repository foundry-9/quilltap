---
url: /files
---

# Uploading Files

> **[Open this page in Quilltap](/files)**

Learn how to upload files to Quilltap for use in projects, chats, and character profiles.

## File Upload Overview

Uploading files to Quilltap allows you to:

- Store files in your general file library
- Use files in character profiles (images)
- Attach files to chat messages
- Create folders and organize content
- Give the AI access to files for analysis and processing

## Where You Can Upload

### General Files Page

Upload to your general file library (accessible in any chat):

1. Click **Files** in the sidebar
2. Navigate to desired folder (or stay in root)
3. Click **Upload** button
4. Select file(s) from your computer
5. Files upload to current folder

### In a Chat

Attach files to individual messages:

1. In chat composer, look for **+ Attach** or **📎** icon
2. Click to select file(s)
3. Files appear as attachments below the message
4. Send message with attachments

**After sending:**

- Attachments shown in message
- Can be downloaded from chat
- Can be promoted to permanent files

**A word on pictures.** An image attached to a chat is quietly shown to a
describing model shortly after it lands (see [Chat Settings](chat-settings.md)),
and the description is filed in three places: on the file's own record, on
every shelf in the [Scriptorium](scriptorium.md) where those same bytes appear,
and in the search index — so *"the photograph of the kettle on the windowsill"*
finds the picture later even though a picture holds no words. Until 4.9.0 only
the first of the three was reached for any bitmap the house converted to WebP
on its way in, which was rather a lot of them; converted uploads made before
that release are repaired on first start.

### Character Profiles

Upload images for character profiles:

1. Go to **Characters**
2. Create or edit a character
3. Look for **Add Profile Picture** or **Upload Avatar**
4. Click to select image file
5. Image set as character profile picture

### Projects

Upload files to a project's file storage:

1. Go to **Projects**
2. Open a specific project
3. Go to **Files** tab within project
4. Click **Upload**
5. Select file(s)
6. Files stored in project (only accessible in that project)

## File Upload Methods

### Method 1: Browse and Select

The standard file upload method:

1. Click **Upload** button
2. Your system file browser opens
3. Navigate to file location
4. Click file to select it
5. Click **Open** or **Choose** button
6. File uploads

### Method 2: Multiple File Selection

Upload several files at once:

1. Click **Upload** button
2. In file browser, select multiple files:
   - **Windows/Linux:** Hold `Ctrl` and click each file
   - **Mac:** Hold `Cmd` and click each file
   - Or drag-select to highlight multiple files
3. Click **Open**
4. All selected files upload together

### Method 3: Drag and Drop

Quick upload by dragging files:

1. Open file browser on your computer (File Explorer, Finder, etc.)
2. Arrange windows so both are visible
3. Drag file(s) from file browser onto Quilltap
4. Drop onto the file browser area or upload zone
5. File(s) upload automatically

**Note:** Some browsers or locations may not support drag-and-drop

## Upload Settings

### Choosing Upload Location

**In General Files:**

1. Navigate to desired folder first
2. Click Upload
3. Files upload to current folder (shown in breadcrumb)

**In Projects:**

1. Open project
2. Go to Files tab
3. Navigate to project folder
4. Click Upload
5. Files upload to that project folder

**Specifying Folder During Upload:**

After selecting file(s):

1. Some interfaces show folder selector
2. Choose destination folder from tree
3. Click **Upload to [folder]**
4. Files upload to specified location

### File Organization

**Best Practice:**

Create a folder structure first, then upload:

1. Go to Files page
2. Create main folders: `/Images/`, `/Documents/`, `/Code/`
3. Create subfolders: `/Images/Characters/`, `/Images/Items/`
4. Upload files to appropriate subfolder

### Supported File Types

**Quilltap accepts all common file types:**

**Documents:**

- PDF, DOCX, DOC, ODT, RTF
- PPTX, PPT (presentations)
- XLSX, XLS, ODS (spreadsheets)
- CSV, TSV

**Images:**

- JPG/JPEG
- PNG
- GIF (animated or static)
- WebP
- SVG
- BMP
- TIFF
- ICO

**Text & Code:**

- TXT, MD (Markdown)
- JSON, XML, YAML
- JavaScript, TypeScript, Python, Java, C++, C#, Ruby, Go, Rust, PHP, etc.
- CSS, HTML, SCSS, LESS
- And many more code languages

**Media:**

- MP3, WAV, FLAC, OGG (audio)
- MP4, AVI, MOV, WebM, MKV (video)
- GIF, WebP (animations)

**Archives:**

- ZIP, RAR, 7Z, TAR, GZ, BZ2
- ISO disk images

**Other:**

- EXE, DLL, SO (if needed for reference)
- Any other file type

**If Unsupported:**

Quilltap may not be able to preview or process the file, but can still store and serve it. Contact support if you have specific file type needs.

## Upload Progress and Status

### Upload States

**Uploading:**

- Progress bar shows percentage complete
- Cannot perform other operations while uploading
- Shows current file name and size

**Completed:**

- Success message appears
- File shows in file browser immediately
- Can upload more files

**Failed:**

- Error message explains problem
- Can retry upload
- Check file size and type

### Monitoring Upload

During upload:

- Progress percentage displayed (0-100%)
- Estimated time remaining (sometimes)
- File name and size shown
- Cancel button available (if supported)

## File Size Limits

### General Size Information

- **Small files** (< 10 MB) — Upload instantly
- **Medium files** (10-100 MB) — Upload within seconds
- **Large files** (100 MB - 1 GB) — May take minutes depending on connection
- **Very large files** — Check with administrator for limits

### Storage Limits

**Total Storage:**

- Varies by installation and plan
- Check your account/settings for usage
- If storage full, must delete files before uploading more

**Individual File:**

- Most files under 1 GB work fine
- Extremely large files (> 5 GB) may have issues
- Contact support for very large files

### Speeding Up Uploads

**For slow uploads:**

1. **Check connection** — Use fast WiFi or ethernet
2. **Close other apps** — Free up bandwidth
3. **Upload smaller files** — Break large files into multiple
4. **Upload off-peak** — If on shared connection
5. **Compress files** — ZIP or compress before uploading

## Organizing During Upload

### Creating Folders Before Upload

**Recommended workflow:**

1. Go to Files page
2. Create folder structure you want
3. Navigate to first folder
4. Upload files for that folder
5. Navigate to next folder
6. Upload files for that folder

**Example:** Create `/Research/` folder first, then upload research documents into it

### Sorting Into Folders

**After uploading:**

1. Upload everything to root first
2. Create folder structure
3. Use Move operation to sort into folders
4. Or manually move each file

**Advantage:** Don't worry about folder during upload, organize after

## Tips for Better File Uploads

### Naming Files

**Good names:**

- Descriptive and clear
- Use dates for versions: `2025-01-31-proposal.docx`
- Include file type in name: `budget-2025.xlsx`
- Avoid spaces if possible: `use-hyphens-or_underscores`

**Poor names:**

- `file.txt` (not descriptive)
- `Document 1.pdf` (vague)
- `FINAL_v3_UPDATED_REAL (1).docx` (version tracking)

### Using Descriptions

Add descriptions when available:

1. After uploading, right-click file
2. Click **Edit Details** or **Add Description**
3. Write what the file contains
4. Descriptions visible in search and hover

### Batch Organization

**Upload many files:**

1. Create all folders first
2. Upload all files to root
3. Sort into folders (use move/rename)
4. Add descriptions in batch if possible

**Saves time vs. uploading to individual folders**

### Backup Important Files

**Before uploading:**

- Keep backup on your computer
- Important files should be in version control (Git)
- Critical data should be backed up externally

**After uploading:**

- Quilltap stores safely
- Download periodically for backup
- Use The Forge > File Storage to backup entire library

## Uploading from Different Locations

### From Computer Files

Covered above — use Browse or Drag-and-Drop

### From URL/Web

**If supported:**

1. Some systems support URL import
2. Paste URL of file online
3. File downloads and saves to Quilltap

**If not available:**

- Download file to computer first
- Then upload via standard method

### From Another Service

**Copy-paste content:**

1. Open text file in text editor or view
2. Copy all content (Ctrl+A, Ctrl+C)
3. In Quilltap, create new file
4. Paste content
5. Save as new file

### From Mobile

If accessing Quilltap on mobile:

1. Tap **Upload** button
2. Choose file from mobile device
3. Select from Photos, Files app, etc.
4. File uploads same as desktop

## Troubleshooting Upload Issues

### Upload fails immediately

**Causes:**

- File too large
- Unsupported file type
- Network not connected
- Storage full

**Solutions:**

- Check file size limits
- Verify file type supported
- Check internet connection
- Delete old files to free space

### Upload starts but stops

**Causes:**

- Network disconnected mid-upload
- Browser closed or page navigated away
- Upload timeout
- Storage issue

**Solutions:**

- Check internet connection
- Keep page open during upload
- Try uploading again
- Try smaller file

### File uploads but doesn't appear

**Causes:**

- Upload still processing
- Uploaded to wrong folder
- Page not refreshed
- Upload partially failed

**Solutions:**

- Wait a moment for processing
- Check current folder (breadcrumb)
- Refresh page (Ctrl+R or Cmd+R)
- Try uploading again

### Can't access uploaded file

**Causes:**

- Wrong permissions
- File uploaded to wrong location (project vs. general)
- File deleted
- Corrupted during upload

**Solutions:**

- Check file location (breadcrumb path)
- Verify file still exists in file browser
- If uploading for project, check it's in project folder
- Re-upload if corrupted

### Large file upload very slow

**Causes:**

- Large file size
- Slow internet connection
- Server processing
- Background tasks

**Solutions:**

- Use faster internet (wired vs. WiFi)
- Upload off-peak if shared network
- Compress file before uploading
- Close other apps using bandwidth
- Try uploading smaller files first

### "Storage quota exceeded"

**Problem:** Can't upload more files

**Solutions:**

- Delete unnecessary files
- Archive old files to external drive
- Download files you don't need to keep
- Contact administrator for more storage
- Upgrade plan if applicable

## Security Considerations

### File Privacy

- Files are stored securely in your installation
- Only you can access your files
- Files in projects shared with project members
- General files not shared with other users

### Sensitive Data

**Be careful with:**

- Passwords and API keys (use Settings for these instead)
- Personal identifying information
- Financial records
- Health/medical information
- Confidential business data

**Best practices:**

- Don't store passwords in text files
- Encrypt sensitive files before uploading
- Consider using project privacy settings
- Review what AI can access

### File Integrity

- Files checked for viruses by server (if enabled)
- Don't upload files from untrusted sources
- Verify file integrity if downloading
- Keep backups of critical files

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/files")`

## Related Topics

- [File Management](files.md) — Browse and manage uploaded files
- [Projects](projects.md) — Organize files by project
- [Characters](characters.md) — Upload character profile pictures
- [Chats](chats.md) — Attach files to messages
- [Data Directory](data-directory.md) — Configure storage location
