---
url: /settings?tab=images&section=story-backgrounds
---

# Story Backgrounds

Story Backgrounds is a feature that automatically generates atmospheric background images for your chats, creating an immersive visual context for your conversations and roleplay sessions.

## How It Works

When enabled, Quilltap generates a landscape scene image featuring your characters whenever a chat title is updated. The image appears as a subtle background behind your chat messages, adding atmosphere without interfering with readability.

### Generation Process

1. **Trigger**: Background generation happens automatically after chat title updates (both automatic and manual)
2. **Scene Understanding**: The system determines the current scene in one of two ways:
   - **Scene State Tracker** (preferred): After every chat turn, a lightweight background task automatically tracks the current scene — where characters are, what they're doing, and what they look like. When this data is fresh (within 5 messages), the Lantern uses it directly, saving an extra LLM call.
   - **On-demand derivation** (fallback): If no recent scene state exists, the system reads your recent messages and asks a cheap LLM to describe the scene, much as a particularly attentive stage manager might.
3. **Prompt Creation**: The system uses a cheap LLM to craft an atmospheric scene prompt based on the scene context and character appearances
4. **Image Generation**: The prompt is sent to your configured image generation profile
5. **Display**: The generated image appears as a semi-transparent background (30% opacity) behind your chat content

## Enabling Story Backgrounds

1. Go to the **Images** tab in Settings (`/settings?tab=images&section=story-backgrounds`)
2. Expand the **Story Backgrounds** card
3. Toggle **Enable Story Backgrounds** on
4. (Optional) Select a specific **Image Generation Profile** to use

If you don't select a specific profile, the system will use your default image generation profile.

## Requirements

- At least one image generation profile configured (see [Image Generation Profiles](image-generation-profiles.md))
- An active API key for your image provider
- Characters in your chat with physical descriptions (helps create better scenes)

## Tips for Best Results

### Character Descriptions
The more detailed your character's physical descriptions, the better they'll appear in backgrounds. Focus on:
- Physical appearance (height, build, hair, eyes)
- Typical clothing or attire
- Distinctive features

### Chat Titles
Chat titles are used as scene context. Descriptive titles like "Midnight conversation in the garden" produce better results than generic titles like "Chat 5".

### Image Profiles
Consider using an image profile with a model optimized for landscape/scene generation rather than portrait-focused models.

## Project Backgrounds

Projects can display backgrounds in different ways:

- **Theme**: No background image (uses your theme colors)
- **Static**: A manually uploaded background image
- **Project**: A generated background for the project (based on character roster)
- **Latest Chat**: Automatically uses the most recent chat's background

Set the mode on the project's own page, in the **Image Generation** card under **Story Backgrounds**. In **Theme** mode the project page falls back to whatever decorative backdrop your theme gives the Prospero section, exactly as the projects list does — the other three modes replace it with the project's chosen image.

When a project is open beside a conversation in a split workspace, the conversation's background wins the whole screen; the project's background returns when you close or move away from that conversation.

## Performance Notes

- Background images are generated as background jobs, so they won't slow down your chat
- Images are cached and don't re-generate unless the title changes
- The feature can be disabled at any time without affecting existing backgrounds

## Troubleshooting

**Background not appearing:**
- Check that Story Backgrounds is enabled in the **Images** tab in Settings (`/settings?tab=images&section=story-backgrounds`)
- On a project page, check the project's background display mode — in **Theme** mode the project shows the theme's backdrop rather than a generated one
- In **Latest Chat** mode, at least one chat in the project must already have a generated background
- Verify your image profile has a valid API key
- Check the Tasks Queue for any failed generation jobs

**Low quality backgrounds:**
- Try a different image generation model
- Ensure characters have detailed physical descriptions
- Use more descriptive chat titles

**Generation failing:**
- Check your image provider API key is valid and has credits
- Review the Tasks Queue for error messages
- Try a different image profile

## In-Chat Settings Access

Characters with help tools enabled can read your story backgrounds configuration during a conversation using the `help_settings` tool with `category: "images"`. This returns your image generation profiles and story background settings. Ask a help-tools-enabled character something like "Are story backgrounds enabled?" and it will consult the records.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=images&section=story-backgrounds")`

## Related Topics

- [Image Generation Profiles](image-generation-profiles.md)
- [Chat Settings](chat-settings.md)
- [Projects](projects.md)
