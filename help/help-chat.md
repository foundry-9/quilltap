---
title: Help Chat
url: /help-chat
tags: [help, chat, assistant, navigation, tools]
---

# Help Chat

> **The Help Chat is available from every screen via the question-mark icon in the sidebar.**

Picture, if you will, a well-appointed establishment where every guest is attended by a personal concierge of impeccable knowledge and unwavering patience --- one who not only knows every corridor and curiosity of the house, but who can escort you there on a moment's notice. That, dear reader, is your Help Chat: a contextual, LLM-driven assistant that hovers at your elbow on every page of Quilltap, ready to illuminate the obscure, untangle the perplexing, and point you toward whatever you seek.

## Opening Help

At the bottom of the left sidebar, you will find a **question-mark icon** --- the universal signal that enlightenment lies behind a single click. Press it, and a dialog shall appear, offering you two tabs of assistance:

### The Guide Tab

The **Guide** tab presents Quilltap's full documentation library as a browseable index, organised into sensible categories --- Characters, Chats, Projects, Settings, and so forth. No question need be formulated; simply browse, expand a category, and click any topic to read the guide in full, rendered handsomely right inside the dialog.

- **Context-aware** --- The category most relevant to your current page is automatically expanded, so the pertinent topics are already waiting when you arrive
- **Searchable** --- A search bar at the top hunts through the *text* of every guide, not merely their titles. Type `describe`, or `uncensored`, or any other term you recall reading, and the topics containing it rise to the surface with the matching phrase quoted beneath each one, so you may judge at a glance which is the guide you actually want. (Titles still count, and count for more: a topic named for your search sits at the top of the pile.)
- **Welcome card** --- New arrivals (those with fewer than three chats to their name) are greeted with quick-start links to the most essential guides
- **Navigable** --- "Open this page in Quilltap" buttons within guides take you directly to the relevant page; links to related topics open within the Guide itself

### The Ask Tab

The **Ask** tab provides the conversational help experience:

1. **Start a new help conversation** --- Select one or more help-enabled characters and type your question
2. **Resume a past help chat** --- Pick up where you left off in a previous conversation

The Guide tab is shown by default when the dialog opens. Your tab selection persists for the session --- if you prefer Ask, it will remain selected until you close your browser.

## Eligibility Requirements

Not every character is suited to the role of guide. To serve as a help assistant, a character must meet two qualifications:

- **Help Tools Enabled** --- The character must have the "Help Tools" toggle activated on their Aurora profile
- **Tool-Capable Connection Profile** --- The character must be connected to an LLM that supports tool use (function calling)

If no characters meet these requirements, the help button will appear disabled, with a tooltip explaining what must be arranged before service can commence.

**A note on image capability:** While not strictly required, an image-capable LLM (or a configured cheap LLM that can read images) will allow your help characters to interpret screenshots and visual elements you share with them. Consider it the difference between a concierge who can read the map and one who must rely on your description of it.

## How It Works

Your help characters are equipped with a specialized set of tools for navigating the establishment:

- **`help_search`** --- Searches the Quilltap documentation library to find relevant guidance
- **`help_settings`** --- Reads your instance configuration (connection profiles, themes, templates, and the like) without ever exposing API keys or secrets
- **`help_navigate`** --- Suggests and provides clickable links to specific pages within Quilltap, including deep-links to particular settings tabs and sections

The character operates in agent mode, meaning it may consult multiple tools across several turns before composing its final, considered response --- rather like a librarian who checks three card catalogues and two reference volumes before answering your question.

## Page-Aware Context

Here is the particularly clever bit: the Help Chat knows which page you are currently viewing. When you open a help conversation, the system automatically loads the relevant documentation for your current page into the character's context. If you navigate to a different page while the help dialog is open, the context updates accordingly, and the character is informed of the change.

This means you need not explain where you are or what you are looking at. Your help character already knows. Simply ask your question.

## Selecting Characters

When you open the Help Chat, you will see a row of character avatars representing all eligible help characters. This is a checkbox selection, not a radio button --- you may choose one character or several to assist you.

By default, if both Lorian and Riya are present and help-enabled, both will be selected. If only one character qualifies, that character will be preselected and the selection disabled (you cannot, after all, choose from a list of one).

## Past Help Chats

Below the character selection and question input, you will find a list of your previous help conversations. Each entry shows:

- **The chat title** --- So you can recall what you were asking about
- **Character avatars** --- Showing who participated
- **Availability indicators** --- If a character from a past chat is no longer eligible (perhaps deleted, perhaps stripped of their help tools), an indicator will note their unavailability, with a tooltip explaining the circumstances

Click any past chat to resume it. The conversation picks up where it left off, with the character's context updated to reflect your current page.

## The Help Dialog

The help chat appears in a **floating dialog** that does not consume the full screen. This is by design --- you are meant to see the application behind it, so you can reference what you are looking at while conversing with your assistant.

The dialog is:

- **Movable** --- Drag it to any position on the screen
- **Resizable** --- Adjust its dimensions to your preference
- **Persistent** --- The system remembers your preferred size and position for future sessions

### What You Can Do in the Dialog

The help chat supports a focused subset of the full Salon chat experience:

- **Send messages** --- Type questions and receive answers
- **Upload files and paste images** --- Share screenshots or documents for context (image capability recommended)
- **Rename the chat** --- Or let the LLM retitle it automatically
- **Export** --- Save the conversation as a SillyTavern-compatible chat

Features like whispers, the Concierge, story backgrounds, the Chat Sidebar, and user-initiated tool use are not present. The help chat is a streamlined affair --- all substance, no ceremony.

### Navigation Links

When a help character determines you ought to visit a particular page --- say, to adjust a setting or explore a feature --- it can place a **clickable navigation link** directly in the chat. Click the link, and Quilltap will take you there. The character derives these URLs from the documentation, including deep-links to specific settings tabs and accordion sections.

## Tips for Effective Help

1. **Be specific** --- "How do I change my character's connection profile?" will yield better results than "help me with characters"
2. **Share context** --- If something looks wrong, paste a screenshot (if your LLM supports images)
3. **Ask follow-ups** --- The chat maintains history, so you can drill deeper into any topic
4. **Resume when relevant** --- If you encounter the same issue again, resume the previous help chat rather than starting fresh

## In-Chat Navigation

To direct the user to the sidebar where the help button lives:
```
help_navigate(url: "/")
```

## Related Pages

- [Left Sidebar](sidebar.md) --- Where the help button lives
- [Chats Overview](chats.md) --- The Salon chat system
- [Using Tools](tools-usage.md) --- AI tools available during chat
- [Characters](characters.md) --- Create and manage characters, including help tool access
