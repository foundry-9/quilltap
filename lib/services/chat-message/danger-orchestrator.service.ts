/**
 * Chat Message Danger Orchestrator Service
 *
 * Resolves dangerous-content settings, optionally classifies the current user message,
 * synthesizes message flags for dangerous chats, and reroutes to uncensored providers
 * when Concierge Auto-Route is enabled.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ChatMetadataBase, ConnectionProfile, ChatSettings, Character } from '@/lib/schemas/types'
import type { DangerFlag } from '@/lib/schemas/chat.types'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'

import { encodeStatusEvent, safeEnqueue } from './streaming.service'
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service'
import { classifyContent as classifyDangerousContent } from '@/lib/services/dangerous-content/gatekeeper.service'
import { resolveProviderForDangerousContent } from '@/lib/services/dangerous-content/provider-routing.service'
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override'
import type { DangerResolutionResult } from './types'

const logger = createServiceLogger('ChatDangerOrchestrator')

export interface ResolveMessageDangerStateOptions {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  userId: string
  chat: ChatMetadataBase
  chatSettings: ChatSettings | null
  character: Character
  isContinueMode: boolean
  content?: string
  cheapLLMSelection: CheapLLMSelection | null
  connectionProfile: ConnectionProfile
  apiKey: string
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
}

/**
 * Resolve dangerous-content flags and provider routing for a message send.
 */
export async function resolveMessageDangerState({
  repos,
  chatId,
  userId,
  chat,
  chatSettings,
  character,
  isContinueMode,
  content,
  cheapLLMSelection,
  connectionProfile,
  apiKey,
  controller,
  encoder,
}: ResolveMessageDangerStateOptions): Promise<DangerResolutionResult> {
  let dangerFlags: DangerFlag[] | undefined
  let effectiveProfile = connectionProfile
  let effectiveApiKey = apiKey

  const dangerousContentResolved = resolveDangerousContentSettings(chatSettings, chat)
  const dangerSettings = dangerousContentResolved.settings

  if (shouldUseUncensoredRoute(chat) && dangerSettings.mode !== 'OFF' && !isContinueMode && content) {

    const categories = chat.dangerCategories && chat.dangerCategories.length > 0
      ? chat.dangerCategories
      : ['unspecified']

    dangerFlags = categories.map(cat => ({
      category: cat,
      score: 1.0,
      userOverridden: false,
      wasRerouted: false,
    }))

    if (dangerSettings.mode === 'AUTO_ROUTE' && !effectiveProfile.isDangerousCompatible) {
      const routeResult = await resolveProviderForDangerousContent(
        effectiveProfile,
        effectiveApiKey,
        dangerSettings,
        userId
      )

      if (routeResult.rerouted) {
        effectiveProfile = routeResult.connectionProfile
        effectiveApiKey = routeResult.apiKey

        dangerFlags = markFlagsAsRerouted(dangerFlags, routeResult.connectionProfile.provider, routeResult.connectionProfile.modelName)

        logger.info('[DangerousContent] Rerouted to uncensored provider (permanently dangerous chat)', {
          chatId,
          originalProfile: connectionProfile.name,
          uncensoredProfile: routeResult.connectionProfile.name,
        })
      }
    } else if (dangerSettings.mode === 'AUTO_ROUTE') {
    }

    return {
      dangerSettings,
      dangerFlags,
      effectiveProfile,
      effectiveApiKey,
    }
  }

  if (dangerSettings.mode !== 'OFF' && dangerSettings.scanTextChat && !isContinueMode && content && cheapLLMSelection) {
    try {
      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'classifying',
        message: 'Checking content...',
        characterName: character.name,
        characterId: character.id,
      }))

      const classificationResult = await classifyDangerousContent(
        content,
        cheapLLMSelection,
        userId,
        dangerSettings,
        chatId
      )

      if (classificationResult.isDangerous) {
        dangerFlags = classificationResult.categories.map(cat => ({
          category: cat.category,
          score: cat.score,
          userOverridden: false,
          wasRerouted: false,
        }))

        logger.info('[DangerousContent] User message classified as dangerous', {
          chatId,
          score: classificationResult.score,
          categories: classificationResult.categories.map(c => c.category),
          mode: dangerSettings.mode,
        })

        if (dangerSettings.mode === 'AUTO_ROUTE') {
          if (!effectiveProfile.isDangerousCompatible) {
            safeEnqueue(controller, encodeStatusEvent(encoder, {
              stage: 'rerouting',
              message: 'Routing to uncensored provider...',
              characterName: character.name,
              characterId: character.id,
            }))

            const routeResult = await resolveProviderForDangerousContent(
              effectiveProfile,
              effectiveApiKey,
              dangerSettings,
              userId
            )

            if (routeResult.rerouted) {
              effectiveProfile = routeResult.connectionProfile
              effectiveApiKey = routeResult.apiKey
              dangerFlags = markFlagsAsRerouted(dangerFlags, routeResult.connectionProfile.provider, routeResult.connectionProfile.modelName)

              logger.info('[DangerousContent] Rerouted to uncensored provider', {
                chatId,
                originalProfile: connectionProfile.name,
                uncensoredProfile: routeResult.connectionProfile.name,
                reason: routeResult.reason,
              })
            } else {
              logger.warn('[DangerousContent] No uncensored provider available, using original', {
                chatId,
                reason: routeResult.reason,
              })
            }
          } else {
          }
        }

        if (classificationResult.usage) {
          const classificationEvent = {
            id: crypto.randomUUID(),
            type: 'system' as const,
            systemEventType: 'DANGER_CLASSIFICATION' as const,
            description: `Content classified: score ${classificationResult.score.toFixed(2)}, categories: ${classificationResult.categories.map(c => c.category).join(', ')}`,
            promptTokens: classificationResult.usage.promptTokens,
            completionTokens: classificationResult.usage.completionTokens,
            totalTokens: classificationResult.usage.totalTokens,
            provider: cheapLLMSelection.provider,
            modelName: cheapLLMSelection.modelName,
            createdAt: new Date().toISOString(),
          }
          await repos.chats.addMessage(chatId, classificationEvent)
        }
      }
    } catch (error) {
      logger.error('[DangerousContent] Classification failed, continuing with original provider', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    dangerSettings,
    dangerFlags,
    effectiveProfile,
    effectiveApiKey,
  }
}

function markFlagsAsRerouted(
  flags: DangerFlag[],
  reroutedProvider: string,
  reroutedModel: string
): DangerFlag[] {
  return flags.map(flag => ({
    ...flag,
    wasRerouted: true,
    reroutedProvider,
    reroutedModel,
  }))
}
