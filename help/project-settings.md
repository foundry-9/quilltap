---
url: /prospero/:id
---

# Project Settings

> **[Open this page in Quilltap](/prospero)**

Project settings let you configure how your project works, including instructions, file storage, tool access, and character participation. These settings affect all chats and operations within the project.

## Accessing Project Settings

1. Open the project
2. Find the **Settings** card/section
3. Click to expand or access settings
4. Make changes and save as needed

## Project Instructions

The most important setting — custom instructions that apply to all project chats.

### What Instructions Do

- Prepended to system prompts in every project conversation
- Define world rules, settings, constraints
- Establish tone, style, genre expectations
- Provide persistent context

### Writing Instructions

1. Open project settings
2. Find the **Instructions** editor
3. Write or edit your text
4. Click **Save**

**Maximum length:** 10,000 characters

**A word on address.** The instructions are slipped into each character's own system prompt — the character is the one reading them — so write as though speaking to the character directly. Written as: *You are helping Charlie draft sermon material; cite chapter and verse.* A third-person memorandum ("The characters should help Charlie…") reads, to its recipient, like lore about somebody else.

### Effective Instructions

**Be Specific:**
```
Setting: Medieval fantasy kingdom of Eldoria
Time Period: 300 years after the Great War
Magic: Common but requires formal training
Technology: Pre-gunpowder, medieval European level
```

**Set Expectations:**
```
Writing Style:
- Third person narrative
- Show don't tell
- Maintain consistency with established lore
- Build on previous conversations
```

**Define Rules:**
```
Character Guidelines:
- Stay in character at all times
- Reference the world bible when appropriate
- Ask clarifying questions if unsure about lore
- Don't contradict established facts
```

### When Instructions Apply

- Every new message in project chats
- All characters receive the instructions
- Instructions persist across sessions
- Updates apply to new messages immediately
- One-off Carina consultations (`@Name:` / `@Name?`) in project chats carry them too
- Help chats and the Brahma Console do not

Instructions live in the stable part of each character's system prompt, so they
are always in view — and providers can keep that portion of the prompt cached
between turns. Groups have the very same arrangement for their members; see
[Groups](groups.md).

## Tool Settings

Control which AI tools are available in project chats.

### Default Tool Access

By default, project chats have access to:
- All enabled global tools
- Project info tool (always enabled in projects)
- Character-specific tools

### Disabling Tools

1. Open project settings
2. Find **Tool Settings** section
3. Click to open tool configuration
4. Disable specific tools or tool groups
5. Save changes

**Disabled tools affect:**
- All new chats in the project
- New messages in existing chats
- All characters in project chats

### Tool Groups

You can disable entire groups:
- Plugin tools (e.g., `plugin:mcp`)
- Category of tools (e.g., all image tools)
- Specific tool by name

### Why Disable Tools?

**Privacy:**
- Disable web search for private projects
- Prevent external API calls

**Focus:**
- Disable image generation for text-only projects
- Remove irrelevant tool options

**Control:**
- Limit what AI can do in specific contexts
- Prevent accidental tool usage

### Settings Display

Tool settings show:
- Number of disabled tools
- Number of disabled groups
- Summary of restrictions

## Default Roleplay Template

Every project may keep its own house style of prose. Set a default [roleplay template](roleplay-templates.md) here and each new chat begun within the project arrives already dressed in it — the delimiters, the rendering flourishes, and the formatting instructions all in place — without your having to choose afresh each time.

1. Open the **Model Behavior** card
2. Find the **Default Roleplay Template** dropdown
3. Select a template, or "Inherit from global default" to leave it unset
4. Changes save automatically

The priority chain for the roleplay template of a new chat:
1. The project's default roleplay template (most specific)
2. Your global default roleplay template (set under **Settings → Roleplay Templates**)
3. No template at all

Leave the dropdown on "Inherit from global default" and the project quietly defers to whatever your global default happens to be. Should a chat have been created before a project default was appointed and still carry no template of its own, it will adopt the project's default the next time it speaks.

## Character Access Settings

Control which characters can participate in project chats.

### Allow Any Character

Toggle that controls character access:

**ON (Default):**
- Any character can join project chats
- No roster restrictions
- Most flexible

**OFF (Roster Mode):**
- Only roster characters can participate
- Characters must be approved
- More controlled

### Managing the Roster

When roster mode is enabled:
- Characters section shows approved list
- Add characters via roster or chat creation
- Remove characters from roster as needed

See [Project Characters](project-characters.md) for full roster details.

## Project Identity Settings

Configure how the project appears in the UI.

### Project Name

- Display name shown everywhere
- Maximum 100 characters
- Editable from project page header

**To change:**
1. Click project name or Edit button
2. Enter new name
3. Save changes

### Project Description

- Summary shown on project page
- Maximum 2,000 characters
- Helps remember project purpose

**To change:**
1. Click description or Edit button
2. Update text
3. Save changes

### Visual Customization

**Color:**
- Hex color code (e.g., `#3B82F6`)
- Used for project badge
- Helps distinguish projects visually

**Icon:**
- Emoji or icon identifier
- Displayed with project name
- Quick visual identification

## Image Generation Settings

Configure how image generation works for chats in this project.

### Default Image Profile

Set a default image generation profile for the project. New chats created in this project will inherit this profile, overriding whatever the global default might be — though a character's own default image profile, should one exist, will take precedence over the project's.

1. Open the **Image Generation** card
2. Find the **Default Image Profile** dropdown
3. Select a profile, or "Inherit from global default" to leave it unset
4. Changes save automatically

The full priority chain for image profiles in a new chat:
1. Project's default image profile (most specific)
2. Character's default image profile
3. Global default image profile

### Avatar Generation

Control whether character avatars are auto-generated when outfits change in new chats.

- **Inherit from global** — uses whatever the global setting dictates
- **Enabled by default** — new project chats auto-generate avatars
- **Disabled by default** — new project chats won't auto-generate

### Story Backgrounds

Choose how the project background is displayed:
- **Theme background** — no image, uses your theme colours
- **Latest chat background** — shows the most recent background from any chat in the project
- **Project background** — uses a background generated specifically for this project
- **Static image** — uses a manually uploaded background image

## Settings Organization

Settings are typically organized in cards:

### Instructions Card
- Text editor for project instructions
- Save button
- Character count indicator

### Tools Card
- Summary of restrictions
- Configure button
- Tool selection modal

### Characters Card
- Allow Any Character toggle
- Roster display (when applicable)
- Add/remove character options

## Saving Settings

Most settings save automatically or with explicit save:

### Auto-Save
- Toggle switches (Allow Any Character)
- Dropdown selections
- Immediate effect

### Manual Save
- Instructions text (Save button required)
- Complex configurations
- Shows save confirmation

### Save Indicators
- Loading spinner during save
- Checkmark on success
- Error message on failure

## Best Practices

### Instructions Best Practices

- Keep focused and specific
- Update as project evolves
- Don't repeat character-level info
- Use clear, parseable formatting

### Tool Best Practices

- Disable only what you need to
- Test after disabling tools
- Remember project info tool is always on

### Character Best Practices

- Use roster mode for focused projects
- Leave open for exploration
- Review roster periodically

## Troubleshooting

### Instructions not saving

**Causes:**
- Network issue
- Text too long
- Validation error

**Solutions:**
- Check network connection
- Reduce instruction length
- Remove invalid characters
- Try again

### Tool settings not applying

**Causes:**
- Settings not saved
- Chat predates setting change
- Tool is core/unblockable

**Solutions:**
- Verify settings saved
- Send new message (settings apply to new messages)
- Check if tool can be disabled

### Character settings not updating

**Causes:**
- Toggle didn't save
- UI not refreshed
- Existing chats unaffected

**Solutions:**
- Verify toggle state
- Refresh page
- New chats will use new settings

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/prospero/:id")`

## Related Pages

- [Projects Overview](projects.md) — Main project documentation
- [Project Files](project-files.md) — File management
- [Project Chats](project-chats.md) — Conversations in projects
- [Project Characters](project-characters.md) — Character roster
- [Tools Settings](tools-settings.md) — Global tool configuration
- [Roleplay Templates](roleplay-templates.md) — Prose formatting templates and the global default
