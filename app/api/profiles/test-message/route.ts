/**
 * Connection Profile Test Message Endpoint
 * Phase 0.7: Multi-Provider Support
 *
 * POST /api/profiles/test-message - Send a test message to verify provider functionality
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
const testMessageSchema = z.object({
  provider: z.enum(['OPENAI', 'ANTHROPIC', 'OLLAMA', 'OPENROUTER', 'OPENAI_COMPATIBLE']),
  apiKeyId: z.string().optional(),
  baseUrl: z.string().optional(),
  modelName: z.string(),
  parameters: z.object({
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().min(1).optional(),
    top_p: z.number().min(0).max(1).optional(),
  }).optional(),
})

/**
 * POST /api/profiles/test-message
 * Send a test message to verify provider functionality
 *
 * Body: {
 *   provider: Provider
 *   apiKeyId?: string
 *   baseUrl?: string
 *   modelName: string
 *   parameters?: {
 *     temperature?: number
 *     max_tokens?: number
 *     top_p?: number
 *   }
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Validate request body
    const body = await req.json()
    const { provider, apiKeyId, baseUrl, modelName, parameters = {} } = testMessageSchema.parse(body)

    // Get API key if provided
    let decryptedKey = ''
    if (apiKeyId) {
      const apiKey = await prisma.apiKey.findFirst({
        where: {
          id: apiKeyId,
          userId: session.user.id,
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
        session.user.id
      )
    }

    // Validate requirements
    if ((provider === 'OLLAMA' || provider === 'OPENAI_COMPATIBLE') && !baseUrl) {
      return NextResponse.json(
        { error: `Base URL is required for ${provider}` },
        { status: 400 }
      )
    }

    if (provider !== 'OLLAMA' && !decryptedKey) {
      return NextResponse.json(
        { error: `API key is required for ${provider}` },
        { status: 400 }
      )
    }

    // Create provider instance
    const llmProvider = createLLMProvider(provider, baseUrl)

    // Send test message
    const testPrompt = 'Hello! Please respond with a brief greeting to confirm the connection is working.'

    try {
      const response = await llmProvider.sendMessage(
        {
          model: modelName,
          messages: [
            {
              role: 'user',
              content: testPrompt,
            },
          ],
          ...parameters,
          max_tokens: parameters.max_tokens || 50, // Limit tokens for test
        },
        decryptedKey
      )

      // Check if we got a response
      if (response && response.content) {
        return NextResponse.json({
          success: true,
          provider,
          modelName,
          message: `Test message successful! Model responded: "${response.content.substring(0, 100)}${response.content.length > 100 ? '...' : ''}"`,
          responsePreview: response.content.substring(0, 200),
        })
      }

      return NextResponse.json(
        {
          success: false,
          provider,
          error: 'No response received from model',
        },
        { status: 500 }
      )
    } catch (error) {
      console.error('Test message failed:', error)
      return NextResponse.json(
        {
          success: false,
          provider,
          error: error instanceof Error ? error.message : 'Failed to send test message',
        },
        { status: 500 }
      )
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Failed to test message:', error)
    return NextResponse.json(
      {
        error: 'Failed to test message',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
