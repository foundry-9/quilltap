---
url: /settings?tab=providers&section=connection-profiles
---

# Connection Profiles

> **[Open this page in Quilltap](/settings?tab=providers&section=connection-profiles)**

Connection Profiles are where you configure your AI language models (LLMs) for use in Quilltap chats. A connection profile links together an API key, a provider, and a specific model, allowing Quilltap to communicate with the AI service.

## Understanding Connection Profiles

A connection profile tells Quilltap:

- **Which provider** to connect to (OpenAI, Anthropic, etc.)
- **Which API key** to use for authentication
- **Which model** to use (GPT-4, Claude 3, etc.)
- **Any special settings** (temperature, max tokens, custom URLs)

You can create multiple profiles for different purposes, such as:

- A profile for fast, cheap responses
- A profile for high-quality, detailed responses
- A profile for specialized tasks (coding, creative writing)
- Different profiles for different API accounts

## Accessing Connection Profiles

1. Click **Settings** (gear icon) in the left sidebar
2. Click the **Connection Profiles** tab
3. You'll see existing profiles (if any) and options to create new ones

## Viewing Connection Profiles

The profiles list shows:

- **Profile Name** — The name you gave the profile
- **Provider** — Which AI service (OpenAI, Anthropic, etc.)
- **Model** — Which model is selected (GPT-4o, Claude 3.5 Sonnet, etc.)
- **Status** — Connection health (✓ Healthy, ⚠️ Degraded, ✗ Unhealthy)
- **Tags** — Custom tags for organization
- **Default Badge** — Marks if this is the default "cheap" profile
- **Actions** — Buttons to edit, test, or delete

## A Note on Names

Each profile must answer to a name all its own. Quilltap will not abide two profiles bearing the same name — and it is not fooled by a stray capital letter or a hopeful trailing space, for "Claude Fast" and "  claude fast  " are, to its eye, one and the same fellow. Should you attempt to christen a new profile with a name already spoken for, you will be turned away at the door until you choose another.

This insistence is no mere fastidiousness. When you assign a model to a character at the table in the Salon, the dropdown now lists your profiles **by name** — with the underlying model whispered alongside, thus: *Opus 4.7 Adaptive — claude-opus-4-8*. This is precisely so that two profiles sharing a provider and a model, yet differing in their settings, may be told apart at a glance. A name worth its salt must therefore be unique, lest the distinction collapse into confusion.

Should an import or a restoration arrive bearing a name already taken, Quilltap will quietly append a numeral — *Claude Fast (2)* — rather than turn the guest away.

## Creating a New Connection Profile

### Step 1: Prepare Your API Key

Before creating a connection profile, you need an API key:

1. Go to the **AI Providers** tab in Settings (`/settings?tab=providers&section=api-keys`) and expand **API Keys**
2. Add your API key from the provider
3. Test the key to verify it works
4. Return to Connection Profiles tab

### Step 2: Create the Profile

1. Click **Add Connection Profile**
2. A form appears with these fields:

   **Basic Information:**
   - **Profile Name** — Give this configuration a name (e.g., "GPT-4 Production", "Claude Fast"). It must be unique — see [A Note on Names](#a-note-on-names) above. (Leave it blank and Quilltap will suggest one for you, suffixing a numeral should the obvious choice already be taken.)
   - **Provider** — Select the AI provider (OpenAI, Anthropic, Google, etc.)

   **Connection Settings:**
   - **API Key** — Select from your stored API keys
   - **Model** — Select which model to use
   - **Base URL** — (Optional) For self-hosted or custom endpoints

   **Advanced Settings:**
   - **Temperature** — Control randomness (0 = deterministic, 1 = very creative)
   - **Max Tokens** — Maximum response length
   - **Top P** — Nucleus sampling (alternative to temperature)
   - **Provider-specific options** — May vary by provider

3. Click **Save** to create the profile

### Step 3: Test the Connection

Before using in chats, verify it works:

1. Find your new profile in the list
2. Click **Test Connection** button
3. Quilltap sends a test message to verify:
   - ✓ API key is valid
   - ✓ Model is accessible
   - ✓ Connection works end-to-end
4. You'll see the test result

## Editing a Connection Profile

To change an existing profile:

1. Find the profile in the list
2. Click **Edit** button (pencil icon)
3. Update any of these settings:
   - Profile name
   - API key (switch to a different one)
   - Model (select a different model)
   - Advanced settings (temperature, tokens, etc.)
   - Tags for organization
4. Click **Save Changes**

## Deleting a Connection Profile

To remove a profile:

1. Find the profile in the list
2. Click **Delete** button (trash icon)
3. A confirmation dialog appears (showing if it's in use)
4. Click **Confirm Delete** to remove it

**Warning:** If the profile is used in active chats, those chats will need a new profile assigned.

## Using Connection Profiles in Chats

### Setting a Default Profile

Your default profile is used automatically when you create new chats:

1. When creating a new chat, the default profile is pre-selected
2. You can change it for any chat individually
3. To change the system default:
   - Look for a profile marked with a "Default" badge
   - Click **Set as Default** to change which profile is default
   - Usually the cheapest/fastest profile is set as default

### Choosing a Profile for a Chat

1. When creating a new chat
2. Look for the **Connection Profile** dropdown
3. Select which profile to use for that chat
4. The selected profile is used for all messages in that chat

### Switching Profiles Mid-Chat

To change profiles in an existing chat:

1. Open the chat
2. Look for chat settings (usually in the top right)
3. Find the Connection Profile selector
4. Choose a different profile
5. This affects future messages but not previous ones

## Testing Profiles

### Test Connection

Tests that the basic connection works:

1. Click **Test Connection**
2. Quilltap verifies:
   - API key is valid
   - Model exists and is accessible
   - Provider responds
3. See if connection is healthy

**When to use:** After creating a new profile or changing settings

### Test Message

Sends a real test message to verify end-to-end functionality:

1. Click **Send Test Message**
2. Quilltap sends: "Respond with 'Profile test successful'" to verify
3. If the response comes back, the profile is fully functional

**When to use:** For thorough validation before using in important chats

## Fetch Available Models

If your provider has many models, you can see all available ones:

1. Select the provider from the dropdown
2. Enter your API key
3. Click **Fetch Models**
4. A list of models appears for that provider
5. Select which one to use

**Note:** This requires a valid API key for the provider.

## Advanced: Custom Base URLs

For self-hosted or alternative LLM providers (like local Ollama instances):

1. Select "Custom" or the relevant provider
2. Enter the **Base URL** where your LLM server is running
3. Example: `http://localhost:11434/api` for local Ollama
4. Complete other settings as needed
5. Test to verify connection works

> **Docker users:** If you're running Quilltap in Docker and local services (like Ollama) on your host machine, you don't need to change any URLs. Add the port to the `HOST_REDIRECT_PORTS` environment variable when starting the container (e.g., `HOST_REDIRECT_PORTS="11434"`), and `http://localhost:11434` works transparently inside the container.

## Provider-Specific Notes

### OpenAI (GPT-4, GPT-3.5, etc.)

- Models update frequently — use "Fetch Models" to see current options
- Temperature: 0-2 (default 1)
- Supports vision (image) context
- Token limits vary by model
- **Verbosity** *(GPT-5 and newer)* — sets how concise or expansive the answer is, on a Low / Medium / High scale. Leaving it at *(model default)* omits the parameter entirely; older models that don't recognise it are unaffected either way.
- **Reasoning Effort** *(o-series and GPT-5 reasoning models)* — picks how much hidden thinking the model does before it speaks: Minimal, Low, Medium, or High. Non-reasoning models ignore the setting. Background tasks like summarisation are pinned to *Low* regardless of this choice, so a profile set to *High* still won't burn its whole token budget on chores.

### Anthropic (Claude)

- Multiple Claude versions available (3, 3.5, etc.)
- Excellent long-context support
- Temperature: 0-1
- Strong at reasoning and complex tasks
- **Enable Prompt Caching** — invites Anthropic to mark the steady portions of your prompt as a cache breakpoint. On the next call within the cache's lifetime, those portions are charged at a steep discount instead of full freight. Worth the indulgence on long-running chats where the system prompt and tools repeat verbatim turn after turn.
- **Cache Strategy** *(visible only when Prompt Caching is enabled)* — *System message only* caches just the persona/tools header; *System + tools + conversation* (recommended) extends the breakpoint deeper into the conversation so the savings compound across turns.
- **Cache Duration** *(visible only when Prompt Caching is enabled)* — five minutes is the default and the cheapest to write; one hour costs more upfront but pays off when a chat sprawls past the five-minute window. Pick the longer setting for slow-and-deliberate writing sessions; leave it at five minutes for everyday chatting.

### DeepSeek

- DeepSeek's V4 family with native function calling and a 1M-token context window
- Temperature: 0-2 (default 1)
- **Thinking Mode** — toggles DeepSeek's extended reasoning. *Enabled* lets the model deliberate before answering, at the cost of latency; *Disabled* forces a direct reply. While thinking is enabled DeepSeek ignores `temperature`, `top_p`, and the frequency/presence penalties, so Quilltap quietly omits them from the wire to keep the logs tidy.
- **Reasoning Effort** — DeepSeek's reasoning scale, *High* or *Max*. Only effective with thinking enabled; the lower OpenAI-style values (minimal / low / medium) fold up to *High* on DeepSeek's side.

### Z.AI (GLM)

- The GLM family — `glm-4.6`, the `glm-4.5` series, the vision-capable `glm-4.6v`/`glm-4.5v` models, and the newer `glm-5.x` line — with native function calling, web search, and CogView image generation
- **Thinking Mode** — the GLM hybrid-reasoning models deliberate by default, so their chain-of-thought streams into the Salon's thinking fold (display only — it is never fed back to any model) with no prompting at all. Set this to *Disabled* should you want a plain reply and no fold; *Enabled* keeps the working on; and *(model default)* defers to Z.AI, which at present means enabled. With thinking off, the fold simply never appears, however hard the model may be working behind the curtain.
- **Reasoning Effort** *(glm-5.2 only)* — a dial for how hard glm-5.2 cogitates before it speaks, effective only while thinking is lit; older and lesser GLMs pay it no heed. *Minimal* all but silences the rumination; *High* and *Max* open the throttle — and mind that Z.AI's own scale is coarse, folding low/medium up to *High* and xhigh up to *Max*. Here is the kindness of it: glm-5.2 thinks by default, and left to its own devices the engine would labour at the API's spendthrift *Max*. So unless you set *Disabled* thinking or pick a level yourself, Quilltap quietly sends *High* on glm-5.2 — curbing runaway thinking-token spend without a word of fuss. (Effort is no hard cap on output: the rumination still counts against your token ceiling, and striking it yields a *length* finish. Pair a modest effort with a sensible token limit for the surest economy.)

### Google (Gemini)

- Multiple model sizes (Flash, Pro)
- Good for vision tasks
- Competitive pricing
- Supports real-time APIs

### OpenRouter

- Single account, hundreds of models — useful as a backstop when first-party access lapses
- **Enable Zero Data Retention (ZDR)** — instructs OpenRouter to route only through providers that promise not to store or log your prompts. Worth ticking for sensitive writing.
- **Use Custom Model ID** — when ticked, the *Model* field becomes a free-text input so you can supply an obscure model identifier that hasn't yet appeared in OpenRouter's fetched list. Untick it to return to the model selector.
- **Fallback Models** — pick up to two models OpenRouter will fall back to if the primary fails (rate-limited, down for maintenance, etc.). Available only after *Fetch Models* has populated the list.

### Local Providers (Ollama)

- Run models locally on your computer
- No API costs
- Set Base URL to your local server
- Good for privacy-sensitive work

### Groq

- Very fast inference
- Great for chat over slow connections
- Good cost/performance ratio
- Limited to their model selection

## Managing Multiple Profiles

### Use Cases

**Fast/Cheap Profile:**

- Use for basic tasks, brainstorming, drafts
- Set as default for everyday use
- Use cheaper, faster models

**Quality Profile:**

- Use for important work, analysis, complex reasoning
- More expensive, slower models
- Better for nuanced tasks

**Specialized Profile:**

- Code generation with specialized code models
- Creative writing with models tuned for prose
- Domain-specific models for technical work

### Organizing with Tags

Add tags to profiles for easy filtering:

1. Edit a profile
2. Add tags like: "production", "testing", "fast", "expensive"
3. Tags help you remember each profile's purpose

## Allow Tool Use

The **Allow tool use** checkbox on each connection profile acts as a master switch for all LLM tools. When unchecked, no tools whatsoever — built-in or plugin-provided — will be dispatched to the model when using that profile, regardless of what the per-chat or per-project tool settings say.

This is rather like flipping the main breaker in a fine manor house: it matters not how many individual lamps the servants have switched on if the master circuit has been thrown.

**When you might disable tool use:**

- **Model compatibility:** Some models, particularly smaller or local models, do not handle tool calls gracefully — they may hallucinate tool invocations or produce garbled output
- **Cost control:** Tool descriptions consume tokens; disabling them reduces prompt size
- **Simplicity:** When you simply want pure conversation without the AI reaching for instruments

**How it works:**

1. Edit (or create) a connection profile in The Forge
2. Uncheck **Allow tool use**
3. Save the profile

Profiles with tool use disabled display a **No Tools** badge on their profile card. When you open the Tool Settings dialog in a chat using such a profile, a notice appears explaining that tools are overridden at the profile level.

To re-enable tools, simply check the box again. Per-chat and per-project tool settings will resume their normal effect immediately.

## Tool Format

When tool use is allowed, the **Tool format** selector beneath the checkbox decides *how* a tool call travels between Quilltap and your model. Different models, you see, have been raised in different households and each has its own customs for the dinner table.

There are four settings:

- **Auto** (recommended) — Quilltap glances at the model's pedigree and selects accordingly: native function-calling for the well-bred services (OpenAI, recent Anthropic and Gemini), and the Simple JSON dialect for the more rustic establishments.
- **Native function calling** — force the provider's own structured tool protocol. Excellent when supported; rather a disaster when not, in which case Quilltap politely falls back to Simple JSON anyway.
- **Simple JSON** — emit tool calls inside a `<tool_call>{…}</tool_call>` block, paired with a provider-level stop sequence that hard-cuts the model after the closing tag. This is the modern pseudo-tool surface and the post-flip default for non-native models.
- **Text-block (legacy)** — the older `[[TOOL ...]]content[[/TOOL]]` dialect. Kept for compatibility while the household migrates; you should rarely need to choose it on purpose.

The Simple JSON surface was designed for smaller and local models that lack native function calling but still need to use Quilltap's tools (search, image generation, the wardrobe, and so on). Pairing the familiar JSON shape with a hard stop sequence prevents the most embarrassing failure mode of pseudo-tooling — the model emitting a perfectly valid tool call and then continuing on to invent the result it imagines the tool would have produced.

When in doubt, leave the setting on **Auto**. The keeper of the keys can always rearrange the silverware later.

## Supports Image Attachments

The **Supports image attachments (vision input)** checkbox tells Quilltap that this particular profile's model can read images — photographs, screenshots, diagrams, character portraits, and so forth. Some models see; most do not; a single provider will happily serve both sorts on the same API, so the distinction must be made at the profile level rather than by guessing from the provider's name on the door.

**When to tick the box:**

- You're configuring a known vision model — GPT‑4o, Claude Sonnet or Opus, Gemini 1.5+, Grok 2 Vision, and their descendants.
- You've pointed an **OpenRouter** profile at a vision‑capable model ID (`openai/gpt-4o`, `anthropic/claude-sonnet-4-5`, and so on).
- You're running a local vision model through **Ollama** (LLaVA, MiniCPM‑V, Llama 3.2 Vision) or an **OpenAI Compatible** endpoint whose backing model handles images.

**When to leave it unticked:**

- The model is purely textual (GPT‑3.5, Claude Instant, most 7B local models).
- You're unsure. When unticked, Quilltap routes any image the user attaches through your configured *Image Description Profile* (set in Chat settings), which produces a written description using whichever other profile *is* ticked. The conversation continues as if the image had been typed out in words — imperfect, but serviceable, and it never sends image bytes to a model that will baulk.

**What happens under the hood:** every bit of Quilltap that asks "can this profile see pictures?" — the Salon's attachment handler, the wardrobe image analyzer, the Aurora wizard's *Describe from image* step, the *Image Description Profile* dropdown in Chat settings — consults this checkbox. Existing installs were seeded automatically: profiles on OpenAI, Anthropic, Google, and Grok had the box pre‑ticked to match their prior behaviour; everything else starts unticked, so users who want vision on OpenRouter or Ollama must opt in explicitly.

## Connection Profile Limitations

### What affects availability

- **Missing API Key:** If the key is deleted, profile can't be used
- **Account quota exceeded:** If your provider account is out of credits, connections fail
- **Rate limits:** Some providers throttle rapid requests
- **Model discontinued:** If your provider retires a model, update your profile
- **Network issues:** Requires internet to reach provider

### Attachment Support

Different providers handle attachments differently, and — more importantly — so do different *models* within a single provider. A single OpenRouter account can point at GPT‑4o (which cheerfully eats images) or at a purely textual model (which will politely decline). Quilltap therefore treats **image upload** as a per‑profile toggle rather than a per‑provider assumption.

**Image attachments** — every profile now carries a *Supports image attachments (vision input)* checkbox. Tick it on any profile whose model can accept images, whether that's a first‑party OpenAI/Anthropic/Google/Grok profile or an OpenRouter/Ollama/OpenAI‑compatible profile pointed at a vision‑capable model (LLaVA on Ollama, GPT‑4o through OpenRouter, and so forth). When the box is ticked, chat messages with image attachments are sent straight to the model; when it is not, the Salon falls back to the configured *Image Description Profile* in Chat settings, which generates a text description using whichever other profile *does* have the box ticked.

**Documents and text files** — PDF and plaintext support still follows provider capabilities, as those vary little from model to model:

- **Anthropic:** PDFs and plain text supported natively.
- **OpenAI, Google, Grok:** no native document support; text files are inlined into the message for profiles that don't accept them natively.
- **Ollama, OpenRouter, OpenAI Compatible:** no native document support.

Check your provider's documentation for the exact list of supported file types and size limits on the model you've chosen.

## Troubleshooting Connection Profiles

### Test failed: Invalid API key

**Solution:**

- Check API Keys tab — make sure you created the key
- Verify the key is still valid with your provider
- Delete and re-add the key from the provider's website

### Test failed: Model not found

**Solution:**

- Use "Fetch Models" to get current available models
- Your provider may have deprecated the model
- Select a different model that's currently available

### Connection works but chats are slow

**Causes:**

- Model is slow for your use case
- Provider is experiencing issues
- Network connection is slow

**Solutions:**

- Try a faster model
- Use a different provider
- Use a "cheap" profile for fast responses

### Can't create new profiles (greyed out button)

**Reason:** No API keys available

**Solution:**

- Go to API Keys tab
- Add at least one API key
- Return to Connection Profiles

## In-Chat Settings Access

Characters with help tools enabled can read your configured connection profiles during a conversation using the `help_settings` tool with `category: "connections"`. This returns each profile's name, provider, model, and configuration --- but never your API keys or credentials. Ask a help-tools-enabled character something like "What connection profiles do I have?" and it will produce the list.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=providers&section=connection-profiles")`

## Related Settings

- [API Keys](api-keys-settings.md) — Store credentials for connection profiles
- [Chat Settings](chat-settings.md) — Configure which profile is used by default
- **Image Profiles** — Separate configuration for image generation
- **Embedding Profiles** — Separate configuration for semantic search
