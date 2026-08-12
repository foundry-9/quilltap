/**
 * Bare character route — server redirect to view mode (which itself redirects
 * into the workspace when enabled).
 */

import { redirect } from 'next/navigation'

export default async function CharacterRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/aurora/${id}/view`)
}
