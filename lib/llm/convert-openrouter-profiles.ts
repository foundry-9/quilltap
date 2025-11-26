// Utility to convert OPENAI_COMPATIBLE profiles using OpenRouter endpoint to native OPENROUTER provider
// This can be called manually or integrated into a migration script

import { JsonStore } from '../json-store/core/json-store'
import { ConnectionProfilesRepository } from '../json-store/repositories/connection-profiles.repository'

/**
 * Checks if a base URL is an OpenRouter endpoint
 */
export function isOpenRouterEndpoint(baseUrl: string | null | undefined): boolean {
  if (!baseUrl) return false

  try {
    const url = new URL(baseUrl)
    // Only accept http or https protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false
    }
    return url.hostname === 'openrouter.ai' || url.hostname.endsWith('.openrouter.ai')
  } catch {
    return false
  }
}

/**
 * Converts OPENAI_COMPATIBLE profiles using OpenRouter endpoints to native OPENROUTER provider
 *
 * @param userId - Optional user ID to limit conversion to a specific user
 * @returns Object with counts of profiles checked, converted, and any errors
 */
export async function convertOpenRouterProfiles(userId?: string): Promise<{
  checked: number
  converted: number
  errors: Array<{ profileId: string; error: string }>
}> {
  const jsonStore = new JsonStore()
  const repo = new ConnectionProfilesRepository(jsonStore)
  const result = {
    checked: 0,
    converted: 0,
    errors: [] as Array<{ profileId: string; error: string }>,
  }

  try {
    // Get all profiles (optionally filtered by user)
    const profiles = userId
      ? await repo.findByUserId(userId)
      : await repo.findAll()

    for (const profile of profiles) {
      result.checked++

      // Only convert OPENAI_COMPATIBLE profiles with OpenRouter endpoints
      if (profile.provider === 'OPENAI_COMPATIBLE' && isOpenRouterEndpoint(profile.baseUrl)) {
        try {
          // Update the profile to use native OPENROUTER provider
          await repo.update(profile.id, {
            provider: 'OPENROUTER',
            baseUrl: null, // OpenRouter provider doesn't use baseUrl
            updatedAt: new Date().toISOString(),
          })
          result.converted++

          console.log(`Converted profile ${profile.id} (${profile.name}) from OPENAI_COMPATIBLE to OPENROUTER`)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          result.errors.push({
            profileId: profile.id,
            error: errorMessage,
          })
          console.error(`Failed to convert profile ${profile.id}:`, errorMessage)
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('Failed to read profiles:', errorMessage)
    throw error
  }

  return result
}

/**
 * Dry run to check which profiles would be converted without making changes
 *
 * @param userId - Optional user ID to limit check to a specific user
 * @returns Array of profiles that would be converted
 */
export async function checkOpenRouterProfiles(userId?: string): Promise<Array<{
  id: string
  name: string
  baseUrl: string | null
  userId: string
}>> {
  const jsonStore = new JsonStore()
  const repo = new ConnectionProfilesRepository(jsonStore)
  const profilesToConvert: Array<{
    id: string
    name: string
    baseUrl: string | null
    userId: string
  }> = []

  const profiles = userId
    ? await repo.findByUserId(userId)
    : await repo.findAll()

  for (const profile of profiles) {
    if (profile.provider === 'OPENAI_COMPATIBLE' && isOpenRouterEndpoint(profile.baseUrl)) {
      profilesToConvert.push({
        id: profile.id,
        name: profile.name,
        baseUrl: profile.baseUrl ?? null,
        userId: profile.userId,
      })
    }
  }

  return profilesToConvert
}
