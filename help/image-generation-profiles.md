---
url: /settings?tab=images&section=image-profiles
---

# Image Generation Profiles

> **[Open this page in Quilltap](/settings?tab=images&section=image-profiles)**

Image Generation Profiles configure services that can create images during chats. With an image generation profile set up, you can ask an AI to generate images as part of your conversations.

## Understanding Image Generation

Image generation allows your AI to create images based on descriptions you provide. For example:

- "Generate a fantasy landscape with mountains"
- "Create a character portrait in anime style"
- "Make an illustration of a castle"

The AI sends your description to an image generation service, which creates and returns an image.

## On the Shape of a Picture — Orientation

A portrait wishes to stand tall; a sweeping vista wishes to lie down and stretch out. Alas, the various ateliers cannot agree on how one *asks* for such a thing. Some expect an exact measurement in pixels (and quarrel over which measurements are permissible, model by model); others insist upon an aspect ratio and turn up their noses at pixel counts entirely; and a few can be persuaded only by the wording of the request itself.

Quilltap now spares you the whole tedious diplomacy. You — and any character wielding the `generate_image` tool — simply name an **orientation**:

- **portrait** — taller than wide, the proper carriage for a face or a figure
- **landscape** — wider than tall, the natural posture of a scene or a horizon
- **square** — even-handed, beholden to neither dimension

The establishment then translates that wish into whatever each provider actually honours — a concrete size, an aspect ratio, or a discreet phrase slipped into the prompt — so the same instruction works everywhere. Where a provider is wholly incapable of a given shape (the venerable DALL·E 2, for instance, paints only squares), Quilltap declines to send a measurement it would reject and instead nudges the composition with words.

Sensible defaults are already in place: **avatars arrive in portrait**, **story backgrounds in cinematic landscape**. And because providers have a habit of returning a different shape than was requested, Quilltap now measures every finished picture and records its *true* dimensions, rather than trusting the order it placed.

## The Model's Own Dials — Per-Model Options

Time was, the profile form offered every provider one fixed little tray of settings, whether or not the chosen model had any use for them — a size list assembled by hand, and precious little else. That arrangement has been retired.

Each provider's plugin is now asked, freshly and for **the very model you have selected**, what it would like to be asked. The gateways that route to two hundred ateliers answer differently for each one: sizes drawn from that model's own advertised canvases, an images-per-request ceiling it will actually honour, and whatever dials it genuinely reads — inference steps, guidance scale, and so forth — with the dials it has no use for simply not offered. Change the model and the form changes with it.

Two courtesies worth knowing:

- **Your settings are not thrown away when you change models.** A value the new model has no use for is merely not shown; return to the old model and it is waiting where you left it.
- **A blank box means "as the model pleases."** The greyed-out number you see is the default that will apply, not a value you have chosen.

Providers whose plugins have not yet adopted the arrangement carry on with the old fixed tray, and nothing about their profiles changes.

## Adapters, or the Borrowing of Another Hand — LoRAs

A **LoRA** is a small parcel of learned style — a look, a face, a manner of drawing — that rides along with a model and bends its hand toward some particular result. Not every atelier will accept one, and those that do disagree, as ateliers will, about how many they will entertain at once and how they wish to be told.

Quilltap conducts that negotiation on your behalf. Choose a model that accepts adapters and a **LoRA Adapters** panel appears beneath the options; choose one that does not and the panel is simply absent — no empty boxes, no invitation to configure something that will be quietly ignored.

Each row asks for three things, of which only the first is compulsory:

- **Source** — where the weights live: a HuggingFace `owner/model-name`, or a direct URL to a `.safetensors` file. The panel says which kinds the chosen model accepts.
- **Strength** — how firmly the adapter's hand is on the pen. The slider's range and its resting position are the model's own, not one universal guess; leave it alone and the model's default applies.
- **Trigger Phrase** — many adapters answer only to a magic word, and sulk without it. Whatever you write here is woven into the prompt on every picture this profile paints, so you need never remember to say it yourself.

**A preset is not an adapter, whatever the neighbouring boxes may imply.** Certain establishments — the `flux-lora` family among them — offer a **LoRA Preset** field in the options above, and it is a different animal entirely: a name for a style the house already keeps in its own cellar, not a parcel of weights you have gone out and fetched. Write a HuggingFace address into it and the house will look for that name on its shelf, fail to find it, and say so. Adapters belong in the **Source** row below; presets belong in the preset box, and only when someone has actually given you one. Either may be used without the other.

**On the matter of the cap.** Each model states how many adapters it will take, and the panel keeps the tally for you ("2 of 3"), refusing to add a fourth where three is the limit. Should you point a well-stocked profile at a stingier model, the surplus rows are **flagged, not discarded** — they sit there in amber, explaining that they will be left behind on every request until you either remove one of their elders or return to a model of more generous habits. Nothing is deleted behind your back, and switching back restores the full arrangement intact.

**Where the adapters apply.** Everywhere that profile paints: pictures asked for in the Salon, character avatars, story backgrounds, and the wardrobe's preview portrait alike. A LoRA configured once is not a Salon-only affectation.

**On the subject of NanoGPT**, whose arcade is the first to be wired for this: the `flux-2-dev-lora` pair will take four adapters, the wider Flux 2 Klein, Z-Image and Krea families three, and the `flux-lora` and Pruna families one apiece. Should NanoGPT advertise a LoRA-capable model whose particular dialect Quilltap does not yet know, the panel will still offer you a single adapter — but the establishment declines to guess at the wording and will say so in the logs rather than post an order the model would silently ignore.

## Accessing Image Generation Profiles

1. Click **Settings** (gear icon) in the left sidebar
2. Click the **Image Profiles** tab
3. You'll see any existing profiles and an option to create new ones

## Viewing Image Profiles

The profiles list shows:

- **Profile Name** — Name you gave the profile
- **Provider** — Which image service (OpenAI, Google, Grok, OpenRouter, Z.AI, NanoGPT)
- **Default Badge** — If this is the default image generation profile
- **Status** — Whether configuration is complete
- **Actions** — Buttons to edit or delete the profile

## Creating a New Image Generation Profile

### Step 1: Get an API Key

First, obtain an API key from one of the image generation providers Quilltap actually speaks to:

**OpenAI (DALL-E / GPT Image):**

1. Go to platform.openai.com
2. Create or use an existing OpenAI API key
3. Return to Quilltap

**Google (Imagen / Gemini image models):**

1. Visit Google AI Studio (aistudio.google.com)
2. Create a Gemini API key

**Grok (xAI):**

1. Visit console.x.ai
2. Create an API key

**OpenRouter:**

1. Visit openrouter.ai
2. Create an API key — one key opens the door to every image-capable model they route

**Z.AI (CogView / GLM-Image):**

1. Visit z.ai and open the API platform
2. Create an API key

**NanoGPT (Flux / HiDream / Recraft and two hundred others):**

1. Visit nano-gpt.com and open the API page
2. Create an API key — pay-as-you-go, no subscription, and the same key serves chat and embeddings besides

### Step 2: Add the Key to Quilltap

1. Go to the **AI Providers** tab in Settings (`/settings?tab=providers&section=api-keys`) and expand **API Keys**
2. Click **Add API Key**
3. Select the image provider from the dropdown
4. Enter your API key
5. Click Save
6. Test the key to verify it works

### Step 3: Create the Image Profile

1. Go back to Settings → **Image Profiles** tab
2. Click **Add Image Profile**
3. A form appears with these fields:

   **Basic Information:**
   - **Profile Name** — Name this configuration (e.g., "DALL-E Production", "Stable Diffusion Fast")
   - **Provider** — Select the image service
   - **API Key** — Choose from your stored API keys (must match provider)

   **Model Selection:**
   - **Model** — Select which image model to use
     - OpenAI: gpt-image-2, gpt-image-1.5, gpt-image-1, gpt-image-1-mini (legacy DALL-E: dall-e-3, dall-e-2)
     - Google: Imagen models and image-capable Gemini models
     - Grok: grok-imagine-image, grok-imagine-image-pro, grok-2-image
     - OpenRouter: every image-output model they route
     - Z.AI: cogview-4-250304, glm-image
     - NanoGPT: hidream, the flux-2 family, recraft-v3, gpt-image-1.5 — Fetch Models reveals the full two-hundred-strong gallery
   - **Fetch Models** — Once an API key is chosen, press this to ask the provider itself which image models your key can reach. A green tally confirms the list came straight from the establishment; otherwise you're looking at the plugin's built-in list, and the note beneath says so plainly — no pretence either way. Only models that genuinely produce images are shown; the chat, embedding, and video sorts are firmly shooed away.

   **Configuration:** whatever the chosen model actually reads — see *The Model's Own Dials* above. Commonly:
   - **Default Size** — image dimensions, drawn from the model's own advertised canvases where the provider publishes them
   - **Quality** — level of detail (Standard, HD)
   - **Style** — art direction (Vivid, Natural), where the provider offers the choice
   - **Inference Steps / Guidance Scale** — the diffusion dials, offered only to the open-weight models that read them

   **LoRA Adapters:** present only when the chosen model accepts them — see *Adapters, or the Borrowing of Another Hand* above.

4. Click **Save** to create the profile

## Editing an Image Profile

To modify an existing profile:

1. Find the profile in the list
2. Click **Edit** button (pencil icon)
3. Update any settings:
   - Profile name
   - API key (switch to different key)
   - Model (switch to different model — the options below rearrange themselves to suit it, keeping what you had set)
   - Size, quality, or style defaults
   - LoRA adapters, where the model accepts them
4. Click **Save Changes**

## Setting a Default Profile

Your default profile is used when:

- You use image generation in a chat
- The chat doesn't have a specific image profile selected

To set as default:

1. Find the profile in the list
2. Click **Set as Default**
3. A checkmark shows this is now the default
4. Other profiles become secondary options

**Why have a default:**

- Most images use the default profile
- Saves configuration time
- Can override per-chat if needed

## Deleting an Image Profile

To remove a profile:

1. Find the profile in the list
2. Click **Delete** button (trash icon)
3. Confirm the deletion
4. Profile is removed
5. Any chats using it will need a new profile

## Using Image Profiles in Chats

### Requesting Image Generation

To ask for an image in a chat:

1. Type a description of the image you want
2. Example: "Generate a portrait of a fantasy character with purple hair"
3. Send the message
4. The AI uses your default image profile to generate the image
5. The generated image appears in the chat

### Selecting a Different Profile

Some chats may have a different image profile selected. To check:

1. Open a chat
2. Look for chat settings or profile selector
3. See which image profile is active for that chat
4. Can usually change it before requesting image generation

### Image Quality Factors

The quality of generated images depends on:

- **Provider quality** — each provider's models have different capabilities
- **Model version** — Newer models usually produce better results
- **Prompt quality** — Detailed descriptions produce better results
- **Settings** — Quality, size, and style settings affect output
- **Cost** — Higher quality usually costs more

## Supported Image Providers

These are the establishments Quilltap can actually commission a picture from — no more, no fewer. (Midjourney, Stable Diffusion, and local engines such as ComfyUI are not supported.)

### OpenAI (DALL-E / GPT Image)

- **Models:** GPT Image family (gpt-image-2, gpt-image-1.5, gpt-image-1, gpt-image-1-mini) and legacy DALL-E 3 / DALL-E 2
- **Strengths:** Good all-around quality, text in images
- **Sizes:** 1024x1024, 1024x1536, 1536x1024 (GPT Image); 1024x1792, 1792x1024 (DALL-E 3)
- **Quality:** Standard, HD

### Google (Imagen / Gemini)

- **Models:** Imagen 4 family via the predict API; image-capable Gemini models (e.g. gemini-2.5-flash-image) via generateContent
- **Strengths:** Strong photorealism, aspect-ratio control, negative prompts (Imagen)

### Grok (xAI)

- **Models:** grok-imagine-image, grok-imagine-image-pro, and legacy grok-2-image
- **Strengths:** Fast, aspect-ratio control; the pro model renders at 2k

### OpenRouter

- **Models:** Whichever image-output models OpenRouter routes at the moment — Fetch Models asks their catalogue directly
- **Strengths:** One key, many ateliers

### Z.AI (CogView / GLM-Image)

- **Models:** cogview-4-250304, glm-image
- **Strengths:** Discrete recommended sizes up to 1664x928 / 928x1664; economical
- **Note:** Image URLs returned by Z.AI are valid for 30 days; Quilltap saves the picture locally on arrival, so this is Z.AI's concern rather than yours

### NanoGPT (Flux / HiDream / Recraft)

- **Models:** hidream by default, with the flux-2 family, recraft-v3, gpt-image-1.5, and some two hundred more behind Fetch Models
- **Strengths:** One pay-as-you-go key admits you to every atelier in the arcade — and the same key serves chat and embeddings
- **LoRAs:** the Flux 2 Dev, Flux 2 Klein, Z-Image, Krea, Pruna P-Image and `flux-lora` families all accept adapters — see *Adapters, or the Borrowing of Another Hand* above
- **Note:** Each model keeps its own native canvas sizes; hand NanoGPT one of the common sizes from the profile and it seats your request at the nearest native resolution without complaint

## Configuration Tips

### For Fast Generation

- Choose a faster model
- Use standard quality
- Use smaller sizes
- May sacrifice quality for speed

### For High Quality

- Use newer models
- Enable HD quality
- Use larger sizes
- Costs more and takes longer

### For Specific Styles

- Set preferred style in profile
- Include style description in image prompt
- Example styles: Photorealistic, Watercolor, 3D Render, Sketch

### Cost Optimization

- Create different profiles for different uses
- Use cheaper provider for drafts
- Use high-quality provider for final images
- Monitor token/credit usage

## Image Generation Workflow

### Before First Use

1. Create API key with image provider
2. Add API key to Quilltap (API Keys tab)
3. Create image generation profile
4. Test profile works
5. Set as default (optional)

### In a Chat

1. Type a description of image you want
2. Ask the AI to generate it
3. AI uses active profile to create image
4. Generated image appears in chat
5. Can ask AI to modify, regenerate, or create variations

### After Generation

- Images are saved in chat history
- Can be downloaded or exported
- Can be used as attachments in other messages
- Can be added to image library

## Troubleshooting Image Generation

### API key validation failed

**Solution:**

- Verify API key in API Keys tab
- Test key directly with provider
- Check that key has image generation permission
- Some API keys may have restricted permissions

### Can't find image profile in chat

**Reasons:**

- Profile might not be created yet
- No valid API key for provider
- Chat may have specific profile that was deleted

**Solutions:**

- Create image profile in Settings
- Ensure API key is valid
- Create new profile for chat to use

### Image generation not working in chat

**Check:**

- Is an image profile set as default?
- Does the profile have a valid API key?
- Does your provider account have available credits?
- Is the model still available/active?

**Solutions:**

- Create or select an image profile
- Verify API key in API Keys tab
- Check provider account status and credits
- Try a different model

### Images look low quality

**Causes:**

- Using lower-quality model
- Profile set to "standard" instead of "HD"
- Prompt wasn't detailed enough
- Provider limitations

**Solutions:**

- Try different profile with better model
- Enable HD quality
- Use more detailed image descriptions
- Try different provider

### The adapter seems to have made no difference

The most expensive failure a LoRA can suffer is the one that wears the costume of success: the order goes out, the picture comes back, the account is debited, and the result is precisely what the bare model would have painted anyway. No error is raised, because from the provider's side nothing whatever went wrong. Three causes account for very nearly all of it.

**The adapter and the model are not of the same lineage.** Weights are trained against one particular base and do not transfer to its cousins on the strength of a shared surname. An adapter raised on Flux 2 Klein, pointed at Flux 2 Dev, is not a fainter version of itself — it is simply not speaking. Consult the adapter's own page for the base it was trained on and set the profile's **Model** to that, rather than to its nearest-sounding neighbour. Quilltap will post faithfully whatever you configure; it has no means of knowing the parcel was addressed to a different house.

**The magic word was never said.** Most adapters answer to a trigger, and their page names it — sometimes as a single phrase, sometimes as a short list of words, in which case a phrase containing all of them will do. Write it into the row's **Trigger Phrase** and Quilltap weaves it into every prompt this profile paints. Leave it blank and the adapter may attend the sitting without ever once picking up the pen.

**Nobody asked for the thing the adapter was engaged to do.** This is the quiet one, and it catches the careful. An adapter hired to unlock candid depiction cannot exercise that talent upon a prompt that never requests it — and for story backgrounds the prompt crafter drapes the scene by default, however uncensored the destination. Fitting the adapter is therefore only half the arrangement. The other half is the Concierge's, and is set out under *Story Background Prompts* in [Dangerous Content Handling](dangerous-content.md).

### Generation is very slow

**Causes:**

- Model is processing-intensive
- Provider is overloaded
- Large image size requested
- Low internet connection

**Solutions:**

- Try faster model
- Use standard quality instead of HD
- Request smaller image size
- Try again during less busy times

### No images generated, error message

**Common errors:**

- "Image generation is not enabled for this chat" — no image profile resolves for this conversation's seats; set a default profile, or pick one for the chat (see *Selecting a Different Profile* above)
- "Invalid API key" — API key is wrong or expired
- "Insufficient credits" — Provider account is out of money
- "Model not found" — Model is no longer available
- "Rate limit exceeded" — Too many requests at once

The notice above the composer and the toast both carry the reason verbatim, so the sentence you see is the one the machinery actually gave — no need to go spelunking in the logs for it.

**Solutions:** Check error message and troubleshoot accordingly

## In-Chat Settings Access

Characters with help tools enabled can read your configured image profiles and story background settings during a conversation using the `help_settings` tool with `category: "images"`. This returns each profile's name, provider, model, and default status, plus your story backgrounds configuration --- but never your API keys. Ask a help-tools-enabled character something like "What image profiles do I have?" and it will oblige.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=images&section=image-profiles")`

## Related Settings

- [API Keys](api-keys-settings.md) — Store credentials for image providers
- [Dangerous Content Handling](dangerous-content.md) — Governs whether story-background prompts are drafted candidly
- **Chat Settings** — Configure image description provider (different from generation)
- **Connection Profiles** — For LLM that interprets image requests
- **Chat Memory** — Stores generated images in history
