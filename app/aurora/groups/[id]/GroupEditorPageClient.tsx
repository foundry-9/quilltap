'use client'

/**
 * Legacy-shell body for the Group Editor route (workspace disabled). The
 * workspace path renders {@link GroupDetailView} in place inside the Aurora
 * tab instead.
 */

import { useRouter } from 'next/navigation'
import { GroupDetailView } from './GroupDetailView'

export function GroupEditorPageClient({ groupId }: { groupId: string }) {
  const router = useRouter()
  return <GroupDetailView groupId={groupId} onBack={() => router.push('/aurora')} />
}
