import { NextResponse } from 'next/server'
import { providerRegistry } from '@/lib/plugins/provider-registry'
import { logger } from '@/lib/logger'

/**
 * GET /api/providers
 * Get all registered LLM providers with their configuration requirements
 */
export async function GET() {
  try {
    const state = providerRegistry.exportState()

    logger.debug('Fetching providers list', {
      context: 'GET /api/providers',
      providerCount: state.providers.length,
      initialized: state.initialized,
    })

    return NextResponse.json({
      providers: state.providers,
      initialized: state.initialized,
      stats: state.stats,
    })
  } catch (error) {
    logger.error('Failed to get providers', {
      context: 'GET /api/providers',
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Failed to retrieve providers' },
      { status: 500 }
    )
  }
}
