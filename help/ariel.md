---
url: /salon
---

# Ariel — Terminals in the Salon

The modern Salon, that cathedral of conversational commerce, has long lacked one essential instrument of the contemporary workplace: a proper terminal. Your characters may discourse upon technical matters whilst remaining blind to the actual machinery churning beneath the floorboards. Ariel attends to this deficiency by opening a live shell session directly into a chat — a genuine PTY (pseudo-terminal) running under bash, zsh, or PowerShell, depending on your platform, so you and your assembled cast may witness the business of computation unfold in real time.

## What Ariel does

When you summon Ariel via the terminal button in the Salon composer, a live shell session emerges in a chat bubble. Every command you type executes on your machine, in the working directory where the Quilltap server is running, with the same environment variables and permissions that the server itself possesses. Characters with appropriate capabilities may, should you grant them the right tools, *read* the terminal scrollback and historical output — but only the user (that is, you) may command the machine.

**This is read-only for the LLM in this release.** Characters see but cannot dictate. You hold exclusive dominion over the keyboard.

Each chat maintains its own independent terminal session. Close the chat, and the session vanishes. Kill the terminal button, and the session ends. It is a creature of that particular conversation, ephemeral as candlelight.

## Opening a terminal

Look for the terminal icon in the Salon composer — the same toolbar where you would ordinarily find buttons for attachments or other niceties. Click it, and Ariel establishes the session. A fresh terminal window materializes in the chat thread, awaiting your first command.

## What characters can see

Should you enable terminal-reading capabilities (the `terminal_read` and `terminal_list` tools), a character may consult the session's recent scrollback: recent commands, their output, directory listings, file contents — the usual fare of a terminal session. They cannot run commands. They cannot alter files. They witness only what you have already caused to occur.

Think of them as spectators in the control room, able to read the instruments but not touch the switches.

## Caveats

Ariel operates under Quilltap's own user account and working directory. When you open a terminal, you inherit whatever shell environment the server runs under. Treat this as you would any terminal on your own machine: it can execute any command your user can execute, access any file your user can access, and alter any data your user can alter. An errant `rm -rf` here is as catastrophic as it would be anywhere else.

Similarly, environment variables, shell aliases, and PATH configuration are inherited from the server process — save for a few amenities Ariel lays out in advance, described below. If you have questions about what is accessible from within a terminal session, apply the same caution and verification you would apply to any shell on your system.

**A word on the Docker larder.** Aboard the good ship Docker, the pantry is stocked sparingly and by design. You will find `bash`, `zip`, `unzip`, the `quilltap` command itself, and Node — and precious little else. `git`, `curl`, `wget`, and `jq` were formerly laid on as a courtesy, but each dragged a retinue of unpatched vulnerabilities in behind it (Debian's `perl`, summoned by `git`, being the worst offender by some margin), and so they have been shown the door. Should your work genuinely require them, install them into your own image with a two-line `Dockerfile` built `FROM` the published one, and be aware of what you are readmitting. Note that this concerns only what a *human* may type at the prompt: the `curl` **tool** your characters may wield is a plugin that fetches over the network under its own steam, entirely unbothered by the absence of the command-line article. Installations outside Docker are untouched — your own machine's toolbox remains exactly as you left it.

## A few amenities laid out in advance

Ariel is not content merely to fling open a shell and abscond. Before surrendering the keyboard, the good fellow tidies the parlour with several small courtesies:

- **A signpost to your instance.** Every terminal is furnished with the environment variable `QUILLTAP_DATA_DIR`, set to the very instance directory the running server is tending. This means a bare `quilltap` command — querying the database, browsing your document mounts, tailing logs — addresses *this* establishment by default, with no need to wave `--data-dir` about. (Aboard the good ship Docker, this is the container's own `/app/quilltap`.)
- **The right `quilltap`, every time.** Should a `quilltap` already loiter upon your `PATH` whose vintage differs from the server's, Ariel quietly aliases the name to the matching command bundled with this very installation — so the CLI in your terminal always speaks the same dialect as the server it serves. (When the two already agree, or when no companion command can be found, Ariel leaves your `PATH` entirely undisturbed.) This courtesy is extended to both **bash** and **zsh**.
- **Completions, for the bash-inclined.** In a bash terminal, Ariel loads the `quilltap` command-completions, so a press of the Tab key conjures subcommands and flags rather than mute indifference.
- **A prompt that knows where it stands.** Also in bash, the prompt is dressed to display your present working directory before the customary `$`, lest you lose your bearings whilst wandering the filesystem.

Your own shell configuration is loaded first in every case; these amenities are merely laid atop it, never in place of it.

## Terminal Mode — promoting Ariel from the chat thread to a dedicated pane

A terminal stuffed inside a chat bubble is a fine arrangement for an occasional check, but for sustained work — tailing logs, running a build, watching a server start up — the bubble grows tiresome. Terminal Mode offers proper accommodations: a dedicated pane on the right of the Salon, with the chat reposed quietly on the left, exactly the way Document Mode arranges its scribbling.

Click the terminal button in the composer with no terminal yet running, and Ariel will spawn one and usher you straight into Terminal Mode. If a terminal session is already running in this chat, you'll be presented with a small picker — choose an existing session to bring into the pane, or commission a new one. Either way, the pane appears on the right, divider draggable, and the chat retreats to its half of the salon.

Should you enter Document Mode while Terminal Mode is also active, the right-hand pane partitions itself horizontally — document on top, terminal beneath — with a second draggable divider between them. Both halves remain interactive; resize at your leisure.

The terminal pane offers two distinct exit ceremonies, located at the right of its header:

- **Close pane** (the dash icon) — the pane folds away, but the terminal session itself continues to draw breath. The familiar message-bubble embed in the chat thread becomes interactive once more; should you wish to consult the terminal again, click the composer's terminal button and the pane returns with the same session intact.
- **Kill** (the red ✕) — terminates the underlying shell *and* closes the pane. Ariel's customary closing announcement appears in the chat. (The first click arms the kill; a second, within four seconds, executes it. This is to forestall accidental regicide.)

The pane state — whether it is open, which session it shows, where you set the dividers — persists with the chat record, so reloading the page returns you to precisely the arrangement you left.

**Keyboard shortcut:** ⌘⇧T (or Ctrl+Shift+T) toggles Terminal Mode. Escape exits focus mode back to a split.

## Closing a session

Either click the termination button within the terminal bubble (or the red ✕ in the Terminal Mode pane), or simply leave the chat — Ariel will tidy up the session when the conversation ends. Both methods are equally graceful; neither will leave orphaned processes.

## In-Chat Navigation

```
help_navigate(url: "/salon")
```
