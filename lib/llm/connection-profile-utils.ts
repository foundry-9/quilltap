/**
 * Connection Profile Utilities
 *
 * Helper functions for working with connection profiles,
 * including attachment support information.
 */

import { ConnectionProfile } from '@/lib/json-store/schemas/types'
import {
  getSupportedMimeTypes,
  supportsFileAttachments,
  supportsMimeType,
  getSupportedFileTypes,
  getAttachmentSupportDescription,
} from './attachment-support'

/**
 * Extended connection profile with attachment support information
 */
export interface ConnectionProfileWithAttachmentSupport extends ConnectionProfile {
  /**
   * MIME types supported for file attachments (empty array if none)
   */
  supportedMimeTypes: string[]

  /**
   * Whether this profile supports any file attachments
   */
  supportsFileAttachments: boolean

  /**
   * Categorized file type support
   */
  supportedFileTypes: {
    images: string[]
    documents: string[]
    text: string[]
    all: string[]
  }

  /**
   * Human-readable description of attachment support
   */
  attachmentSupportDescription: string
}

/**
 * Enrich a connection profile with attachment support information
 *
 * @param profile The connection profile
 * @returns Connection profile with attachment support metadata
 */
export function enrichConnectionProfileWithAttachmentSupport(
  profile: ConnectionProfile
): ConnectionProfileWithAttachmentSupport {
  const supportedMimeTypes = getSupportedMimeTypes(profile.provider, profile.baseUrl ?? undefined)
  const supportedFileTypes = getSupportedFileTypes(profile.provider, profile.baseUrl ?? undefined)
  const attachmentSupportDescription = getAttachmentSupportDescription(
    profile.provider,
    profile.baseUrl ?? undefined
  )

  return {
    ...profile,
    supportedMimeTypes,
    supportsFileAttachments: supportedMimeTypes.length > 0,
    supportedFileTypes,
    attachmentSupportDescription,
  }
}

/**
 * Enrich multiple connection profiles with attachment support information
 *
 * @param profiles Array of connection profiles
 * @returns Array of enriched connection profiles
 */
export function enrichConnectionProfiles(
  profiles: ConnectionProfile[]
): ConnectionProfileWithAttachmentSupport[] {
  return profiles.map(enrichConnectionProfileWithAttachmentSupport)
}

/**
 * Check if a connection profile supports a specific MIME type
 *
 * @param profile The connection profile
 * @param mimeType The MIME type to check
 * @returns true if the profile supports this MIME type
 */
export function profileSupportsMimeType(
  profile: ConnectionProfile,
  mimeType: string
): boolean {
  return supportsMimeType(profile.provider, mimeType, profile.baseUrl ?? undefined)
}

/**
 * Filter connection profiles that support file attachments
 *
 * @param profiles Array of connection profiles
 * @returns Array of profiles that support file attachments
 */
export function filterProfilesWithAttachmentSupport(
  profiles: ConnectionProfile[]
): ConnectionProfile[] {
  return profiles.filter(profile =>
    supportsFileAttachments(profile.provider, profile.baseUrl ?? undefined)
  )
}

/**
 * Filter connection profiles that support a specific MIME type
 *
 * @param profiles Array of connection profiles
 * @param mimeType The MIME type to filter by
 * @returns Array of profiles that support this MIME type
 */
export function filterProfilesBySupportedMimeType(
  profiles: ConnectionProfile[],
  mimeType: string
): ConnectionProfile[] {
  return profiles.filter(profile => profileSupportsMimeType(profile, mimeType))
}

/**
 * Get the best connection profile for a file based on MIME type
 * Prioritizes profiles marked as default, then by creation date
 *
 * @param profiles Array of connection profiles
 * @param mimeType The MIME type of the file
 * @returns Best matching profile or null if none support the file type
 */
export function getBestProfileForFile(
  profiles: ConnectionProfile[],
  mimeType: string
): ConnectionProfile | null {
  const supportingProfiles = filterProfilesBySupportedMimeType(profiles, mimeType)

  if (supportingProfiles.length === 0) {
    return null
  }

  // Prioritize default profile
  const defaultProfile = supportingProfiles.find(p => p.isDefault)
  if (defaultProfile) {
    return defaultProfile
  }

  // Return most recently created profile
  return supportingProfiles.sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return dateB - dateA
  })[0]
}

/**
 * Group connection profiles by their attachment support capabilities
 *
 * @param profiles Array of connection profiles
 * @returns Object with profiles grouped by support type
 */
export function groupProfilesByAttachmentSupport(profiles: ConnectionProfile[]): {
  supportsImages: ConnectionProfile[]
  supportsDocuments: ConnectionProfile[]
  supportsText: ConnectionProfile[]
  supportsAny: ConnectionProfile[]
  supportsNone: ConnectionProfile[]
} {
  const supportsImages: ConnectionProfile[] = []
  const supportsDocuments: ConnectionProfile[] = []
  const supportsText: ConnectionProfile[] = []
  const supportsAny: ConnectionProfile[] = []
  const supportsNone: ConnectionProfile[] = []

  for (const profile of profiles) {
    const fileTypes = getSupportedFileTypes(profile.provider, profile.baseUrl ?? undefined)

    if (fileTypes.all.length === 0) {
      supportsNone.push(profile)
    } else {
      supportsAny.push(profile)

      if (fileTypes.images.length > 0) {
        supportsImages.push(profile)
      }
      if (fileTypes.documents.length > 0) {
        supportsDocuments.push(profile)
      }
      if (fileTypes.text.length > 0) {
        supportsText.push(profile)
      }
    }
  }

  return {
    supportsImages,
    supportsDocuments,
    supportsText,
    supportsAny,
    supportsNone,
  }
}
