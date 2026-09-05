---
url: /settings?tab=templates&section=roleplay-templates
---

# Roleplay Templates Settings

> **[Open this page in Quilltap](/settings?tab=templates&section=roleplay-templates)**

The Roleplay Templates settings tab is where you manage all your templates, set defaults, and customize formatting rules for your roleplay sessions. Here you can view built-in templates, create custom ones, and organize your formatting conventions.

## Accessing Roleplay Templates Settings

1. Click **Settings** in the sidebar (gear icon)
2. Look for the **Roleplay Templates** tab
3. You'll see three main sections: Default Template, Built-in Templates, and My Templates

## Default Template Section

The default template is applied to all new chats automatically.

### Understanding Defaults

- **Default template** — The one applied to all new chats
- **Per-chat override** — Each chat can use a different template
- **Existing chats unaffected** — Changing the default only affects new chats
- **Optional** — You can choose "None" to have no default

### Setting a Default Template

1. At the top of the Roleplay Templates tab, find **Default Template**
2. In the dropdown labeled "Template for New Chats," select your choice:
   - **None** — No formatting template (just plain chat)
   - **Any template** — A built-in or custom template
3. Your selection is saved automatically
4. New chats created after this will use the selected template

### Viewing the Current Default

The selected default template shows:

- **Template name** — What it's called
- **"Built-in" badge** — If it's a built-in template
- **Saving status** — "Saving..." appears while the change is being applied

### Changing Your Default

To change what's set as default:

1. Click the dropdown
2. Select a different template
3. The change is saved immediately
4. All future new chats use the new default
5. Existing chats keep their current settings

### Why Change the Default?

Change your default template when you:

- **Start a new project** — Switch to a template matching that project's style
- **Learn new conventions** — Switch to a template you've created
- **Experiment with formats** — Try different formatting approaches
- **Match character needs** — Choose templates suited to your characters

## Built-in Templates Section

### Understanding Built-in Templates

Built-in templates are:

- **Provided by Quilltap** — Pre-installed formatting standards
- **Read-only** — Cannot be edited or deleted
- **Always available** — You can use them anytime
- **Copyable** — Create custom versions based on built-in ones
- **Marked** — Show a "Built-in" badge

### Viewing Built-in Templates

The Built-in Templates section shows:

- **Template cards** — Each template displayed in a grid
- **Template name** — What to call the template
- **Description** — What formatting style it uses
- **Badges** — "Built-in" label

### Previewing a Built-in Template

To see the complete formatting instructions:

1. Find the template card you're interested in
2. Click the **Preview** button
3. A modal opens showing:
   - Full template name
   - Complete description
   - Full system prompt with all formatting rules
   - "Built-in" label
4. Read through the formatting instructions
5. Click outside or press Escape to close

### Copying a Built-in Template

To create a custom version you can edit:

1. Find the built-in template
2. Click **Copy** or **Copy as New**
3. A modal opens with the template details
4. The template is copied with a new name (usually adds " (Copy)")
5. Edit the name, description, or system prompt as desired
6. Click **Save**
7. Your custom copy appears in "My Templates"

### Why Copy Templates?

Copy built-in templates when you:

- **Want to customize** — Modify a template for your needs
- **Need variations** — Create multiple versions for different uses
- **Prefer the structure** — Use an existing format as a starting point
- **Want to experiment** — Try modifications without risking the original

## My Templates Section

### Understanding Your Templates

Your custom templates:

- **Are created by you** — You define all formatting rules
- **Can be edited** — Modify name, description, or system prompt
- **Can be deleted** — Remove templates you no longer use
- **Are personal** — Only you can use them
- **Can be copied** — Create variations on your templates

### Creating a New Template

To create a brand new custom template:

1. In the **My Templates** section, click **Create Template**
2. A modal opens with a form containing:
   - **Template Name** — What to call it (required, max 100 characters)
   - **Description** — Explain the formatting style (optional, max 500 characters)
   - **System Prompt** — The formatting instructions (required)
3. Fill in each field:
   - Name: Something descriptive (e.g., "Novel Format", "Script Style")
   - Description: What makes it special (e.g., "Emphasis on dialogue over action")
   - System Prompt: The actual formatting rules and examples
4. Click **Save**
5. Your new template is created and appears in My Templates

### Template Form Fields Explained

#### Template Name

- **What it is** — The display name of your template
- **Max length** — 100 characters
- **Tips** — Use descriptive names; avoid abbreviations
- **Examples** — "Dramatic Format", "Fast-Paced Chat", "Comedy Style"

#### Description

- **What it is** — Optional explanation of the template (optional)
- **Max length** — 500 characters
- **Tips** — Explain the formatting philosophy
- **Examples** — "Emphasizes action and narration with minimal dialogue"

#### System Prompt

- **What it is** — The actual formatting instructions (required)
- **Used for** — Guides the AI on how to format responses
- **How to phrase it** — Plain formatting directives, stated as instructions. Written as: *Wrap narration in asterisks; keep replies to three paragraphs or fewer.*
- **Should include** —
  - Clear formatting rules
  - Examples of correctly formatted text
  - How different elements should appear
  - Any special conventions
- **Can use** — {{char}} and {{user}} placeholders

#### Narration Delimiters

- **What it is** — The character(s) used to mark narration text (required)
- **Why it's required** — The system uses this to semantically distinguish narration from speech
- **Format** — Either a single string (same character for open/close, like `*`) or a pair (different open/close, like `[` and `]`)
- **Examples** —
  - `*` — Standard asterisk narration: `*She sighed heavily.*`
  - `[`, `]` — Bracket narration: `[She sighed heavily.]`

#### Formatting Delimiters

Below the prompt and narration fields, the **Formatting Delimiters** list adds toolbar buttons and styling rules. Click **+ Add Delimiter** for each rule, then choose its **Kind**:

- **Wrap** — an opening and closing marker around an inline span (e.g. `*action*` or `[action]`). Choose **Same** for one marker on both sides, or **Pair** for different open/close markers.
- **Line prefix** — a marker at the start of a line styles the *whole line* (e.g. `// ` for an out-of-character aside). Set the **Line marker**.
- **Tag prefix** — a bracketed token at the start of a line styles the *whole line* when the token matches a pattern you set. For example, `[CAPTAIN] All hands on deck!` with the default "uppercase only" token rule. Set the **Brackets** (open and close) and the **Token pattern** — a regular expression whose default accepts uppercase and non-cased scripts but never lowercase. Edit it to suit (for example `\d+` to match a number).

Each rule also has:

- **Name** — the full label shown in the button's tooltip
- **Button Label** — the short text on the composer toolbar button (max 10 characters)
- **Style (CSS class)** — pick a built-in style or type your own theme class for a custom look. The built-in roster now runs to:
  - The classics — **Narration**, **Dialogue**, **Out of Character**, **Inner Monologue**
  - **Style 1–4** — four boldly contrasting liveries that every theme dresses in its own four hues, so a marked passage fairly leaps off the page
  - The semantics — **Danger**, **Warning**, **Success**, **Info**, **Muted**, and **Code** (the last in a monospace hand), each drawn from the theme's standing palette

#### Concealing the Marks

Each delimiter carries a **Conceal the marks when rendered** switch. Flip it on and the delimiters themselves vanish from the finished view while the styling remains — so `+a hush fell+` is read simply as *a hush fell*, handsomely dressed, with nary a `+` in sight. The marks stay in the underlying text (and in what the model is asked to produce); only the reader is spared them. It works for all three kinds: a wrap's bookends, a line prefix's marker, and a tag prefix's `[TAG]` are all quietly tidied away.

#### Flourishes

Beneath each rule sits a small parade of optional **Flourishes**, layered atop the chosen Style:

- **Bold** and **Italic** — the usual emphases
- **Reverse** — swaps foreground and background, turning light-on-dark into dark-on-light and vice versa
- **Underline** — none, single, or a distinguished **double** rule
- **Border** — none, a solid hairline, or a **dashed** one
- **Font** — leave it at *Default* or borrow the theme's Sans, Serif, Mono, Display, or Script hand

Mix them freely; they compose with whatever Style you've picked.

A delimiter is defined once and drives three things at once: the composer toolbar button, and how matching text is styled in both the live chat and the server-rendered views — so they always agree.

#### Draft Formatting Instructions

Next to the **LLM Prompt** label is a **Draft formatting instructions** button. Click it to append a starter paragraph describing your current delimiters to the prompt (for example, "Narration and action: wrap in `*…*`"). It is only a starting point — edit the text freely; the prompt remains exactly what is sent to the model.

### Previewing Your Templates

To see a custom template's details:

1. Find the template in **My Templates**
2. Click **Preview**
3. A modal shows:
   - Full template name and description
   - Complete system prompt
4. Review the formatting instructions
5. Close the modal

### Editing a Template

To modify a template you created:

1. Find the template in **My Templates**
2. Click **Edit** (pencil icon)
3. A modal opens with the current template details
4. Edit any or all fields:
   - **Name** — Change what it's called
   - **Description** — Update the explanation
   - **System Prompt** — Modify the formatting rules
5. Click **Save**
6. Your changes apply to existing chats using this template

### Deleting a Template

To remove a template you no longer need:

1. Find the template in **My Templates**
2. Click **Delete**
3. A confirmation dialog appears asking "Are you sure?"
4. Click **Confirm** to delete or **Cancel** to keep it
5. The template is removed from your list

**Important Notes:**

- Deletion is permanent and cannot be undone
- Chats using the deleted template keep their previous formatting
- Previous chat messages aren't affected by deletion
- You can recreate the template if needed

### Copying Your Templates

To create a variation of a template you made:

1. Find the template in **My Templates**
2. Click **Copy**
3. A modal opens with the template details
4. The name changes to "Template Name (Copy)"
5. Edit as needed (name, description, system prompt)
6. Click **Save**
7. Your copy appears as a new template

## Template Cards

### What Each Card Shows

Each template card displays:

- **Template name** — Prominently at the top
- **"Built-in" badge** — If it's a built-in template (only for built-in section)
- **Description** — Preview of what the template does
- **Action buttons** —
  - **Preview** — View full template details
  - **Edit** — Modify (custom templates only)
  - **Copy** — Create a copy
  - **Delete** — Remove (custom templates only)

### Template Card Layout

Built-in template cards show:

- Name and "Built-in" badge
- Brief description
- Preview and Copy buttons

Custom template cards show:

- Name
- Brief description
- Preview, Edit, Copy, and Delete buttons

## Managing Your Formatting

### Best Practices for Templates

When creating and managing templates:

1. **Name clearly** — Use descriptive names you'll recognize
2. **Document the style** — Write good descriptions
3. **Test thoroughly** — Use templates in chats before finalizing
4. **Keep it organized** — Delete unused templates
5. **Make copies** — Save versions before major edits
6. **Be explicit** — Clear rules prevent confusion

### Organizing Multiple Templates

If you have many templates:

1. **Group by style** — Romance templates, Action templates, etc.
2. **Name systematically** — "Genre_Role_Tone" format
3. **Clean up regularly** — Delete obsolete templates
4. **Copy working ones** — Keep templates you know work well
5. **Version management** — Name iterations clearly (v1, v2, etc.)

### Testing New Templates

When creating a new template:

1. **Create and save** — Get the template into the system
2. **Start a test chat** — Create a chat specifically for testing
3. **Select the template** — Set it in Chat Settings
4. **Try it out** — Send a few test messages
5. **Review results** — Do responses follow your formatting?
6. **Refine** — Edit the system prompt if needed
7. **Repeat** — Test again after changes
8. **Finalize** — Once it works, it's ready to use

## System Prompt Tips

### What Goes in a System Prompt?

Your system prompt should define:

1. **Formatting rules** — How to structure dialogue, actions, etc.
2. **Examples** — Show what correct formatting looks like
3. **Separators** — What characters mark different elements
4. **Structure** — How responses should be organized
5. **Conventions** — Any special rules or styles
6. **Edge cases** — How to handle unusual situations

### Example System Prompt Structure

```
[FORMATTING RULES]
1. Dialogue: Use "double quotes" for speech
2. Actions: Wrap in *single asterisks*
3. Narration: Use [square brackets]
4. Thoughts: Use ((double parentheses))
5. OOC: Use {{double braces}}

[EXAMPLES]
✓ "Hello!" said {{char}}.
✓ *{{char}} smiled warmly*
✓ [The sun was setting]
✓ ((I wonder what happens next))
✓ {{OOC: That was great!}}

[GUIDELINES]
- Keep dialogue concise and natural
- Use actions to show character feelings
- Avoid excessive narration
- Stay in character always
```

### Using Placeholders

Placeholders dynamically insert names:

- **{{char}}** — Replaced with the character's name
- **{{user}}** — Replaced with the user's name/user character name
- **Use in examples** — Show how names appear in formatted text
- **Use in instructions** — Reference {{char}} in rules

Example: "When speaking as {{char}}, always start with the character's name..."

## Status Messages

### Understanding Status Indicators

While using the settings:

- **"Saving..."** — Your changes are being saved
- **Success messages** — "Default template updated successfully"
- **Error messages** — If something goes wrong
- **Loading state** — When first loading templates

## Troubleshooting

### Can't Create a Template

**Problem:** Create Template button doesn't work or modal won't open

**Solutions:**

- Refresh the page
- Check your internet connection
- Verify you're logged in
- Try clicking again
- Check browser console for errors

### Template Won't Save

**Problem:** Clicking Save doesn't save the template

**Solutions:**

- Make sure all required fields are filled (Name and System Prompt)
- Check your internet connection
- Try saving again
- Refresh if it gets stuck
- Look for error messages

### Can't Edit a Template

**Problem:** Edit button is disabled or doesn't work

**Solutions:**

- Make sure it's a custom template (not built-in)
- Refresh the page
- Copy the template if you need to modify a built-in
- Try closing and reopening Settings

### Changes Not Applying

**Problem:** Edits to a template don't show up

**Solutions:**

- Refresh the page
- Check that you saved the changes
- Verify the chat is using the correct template
- Check Chat Settings to confirm template selection

### Default Template Not Working

**Problem:** New chats don't use the selected default

**Solutions:**

- Check that you selected a template (not "None")
- Verify the change was saved
- Create a new chat to test
- Check the Chat Settings to see what template was assigned
- Try a different template

## Tips for Success

1. **Start simple** — Begin with basic formatting rules
2. **Copy built-ins** — Use them as templates to customize
3. **Test thoroughly** — Verify templates work before relying on them
4. **Keep notes** — Document what each template is for
5. **Organize well** — Use clear names and descriptions
6. **Review regularly** — Clean up unused templates
7. **Backup important** — Keep copies of templates you use frequently
8. **Iterate** — Templates improve with testing and refinement

## In-Chat Settings Access

Characters with help tools enabled can read your roleplay template configuration during a conversation using the `help_settings` tool with `category: "templates"`. This returns the list of your templates (names, descriptions, and default status) and which template is set as the default for new chats. Ask a help-tools-enabled character something like "What roleplay templates do I have?" and it will produce the inventory.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=templates&section=roleplay-templates")`

The Roleplay Templates settings give you complete control over how your chats are formatted—take advantage of them to create the perfect style for your creative work!
