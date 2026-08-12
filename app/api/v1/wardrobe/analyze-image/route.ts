/**
 * Wardrobe Image Analysis API v1
 *
 * POST /api/v1/wardrobe/analyze-image
 * Accepts a base64-encoded image and optional guidance text,
 * analyzes it using a vision-capable LLM, and returns proposed wardrobe items.
 */

import { createContextHandler } from '@/lib/api/middleware'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import { successResponse, badRequest, serverError } from '@/lib/api/responses'
import { analyzeImageForWardrobeItems } from '@/lib/wardrobe/image-analysis'

const analyzeImageSchema = z.object({
  image: z.string().min(1, 'Image data is required'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif'], {
    error: 'Unsupported image format. Use JPEG, PNG, WebP, or GIF.',
  }),
  guidance: z.string().max(2000).optional(),
})

// POST /api/v1/wardrobe/analyze-image
export const POST = createContextHandler(async (req, { repos, user }) => {

  const body = await req.json()
  const validated = analyzeImageSchema.parse(body)

  // Basic size check (~10MB base64 ≈ ~13.3MB string)
  if (validated.image.length > 14_000_000) {
    return badRequest('Image is too large. Maximum file size is 10 MB.')
  }

  try {
    const result = await analyzeImageForWardrobeItems(
      {
        image: validated.image,
        mimeType: validated.mimeType,
        guidance: validated.guidance,
      },
      repos,
      user.id
    )

    logger.info('[Wardrobe Image Analysis API] Analysis complete', {
      itemCount: result.proposedItems.length,
      provider: result.provider,
      model: result.model,
    })

    return successResponse({
      proposedItems: result.proposedItems,
      provider: result.provider,
      model: result.model,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image analysis failed'

    // User-facing errors (no vision provider, parse failures) are not server errors
    if (message.includes('No vision-capable') ||
        message.includes('API key not found') ||
        message.includes('The AI returned')) {
      logger.warn('[Wardrobe Image Analysis API] Analysis failed with user-facing error', {
        error: message,
      })
      return badRequest(message)
    }

    logger.error('[Wardrobe Image Analysis API] Analysis failed', {},
      error instanceof Error ? error : new Error(String(error))
    )
    return serverError(message)
  }
})
