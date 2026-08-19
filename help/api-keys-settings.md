---
url: /settings?tab=providers&section=api-keys
---

# API Keys Settings

> **[Open this page in Quilltap](/settings?tab=providers&section=api-keys)**

The API Keys tab is where you securely store and manage authentication credentials for AI services. API keys are required to use most LLM providers and other services in Quilltap.

## What Are API Keys?

An API key is a unique credential that authorizes Quilltap to access your account with an AI provider. It's like a password, but specifically for accessing that service's API.

**Important:** Keep your API keys private. Never share them with others or paste them in public places.

## Accessing API Keys Settings

1. Click **Settings** (gear icon) in the left sidebar
2. Click the **API Keys** tab
3. You'll see a list of stored API keys and buttons to add new ones

## Viewing Your API Keys

The API Keys list shows:

- **Provider** — Which service the key is for (OpenAI, Anthropic, Google, OpenAI-Compatible, etc.)
- **Label** — A name you gave the key to identify it (e.g., "My OpenAI Account", "Work Account")
- **Status** — Whether the key is currently active
- **Key Preview** — The first and last few characters of the key (for verification)
- **Last Used** — When the key was last used with a connection
- **Actions** — Buttons to test, edit, or delete the key

## Creating a New API Key

### Step 1: Add the Key to Quilltap

1. Click the **Add API Key** button
2. A form appears with the following fields:

   - **Provider** — Select the AI service (OpenAI, Anthropic, Google, Grok, DeepSeek, Z.AI, OpenRouter, OpenAI-Compatible, etc.). Only providers that can actually carry a key are offered; Ollama, which asks for none, is not among them
   - **Label** — Give this key a memorable name (e.g., "Production Account", "Testing Key")
   - **API Key** — Paste your actual API key from the provider's website

3. Click **Save**

### Step 2: Obtain an API Key from the Provider

Before you can add a key to Quilltap, you need to get one from the provider:

**For OpenAI:**

1. Go to platform.openai.com
2. Log in to your account
3. Go to API keys section
4. Click "Create new secret key"
5. Copy the key (you can only see it once)
6. Paste it into Quilltap

**For Anthropic:**

1. Go to console.anthropic.com
2. Log in to your account
3. Navigate to API keys
4. Create a new key
5. Copy and paste into Quilltap

**For Google (Gemini):**

1. Go to aistudio.google.com
2. Click "Get API Key"
3. Create a new API key
4. Copy and paste into Quilltap

**For other providers:** Follow their documentation to obtain an API key, then add it to Quilltap using the steps above.

## Editing an API Key

To modify an existing key:

1. Find the key in the list
2. Click the **Edit** button (pencil icon)
3. A modal appears where you can:
   - Change the **Label** (the name you call it)
   - Update the **API Key** (if you've regenerated it with the provider)
4. Click **Save Changes**

## Deleting an API Key

To remove a key you no longer need:

1. Find the key in the list
2. Click the **Delete** button (trash icon)
3. A confirmation dialog appears
4. Click **Confirm Delete** to remove it

**Warning:** Deleting a key also disconnects any Connection Profiles that were using it. You'll need to update those profiles with a different key.

## Testing an API Key

Before using a key in a connection profile, you can verify it works:

1. Find the key in the list
2. Click **Test Key**
3. Quilltap sends a verification request to the provider
4. You'll see the result:
   - ✓ **Valid** — The key works and can be used
   - ✗ **Invalid** — The key is incorrect, expired, or has no credits
   - ⚠️ **Error** — There was a problem testing the key

### Why test a key?

- **Verify credentials** — Make sure you entered it correctly
- **Check account status** — Ensure your account has active credits
- **Troubleshoot** — If a key isn't working, testing reveals the issue
- **Before using** — Test new keys before adding them to connection profiles

## Exporting API Keys

You can export all your API keys for backup purposes:

1. Click **Export Keys** button
2. Your keys are downloaded as a JSON file
3. Store this file securely (it contains sensitive credentials)

**Security tip:** Keep exported keys in a secure location. Treat them like passwords.

## Importing API Keys

To restore previously exported keys:

1. Click **Import Keys** button
2. A dialog asks you to select a JSON file you exported earlier
3. Choose the file from your computer
4. The keys are imported back into Quilltap
5. You'll see a list of imported keys and can choose which ones to add

**Note:** Import won't overwrite existing keys — you can choose which to add.

## Supported Providers

Quilltap supports API keys from:

- **OpenAI** — GPT-4, GPT-3.5, and other models
- **Anthropic** — Claude models
- **Google** — Gemini models
- **Grok** — Xai's Grok model
- **DeepSeek** — DeepSeek models
- **Z.AI** — GLM models
- **OpenRouter** — Multi-model routing service
- **OpenAI-Compatible** — any service speaking the OpenAI dialect: Together, Fireworks, Groq, DeepInfra, a hosted vLLM, a corporate gateway
- **Other providers** — Custom or provider-specific keys

Two provider kinds are absent from that list on purpose. **Ollama** wants no key
whatever — it is your own machine, and it does not ask you for credentials to
speak to yourself — so it is not offered here and its connection profiles show
no key field at all.

**OpenAI-Compatible** is the peculiar case, and as of 4.9 it is handled
properly. The same provider serves the unbolted `llama-server` on your desk and
a hosted endpoint that will not exchange a syllable without a bearer token, so
a key is neither demanded nor forbidden: create one here if your endpoint wants
one, and the *API Key* field on the profile — unstarred, since it is optional —
will offer it. Before 4.9 the provider was missing from this list entirely and
the field never appeared, which made a hosted OpenAI-compatible service simply
unusable, 401 after 401, with nothing on the page to explain the omission.

You can also set custom base URLs for self-hosted LLM providers.

## Using API Keys

Once you've added an API key, you use it by:

1. Creating a **Connection Profile** (Settings → Connection Profiles tab)
2. Selecting the provider
3. Choosing the API key you want to use
4. Selecting a model and any provider-specific options
5. Testing the connection
6. Using that profile in chats

API keys are never sent out of Quilltap unless they're used to make a request to the provider's service.

## Managing Multiple Keys

You can store multiple keys from the same provider. This is useful for:

- **Multiple accounts** — Different accounts with different quotas
- **API key rotation** — Keeping an old key while testing a new one
- **Shared access** — Different keys for different projects
- **Testing** — Keeping a test key separate from production

## Security Best Practices

- **Never commit keys to git** — Keep keys out of version control
- **Don't paste in chat** — Avoid sharing keys in Quilltap conversations
- **Rotate periodically** — Generate new keys and delete old ones
- **Use labels** — Clear labels help you identify keys by purpose
- **Test immediately** — Verify new keys work right after adding them
- **Keep backups secure** — If you export keys, store the file safely
- **Review regularly** — Check your API keys list for unused or old keys

## Troubleshooting API Keys

### Key validation failed

**Problem:** Testing shows "Invalid" or error message

**Solutions:**

- Double-check you copied the entire key correctly
- Verify the key hasn't expired (check with your provider)
- Confirm your account has available credits
- Make sure you selected the right provider

### Can't find my API key

**Where to look:**

- OpenAI: platform.openai.com/api-keys
- Anthropic: console.anthropic.com/account/keys
- Google: aistudio.google.com/app/apikey
- Other providers: Check their documentation

### Connection profile not working after key update

**Solution:**

- Update the connection profile to use the new API key
- Test the connection profile after making the change

### Multiple keys from same provider

**Which one is used?**

- The Connection Profile you create chooses which key to use
- You can have different profiles use different keys
- No key is selected by default — you choose per profile

## In-Chat Settings Access

Characters with help tools enabled can read your configured connection, embedding, and image profiles during a conversation using the `help_settings` tool (with categories `"connections"`, `"embeddings"`, or `"images"` respectively). These reports show which profiles exist and which providers and models they use --- but API keys and credentials are never disclosed, not even partially. Ask a help-tools-enabled character something like "What providers do I have set up?" and it will produce a summary.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=providers&section=api-keys")`

## Related Settings

- [Connection Profiles](connection-profiles.md) — Use API keys to create LLM connections
- [Chat Settings](chat-settings.md) — Configure which connection profile is used by default
- **Image Profiles** — Some image providers also require API keys
- **Embedding Profiles** — Cloud-based embeddings need API keys
