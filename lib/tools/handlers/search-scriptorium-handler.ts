/**
 * Search Scriptorium Tool Handler
 * Project Scriptorium Phase 2
 *
 * Executes unified search across memories and conversation chunks,
 * merging and ranking results by relevance.
 */

import { searchMemoriesSemantic } from '@/lib/memory/memory-service'
import { generateEmbeddingForUser } from '@/lib/embedding/embedding-service'
import { searchConversationChunks } from '@/lib/scriptorium/conversation-search'
import { searchDocumentChunks, type DocumentSearchResult } from '@/lib/mount-index/document-search'
import { buildDocStoreUriResolver } from '@/lib/doc-edit/uri-producers'
import {
  LITERAL_BOOST_CHARACTER,
  LITERAL_BOOST_GROUP,
  LITERAL_BOOST_PROJECT,
  LITERAL_BOOST_GLOBAL,
} from '@/lib/embedding/literal-boost'
import {
  resolveTieredMountPool,
  flattenTierPool,
  type TieredMountPool,
} from '@/lib/mount-index/tiered-mount-pool'
import { getRepositories } from '@/lib/repositories/factory'
import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  SearchScriptoriumToolInput,
  SearchScriptoriumToolOutput,
  SearchScriptoriumResult,
  validateSearchScriptoriumInput,
} from '../search-scriptorium-tool'

const logger = createServiceLogger('SearchScriptoriumHandler')

/**
 * Context required for search scriptorium execution
 */
export interface SearchScriptoriumToolContext {
  userId: string
  /** Acting character — absent on the operator surface (Brahma Console). */
  characterId?: string
  embeddingProfileId?: string
  projectId?: string
  /**
   * Operator surface (Brahma Console): character-less, memory-free. When set,
   * memory search is forced off, documents/knowledge reach every enabled store,
   * and conversations are searched operator-wide (all the user's chats).
   */
  operatorSurface?: boolean
}

/**
 * Execute the search scriptorium tool
 */
export async function executeSearchScriptoriumTool(
  input: unknown,
  context: SearchScriptoriumToolContext
): Promise<SearchScriptoriumToolOutput> {
  try {
    // Validate input
    const parsed = validateSearchScriptoriumInput(input)
    if (!parsed) {
      logger.warn('Search scriptorium tool validation failed', {
        context: 'search-scriptorium-handler',
        userId: context.userId,
        characterId: context.characterId,
        input,
      })
      return {
        success: false,
        error: 'Invalid input: query is required and must be a non-empty string',
        totalFound: 0,
        query: '',
      }
    }

    const {
      query,
      sources = ['memories', 'conversations', 'documents', 'knowledge'],
      scope = 'all',
      limit = 10,
      minImportance = 0,
      since,
      until,
      aboutCharacter,
    } = parsed

    // Time filters (episodic recall): normalize date-only bounds to full-day
    // coverage. Applied to memories via occurredAt ?? createdAt and to
    // conversation hits via the source chat's timestamps.
    const sinceIso = since ? (since.length === 10 ? `${since}T00:00:00.000Z` : since) : null
    const untilIso = until ? (until.length === 10 ? `${until}T23:59:59.999Z` : until) : null
    const timeWindow =
      sinceIso || untilIso
        ? {
            from: sinceIso ?? '0000-01-01T00:00:00.000Z',
            to: untilIso ?? '9999-12-31T23:59:59.999Z',
          }
        : null

    const repos = getRepositories()

    // Operator surface (Brahma Console): no character, no memories. Memory
    // search is forced off here defensively even if a caller somehow requests
    // it — the console never reads anyone's commonplace book.
    const operatorWide = !!context.operatorSurface
    const searchMemories = sources.includes('memories') && !operatorWide && !!context.characterId
    const searchConversations = sources.includes('conversations')
    const searchDocuments = sources.includes('documents')
    const searchKnowledge = sources.includes('knowledge')

    const results: SearchScriptoriumResult[] = []

    // Resolver for emitting a canonical qtap:// URI per document/knowledge hit
    // (self-vault → qtap://self/…, else the store name with UUID fallback).
    // Built once so per-row tagging stays synchronous.
    const docUriResolver = await buildDocStoreUriResolver(context.characterId)

    // Resolve the tri-tier mount pool up front so both the `documents` and
    // `knowledge` branches pick from the same deduped set, scoped by `scope`.
    // Character-vault access is ownership-gated (the one path that checks the
    // character belongs to the calling user); project/global tiers and the
    // pre-provisioning global-null tolerance all live in the shared helper.
    let pool: TieredMountPool = {
      characterMountPointId: null,
      participantMountPointIds: [],
      groupMountPointIds: [],
      projectMountPointIds: [],
      globalMountPointId: null,
    }
    let ownsCharacter = false
    // Operator surface: every enabled store is in scope (no character/project
    // tiers to resolve). Mirrors the doc path resolver's operator override.
    let operatorStoreIds: string[] = []

    if (searchDocuments || searchKnowledge) {
      if (operatorWide) {
        const enabled = await repos.docMountPoints.findEnabled()
        operatorStoreIds = enabled.map((mp) => mp.id)
      } else {
        pool = await resolveTieredMountPool(
          {
            userId: context.userId,
            characterId: context.characterId,
            projectId: context.projectId,
          },
          { requireOwnership: true },
        )
        // With ownership gating, a character vault is present only when the
        // calling user owns the character — mirror that for the tier filter below.
        ownsCharacter = !!pool.characterMountPointId
      }
    }

    // Pool for the `documents` source. On the operator surface this is every
    // enabled store; otherwise every store the LLM can see, narrowed by `scope`
    // (`all` is the union; `project` is project-linked stores; `character` is
    // the character's own vault only).
    const buildDocumentsPool = (): string[] =>
      operatorWide ? operatorStoreIds : flattenTierPool(pool, { scope })

    // Tiers for the `knowledge` source — same pools, each constrained to
    // `Knowledge/` paths, with tier-specific literal-phrase boosts so a hit in
    // the closer voice outranks the same hit in the wider pool. The `group` tier
    // is the responding character's group stores (per-character, never the chat).
    const buildKnowledgeTiers = (): Array<{
      tier: 'character' | 'group' | 'project' | 'global'
      mountPointIds: string[]
      boost: number
    }> => {
      // Operator surface: a single all-stores tier (labelled 'global').
      if (operatorWide) {
        return operatorStoreIds.length > 0
          ? [{ tier: 'global', mountPointIds: operatorStoreIds, boost: LITERAL_BOOST_GLOBAL }]
          : []
      }
      const tiers: Array<{
        tier: 'character' | 'group' | 'project' | 'global'
        mountPointIds: string[]
        boost: number
      }> = []
      const wantCharacter = scope === 'all' || scope === 'character'
      const wantGroup = scope === 'all' || scope === 'group'
      const wantProject = scope === 'all' || scope === 'project'
      const wantGlobal = scope === 'all'
      if (wantCharacter && pool.characterMountPointId) {
        tiers.push({ tier: 'character', mountPointIds: [pool.characterMountPointId], boost: LITERAL_BOOST_CHARACTER })
      }
      if (wantGroup && pool.groupMountPointIds.length > 0) {
        tiers.push({ tier: 'group', mountPointIds: pool.groupMountPointIds, boost: LITERAL_BOOST_GROUP })
      }
      if (wantProject && pool.projectMountPointIds.length > 0) {
        tiers.push({ tier: 'project', mountPointIds: pool.projectMountPointIds, boost: LITERAL_BOOST_PROJECT })
      }
      if (wantGlobal && pool.globalMountPointId) {
        tiers.push({ tier: 'global', mountPointIds: [pool.globalMountPointId], boost: LITERAL_BOOST_GLOBAL })
      }
      return tiers
    }

    // Search memories if requested (never on the operator surface — see above)
    if (searchMemories && context.characterId) {
      const characterId = context.characterId
      try {
        // Verify character exists and belongs to user
        const character = await repos.characters.findById(characterId)

        if (character && character.userId === context.userId) {
          // Optional about-character filter: resolve the name (or alias) to a
          // character id among the user's characters. An unresolvable name
          // returns no memory hits rather than silently ignoring the filter.
          let aboutCharacterId: string | undefined
          let aboutCharacterUnresolved = false
          if (aboutCharacter) {
            const needle = aboutCharacter.trim().toLowerCase()
            const allCharacters = await repos.characters.findAll()
            const match = allCharacters.find(c => {
              if (c.name.trim().toLowerCase() === needle) return true
              return (c.aliases ?? []).some(a => a.trim().toLowerCase() === needle)
            })
            if (match) {
              aboutCharacterId = match.id
            } else {
              aboutCharacterUnresolved = true
            }
          }

          const memoryResults = aboutCharacterUnresolved
            ? []
            : await searchMemoriesSemantic(
                characterId,
                query,
                {
                  userId: context.userId,
                  embeddingProfileId: context.embeddingProfileId,
                  limit,
                  minImportance,
                  applyLiteralPhraseBoost: true,
                  aboutCharacterId,
                  // Tool path: a plain hard filter on event time (no
                  // recallContext, so no soft fallback — the caller asked
                  // for a window).
                  occurredWithin: timeWindow,
                }
              )

          for (const mr of memoryResults) {
            results.push({
              content: mr.memory.content,
              sourceType: 'memory',
              relevanceScore: mr.score,
              metadata: {
                memoryId: mr.memory.id,
                summary: mr.memory.summary,
                importance: mr.memory.importance,
                effectiveWeight: mr.effectiveWeight,
                createdAt: mr.memory.createdAt,
                source: mr.memory.source,
                occurredAt: mr.memory.occurredAt ?? null,
                narrativeTime: mr.memory.narrativeTime ?? null,
                kind: mr.memory.kind ?? 'semantic',
                // The memory's source conversation — drillable via
                // read_conversation.
                conversationId: mr.memory.chatId ?? undefined,
              },
            })
          }
        }
      } catch (error) {
        logger.warn('Memory search failed, continuing with other sources', {
          context: 'search-scriptorium-handler',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Search conversations if requested
    if (searchConversations) {
      try {
        // Generate embedding for the query
        const embeddingResult = await generateEmbeddingForUser(
          query,
          context.userId,
          context.embeddingProfileId
        )

        const conversationResults = await searchConversationChunks(
          embeddingResult.embedding,
          {
            // Character surface scopes to the character's chats; the operator
            // surface (no characterId) scopes operator-wide via userId.
            characterId: context.characterId,
            userId: context.userId,
            limit,
            minScore: 0.3,
            query,
            applyLiteralPhraseBoost: true,
          }
        )

        // Time filter: keep conversations whose lifespan overlaps the window
        // (chat createdAt..updatedAt). Resolved per distinct chat — the hit
        // list is already capped at `limit`.
        let filteredConversationResults = conversationResults
        if (timeWindow) {
          const from = Date.parse(timeWindow.from)
          const to = Date.parse(timeWindow.to)
          const spanByChat = new Map<string, { start: number; end: number } | null>()
          for (const cr of conversationResults) {
            if (spanByChat.has(cr.chatId)) continue
            try {
              const sourceChat = await repos.chats.findById(cr.chatId)
              spanByChat.set(
                cr.chatId,
                sourceChat
                  ? {
                      start: Date.parse(sourceChat.createdAt),
                      end: Date.parse(sourceChat.updatedAt ?? sourceChat.createdAt),
                    }
                  : null,
              )
            } catch {
              spanByChat.set(cr.chatId, null)
            }
          }
          filteredConversationResults = conversationResults.filter(cr => {
            const span = spanByChat.get(cr.chatId)
            if (!span || !Number.isFinite(span.start)) return false
            const end = Number.isFinite(span.end) ? span.end : span.start
            return span.start <= to && end >= from
          })
        }

        for (const cr of filteredConversationResults) {
          results.push({
            content: cr.content.length > 500
              ? cr.content.substring(0, 500) + '...'
              : cr.content,
            sourceType: 'conversation',
            relevanceScore: cr.score,
            metadata: {
              conversationId: cr.chatId,
              interchangeIndex: cr.interchangeIndex,
              conversationTitle: cr.conversationTitle,
              participantNames: cr.participantNames,
            },
          })
        }
      } catch (error) {
        logger.warn('Conversation search failed, continuing with other sources', {
          context: 'search-scriptorium-handler',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Search documents if requested. We defer pushing document hits into
    // `results` until after the knowledge branch has run — when a character
    // vault is in the documents pool (always, under scope='all' or 'character'),
    // the same chunk surfaces here AND in the knowledge branch (scoped to
    // that vault's `Knowledge/` folder). We drop the duplicate from this side
    // so the knowledge-labeled row wins.
    let documentRows: DocumentSearchResult[] = []
    if (searchDocuments) {
      const documentsPool = buildDocumentsPool()
      if (documentsPool.length > 0) {
        try {
          const embeddingResult = await generateEmbeddingForUser(
            query,
            context.userId,
            context.embeddingProfileId
          )

          documentRows = await searchDocumentChunks(
            embeddingResult.embedding,
            {
              mountPointIds: documentsPool,
              limit,
              minScore: 0.3,
              query,
              applyLiteralPhraseBoost: true,
            }
          )
        } catch (error) {
          logger.warn('Document search failed, continuing with other sources', {
            context: 'search-scriptorium-handler',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    // Search the Knowledge/ tiers if requested. The same three pools as the
    // documents branch, narrowed by `scope`, but each tier is path-filtered
    // to `Knowledge/` and passes a distinct literalBoostFraction so a
    // verbatim hit in the character's own vault outranks the same hit in
    // the project pool, which in turn outranks the same hit in Quilltap
    // General. Branches are independent — any one can silently no-op (no
    // vault, no project links, not provisioned yet) without disturbing the
    // others. Character-vault access requires character ownership.
    const knowledgeChunkIds = new Set<string>()
    if (searchKnowledge) {
      const tiers = buildKnowledgeTiers()
      const tiersAllowed = tiers.filter(t => t.tier !== 'character' || ownsCharacter)

      if (tiersAllowed.length > 0) {
        try {
          const embeddingResult = await generateEmbeddingForUser(
            query,
            context.userId,
            context.embeddingProfileId
          )

          await Promise.all(
            tiersAllowed.map(async ({ tier, mountPointIds, boost }) => {
              try {
                const hits = await searchDocumentChunks(embeddingResult.embedding, {
                  mountPointIds,
                  pathPrefix: 'Knowledge/',
                  limit,
                  minScore: 0.3,
                  query,
                  applyLiteralPhraseBoost: true,
                  literalBoostFraction: boost,
                })

                for (const kr of hits) {
                  if (knowledgeChunkIds.has(kr.chunkId)) continue
                  knowledgeChunkIds.add(kr.chunkId)
                  results.push({
                    content: kr.content.length > 500
                      ? kr.content.substring(0, 500) + '...'
                      : kr.content,
                    sourceType: 'knowledge',
                    relevanceScore: kr.score,
                    metadata: {
                      mountPointName: kr.mountPointName,
                      fileName: kr.fileName,
                      filePath: kr.relativePath,
                      uri: docUriResolver.uriForMount(kr.mountPointName, kr.mountPointId, kr.relativePath),
                      chunkIndex: kr.chunkIndex,
                      headingContext: kr.headingContext ?? undefined,
                      knowledgeTier: tier,
                    },
                  })
                }
              } catch (error) {
                logger.warn('Knowledge tier search failed, continuing with other tiers', {
                  context: 'search-scriptorium-handler',
                  tier,
                  error: error instanceof Error ? error.message : String(error),
                })
              }
            })
          )
        } catch (error) {
          logger.warn('Knowledge search embedding failed, skipping all tiers', {
            context: 'search-scriptorium-handler',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    // Now push deferred document rows, skipping any chunk that already came
    // through as a knowledge hit (the knowledge label is more specific and
    // should win the slot).
    for (const dr of documentRows) {
      if (knowledgeChunkIds.has(dr.chunkId)) {
        continue
      }
      results.push({
        content: dr.content.length > 500
          ? dr.content.substring(0, 500) + '...'
          : dr.content,
        sourceType: 'document',
        relevanceScore: dr.score,
        metadata: {
          mountPointName: dr.mountPointName,
          fileName: dr.fileName,
          filePath: dr.relativePath,
          uri: docUriResolver.uriForMount(dr.mountPointName, dr.mountPointId, dr.relativePath),
          chunkIndex: dr.chunkIndex,
          headingContext: dr.headingContext ?? undefined,
        },
      })
    }

    // Sort all results by relevance score and limit
    results.sort((a, b) => b.relevanceScore - a.relevanceScore)
    const limitedResults = results.slice(0, limit)

    logger.info('Search scriptorium completed', {
      context: 'search-scriptorium-handler',
      userId: context.userId,
      query: query.substring(0, 100),
      scope,
      totalFound: limitedResults.length,
      memorySources: limitedResults.filter(r => r.sourceType === 'memory').length,
      conversationSources: limitedResults.filter(r => r.sourceType === 'conversation').length,
      documentSources: limitedResults.filter(r => r.sourceType === 'document').length,
      knowledgeSources: limitedResults.filter(r => r.sourceType === 'knowledge').length,
      knowledgeCharacter: limitedResults.filter(r => r.sourceType === 'knowledge' && r.metadata.knowledgeTier === 'character').length,
      knowledgeGroup: limitedResults.filter(r => r.sourceType === 'knowledge' && r.metadata.knowledgeTier === 'group').length,
      knowledgeProject: limitedResults.filter(r => r.sourceType === 'knowledge' && r.metadata.knowledgeTier === 'project').length,
      knowledgeGlobal: limitedResults.filter(r => r.sourceType === 'knowledge' && r.metadata.knowledgeTier === 'global').length,
    })

    return {
      success: true,
      results: limitedResults,
      totalFound: limitedResults.length,
      query,
    }
  } catch (error) {
    logger.error('Search scriptorium tool execution failed', {
      context: 'search-scriptorium-handler',
      userId: context.userId,
      characterId: context.characterId,
    }, error instanceof Error ? error : undefined)

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during search',
      totalFound: 0,
      query: typeof input === 'object' && input !== null && 'query' in input
        ? String((input as Record<string, unknown>).query)
        : '',
    }
  }
}

/**
 * Format search scriptorium results for inclusion in conversation context
 */
export function formatSearchScriptoriumResults(results: SearchScriptoriumResult[]): string {
  if (results.length === 0) {
    return 'No relevant results found.'
  }

  const formatted = results.map((result, index) => {
    if (result.sourceType === 'memory') {
      const importanceLabel = (result.metadata.importance ?? 0) >= 0.7 ? 'High' :
        (result.metadata.importance ?? 0) >= 0.4 ? 'Medium' : 'Low'

      // Episodic spine: surface event time + source conversation so the model
      // can confirm "when" and drill into the transcript.
      const whenParts: string[] = []
      if (result.metadata.occurredAt) whenParts.push(`When: ${result.metadata.occurredAt.slice(0, 10)}`)
      if (result.metadata.narrativeTime) whenParts.push(`Story time: ${result.metadata.narrativeTime}`)
      const whenLine = whenParts.length > 0 ? `\n${whenParts.join(' · ')}` : ''
      const sourceLine = result.metadata.conversationId
        ? `\nSource conversation: ${result.metadata.conversationId} (readable via read_conversation)`
        : ''

      return `[Result ${index + 1} - Memory] (Importance: ${importanceLabel}, Relevance: ${(result.relevanceScore * 100).toFixed(0)}%)
Summary: ${result.metadata.summary || 'No summary'}${whenLine}${sourceLine}
Details: ${result.content}`
    } else if (result.sourceType === 'conversation') {
      return `[Result ${index + 1} - Conversation] (Relevance: ${(result.relevanceScore * 100).toFixed(0)}%, Chat: ${result.metadata.conversationTitle || 'Untitled'})
Conversation ID: ${result.metadata.conversationId}
Interchange: ${result.metadata.interchangeIndex}
Participants: ${result.metadata.participantNames?.join(', ') || 'Unknown'}
Content: ${result.content}`
    } else if (result.sourceType === 'knowledge') {
      const heading = result.metadata.headingContext ? `, Section: ${result.metadata.headingContext}` : ''
      const path = result.metadata.filePath || result.metadata.fileName || 'Unknown'
      const mount = result.metadata.mountPointName || 'Unknown'
      const tier = result.metadata.knowledgeTier
        ? ` ${result.metadata.knowledgeTier.charAt(0).toUpperCase()}${result.metadata.knowledgeTier.slice(1)}`
        : ''
      return `[Result ${index + 1} -${tier} Knowledge] (Relevance: ${(result.relevanceScore * 100).toFixed(0)}%, Source: ${mount}${heading})
File: ${path}
Content: ${result.content}
Re-read with: doc_read_file(scope=document_store, mount_point="${mount}", path="${path}")`
    } else {
      const heading = result.metadata.headingContext ? `, Section: ${result.metadata.headingContext}` : ''
      return `[Result ${index + 1} - Document] (Relevance: ${(result.relevanceScore * 100).toFixed(0)}%, Source: ${result.metadata.mountPointName || 'Unknown'}${heading})
File: ${result.metadata.filePath || result.metadata.fileName || 'Unknown'}
Content: ${result.content}`
    }
  })

  return `Found ${results.length} results:\n\n${formatted.join('\n\n')}`
}
