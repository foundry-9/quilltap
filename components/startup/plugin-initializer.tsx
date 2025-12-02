'use client'

import { useEffect } from 'react'
import { clientLogger } from '@/lib/client-logger'

/**
 * Component that triggers plugin initialization on mount
 * This should be included once in the root layout
 */
export function PluginInitializer() {
  useEffect(() => {
    // Trigger plugin initialization when component mounts (on app startup)
    initializePlugins()
  }, [])

  // This component doesn't render anything
  return null
}

/**
 * Client-side function to trigger plugin initialization
 * This function is idempotent - it will only trigger initialization once per session
 */
let initializationTriggered = false

async function initializePlugins(): Promise<void> {
  // Prevent multiple triggers
  if (initializationTriggered) {
    return
  }

  initializationTriggered = true

  try {
    const response = await fetch('/api/startup/initialize-plugins', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      clientLogger.error('Failed to initialize plugins', { error: response.statusText })
      return
    }

    const result = await response.json()

    if (result.success) {
      const stats = result.result.stats

      if (stats.enabled > 0) {
        clientLogger.info(
          `✓ Plugin system initialized: ${stats.enabled} enabled, ${stats.disabled} disabled, ${stats.errors} errors`
        )
      } else {
        clientLogger.info('✓ Plugin system initialized: no plugins enabled')
      }

      // Log warnings
      if (result.result.warnings?.length > 0) {
        clientLogger.warn(
          `⚠ Plugin initialization warnings (${result.result.warnings.length}):`,
          { warnings: result.result.warnings }
        )
      }

      // Log errors
      if (result.result.errors?.length > 0) {
        clientLogger.error(
          `✗ Plugin initialization errors (${result.result.errors.length}):`,
          { errors: result.result.errors }
        )
      }
    } else {
      clientLogger.error('Plugin initialization failed', { error: result.error })
    }
  } catch (error) {
    clientLogger.error('Error initializing plugins', { error: error instanceof Error ? error.message : String(error) })
  }
}
