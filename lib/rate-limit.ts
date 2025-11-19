/**
 * Rate limiting implementation using in-memory store
 * For production with multiple instances, consider using Redis
 */

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  Object.keys(store).forEach((key) => {
    if (store[key].resetTime < now) {
      delete store[key];
    }
  });
}, 5 * 60 * 1000);

export interface RateLimitConfig {
  /**
   * Number of requests allowed per window
   */
  maxRequests: number;
  /**
   * Window duration in seconds
   */
  windowSeconds: number;
  /**
   * Custom identifier (defaults to IP address)
   */
  identifier?: string;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

/**
 * Check if a request should be rate limited
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const key = `${identifier}:${config.maxRequests}:${config.windowSeconds}`;

  // Initialize or get existing entry
  if (!store[key] || store[key].resetTime < now) {
    store[key] = {
      count: 0,
      resetTime: now + windowMs,
    };
  }

  const entry = store[key];
  const isAllowed = entry.count < config.maxRequests;

  if (isAllowed) {
    entry.count++;
  }

  return {
    success: isAllowed,
    limit: config.maxRequests,
    remaining: Math.max(0, config.maxRequests - entry.count),
    reset: Math.ceil(entry.resetTime / 1000),
  };
}

/**
 * Get client identifier from request
 */
export function getClientIdentifier(request: Request): string {
  // Try to get real IP from headers (for proxies/load balancers)
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');

  if (forwarded) {
    // x-forwarded-for can be comma-separated list
    return forwarded.split(',')[0].trim();
  }

  if (realIp) {
    return realIp;
  }

  // Fallback to a default identifier
  return 'unknown';
}

/**
 * Rate limit configurations for different endpoint types
 */
export const RATE_LIMITS = {
  // API endpoints: 10 requests per second
  api: {
    maxRequests: parseInt(process.env.RATE_LIMIT_API_MAX || '100'),
    windowSeconds: parseInt(process.env.RATE_LIMIT_API_WINDOW || '10'),
  },
  // Authentication: 5 attempts per minute
  auth: {
    maxRequests: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '5'),
    windowSeconds: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW || '60'),
  },
  // Chat message streaming: 20 messages per minute
  chat: {
    maxRequests: parseInt(process.env.RATE_LIMIT_CHAT_MAX || '20'),
    windowSeconds: parseInt(process.env.RATE_LIMIT_CHAT_WINDOW || '60'),
  },
  // General: 100 requests per minute
  general: {
    maxRequests: parseInt(process.env.RATE_LIMIT_GENERAL_MAX || '100'),
    windowSeconds: parseInt(process.env.RATE_LIMIT_GENERAL_WINDOW || '60'),
  },
} as const;

/**
 * Create rate limit response
 */
export function createRateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Limit': result.limit.toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': result.reset.toString(),
        'Retry-After': Math.ceil((result.reset * 1000 - Date.now()) / 1000).toString(),
      },
    }
  );
}
