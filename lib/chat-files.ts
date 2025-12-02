/**
 * Chat file utility functions for handling file uploads in chat messages
 */

import { writeFile, mkdir, readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { randomUUID, createHash } from 'node:crypto'
import { logger } from '@/lib/logger'
import { FileAttachment } from './llm/base'

export interface ChatFileUploadResult {
  filename: string
  filepath: string
  mimeType: string
  size: number
  sha256: string
  width?: number
  height?: number
}

/**
 * Allowed file MIME types for chat attachments
 * Includes images and documents that various providers support
 */
const ALLOWED_CHAT_FILE_TYPES = [
  // Images (supported by OpenAI, Anthropic, Grok)
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  // Documents (supported by Anthropic, Grok)
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
]

/**
 * Maximum file size in bytes (10 MB)
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024

/**
 * Validate chat file
 */
export function validateChatFile(file: File): void {
  if (!ALLOWED_CHAT_FILE_TYPES.includes(file.type)) {
    throw new Error(
      `Invalid file type: ${file.type}. Allowed types: ${ALLOWED_CHAT_FILE_TYPES.join(', ')}`
    )
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024} MB`
    )
  }
}

/**
 * Upload a chat file to the server
 */
export async function uploadChatFile(
  file: File,
  chatId: string
): Promise<ChatFileUploadResult> {
  validateChatFile(file)

  // Generate unique filename
  const ext = file.name.split('.').pop() || 'bin'
  const filename = `${chatId}_${Date.now()}_${randomUUID()}.${ext}`

  // Create chat-specific directory
  const chatDir = join(process.cwd(), 'public', 'uploads', 'chat-files', chatId)
  await mkdir(chatDir, { recursive: true })

  // Save file
  const filepath = join('uploads', 'chat-files', chatId, filename)
  const fullPath = join(process.cwd(), 'public', filepath)

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)

  await writeFile(fullPath, buffer)

  // Compute SHA256 hash
  const sha256 = createHash('sha256').update(buffer).digest('hex')

  return {
    filename,
    filepath,
    mimeType: file.type,
    size: file.size,
    sha256,
  }
}

/**
 * Load file data as base64 for sending to LLM provider
 */
export async function loadFileAsBase64(filepath: string): Promise<string> {
  const fullPath = join(process.cwd(), 'public', filepath)
  const buffer = await readFile(fullPath)
  return buffer.toString('base64')
}

/**
 * Convert database ChatFile records to FileAttachment format for LLM
 * Loads file data as base64
 */
export async function loadChatFilesForLLM(
  chatFiles: Array<{
    id: string
    filepath: string
    filename: string
    mimeType: string
    size: number
  }>
): Promise<FileAttachment[]> {
  const attachments: FileAttachment[] = []

  for (const file of chatFiles) {
    try {
      const data = await loadFileAsBase64(file.filepath)
      attachments.push({
        id: file.id,
        filepath: file.filepath,
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.size,
        data,
      })
    } catch (error) {
      logger.error(`Failed to load chat file`, { context: 'loadChatFilesForLLM', fileId: file.id }, error instanceof Error ? error : undefined)
      // Skip files that can't be loaded
    }
  }

  return attachments
}

/**
 * Delete a chat file from the server
 */
export async function deleteChatFile(filepath: string): Promise<void> {
  const fullPath = join(process.cwd(), 'public', filepath)

  try {
    await unlink(fullPath)
  } catch (error) {
    // Ignore if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

/**
 * Get supported MIME types for chat file uploads
 */
export function getSupportedMimeTypes(): string[] {
  return [...ALLOWED_CHAT_FILE_TYPES]
}
