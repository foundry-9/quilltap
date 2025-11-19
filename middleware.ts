/**
 * Next.js Middleware for rate limiting and security
 * Runs on Edge Runtime before requests reach API routes
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  checkRateLimit,
  getClientIdentifier,
  RATE_LIMITS,
  createRateLimitResponse,
} from './lib/rate-limit';

/**
 * Security headers to add to all responses
 */
const securityHeaders = {
  // Prevent clickjacking
  'X-Frame-Options': 'SAMEORIGIN',
  // Prevent MIME type sniffing
  'X-Content-Type-Options': 'nosniff',
  // Enable XSS protection
  'X-XSS-Protection': '1; mode=block',
  // Referrer policy
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Permissions policy
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  // Content Security Policy
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // Next.js requires unsafe-eval
    "style-src 'self' 'unsafe-inline'", // Tailwind requires unsafe-inline
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

/**
 * Paths that should be rate limited
 */
const RATE_LIMITED_PATHS = {
  api: /^\/api\//,
  auth: /^\/api\/auth\//,
  chat: /^\/api\/chats\/[^/]+\/messages/,
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();

  // Add security headers to all responses
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // Apply rate limiting based on path
  const clientId = getClientIdentifier(request);

  // Chat endpoints (streaming) - special rate limit
  if (RATE_LIMITED_PATHS.chat.test(pathname)) {
    const result = checkRateLimit(clientId, RATE_LIMITS.chat);
    if (!result.success) {
      return createRateLimitResponse(result);
    }
    // Add rate limit headers
    response.headers.set('X-RateLimit-Limit', result.limit.toString());
    response.headers.set('X-RateLimit-Remaining', result.remaining.toString());
    response.headers.set('X-RateLimit-Reset', result.reset.toString());
  }
  // Auth endpoints - strict rate limit
  else if (RATE_LIMITED_PATHS.auth.test(pathname)) {
    const result = checkRateLimit(clientId, RATE_LIMITS.auth);
    if (!result.success) {
      return createRateLimitResponse(result);
    }
    response.headers.set('X-RateLimit-Limit', result.limit.toString());
    response.headers.set('X-RateLimit-Remaining', result.remaining.toString());
    response.headers.set('X-RateLimit-Reset', result.reset.toString());
  }
  // Other API endpoints - normal rate limit
  else if (RATE_LIMITED_PATHS.api.test(pathname)) {
    const result = checkRateLimit(clientId, RATE_LIMITS.api);
    if (!result.success) {
      return createRateLimitResponse(result);
    }
    response.headers.set('X-RateLimit-Limit', result.limit.toString());
    response.headers.set('X-RateLimit-Remaining', result.remaining.toString());
    response.headers.set('X-RateLimit-Reset', result.reset.toString());
  }

  return response;
}

/**
 * Configure which routes the middleware should run on
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public directory)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
