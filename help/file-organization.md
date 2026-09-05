---
url: /files
---

# File Organization and Folder Management

> **[Open this page in Quilltap](/files)**

Learn how to organize your files using folders and create a file structure that makes sense for your workflow.

## Understanding File Organization

### Why Organize Files?

Good file organization helps you:

- **Find files quickly** — Know where files are without searching
- **Prevent duplicates** — See all files in one place
- **Manage projects** — Keep related files together
- **Share with AI** — Help the AI understand file context
- **Stay productive** — Less time searching, more time working
- **Plan better** — Visual overview of what you have

### Flat vs. Hierarchical Organization

**Flat Structure:**

- All files in root folder `/`
- Simple but gets messy with many files
- Hard to find things
- Good for: Small projects with few files

**Hierarchical Structure:**

- Files organized in folders and subfolders
- Logical structure matching workflow
- Easy to navigate and find things
- Good for: Complex projects, many files

**Recommended:** Use hierarchical structure with meaningful folder names

## Creating Your Folder Structure

### Planning Folder Organization

**Before creating folders, think about your workflow:**

Ask yourself:

- What types of files do I have?
- How do I use them?
- Who needs to access them?
- How will I search for them?

### Common Folder Structures

**By Content Type:**

```
/
├── Documents/
├── Images/
├── Code/
├── Audio/
└── Video/
```

**By Project:**

```
/
├── Novel-Project/
├── Game-Dev/
├── Game-Art/
└── Business/
```

**By Date:**

```
/
├── 2024/
│   ├── Q1/
│   ├── Q2/
│   └── Projects/
└── 2025/
    ├── Q1/
    └── Projects/
```

**By Purpose (Recommended):**

```
/
├── References/          (Research, inspiration)
├── Active-Projects/     (Current work)
├── Completed/          (Finished projects)
├── Characters/         (Character files)
├── World-Building/     (Setting/location info)
└── Archive/           (Old or rarely used)
```

**Hybrid Approach:**

```
/
├── Projects/
│   ├── Novel-2025/
│   │   ├── Characters/
│   │   ├── Locations/
│   │   ├── Research/
│   │   └── Drafts/
│   └── Game-Design/
│       ├── Mechanics/
│       ├── Art-Concepts/
│       └── References/
├── Resources/
│   ├── Fonts/
│   ├── Templates/
│   └── Tools/
└── Archive/
```

## Working with Folders

### Creating a Folder

**Step by step:**

1. Navigate to parent folder (where you want the new folder)
2. Look for **New Folder**, **+ Folder**, or **Create Folder** button
3. Click the button
4. Dialog appears asking for folder name
5. Type desired name (e.g., "Characters", "2025-Projects")
6. Press Enter or click Create
7. New folder appears in file list

**Naming tips:**

- Be descriptive and concise
- Use hyphens or underscores instead of spaces
- Example: `Novel-2025` (not `novel  2025!`)
- Numbers at start help with sorting: `01-Research`, `02-Drafts`

### Navigating to a Folder

**Using Breadcrumb:**

- Shows current path: `/` > `Projects` > `Novel-2025`
- Click any part to jump to that folder
- Click `/` to go to root

**Using File List:**

- Double-click folder icon to enter
- Or single-click and press Enter
- Folder opens and shows contents

**Going Back:**

- Click back/up arrow button (↑ or ←)
- Or click parent folder name in breadcrumb
- Moves to parent directory

### Moving Within Folder Structure

**Navigation Example:**

Starting at root (`/`):

1. Double-click `Projects` folder
2. You're now in `/Projects/`
3. Double-click `Novel-2025` folder
4. You're now in `/Projects/Novel-2025/`
5. See `Characters/`, `Locations/`, `Research/` folders
6. Double-click `Characters` to see character files
7. Click up arrow or breadcrumb to go back to `/Projects/Novel-2025/`

### Renaming a Folder

To change a folder's name:

1. Right-click the folder
2. Select **Rename** from context menu
3. Or find rename button near folder
4. Folder name becomes editable
5. Type new name
6. Press Enter or click Save
7. Folder renamed (files inside unaffected)

**Important:** Renaming doesn't move files or break references

### Deleting a Folder

To remove an empty folder:

1. Make sure folder is empty (move/delete files first)
2. Right-click the folder
3. Select **Delete**
4. Confirm deletion
5. Folder removed

**Can't delete?**

- Folder still contains files
- Move files to another location first
- Then delete empty folder

**Folder not truly deleted:**

- Can often be recovered from backups
- Contact administrator if urgent recovery needed

## Moving Files Between Folders

### Moving a Single File

**Method 1: Using Move Command:**

1. Right-click file
2. Select **Move** or **Move To**
3. Choose destination folder from tree
4. Confirm move
5. File appears in new folder

**Method 2: Cut and Paste:**

1. Right-click file
2. Select **Cut**
3. Navigate to destination folder
4. Right-click empty area
5. Select **Paste**
6. File moved to new location

**Method 3: Drag and Drop:**

1. Click and hold file
2. Drag to folder (if visible)
3. Drop onto destination folder
4. File moves to that folder

### Moving Multiple Files

**Selecting multiple files:**

1. Click first file
2. Hold Ctrl (Windows) or Cmd (Mac) and click other files
3. Or drag-select across multiple files
4. All selected files highlighted

**Moving selected files:**

1. Once selected, right-click
2. Choose **Move**
3. Select destination
4. All files move together

### Moving to Different Projects

**Project files vs. General files:**

- General files accessible in any chat
- Project files only in that project

**To move to a project:**

1. Right-click file in general storage
2. Select **Move to Project**
3. Choose target project
4. Choose the **Folder** within that project — the dropdown lists the project's
   existing folders, nested children indented beneath their parents, and the
   **+** button beside it will run up a new folder on the spot
5. File becomes project-specific

The Folder dropdown refreshes whenever you change the destination, so a file may
be despatched straight to its proper shelf rather than being dropped in the
project's front hall and shuffled along afterwards. A project with no folders of
its own offers only **/ (Root)**, which is precisely as it should be.

**To move to general storage:**

1. From project file browser, right-click file
2. Select **Move to General Files**
3. File becomes accessible globally

### Important Notes About Moving

**References stay intact:**

- Character profile images still reference file
- Chat attachments still find moved file
- Associations are preserved

**Undo not available:**

- Moving is permanent once completed
- Make note of new location
- Keep backup if critical

## Organizing Existing Files

### If You Have Unorganized Files

**Step 1: Audit what you have**

- Go through all files
- Take note of types and purposes
- Identify duplicates

**Step 2: Create folder structure**

- Design logical hierarchy
- Create folders first
- Don't move files yet

**Step 3: Move files into folders**

- Start with one category
- Move all files of that type
- Work through each category

**Step 4: Consolidate duplicates**

- Delete duplicate files (keep best version)
- Verify no file references the deleted version
- Update links if needed

### Bulk Operations

**Moving many files:**

1. Create all destination folders first
2. In file browser, select first group of files (Ctrl+Click)
3. Move group to destination
4. Repeat for other groups
5. More efficient than one-by-one

**Renaming conventions:**

If files need renaming:

1. Create new files with correct names in correct folders
2. Copy old content to new files
3. Delete old files once verified
4. Or move files and rename individually

### Reorganizing Without Losing Data

**Safe reorganization:**

1. Create new folder structure first
2. Copy files to new locations (don't move yet)
3. Verify all files copied successfully
4. Test that everything still works
5. Then delete old files from old locations

**Backup first:**

- Download entire file library
- Store external backup
- Then reorganize with confidence

## Folder Naming Best Practices

### Effective Folder Names

**Good names:**

- `Characters` — Clear purpose
- `2025-Research` — Includes date
- `World-Building` — Hyphenated for clarity
- `Active-Projects` — Current work
- `Archive-2024` — Old material

**Poor names:**

- `stuff` — Too vague
- `Files` — Not descriptive
- `temporary` — Ambiguous status
- `New Folder` — Default name
- `AAAA` — Not meaningful

### Naming Conventions

**Consistency:**

- Use same style across all folders
- Pick: lowercase, UPPERCASE, or Title-Case
- Stick with hyphens or underscores

**Clarity:**

- Name describes contents clearly
- Other people should understand purpose
- Can read names quickly when browsing

**Sorting:**

- Use numbers for sequence: `01-First`, `02-Second`
- Or use dates: `2025-01-31-backup`
- Helps maintain order

## Common Organization Mistakes

### Mistake 1: Too Many Levels

**Problem:**

```
/Project/SubProject/Category/Type/Version/Final/
```

Gets confusing and hard to navigate

**Solution:**

- Keep 3-4 levels maximum
- `/Project/Category/Version/` is usually enough

### Mistake 2: Inconsistent Naming

**Problem:**

- `/characters/` in one place
- `/Characters` elsewhere
- `/CHARACTERS` in another

**Solution:**

- Pick one naming style
- Apply consistently everywhere

### Mistake 3: Vague Names

**Problem:**

- `/stuff/`, `/data/`, `/test/`
- Can't remember what's inside

**Solution:**

- Use descriptive names
- `Novel-Research`, `Character-Bios`, `Plot-Ideas`

### Mistake 4: Too Flat

**Problem:**

- 500 files in root folder
- Impossible to find anything

**Solution:**

- Create folders by category
- Organize into manageable groups

### Mistake 5: Forgotten Archives

**Problem:**

- Old project files clutter directory
- Can't tell what's still active

**Solution:**

- Create `/Archive/` folder
- Move old projects there
- Keeps current directory clean

## Folder Management Workflow

### Starting Fresh

1. **Create main categories:**
   - `/Active-Projects/`
   - `/Resources/`
   - `/References/`
   - `/Archive/`

2. **Within each, create project folders:**
   - `/Active-Projects/Novel-2025/`
   - `/Active-Projects/Game-Design/`

3. **Within each project, create subsections:**
   - `/Active-Projects/Novel-2025/Characters/`
   - `/Active-Projects/Novel-2025/Locations/`

4. **Upload files to appropriate folders:**
   - Character images → `Characters/`
   - Location descriptions → `Locations/`

5. **Maintain regularly:**
   - Move completed projects to Archive
   - Delete duplicates monthly
   - Keep structure consistent

### Maintenance Checklist

**Monthly:**

- ☐ Delete duplicate files
- ☐ Check for files with generic names
- ☐ Move completed projects to Archive
- ☐ Verify folder structure makes sense

**Quarterly:**

- ☐ Review Archive folder
- ☐ Delete old backups if no longer needed
- ☐ Reorganize if structure not working
- ☐ Add descriptions to important files

**Annually:**

- ☐ Full audit of all files
- ☐ Delete anything not needed
- ☐ Backup entire library
- ☐ Plan next year's folder structure

## Folder Limitations

### What You Should Know

**Folder count:**

- No fixed limit
- Practical limit before interface gets slow: 1000+ folders
- Organize smartly to avoid extreme nesting

**Naming length:**

- Maximum characters: Usually 255
- Keep names shorter (< 50 chars) for readability

**Nesting depth:**

- No hard limit technically
- Practical: 5-6 levels maximum before confusing
- Keep structures 3-4 levels for best usability

**Performance:**

- Folders with 10,000+ files get slow
- Split very large folders into subfolders
- Use search/filter instead of browsing huge folders

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/files")`

## Related Topics

- [File Management](files.md) — Browse and manage files
- [Uploading Files](file-uploads.md) — Add files to folders
- [File Search](search.md) — Find files by name or content
- [Projects](projects.md) — Organize files by project
- [Data Directory](data-directory.md) — Configure storage location
