---
url: /scriptorium
---

# The Scriptorium

Consider, if you will, the predicament of the well-read conversationalist who possesses an impressive private library but cannot consult it during discussion. The document mount point system corrects this unfortunate oversight by allowing you to point Quilltap at directories full of documents — your notes, your research, your accumulated wisdom filed away in Markdown, PDF, Word, or plain text — and have their contents indexed, chunked, embedded, and made searchable alongside your memories and conversation history.

## How It Works

A mount point is simply a filesystem path — a directory on your machine (or perhaps an Obsidian vault, if you are the sort of person who maintains such things) that contains documents you wish your AI collaborators to be able to reference. When you create a mount point, Quilltap scans the directory, converts each supported document to plain text, divides that text into semantically coherent chunks, and generates embeddings for each chunk using your configured embedding profile.

### Store Backends

- **Filesystem** — A directory on your own drive, scanned and watched in the traditional manner
- **Obsidian Vault** — A filesystem store with sensible defaults for the Obsidian sort of person (hidden `.obsidian` folders are politely ignored)
- **Database-backed** — An entirely self-contained store that lives inside Quilltap's own encrypted `quilltap-mount-index.db` rather than on disk. Choose this when you want a portable, tamper-resistant reference shelf that travels with your data directory and needs no filesystem path at all. The usual SQLCipher encryption and the 24-hour physical backup sweep apply automatically. Folders are tracked as first-class entities within the store, enabling reliable path resolution and hierarchy management.

### Supported Formats

For filesystem and Obsidian stores:

- **Markdown** (`.md`) — Syntax is stripped; the text beneath remains
- **Plain text** (`.txt`) — Used as-is, because sometimes simplicity is its own reward
- **PDF** (`.pdf`) — Text is extracted; images and formatting are, regrettably, left behind
- **Word documents** (`.docx`) — The raw text is pulled from the elaborate XML machinery within

Database-backed stores accept a wider palette than their filesystem cousins. Markdown, plain text, JSON, and JSONL live as native text in `doc_mount_documents`. PDFs and Word documents are stored in their original binary glory alongside a plain-text extraction used for embedding and searching. Bitmap images (PNG, JPEG, GIF, TIFF, HEIC, HEIF, AVIF) are transcoded to WebP on upload; already-WebP uploads are stored as-is. Any *other* file type — zip archives, audio, video, obscure proprietary formats, the sort of binaries one keeps "just in case" — can be uploaded too. They arrive in the store as blobs with no text representation, ready for a future converter to derive text from them; they will not appear in embedding searches until such a converter exists, but they travel with the store, survive backups, and can be referenced or downloaded at will.

### Unified Uploads and the Blob Layer

Every document store — regardless of backend — may hold binary assets. On database-backed stores, the **Upload** button at the top of the file list is the one-stop entrance for *anything*: Markdown, images, PDFs, Word documents, or arbitrary binaries. Uploaded files slide into the same table as scanned files, with a badge indicating their type and a row you can expand for further details: thumbnail (for images), MIME type, original filename, extraction status, and a description field that feeds the semantic search pipeline.

For PDF and DOCX uploads, Quilltap extracts the plain text at the moment of ingestion, files it alongside the original bytes, chunks it, and enqueues embedding jobs — which means your AI collaborators can search the *contents* of PDFs in the same breath as your Markdown notes, without you having to pre-convert anything. When a character calls `doc_read_file` on a PDF or DOCX in a database-backed store, they receive the extracted text with a small note indicating the content was derived from the binary (the original bytes remain available separately through the blob endpoint).

Reference a blob from any Markdown document in the same store with a relative path:

```markdown
![A portrait of the distinguished Dr Aubergine](images/aubergine.webp)
```

When the document is rendered in a chat with Document Mode open, the image loads from the mount point's blob API endpoint — no public URLs, no off-machine hosting.

### Change Detection

Quilltap keeps your document stores current through two complementary mechanisms. On each startup, a full sweep reconciles every file against its SHA-256 checksum — new files are ingested, modified files are re-chunked, and files that have vanished from the directory have their records quietly removed. While the server is running, a filesystem watcher stands quietly at attention behind each enabled filesystem store: the moment a file is saved, moved, or deleted by any program on your machine, the watcher notices, updates the index, and enqueues a fresh embedding job — generally within a second or two of the change. You need not lift a finger, and you need not restart the server.

Should you prefer to disable the live watcher — or should you find yourself storing documents on a network share where the usual filesystem events are unreliable — set the environment variable `QUILLTAP_WATCHER_POLLING=1` to switch the watcher into a polite polling mode that works universally at the cost of a little extra CPU.

Database-backed stores, having no filesystem to watch, rely instead on an in-process event bridge: every write performed through the `doc_*` tools or the mount-point API is captured at the moment of its arrival and the embedding scheduler is nudged accordingly. The "Scan Now" button on a database-backed store re-emits a write event for each document, which has the practical effect of re-chunking and re-embedding the entire store — useful when you have changed your embedding profile and wish to rebuild the index.

### Chunking

Documents are divided into chunks of approximately 800 to 1,200 tokens each, with a 200-token overlap between consecutive chunks to prevent important context from falling into the cracks between segments. The chunking algorithm respects paragraph boundaries where possible and tracks heading context, so each chunk knows what section of the document it belongs to.

## Managing Document Stores

Document stores are managed from the **Scriptorium** page, accessible via the database icon in the left sidebar. From there you can:

- **Add** a document store by providing a name and filesystem path
- **Classify** each store with a *Contents* label — **Documents** (the default; notes, references, research) or **Character** (character sheets and allied Aurora material). This classification sits alongside the mount type and can be changed at any time from the edit dialog. When a *database-backed* store is created — or flipped — with the **Character** classification, Quilltap lays in a preset scaffold to save you the trouble of carving the furniture yourself: five blank Markdown files (`identity.md`, `description.md`, `personality.md`, `physical-description.md`, `example-dialogues.md`), two seeded JSON files (`properties.json` for `pronouns`, `aliases`, `title`, `firstMessage`, and `talkativeness`, and `physical-prompts.json` for the appearance-prompt quartet), and seven empty folders (`Prompts`, `Scenarios`, `Wardrobe`, `Outfits`, `lore`, `images`, `files`). Existing files are never overwritten, so flipping a populated store to Character simply fills in whatever gaps remain. On each startup, Quilltap also sweeps through every Aurora character that isn't yet linked to a vault, conjures one in the Scriptorium named `<Character Name> Character Vault`, and pours the character's existing identity / description / personality / physical-description / example-dialogues / pronouns / aliases / title / first-message / talkativeness / wardrobe / scenarios / system-prompts into the freshly scaffolded files and folders. The link is recorded on the character (as `characterDocumentMountPointId`) so the sweep never duplicates its work
- **Edit** settings including name, path, mount type, contents classification, include/exclude patterns, and enabled status
- **View** file counts, total size, chunk counts, and scan status at a glance on each store's card
- **Scan** a store to discover new, modified, or deleted files — click the Scan button on any store's card or detail page
- **Convert** a filesystem or Obsidian store *to* database-backed, or **Deconvert** a database-backed store *back* to filesystem — more on this most civilized piece of magic below
- **Delete** a store, which removes all indexed data (the original files on disk are never touched)
- **Inspect** individual files by clicking through to a store's detail page, where you can see each file's type, size, conversion status, embedding chunk count, and last-modified date

You may also manage document stores through the API at `/api/v1/mount-points` if you prefer the programmatic approach.

### One Name Per Shelf, and Casing Doesn't Count

A library in which *Lore* and *lore* are two different rooms is a library designed by a prankster, and the Scriptorium will have none of it. Names here are compared without regard to capitalization, and no two things at the same level may share one:

- **Store names are unique.** Attempting to create or rename a store to a name another store already holds — even dressed in different capitals — is politely declined, and you will be asked to choose another. Stores Quilltap conjures on its own behalf (project file stores, character vaults, and the like) sidestep the collision by appending a discreet ` (2)`, ` (3)`, and so on; two characters who share a name thus receive distinctly named vaults.
- **Folders and files within a database-backed store follow the same rule.** Sibling folders may not differ only by casing, nor may two files at the same path. Writing to `lore/notes.md` when a `Lore` folder already exists simply files the note in `Lore`, keeping the folder's original capitalization; saving over `Notes.md` as `notes.md` updates the existing document rather than minting a shadow copy.
- **Changing only the capitalization of a name is always allowed.** Renaming `notes.md` to `Notes.md`, or `lore` to `Lore`, does exactly what you intend — no spurious "destination already exists" objections.
- **Existing collisions are tidied automatically — and re-checked at every opening.** Should an older library arrive carrying such duplicates, or should some enterprising soul introduce them by rummaging in the database directly, the inspection that runs each time Quilltap starts will find them: the newer of the two is renamed with a ` (2)` suffix (subfolders and files moving with it), and a note of the correction is made in the logs.

Filesystem and Obsidian stores defer to your operating system's own opinions about casing, as they always have.

### Converting Between Backends

Every store card sports a small button for changing its mind about where it keeps its things. Should you decide, mid-career, that your sprawling vault of research notes deserves the encrypted sanctuary of the mount-index database — or, on the contrary, that your database-backed store ought to be let out for a walk on the filesystem — the Scriptorium will oblige without losing so much as a single embedding.

- **Convert** (on filesystem or Obsidian stores) reads every indexed file from disk and tucks its contents inside the encrypted `quilltap-mount-index.db`. Markdown, plain-text, JSON, and JSONL files land in `doc_mount_documents`, while PDFs, Word documents, images, and arbitrary binaries become blobs in the universal blob layer — PDFs and DOCX files gain their extracted-text representation during the move so semantic search keeps working. Your original files are never deleted — they stay on disk as you left them, and you may dispose of them at your leisure afterwards.
- **Deconvert** (on database-backed stores) asks you for a fresh target directory — one that either doesn't exist or is entirely empty — and writes every document and blob out to disk at the same relative paths they occupied inside the database. The store then switches to filesystem-backed and the live watcher begins its polite surveillance of the new home.

In both directions, the existing chunks and their embeddings are **preserved exactly as they are**, so there is no tedious re-embedding to endure, no degradation of the semantic index, and no sudden surge in your embedding-provider bill. Because the underlying `doc_mount_files` rows and their chunk children are kept in place and only the `source` column flips, a store that has been indexed once stays indexed forever — even as its bytes slide back and forth between disk and database.

A small caveat attends the image transcoding pipeline: blobs uploaded as PNG, JPEG, and similar formats are stored as WebP, so a later Deconvert will round-trip those images as `.webp` rather than the format they originally arrived in. This is by design, and the conversion dialog will remind you of it.

### Project Links

A single mount point can be linked to multiple projects, and a project can reference multiple mount points. This many-to-many arrangement means you need only index your research directory once, then make it available to whichever projects require it — like a shared reference shelf in a well-organized office.

### Project File Stores (automatic, per project)

In earlier incarnations of Quilltap, each project kept its attached files as a scattered assortment of loose documents in a folder on disk — a perfectly serviceable arrangement for a shorter correspondence, but hardly fit for a library with pretensions. On first startup after this update, Quilltap quietly promotes every such folder to a proper database-backed document store of its very own, with a name along the lines of *Project Files: Your Project Name*. The files are gathered up and tucked safely inside the encrypted `quilltap-mount-index.db`, the new store is linked to the project that owned them, and the original directory is renamed with a `_doc_store_archive` suffix as a courtesy — proof, should you ever need it, that nothing was lost in the shuffle.

You may dispose of those archived directories at your leisure once you have verified the new stores look correct in the Scriptorium. For the moment, the old file-management pages elsewhere in Quilltap continue to list the legacy entries (a further round of tidying will wire them through to the new stores in a future update), so if you wish to browse, read, or hand files to a character straight away, pop open the Scriptorium and find the *Project Files* store by that name. As with any other database-backed store, the *Scan Now* button will chunk and embed the freshly imported text files so semantic search catches up with the new arrangement.

From this version forward, new writes into a project's file area — story backgrounds minted by The Lantern, character avatars spun up by the wardrobe, and any file a character or a user uploads with a project in context — are deposited **directly** into that project's linked document store rather than onto disk. The old `<filesDir>/{projectId}/` directory is no longer created, nor consulted: every generated image and uploaded blob arrives at the same encrypted table, alongside your notes, as though it had always belonged there. A small internal reference (`mount-blob:{mountPointId}:{blobId}`) keeps the legacy file APIs and preview routes pointing at the correct bytes, so thumbnails, downloads, and in-chat galleries behave exactly as before — only tidier beneath the floorboards. The `project_info` tool, when consulted by a character, now reports the linked store's name and counts in its `get_info` reply, so your collaborators know precisely which shelf their project's files have been placed upon.

Completing the loop: the *Files* card on every project detail page — and, by extension, the *Browse All Files* modal it opens — now reads, uploads to, and deletes from the linked document store directly rather than going through the legacy file API. Opening that card on a project with a linked store will show the very same collection of bytes as the matching *Project Files* entry in the Scriptorium, rendered in the familiar grid or list layout you have always enjoyed. Folder navigation is driven by the file paths themselves (so `images/portrait.webp` appears tidily in a folder called `images`), and uploads drop into whichever folder you are currently browsing. A small subset of controls — *Sync filesystem*, orphan cleanup, *New Folder*, and *Move to project* — are politely hidden in this mode, as they only apply to the old on-disk model; folders appear the moment you upload a file into a new path. You should find the experience indistinguishable from before, except that what you see is now, at last, a faithful view of the underlying document store.

## A Word on Containers

Should you run Quilltap in Docker, a small but consequential fact of container life applies: the container can see only those parts of your machine that were expressly handed to it when it was built. Database-backed stores are untroubled by this — they reside within the encrypted `quilltap-mount-index.db`, which travels inside your data directory and is passed through as a matter of course. Filesystem and Obsidian stores, however, point at whatever corner of your drive you please, and unless that corner has been introduced to the container, it does not exist there at all.

The symptom is a peculiarly convincing one. The store lists its folders and files quite cheerfully, because that listing is drawn from the index kept in Quilltap's own database; it is only when you ask for the actual bytes — reading a document, or creating a folder — that the absence makes itself known. Quilltap will now tell you so in as many words rather than leaving you to puzzle over a failure that names a directory five levels above the one you asked for.

The remedy is arranged for you. The start script consults your document stores before it builds the container and passes each filesystem store through at its own path, so that a store's location means the same thing inside the container as out. To see what it intends to pass through:

```
quilltap docs docker-mounts --instance <name>
```

The one inconvenience worth committing to memory: these passages can only be arranged when a container is *created*, never afterward. A filesystem store added to a container already running is therefore invisible until the container is rebuilt — which the start script will notice and mention, and which you may perform at your convenience:

```
npm run start:docker -- --recreate
```

Rebuilding disturbs nothing you own: your data directory and your document stores are passed through from the host, and only the container itself is replaced. Should you prefer to make these arrangements by hand, `--no-store-mounts` will stay the script's hand entirely.

## Hard Links Between Shelves

As of this revision, a single file in a database-backed document store may inhabit more than one shelf at a time. Imagine the Lantern paints a moody backdrop for your story and deposits the resulting `.webp` into its private gallery; later your character Friday decides she rather likes that very portrait and wishes to keep a copy in her own vault under a different name. In days past, this required minting an entirely new copy of the bytes — duplicate storage, duplicate embedding work, duplicate everything. No longer. The Scriptorium now treats each file's bytes as a single, content-addressable item, and each visible location of it (mount + path) as a hard link in the venerable filesystem sense. Two consumers may point at the same image without copying it; either may rewrite its description or re-extract its caption without disturbing the other; and when the last link to a file is withdrawn, the bytes themselves are politely retired.

This applies only to database-backed mounts; filesystem and Obsidian mounts continue to keep their files on disk where each path is its own physical artefact. The user interface for orchestrating hard links across stores is still in fitting, but the underlying machinery is in place and quietly avoiding duplicate work whenever the same bytes turn up in more than one store.

### One File, Two Shelves — And It Stays That Way

A link made deliberately, with `quilltap docs link`, now behaves as any reader of the old filesystems would expect: the two shelf-marks name **one** document. Amend it at either address and the amendment appears at both, immediately and without ceremony. Search results, character context, and the extracted text on both sides are brought up to date together; only the private annotations — a description you wrote for one shelf, a caption the machinery extracted for the other — remain each location's own business, as they always have.

Do note the distinction between a link and a coincidence. Because Quilltap files bytes by their fingerprint, two documents that happen to be *identical* — two empty files, two copies of the same boilerplate heading — occupy a single shelf beneath the floorboards purely by economy. Those are **not** linked, and editing one leaves the other entirely undisturbed. Only a link you asked for is a link. `quilltap docs ls --links` reports this honestly: the count beside a file is the number of deliberate links to it, not the number of unrelated documents that happen to weigh the same.

A copy (`quilltap docs copy`) is likewise its own document from the moment you make it, notwithstanding that it economises on storage until one side or the other is amended.

Should you dissolve a link by deleting one of its addresses, the survivor reverts to being an ordinary, unaccompanied document. And when a revision leaves an old set of bytes with no shelf-mark at all pointing to it, those bytes are now retired promptly rather than lingering in the cellar — a small housekeeping oversight, corrected, which also sweeps up whatever had accumulated there before.

## Searching Documents

Document chunks appear as a new source type in the unified search tool. When a character searches using the `search` tool, document results appear alongside memories and conversation history, ranked by semantic relevance. Each result includes the source file name, the mount point it belongs to, and the heading context (if the document used headings), so you always know precisely where a piece of information came from.

To search only documents, specify `sources: ["documents"]` in the search tool call. To search everything (the default), simply omit the sources parameter.

## Per-Document Discretion: `embed`, `character_read`, `character_write`

Not every manuscript on your shelves is meant for every pair of eyes. A Markdown document may carry, in the YAML frontmatter at its very head, three small instructions that govern how Quilltap and your characters may treat it:

```yaml
---
embed: false
character_read: false
character_write: false
---
```

Each flag **defaults to true** — which is to say, in the absence of any instruction a document is freely indexed, freely read, and freely amended, exactly as before. You need only declare a flag when you wish to withhold a privilege. The values are agreeably forgiving: you may write them bare (`false`) or quoted (`"false"`), in any case you please, and `no`, `0`, and `off` are all understood to mean the same thing.

- **`embed: false`** keeps the document out of the embedding pipeline entirely, and — should it already have been embedded — quietly erases its vectors. The text remains on the shelf for direct reading, but the document will never again surface as a semantic-search hit. Useful for a volume you wish to keep on hand without it colouring every retrieval.
- **`character_read: false`** draws the curtain: no character may read the document through the `doc_` tools, it is omitted from `doc_list_files` and `doc_grep`, and it will never appear in a character's semantic recall. A character who goes looking for it is told, quite simply, that no such file exists — so a protected manuscript cannot even be *probed for* by name.
- **`character_write: false`** sets the document under glass: a character may not write to it, replace text within it, insert into it, revise its frontmatter or headings, move it, rename it, or delete it. Nor may a character spirit it away by deleting or relocating the folder that contains it — such an attempt fails outright, naming the protected volume.

A word on how the three relate: **`character_read` is the master switch.** A volume a character may not read is, of necessity, one they can neither search for nor amend — so setting `character_read: false` quietly carries the other two false along with it, whatever they may say. You need not write all three to seal a document away; `character_read: false` alone suffices to remove it from your characters' sight, their searches, and their pens at a stroke. The finer-grained pair come into their own only when reading is permitted: a document that characters may *read* but not *embed* (a large reference they should open deliberately rather than have surface in every search), or one they may read but not *write* (a canon you keep authoritative).

Crucially, **these flags govern your characters, never you.** The human at the desk — in Document Mode, the Open-Document picker, or the Brahma Console — sees and edits every document regardless of what its frontmatter says. The flags are the means by which you, the proprietor, keep certain volumes for your own consultation while leaving the rest of the library open to your characters.

Only Markdown documents carry frontmatter, so only they may bear these instructions; other formats (PDFs, plain text, and the like) remain fully accessible as before. And because the flags are read afresh each time a document is re-indexed, the way to change a document's discretion is simply to edit its frontmatter — at the desk, or directly on disk in your editor of choice — and let the Scriptorium take note on its next pass.

## In-Chat Navigation

To navigate to The Scriptorium:

```
help_navigate(url: "/scriptorium")
```
