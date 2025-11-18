/**
 * Connection Profile Testing Endpoint
 * Phase 0.7: Multi-Provider Support
 *
 * POST /api/profiles/test-connection - Test if connection settings are valid
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decryptApiKey } from '@/lib/encryption'
import { Provider } from '@prisma/client'
import { z } from 'zod'

// Validation schema
const testConnectionSchema = z.object({
  provider: z.enum(['OPENAI', 'ANTHROPIC', 'OLLAMA', 'OPENROUTER', 'OPENAI_COMPATIBLE']),
  apiKeyId: z.string().optional(),
  baseUrl: z.string().optional(),
})

/**
 * Test provider connection
 */
async function testProviderConnection(
  provider: Provider,
  apiKey: string,
  baseUrl?: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    switch (provider) {
      case 'OPENAI':
        return await testOpenAI(apiKey)

      case 'ANTHROPIC':
        return await testAnthropic(apiKey)

      case 'OLLAMA':
        if (!baseUrl) {
          return { valid: false, error: 'Base URL required for Ollama' }
        }
        return await testOllama(baseUrl)

      case 'OPENROUTER':
        return await testOpenRouter(apiKey)

      case 'OPENAI_COMPATIBLE':
        if (!baseUrl) {
          return { valid: false, error: 'Base URL required for OpenAI-compatible' }
        }
        return await testOpenAICompatible(apiKey, baseUrl)

      default:
        return { valid: false, error: 'Unsupported provider' }
    }
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Test OpenAI connection
 */
async function testOpenAI(apiKey: string) {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })

    if (response.ok) {
      return { valid: true }
    }

    const error = await response.json()
    return {
      valid: false,
      error: error.error?.message || 'Invalid API key',
    }
  } catch (error) {
    return {
      valid: false,
      error: 'Failed to connect to OpenAI',
    }
  }
}

/**
 * Test Anthropic connection
 */
async function testAnthropic(apiKey: string) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      }),
    })

    if (response.ok || response.status === 400) {
      return { valid: true }
    }

    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key' }
    }

    return { valid: false, error: `HTTP ${response.status}` }
  } catch (error) {
    return {
      valid: false,
      error: 'Failed to connect to Anthropic',
    }
  }
}

/**
 * Test Ollama connection
 */
async function testOllama(baseUrl: string) {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
    })

    if (response.ok) {
      return { valid: true }
    }

    return {
      valid: false,
      error: 'Failed to connect to Ollama',
    }
  } catch (error) {
    return {
      valid: false,
      error: 'Ollama server unreachable',
    }
  }
}

/**
 * Test OpenRouter connection
 */
async function testOpenRouter(apiKey: string) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })

    if (response.ok) {
      return { valid: true }
    }

    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key' }
    }

    return { valid: false, error: `HTTP ${response.status}` }
  } catch (error) {
    return {
      valid: false,
      error: 'Failed to connect to OpenRouter',
    }
  }
}

/**
 * Test OpenAI-compatible connection
 */
async function testOpenAICompatible(apiKey: string, baseUrl: string) {
  try {
    const headers: Record<string, string> = {}

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    const response = await fetch(`${baseUrl}/v1/models`, {
      headers,
    })

    if (response.ok) {
      return { valid: true }
    }

    return {
      valid: false,
      error: 'Failed to validate with OpenAI-compatible endpoint',
    }
  } catch (error) {
    return {
      valid: false,
      error: 'Server unreachable',
    }
  }
}

/**
 * POST /api/profiles/test-connection
 * Test if connection settings are valid
 *
 * Body: {
 *   provider: Provider
 *   apiKeyId?: string
 *   baseUrl?: string
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
    const { provider, apiKeyId, baseUrl } = testConnectionSchema.parse(body)

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

    if (provider !== 'OLLAMA' && provider !== 'OPENAI_COMPATIBLE' && !decryptedKey) {
      return NextResponse.json(
        { error: `API key is required for ${provider}` },
        { status: 400 }
      )
    }

    // Test the connection
    const result = await testProviderConnection(provider, decryptedKey, baseUrl)

    if (result.valid) {
      return NextResponse.json({
        valid: true,
        provider,
        message: `Successfully connected to ${provider}`,
      })
    }

    return NextResponse.json(
      {
        valid: false,
        provider,
        error: result.error,
      },
      { status: 400 }
    )
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Failed to test connection:', error)
    return NextResponse.json(
      {
        error: 'Failed to test connection',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
