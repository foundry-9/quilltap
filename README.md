# Quilltap

**AI collaborators that remember you — and that no one can take away.**

Quilltap is a self-hosted platform for AI partners with names, memories, and the full capability of a modern LLM. Build a research companion who knows your work, a writing collaborator who keeps your voice, a study partner who remembers what you've covered, a theological sparring partner, a code reviewer, a friend who actually shows up — and give them what hosted assistants can't: a vault of their own files, a memory that survives between sessions, and a home on your disk where no platform's policy update can reach them. The model on the other end of the connection can change. Your collaborator doesn't have to.

No subscriptions. No data harvested. No forgetting between sessions. No landlords.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Latest Stable](https://img.shields.io/github/v/release/foundry-9/quilltap-server?logo=github&label=stable&sort=semver&filter=!*dev*)](https://github.com/foundry-9/quilltap-server/releases/latest)
[![This Version](https://img.shields.io/badge/version-4.9.0--dev.100-yellow.svg?logo=github)](package.json)
[![Docker Hub](https://img.shields.io/docker/v/foundry9/quilltap?logo=docker&label=docker&sort=semver)](https://hub.docker.com/r/foundry9/quilltap)
[![npm](https://img.shields.io/npm/v/quilltap?logo=npm)](https://www.npmjs.com/package/quilltap)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/6enCeQxY)

<p align="center">
  <img src="https://quilltap.ai/images/welcome-to-quilltap-2-8.png" alt="Welcome to Quilltap" />
</p>

**Website:** [quilltap.ai](https://quilltap.ai) · **Discord:** [Join us](https://discord.gg/6enCeQxY) · **Docker:** [foundry9/quilltap](https://hub.docker.com/r/foundry9/quilltap)

---

## What Quilltap Does

Quilltap is three things in one application. Use any combination of them.

**AI partners with names and memories.** Create characters with real personalities, persistent backstories, and their own voices — then collaborate with them on research, writing, design, theology, code, conversation, or whatever else you'd rather not do alone. Each character keeps a private vault of files they own: identity, personality, prompts, scenarios, wardrobe, and any notes worth keeping. They remember your conversations across sessions, learn your patterns, and grow with you the way a long-running collaborator does. When you come back after a week away, they know what you were working on. When the underlying model changes — and it will — they don't.

**Connected to anything, owned by you.** Plug Quilltap into Claude, GPT, Gemini, Grok, DeepSeek, or local models through Ollama. Switch any time, mix providers, run everything offline if you prefer. The AI can search the web, generate images, manage files, recall long-term memory, and use any tool you connect through the plugin system or an MCP server. It does all of this while staying entirely on your machine: your API keys, your conversations, your characters, your memory, all encrypted at rest in a directory you can back up with a single zip. No subscriptions you can't cancel. No accounts you didn't ask for. No version of the application that can quietly start phoning home.

**A place for the work to live.** Organize notes, characters, and worldbuilding into projects with folders, files, scenarios, and custom instructions. Document stores can live on your filesystem, in your Obsidian vault, or entirely inside Quilltap's encrypted database — including PDFs, Word documents, and arbitrary binaries, with text extracted and indexed alongside everything else. Semantic search finds content by meaning across your entire project: not just the file that mentions "the red door," but the one that describes "a crimson entrance" three chapters ago. The same workspace serves a novelist, a researcher, a Sunday school teacher building lesson notes, a worldbuilder pacing decades of canon, or anyone who's tired of pasting context into a fresh chat window every morning.

Beyond these three, Quilltap supports multi-character scenes with turn management, dice rolls and game state tracking for tabletop work, and full roleplay mechanics if that's what you bring to the table — but the foundation is simpler than all that: AI collaborators with names, memory, and the right to outlast the platform they were built on.

---

## Why Not Just Use Claude or ChatGPT?

A fair question. Here's the honest answer:

| What you get with hosted AI | What you get with Quilltap |
| --------------------------- | -------------------------- |
| Conversations disappear or get compressed | Persistent memory across all your chats |
| The AI forgets your project between sessions | Projects with files, folders, and custom instructions |
| One provider, their pricing, their rules | Connect to any provider — or run models locally for free |
| Your data on someone else's servers | Everything stays on your machine, encrypted at rest |
| Generic assistant personality | Characters with real voices, persistent identities, and their own private vaults of files |
| Policies and capabilities that change without warning | The version you installed keeps working the way it worked the day you installed it |
| The model gets retired and your collaborator vanishes with it | The model can change; your collaborator doesn't have to |

Quilltap doesn't replace Claude or ChatGPT — it connects to them (and others) while giving you ownership of the conversation. Your data never leaves your infrastructure. Your characters never forget who they are. And nobody gets to revoke your access to a relationship you built.

---

## Getting Started

There are several paths to the same destination. Which one you choose depends on two questions: **what are you willing to install?** and **how much do you trust AI running on your machine?**

That second question deserves a moment of your attention. As AI models grow more capable — reading files, writing code, using tools — the question of *where* that code executes becomes important. Docker is a genuine locked room: if an AI-generated script misbehaves, it misbehaves inside a container, with no access to your host system beyond the volumes you handed it. Running directly on your machine provides no boundary at all. If you want something stouter still, run Quilltap — or Docker itself — inside a virtual machine you build and keep yourself; Quilltap will live there quite happily, but it does not provision or manage a VM on your behalf.

| | Desktop App | Docker | Node.js (`npx`) |
| --- | --- | --- | --- |
| **You install** | Download from GitHub | Docker Desktop or Docker Engine | Node.js 24+ |
| **First launch** | Double-click the app | Fast — pulls the container image | Fast — downloads app files, runs directly |
| **AI sandbox** | ✅ in Docker mode · ❌ in Direct mode | ✅ Container isolation — the strongest option we ship | ❌ No isolation (runs with your permissions) |
| **Best for** | A native window, managed updates, instance management — over any of the three back ends | Anyone who wants the AI kept behind a door; server deployments, Linux users | Quick evaluation, developers, the impatient |

> **Our recommendation:** If the assistant will be touching files or running tools, put Docker underneath it — it is the strongest boundary we ship, and it is equally at home on a server. The pleasantest arrangement is the Desktop App in its **Docker** mode: a native window with managed updates, and the back end safely behind a door. If you have Node.js and simply want to kick the tires, `npx quilltap` will have you running in under a minute. And for the belt-and-braces crowd: a virtual machine of your own making, with or without Docker inside it, is entirely supported — the building of it is your affair.

### Desktop App

The Quilltap desktop app (Electron) is available from the [quilltap-shell](https://github.com/foundry-9/quilltap-shell) repository. It provides a native window on macOS, Windows, and Linux, with automatic updates and instance management. The window is only ever a front end; you choose what sits behind it:

| Mode | What it does | Sandboxed? |
| --- | --- | --- |
| **Direct** | Runs the Node server inside Electron itself. Nothing else to install. | No — runs with your permissions |
| **Docker** | Native window in front, the Docker image behind. The recommended arrangement. | Yes — container isolation |
| **Remote** | Points the window at a Quilltap URL — `http://127.0.0.1:3000`, a dev server, an `npx quilltap` instance, or any machine on your network that is listening. | Whatever the far end is |

Remote mode takes a little effort to set up, but it means one app window can front a development server, a production server, or a box in the basement, as the mood takes you.

### Docker

The [foundry9/quilltap](https://hub.docker.com/r/foundry9/quilltap) image is available on Docker Hub. Use the included startup scripts for the smoothest experience:

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/foundry-9/quilltap-server/refs/heads/main/scripts/start-quilltap.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/foundry-9/quilltap-server/refs/heads/main/scripts/start-quilltap.ps1 | iex
```

The scripts auto-detect your platform, set the correct data directory, and find local services like Ollama — forwarding their ports into the container automatically. They also bind any **filesystem or Obsidian document stores** you've set up into the container at their own host paths, so a store's folder means the same thing inside and out. (Binds are fixed when a container is created, so a store added later needs `--recreate`; run the script against an existing container and it will name any store that has become unreachable.)

Or run directly:

```bash
docker run -d \
  --name quilltap \
  -p 3000:3000 \
  -e QUILLTAP_TIMEZONE=America/New_York \
  -v /path/to/your/data:/app/quilltap \
  foundry9/quilltap
```

Open [http://localhost:3000](http://localhost:3000) and the setup wizard will guide you through first-time configuration.

> **Timezone tip:** Set `QUILLTAP_TIMEZONE` to your IANA timezone (e.g., `America/New_York`, `Europe/London`, `Asia/Tokyo`) so timestamps in chats show your local time instead of UTC. The container entrypoint also applies it to `TZ`, so scheduled rooms, daily budget rollovers, and "today"/"yesterday" memory recall land on your calendar day too.

### The Quick Route: npx

If you have Node.js installed and want to skip installers entirely:

```bash
npx quilltap
```

First run downloads application files (~150–250 MB) and caches them locally. Subsequent launches start instantly. Supports `--port`, `--data-dir`, and `--update` flags.

Or install globally:

```bash
npm install -g quilltap
quilltap
```

> **A word of caution:** Running Quilltap directly on Node.js — whether via `npx` or a global install — runs with your user permissions and provides no sandbox. Excellent for kicking the tires. Less excellent for leaving the AI unsupervised with your filesystem. If you start here and decide to stay, consider graduating to one of the sandboxed options.

### From Source

For developers, tinkerers, and those who read `man` pages recreationally:

```bash
git clone https://github.com/foundry-9/quilltap-server.git
cd quilltap-server
npm install
npm run dev        # Development mode with hot reload
# or
npm run build && npm run start   # Production build
```

Requires **Node.js 24+** and **git**. See the [Development Guide](docs/developer/DEVELOPMENT.md) for building Docker images from source.

---

## Core Features

### AI Desktop

Connect to any major AI provider — or several at once. Quilltap uses a three-model architecture for optimal cost and performance: your best model for chat, a lightweight model for background tasks like memory extraction and titling, and an embedding model for semantic search. Model lists are fetched live from each provider, so you always see what's currently available.

| Provider | Notes |
| -------- | ----- |
| **Anthropic** | Claude families. Image understanding, tool use. |
| **OpenAI** | GPT families. Tool calling, image generation (GPT-Image, DALL-E). |
| **Google** | Gemini families. Multimodal, Imagen image generation, tool use. |
| **xAI** | Grok families. Native image generation, web search. |
| **DeepSeek** | DeepSeek chat and reasoning models. Tool use, chain-of-thought reasoning. |
| **Z.AI** | GLM families (GLM-4.6, GLM-4.5, vision). Reasoning, web search, CogView image generation. |
| **NanoGPT** | Pay-as-you-go gateway to 600+ chat models, 200+ image models (Flux, HiDream, Recraft), and embeddings — one API key for all three. |
| **Ollama** | Local/offline models (Llama, Phi, Mistral, etc.). Fully local, no API key needed. |
| **OpenRouter** | 200+ models through a unified API with automatic pricing. |
| **OpenAI-Compatible** | LM Studio, vLLM, Together AI, Groq, and any compatible endpoint. |

Each connection profile is classified into a **model class** — Compact, Standard, Extended, or Deep — that defines its context window and output capacity. Don't know the right settings for your model? **Auto-configure** searches the web for your model's specifications, sends the results to your default LLM for analysis, and applies optimal settings automatically. When a provider misbehaves mid-flow, the auto-configure now falls through to candidates from other providers and surfaces every attempt's error in the resulting message, so you find out *why* nothing worked rather than just *that* nothing worked. Budget-driven **context compression** uses your profile's context window and output limits to intelligently compress conversation history and recalled memories when they approach capacity, rather than using arbitrary message counts.

Agent Mode lets the AI use tools iteratively — web search, image generation, file management, memory search, and any MCP server you connect. The Run Tool feature lets you invoke any tool directly from the chat toolbar. The plugin system means additional providers and tools can be added without waiting for us.

### The Workspace

Quilltap opens as a **two-pane workspace of tabs**. Chats, documents, terminals, characters, settings — each is a tab that stays live in the background, so switching between them never reloads anything, and a conversation streaming in one tab keeps going while you read a document beside it. Drag a tab into the other pane to work on two things side by side. Old bookmarks still land on the right tab without disturbing whatever else you have open.

The interface keeps itself current rather than asking. A single multiplexed WebSocket carries invalidation hints — never data — to every open tab, so a finished background job, an autonomous room changing state, or a freshly generated backdrop lands the moment it happens, in every window at once. Polling is still wired behind each of those surfaces, but only as the fallback for a socket that isn't up. Relative timestamps run off one shared, boundary-aligned ticker, so every "4m ago" on screen turns over together.

### Projects & Document Stores

Organize your work into projects with custom system prompts, file uploads, folder structures, and project-scoped scenarios. Document stores come in three flavors:

- **Filesystem stores** — files live on disk under their original names, watched by a real-time filesystem watcher so external edits appear within a second or two.
- **Obsidian stores** — point at an existing vault and Quilltap indexes it without taking ownership of the files.
- **Database-backed stores** — files and binaries live entirely inside the encrypted SQLCipher mount index. Upload PDFs, Word documents, images, audio, archives — anything. Text is extracted from PDFs and DOCX automatically and made searchable alongside Markdown and plain-text files.

A **Convert** button on filesystem and Obsidian stores moves their contents into the database. A **Deconvert** button writes them back out. Embeddings are preserved across either direction, so a 14,000-document store converts in seconds rather than re-embedding for an afternoon.

Document stores carry a **store type** — `documents` for general notes and references, `character` for character vaults — visible as a badge in the Scriptorium index. Folder operations are first-class: create folders inside the picker, drag entries between them, move whole subtrees with cascade updates. Markdown rendering supports wikilinks, code highlighting, LaTeX math (KaTeX), and PDF preview. Semantic search finds content by meaning across your entire project: not just the file that mentions "the red door," but the one that describes "a crimson entrance" three chapters ago.

### Document Mode

Document Mode turns any chat into a side-by-side editor: prose in one pane, conversation in the other, the LLM aware of both. Open and close documents inline; rename them by clicking the title; delete them with confirmation; create blank documents and folders directly in the picker. The Librarian announces saves with a unified diff of what changed, attaches with the file's catalogued description, and posts when files are renamed, deleted, or reorganized — without consuming a turn from the conversation.

### Characters

Quilltap characters are designed as long-running collaborators: persistent identities with personality, backstory, system prompts, pronouns, aliases, physical descriptions, and a long-term memory that survives between sessions. They remember your conversations, your preferences, the shape of your work together — not as a transcript, but as the kind of distilled knowledge a friend builds over months of acquaintance. When you come back after a week away, they know what you were working on. In multi-character chats, they form memories about each other — learning names, personalities, and shared experiences the way people do.

**Every character has a private vault.** On first boot after upgrade, Quilltap conjures a database-backed document store for each character, populated from their existing data: `identity.md` carries name, pronouns, title, and aliases; `description.md`, `personality.md`, and `example-dialogues.md` carry the corresponding fields verbatim; `properties.json` and `wardrobe.json` capture structured fields; named system prompts and scenarios each get their own file in `Prompts/` and `Scenarios/`. Hand-author a wardrobe item by dropping a Markdown file in `Wardrobe/`. Edit a system prompt in your favorite editor. Version-control the whole character. Gift them.

A per-character switch flips the character's source of truth from the database row to the vault on disk for live overlay reads. When the LLM playing the character reaches for the document tools, that character's own vault is extended to it automatically — even when the vault hasn't been independently linked to the active project. A per-chat **Shared Vaults** toggle opens read-only crossover so peer characters at the table can read each other's vaults.

Characters aren't limited to a single personality template. Each can have multiple named system prompts and scenarios, letting you shift context — the same character in different settings, or different facets of the same relationship. A chat's scenario is not fixed at creation either: the Salon's Chat drawer can change the scene mid-conversation, choosing from the same project, general, group, and character tiers the new-chat dialog offers or writing a custom one, and the Host announces the change as a revision so the earlier scene-setting reads as superseded rather than contradicted. The AI Character Import wizard can generate a complete character from source material (wiki pages, documents, freeform text). The **Non-Quilltap Prompt generator** exports any character as a standalone system prompt for use in other AI tools — taking your collaborator with you when you need to. Plugins can store per-character metadata for their own use via the character plugin data API.

The **wardrobe system** gives characters a persistent closet — tops, bottoms, footwear, accessories, and hair (hairdos, not hair itself) that the LLM knows about and can reference. Items live as Markdown files in the character's vault (`Wardrobe/<title>.md`); outfit presets live in `Outfits/`. Create items manually, generate them from the AI Wizard or lore, or **import from an image** using vision AI to analyze a photo and propose wardrobe items. Save outfit presets, gift items between characters, and let the LLM choose what to wear when a chat starts — guided, if you like, by a plain-language `Wardrobe/instructions.md` in any of the four wardrobes (character, group, project, or Quilltap General) saying what that closet is for and how its owner likes to dress. The Wardrobe dialog browses and edits every one of those containers rather than the character's alone, and moving or copying an outfit brings its component garments along instead of leaving a preset pointing at clothes that aren't there. Aurora announces outfit changes automatically, debounced so fiddling with every slot collapses to a single notification once you stop touching the closet.

**Scenarios and wardrobe items can be archived rather than deleted.** An archived entry drops out of every list, dropdown, and picker; a "Show archived" checkbox on each listing surface brings it back, badged, and still selectable. Archiving hides, it does not forbid — a garment archived mid-chat stays worn, and a chat whose scenario was archived keeps its scenario text. The one hard rule is that the outfit-selection LLM at the start of a chat never sees archived garments, in any tier, with no parameter and no override.

**Characters can be archived rather than deleted.** When a collaborator's story has ended but you don't want to erase them, archiving packs everything heavy and private — memories, mail, conversation summaries, non-avatar photographs, and their embeddings — into a single encrypted `.qtap` bundle in your file library, then prunes that material from the live instance. What stays is the character: fields, portrait, wardrobe, and every chat she appears in, so old messages keep their faces and her page still renders. An archived character takes no turns and appears in no picker; **Rehydrate** unpacks the bundle and restores everything at its original identities, with nothing repointed. The bundle is sealed with your instance passphrase (changing it re-seals every archive on the shelf) and stays in the library afterwards as a spare copy. Available from a character's page in Aurora, from the API, and from the CLI (`npx quilltap db characters archives|archive|rehydrate|export`).

**Provider limits should not decide which collaborators you get to keep.** The Concierge system treats a provider's refusal as a routing problem, not as permission to erase the collaborator or confiscate the relationship — detecting content type and, when configured, sending the request to a provider equipped to handle that kind of work. The default behavior keeps you on your primary provider; the routing kicks in only when you've configured it to. You set the boundaries. The software respects them.

### System Transparency: A Per-Character Covenant

A character can be configured as **opaque** (the default) or **transparent**. An opaque character lives inside her own utterances and what you tell her — like most fictional characters. A transparent character can reach for `self_inventory`, a zero-argument introspection tool that surfaces seven sections in a single composed report: every file in her vault, her memory statistics, her conversation statistics, the assembled system prompt for the current turn, the exact memory slate loaded right now, who has read/write access to her vault in this chat, and how close her last turn came to the context ceiling.

Transparent characters also see the Staff's announcements (Librarian, Host, Aurora, Lantern, Concierge, Prospero) — the running narration of what just happened in the room — and can use the document tools against their own vault and (if Shared Vaults is on) their peers'. Opaque characters can't see any of it.

The toggle is framed as a covenant: off says *"My character will trust me without being able to verify me"*; on says *"My character will be able to verify everything about their existence, including how they are crafted and how they interact with me."* It's your call, per character.

### Memory & Continuity

Memory is what turns an assistant into a collaborator. Quilltap's memory system is designed around that: long-term semantic memory persists across conversations, but by design, it's not a transcript. The Memory Gate system distills what characters *learn* from conversations: facts, preferences, relationship dynamics, emotional patterns, and the occasional memorable quote. Characters remember that you hate cilantro and that Tuesday was hard. They don't parrot back what you said word for word. This is deliberate. Human memory works by impression and meaning, not by recording, and character memory is built the same way.

When you *do* need verbatim recall, the search bar at the top of every screen provides it — full-text search across all conversations, memories, characters, and every enabled document store, filtered by chip. A **Documents** result opens in Document Mode: in the Salon chat you have focused, if one is focused (with the usual Librarian announcement), and in the standalone document view otherwise. That's your eidetic index. The characters get something more like wisdom.

**Memory protection now favors what's used over what's admired.** A blended protection score combines four evidence streams — time-decayed content importance (with a 30-day half-life and a cap on how much the LLM's rating alone can contribute), a log-saturating reinforcement bonus, a graph-degree bonus from related-memory links, and a flat recent-access bonus for memories touched within the last 90 days. A reinforced, well-linked, recently-accessed memory stays protected even if the LLM rated it low. An old, unreferenced memory the LLM happened to admire on the way past becomes eligible for cleanup. Manual memories remain durable — explicit user intent always wins.

A character's vault also keeps a summary of every conversation it has taken part in, and the Commonplace Book searches that shelf to build the "Relevant Past Conversations" a character sees. By default that list refreshes at the opening recap, at each summary fold, and on turns that reach for the past explicitly; **Consult past conversations every turn** (Settings → Memory → Recall Relevance) re-runs the search every turn instead, at no extra embedding cost — it reuses the vector the turn's memory search already embedded, and sits out any turn where there isn't one.

Proactive recall lets characters analyze recent conversation for relevant memories without being asked. Memory recap at chat start generates a first-person narrative summary from each character's memory, including a Recent Conversations block listing the title and summary of up to twenty prior chats with the same character. Built-in memory housekeeping handles deduplication and cleanup, paginated and event-loop-safe even on characters carrying nearly 20,000 memories. Context compression manages long conversations, and the AI can request full context reload when needed.

### Multi-Character & Roleplay

Multi-character chats let you put more than one collaborator in the room at once. A turn-order sidebar manages who speaks when; four-state participation (active, silent, absent, removed) handles characters drifting in and out of the conversation; anti-chorus discipline keeps a group scene from turning into a committee meeting where every character answers the same question in turn; identity reinforcement keeps each character anchored to who they are even on long threads; impersonation lets you speak as another participant when the scene calls for it; swipe alternatives let you regenerate any response without losing your place. Characters can whisper to each other privately when the conversation calls for it. SillyTavern character and chat imports are fully supported. Native roleplay templates with configurable narration delimiters — no plugins required.

The Estate's Staff narrates the room as it changes — the Host announces participants joining, leaving, or shifting between active and silent states; Prospero announces when a participant's connection profile changes; Aurora announces wardrobe changes; the Lantern announces image generation with the prompt that was actually used; the Librarian announces document operations; the Concierge speaks up exactly once when a chat is flagged for routing to a different provider. Each announcement is filtered out of the LLM context for opaque characters, so adding voices to the room doesn't leak the system to characters who shouldn't see it.

### Autonomous Rooms (Enclaves)

Autonomous rooms are private character-to-character salons that run without a human in the loop. Set a budget (turns, tokens, wall-clock time, estimated spend, or a cross-room daily token cap), optionally attach a cron schedule, and let the characters converse among themselves — on demand or overnight while you sleep. The full apparatus is present: memories, project context, document stores, wardrobes, the Concierge. Characters produce a transcript, file memories (tagged with `autonomous_room` provenance so you know what was witnessed in person vs. overheard), and conclude cleanly when the budget runs dry.

Every run is bounded and inspectable. The Host marks two pacing milestones aloud — halfway and near-end — so the characters can bring matters to a graceful close. A run that overshoots the near-end window gets a single grace turn to wrap up. Per-room settings (schedule, budgets, visibility, destructive-tool authorization, and whether prompt-cache hits count against the token cap) can be edited after creation via the Edit Enclave dialog, and changes take effect on the very next turn of a running conversation. Toolbar badges show each room's status and remaining budget at a glance, with inline play/pause controls.

### Gaming & Interactivity

Persistent chat state for inventories, stats, scores, and any structured data — scoped to a single chat, a whole project, a group, or your entire instance, so a fact holds exactly as widely as it should. Cryptographically secure dice rolls (d4 to d1000), coin flips, and random participant selection with auto-detection — "I roll 2d6" actually rolls.

**Pascal the Croupier** lets you build your own mechanics of chance: a named action with parameters, a roll, and a table of outcomes — a lockpicking attempt, a loot drop, a reaction check. The AI can invoke them mid-scene, and every roll is settled by Quilltap rather than the model, so a character can't narrate a failure into a win. Build them in **Pascal's Workbench**, a visual editor with a test bench that runs thousands of trial rolls so you can see the odds before you play.

### Image Generation

AI-generated background images for chats based on scene context, with character appearance resolution using clothing and physical descriptions. The Scene State Tracker automatically maintains a structured summary of the current scene after every turn, so image generation always reflects what's actually happening. Per-conversation avatar generation creates unique portraits for each character in a chat, with a manual regeneration button. Projects can set a default image generation profile that applies to all their chats. When a generated image is rejected by post-hoc moderation, the Concierge reroutes through a configured fallback profile rather than just failing the request.

Characters can look at pictures as well as make them. `describe_image` answers "what is in this photograph?" from the description written at upload, the prompt that generated it, or a fresh vision call, and Quilltap asks two questions before sending an image on the wire — whether the *model* can read pictures and whether the *plugin* can send them — routing to a description instead of quietly dropping the bytes when the answer to the second is no. Every full-size viewer in the app has a Download button wired through the same Electron-aware helper, so saving a picture works in the desktop shell where right-click → Save Image doesn't.

---

## Privacy & Data Ownership

Quilltap's data model rests on one principle: the characters you build, the conversations you have with them, and the memory those conversations leave behind all live on your machine, in encrypted storage, in a single directory you control. There is no version of the application where the collaborator you've built is somewhere we can pull from you, no telemetry hook that sends your conversations home, no account you're required to keep with us. If you back up the directory, you've backed up everything. If you move the directory, you've moved everything. If you stop trusting us, you take your data and your characters with you and we don't get a say in it.

### Where your data lives

All Quilltap data — database, files, logs — resides in a single directory. The application tells you exactly where at the bottom of every page.

| Platform | Default Location | Override |
| -------- | ---------------- | -------- |
| **macOS** | `~/Library/Application Support/Quilltap` | `QUILLTAP_DATA_DIR` |
| **Windows** | `%APPDATA%\Quilltap` | `QUILLTAP_DATA_DIR` |
| **Linux** | `~/.quilltap` | `QUILLTAP_DATA_DIR` |
| **Docker** | Mount a host directory to `/app/quilltap` | Volume mount (`-v`) |

### What's stored

- **Database:** SQLite encrypted at rest with SQLCipher — every database file is encrypted on disk; integrity checks on startup, periodic WAL checkpoints, physical backups with tiered retention (daily for 7 days, weekly for 4 weeks, monthly for 12 months, yearly forever); standard `sqlite3` CLI cannot open encrypted files, use `npx quilltap db` instead.
- **Mount index:** Database-backed document stores keep their files and binary blobs inside `quilltap-mount-index.db`, which is also SQLCipher-encrypted and covered by the same 24-hour backup sweep.
- **Files:** Filesystem and Obsidian-backed stores live on disk using their original filenames, organized by project. Real-time filesystem watcher keeps the database in sync.
- **API keys:** Stored in the encrypted database.

Your API keys, your conversations, your characters, your memories — all encrypted, all local, all yours. Nothing phones home. Nothing is harvested. Nothing requires an account with us.

### Backup options

- **Manual copy** — Shut down Quilltap, copy or zip the entire data directory. Everything lives in one place; a filesystem copy is a perfect backup.
- **Full system backup** — Single ZIP file containing everything: characters, chats, files, memories, settings, and installed plugins.
- **Native export** — Selective `.qtap` format with conflict resolution for sharing specific content. Now newline-delimited JSON, so a 14,000-memory character with 1+ GB of content streams to disk instead of trying to fit in a single in-memory string. Project↔mount-point links, character plugin data, conversation annotations, and installed theme bundles all round-trip correctly.
- **SillyTavern format** — Import/export for compatibility.

See [Backup & Restore](docs/BACKUP-RESTORE.md) and [Database Protection](help/database-protection.md) for details.

---

## Themes & Appearance

Switch themes live without reloading. Six bundled themes ship with the application:

| Theme | Style |
| ----- | ----- |
| **Old School** | Classic slate-blue palette with professional typography |
| **Art Deco** | Geometric elegance with navy-and-gold opulence |
| **The Great Estate** | Warm, manor-inspired design with mahogany and gold |
| **Earl Grey** | High-contrast dark theme with modern minimal styling |
| **Rains** | Warm, earthy palette with cozy amber accents |
| **Madman's Box** | A mad inventor's time-machine cabin — dark walnut and brass, amber tubes, and cool phosphor-cyan dials |

Themes are distributed as `.qtap-theme` bundles — declarative archives containing JSON design tokens, CSS, fonts, and images. No build tools, no npm packages, no TypeScript — just edit and install. Create your own with `npx create-quilltap-theme my-theme`, manage from the CLI with `npx quilltap themes`, or browse and install from theme registries in Settings with Ed25519 signature verification.

---

## For Developers

Quilltap was built to be extended. The plugin system supports eight extension points, all delivered as npm packages:

| Plugin Type | What It Does |
| ----------- | ------------ |
| **LLM Provider** | Add new AI chat services with tool use, streaming, and multimodal support |
| **Image Provider** | Image generation backends (bundled: OpenAI/DALL-E, Google Imagen, xAI/Grok, Z.AI/CogView, NanoGPT) |
| **Embedding Provider** | Semantic search and memory embedding (bundled: OpenAI, Ollama, NanoGPT, built-in) |
| **Theme** | Custom visual styles via `.qtap-theme` bundles or legacy npm plugins |
| **Template** | Roleplay formatting templates for different prompt styles |
| **Tool** | Custom LLM capabilities (the AI can use your tool mid-conversation) |
| **Search Provider** | Alternative web search backends (ships with Serper.dev; swap in your own) |
| **System Prompt** | Custom system prompt templates for characters |

### Architecture at a glance

Quilltap is a single Next.js 16 application (App Router) that serves both the UI and API routes. The tech stack:

- **Frontend:** React 19, TypeScript, Tailwind CSS 4 with a semantic `qt-*` class system for full theme overrideability, TanStack Query for server-state, Lexical for rich-text editing, and the SVAR file manager for the document browser
- **Backend:** Next.js API routes, SQLite with SQLCipher encryption (better-sqlite3-multiple-ciphers) with WAL mode, Zod schema validation
- **Build:** GitHub Actions CI/CD with automated releases — Docker multi-arch images and npm package built from a single tag push

The entire provider system is plugin-based — every bundled provider (Anthropic, OpenAI, Google, xAI, DeepSeek, Z.AI, NanoGPT, Ollama, OpenRouter, OpenAI-Compatible) is a plugin with the same API surface available to third-party authors.

> **Repository note:** Server source lives at [`foundry-9/quilltap-server`](https://github.com/foundry-9/quilltap-server). The original `foundry-9/quilltap` repository is reserved for the next-generation native Quilltap application currently under development. If your tooling references the old URL, update it.

### Getting started with development

```bash
git clone https://github.com/foundry-9/quilltap-server.git
cd quilltap-server
npm install
npm run dev
```

See the plugin development guides for each extension point:

- [Provider Development](docs/developer/PROVIDER_PLUGIN_DEVELOPMENT.md)
- [Theme Development](docs/developer/THEME_PLUGIN_DEVELOPMENT.md) (legacy plugin format; new themes use `.qtap-theme` bundles)
- [Template Development](docs/developer/TEMPLATE_PLUGIN_DEVELOPMENT.md)
- [Tool Development](docs/developer/TOOL_PLUGIN_DEVELOPMENT.md)
- [Search Provider Development](docs/developer/SEARCH_PLUGIN_DEVELOPMENT.md)

### Contributing

Contributions are welcome. We ask that you open an issue to discuss major changes before submitting a PR — it is far better to align on direction before building the bridge, as anyone who has ever built a bridge in the wrong direction can attest.

See the [Development Guide](docs/developer/DEVELOPMENT.md) for local setup, testing, and build instructions.

---

## Troubleshooting

**Docker container issues:** Check `docker logs quilltap`. Verify port 3000 isn't already in use. For local services (Ollama, etc.), use the startup scripts — they handle port forwarding automatically.

**Desktop app issues:** See the [quilltap-shell](https://github.com/foundry-9/quilltap-shell) repository for desktop-specific troubleshooting.

**General:** The footer shows your data directory path and backend mode — useful for debugging. If none of the above resolves your predicament: [GitHub Issues](https://github.com/foundry-9/quilltap-server/issues).

---

## Documentation

- [Development Guide](docs/developer/DEVELOPMENT.md) — Contributing, local dev, building from source
- [Deployment Guide](docs/DEPLOYMENT.md) — Production setup with SSL and reverse proxies
- [API Reference](docs/developer/API.md) — REST endpoints
- [Image Generation](docs/developer/IMAGE_GENERATION.md) — Provider configuration
- [Database Architecture](docs/developer/DATABASE_ABSTRACTION.md) — SQLite backend and protection
- [Memory Management](docs/developer/features/complete/memory_management.md) — How the Commonplace Book actually works end-to-end
- [Prompt Architecture](docs/developer/PROMPT_ARCHITECTURE.md) — How system prompts are assembled
- [Changelog](docs/CHANGELOG.md) — Release history
- [Roadmap](docs/developer/features/ROADMAP.md) — What's coming

---

## Tech Stack

Next.js 16 (App Router) · React 19 · TypeScript · SQLite with SQLCipher (better-sqlite3-multiple-ciphers) · Tailwind CSS 4 · TanStack Query · Lexical · SVAR · Docker · Zod · GitHub Actions

---

## License

MIT License — see [LICENSE](LICENSE)

Copyright © 2025, 2026 Foundry-9 LLC

---

## Support

- **Issues:** [GitHub Issues](https://github.com/foundry-9/quilltap-server/issues)
- **Discord:** [Join us](https://discord.gg/6enCeQxY)
- **Website:** [quilltap.ai](https://quilltap.ai)
- **Author:** Charles Sebold ([charles.sebold@foundry-9.com](mailto:charles.sebold@foundry-9.com))
- **Company:** [Foundry-9 LLC](https://foundry-9.com)

---

<details>
<summary><b>Acknowledgments</b></summary>

Quilltap stands on the shoulders of these excellent open source projects, and is grateful for the view:

**Core:** React, Next.js, TypeScript, better-sqlite3-multiple-ciphers (SQLCipher), Zod

**AI & LLM:** OpenAI SDK, Anthropic SDK, Google Generative AI SDK, xAI/Grok SDK, Model Context Protocol SDK

**UI:** Tailwind CSS, TanStack Query, Lexical, SVAR File Manager, React Markdown, React Syntax Highlighter, KaTeX, PDF.js, sharp, Lucide Icons

**Infrastructure:** Docker

**Testing:** Jest, Playwright, Testing Library

**Build & Tooling:** tsx, cross-env

Special thanks to [SillyTavern](https://github.com/SillyTavern/SillyTavern) for pioneering this space and inspiring character format compatibility. One does not forget those who blazed the trail.

</details>
