'use client'

import { createContext, useContext } from 'react'
import type { QtapUriParts } from '@/lib/doc-edit/qtap-uri'

export type QtapTargetKind = 'document' | 'image' | 'other'

export interface QtapTargetResolution {
  exists: boolean
  kind: QtapTargetKind
}

export interface QtapLinkOpener {
  resolve: (parts: QtapUriParts) => Promise<QtapTargetResolution>
  open: (parts: QtapUriParts, resolution: QtapTargetResolution, href: string) => void
}

export const QtapLinkContext = createContext<QtapLinkOpener | null>(null)

export function useQtapLink(): QtapLinkOpener | null {
  return useContext(QtapLinkContext)
}