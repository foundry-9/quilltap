/**
 * Standardized API Response Helpers
 *
 * Provides consistent response formatting across all API routes.
 * Consolidates error response patterns and ensures uniform API shape.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * Standard error response shape
 */
export interface ErrorResponse {
  error: string;
  details?: unknown;
}

/**
 * Create an error response with standard formatting
 *
 * @param message - Error message
 * @param status - HTTP status code (default: 500)
 * @param details - Optional additional error details
 * @returns NextResponse with error JSON
 *
 * @example
 * ```ts
 * // Simple error
 * return errorResponse('Resource not found', 404);
 *
 * // With details
 * return errorResponse('Validation failed', 400, { field: 'email' });
 * ```
 */
export function errorResponse(
  message: string,
  status: number = 500,
  details?: unknown
): NextResponse<ErrorResponse> {
  const body: ErrorResponse = { error: message };

  if (details !== undefined) {
    body.details = details;
  }

  return NextResponse.json(body, { status });
}

/**
 * Create a success response with data
 *
 * @param data - Response data
 * @param status - HTTP status code (default: 200)
 * @returns NextResponse with data JSON
 *
 * @example
 * ```ts
 * const character = await repos.characters.findById(id);
 * return successResponse({ character });
 * ```
 */
export function successResponse<T>(
  data: T,
  status: number = 200
): NextResponse<T> {
  return NextResponse.json(data, { status });
}

/**
 * Create a success response with just a message
 *
 * @param message - Success message
 * @param status - HTTP status code (default: 200)
 * @returns NextResponse with message JSON
 *
 * @example
 * ```ts
 * await repos.characters.delete(id);
 * return messageResponse('Character deleted successfully');
 * ```
 */
export function messageResponse(
  message: string,
  status: number = 200
): NextResponse<{ message: string }> {
  return NextResponse.json({ message }, { status });
}

/**
 * Create a validation error response from Zod errors
 *
 * @param zodError - The Zod validation error
 * @returns NextResponse with 400 status and error details
 *
 * @example
 * ```ts
 * try {
 *   const data = schema.parse(body);
 * } catch (error) {
 *   if (error instanceof z.ZodError) {
 *     return validationError(error);
 *   }
 *   throw error;
 * }
 * ```
 */
export function validationError(
  zodError: z.ZodError
): NextResponse<ErrorResponse> {
  return NextResponse.json(
    {
      error: 'Validation error',
      details: zodError.issues,
    },
    { status: 400 }
  );
}

/**
 * Create an unauthorized response
 *
 * @param message - Optional custom message (default: 'Unauthorized')
 * @returns NextResponse with 401 status
 */
export function unauthorized(
  message: string = 'Unauthorized'
): NextResponse<ErrorResponse> {
  return errorResponse(message, 401);
}

/**
 * Create a forbidden response
 *
 * @param message - Optional custom message (default: 'Forbidden')
 * @returns NextResponse with 403 status
 */
export function forbidden(
  message: string = 'Forbidden'
): NextResponse<ErrorResponse> {
  return errorResponse(message, 403);
}

/**
 * Create a not found response
 *
 * @param resource - Optional resource type for message (e.g., 'Character')
 * @returns NextResponse with 404 status
 */
export function notFound(
  resource?: string
): NextResponse<ErrorResponse> {
  const message = resource ? `${resource} not found` : 'Not found';
  return errorResponse(message, 404);
}

/**
 * Create a conflict response
 *
 * @param message - Conflict description
 * @returns NextResponse with 409 status
 */
export function conflict(
  message: string
): NextResponse<ErrorResponse> {
  return errorResponse(message, 409);
}

/**
 * Create a bad request response
 *
 * @param message - Error description
 * @param details - Optional additional details
 * @returns NextResponse with 400 status
 */
export function badRequest(
  message: string,
  details?: unknown
): NextResponse<ErrorResponse> {
  return errorResponse(message, 400, details);
}

/**
 * Create an internal server error response
 *
 * @param message - Optional custom message (default: 'Internal server error')
 * @returns NextResponse with 500 status
 */
export function serverError(
  message: string = 'Internal server error'
): NextResponse<ErrorResponse> {
  return errorResponse(message, 500);
}

/**
 * Create a created response (201)
 *
 * @param data - The created resource data
 * @returns NextResponse with 201 status
 *
 * @example
 * ```ts
 * const character = await repos.characters.create(data);
 * return created({ character });
 * ```
 */
export function created<T>(data: T): NextResponse<T> {
  return NextResponse.json(data, { status: 201 });
}

/**
 * Create a no content response (204)
 *
 * @returns NextResponse with 204 status and no body
 */
export function noContent(): NextResponse<null> {
  return new NextResponse(null, { status: 204 });
}

/**
 * Wrap an async handler with standard error handling
 *
 * Catches errors and returns appropriate error responses.
 * Handles Zod validation errors specially.
 *
 * @param handler - Async handler function
 * @param errorMessage - Message for unhandled errors
 * @returns The handler result or error response
 *
 * @example
 * ```ts
 * export async function POST(req: NextRequest) {
 *   return withErrorHandling(async () => {
 *     const body = await req.json();
 *     const data = schema.parse(body);
 *     const result = await someOperation(data);
 *     return successResponse(result);
 *   }, 'Failed to create resource');
 * }
 * ```
 */
export async function withErrorHandling(
  handler: () => Promise<NextResponse>,
  errorMessage: string = 'Operation failed'
): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return validationError(error);
    }

    // Log would be done by caller typically
    return serverError(errorMessage);
  }
}

// =============================================================================
// Deprecation & Redirect Utilities
// =============================================================================
// Part of the API consolidation effort (v1 REST API structure).
// These utilities help transition from old routes to new /api/v1/* routes.

/**
 * Deprecation info for response headers
 */
export interface DeprecationInfo {
  /** ISO date string when the old route will be removed */
  sunsetDate: string;
  /** URL to documentation about the migration */
  docsUrl?: string;
  /** Replacement endpoint path */
  replacement?: string;
}

/**
 * Create a permanent redirect response for deprecated routes
 *
 * Returns a 308 Permanent Redirect with deprecation headers.
 * Use this for routes that have moved to a new location.
 *
 * @param newUrl - The new URL to redirect to
 * @param deprecation - Optional deprecation metadata
 * @returns NextResponse with 308 status and redirect headers
 *
 * @example
 * ```ts
 * // Old route: /api/characters/[id]/memories
 * // New route: /api/v1/memories?characterId=[id]
 *
 * export const GET = async (req, { params }) => {
 *   const { id } = await params;
 *   const newUrl = `/api/v1/memories?characterId=${id}`;
 *   return deprecatedRedirect(newUrl, {
 *     sunsetDate: '2026-04-01',
 *     docsUrl: '/docs/api-v1-migration',
 *     replacement: '/api/v1/memories',
 *   });
 * };
 * ```
 */
export function deprecatedRedirect(
  newUrl: string,
  deprecation?: DeprecationInfo
): NextResponse {
  const headers: HeadersInit = {
    Location: newUrl,
  };

  if (deprecation) {
    // RFC 8594 Sunset header
    if (deprecation.sunsetDate) {
      headers['Sunset'] = new Date(deprecation.sunsetDate).toUTCString();
    }

    // Deprecation header (draft standard)
    headers['Deprecation'] = 'true';

    // Link header for documentation
    const links: string[] = [];
    if (deprecation.docsUrl) {
      links.push(`<${deprecation.docsUrl}>; rel="deprecation"`);
    }
    if (deprecation.replacement) {
      links.push(`<${deprecation.replacement}>; rel="successor-version"`);
    }
    if (links.length > 0) {
      headers['Link'] = links.join(', ');
    }
  }

  return new NextResponse(null, {
    status: 308, // Permanent Redirect (preserves method)
    headers,
  });
}

/**
 * Create deprecation headers for routes that still work but are deprecated
 *
 * Add these headers to responses from deprecated routes that haven't
 * been fully migrated yet.
 *
 * @param response - The original response
 * @param deprecation - Deprecation metadata
 * @returns New response with deprecation headers added
 *
 * @example
 * ```ts
 * // Route still works but is deprecated
 * export const GET = createContextHandler(async (req, { user, repos }) => {
 *   const characters = await repos.characters.findByUserId(user.id);
 *   const response = NextResponse.json({ characters });
 *   return withDeprecationHeaders(response, {
 *     sunsetDate: '2026-04-01',
 *     replacement: '/api/v1/characters',
 *   });
 * });
 * ```
 */
export function withDeprecationHeaders(
  response: NextResponse,
  deprecation: DeprecationInfo
): NextResponse {
  // Clone response to add headers
  const newResponse = new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });

  // Add deprecation headers
  if (deprecation.sunsetDate) {
    newResponse.headers.set('Sunset', new Date(deprecation.sunsetDate).toUTCString());
  }

  newResponse.headers.set('Deprecation', 'true');

  const links: string[] = [];
  if (deprecation.docsUrl) {
    links.push(`<${deprecation.docsUrl}>; rel="deprecation"`);
  }
  if (deprecation.replacement) {
    links.push(`<${deprecation.replacement}>; rel="successor-version"`);
  }
  if (links.length > 0) {
    newResponse.headers.set('Link', links.join(', '));
  }

  return newResponse;
}

/**
 * Build a redirect URL preserving query parameters
 *
 * Useful for redirecting from old routes to new routes while
 * maintaining any query parameters from the original request.
 *
 * @param request - The original request
 * @param newBasePath - The new base path to redirect to
 * @param paramMapping - Optional mapping of old param names to new ones
 * @returns Full URL string with query parameters
 *
 * @example
 * ```ts
 * // Redirect /api/characters/[id]/memories?limit=10
 * // to /api/v1/memories?characterId=[id]&limit=10
 *
 * const newUrl = buildRedirectUrl(request, '/api/v1/memories', {
 *   // Inject characterId from route param
 *   additionalParams: { characterId: id }
 * });
 * ```
 */
export function buildRedirectUrl(
  request: Request,
  newBasePath: string,
  options?: {
    /** Additional parameters to add to the URL */
    additionalParams?: Record<string, string>;
    /** Parameters to exclude from the redirect */
    excludeParams?: string[];
    /** Mapping of old param names to new names */
    renameParams?: Record<string, string>;
  }
): string {
  const originalUrl = new URL(request.url);
  const newUrl = new URL(newBasePath, originalUrl.origin);

  // Copy query parameters with optional transformations
  originalUrl.searchParams.forEach((value, key) => {
    // Skip excluded params
    if (options?.excludeParams?.includes(key)) {
      return;
    }

    // Rename if mapping exists, otherwise keep original name
    const newKey = options?.renameParams?.[key] ?? key;
    newUrl.searchParams.set(newKey, value);
  });

  // Add additional parameters
  if (options?.additionalParams) {
    for (const [key, value] of Object.entries(options.additionalParams)) {
      newUrl.searchParams.set(key, value);
    }
  }

  return newUrl.pathname + newUrl.search;
}

/**
 * Deprecation info for the v1 API migration (completed in v2.8)
 *
 * Legacy routes have been removed. This constant is retained for reference
 * and potential use with any future deprecation headers.
 */
export const V1_MIGRATION_DEPRECATION: DeprecationInfo = {
  sunsetDate: '2026-01-30', // Migration completed
  docsUrl: '/docs/api-v1-migration',
};
