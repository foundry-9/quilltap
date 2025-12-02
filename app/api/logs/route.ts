// Logs API: Receive browser logs
// POST /api/logs - Receive and store browser logs with authentication and rate limiting

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
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

// Simple in-memory rate limiting: maps userId -> { count, resetTime }
const rateLimitStore = new Map<
  string,
  {
    count: number
    resetTime: number
  }
>()

const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute in milliseconds
const RATE_LIMIT_MAX = 100 // 100 logs per minute

/**
 * Check and update rate limit for a user
 * Returns true if within limit, false if exceeded
 */
function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const userLimit = rateLimitStore.get(userId)

  if (!userLimit || now > userLimit.resetTime) {
    // Create new rate limit window
    rateLimitStore.set(userId, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW,
    })
    return true
  }

  if (userLimit.count >= RATE_LIMIT_MAX) {
    return false
  }

  // Increment counter
  userLimit.count++
  return true
}

// POST /api/logs - Receive browser logs
export async function POST(req: NextRequest) {
  // Check authentication (outside try to be accessible in catch)
  const session = await getServerSession(authOptions)

  try {
    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Check rate limit
    if (!checkRateLimit(userId)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded: maximum 100 logs per minute' },
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
      const logContext: Record<string, any> = {
        source: 'browser',
        userId,
        userEmail: session.user.email,
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
      userId: session?.user?.id || 'unknown',
    }, error instanceof Error ? error : undefined)

    return NextResponse.json(
      { error: 'Failed to process log' },
      { status: 500 }
    )
  }
}
