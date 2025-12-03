/**
 * Next.js Proxy for rate limiting, security headers, CORS, and auth mode
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
 * Check if authentication is disabled via environment variable
 * Note: This runs in Edge runtime, so we check env var directly
 */
function isAuthDisabledInProxy(): boolean {
  return process.env.AUTH_DISABLED === 'true';
}

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
    "connect-src 'self' https://api.openai.com https://api.anthropic.com https://openrouter.ai",
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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // If auth is disabled, set a header to indicate this to downstream handlers
  const authDisabled = isAuthDisabledInProxy();

  // Apply rate limiting based on path
  const clientId = getClientIdentifier(request);

  // Chat endpoints (streaming) - special rate limit
  if (RATE_LIMITED_PATHS.chat.test(pathname)) {
    const result = checkRateLimit(clientId, RATE_LIMITS.chat);
    if (!result.success) {
      return createRateLimitResponse(result);
    }
  }
  // Auth endpoints - strict rate limit
  else if (RATE_LIMITED_PATHS.auth.test(pathname)) {
    const result = checkRateLimit(clientId, RATE_LIMITS.auth);
    if (!result.success) {
      return createRateLimitResponse(result);
    }
  }
  // Other API endpoints - normal rate limit
  else if (RATE_LIMITED_PATHS.api.test(pathname)) {
    const result = checkRateLimit(clientId, RATE_LIMITS.api);
    if (!result.success) {
      return createRateLimitResponse(result);
    }
  }

  // Handle preflight OPTIONS requests early
  if (pathname.startsWith('/api/') && request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204 });
  }

  // For requests with bodies, use NextResponse.next() without modifying it
  // to avoid locking the request body
  if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
    return NextResponse.next();
  }

  // For requests without bodies, we can safely add headers
  const response = NextResponse.next();

  // Add security headers to all responses
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // If auth is disabled, set a header for downstream handlers to detect
  if (authDisabled) {
    response.headers.set('x-auth-disabled', 'true');
  }

  // CORS headers for API routes
  if (pathname.startsWith('/api/')) {
    response.headers.set('Access-Control-Allow-Origin', request.headers.get('origin') || '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }

  return response;
}

/**
 * Configure which routes the proxy should run on
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public directory)
     * - /api/images (file upload endpoint - incompatible with middleware body handling)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/images|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
