# Memory Feature Implementation Plan

## Overview

This plan implements a comprehensive memory system for Quilltap characters, enabling automatic memory formation from conversations, semantic search via vector databases, and intelligent context management to stay within LLM token limits.

---

## Phase 1: Core Memory Infrastructure

### 1.1 Memory Data Model

Add to `lib/json-store/schemas/types.ts`:

```typescript
Memory {
  id: UUID
  characterId: UUID
  personaId?: UUID              // Optional: specific persona interaction
  chatId?: UUID                 // Optional: source chat reference
  content: string               // The actual memory content
  summary: string               // Distilled version for context injection
  keywords: string[]            // For text-based search
  tags: UUID[]                  // Derived from character/persona/chat tags
  importance: number            // 0-1 scale for prioritization
  embedding?: number[]          // Vector embedding for semantic search
  source: 'AUTO' | 'MANUAL'     // How it was created
  sourceMessageId?: UUID        // If auto-created, which message triggered it
  createdAt: ISO timestamp
  updatedAt: ISO timestamp
  lastAccessedAt?: ISO timestamp // For housekeeping decisions
}
```

### 1.2 Storage Structure

```
data/
├── memories/
│   ├── by-character/
│   │   └── {characterId}.jsonl     # All memories for a character
│   └── embeddings/
│       └── {characterId}.bin       # Binary vector storage (optional optimization)
└── vector-indices/
    └── {characterId}.json          # Vector index metadata
```

### 1.3 Memory Repository

Create `lib/json-store/repositories/memories.repository.ts`:

- `findByCharacterId(characterId)` - Get all memories for a character
- `findByKeywords(characterId, keywords[])` - Text-based search
- `findRelevant(characterId, query, limit)` - Semantic search using embeddings
- `create(memory)` - Create new memory
- `update(id, data)` - Update existing memory
- `delete(id)` - Delete memory
- `bulkDelete(ids[])` - Housekeeping cleanup
- `updateAccessTime(id)` - Track memory usage

---

## Phase 2: Cheap LLM System

### 2.1 Cheap LLM Provider Selection

Create `lib/llm/cheap-llm.ts`:

```typescript
interface CheapLLMConfig {
  strategy: 'USER_DEFINED' | 'PROVIDER_CHEAPEST' | 'LOCAL_FIRST'
  userDefinedProfileId?: string
  fallbackToLocal: boolean
}

function getCheapLLMProvider(currentProvider: string, config: CheapLLMConfig) {
  // Strategy 1: User-defined connection profile
  // Strategy 2: Map current provider to cheapest variant
  //   - anthropic/claude-sonnet-4-5 → anthropic/claude-haiku-4
  //   - openai/gpt-4o → openai/gpt-4o-mini
  //   - google/gemini-2.0-pro → google/gemini-2.0-flash
  // Strategy 3: Check for Ollama/local endpoint first
}
```

### 2.2 Connection Profile Extension

Add to connection profile settings:
- `cheapLLMStrategy`: enum of the three strategies
- `cheapLLMProfileId`: if user-defined, which profile to use
- `embeddingProvider`: 'SAME_PROVIDER' | 'OPENAI' | 'LOCAL'

### 2.3 Cheap LLM Use Cases Service

Create `lib/memory/cheap-llm-tasks.ts`:

```typescript
async function extractMemoryFromMessage(message: string, context: string): Promise<MemoryCandidate | null>
async function summarizeChat(messages: ChatMessage[]): Promise<string>
async function titleChat(messages: ChatMessage[], existingTitle?: string): Promise<string>
async function updateContextSummary(currentSummary: string, newMessages: ChatMessage[]): Promise<string>
async function describeAttachment(attachment: Attachment): Promise<string>
```

---

## Phase 3: Vector Database Integration

### 3.1 Embedding Generation

Create `lib/embeddings/embedding-provider.ts`:

```typescript
interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>
  generateBatchEmbeddings(texts: string[]): Promise<number[][]>
  getDimensions(): number
}

// Implementations:
// - OpenAIEmbeddingProvider (text-embedding-3-small)
// - AnthropicEmbeddingProvider (when available)
// - OllamaEmbeddingProvider (nomic-embed-text, etc.)
```

### 3.2 Vector Store

Create `lib/embeddings/vector-store.ts`:

For MVP, use in-memory vector search with JSONL persistence:

```typescript
class VectorStore {
  async addVector(id: string, embedding: number[], metadata: object): Promise<void>
  async removeVector(id: string): Promise<void>
  async search(queryEmbedding: number[], limit: number, filter?: object): Promise<SearchResult[]>
  async save(): Promise<void>      // Persist to disk
  async load(): Promise<void>      // Load from disk
}
```

**Similarity Function:** Cosine similarity (standard for text embeddings)

### 3.3 Per-Entity Vector Indices

- Per-character memory index
- Per-chat conversation index (for RAG within a conversation)
- Future: World-book/lore index

---

## Phase 4: Automatic Memory Formation

### 4.1 Message Processing Hook

Modify `app/api/chats/[id]/messages/route.ts`:

After each message exchange:
1. Queue cheap LLM task: "Is there something significant worth remembering?"
2. If yes, extract memory candidate
3. Check for duplicates/similar memories
4. Create memory with embedding
5. Update vector index

### 4.2 Memory Extraction Prompt

```
Analyze this conversation exchange. If there is something significant worth
remembering about the user/persona for future conversations, extract it.

Criteria for significance:
- Personal information shared (preferences, history, relationships)
- Emotional moments or important decisions
- Facts that should persist across conversations
- Changes in character development or relationships

If significant, respond with JSON:
{
  "significant": true,
  "content": "Full memory content",
  "summary": "Brief 1-sentence summary",
  "keywords": ["keyword1", "keyword2"],
  "importance": 0.0-1.0
}

If not significant, respond with:
{ "significant": false }
```

### 4.3 Background Processing

Create `lib/memory/memory-processor.ts`:

- Queue-based processing to not block chat responses
- Batch processing for efficiency
- Deduplication logic (semantic similarity check)
- Automatic tagging based on source chat/character tags

---

## Phase 5: Context Management

### 5.1 Token Budget System

Create `lib/chat/context-manager.ts`:

```typescript
interface ContextBudget {
  totalTokens: number           // From connection profile
  systemPromptTokens: number    // Reserved for system prompt
  memoryTokens: number          // Budget for injected memories
  summaryTokens: number         // Budget for conversation summary
  recentMessagesTokens: number  // Budget for recent messages
  responseTokens: number        // Reserved for response
}

function calculateContextBudget(connectionProfile: ConnectionProfile): ContextBudget
function buildContext(budget: ContextBudget, chat: Chat, memories: Memory[]): ContextPayload
```

### 5.2 Intelligent Context Building

1. Always include system prompt
2. Select relevant memories via vector search
3. Include condensed conversation summary if chat is long
4. Include as many recent messages as budget allows
5. Never exceed token limit (critical requirement!)

### 5.3 Token Counting

Create `lib/tokens/token-counter.ts`:

```typescript
// Use tiktoken for OpenAI-compatible counting
// Approximate for other providers with safety margin
function countTokens(text: string, provider: string): number
function estimateTokens(text: string): number  // Quick estimate
```

---

## Phase 6: Memory CRUD UI

### 6.1 Memory List Component

Create `components/character/memories-list.tsx`:

- Paginated list of memories
- Search by keyword
- Filter by importance/date/source
- Bulk selection for deletion

### 6.2 Memory Editor Component

Create `components/character/memory-editor.tsx`:

- View/edit memory content
- Edit keywords and tags
- Adjust importance
- View source message (if applicable)

### 6.3 Character Edit Page Integration

Modify `app/(authenticated)/characters/[id]/edit/page.tsx`:

- Add "Memories" tab to character edit
- Embed memory list and editor
- Quick stats (memory count, last updated)

### 6.4 Memory API Routes

```
GET    /api/characters/[id]/memories           # List all memories
POST   /api/characters/[id]/memories           # Create memory
GET    /api/characters/[id]/memories/[memId]   # Get specific memory
PUT    /api/characters/[id]/memories/[memId]   # Update memory
DELETE /api/characters/[id]/memories/[memId]   # Delete memory
POST   /api/characters/[id]/memories/search    # Semantic search
POST   /api/characters/[id]/memories/housekeep # Trigger cleanup
```

---

## Phase 7: Housekeeping System

### 7.1 Automatic Cleanup

Create `lib/memory/housekeeping.ts`:

```typescript
async function runHousekeeping(characterId: string, options: HousekeepingOptions): Promise<HousekeepingResult>

interface HousekeepingOptions {
  maxMemories?: number          // Limit total memories
  maxAgeMonths?: number         // Delete old unused memories
  minImportance?: number        // Delete low-importance memories
  mergeSimilar?: boolean        // Merge semantically similar memories
  dryRun?: boolean              // Preview changes
}
```

### 7.2 Scheduled Housekeeping

- Run after every N messages
- Run on character load if stale
- Manual trigger from UI

---

## Phase 8: Chat Integration

### 8.1 Memory Injection in Chat

Modify chat initialization to:

1. Query relevant memories for active participants
2. Build memory summary for system prompt
3. Include character-persona relationship history

### 8.2 Memory-Aware Prompting

Add to system prompt template:

```
## Character Memories
{Relevant memories about the user and past interactions}

## Conversation Context
{Summary of current conversation if long}
```

### 8.3 Tool for Memory Deep Dive

Add LLM tool definition:

```typescript
{
  name: "search_memories",
  description: "Search character's memories for specific information",
  parameters: {
    query: { type: "string", description: "What to search for" }
  }
}
```

This allows the LLM to explicitly request memory lookup during conversation.

---

## Implementation Order

### Sprint 1: Foundation (Core Infrastructure)
1. Memory schema and types
2. Memory repository with basic CRUD
3. Memory API routes
4. Basic memory list UI

### Sprint 2: Cheap LLM System
1. Cheap LLM provider selection
2. Connection profile extension
3. Basic cheap LLM tasks (summarization)

### Sprint 3: Auto-Memory Formation
1. Message processing hook
2. Memory extraction prompts
3. Automatic memory creation

### Sprint 4: Vector Database
1. Embedding provider abstraction
2. Vector store implementation
3. Semantic search integration

### Sprint 5: Context Management
1. Token counting
2. Context budget system
3. Intelligent context building

### Sprint 6: Full UI & Housekeeping
1. Complete memory editor UI
2. Housekeeping system
3. Memory deep-dive tool

---

## Technical Decisions & Rationale

### Why JSONL for Memories?
- Consistent with existing chat storage pattern
- Easy append-only writes for new memories
- Line-based format allows streaming reads

### Why In-Memory Vector Store?
- Simplicity for MVP
- Typical character has <1000 memories
- Cosine similarity on 1000 vectors is fast
- Can migrate to SQLite/DuckDB/Pinecone later if needed

### Why Background Processing?
- Chat response latency is critical
- Memory extraction can run async
- Better UX with non-blocking operations

### Token Limit Safety
- Always reserve buffer (10% of limit)
- Graceful degradation: reduce memories before messages
- Log warnings when approaching limits

---

## Design Decisions (Resolved)

| Question | Decision |
|----------|----------|
| **Cheap LLM strategy** | Auto-cheapest as default (maps to provider's cheapest model), with user-defined override in settings |
| **Embedding provider** | OpenAI `text-embedding-3-small` as default (~$0.02/1M tokens); local Ollama as explicit user override; keyword-only fallback if no provider available |
| **Memory retention policy** | Combined importance + age + access: delete if importance <0.3 AND not accessed in 6+ months AND created 6+ months ago. Never auto-delete: importance ≥0.7, manually created, or accessed in last 3 months. Hard cap: 1000 memories per character. |
| **Memory sharing** | Character-only for MVP. Each character has isolated memories. Persona memories planned as future enhancement. |

---

## Dependencies to Add

```json
{
  "tiktoken": "^1.0.0",           // Token counting
  "hnswlib-node": "^3.0.0"        // Optional: faster vector search at scale
}
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Token limit exceeded | Hard cap with safety buffer, graceful degradation |
| Slow memory extraction | Background processing, queue system |
| Vector store corruption | Regular persistence, backup on write |
| Duplicate memories | Semantic similarity check before insert |
| Runaway costs from cheap LLM | Rate limiting, token budgets per session |

---

## Success Metrics

- Memory auto-extraction accuracy (manual review sample)
- Average token usage vs. budget
- Memory retrieval relevance (semantic search quality)
- UI responsiveness (memory list load time)
- Zero token limit errors in production
