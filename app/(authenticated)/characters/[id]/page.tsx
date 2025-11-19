'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function CharacterRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  useEffect(() => {
    // Redirect to view mode by default
    router.replace(`/characters/${id}/view`)
  }, [id, router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-lg text-gray-900 dark:text-white">Loading...</p>
    </div>
  )
}
