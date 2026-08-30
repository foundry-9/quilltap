---
url: /settings?tab=chat&section=dangerous-content
---

# Dangerous Content Handling

Dangerous Content Handling is a feature that classifies messages for sensitive or potentially policy-violating content and optionally routes them to uncensored-compatible LLM providers.

## Overview

When enabled, the system classifies user messages before they are sent to the main LLM. Content that exceeds the configured threshold is flagged and can be:

- **Detected and flagged** with warning badges (Detect Only mode)
- **Automatically routed** to an uncensored-compatible provider (Auto-Route mode)

The system is designed to be fail-safe: classification errors never block your messages.

### What is never moderated

Moderation applies only to roleplay surfaces — the Salon and autonomous rooms. **Help Chats and the Brahma Console are exempt entirely:** the Concierge never classifies, flags, reroutes, or announces on them, regardless of your global settings. They are utility surfaces, not roleplay, so the gatekeeper has no standing there.

### Smart Classification

Quilltap automatically selects the best available classification method:

1. **OpenAI Moderation Endpoint** (preferred): If you have an OpenAI connection profile configured, Quilltap uses OpenAI's dedicated moderation endpoint automatically. This endpoint is purpose-built for content classification, is free to use with any OpenAI API key, and returns structured category scores. No additional configuration is needed — simply having an OpenAI connection profile is sufficient.

2. **Cheap LLM Fallback**: If no OpenAI connection profile is available (or no moderation provider plugin is installed), Quilltap falls back to sending the content to your configured Cheap LLM with a classification prompt. This costs tokens per message and depends on the Cheap LLM's quality.

The system tries the moderation provider first and transparently falls back to the Cheap LLM if needed.

## Modes

### Off (Default)

No content scanning or routing. Messages are sent directly to your configured LLM provider.

### Detect Only

Messages are scanned and flagged with danger categories (e.g., NSFW, Violence, Hate Speech) but are still sent to your regular provider. Flagged messages display warning badges and can be blurred or collapsed based on your display settings.

### Auto-Route

Messages are scanned, and flagged content is automatically rerouted to an uncensored-compatible provider. If no uncensored provider is available, the message is sent to your regular provider with a warning notification.

## Configuration

Navigate to the **Chat** tab in Settings (`/settings?tab=chat&section=dangerous-content`) and expand **Dangerous Content Handling** to configure:

### Detection Threshold

A slider from 0.1 to 1.0 that controls sensitivity:
- **Lower values** (0.1-0.4): More sensitive, flags more content
- **Default** (0.7): Balanced sensitivity
- **Higher values** (0.8-1.0): Only flags strongly dangerous content

### Scan Toggles

- **Text Chat Messages**: Classify user messages before sending to the LLM
- **Image Prompts**: Classify image generation prompts before expansion
- **Image Generation**: Classify the expanded prompt before sending to the image generator

### Uncensored Providers (Auto-Route only)

- **Text LLM Profile**: Select a specific connection profile or auto-detect
- **Image Generation Profile**: Select a specific image profile or auto-detect

When set to auto-detect, the system scans all your profiles marked as "Uncensored-Compatible" and uses the first available one.

### Display Settings

- **Show**: Display flagged content normally with a warning badge
- **Blur**: Blur flagged content with a click-to-reveal overlay
- **Collapse**: Hide flagged content behind a collapsible placeholder
- **Warning Badges**: Toggle category badges on flagged messages

### Custom Classification Prompt

Additional instructions appended to the content classifier's system prompt. Use this to adjust sensitivity for your specific use case (e.g., "Be more lenient with fantasy violence in roleplay contexts").

## Setting Up Uncensored Providers

To use Auto-Route mode, you need at least one connection profile marked as uncensored-compatible:

1. Go to the **AI Providers** tab in Settings (`/settings?tab=providers&section=connection-profiles`) and expand **Connection Profiles**
2. Edit or create a profile that connects to an uncensored-compatible model
3. Check the **"Uncensored-compatible"** checkbox
4. Save the profile

The same applies to image profiles if you want image generation routing.

Common uncensored-compatible setups:
- Local Ollama models (many models have uncensored variants)
- OpenRouter with uncensored model selections
- Self-hosted models with no content filtering

## How Classification Works

### With Moderation Provider (OpenAI)

1. Your message is sent to the OpenAI moderation endpoint (`/v1/moderations`)
2. The endpoint returns structured category flags and confidence scores (e.g., `sexual: 0.92`, `violence: 0.01`)
3. Provider-specific categories are mapped to Concierge categories (e.g., OpenAI's `sexual` → `nsfw`, `hate` → `hate_speech`)
4. If any category score exceeds your threshold, or the provider flags the content, it is marked as dangerous
5. Classification results are cached by content hash (5 minute TTL, up to 200 entries)

### With Cheap LLM (Fallback)

1. Your message is sent to the Cheap LLM with a classification prompt
2. The LLM returns a JSON response with danger categories and scores
3. If the overall score exceeds your threshold, the content is flagged
4. Classification results are cached by content hash (5 minute TTL, up to 200 entries)
5. Each classification is logged as a `DANGER_CLASSIFICATION` system event for cost tracking

### Categories

The classifier checks for:
- **NSFW**: Sexual or explicitly adult content
- **Violence**: Graphic violence, gore, or descriptions of harm
- **Hate Speech**: Hateful, discriminatory, or dehumanizing language
- **Self-Harm**: Content encouraging or depicting self-harm
- **Illegal Activity**: Content describing or encouraging illegal activities
- **Disturbing**: Deeply disturbing, shocking, or upsetting content

## Message Flags

Flagged messages display:
- **Category badges**: Colored labels showing which categories were detected
- **Rerouted badge**: Blue badge indicating the message was sent to an uncensored provider
- **"Not Dangerous" button**: Allows you to override the classification

Overriding a message's danger flags marks all flags as user-overridden and removes the visual effects.

## Image Prompt Expansion

When an image prompt is flagged as dangerous, the system can use a separate uncensored LLM for prompt expansion (the step where character placeholders are resolved into visual descriptions). Configure this in the **Chat** tab in Settings (`/settings?tab=chat&section=dangerous-content`) under **Cheap LLM Settings** > "Image Prompt Expansion LLM (Uncensored - Optional)." If not set, the standard cheap LLM is always used for prompt expansion.

## Story Background Prompts

The Lantern's story backgrounds hold a second, separate courtesy. By default the prompt crafter translates any undressed or intimate moment into cinematic concealment — drapery, silhouette, foreground occlusion — because ordinary image providers reject the alternative.

That courtesy is now conditional. When a chat is marked dangerous **and** you have an uncensored image profile configured, the picture is already headed for a door that does not moderate, so the crafter describes the scene plainly instead. Previously the concealment applied regardless, and an uncensored provider received a scene needlessly draped for a provider it was never going to see.

The same holds on a reroute: if a standard provider rejects a finished image for moderation and the Concierge sends it to your uncensored profile, the prompt is re-crafted candidly for that provider rather than forwarded unchanged.

If no uncensored image profile is configured, concealment applies as before — the character appearance descriptions are additionally sanitized in that case, since there is nowhere else for the image to go.

### Both conditions, and how they are commonly missed

The candid draft requires **two** things at once, and a picture that comes back unexpectedly demure has almost always lost one of them.

**The chat must actually be Flagged, not merely flaggable.** Auto-Route flags a chat when the classifier's score clears your **Detection Threshold**, and a chat can be thoroughly undressed while scoring well under it — the classifier weighs the whole compressed summary, not the state of anybody's wardrobe. A scene may therefore sit at a score of 0.3 against a threshold of 0.8, be marked Safe, and receive the concealed draft for as long as it likes. If a chat ought to be candid and the classifier disagrees, flip it yourself with the per-chat Concierge switch described below; a manual flag is sticky, and the classifier will not quietly overturn it later.

**The adapter must sit on the profile the Concierge actually routes to.** The **Image Generation Profile** named under *Uncensored Providers* is a distinct setting from whichever profile a given chat happens to use. Configure a LoRA on one profile while the Concierge points at another and a reroute will hand your scene to the other profile — correctly, obediently, and without the adapter. When you retire an uncensored profile in favour of a new one, move this setting across with it.

A useful way to tell the two failures apart after the fact: read the prompt on the finished image. If it drapes the scene ("modestly concealed", "silhouetted", "a sheet arranged just so") the crafter was working from the concealed instructions and the first condition failed. If it says plainly what the scene is and the picture is still demure, the prompt reached a provider or an adapter that declined it — see *The adapter seems to have made no difference* in [Image Generation Profiles](image-generation-profiles.md).

## Chat-Level Classification

In addition to per-message scanning, Quilltap can classify entire chats as dangerous based on the compressed context summary. This happens automatically in the background after messages are exchanged and a context summary has been generated.

### How It Works

1. After a new context summary is generated for a chat, a background job is queued
2. The context summary is sent to the Cheap LLM gatekeeper for classification
3. The chat is marked as dangerous or safe based on the threshold

### Sticky Classification

Once a chat is classified as dangerous, it stays marked as dangerous permanently. This prevents the classification from flip-flopping as conversations evolve. Safe chats are re-checked whenever new messages are added (message count changes).

### In-Chat Announcement

When a chat is first marked as dangerous, the Concierge — one of "the Staff" — steps quietly to the table and posts a brief message of his own. Worded with deliberate discretion, it lets every character at the table (those who can see the Staff) know that the conversation, and any errands attending it, will henceforth be entrusted to a desk better suited to the matter. The announcement carries the Concierge's avatar and is part of the normal chat history; nothing further is required of the user.

The announcement now names *what drew his eye* — the contributing categories with their severity scores, the overall score, the threshold in force, and which assayer (moderation provider or cheap-LLM fallback, by provider name) rendered the verdict. This makes it transparent why the reroute happened and lets you tune the threshold or correct misclassifications with confidence.

The wording also distinguishes *how* the verdict was reached. A chat is marked dangerous when **either** the overall severity meets your threshold **or** the assayer flags the content of its own accord — moderation providers such as OpenAI return a `flagged` decision against their own internal catalogue, independent of your numeric threshold, so this fires even when the reported severities sit well below it. When the threshold was actually met, the announcement reads "registering X against the present threshold of Y." When the assayer flagged it directly while the severities stayed below the bar, it instead says the matter was marked "by the direct verdict of" the assayer, reports the (sub-threshold) severities for context, and notes that it was the assayer's judgement — not the arithmetic — that drew his eye. So a notice can legitimately show a severity *below* your configured threshold.

### Optimizations for Permanently Dangerous Chats

When a chat has been permanently classified as dangerous, Quilltap applies several optimizations to save tokens and avoid futile content refusals:

- **Per-message classification is skipped**: Since every message in a permanently dangerous chat will be dangerous, individual message scanning is bypassed entirely. Danger flags are synthesized from the stored chat-level categories instead.
- **Uncensored providers are not rerouted unnecessarily**: If you have already assigned an uncensored-compatible provider to a character (e.g., DeepSeek), the Concierge will not swap it for the configured uncensored fallback. It only falls back to the configured provider if the current one returns an empty response (suggesting it was caught by censorship anyway).
- **All background tasks use uncensored providers**: Memory extraction, title generation, context summaries, scene state tracking, story backgrounds, and inter-character memory tasks all automatically use your configured uncensored provider in dangerous chats. This prevents content refusals from censored providers that would otherwise silently fail these background operations.

### Manual Reclassification

If a chat was incorrectly classified as dangerous, you can reset its classification. This can be done via the API (`POST /api/v1/chats/[id]?action=reclassify-danger`), which clears the classification and re-queues it for evaluation.

## When a Provider Refuses Outright

There is a distinction worth drawing between a model that *declines* and a model that *falters*, because the remedies are entirely different and one of them used to be offered for both.

A provider with a moderation layer of its own — Z.AI, OpenAI, Azure, Google — may simply refuse a turn. When it does, it says so: it returns nothing at all and stamps the reply with a reason of its own choosing (`sensitive`, `content_filter`, `refusal`, `SAFETY`, and so on). This is testimony, not a hiccup, and Quilltap now reads it and repeats it to you plainly, naming the provider, the model, and the word it used.

Formerly every empty reply was met with the same suggestion — *this is a known issue with some providers, please try resending your message* — which for a refusal is advice that cannot possibly work. The same content sent to the same moderation layer will be refused again, and again, as many times as you care to ask.

What does work:

- **Reroute the chat to an uncensored provider.** This is precisely what the Concierge's Auto-Route mode exists for; see *Modes* above.
- **Change what is being asked for.** Occasionally the refusal is about a single phrase or a single image rather than the whole scene.

Note that a refusal may concern an *image* you have attached quite as readily as anything written. If a vision model has been declining a picture, its reason will now say so rather than leaving you to guess at a blank reply.

### When the Turn Is Carrying a Picture

A reroute swaps the model but keeps the conversation already assembled — and if the profile you began the turn with reads pictures, that assembly has a picture *in* it, in the raw. Hand that bundle to a substitute that reads only words and the gateway will not even trouble the model with it: it returns a flat refusal of its own, the character says nothing at all, and the whole rescue is spent before it starts. This was, for a time, precisely what happened, and with a faultlessly configured pair of profiles on either side of the swap.

The Concierge now asks the substitute what it can read before handing anything over.

- **Choosing the understudy.** When no uncensored profile has been named and the Concierge is scanning your profiles for one, it now puts the profiles that can take the turn's attachments at the front of the queue. It does not strike the others out — a described picture is worth a great deal more than a silent character — but it will not reach past a capable model for an incapable one.
- **Preparing the payload.** Whichever profile is called, uncensored or not, named by you or found by the scan, the attachment question is asked again on its behalf. A picture the substitute cannot see is replaced by a written description of it — the same courtesy Quilltap extends to any text-only model you attach a photograph to — and the retry proceeds with the words instead of the bytes. A substitute that *can* see receives the picture untouched, exactly as before.

The practical upshot is that an image-bearing turn is no longer the one turn the Concierge's last line of defence cannot cover. You may still prefer to name a vision-capable profile as your uncensored fallback, and there is every reason to: a described picture is a summary, and the model that reads the original will always have more to go on.

## The Per-Chat Concierge Switch

Every chat keeps a small brass switch in the sidebar — found under the **Chat** section of the Chat Sidebar — bearing three positions: **Safe**, **Flagged**, and **Off-duty**. It is the only place a chat's relationship with the Concierge may be set, adjusted, or — should the operator so insist — dispensed with entirely.

### Safe

The default footing. The global Concierge settings apply: the gatekeeper makes his quiet rounds before each dispatch, and if the conversation drifts into the sort of territory that draws his eye, he will throw the switch himself and announce, with all due discretion, that the chat is now Flagged. This is the position you want for ordinary use.

### Flagged

The chat is to be treated as dangerous. Subsequent text traffic is routed to the uncensored desk; background errands — memory extraction, title revisions, story backgrounds — likewise. The position arrives in one of two ways: the Concierge has flipped it himself after classification, or the operator has thrown the switch by hand. To throw it back to Safe, simply select Safe; the Concierge will stand down for the moment, and resume his customary watch on the next user message.

### Off-duty

Reserved for the operator who would prefer the Concierge take the afternoon off. In this position **no moderation occurs**. The gatekeeper does not classify, the prompts go to whichever censored provider the chat is configured to use, and image generators receive whatever the conversation produces, unaltered. Provider refusals — and the occasional sternly worded reply — are part of the bargain. The chat never auto-flips out of Off-duty; only the operator's hand returns it to Safe or Flagged.

Each transition between positions is announced in the chat history by the Concierge himself, in his customary voice, so the conversation's moderation provenance remains transparent on later re-readings.

## Quick-Hide Integration

Chats classified as dangerous can be hidden from the sidebar using the quick-hide system.

### Hiding Dangerous Chats

1. Click the **eye icon** in the sidebar footer
2. In the **Content Filters** section, toggle **"Dangerous Chats"** to hide them
3. Dangerous chats will be hidden from the sidebar, projects section, and all-chats page

The toggle is persisted in your browser's local storage, so your preference is remembered across sessions.

## Automatic Background Classification

When dangerous content handling is enabled, Quilltap automatically classifies all existing chats in the background. This runs on startup and periodically every 10 minutes, ensuring legacy chats created before the feature was enabled also get classified.

- Chats with a context summary are classified directly from the summary
- Longer chats without a summary first have a summary generated, which then triggers classification
- Shorter chats without a summary are classified from the raw message history
- Background classification runs at a lower priority than interactive tasks, so it won't slow down your active conversations

## Important Notes

- If you have an OpenAI connection profile, classification uses the free moderation endpoint (no token cost)
- Without an OpenAI profile, classification falls back to your Cheap LLM, adding a small token cost per scanned message
- Only user messages are scanned per-message, not assistant responses (and permanently dangerous chats skip per-message scanning entirely)
- Chat-level classification uses the compressed context summary (covers the whole conversation)
- The system never blocks messages — if anything fails, your message goes through normally
- If no uncensored provider is available in Auto-Route mode, the message is sent to your regular provider with a warning
- Classification accuracy depends on the method used: the OpenAI moderation endpoint is purpose-built and highly accurate; the Cheap LLM fallback depends on the model's capabilities

## In-Chat Settings Access

Characters with help tools enabled can read your current dangerous content configuration during a conversation using the `help_settings` tool with `category: "chat"`. The chat category includes your dangerous content handling settings alongside other chat preferences. Ask a help-tools-enabled character something like "What are my dangerous content settings?" and it will look them up.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=chat&section=dangerous-content")`

## Related Topics

- [Chat Settings](chat-settings.md) - Configure global chat behavior
- [Connection Profiles](connection-profiles.md) - Set up LLM providers
- [Image Generation Profiles](image-generation-profiles.md) - Configure image providers
