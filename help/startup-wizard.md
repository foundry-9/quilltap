---
url: /setup
---

# Getting Started with Quilltap

> **[Open this page in Quilltap](/)**

Welcome to Quilltap! This guide walks you through everything you need to get started, from setting up your first AI connection to having your first conversation with a character.

## Before You Begin

### What You'll Set Up

When you first launch Quilltap, you'll be guided through a few quick setup steps:

1. **Encryption Setup** — Quilltap generates an encryption key to protect your data (automatic)
2. **Your Profile** — Tell Quilltap your name and pick an archetype so characters know who they're talking to
3. **Connection Profile** — How Quilltap talks to an AI service
4. **Embedding Profile** — How Quilltap searches your memories (optional but recommended)
5. **Cheap LLM** — A cost-saving option for background tasks (optional)
6. **Your First Chat** — Starting a conversation with a character

### First Run: Encryption, Profile, and Provider Setup

On your very first launch, Quilltap will walk you through three initial steps:

1. **Encryption Setup** (`/setup`) — An encryption key is generated automatically to protect your API keys and sensitive data. You can optionally protect it with a passphrase.

   Do copy the key down when it is shown to you; the establishment displays it precisely once and is far too discreet to repeat itself. The moment you submit the form, Quilltap re-forges every one of its ledgers in encrypted form — the main database, the conversation logs, and the document-store index alike — and reopens them before it tells you all is well. Should it ever fail to reopen the doors on the first attempt, it will say so plainly and ask you to stop and start Quilltap once. Your key is safe and your data untouched in that event; a restart is the whole of the remedy.

2. **Profile Setup** (`/setup/profile`) — You'll enter your name and choose an archetype that describes how you interact with your characters.

3. **AI Stack Setup Wizard** (`/setup/providers`) — A guided wizard walks you through selecting providers, entering API keys, choosing models, and configuring embeddings and images. See [AI Stack Setup Wizard](setup-wizard.md) for full details.

After completing the wizard, you can re-run it anytime from the **AI Providers** tab in Settings (`/settings?tab=providers`).

**Profile Setup** — You'll enter your name and choose an archetype:
   - **The Proprietor** — Direct and professional, focused on getting things done
   - **The Resident** — Curious and sociable, here to connect with characters
   - **The Author** — Imaginative and expressive, approaching characters as a storyteller

   This creates a user-controlled character that represents you in conversations. Characters will greet you by name and know a bit about your style. You can change your name, avatar, and details anytime from Aurora.

### Understanding the Basics

If you're new to AI chat applications, here are some terms you'll encounter:

**LLM (Large Language Model)**
The AI "brain" that powers conversations. Examples include GPT-4, Claude, Llama, and Mistral. Different models have different capabilities, speeds, and costs.

**API Key**
A secret password that lets Quilltap access an AI service on your behalf. You get this from the AI provider (like OpenAI or Anthropic). Keep it private — anyone with your key can use your account.

**Provider**
The company or service that runs the AI. Examples: OpenAI (makes GPT-4), Anthropic (makes Claude), or Ollama (runs AI locally on your computer).

**Tokens**
How AI services measure usage. Roughly, 1 token ≈ 4 characters of text. Most providers charge based on tokens used.

**Embeddings**
A way to convert text into numbers so the AI can search and compare meanings. Used for finding relevant memories during conversations.

---

## Step 1: Choose Your AI Provider

You have several options for connecting to AI services:

### Option A: Ollama (Free, Local, Private)

**Best for:** Privacy-focused users, those with capable computers, avoiding API costs

Ollama runs AI models directly on your computer. No internet required after setup, no per-message costs, and your data never leaves your machine.

**Requirements:**
- A reasonably powerful computer (8GB+ RAM recommended)
- Ollama installed on your system
- Storage space for AI models (2-8GB per model)

**Pros:**
- Completely free after setup
- Total privacy — data stays on your computer
- Works offline
- No usage limits

**Cons:**
- Requires technical setup
- Quality depends on your hardware
- Local models may be less capable than cloud options

**Get Ollama:** [https://ollama.com](https://ollama.com)

---

### Option B: OpenRouter (Recommended for Beginners)

**Best for:** Trying multiple AI models, flexibility, pay-as-you-go

OpenRouter is a service that gives you access to many different AI models through a single API key. It's like a gateway to GPT-4, Claude, Llama, Mistral, and many others.

**Pros:**
- One API key for many models
- Pay only for what you use
- Easy to switch between models
- Some free models available
- Good documentation

**Cons:**
- Requires payment for most models
- Data sent to cloud services

**Get an OpenRouter API Key:**

1. Go to [https://openrouter.ai](https://openrouter.ai)
2. Click **Sign Up** and create an account
3. After signing in, go to **Keys** in your dashboard
4. Click **Create Key**
5. Give your key a name (like "Quilltap")
6. Copy the key — it starts with `sk-or-`
7. **Important:** Save this key somewhere safe. You won't be able to see it again!

**Add credits:**
1. Go to **Credits** in your OpenRouter dashboard
2. Add funds (start with $5-10 to try things out)
3. Your balance is shown in the dashboard

---

### Option C: OpenAI (GPT-4, GPT-4o)

**Best for:** High-quality responses, established AI capabilities

OpenAI created ChatGPT and offers some of the most capable AI models available.

**Pros:**
- High-quality responses
- Well-tested, reliable
- Good at following instructions
- Supports images and other features

**Cons:**
- Can be expensive for heavy use
- No free tier for API usage

**Get an OpenAI API Key:**

1. Go to [https://platform.openai.com](https://platform.openai.com)
2. Sign up or log in
3. Go to **API Keys** in the left sidebar
4. Click **Create new secret key**
5. Give it a name (like "Quilltap")
6. Copy the key — it starts with `sk-`
7. **Important:** Save this key immediately. You can't see it again!

**Add credits:**
1. Go to **Billing** in your OpenAI dashboard
2. Add a payment method
3. Add credits to your account

---

### Option D: Anthropic (Claude)

**Best for:** Long conversations, nuanced responses, safety-focused AI

Anthropic makes Claude, known for thoughtful responses and handling long conversations well.

**Pros:**
- Excellent at roleplay and creative writing
- Handles very long conversations
- Good at following complex instructions
- Strong safety features

**Cons:**
- Can be expensive
- Sometimes overly cautious

**Get an Anthropic API Key:**

1. Go to [https://console.anthropic.com](https://console.anthropic.com)
2. Sign up or log in
3. Go to **API Keys**
4. Click **Create Key**
5. Give it a name (like "Quilltap")
6. Copy the key — it starts with `sk-ant-`
7. **Important:** Save this key immediately!

**Add credits:**
1. Go to **Plans & Billing** in your Anthropic console
2. Add a payment method
3. Purchase credits

---

### Option E: Other OpenAI-Compatible Providers

Many services offer APIs compatible with OpenAI's format. These include:

- **Together AI** — [https://together.ai](https://together.ai)
- **Groq** — [https://groq.com](https://groq.com) (very fast)
- **Fireworks AI** — [https://fireworks.ai](https://fireworks.ai)
- **Local servers** — LM Studio, text-generation-webui, etc.

These work with Quilltap's "OpenAI" provider setting — you just need to specify the custom base URL.

---

## Step 2: Add Your API Key to Quilltap

Now that you have an API key (or Ollama installed), let's add it to Quilltap.

### For Cloud Providers (OpenRouter, OpenAI, Anthropic, etc.)

1. **Open Settings**
   - Click **Settings** (gear icon) in the left sidebar
   - Or go to: **Settings** (`/settings?tab=providers`)

2. **Add a New API Key**
   - Click **Add API Key** or **+ New Key**
   - Select your **Provider** from the dropdown:
     - Choose **OpenRouter** for OpenRouter keys
     - Choose **OpenAI** for OpenAI keys (or OpenAI-compatible services)
     - Choose **Anthropic** for Anthropic/Claude keys
     - Choose **Google** for Google AI keys
   - Enter a **Label** (name) for this key, like "My OpenRouter Key"
   - Paste your **API Key** in the key field

3. **For Custom/Local Providers**
   - If using a local OpenAI-compatible server (like LM Studio):
     - Choose **OpenAI** as the provider
     - You'll set the custom URL later in the connection profile

4. **Save the Key**
   - Click **Save** or **Add Key**
   - Your key is now stored securely

5. **Test the Key (Optional)**
   - Click **Test** next to your saved key
   - If successful, you'll see a confirmation
   - If it fails, double-check that you copied the entire key

### For Ollama (Local)

Ollama doesn't require an API key, but you need Ollama running:

1. **Install Ollama** from [ollama.com](https://ollama.com)

2. **Download a Model**
   - Open a terminal/command prompt
   - Run: `ollama pull llama3.2` (or another model)
   - Wait for the download to complete

3. **Start Ollama**
   - Ollama usually runs automatically after installation
   - If not, run: `ollama serve`
   - It runs on `http://localhost:11434` by default
   - **Docker users:** No URL changes needed — add `11434` to `HOST_REDIRECT_PORTS` when running the container

4. **No API Key Needed**
   - Skip adding an API key
   - You'll connect directly to Ollama in the next step

> **Need more help?** See [API Keys Settings](api-keys-settings.md) for detailed information.

---

## Step 3: Create a Connection Profile

A connection profile tells Quilltap which AI to use and how to use it. This is where you choose your model and configure settings.

1. **Open Connection Profiles**
   - Go to: **Settings** (`/settings?tab=providers`)

2. **Create a New Profile**
   - Click **Add Profile** or **+ New Profile**

3. **Configure the Profile**

   **Profile Name:**
   - Give it a descriptive name like "GPT-4o" or "Claude Sonnet" or "Local Llama"
   - This name appears when selecting which AI to use

   **Provider:**
   - Select the provider that matches your API key:
     - **OpenRouter** — For OpenRouter keys
     - **OpenAI** — For OpenAI keys or OpenAI-compatible services
     - **Anthropic** — For Anthropic/Claude keys
     - **Ollama** — For local Ollama
     - **Google** — For Google AI keys

   **API Key:**
   - Select the API key you added in Step 2
   - For Ollama, this field may not appear or can be left empty

   **Model:**
   - Choose which specific AI model to use
   - The dropdown shows available models for your provider
   - **Recommendations:**
     - OpenRouter: `anthropic/claude-3.5-sonnet` or `openai/gpt-4o`
     - OpenAI: `gpt-4o` or `gpt-4o-mini` (cheaper)
     - Anthropic: `claude-3-5-sonnet-20241022` or `claude-3-5-haiku-20241022` (cheaper)
     - Ollama: `llama3.2` or `mistral`

   **Base URL (for custom servers):**
   - Usually leave this empty (uses default)
   - For local OpenAI-compatible servers, enter your server URL
   - Example: `http://localhost:1234/v1` for LM Studio

4. **Save and Test**
   - Click **Save** to create the profile
   - Click **Test Connection** to verify it works
   - You should see a success message

5. **Set as Default (Optional)**
   - If this is your main profile, click **Set as Default**
   - New characters will use this profile automatically

> **Need more help?** See [Connection Profiles](connection-profiles.md) for detailed configuration options.

---

## Step 4: Set Up Embedding (For Memory Search)

Embeddings help Quilltap find relevant memories during conversations. When a character needs to remember something, embeddings help find the right information.

### Option A: Use Built-in TF-IDF (Recommended for Most Users)

Quilltap includes a built-in embedding system that works without any external services. **This is set up automatically on first run.**

**Check if it's working:**

1. Go to: the **Commonplace Book** tab in Settings (`/settings?tab=memory`)
2. Look for a profile named "Built-in TF-IDF" or similar
3. It should show as the default (star icon)

**If no profile exists:**

1. Click **Add Profile** or **+ New Profile**
2. Select **BUILTIN** as the provider
3. Name it "Built-in TF-IDF"
4. Click **Save**
5. Click **Set as Default**

**Benefits of Built-in TF-IDF:**
- No API key required
- No additional cost
- Works offline
- Good enough for most use cases

---

### Option B: Use External Embedding Provider

For more sophisticated semantic search, you can use external embedding services. This is optional and adds cost.

**Using OpenAI Embeddings:**

1. Go to: the **Commonplace Book** tab in Settings (`/settings?tab=memory`)
2. Click **Add Profile**
3. Select **OpenAI** as the provider
4. Select your OpenAI API key
5. Choose a model (e.g., `text-embedding-3-small`)
6. Save and optionally set as default

**Using OpenRouter Embeddings:**

Not all OpenRouter models support embeddings. Check OpenRouter's documentation for embedding-capable models.

> **Need more help?** See [Embedding Profiles](embedding-profiles.md) for detailed options.

---

## Step 5: Set Up a Cheap LLM (For Background Tasks)

Quilltap performs some tasks in the background, like:
- Extracting memories from conversations
- Generating chat titles
- Describing images
- Creating summaries

These don't need your most powerful (expensive) model. Setting up a "cheap LLM" saves money by using a faster, less expensive model for these tasks.

### Skip This Step If:
- You're using Ollama (all local, no cost difference)
- You don't mind using your main model for everything
- You want the simplest setup

### To Set Up a Cheap LLM:

1. **Create a Second Connection Profile**
   - Go to: **Settings** (`/settings?tab=providers`)
   - Create a new profile with a cheaper model:
     - OpenAI: `gpt-4o-mini` is much cheaper than `gpt-4o`
     - Anthropic: `claude-3-5-haiku` is cheaper than `claude-3-5-sonnet`
     - OpenRouter: Look for models with lower per-token costs
   - Name it something like "Cheap - GPT-4o-mini"

2. **Configure Chat Settings**
   - Go to: the **Chat** tab in Settings (`/settings?tab=chat`)
   - Find the **Cheap LLM** section
   - Toggle **Enable Cheap LLM** on
   - Select your cheaper profile from the dropdown

3. **Done!**
   - Background tasks now use the cheaper model
   - Your main profile is reserved for actual conversations

> **Need more help?** See [Chat Settings](chat-settings.md) for more options.

---

## Step 6: Start Your First Chat

You're ready to chat! Quilltap comes with a starter character, or you can create your own.

### Chat with the Default Character

1. **Go to Characters**
   - Click **Characters** in the left sidebar
   - Or go to: [Characters](/aurora)

2. **Find a Character**
   - You should see at least one character (often named "Ben" or similar)
   - Click on the character to view their profile

3. **Start a Chat**
   - Click the **Chat** button on the character card
   - Or click **New Chat** from the character's profile page

4. **Send Your First Message**
   - Type a message in the input box at the bottom
   - Press **Enter** or click **Send**
   - Wait for the character to respond

5. **Continue the Conversation**
   - Keep chatting!
   - The character will maintain their personality throughout

### Create Your Own Character

1. Go to: [Characters](/aurora)
2. Click **Create Character** or **+ New Character**
3. Fill in at least:
   - **Name** — What to call the character
   - **Description** — Who they are and their personality
4. Click **Create**
5. Start chatting with your new character!

> **Need more help?** See [Creating Characters](character-creation.md) for a complete guide.

---

## Troubleshooting Common Issues

### "No connection profile configured"

**Problem:** Character doesn't have a way to talk to an AI.

**Solution:**
1. Create a connection profile (Step 3 above)
2. Set it as default, OR
3. Go to the character's settings and assign a profile

---

### "API key invalid" or "Authentication failed"

**Problem:** Your API key isn't working.

**Solutions:**
- Double-check you copied the entire key (no missing characters)
- Make sure you selected the correct provider
- Verify the key hasn't been revoked or expired
- Check that you have credits/balance with the provider
- For OpenAI-compatible servers, verify the base URL is correct

---

### "Rate limit exceeded"

**Problem:** You've made too many requests too quickly.

**Solutions:**
- Wait a few minutes and try again
- Check your provider's rate limits
- Consider upgrading your plan for higher limits

---

### "Insufficient credits" or "Payment required"

**Problem:** Your account needs more funds.

**Solution:**
- Add credits to your provider account
- Check your usage dashboard for spending

---

### Ollama not connecting

**Problem:** Quilltap can't reach your local Ollama.

**Solutions:**
- Make sure Ollama is running (`ollama serve`)
- Check Ollama is on the default port (11434)
- Try accessing `http://localhost:11434` in your browser
- Restart Ollama if needed

> **Docker users:** If you're running Quilltap in Docker and Ollama on your host machine, you don't need to change the URL. Add `11434` to the `HOST_REDIRECT_PORTS` environment variable when starting the container, and `http://localhost:11434` works transparently. See the **Deployment Guide** for details.

---

### Character responses are slow

**Possible causes:**
- Large AI models take longer to respond
- Your internet connection (for cloud providers)
- Your computer's speed (for Ollama)

**Solutions:**
- Try a smaller/faster model
- Check your internet connection
- For Ollama, try a smaller model like `llama3.2:3b`

---

### Memories not working

**Problem:** Character doesn't remember past conversations.

**Solutions:**
- Check that an embedding profile is configured and set as default
- Verify the cheap LLM is configured (for memory extraction)
- Wait a moment — memory extraction happens in the background
- Check the Tasks Queue in **Settings** (`/settings?tab=system`) for any errors

---

## Next Steps

Now that you're set up, explore more of Quilltap:

- **[Characters](characters.md)** — Create and customize AI personalities
- **[Chats Overview](chats.md)** — Learn about chat features
- **[Multi-Character Chats](chat-multi-character.md)** — Have group conversations
- **[Projects](projects.md)** — Organize your creative work
- **[Files](files.md)** — Add documents for AI reference
- **[Settings Overview](settings.md)** — Explore all configuration options

---

## Quick Reference: Settings Locations

| What You Need | Where to Find It |
|---------------|------------------|
| Add API Keys | **Settings** (`/settings?tab=providers`) |
| Create Connection Profiles | **Settings** (`/settings?tab=providers`) |
| Configure Embeddings | **Settings** (`/settings?tab=memory`) |
| Set Up Cheap LLM | **Settings** (`/settings?tab=chat`) |
| Manage Characters | [Characters](/aurora) |
| View Background Tasks | **Settings** (`/settings?tab=system`) |
| Customize Appearance | **Settings** (`/settings?tab=appearance`) |

---

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/setup")`

## Getting Help

If you run into issues:

1. Check the help documentation for the specific feature
2. Look at the **Settings** page (`/settings?tab=system`) for error messages in the Tasks Queue
3. Review your API provider's status page for outages
4. For Quilltap-specific issues, check the project's GitHub

Welcome to Quilltap — enjoy creating and chatting with your characters!
