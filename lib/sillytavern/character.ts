/**
 * SillyTavern Character Import/Export
 * Supports SillyTavern V2 character format
 */

import { logger } from '@/lib/logger'

export interface STCharacterV2 {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
  creator_notes?: string
  system_prompt?: string
  post_history_instructions?: string
  tags?: string[]
  creator?: string
  character_version?: string
  extensions?: Record<string, any>
  // Additional V2 spec fields
  alternate_greetings?: string[]
  character_book?: any
  title?: string
  [key: string]: any
}

export interface STCharacterCard {
  spec: 'chara_card_v2'
  spec_version: '2.0'
  data: STCharacterV2
}

/**
 * Import SillyTavern character data to internal format
 */
export function importSTCharacter(stData: STCharacterV2 | STCharacterCard) {
  // Handle both direct V2 format and card format
  const data = 'data' in stData ? stData.data : stData

  // mes_example can be an array or string in SillyTavern format
  // Convert to JSON string for storage
  let exampleDialogues = ''
  if (data.mes_example) {
    exampleDialogues = Array.isArray(data.mes_example)
      ? JSON.stringify(data.mes_example)
      : data.mes_example
  }

  return {
    name: data.name,
    title: data.title || null,
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    firstMessage: data.first_mes,
    exampleDialogues,
    systemPrompt: data.system_prompt || '',
    sillyTavernData: data, // Store original for full fidelity
  }
}

/**
 * Export internal character to SillyTavern format
 */
export function exportSTCharacter(character: any): STCharacterCard {
  // If we have original ST data, use it as base to preserve all fields
  const baseData: STCharacterV2 = character.sillyTavernData || {
    name: character.name,
    description: character.description,
    personality: character.personality,
    scenario: character.scenario,
    first_mes: character.firstMessage,
    mes_example: character.exampleDialogues || '',
    creator_notes: '',
    tags: [],
    creator: 'Quilltap',
    character_version: '1.0',
    extensions: {},
  }

  // Override with current values
  const data: STCharacterV2 = {
    ...baseData,
    name: character.name,
    description: character.description,
    personality: character.personality,
    scenario: character.scenario,
    first_mes: character.firstMessage,
    mes_example: character.exampleDialogues || '',
    system_prompt: character.systemPrompt || '',
    title: character.title || undefined,
  }

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data,
  }
}

/**
 * Parse SillyTavern character from PNG file
 * PNG files embed JSON data in a tEXt chunk
 */
export async function parseSTCharacterPNG(
  buffer: Buffer
): Promise<STCharacterV2 | null> {
  try {
    // Look for PNG tEXt chunk with chara data
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    if (!buffer.slice(0, 8).equals(pngSignature)) {
      throw new Error('Invalid PNG file')
    }

    let offset = 8
    while (offset < buffer.length) {
      // Read chunk length and type
      const length = buffer.readUInt32BE(offset)
      const type = buffer.toString('ascii', offset + 4, offset + 8)

      if (type === 'tEXt') {
        // Read chunk data
        const chunkData = buffer.slice(offset + 8, offset + 8 + length)

        // Find null terminator to separate keyword from text
        const nullIndex = chunkData.indexOf(0)
        if (nullIndex === -1) continue

        const keyword = chunkData.toString('utf8', 0, nullIndex)

        // Check for character data keywords
        if (keyword === 'chara' || keyword === 'ccv2') {
          const jsonData = chunkData.toString('utf8', nullIndex + 1)
          const parsed = JSON.parse(jsonData)

          // Handle both V2 card format and direct data
          if (parsed.spec === 'chara_card_v2' && parsed.data) {
            return parsed.data
          } else if (parsed.name) {
            return parsed
          }
        }
      }

      // Move to next chunk (length + type + data + CRC)
      offset += 12 + length
    }

    return null
  } catch (error) {
    logger.error('Error parsing ST character PNG', { context: {} }, error instanceof Error ? error : undefined)
    return null
  }
}

/**
 * Create SillyTavern character PNG with embedded JSON
 */
export async function createSTCharacterPNG(
  character: any,
  avatarBuffer?: Buffer
): Promise<Buffer> {
  const stCard = exportSTCharacter(character)
  const jsonData = JSON.stringify(stCard)

  // If no avatar provided, create a simple placeholder
  if (!avatarBuffer) {
    // TODO: Generate a simple colored PNG placeholder
    // For now, we'll require an avatar or handle this in the API
    throw new Error('Avatar image required for PNG export')
  }

  // Insert tEXt chunk into PNG
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // Create tEXt chunk
  const keyword = 'chara'
  const keywordBuffer = Buffer.from(keyword, 'utf8')
  const nullByte = Buffer.from([0])
  const dataBuffer = Buffer.from(jsonData, 'utf8')

  const chunkData = Buffer.concat([keywordBuffer, nullByte, dataBuffer])
  const chunkLength = Buffer.alloc(4)
  chunkLength.writeUInt32BE(chunkData.length)

  const chunkType = Buffer.from('tEXt', 'ascii')

  // Calculate CRC32 for chunk (type + data)
  const crc = calculateCRC32(Buffer.concat([chunkType, chunkData]))
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc)

  const textChunk = Buffer.concat([chunkLength, chunkType, chunkData, crcBuffer])

  // Insert chunk after PNG header and IHDR chunk
  // Find the IHDR chunk end
  let insertOffset = 8 // After PNG signature
  const ihdrLength = avatarBuffer.readUInt32BE(insertOffset)
  insertOffset += 12 + ihdrLength // Skip length, type, data, and CRC

  // Construct new PNG with tEXt chunk inserted
  const result = Buffer.concat([
    avatarBuffer.slice(0, insertOffset),
    textChunk,
    avatarBuffer.slice(insertOffset),
  ])

  return result
}

/**
 * Calculate CRC32 checksum (PNG spec)
 */
function calculateCRC32(buffer: Buffer): number {
  let crc = 0xffffffff

  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i]
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }

  return (crc ^ 0xffffffff) >>> 0
}
