/**
 * Client-side startup hook to trigger OpenRouter profile migration
 * This should be called once when the application loads
 */

let migrationTriggered = false

/**
 * Triggers the OpenRouter profile migration on application startup
 * This function is idempotent - it will only trigger the migration once per session
 */
export async function triggerOpenRouterMigration(): Promise<void> {
  // Prevent multiple triggers
  if (migrationTriggered) {
    return
  }

  migrationTriggered = true

  try {
    const response = await fetch('/api/startup/migrate-openrouter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      console.error('Failed to trigger OpenRouter migration:', response.statusText)
      return
    }

    const result = await response.json()

    if (result.success && result.result?.converted > 0) {
      console.log(
        `✓ OpenRouter migration: ${result.result.converted} profile(s) converted to native provider`
      )
    }

    if (result.result?.errors?.length > 0) {
      console.warn(
        `⚠ OpenRouter migration encountered ${result.result.errors.length} error(s):`,
        result.result.errors
      )
    }
  } catch (error) {
    console.error('Error triggering OpenRouter migration:', error)
  }
}
