/**
 * Route flag helper tests
 */

import { describe, it, expect } from '@jest/globals'
import { getRouteFlags } from '@/lib/navigation/route-flags'

describe('route flag helpers', () => {
  it('returns debug support for chat conversation routes', () => {
    expect(getRouteFlags('/salon/123').supportsDebug).toBe(true)
    expect(getRouteFlags('/salon/abc').supportsDebug).toBe(true)
  })

  it('disables debug support for other routes', () => {
    expect(getRouteFlags('/').supportsDebug).toBe(false)
    expect(getRouteFlags('/salon').supportsDebug).toBe(false)
  })

  it('handles undefined or empty pathnames gracefully', () => {
    expect(getRouteFlags(undefined).supportsDebug).toBe(false)
    expect(getRouteFlags(null).supportsDebug).toBe(false)
    expect(getRouteFlags('').supportsDebug).toBe(false)
  })
})
