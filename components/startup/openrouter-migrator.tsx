'use client'

import { useEffect } from 'react'
import { triggerOpenRouterMigration } from '@/lib/startup/openrouter-migration'

/**
 * Component that triggers OpenRouter profile migration on mount
 * This should be included once in the root layout
 */
export function OpenRouterMigrator() {
  useEffect(() => {
    // Trigger migration when component mounts (on app startup)
    triggerOpenRouterMigration()
  }, [])

  // This component doesn't render anything
  return null
}
