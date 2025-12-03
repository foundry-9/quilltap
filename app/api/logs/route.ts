// Logs API: Receive browser logs
// POST /api/logs - Receive and store browser logs with rate limiting
// Allows both authenticated and unauthenticated requests for client-side logging

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { logger } from '@/lib/logger'
import { z } from 'zod'

// Validation schema for browser logs
const browserLogSchema = z.object({
  level: z.enum(['error', 'warn', 'info', 'debug']),
  message: z.string().max(1000, 'Message must be 1000 characters or less'),
  context: z.record(z.any()).optional(),
  timestamp: z.union([z.string(), z.number()]), // Accept both string and number timestamps
})

// Schema for batch log requests
const batchLogSchema = z.object({
  logs: z.array(browserLogSchema).min(1).max(50), // Max 50 logs per batch
})

type BrowserLog = z.infer<typeof browserLogSchema>

// Simple in-memory rate limiting: maps identifier -> { count, resetTime }
const rateLimitStore = new Map<
  string,
  {
    count: number
    resetTime: number
  }
>()

const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute in milliseconds
const RATE_LIMIT_MAX_AUTHENTICATED = 100 // 100 logs per minute for authenticated users
const RATE_LIMIT_MAX_ANONYMOUS = 20 // 20 logs per minute for anonymous users

/**
 * Get client identifier for rate limiting
 * Uses user ID if authenticated, otherwise IP address
 */
function getClientIdentifier(req: NextRequest, userId?: string): string {
  if (userId) {
    return `user:${userId}`;
  }
  // Use IP address for anonymous users
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  return `ip:${ip}`;
}

/**
 * Check and update rate limit for a client
 * Returns true if within limit, false if exceeded
 */
function checkRateLimit(identifier: string, isAuthenticated: boolean): boolean {
  const now = Date.now()
  const limit = rateLimitStore.get(identifier)
  const maxLimit = isAuthenticated ? RATE_LIMIT_MAX_AUTHENTICATED : RATE_LIMIT_MAX_ANONYMOUS;

  if (!limit || now > limit.resetTime) {
    // Create new rate limit window
    rateLimitStore.set(identifier, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW,
    })
    return true
  }

  if (limit.count >= maxLimit) {
    return false
  }

  // Increment counter
  limit.count++
  return true
}

// POST /api/logs - Receive browser logs
export async function POST(req: NextRequest) {
  // Check authentication (optional - anonymous logging is allowed)
  const session = await getServerSession()
  const isAuthenticated = !!(session?.user?.id && session?.user?.email)
  const userId = session?.user?.id
  const userEmail = session?.user?.email

  try {
    // Get client identifier for rate limiting
    const clientId = getClientIdentifier(req, userId)

    // Check rate limit (stricter for anonymous users)
    if (!checkRateLimit(clientId, isAuthenticated)) {
      const maxLimit = isAuthenticated ? RATE_LIMIT_MAX_AUTHENTICATED : RATE_LIMIT_MAX_ANONYMOUS
      return NextResponse.json(
        { error: `Rate limit exceeded: maximum ${maxLimit} logs per minute` },
        { status: 429 }
      )
    }

    // Parse and validate request body
    const body = await req.json()

    // Try to parse as batch first, then fall back to single log
    let logs: BrowserLog[]
    const batchResult = batchLogSchema.safeParse(body)
    if (batchResult.success) {
      logs = batchResult.data.logs
    } else {
      // Try parsing as single log
      const singleLog = browserLogSchema.parse(body)
      logs = [singleLog]
    }

    // Log each message using the logger
    for (const validatedLog of logs) {
      const logContext: Record<string, unknown> = {
        source: 'browser',
        authenticated: isAuthenticated,
      }

      // Add user info if authenticated
      if (isAuthenticated) {
        logContext.userId = userId
        logContext.userEmail = userEmail
      } else {
        logContext.clientId = clientId
      }

      // Add optional context if present
      if (validatedLog.context) {
        Object.assign(logContext, validatedLog.context)
      }

      switch (validatedLog.level) {
        case 'error':
          logger.error(validatedLog.message, logContext)
          break
        case 'warn':
          logger.warn(validatedLog.message, logContext)
          break
        case 'info':
          logger.info(validatedLog.message, logContext)
          break
        case 'debug':
          logger.debug(validatedLog.message, logContext)
          break
      }
    }

    return NextResponse.json({ success: true, count: logs.length }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }

    logger.error('Error processing browser log', {
      source: 'browser',
      userId: userId || 'anonymous',
    }, error instanceof Error ? error : undefined)

    return NextResponse.json(
      { error: 'Failed to process log' },
      { status: 500 }
    )
  }
}
