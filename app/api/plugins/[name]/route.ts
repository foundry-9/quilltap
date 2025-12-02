import { NextResponse } from 'next/server'
import { pluginRegistry } from '@/lib/plugins/registry'
import { refreshPluginRoutes, getPluginRouteRegistry } from '@/lib/plugins/route-loader'
import { logger } from '@/lib/logger'

/**
 * PUT /api/plugins/[name]
 * Update plugin status (enable/disable)
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params
    const body = await request.json()
    const { enabled } = body

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'Invalid request: enabled must be a boolean' },
        { status: 400 }
      )
    }

    // Check if plugin exists
    if (!pluginRegistry.has(name)) {
      return NextResponse.json(
        { error: 'Plugin not found' },
        { status: 404 }
      )
    }

    const plugin = pluginRegistry.get(name)
    const hadApiRoutes = plugin?.capabilities.includes('API_ROUTES') ?? false

    logger.debug('Updating plugin status', {
      name,
      enabled,
      currentlyEnabled: plugin?.enabled,
      hasApiRoutes: hadApiRoutes
    })

    // Update plugin status
    const success = enabled
      ? pluginRegistry.enable(name)
      : pluginRegistry.disable(name)

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to update plugin status' },
        { status: 500 }
      )
    }

    // Refresh plugin routes if the plugin has API_ROUTES capability
    if (hadApiRoutes) {
      logger.debug('Refreshing plugin routes after status change', { name, enabled })
      refreshPluginRoutes()

      const routeRegistry = getPluginRouteRegistry()
      logger.info('Plugin routes refreshed', {
        plugin: name,
        enabled,
        totalRoutes: routeRegistry.totalRoutes,
        uniquePaths: routeRegistry.uniquePaths,
      })
    }

    const updatedPlugin = pluginRegistry.get(name)

    logger.info('Plugin status updated successfully', {
      name,
      enabled,
      routesRefreshed: hadApiRoutes
    })

    return NextResponse.json({
      success: true,
      plugin: {
        name: updatedPlugin?.manifest.name,
        title: updatedPlugin?.manifest.title,
        enabled: updatedPlugin?.enabled,
        capabilities: updatedPlugin?.capabilities,
      },
      routesRefreshed: hadApiRoutes,
    })
  } catch (error) {
    logger.error('Failed to update plugin', { error })
    return NextResponse.json(
      { error: 'Failed to update plugin' },
      { status: 500 }
    )
  }
}
