'use client'

/**
 * Legacy-shell body for the Document Store Detail route (workspace disabled).
 * The workspace path renders {@link DocumentStoreDetailView} in place inside
 * the Scriptorium tab instead. The route owns the subsystem background; in-tab
 * the workspace backdrop does.
 */

import { useRouter } from 'next/navigation'
import { useSubsystemBackgroundStyle } from '@/components/providers/theme-provider'
import { DocumentStoreDetailView } from './DocumentStoreDetailView'

export function DocumentStoreDetailPageClient({ storeId }: { storeId: string }) {
  const router = useRouter()
  const bgStyle = useSubsystemBackgroundStyle('scriptorium')
  return (
    <DocumentStoreDetailView
      storeId={storeId}
      onBack={() => router.push('/scriptorium')}
      style={bgStyle}
    />
  )
}
