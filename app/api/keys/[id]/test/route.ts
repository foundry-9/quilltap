/**
 * API Key Testing Endpoint
 * Phase 0.3: Core Infrastructure
 *
 * POST /api/keys/[id]/test - Test if an API key is valid
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getRepositories } from '@/lib/json-store/repositories'
import { decryptApiKey } from '@/lib/encryption'
import { Provider } from '@/lib/json-store/schemas/types'

/**
 * Test API key validity by making a simple request to the provider
 */
async function testProviderApiKey(
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

      case 'GOOGLE':
        return await testGoogle(apiKey)

      case 'GROK':
        return await testGrok(apiKey)

      case 'GAB_AI':
        return await testGabAI(apiKey)

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
 * Test OpenAI API key
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
 * Test Anthropic API key
 */
async function testAnthropic(apiKey: string) {
  try {
    // Anthropic doesn't have a simple validation endpoint
    // We'll make a minimal request
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
      // 400 is also valid - means API key works but request might be malformed
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
 * Test OpenRouter API key
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
 * Test OpenAI-compatible API
 */
async function testOpenAICompatible(apiKey: string, baseUrl: string) {
  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
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
 * Test Google API key
 */
async function testGoogle(apiKey: string) {
  try {
    // Test Google API key by calling the Google AI API
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (response.ok) {
      return { valid: true }
    }

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: 'Invalid API key' }
    }

    return { valid: false, error: `HTTP ${response.status}` }
  } catch (error) {
    return {
      valid: false,
      error: 'Failed to connect to Google API',
    }
  }
}

/**
 * Test Grok API key
 */
async function testGrok(apiKey: string) {
  try {
    const response = await fetch('https://api.x.ai/v1/models', {
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
      error: 'Failed to connect to Grok',
    }
  }
}

/**
 * Test Gab AI API key
 */
async function testGabAI(apiKey: string) {
  try {
    const response = await fetch('https://gab.ai/v1/models', {
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
      error: 'Failed to connect to Gab AI',
    }
  }
}

/**
 * POST /api/keys/[id]/test
 * Test if an API key is valid
 *
 * Body: {
 *   baseUrl?: string  // Optional, required for Ollama/OpenAI-compatible
 * }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const repos = getRepositories()

    // Get the API key
    const apiKey = await repos.connections.findApiKeyById(id)

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key not found' },
        { status: 404 }
      )
    }

    // Decrypt the API key
    const decryptedKey = decryptApiKey(
      apiKey.ciphertext,
      apiKey.iv,
      apiKey.authTag,
      session.user.id
    )

    // Get optional baseUrl from request body
    const body = await req.json().catch(() => ({}))
    const { baseUrl } = body

    // Test the key
    const result = await testProviderApiKey(
      apiKey.provider as Provider,
      decryptedKey,
      baseUrl
    )

    if (result.valid) {
      // Update lastUsed timestamp
      await repos.connections.recordApiKeyUsage(id)

      return NextResponse.json({
        valid: true,
        provider: apiKey.provider,
        message: 'API key is valid',
      })
    }

    return NextResponse.json(
      {
        valid: false,
        provider: apiKey.provider,
        error: result.error,
      },
      { status: 400 }
    )
  } catch (error) {
    console.error('Failed to test API key:', error)
    return NextResponse.json(
      { error: 'Failed to test API key' },
      { status: 500 }
    )
  }
}
