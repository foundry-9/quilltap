/**
 * Image Processing Utility
 *
 * Provides image resizing and optimization for LLM provider compatibility.
 * Uses Sharp for efficient image processing.
 *
 * @module lib/files/image-processing
 */

import sharp from 'sharp'
// sharp 0.35 replaced its TypeScript namespace with named exports for ESM, so
// these types are no longer reachable as `sharp.Metadata` / `sharp.FormatEnum`.
import type { FormatEnum, Metadata } from 'sharp'
import { logger } from '@/lib/logger'
import { getAttachmentSupport } from '@/lib/plugins/provider-registry'

// Default conservative limit for unknown providers (4MB base64)
const DEFAULT_MAX_BASE64_SIZE = 4 * 1024 * 1024

export interface ImageResizeOptions {
  /** Target provider for size limit calculation */
  provider: string
  /** Original image buffer */
  buffer: Buffer
  /** Original MIME type */
  mimeType: string
  /** Original filename (for logging) */
  filename?: string
  /** Quality for JPEG/WebP (1-100, default 85) */
  quality?: number
}

export interface ImageResizeResult {
  /** Processed image buffer */
  buffer: Buffer
  /** Output MIME type (may change if format conversion needed) */
  mimeType: string
  /** Whether the image was resized */
  wasResized: boolean
  /** Original size in bytes */
  originalSize: number
  /** Final size in bytes */
  finalSize: number
  /** Final dimensions */
  width?: number
  height?: number
}

/**
 * Supported MIME types for resizing
 * GIF support is limited to static frames due to complexity of animated GIF resizing
 */
const RESIZABLE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif', // Static only - animated GIFs will be processed as single frame
]

/**
 * Check if a MIME type can be resized
 */
export function canResizeImage(mimeType: string): boolean {
  return RESIZABLE_MIME_TYPES.includes(mimeType.toLowerCase())
}

/**
 * Calculate the base64 size of a buffer
 * Base64 encoding increases size by approximately 33%
 */
export function calculateBase64Size(buffer: Buffer): number {
  // Base64 encodes 3 bytes into 4 characters
  // Each character is 1 byte in the string representation
  return Math.ceil(buffer.length * 4 / 3)
}

/**
 * Get the max base64 size for a provider from the plugin registry
 */
export function getProviderMaxBase64Size(provider: string): number {
  const attachmentSupport = getAttachmentSupport(provider)
  return attachmentSupport?.maxBase64Size ?? DEFAULT_MAX_BASE64_SIZE
}

/**
 * Determine the optimal output format for an image
 * Prefer JPEG for photos (lossy compression), PNG for graphics with transparency
 */
async function determineOutputFormat(
  buffer: Buffer,
  originalMimeType: string
): Promise<{ format: keyof FormatEnum; mimeType: string }> {
  const metadata = await sharp(buffer).metadata()

  // If the image has an alpha channel and it's PNG, keep PNG
  if (metadata.hasAlpha && originalMimeType === 'image/png') {
    return { format: 'png', mimeType: 'image/png' }
  }

  // For most photos and images, JPEG provides best compression
  if (originalMimeType === 'image/jpeg' || originalMimeType === 'image/jpg') {
    return { format: 'jpeg', mimeType: 'image/jpeg' }
  }

  // WebP stays WebP (good compression)
  if (originalMimeType === 'image/webp') {
    return { format: 'webp', mimeType: 'image/webp' }
  }

  // GIF stays GIF (for compatibility)
  if (originalMimeType === 'image/gif') {
    return { format: 'gif', mimeType: 'image/gif' }
  }

  // Default to JPEG for other formats
  return { format: 'jpeg', mimeType: 'image/jpeg' }
}

/**
 * Resize an image to fit within provider size limits
 *
 * Strategy:
 * 1. Check if image already fits within limits
 * 2. If not, progressively reduce dimensions until it fits
 * 3. Apply quality optimization for JPEG/WebP
 * 4. Return original if it fits or cannot be resized
 */
export async function resizeImageForProvider(
  options: ImageResizeOptions
): Promise<ImageResizeResult> {
  const {
    provider,
    buffer,
    mimeType,
    filename = 'unknown',
    quality = 85,
  } = options

  const originalSize = buffer.length
  const maxBase64Size = getProviderMaxBase64Size(provider)

  // Check if resizing is supported for this format
  if (!canResizeImage(mimeType)) {

    return {
      buffer,
      mimeType,
      wasResized: false,
      originalSize,
      finalSize: originalSize,
    }
  }

  // Check if image already fits within limits
  const base64Size = calculateBase64Size(buffer)
  if (base64Size <= maxBase64Size) {

    return {
      buffer,
      mimeType,
      wasResized: false,
      originalSize,
      finalSize: originalSize,
    }
  }

  // Get original image metadata
  const originalMetadata = await sharp(buffer).metadata()
  const originalWidth = originalMetadata.width || 0
  const originalHeight = originalMetadata.height || 0

  logger.info('Image exceeds provider limits, resizing required', {
    module: 'image-processing',
    filename,
    originalSize,
    base64Size,
    maxBase64Size,
    originalDimensions: `${originalWidth}x${originalHeight}`,
    provider,
  })

  // Determine output format
  const { format, mimeType: outputMimeType } = await determineOutputFormat(buffer, mimeType)

  // Progressive resize strategy
  // Start with 80% of original dimensions and reduce by 20% each iteration
  let scaleFactor = 0.8
  let iterations = 0
  const maxIterations = 10 // Safety limit
  let resultBuffer = buffer
  let resultMetadata: Metadata | null = null

  while (iterations < maxIterations) {
    iterations++

    const targetWidth = Math.round(originalWidth * scaleFactor)
    const targetHeight = Math.round(originalHeight * scaleFactor)

    // Build Sharp pipeline
    let pipeline = sharp(buffer)
      .resize({
        width: targetWidth,
        fit: 'inside',
        withoutEnlargement: true,
      })

    // Apply format-specific options
    switch (format) {
      case 'jpeg':
        pipeline = pipeline.jpeg({ quality, mozjpeg: true })
        break
      case 'webp':
        pipeline = pipeline.webp({ quality })
        break
      case 'png':
        pipeline = pipeline.png({ compressionLevel: 9 })
        break
      case 'gif':
        pipeline = pipeline.gif()
        break
    }

    resultBuffer = await pipeline.toBuffer()
    resultMetadata = await sharp(resultBuffer).metadata()

    const newBase64Size = calculateBase64Size(resultBuffer)

    // Check if we're now within limits
    if (newBase64Size <= maxBase64Size) {
      logger.info('Successfully resized image within limits', {
        module: 'image-processing',
        filename,
        originalSize,
        finalSize: resultBuffer.length,
        originalDimensions: `${originalWidth}x${originalHeight}`,
        finalDimensions: `${resultMetadata.width}x${resultMetadata.height}`,
        iterations,
        provider,
      })

      return {
        buffer: resultBuffer,
        mimeType: outputMimeType,
        wasResized: true,
        originalSize,
        finalSize: resultBuffer.length,
        width: resultMetadata.width,
        height: resultMetadata.height,
      }
    }

    // Reduce scale for next iteration
    scaleFactor *= 0.8

    // If we've gotten very small, try reducing quality instead
    if (scaleFactor < 0.2 && format === 'jpeg') {
      const reducedQuality = Math.max(quality - 20 * iterations, 40)
      pipeline = sharp(buffer)
        .resize({ width: targetWidth, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: reducedQuality, mozjpeg: true })
      resultBuffer = await pipeline.toBuffer()
    }
  }

  // If we've exhausted iterations, return the smallest version we got
  logger.warn('Could not resize image within limits after max iterations', {
    module: 'image-processing',
    filename,
    originalSize,
    finalSize: resultBuffer.length,
    base64Size: calculateBase64Size(resultBuffer),
    maxBase64Size,
    iterations,
  })

  return {
    buffer: resultBuffer,
    mimeType: outputMimeType,
    wasResized: true,
    originalSize,
    finalSize: resultBuffer.length,
    width: resultMetadata?.width,
    height: resultMetadata?.height,
  }
}
