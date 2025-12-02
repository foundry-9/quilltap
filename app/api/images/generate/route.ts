/**
 * Image Generation API Route
 * Phase 3: Image Generation Endpoint
 *
 * POST /api/images/generate - Generate images using LLM providers
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { decryptApiKey } from '@/lib/encryption'
import { createLLMProvider } from '@/lib/llm'
import { logger } from '@/lib/logger'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { createHash } from 'crypto'
import { z } from 'zod'

const generateImageSchema = z.object({
  prompt: z.string().min(1).max(4000),
  profileId: z.string().uuid(),
  tags: z
    .array(
      z.object({
        tagType: z.enum(['CHARACTER', 'PERSONA', 'CHAT', 'THEME']),
        tagId: z.string(),
      })
    )
    .optional(),
  options: z
    .object({
      n: z.number().int().min(1).max(10).optional(),
      size: z.string().optional(),
      quality: z.enum(['standard', 'hd']).optional(),
      style: z.enum(['vivid', 'natural']).optional(),
      aspectRatio: z.string().optional(),
    })
    .optional(),
})

/**
 * POST /api/images/generate
 * Generate images using a connection profile's configured provider
 *
 * Body: {
 *   prompt: string
 *   profileId: string (uuid of connection profile)
 *   tags?: Array<{ tagType: 'CHARACTER' | 'PERSONA' | 'CHAT' | 'THEME', tagId: string }>
 *   options?: {
 *     n?: number (1-10)
 *     size?: string
 *     quality?: 'standard' | 'hd'
 *     style?: 'vivid' | 'natural'
 *     aspectRatio?: string
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Validate request body
    const body = await request.json()
    const { prompt, profileId, tags, options = {} } = generateImageSchema.parse(body)

    const repos = getRepositories()

    // Load and validate connection profile
    const profile = await repos.connections.findById(profileId)

    if (!profile || profile.userId !== session.user.id) {
      return NextResponse.json(
        { error: 'Connection profile not found' },
        { status: 404 }
      )
    }

    // Get API key if profile has one
    let decryptedKey = ''
    if (profile.apiKeyId) {
      const apiKey = await repos.connections.findApiKeyById(profile.apiKeyId)
      if (apiKey) {
        decryptedKey = decryptApiKey(
          apiKey.ciphertext,
          apiKey.iv,
          apiKey.authTag,
          session.user.id
        )
      }
    }

    // Create provider instance
    const provider = await createLLMProvider(profile.provider as any, profile.baseUrl ?? undefined)

    // Verify provider supports image generation
    if (!provider.supportsImageGeneration) {
      return NextResponse.json(
        { error: `${profile.provider} provider does not support image generation` },
        { status: 400 }
      )
    }

    // Generate images
    const imageGenResponse = await provider.generateImage(
      {
        prompt,
        model: profile.modelName,
        n: options.n,
        size: options.size,
        quality: options.quality,
        style: options.style,
        aspectRatio: options.aspectRatio,
      },
      decryptedKey
    )

    // Save generated images and create database records
    const savedImages = await Promise.all(
      imageGenResponse.images.map(async (generatedImage, index) => {
        // Decode base64 to buffer
        const imageBuffer = Buffer.from(generatedImage.data, 'base64')

        // Get file extension from mime type
        const mimeTypeParts = generatedImage.mimeType.split('/')
        const ext = mimeTypeParts[1] === 'jpeg' ? 'jpg' : mimeTypeParts[1] || 'png'

        // Generate unique filename
        const hash = createHash('sha256').update(imageBuffer).digest('hex')
        const shortHash = hash.substring(0, 8)
        const filename = `${session.user.id}_${Date.now()}_${index}_${shortHash}.${ext}`

        // Create user-specific generated directory
        const userGeneratedDir = join(process.cwd(), 'public', 'uploads', 'generated', session.user.id)
        await mkdir(userGeneratedDir, { recursive: true })

        // Save file
        const filepath = join('uploads', 'generated', session.user.id, filename)
        const fullPath = join(process.cwd(), 'public', filepath)

        await writeFile(fullPath, imageBuffer)

        // Create database record using images repository
        const image = await repos.images.create({
          sha256: hash,
          type: 'image',
          userId: session.user.id,
          filename,
          relativePath: filepath,
          mimeType: generatedImage.mimeType,
          size: imageBuffer.length,
          source: 'generated',
          generationPrompt: prompt,
          generationModel: profile.modelName,
          tags: tags?.map(t => t.tagId) || [],
        })

        return {
          id: image.id,
          filename: image.filename,
          filepath: image.relativePath,
          url: `/${image.relativePath}`,
          mimeType: image.mimeType,
          size: image.size,
          revisedPrompt: generatedImage.revisedPrompt,
          tags: tags || [],
        }
      })
    )

    return NextResponse.json({
      data: savedImages,
      metadata: {
        prompt,
        provider: profile.provider,
        model: profile.modelName,
        count: savedImages.length,
      },
    })
  } catch (error) {
    logger.error('Error generating images', { endpoint: '/api/images/generate', method: 'POST' }, error instanceof Error ? error : undefined)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: 'Failed to generate images',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
