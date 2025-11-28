/**
 * Embedding Models List Route
 *
 * GET /api/embedding-profiles/models
 * Returns the list of available embedding models by provider
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * Known embedding models by provider
 */
const EMBEDDING_MODELS = {
  OPENAI: [
    {
      id: 'text-embedding-3-small',
      name: 'Text Embedding 3 Small',
      dimensions: 1536,
      description: 'Smaller, faster, and cheaper. Good for most use cases.',
    },
    {
      id: 'text-embedding-3-large',
      name: 'Text Embedding 3 Large',
      dimensions: 3072,
      description: 'Larger model with higher accuracy for complex tasks.',
    },
    {
      id: 'text-embedding-ada-002',
      name: 'Text Embedding Ada 002',
      dimensions: 1536,
      description: 'Legacy model. Consider using text-embedding-3-small instead.',
    },
  ],
  OLLAMA: [
    {
      id: 'nomic-embed-text',
      name: 'Nomic Embed Text',
      dimensions: 768,
      description: 'High-quality open embedding model. Good balance of speed and accuracy.',
    },
    {
      id: 'mxbai-embed-large',
      name: 'MixedBread Embed Large',
      dimensions: 1024,
      description: 'Large embedding model with excellent performance.',
    },
    {
      id: 'all-minilm',
      name: 'All MiniLM',
      dimensions: 384,
      description: 'Fast and lightweight. Good for quick semantic search.',
    },
    {
      id: 'snowflake-arctic-embed',
      name: 'Snowflake Arctic Embed',
      dimensions: 1024,
      description: 'State-of-the-art retrieval embedding model.',
    },
  ],
}

/**
 * GET /api/embedding-profiles/models
 * Get available embedding models
 *
 * Query params:
 *   - provider: 'OPENAI' | 'OLLAMA' (optional, returns all if not specified)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    const provider = searchParams.get('provider')?.toUpperCase()

    if (provider) {
      if (provider !== 'OPENAI' && provider !== 'OLLAMA') {
        return NextResponse.json(
          { error: 'Invalid provider. Must be OPENAI or OLLAMA' },
          { status: 400 }
        )
      }

      return NextResponse.json({
        provider,
        models: EMBEDDING_MODELS[provider as keyof typeof EMBEDDING_MODELS],
      })
    }

    // Return all models grouped by provider
    return NextResponse.json(EMBEDDING_MODELS)
  } catch (error) {
    console.error('Failed to fetch embedding models:', error)
    return NextResponse.json(
      { error: 'Failed to fetch embedding models' },
      { status: 500 }
    )
  }
}
