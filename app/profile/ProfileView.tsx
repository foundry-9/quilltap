'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { getErrorMessage } from '@/lib/error-utils'
import {
  ProfileInfoSection,
  ProfileEditSection,
  DataDirectorySection,
  UserProfile,
} from '@/components/profile'

/**
 * Profile view (single-user mode). Rendered by the `/profile` route and as a
 * workspace tab. Displays and manages user profile information:
 * - Account information (read-only)
 * - Profile settings (editable: name, email, avatar)
 */
export function ProfileView() {
  const { data, isLoading, error: loadError } = useQuery({
    queryKey: queryKeys.userProfile.detail,
    queryFn: ({ signal }) => apiFetch<{ profile: UserProfile } | UserProfile>('/api/v1/user/profile', { signal }),
  })
  const profile = (data as any)?.profile || data || null

  const handleProfileUpdate = (updatedProfile: UserProfile) => {
    // Profile will be refreshed by the query on next fetch
  }

  if (isLoading) {
    return (
      <div className="qt-page-container">
        <div className="flex items-center justify-center py-12">
          <div className="qt-text-muted">Loading profile...</div>
        </div>
      </div>
    )
  }

  if (loadError || !profile) {
    return (
      <div className="qt-page-container">
        <div className="qt-alert-error">
          {getErrorMessage(loadError, 'Failed to load profile')}
        </div>
        <Link href="/" className="qt-button qt-button-secondary mt-4 inline-block">
          Return to Home
        </Link>
      </div>
    )
  }

  return (
    <div className="qt-page-container">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/"
          className="mb-4 inline-flex items-center qt-label text-primary transition hover:text-primary/80"
        >
          ← Back to Home
        </Link>
        <h1 className="qt-heading-1">Profile</h1>
        <p className="qt-text-muted mt-2">
          Manage your profile settings
        </p>
      </div>

      <div className="space-y-6">
        {/* Profile Edit Section (editable fields first) */}
        <ProfileEditSection profile={profile} onProfileUpdate={handleProfileUpdate} />

        {/* Account Information (read-only) */}
        <ProfileInfoSection profile={profile} />

        {/* Data Directory Information */}
        <DataDirectorySection />
      </div>
    </div>
  )
}
