/**
 * Models API Endpoint
 * Phase 0.7: Multi-Provider Support
 *
 * POST /api/models - Get available models for a provider
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decryptApiKey } from '@/lib/encryption'
import { createLLMProvider } from '@/lib/llm/factory'
import { Provider } from '@prisma/client'
import { z } from 'zod'

// Validation schema
const getModelsSchema = z.object({
  provider: z.enum(['OPENAI', 'ANTHROPIC', 'OLLAMA', 'OPENROUTER', 'OPENAI_COMPATIBLE']),
  apiKeyId: z.string().optional(), // Optional API key ID
  baseUrl: z.string().optional(), // Required for Ollama/OpenAI-compatible
})

/**
 * POST /api/models
 * Get available models for a provider
 *
 * Body: {
 *   provider: Provider
 *   apiKeyId?: string  // Optional, uses the API key if provided
 *   baseUrl?: string   // Required for Ollama/OpenAI-compatible
 * }
 *
 * Returns: {
 *   models: string[]
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Validate request body
    const body = await req.json()
    const { provider, apiKeyId, baseUrl } = getModelsSchema.parse(body)

    // Get API key if provided
    let decryptedKey = ''
    if (apiKeyId) {
      const apiKey = await prisma.apiKey.findFirst({
        where: {
          id: apiKeyId,
          userId: user.id,
        },
      })

      if (!apiKey) {
        return NextResponse.json(
          { error: 'API key not found' },
          { status: 404 }
        )
      }

      decryptedKey = decryptApiKey(
        apiKey.keyEncrypted,
        apiKey.keyIv,
        apiKey.keyAuthTag,
        user.id
      )
    }

    // Validate baseUrl requirements
    if ((provider === 'OLLAMA' || provider === 'OPENAI_COMPATIBLE') && !baseUrl) {
      return NextResponse.json(
        { error: `Base URL is required for ${provider} provider` },
        { status: 400 }
      )
    }

    // Validate API key requirements
    // Ollama, Anthropic, and OpenAI-compatible providers may not need API keys for fetching models
    // (Ollama uses local server, Anthropic returns hardcoded list, OpenAI-compatible is optional)
    const providersWithoutRequiredKey = ['OLLAMA', 'ANTHROPIC', 'OPENAI_COMPATIBLE']
    if (!providersWithoutRequiredKey.includes(provider) && !decryptedKey) {
      return NextResponse.json(
        { error: `API key is required for ${provider} provider` },
        { status: 400 }
      )
    }

    // Create provider instance
    const llmProvider = createLLMProvider(provider, baseUrl)

    // Get available models
    const models = await llmProvider.getAvailableModels(decryptedKey)

    return NextResponse.json({
      provider,
      models,
      count: models.length,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Failed to fetch models:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch models',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
