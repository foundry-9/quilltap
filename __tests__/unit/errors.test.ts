/**
 * Unit Tests for Error Handling Utilities
 * Tests lib/errors.ts
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { NextResponse } from 'next/server'
import {
  AppError,
  ErrorCode,
  handleError,
  validateRequestBody,
  requireAuth,
  requireOwnership,
  safeJsonParse,
  withErrorHandling,
} from '@/lib/errors'

// Mock NextResponse
jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((body, init) => ({
      body,
      status: init?.status || 200,
      headers: new Headers(),
    })),
  },
}))

describe('AppError', () => {
  it('should create an AppError with all properties', () => {
    const error = new AppError(
      'Test error',
      400,
      ErrorCode.VALIDATION_ERROR,
      { field: 'test' }
    )

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(AppError)
    expect(error.message).toBe('Test error')
    expect(error.statusCode).toBe(400)
    expect(error.code).toBe(ErrorCode.VALIDATION_ERROR)
    expect(error.details).toEqual({ field: 'test' })
    expect(error.name).toBe('AppError')
  })

  it('should default to status 500 and no code', () => {
    const error = new AppError('Internal error')

    expect(error.statusCode).toBe(500)
    expect(error.code).toBeUndefined()
    expect(error.details).toBeUndefined()
  })
})

describe('handleError', () => {
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>

  beforeEach(() => {
    jest.clearAllMocks()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('should handle AppError instances', () => {
    const error = new AppError(
      'Validation failed',
      400,
      ErrorCode.VALIDATION_ERROR,
      { field: 'email' }
    )

    const response = handleError(error)

    expect(NextResponse.json).toHaveBeenCalledWith(
      {
        error: 'Validation failed',
        code: ErrorCode.VALIDATION_ERROR,
        details: { field: 'email' },
      },
      { status: 400 }
    )
  })


  it('should handle standard Error instances in development', () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'

    const error = new Error('Something went wrong')
    const response = handleError(error)

    expect(NextResponse.json).toHaveBeenCalledWith(
      {
        error: 'An unexpected error occurred',
        code: ErrorCode.INTERNAL_ERROR,
        details: 'Something went wrong',
      },
      { status: 500 }
    )

    process.env.NODE_ENV = originalEnv
  })

  it('should handle standard Error instances in production', () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    const error = new Error('Something went wrong')
    const response = handleError(error)

    expect(NextResponse.json).toHaveBeenCalledWith(
      {
        error: 'An unexpected error occurred',
        code: ErrorCode.INTERNAL_ERROR,
      },
      { status: 500 }
    )

    process.env.NODE_ENV = originalEnv
  })

  it('should handle unknown error types', () => {
    const response = handleError('string error')

    expect(NextResponse.json).toHaveBeenCalledWith(
      {
        error: 'An unexpected error occurred',
        code: ErrorCode.INTERNAL_ERROR,
      },
      { status: 500 }
    )
  })

  it('should handle null error', () => {
    const response = handleError(null)

    expect(NextResponse.json).toHaveBeenCalledWith(
      {
        error: 'An unexpected error occurred',
        code: ErrorCode.INTERNAL_ERROR,
      },
      { status: 500 }
    )
  })

  it('should handle undefined error', () => {
    const response = handleError(undefined)

    expect(NextResponse.json).toHaveBeenCalledWith(
      {
        error: 'An unexpected error occurred',
        code: ErrorCode.INTERNAL_ERROR,
      },
      { status: 500 }
    )
  })
})

describe('validateRequestBody', () => {
  it('should pass validation when all required fields are present', () => {
    const body = {
      name: 'John',
      email: 'john@example.com',
      age: 30,
    }

    expect(() => {
      validateRequestBody(body, ['name', 'email'])
    }).not.toThrow()
  })

  it('should throw AppError when a required field is missing', () => {
    const body = {
      name: 'John',
    }

    expect(() => {
      validateRequestBody(body, ['name', 'email'])
    }).toThrow(AppError)

    try {
      validateRequestBody(body, ['name', 'email'])
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      if (error instanceof AppError) {
        expect(error.message).toBe('Missing required fields: email')
        expect(error.statusCode).toBe(400)
        expect(error.code).toBe(ErrorCode.VALIDATION_ERROR)
        expect(error.details).toEqual({ missingFields: ['email'] })
      }
    }
  })

  it('should throw AppError when multiple required fields are missing', () => {
    const body = {
      name: 'John',
    }

    try {
      validateRequestBody(body, ['name', 'email', 'password', 'age'])
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      if (error instanceof AppError) {
        expect(error.message).toBe('Missing required fields: email, password, age')
        expect(error.details).toEqual({ missingFields: ['email', 'password', 'age'] })
      }
    }
  })

  it('should throw AppError when field is null', () => {
    const body = {
      name: 'John',
      email: null,
    }

    expect(() => {
      validateRequestBody(body, ['name', 'email'])
    }).toThrow(AppError)
  })

  it('should throw AppError when field is undefined', () => {
    const body = {
      name: 'John',
      email: undefined,
    }

    expect(() => {
      validateRequestBody(body, ['name', 'email'])
    }).toThrow(AppError)
  })

  it('should throw AppError when field is empty string', () => {
    const body = {
      name: 'John',
      email: '',
    }

    expect(() => {
      validateRequestBody(body, ['name', 'email'])
    }).toThrow(AppError)
  })

  it('should pass when field is 0', () => {
    const body = {
      name: 'John',
      count: 0,
    }

    expect(() => {
      validateRequestBody(body, ['name', 'count'])
    }).not.toThrow()
  })

  it('should pass when field is false', () => {
    const body = {
      name: 'John',
      active: false,
    }

    expect(() => {
      validateRequestBody(body, ['name', 'active'])
    }).not.toThrow()
  })
})

describe('requireAuth', () => {
  it('should return session when user is authenticated', () => {
    const session = {
      user: {
        id: 'user-123',
        email: 'user@example.com',
      },
    }

    const result = requireAuth(session)
    expect(result).toBe(session)
  })

  it('should throw AppError when session is null', () => {
    expect(() => {
      requireAuth(null)
    }).toThrow(AppError)

    try {
      requireAuth(null)
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      if (error instanceof AppError) {
        expect(error.message).toBe('Authentication required')
        expect(error.statusCode).toBe(401)
        expect(error.code).toBe(ErrorCode.UNAUTHORIZED)
      }
    }
  })

  it('should throw AppError when session is undefined', () => {
    expect(() => {
      requireAuth(undefined)
    }).toThrow(AppError)
  })

  it('should throw AppError when session has no user', () => {
    expect(() => {
      requireAuth({})
    }).toThrow(AppError)
  })

  it('should throw AppError when user has no id', () => {
    expect(() => {
      requireAuth({ user: {} })
    }).toThrow(AppError)
  })

  it('should throw AppError when user id is empty string', () => {
    expect(() => {
      requireAuth({ user: { id: '' } })
    }).toThrow(AppError)
  })

  it('should pass when user id is valid', () => {
    const session = { user: { id: 'valid-id' } }
    expect(requireAuth(session)).toBe(session)
  })
})

describe('requireOwnership', () => {
  const userId = 'user-123'

  it('should return resource when user owns it', () => {
    const resource = {
      id: 'resource-1',
      userId: 'user-123',
      name: 'My Resource',
    }

    const result = requireOwnership(resource, userId)
    expect(result).toBe(resource)
  })

  it('should throw NOT_FOUND error when resource is null', () => {
    expect(() => {
      requireOwnership(null, userId)
    }).toThrow(AppError)

    try {
      requireOwnership(null, userId)
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      if (error instanceof AppError) {
        expect(error.message).toBe('Resource not found')
        expect(error.statusCode).toBe(404)
        expect(error.code).toBe(ErrorCode.NOT_FOUND)
      }
    }
  })

  it('should throw NOT_FOUND error when resource is undefined', () => {
    expect(() => {
      requireOwnership(undefined, userId)
    }).toThrow(AppError)
  })

  it('should throw FORBIDDEN error when user does not own resource', () => {
    const resource = {
      id: 'resource-1',
      userId: 'other-user',
      name: 'Other Resource',
    }

    expect(() => {
      requireOwnership(resource, userId)
    }).toThrow(AppError)

    try {
      requireOwnership(resource, userId)
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      if (error instanceof AppError) {
        expect(error.message).toBe('You do not have permission to access this resource')
        expect(error.statusCode).toBe(403)
        expect(error.code).toBe(ErrorCode.FORBIDDEN)
      }
    }
  })

  it('should throw FORBIDDEN error when userId is empty string', () => {
    const resource = {
      id: 'resource-1',
      userId: 'user-123',
    }

    expect(() => {
      requireOwnership(resource, '')
    }).toThrow(AppError)
  })

  it('should handle resource with userId null', () => {
    const resource = {
      id: 'resource-1',
      userId: null,
    }

    expect(() => {
      requireOwnership(resource, userId)
    }).toThrow(AppError)
  })
})

describe('safeJsonParse', () => {
  it('should parse valid JSON', async () => {
    const mockRequest = {
      json: jest.fn().mockResolvedValue({ name: 'John', age: 30 }),
    } as unknown as Request

    const result = await safeJsonParse(mockRequest)
    expect(result).toEqual({ name: 'John', age: 30 })
  })

  it('should throw AppError for invalid JSON', async () => {
    const mockRequest = {
      json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
    } as unknown as Request

    await expect(safeJsonParse(mockRequest)).rejects.toThrow(AppError)

    try {
      await safeJsonParse(mockRequest)
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      if (error instanceof AppError) {
        expect(error.message).toBe('Invalid JSON in request body')
        expect(error.statusCode).toBe(400)
        expect(error.code).toBe(ErrorCode.VALIDATION_ERROR)
      }
    }
  })

  it('should parse empty object', async () => {
    const mockRequest = {
      json: jest.fn().mockResolvedValue({}),
    } as unknown as Request

    const result = await safeJsonParse(mockRequest)
    expect(result).toEqual({})
  })

  it('should parse array', async () => {
    const mockRequest = {
      json: jest.fn().mockResolvedValue([1, 2, 3]),
    } as unknown as Request

    const result = await safeJsonParse(mockRequest)
    expect(result).toEqual([1, 2, 3])
  })

  it('should parse null', async () => {
    const mockRequest = {
      json: jest.fn().mockResolvedValue(null),
    } as unknown as Request

    const result = await safeJsonParse(mockRequest)
    expect(result).toBeNull()
  })
})

describe('withErrorHandling', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('should return handler result when no error occurs', async () => {
    const mockResponse = NextResponse.json({ success: true })
    const handler = jest.fn().mockResolvedValue(mockResponse)
    const wrappedHandler = withErrorHandling(handler)

    const result = await wrappedHandler('arg1', 'arg2')

    expect(handler).toHaveBeenCalledWith('arg1', 'arg2')
    expect(result).toBe(mockResponse)
  })

  it('should handle errors thrown by handler', async () => {
    const error = new AppError('Test error', 400, ErrorCode.VALIDATION_ERROR)
    const handler = jest.fn().mockRejectedValue(error)
    const wrappedHandler = withErrorHandling(handler)

    const result = await wrappedHandler()

    expect(handler).toHaveBeenCalled()
    expect(NextResponse.json).toHaveBeenCalledWith(
      {
        error: 'Test error',
        code: ErrorCode.VALIDATION_ERROR,
        details: undefined,
      },
      { status: 400 }
    )
  })

  it('should handle standard errors', async () => {
    const error = new Error('Standard error')
    const handler = jest.fn().mockRejectedValue(error)
    const wrappedHandler = withErrorHandling(handler)

    await wrappedHandler()

    expect(NextResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'An unexpected error occurred',
        code: ErrorCode.INTERNAL_ERROR,
      }),
      { status: 500 }
    )
  })

  it('should pass through all arguments to handler', async () => {
    const mockResponse = NextResponse.json({ success: true })
    const handler = jest.fn().mockResolvedValue(mockResponse)
    const wrappedHandler = withErrorHandling(handler)

    await wrappedHandler('arg1', { key: 'value' }, 123)

    expect(handler).toHaveBeenCalledWith('arg1', { key: 'value' }, 123)
  })

  it('should preserve handler context', async () => {
    const mockResponse = NextResponse.json({ success: true })
    const context = { data: 'test' }
    const handler = jest.fn(function (this: typeof context) {
      expect(this).toBe(context)
      return Promise.resolve(mockResponse)
    })
    const wrappedHandler = withErrorHandling(handler)

    await wrappedHandler.call(context)
    expect(handler).toHaveBeenCalled()
  })
})
