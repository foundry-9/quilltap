/**
 * Next.js Proxy
 * Phase 0.3: Core Infrastructure
 *
 * Handles security headers, CORS, and request preprocessing
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Proxy runs on all requests
 * Use matcher to specify which routes to run on
 */
export function proxy(request: NextRequest) {
  const response = NextResponse.next()

  // Security headers
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  // Content Security Policy (basic)
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' data:; " +
    "connect-src 'self' https://api.openai.com https://api.anthropic.com https://openrouter.ai;"
  )

  // CORS headers for API routes
  if (request.nextUrl.pathname.startsWith('/api/')) {
    // Allow same-origin requests
    response.headers.set('Access-Control-Allow-Origin', request.headers.get('origin') || '*')
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    response.headers.set('Access-Control-Allow-Credentials', 'true')

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, { status: 204, headers: response.headers })
    }
  }

  return response
}

/**
 * Configure which routes the proxy runs on
 * This matcher runs proxy on all routes except static assets
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
