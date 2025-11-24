/**
 * Error Handling Utilities
 * Phase 0.3: Core Infrastructure
 *
 * Centralized error handling and formatting
 */

import { NextResponse } from 'next/server'

/**
 * Standard error response format
 */
export interface ErrorResponse {
  error: string
  code?: string
  details?: any
}

/**
 * Common error codes
 */
export enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  ENCRYPTION_ERROR = 'ENCRYPTION_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_API_ERROR = 'EXTERNAL_API_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * Custom application error class
 */
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: ErrorCode,
    public details?: any
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/**
 * Error handler that returns formatted JSON response
 */
export function handleError(error: unknown): NextResponse {
  console.error('API Error:', error)

  // Handle AppError instances
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        details: error.details,
      },
      { status: error.statusCode }
    )
  }


  // Handle standard Error instances
  if (error instanceof Error) {
    return NextResponse.json(
      {
        error: 'An unexpected error occurred',
        code: ErrorCode.INTERNAL_ERROR,
        // Don't expose internal error messages in production
        ...(process.env.NODE_ENV === 'development' && { details: error.message }),
      },
      { status: 500 }
    )
  }

  // Fallback for unknown error types
  return NextResponse.json(
    {
      error: 'An unexpected error occurred',
      code: ErrorCode.INTERNAL_ERROR,
    },
    { status: 500 }
  )
}

/**
 * Validate request body against a schema
 * Throws AppError if validation fails
 */
export function validateRequestBody(body: any, requiredFields: string[]) {
  const missingFields = requiredFields.filter(
    field => !(field in body) || body[field] === null || body[field] === undefined || body[field] === ''
  )

  if (missingFields.length > 0) {
    throw new AppError(
      `Missing required fields: ${missingFields.join(', ')}`,
      400,
      ErrorCode.VALIDATION_ERROR,
      { missingFields }
    )
  }
}

/**
 * Ensure user is authenticated
 * Throws AppError if not authenticated
 */
export function requireAuth(session: any) {
  if (!session?.user?.id) {
    throw new AppError(
      'Authentication required',
      401,
      ErrorCode.UNAUTHORIZED
    )
  }
  return session
}

/**
 * Ensure user owns a resource
 * Throws AppError if not owner
 */
export function requireOwnership(resource: any, userId: string) {
  if (!resource) {
    throw new AppError(
      'Resource not found',
      404,
      ErrorCode.NOT_FOUND
    )
  }

  if (resource.userId !== userId) {
    throw new AppError(
      'You do not have permission to access this resource',
      403,
      ErrorCode.FORBIDDEN
    )
  }

  return resource
}

/**
 * Safe JSON parse with error handling
 */
export async function safeJsonParse(req: Request) {
  try {
    return await req.json()
  } catch (error) {
    throw new AppError(
      'Invalid JSON in request body',
      400,
      ErrorCode.VALIDATION_ERROR
    )
  }
}

/**
 * Wrap async route handlers with error handling
 */
export function withErrorHandling(
  handler: (...args: any[]) => Promise<NextResponse>
) {
  return async (...args: any[]): Promise<NextResponse> => {
    try {
      return await handler(...args)
    } catch (error) {
      return handleError(error)
    }
  }
}
