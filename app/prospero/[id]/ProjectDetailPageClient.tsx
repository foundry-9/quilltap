'use client'

/**
 * Legacy-shell body for the Project Detail route (workspace disabled). The
 * workspace path renders {@link ProjectDetailView} in place inside the Prospero
 * tab instead.
 */

import { useRouter } from 'next/navigation'
import { ProjectDetailView } from './ProjectDetailView'

export function ProjectDetailPageClient({ projectId }: { projectId: string }) {
  const router = useRouter()
  return <ProjectDetailView projectId={projectId} onBack={() => router.push('/prospero')} />
}
