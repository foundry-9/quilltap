'use client'

/**
 * Legacy-shell body for the Character Detail route (workspace disabled). The
 * workspace path opens a `character-view` tab instead. Reads the
 * `?action=chat` deep-link here.
 */

import { useRouter, useSearchParams } from 'next/navigation'
import { CharacterDetailView } from './CharacterDetailView'

export function ViewCharacterPageClient({ characterId, initialTab }: { characterId: string; initialTab?: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  return (
    <CharacterDetailView
      characterId={characterId}
      initialTab={initialTab}
      onBack={() => router.push('/aurora')}
      openChatOnMount={searchParams.get('action') === 'chat'}
    />
  )
}
