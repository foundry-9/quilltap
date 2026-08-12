'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { parseQtapUri, type QtapUriParts } from '@/lib/doc-edit/qtap-uri'
import { Icon } from '@/components/ui/icon'
import { useQtapLink } from './QtapLinkContext'

export function QtapLink({ href, children }: { href: string; children: ReactNode }) {
  const ctx = useQtapLink()

  const parts = useMemo<QtapUriParts | null>(() => {
    try {
      return parseQtapUri(href)
    } catch {
      return null
    }
  }, [href])

  const [result, setResult] = useState<{
    href: string
    resolution: { exists: boolean; kind: 'document' | 'image' | 'other' }
  } | null>(null)

  useEffect(() => {
    if (!parts || !ctx) return
    let cancelled = false
    ctx
      .resolve(parts)
      .then((resolution) => {
        if (!cancelled) setResult({ href, resolution })
      })
      .catch(() => {
        if (!cancelled) {
          setResult({ href, resolution: { exists: false, kind: 'other' } })
        }
      })
    return () => {
      cancelled = true
    }
  }, [parts, ctx, href])

  if (!parts) return <>{children}</>

  const resolution = result && result.href === href ? result.resolution : null

  if (!ctx || resolution?.exists !== true) {
    return (
      <span className="qt-qtap-doc qt-qtap-doc--inert">
        <Icon name="file" className="qt-qtap-doc-icon" />
        {children}
      </span>
    )
  }

  const title =
    resolution.kind === 'image'
      ? `Open ${href} in the image viewer`
      : resolution.kind === 'document'
        ? `Open ${href} in Document Mode`
        : `Try to open ${href}`

  return (
    <a
      href={href}
      className="qt-link qt-qtap-doc"
      title={title}
      onClick={(e) => {
        e.preventDefault()
        ctx.open(parts, resolution, href)
      }}
    >
      <Icon name="file" className="qt-qtap-doc-icon" />
      {children}
    </a>
  )
}