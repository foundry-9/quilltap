---
url: /salon/:id
---

# Run Tool

## The Gadgeteer's Workbench

Much as a gentleman inventor might wish to test each spring and gear of a newly acquired apparatus before entrusting it to the automaton, Quilltap's **Run Tool** feature permits you — the human operator, the master of ceremonies, the one who actually pays the electricity bill — to invoke any available tool directly, without requiring the AI to do it on your behalf.

## Accessing the Run Tool

1. Open any chat in **The Salon**
2. Look to the right-hand **Chat Sidebar** (the panel of accordion drawers your eye naturally falls to when the conversation pauses for breath)
3. Open the **Chat** drawer
4. Press **Run Tool…**

## How It Works

The Run Tool modal operates in two phases, rather like a dance card at a particularly well-organized ball:

### Phase 1: Selecting Your Instrument

Upon opening, you are presented with every tool currently available in this chat, organized by category. Each tool displays its name and a brief description of its capabilities.

- **Available tools** can be clicked to proceed
- **Unavailable tools** appear dimmed, with a note explaining why they cannot be used (for instance, image generation requires an image profile to be configured)
- Use the **search bar** to filter tools by name or description

### Phase 2: Filling in the Parameters

Once you have selected a tool, a form appears with the tool's parameters:

- **Required parameters** are marked with an asterisk and must be filled in before the tool can run
- **Optional parameters** can be included by checking the checkbox next to their name
- Each parameter includes a description explaining what it expects
- A collapsible **arguments preview** at the bottom shows the exact JSON that will be sent
- A **Private (whisper)** checkbox lets you mark the run as confidential — see "Private Runs" below

Click **Run Tool** when you are satisfied with your parameters. The tool executes, and its result appears as its own row in the chat — announced by **Prospero**, with your name in the attribution line ("Charles ran `rng`") and the request and response tucked into collapsible, copyable monospace panels. You and the AI can both see it on subsequent turns, unless the run was marked private.

## Private Runs

Tick the **Private (whisper)** box before pressing **Run Tool** when the result is for your eyes only — a die you'd rather the cast didn't witness, a peek at a memory you don't want surfacing in the conversation, a debug query.

A private run:

- **Stays in your own view.** The row remains where you left it, marked with a small "whisper" label, whether or not "All Whispers" is lit. You commissioned the run; it would be a poor sort of secret that kept itself from you.
- **Is excluded from every character's context.** No participant — single-character or multi — receives the run in their LLM context. As far as your cast is concerned, it never happened.

Public runs (the default) behave the way they always have: visible to everyone, included in subsequent turns.

## What Can You Run?

Any tool that the AI could use is available to you here, including:

- **Search Memories** — Query the Commonplace Book directly
- **Random Number Generator** — Roll dice, flip coins, or spin the bottle
- **Search Web** — Look something up on the internet
- **Project Info** — Retrieve project details and file contents
- **Manage Files** — Read or list files
- **Search Help** — Search Quilltap's own documentation
- **State Manager** — View or modify chat state variables
- **Plugin tools** — Any tools provided by installed plugins

The only tools excluded are internal-only mechanisms that would be of no use to a human operator (such as the context expansion valve and the agent-mode response finalizer).

## A Note on Results

Tool results created through Run Tool are marked as **user-initiated** and appear in the chat history as Prospero-authored rows. This means:

- The AI can see and reference public results on its next turn (private runs are excluded from every character's context)
- Results persist in the chat history
- Image generation results include any generated images as attachments

This is particularly useful when you wish to provide the AI with specific information — a memory search result, a file's contents, or a fresh set of dice rolls — without having to ask it to fetch the information itself.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon/:id")`
