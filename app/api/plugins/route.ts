import { NextResponse } from 'next/server'
import { pluginRegistry } from '@/lib/plugins/registry'
import { logger } from '@/lib/logger'

/**
 * GET /api/plugins
 * Get all registered plugins
 */
export async function GET() {
  try {
    const state = pluginRegistry.exportState()

    return NextResponse.json({
      plugins: state.plugins,
      stats: state.stats,
      errors: state.errors,
    })
  } catch (error) {
    logger.error('Failed to get plugins', { error })
    return NextResponse.json(
      { error: 'Failed to retrieve plugins' },
      { status: 500 }
    )
  }
}
