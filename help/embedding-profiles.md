---
url: /settings?tab=memory&section=embedding-profiles
---

# Embedding Provider Profiles

> **[Open this page in Quilltap](/settings?tab=memory&section=embedding-profiles)**

Embedding Provider Profiles configure services that transform text into numerical representations (embeddings) for semantic search. Embeddings enable Quilltap to intelligently search through memories and find relevant context based on meaning, not just keywords.

## Understanding Embeddings

Embeddings are a way to represent text numerically so that similar concepts have similar numbers. This enables:

- **Semantic search** — Find memories by meaning, not keywords
- **Memory retrieval** — Automatically find relevant past conversations
- **Context enhancement** — Provide relevant information to the AI
- **Similarity matching** — Find similar characters, chats, or memories

For example, a search for "cat" would find memories mentioning "feline" because embeddings understand that these are related.

## Accessing Embedding Profiles

1. Click **Settings** (gear icon) in the left sidebar
2. Click the **Embedding Profiles** tab
3. You'll see any existing profiles and options to create new ones

## Viewing Embedding Profiles

The profiles list shows:

- **Profile Name** — Name you gave the profile
- **Provider** — Which embedding service (OpenAI, Ollama, etc.)
- **Status** — Whether configuration is complete
- **Vocabulary Stats** — How many embeddings are stored
- **Actions** — Buttons to edit or delete the profile

## Creating a New Embedding Profile

### Step 1: Choose an Embedding Provider

**Cloud Providers:**

**OpenAI Text-Embedding:**

- Model: text-embedding-3-small or text-embedding-3-large
- Requires OpenAI API key
- Cloud-hosted (requires internet)
- High quality embeddings

**Other cloud providers:**

- Cohere Embeddings
- Google Embeddings
- Other third-party embedding services

**Local Providers:**

**Ollama (Local):**

- Run embeddings locally
- No API costs
- No internet required
- Good for privacy
- Requires Ollama installation

### Step 2: Get Required Credentials

**For Cloud Providers (OpenAI):**

1. Go to platform.openai.com
2. Create or use existing API key
3. Note: Text embeddings have separate pricing from LLM usage
4. Return to Quilltap

**For Local Providers (Ollama):**

1. Install Ollama from ollama.ai
2. Start Ollama: `ollama serve`
3. Pull an embedding model: `ollama pull nomic-embed-text`
4. Note your Ollama URL (usually <http://localhost:11434>)

### Step 3: Add API Key to Quilltap (if needed)

For cloud providers only:

1. Go to the **AI Providers** tab in Settings (`/settings?tab=providers&section=api-keys`) and expand **API Keys**
2. Click **Add API Key**
3. Select "OpenAI" (or relevant provider)
4. Enter your API key
5. Test to verify it works
6. Return to Embedding Profiles tab

### Step 4: Create the Profile

1. In Settings → **Embedding Profiles** tab
2. Click **Add Embedding Profile**
3. A form appears with these fields:

   **Basic Information:**
   - **Profile Name** — Name this configuration (e.g., "OpenAI Embeddings", "Local Ollama")
   - **Provider** — Select embedding provider

   **Connection Settings (varies by provider):**

   *For OpenAI:*
   - **API Key** — Choose from your stored API keys
   - **Model** — Select embedding model version

   *For Ollama:*
   - **Base URL** — URL where Ollama is running (e.g., <http://localhost:11434>)
   - **Model** — Select which embedding model (must be installed)

4. Click **Save** to create the profile

## Editing an Embedding Profile

To modify an existing profile:

1. Find the profile in the list
2. Click **Edit** button (pencil icon)
3. Update settings:
   - Profile name
   - API key (cloud providers)
   - Base URL (local providers)
   - Model selection
   - **Dimensions** — what to ask the provider for. Honoured by OpenAI's `text-embedding-3-*`; ignored by Ollama (which always returns the model's native length).
   - **Truncate output to (Matryoshka)** — a clever bit of mathematics, explained below.
   - **Normalise to unit length** — keep this on unless you have a specific reason to disable it.
4. Click **Save Changes**

## Matryoshka Truncation & Unit Normalisation

Some embedding models — Qwen3-Embedding most notably — are trained as a *Matryoshka representation*: the first N components of their full vector are themselves a perfectly valid embedding at dimension N. Take a 4096-dimension Qwen3 vector, keep only the first 1024 numbers, renormalise it, and you have a 1024-dimension embedding with very nearly the same retrieval quality as the full thing. A quarter of the storage. A quarter of the cosine work at search time.

To take advantage of this, set **Truncate output to** in the embedding profile to your target dimension (1024 is a reasonable starting point for Qwen3). Whenever Quilltap embeds a piece of text — a memory, a document chunk, a conversation excerpt — the raw vector returned by the provider is sliced to that length and renormalised before it goes to disk. **Both** the corpus and any future search query go through the same slicing, so they line up perfectly.

A few notes on when this applies and when it doesn't:

- **Only enable for Matryoshka-trained models.** For models without that property (most notably the smaller OpenAI embeddings), slicing destroys information and search quality plummets. If you don't know whether your model is Matryoshka-trained, leave the field empty.
- **Smaller is faster, with diminishing quality returns.** 1024 is virtually indistinguishable from 4096 on most corpora; 512 still works well; 256 begins to lose nuance. Test with your own data before going aggressive.
- **Truncation does not change what the model is asked for.** If your provider honours a `dimensions` parameter (OpenAI does), set both — `dimensions` instructs the provider, `truncateToDimensions` is the local fallback if the provider returns more than you asked for.
- **L2 normalisation defaults on.** Quilltap's cosine search assumes stored vectors are unit-length so it can skip the magnitude calculation. Disable normalisation only if you have a specific reason to want raw magnitudes.

### Re-applying a Profile to the Existing Corpus

Changing **Truncate output to** affects only *new* embeddings — your existing memories, document chunks, and conversation snippets remain at whatever length they were stored at. To bring the existing corpus into compliance:

1. Make sure you've saved the new truncation value on the profile.
2. From the profile list, click **Re-apply (Matryoshka)** on the default profile.
3. Click again to confirm.

Quilltap will queue a background job that:

- Takes a `VACUUM INTO` backup of every affected database — `quilltap.bak-pre-truncation-<date>.db` next to the main database, and the same suffix on the mount-index database if document stores are involved. These are your rollback if anything goes sideways.
- Walks every embedding-bearing table (`memories`, `vector_entries`, `conversation_chunks`, `help_docs`, and `doc_mount_chunks`).
- For each stored vector longer than the target, slices the first N components, renormalises, and writes the result back inside a single transaction per table.
- VACUUMs the source databases to reclaim freed space.

The whole pass is a pure-local mathematical operation — no provider calls, no embedding charges, no downloads. On a typical corpus of a few thousand chunks it completes in seconds.

The runner refuses to operate on vectors *shorter* than the target dimension (those would need to grow, which requires a real re-embedding). If you've gone the other way — increased the truncation target, or switched to a different model entirely — use **Re-embed Everything** instead, which calls the provider afresh for each piece of text.

### Cleaning Up Mismatched Vectors Without a Full Reindex

When you swap embedding models, the corpus often ends up with a few stragglers that didn't come from your current default — a handful of OpenAI text-embedding-3-small vectors lingering in a Qwen3 corpus, say. Slicing those Matryoshka-style is mathematically valid but semantically wrong: a 1024-d slice of OpenAI text-3-small lives in a different vector space than a 1024-d Qwen3 vector, and cross-space cosine similarity is meaningless. They need *re-embedding*, not slicing.

For exactly this case the profile list offers a **Re-embed Mismatched** button on default non-built-in profiles. It enqueues an `EMBEDDING_GENERATE` job for every memory, conversation chunk, and help doc whose stored vector dimension differs from the active profile's target (its `truncateToDimensions` if set, otherwise its `dimensions`). Rows that already match are left alone — no provider call, no charge.

Two clicks; the second confirms. Unlike **Re-embed Everything**, this mode does not delete vector stores, cancel in-flight jobs, or wipe help-doc embeddings — it touches only the orphans. Track progress via the **Emb** badge in the header.

## One Standard, Kept Automatically

There is precisely one embedding standard per Quilltap instance: whatever the default profile produces. Quilltap now keeps the entire corpus conformant to it without your intervention:

- **Switching the default triggers a full re-embed.** Making a *different* profile the default — or changing the default profile's provider, model, or dimensions — automatically queues **Re-embed Everything**. Every memory, conversation excerpt, document chunk, and help page is re-embedded with the new standard. (Narrowing only the Matryoshka truncation queues the cheaper local re-apply instead; widening it queues the full re-embed, since vectors cannot grow.)
- **Every startup audits the ledger.** A conformance pass runs on each boot and inspects every embedding in every database against the default profile's dimension. Vectors from a previous standard are swept out of the search indices (they were invisible to search anyway) and a targeted re-embed is queued for exactly the non-conforming rows — conforming rows are never re-embedded, so a healthy instance pays nothing. Dormant chats are left to their slumber; their excerpts are re-embedded when you next open them.

Mind the meter: if a large corpus predates this housekeeping, the first restart after switching to a paid provider will queue a re-embedding of every stale row. The **Emb** badge in the header shows the queue draining.

## Deleting an Embedding Profile

To remove a profile:

1. Find the profile in the list
2. Click **Delete** button (trash icon)
3. Confirm the deletion
4. Profile is removed (any dependent features may need reconfiguration)

## Using Embedding Profiles

### Where Embeddings Are Used

**Memory Search:**

- When chats need to find relevant memories to include in context
- Embeddings find memories semantically related to current conversation

**Semantic Search:**

- Manual search for memories by meaning
- "Find all memories about travel" finds travel-related content even if worded differently

**Memory Cascade:**

- Required for summarization and context management
- Helps decide which memories are relevant to keep

**Context Enhancement:**

- Automatically includes relevant memories in chat messages
- Embeddings determine which memories are most relevant

### Selecting a Profile

Most embedding profile selection is automatic:

1. The first embedding profile you create becomes active
2. It's used automatically for memory operations
3. To change:
   - Edit Memory settings in Chat Settings tab
   - Select different embedding profile if multiple exist

### Vocabulary Management

Embeddings maintain a vocabulary of indexed memories:

- **Total Embeddings** — How many text segments are indexed
- **Growth Rate** — How quickly vocabulary is growing
- **Refresh** — Force re-indexing of memories

## Embedding Providers

### OpenAI Text-Embedding-3

**Best for:**

- Cloud-hosted, high-quality embeddings
- Production use
- Reliable service

**Pros:**

- Excellent quality
- Reliable service
- Well-maintained
- Good performance

**Cons:**

- Requires internet
- API costs ($0.00002-0.0004 per 1K tokens)
- Requires API key
- Subject to OpenAI rate limits

**Configuration:**

- Requires OpenAI API key in API Keys tab
- Choose between small and large models
- Large model = higher quality, higher cost

### Ollama (Local)

**Best for:**

- Privacy-focused setups
- Development/testing
- Offline use
- Zero API costs

**Pros:**

- Free (runs locally)
- No internet required (after setup)
- Complete privacy
- Works offline

**Cons:**

- Requires local installation
- Slower than cloud (depends on hardware)
- Lower quality than commercial embeddings
- Requires Ollama knowledge to set up

**Configuration:**

- Install Ollama from ollama.ai
- Start Ollama server: `ollama serve`
- Install model: `ollama pull nomic-embed-text`
- Set base URL to <http://localhost:11434> (or your server)
- **Docker users:** No URL changes needed — add `11434` to `HOST_REDIRECT_PORTS`

**Models for Ollama:**

- **nomic-embed-text** — Good all-purpose embeddings
- **all-minilm** — Lightweight, fast
- **bge-small** — Small but capable
- Others available in Ollama library

### Other Providers

Some installations support additional providers:

- **Cohere** — Commercial service, high quality
- **Google Embeddings** — Google's embedding service
- **Custom** — Self-hosted embedding servers
- Check your Quilltap documentation for available options

## Best Practices for Embeddings

### Choosing Embeddings

**For Best Quality:**

- Use OpenAI's text-embedding-3-large
- Highest quality, best semantic understanding
- Higher cost, slight latency

**For Balance:**

- Use OpenAI's text-embedding-3-small
- Good quality, reasonable cost
- Recommended for most users

**For Cost:**

- Use local Ollama setup
- No API costs (except hardware)
- Slightly lower quality but free

**For Privacy:**

- Use local Ollama setup
- All processing happens locally
- No data sent to external services

### Vocabulary Management

**Monitor vocabulary size:**

- Check Stats tab in Embedding Profiles
- Growing vocabulary = more memories indexed

**When to refresh:**

- After major memory operations
- If search seems inaccurate
- Manually trigger refresh if needed

**Storage considerations:**

- Embeddings take up storage space
- Each memory segment is embedded and stored
- Growing vocabulary = larger database

## Troubleshooting Embeddings

### No embedding profile available

**Problem:** No profiles created yet

**Solution:**

- Create first embedding profile
- Choose provider (OpenAI recommended for starting)
- Configure and save

### API key validation failed

**Problem:** OpenAI API key not working

**Solutions:**

- Verify key in API Keys tab
- Test key directly with OpenAI
- Check that key hasn't expired
- Confirm account has credits

### Ollama connection failed

**Problem:** Can't connect to local Ollama

**Solutions:**

- Verify Ollama is running: `ollama serve`
- Check Base URL matches your setup (default: <http://localhost:11434>)
- Verify embedding model is installed: `ollama pull nomic-embed-text`
- Check firewall isn't blocking local connection
- Try restarting Ollama

### Memory search returning poor results

**Causes:**

- Embedding model quality
- Vocabulary not indexed
- Query too different from indexed memories

**Solutions:**

- Switch to higher-quality embedding model
- Refresh vocabulary/re-index memories
- Be more specific in search queries
- Check that embeddings are actually enabled

### Vocabulary not growing

**Problem:** Embeddings stat showing 0 or very low

**Solutions:**

- Ensure embedding profile is active
- Create some memories/chats to index
- Manually refresh vocabulary
- Check embedding profile configuration

### "Embedding dimension mismatch" error during search

**Problem:** A search returns an error along the lines of *"query is 1024-d, stored is 4096-d"*.

**Cause:** The active embedding profile's truncation setting differs from the dimension actually stored in the corpus. This happens when you change **Truncate output to** but haven't yet re-applied the profile.

**Solution:**

- This now heals itself: restart Quilltap and the startup conformance pass will queue the necessary re-embedding automatically (see **One Standard, Kept Automatically** above).
- To fix it without a restart: open the embedding profile, confirm the **Truncate output to** value is what you intended, and click **Re-apply (Matryoshka)** on the default profile to migrate the stored corpus to the new dimension. Two clicks — the second confirms.
- The re-apply job creates database backups before touching anything; you can find them next to the original `.db` files.

### Memory features not working

**Problem:** Memory cascade, semantic search not functioning

**Causes:**

- No embedding profile configured
- Embedding profile not active
- Embedding model not properly set up

**Solutions:**

- Create and configure embedding profile
- Verify profile is selected in Chat Settings
- Check Ollama is running (if using local)
- Restart chat and try again

## In-Chat Settings Access

Characters with help tools enabled can read your configured embedding profiles during a conversation using the `help_settings` tool with `category: "embeddings"`. This returns each profile's name, provider, model, and dimensions --- but never your API keys. Ask a help-tools-enabled character something like "What embedding profiles do I have set up?" and it will consult the records.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=memory&section=embedding-profiles")`

## Related Settings

- [API Keys](api-keys-settings.md) — Store credentials for cloud embedding providers (OpenAI)
- [Chat Settings](chat-settings.md) — Memory cascade settings that use embeddings
- [Connection Profiles](connection-profiles.md) — LLM used in conjunction with embeddings for memory operations
- [Chat Settings](chat-settings.md) — Context management depends on embeddings

## Glossary

- **Embedding** — Numerical representation of text that captures meaning
- **Vocabulary** — Collection of all indexed text segments
- **Semantic** — Relating to meaning rather than exact words
- **Index/Indexing** — Process of converting text to embeddings for search
- **Vector** — Mathematical representation of an embedding (array of numbers)
- **Similarity** — How close two embeddings are (how related their meanings are)
