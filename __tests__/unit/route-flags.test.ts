/**
 * Route flag helper tests
 */

import { describe, it, expect } from '@jest/globals'
import { getRouteFlags, routeSupportsDebug } from '@/lib/navigation/route-flags'

describe('route flag helpers', () => {
  it('returns debug support for chat conversation routes', () => {
    expect(routeSupportsDebug('/chats/123')).toBe(true)
    expect(getRouteFlags('/chats/abc').supportsDebug).toBe(true)
  })

  it('disables debug support for other routes', () => {
    expect(routeSupportsDebug('/dashboard')).toBe(false)
    expect(routeSupportsDebug('/chats')).toBe(false)
  })

  it('handles undefined or empty pathnames gracefully', () => {
    expect(routeSupportsDebug(undefined)).toBe(false)
    expect(routeSupportsDebug(null)).toBe(false)
    expect(routeSupportsDebug('')).toBe(false)
  })
})
