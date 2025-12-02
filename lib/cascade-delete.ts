/**
 * Cascade Delete Utilities
 *
 * Helper functions to find related entities that should be deleted
 * when a character (or other entity) is deleted.
 */

import { logger } from '@/lib/logger'
import { getRepositories } from '@/lib/json-store/repositories'
import * as fileManager from '@/lib/file-manager'
import { getVectorStoreManager } from '@/lib/embedding/vector-store'
import type { ChatMetadata, FileEntry } from '@/lib/json-store/schemas/types'

export interface ExclusiveChatInfo {
  chat: ChatMetadata
  messageCount: number
}

export interface CascadeDeletePreview {
  characterId: string
  characterName: string
  exclusiveChats: ExclusiveChatInfo[]
  exclusiveCharacterImages: FileEntry[]
  exclusiveChatImages: FileEntry[]
  memoryCount: number
}

/**
 * Find chats that are exclusively associated with a character.
 * "Exclusive" means the chat only has this one character as a CHARACTER participant.
 * Chats with multiple characters are not considered exclusive.
 */
export async function findExclusiveChatsForCharacter(
  characterId: string
): Promise<ExclusiveChatInfo[]> {
  const repos = getRepositories()

  // Get all chats that include this character
  const chatsWithCharacter = await repos.chats.findByCharacterId(characterId)

  const exclusiveChats: ExclusiveChatInfo[] = []

  for (const chat of chatsWithCharacter) {
    // Get all CHARACTER participants in this chat
    const characterParticipants = chat.participants.filter(p => p.type === 'CHARACTER')

    // If this is the only character in the chat, it's exclusive
    if (characterParticipants.length === 1 && characterParticipants[0].characterId === characterId) {
      exclusiveChats.push({
        chat,
        messageCount: chat.messageCount || 0,
      })
    }
  }

  return exclusiveChats
}

/**
 * Find images that are exclusively associated with a character.
 * "Exclusive" means the image is only linked to this character and nothing else.
 */
export async function findExclusiveImagesForCharacter(
  characterId: string
): Promise<FileEntry[]> {
  const repos = getRepositories()
  const character = await repos.characters.findById(characterId)

  if (!character) {
    return []
  }

  const exclusiveImages: FileEntry[] = []

  // Check defaultImageId
  if (character.defaultImageId) {
    const image = await fileManager.findFileById(character.defaultImageId)
    if (image) {
      // Check if this image is only linked to this character
      const isExclusive = image.linkedTo.length === 0 ||
        (image.linkedTo.length === 1 && image.linkedTo[0] === characterId)

      if (isExclusive) {
        // Additional check: make sure no other character or persona uses this as default
        const allCharacters = await repos.characters.findAll()
        const allPersonas = await repos.personas.findAll()

        const usedElsewhere =
          allCharacters.some(c => c.id !== characterId && c.defaultImageId === image.id) ||
          allPersonas.some(p => p.defaultImageId === image.id)

        if (!usedElsewhere) {
          exclusiveImages.push(image)
        }
      }
    }
  }

  // Check avatar overrides
  for (const override of character.avatarOverrides || []) {
    if (override.imageId) {
      const image = await fileManager.findFileById(override.imageId)
      if (image && !exclusiveImages.find(i => i.id === image.id)) {
        // Check if this image is only used by this character's overrides
        const allCharacters = await repos.characters.findAll()
        const usedElsewhere = allCharacters.some(c => {
          if (c.id === characterId) return false
          if (c.defaultImageId === image.id) return true
          return c.avatarOverrides?.some(o => o.imageId === image.id)
        })

        if (!usedElsewhere) {
          exclusiveImages.push(image)
        }
      }
    }
  }

  return exclusiveImages
}

/**
 * Find images that are exclusively associated with a set of chats.
 * These are images attached to messages in those chats that aren't used elsewhere.
 */
export async function findExclusiveImagesForChats(
  chatIds: string[]
): Promise<FileEntry[]> {
  if (chatIds.length === 0) {
    return []
  }

  const repos = getRepositories()
  const exclusiveImages: FileEntry[] = []
  const seenImageIds = new Set<string>()

  // Collect all image IDs from messages in these chats
  const imageIdsInChats = new Set<string>()

  for (const chatId of chatIds) {
    const messages = await repos.chats.getMessages(chatId)
    for (const message of messages) {
      if (message.type === 'message' && message.attachments) {
        for (const attachmentId of message.attachments) {
          imageIdsInChats.add(attachmentId)
        }
      }
    }
  }

  // For each image, check if it's exclusively used by these chats
  for (const imageId of imageIdsInChats) {
    if (seenImageIds.has(imageId)) continue
    seenImageIds.add(imageId)

    const image = await fileManager.findFileById(imageId)
    if (!image) continue

    // Check if this image is used in any other chats
    const allChats = await repos.chats.findAll()
    let usedElsewhere = false

    for (const chat of allChats) {
      if (chatIds.includes(chat.id)) continue // Skip the chats being deleted

      const messages = await repos.chats.getMessages(chat.id)
      for (const message of messages) {
        if (message.type === 'message' && message.attachments?.includes(imageId)) {
          usedElsewhere = true
          break
        }
      }
      if (usedElsewhere) break
    }

    // Also check if used as character/persona default or avatar override
    if (!usedElsewhere) {
      const allCharacters = await repos.characters.findAll()
      const allPersonas = await repos.personas.findAll()

      usedElsewhere =
        allCharacters.some(c =>
          c.defaultImageId === imageId ||
          c.avatarOverrides?.some(o => o.imageId === imageId)
        ) ||
        allPersonas.some(p => p.defaultImageId === imageId)
    }

    if (!usedElsewhere) {
      exclusiveImages.push(image)
    }
  }

  return exclusiveImages
}

/**
 * Get a full preview of what will be deleted if a character is deleted with cascade.
 */
export async function getCascadeDeletePreview(
  characterId: string
): Promise<CascadeDeletePreview | null> {
  const repos = getRepositories()
  const character = await repos.characters.findById(characterId)

  if (!character) {
    return null
  }

  const exclusiveChats = await findExclusiveChatsForCharacter(characterId)
  const exclusiveCharacterImages = await findExclusiveImagesForCharacter(characterId)
  const exclusiveChatImages = await findExclusiveImagesForChats(
    exclusiveChats.map(c => c.chat.id)
  )

  // Get memory count for this character
  const memoryCount = await repos.memories.countByCharacterId(characterId)

  return {
    characterId,
    characterName: character.name,
    exclusiveChats,
    exclusiveCharacterImages,
    exclusiveChatImages,
    memoryCount,
  }
}

/**
 * Execute cascade deletion for a character.
 * Deletes the character along with its memories, and optionally deletes exclusive chats and images.
 */
export async function executeCascadeDelete(
  characterId: string,
  options: {
    deleteExclusiveChats: boolean
    deleteExclusiveImages: boolean
  }
): Promise<{
  success: boolean
  deletedChats: number
  deletedImages: number
  deletedMemories: number
}> {
  const repos = getRepositories()
  const character = await repos.characters.findById(characterId)

  if (!character) {
    return { success: false, deletedChats: 0, deletedImages: 0, deletedMemories: 0 }
  }

  let deletedChats = 0
  let deletedImages = 0
  let deletedMemories = 0

  // Get preview to know what to delete
  const preview = await getCascadeDeletePreview(characterId)
  if (!preview) {
    return { success: false, deletedChats: 0, deletedImages: 0, deletedMemories: 0 }
  }

  // Delete exclusive chats if requested
  if (options.deleteExclusiveChats) {
    // First delete exclusive chat images if requested
    if (options.deleteExclusiveImages) {
      for (const image of preview.exclusiveChatImages) {
        try {
          await fileManager.deleteFile(image.id)
          deletedImages++
        } catch (err) {
          logger.error(`Failed to delete chat image ${image.id}`, { context: { imageId: image.id } }, err instanceof Error ? err : undefined)
        }
      }
    }

    // Then delete the chats
    for (const { chat } of preview.exclusiveChats) {
      try {
        await repos.chats.delete(chat.id)
        deletedChats++
      } catch (err) {
        logger.error(`Failed to delete chat ${chat.id}`, { context: { chatId: chat.id } }, err instanceof Error ? err : undefined)
      }
    }
  }

  // Delete exclusive character images if requested
  if (options.deleteExclusiveImages) {
    for (const image of preview.exclusiveCharacterImages) {
      try {
        await fileManager.deleteFile(image.id)
        deletedImages++
      } catch (err) {
        logger.error(`Failed to delete character image ${image.id}`, { context: { imageId: image.id } }, err instanceof Error ? err : undefined)
      }
    }
  }

  // Always delete memories associated with the character
  if (preview.memoryCount > 0) {
    try {
      const memories = await repos.memories.findByCharacterId(characterId)
      const memoryIds = memories.map(m => m.id)
      deletedMemories = await repos.memories.bulkDelete(characterId, memoryIds)
    } catch (err) {
      logger.error(`Failed to delete memories for character ${characterId}`, { context: { characterId } }, err instanceof Error ? err : undefined)
    }
  }

  // Delete the character's vector index (embeddings)
  try {
    const vectorStoreManager = getVectorStoreManager()
    await vectorStoreManager.deleteStore(characterId)
  } catch (err) {
    logger.error(`Failed to delete vector store for character ${characterId}`, { context: { characterId } }, err instanceof Error ? err : undefined)
  }

  // Finally delete the character
  await repos.characters.delete(characterId)

  return { success: true, deletedChats, deletedImages, deletedMemories }
}
