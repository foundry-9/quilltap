---
url: /settings?tab=chat
---

# Document Editing Tools

Quilltap's document editing tools — a suite of fifteen instruments bearing the distinguished `doc_*` prefix — grant your AI characters the ability to read, edit, search, and manage files stored in document stores, project files, and general files, all without leaving the conversation. Think of them as the well-trained staff of a private library: capable of fetching any volume, making careful annotations, reorganizing the shelves, and — when instructed with appropriate gravity — disposing of materials that have outlived their usefulness.

## Prerequisites

These tools require:

1. A **project** associated with the chat
2. At least one **document store** linked to the project (for the `document_store` scope)

Configure document stores from **The Scriptorium** page and link them to projects from the project detail page.

## Scopes

Every `doc_*` tool accepts a `scope` parameter that determines where it operates:

- **`document_store`** (default) — Files within mounted document stores. Requires a `mount_point` parameter specifying which store to use. A `mount_point` may be given as the store's name *or* its identifier; a character may also reach into their **own** character vault with the reserved word `"self"` (see below).
- **`project`** — Files stored in the project's own file area.
- **`general`** — Files in the general (non-project) file storage.
- **`group`** — Files in the document stores of the Groups the responding character belongs to. Available on `doc_list_files` (to enumerate just the group shelves) and on `search` (to confine a search to them). A character that belongs to no Groups sees nothing under this scope. Because membership is personal, a character only ever reaches *their own* Groups' stores — never a companion's.

## The `self` shorthand for one's own vault

Every character who keeps a personal vault may address it with the reserved `mount_point` value **`"self"`** — a standing latchkey to one's own private study. It works wherever a `doc_*` tool takes a `mount_point` (and as `source_mount_point` / `dest_mount_point` on `doc_copy_file`, and on the `doc_*_blob` family); it confines `doc_list_files` and `doc_grep` to the vault alone:

```
doc_read_file(scope: "document_store", mount_point: "self", path: "Mail/letter-001.md")
doc_list_files(mount_point: "self")
```

The convenience is twofold. A character need not recall the formal title its vault was christened with, and should that title ever change, `"self"` keeps pointing true. The vault's actual name and identifier continue to work exactly as before — `"self"` is an addition, never a replacement. The shorthand resolves only for the character acting as itself; an operator or a non-character caller falls through to ordinary name-and-identifier matching, so a store one has genuinely *named* "self" remains reachable in those contexts.

## A single address for any document: the `qtap://` URI

Where the older custom hands one a *bundle* of parameters — a scope here, a mount point there, a path besides — there is now a single, tidy way to name any document the Scriptorium can reach: the **`qtap://` URI**. It is, simply, all three particulars folded into one address-card:

```
qtap://<authority>/<path within the store>
```

Every `doc_*` tool accepts an optional **`uri`** parameter. When you supply it, it supersedes `scope`, `mount_point`, and `path` — pass the one or the other, whichever suits:

```
doc_read_file({ uri: "qtap://self/Mail/1781578632981-from-friday.md" })
doc_write_file({ uri: "qtap://Project Files/Knowledge/rank_markings.md", content: "…" })
```

The **authority** — the part just after `qtap://` — is read in this order:

- **`self`** — your own vault, exactly as the shorthand above (`qtap://self/Backstory.md`).
- **`project`** — the project's own file area (`qtap://project/Outline.md`).
- **`general`** — the general, non-project shelf (`qtap://general/Scenarios/intro.md`).
- **anything else** — a document store's **name** (the readable, preferred form) or, when a name is shared by more than one store, its **UUID** (the unambiguous escape hatch): `qtap://Voyages of the Covenant/notes/today.md` or `qtap://550e8400-e29b-41d4-a716-446655440000/notes/today.md`.

The three reserved words — `self`, `project`, `general` — always win the authority slot. Should you keep a store genuinely *named* one of them, reach it by its UUID. Names bearing spaces, colons, and other such particulars are percent-encoded in the canonical form (a colon becomes `%3A`, a space `%20`), though a literal colon is graciously accepted on the way in.

These URIs are not merely accepted — they are now what Quilltap *hands back*. Tool results, the self-inventory, search results, and the staff's whispers (Prospero, the Librarian, Suparṇā at the Post Office) all quote documents by their `qtap://` address. And in The Salon, a `qtap://` URI pointing at a document that genuinely exists is rendered as a tidy, clickable link — one tap opens it in the document pane. (A URI for a missing or unreachable document stays plain, unclickable text, lest you be sent chasing a phantom.)

## Available Tools

### Reading & Searching

- **`doc_read_file`** — Read file contents with optional line-range pagination
- **`doc_list_files`** — List files across stores, with optional folder, glob pattern, and scope filters. By courtesy it omits the housekeeping clutter — hidden operating-system files (`.DS_Store` and its ilk) and the Estate's own auto-generated portraits and backdrops (anything resting in a `character-avatars` or `story-backgrounds` folder). Should one genuinely wish to see those incidental images, pass `includeAutomaticImages: true`; images a character has deliberately saved to an album live elsewhere and are always shown.
- **`doc_grep`** — Search for text across files using literal or regex patterns, with context lines
- **`doc_read_frontmatter`** — Read YAML frontmatter from a markdown file
- **`doc_read_heading`** — Read all content under a specific heading in a markdown file

## Working with JSON and JSONL

Quilltap treats JSON and JSONL files as first-class document types alongside Markdown and plain text:

- **`.json` files**: `doc_read_file` returns the parsed object or array in the response's `content` field, with `parsed: true` and the original string in `rawContent`. `doc_write_file` accepts either a JSON string (validated) or a native JavaScript object or array (serialized canonically with indentation). Write failures include a clear error message if the JSON is invalid.

- **`.jsonl` and `.ndjson` files**: These newline-delimited JSON formats are supported. Reads return an array of per-line parse results — each entry is `{ line, value?, error? }` — so one malformed line does not corrupt the rest of the file. Writes require an array value (for `doc_write_file`), with each element serialized as one JSON line.

- **`doc_str_replace` on JSON files**: This tool operates on the raw serialized string rather than the parsed structure. For structural edits (adding/removing/modifying keys), prefer `doc_write_file` with a native object — it avoids string-based fragility and returns canonical, well-formatted output.

- **Validation on write**: Invalid JSON is rejected immediately with a descriptive error, preventing corruption of your structured data.

### Editing

- **`doc_write_file`** — Write or create a file (replaces entire contents). For JSON/JSONL files, accepts either a string (validated) or a native object/array (serialized). Supports optimistic concurrency via `expected_mtime`
- **`doc_str_replace`** — Find and replace exact text (requires a unique match for safety). For JSON/JSONL files, operates on the raw string; prefer `doc_write_file` with a native value for structural edits.
- **`doc_insert_text`** — Insert text at a specific position (start, end, before/after an anchor string)
- **`doc_update_frontmatter`** — Update individual YAML frontmatter properties
- **`doc_update_heading`** — Replace content under a specific heading

In Lexical-based markdown editors (including Document Mode), markdown delimiter characters are preserved as typed on save/export. Quilltap no longer rewrites ordinary delimiters as escaped punctuation (for example, writing `*`, `_`, `` ` ``, and `~` back as `\*`, `\_`, `\```, and `\~`).

### File Management

- **`doc_move_file`** — Move or rename a file. If the destination is in a different directory, the file is moved; if in the same directory, it is renamed. The destination must not already exist. The Librarian announces the move in the chat, naming the old and new addresses.
- **`doc_copy_file`** — Copy a file from one document store to a different document store. Takes `source_mount_point`, `source_path`, `dest_mount_point`, and `dest_path`; source and destination must be different stores. If `dest_path` is an existing folder, the file is dropped into it with the source filename; otherwise `dest_path` is treated as the full destination path (with filename). Parent directories are created automatically. Will not overwrite an existing file at the destination. Text files only — binary assets should use the blob tools. The Librarian announces the copy in the chat.
- **`doc_delete_file`** — Permanently delete a file. This cannot be undone, so your characters should confirm intent before calling. On success, the Librarian announces the removal in the chat, attributing the act to the calling character.
- **`doc_create_folder`** — Create a new folder, including any necessary parent folders. Idempotent — succeeds silently if the folder already exists. For database-backed stores, explicit folder rows are created; for filesystem stores, directories are created on disk. The Librarian announces the new shelf in the chat.
- **`doc_delete_folder`** — Delete an empty folder. Non-empty folders are rejected for safety; no recursive deletion is permitted. For database-backed stores, the folder row is deleted; for filesystem stores, the directory is removed from disk. The Librarian announces the dismantled shelf in the chat.
- **`doc_move_folder`** — Move or rename a folder (and all its descendants). Works on both filesystem and database-backed stores. For database-backed stores, the destination parent directory is created automatically if needed (like `mkdir -p`), and all descendant paths and embeddings are cascaded in a transactional batch. For filesystem stores, parent directories are created on demand. The destination must not already exist. The Librarian announces the move in the chat.

## How the Librarian announces changes

Whenever a character (or the operator) uses a `doc_*` tool to *change* something — create, edit, move, rename, copy, or delete a file or folder, or file or remove a binary asset — the Librarian quietly posts a note in the chat recording what happened, just as it does when you tend to a document yourself in Document Mode. Every such note names the calling character and quotes the document by its clickable `qtap://` address, so the whole company knows where things now stand.

The notes are tailored to the deed:

- **Creating a file** — the note reports the new file's contents in full, that everyone may see what was set down.
- **Editing a file** (`doc_write_file` over an existing file, `doc_str_replace`, `doc_insert_text`, `doc_update_frontmatter`, `doc_update_heading`) — the note carries a unified **diff** of precisely what changed. An edit that alters nothing passes in silence.
- **Moving, renaming, or copying** — the note names both the old and new addresses.
- **Filing a binary asset** (`doc_write_blob`) — the note records its name, type, and size; deleting one is announced like any other removal.

A particularly voluminous new file or sprawling diff is trimmed in the note, with a courteous marker indicating how much was set aside and a link to consult the document in full — the document itself is never abbreviated, only its mention in the chat.

## Enabling and Disabling

Document editing tools appear as a group in the **Tool Settings** panel (accessible from chat settings or project defaults). You can enable or disable the entire "Document Editing" group or toggle individual tools. Tools are automatically marked as unavailable if the chat lacks a project or the project has no linked document stores.

## In-Chat Navigation

To navigate to the chat settings where tools can be configured:

```
help_navigate(url: "/settings?tab=chat")
```
