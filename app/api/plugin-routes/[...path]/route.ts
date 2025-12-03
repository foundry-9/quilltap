/**
 * Plugin Routes Catch-All Handler
 *
 * Dynamically routes requests to plugin-defined API endpoints.
 * This catch-all route intercepts requests to /api/plugin-routes/[...path]
 * and delegates them to the appropriate plugin handler.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import { findPluginRoute, type PluginRouteInfo } from '@/lib/plugins/route-loader';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface RouteParams {
  params: Promise<{
    path: string[];
  }>;
}

interface PluginRouteHandler {
  GET?: (request: NextRequest, context?: unknown) => Promise<NextResponse>;
  POST?: (request: NextRequest, context?: unknown) => Promise<NextResponse>;
  PUT?: (request: NextRequest, context?: unknown) => Promise<NextResponse>;
  PATCH?: (request: NextRequest, context?: unknown) => Promise<NextResponse>;
  DELETE?: (request: NextRequest, context?: unknown) => Promise<NextResponse>;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extracts error message and stack from an unknown error
 */
function getErrorDetails(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

/**
 * Checks if the user is authenticated
 * Returns the session if authenticated, null otherwise
 */
async function checkAuthentication(
  routeMatch: PluginRouteInfo,
  apiPath: string
): Promise<{ authenticated: true; userId: string } | { authenticated: false; response: NextResponse }> {
  logger.debug('Checking authentication for plugin route', {
    plugin: routeMatch.plugin.manifest.name,
    apiPath,
    requiresAuth: routeMatch.route.requiresAuth,
  });

  // If route doesn't require auth, allow through
  if (!routeMatch.route.requiresAuth) {
    logger.debug('Route does not require authentication', {
      plugin: routeMatch.plugin.manifest.name,
      apiPath,
    });
    return { authenticated: true, userId: '' };
  }

  // Check session
  const session = await getServerSession();

  if (!session?.user?.id) {
    logger.warn('Unauthorized access attempt to authenticated plugin route', {
      plugin: routeMatch.plugin.manifest.name,
      apiPath,
      hasSession: !!session,
      hasUser: !!session?.user,
    });

    return {
      authenticated: false,
      response: NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Authentication required to access this plugin route',
          plugin: routeMatch.plugin.manifest.name,
        },
        { status: 401 }
      ),
    };
  }

  logger.debug('User authenticated for plugin route', {
    plugin: routeMatch.plugin.manifest.name,
    apiPath,
    userId: session.user.id,
  });

  return { authenticated: true, userId: session.user.id };
}

/**
 * Dynamically imports the handler module from a plugin
 * Returns null if the import fails, logging the error
 */
async function loadHandlerModule(
  routeMatch: PluginRouteInfo,
  apiPath: string
): Promise<PluginRouteHandler | null> {
  logger.debug('Loading handler module', {
    handlerPath: routeMatch.handlerPath,
    plugin: routeMatch.plugin.manifest.name,
  });

  try {
    const handlerModule = await import(routeMatch.handlerPath) as PluginRouteHandler;
    logger.debug('Handler module loaded', {
      plugin: routeMatch.plugin.manifest.name,
      exports: Object.keys(handlerModule),
    });
    return handlerModule;
  } catch (importError) {
    const errorDetails = getErrorDetails(importError);
    logger.error('Plugin failed to provide route handler - handler module could not be loaded', {
      handlerPath: routeMatch.handlerPath,
      plugin: routeMatch.plugin.manifest.name,
      routePath: routeMatch.route.path,
      error: errorDetails.message,
      stack: errorDetails.stack,
    });
    return null;
  }
}

/**
 * Invokes the plugin handler and returns the response
 * Returns an error response if the handler throws
 */
async function invokeHandler(
  handler: NonNullable<PluginRouteHandler[HttpMethod]>,
  request: NextRequest,
  routeMatch: PluginRouteInfo,
  method: HttpMethod,
  apiPath: string,
  pathSegments: string[],
  userId: string
): Promise<NextResponse> {
  logger.debug('Invoking plugin handler', {
    plugin: routeMatch.plugin.manifest.name,
    method,
    apiPath,
  });

  try {
    return await handler(request, {
      params: { path: pathSegments },
      plugin: routeMatch.plugin.manifest.name,
      apiPath,
      userId,
    });
  } catch (handlerError) {
    const errorDetails = getErrorDetails(handlerError);
    logger.error('Plugin route handler threw an error during execution', {
      plugin: routeMatch.plugin.manifest.name,
      routePath: routeMatch.route.path,
      method,
      apiPath,
      error: errorDetails.message,
      stack: errorDetails.stack,
    });

    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: `Plugin "${routeMatch.plugin.manifest.name}" handler failed while processing ${method} ${apiPath}`,
        plugin: routeMatch.plugin.manifest.name,
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// COMMON HANDLER
// ============================================================================

/**
 * Common handler for all HTTP methods
 * Routes requests to plugin handlers based on path and method
 */
async function handleRequest(
  request: NextRequest,
  params: RouteParams,
  method: HttpMethod
): Promise<NextResponse> {
  const startTime = Date.now();

  try {
    const { path: pathSegments } = await params.params;
    const apiPath = `/api/${pathSegments.join('/')}`;

    logger.debug('Plugin route request received', { method, pathSegments, url: request.url });

    // Find matching plugin route
    const routeMatch = findPluginRoute(apiPath, method);
    if (!routeMatch) {
      logger.warn('No plugin route found', { apiPath, method });
      return NextResponse.json(
        { error: 'Not Found', message: `No plugin route found for ${method} ${apiPath}`, path: apiPath, method },
        { status: 404 }
      );
    }

    logger.debug('Found matching plugin route', {
      plugin: routeMatch.plugin.manifest.name,
      routePath: routeMatch.route.path,
      methods: routeMatch.route.methods,
    });

    // Check if method is allowed for this route
    if (!routeMatch.route.methods.includes(method)) {
      logger.warn('HTTP method not allowed for plugin route', { apiPath, method, allowedMethods: routeMatch.route.methods });
      return NextResponse.json(
        { error: 'Method Not Allowed', message: `Method ${method} not allowed for route ${apiPath}`, allowedMethods: routeMatch.route.methods },
        { status: 405, headers: { Allow: routeMatch.route.methods.join(', ') } }
      );
    }

    // Authentication check
    const authResult = await checkAuthentication(routeMatch, apiPath);
    if (!authResult.authenticated) {
      return authResult.response;
    }

    // Load the handler module
    const handlerModule = await loadHandlerModule(routeMatch, apiPath);
    if (!handlerModule) {
      return NextResponse.json(
        {
          error: 'Service Unavailable',
          message: `Plugin "${routeMatch.plugin.manifest.name}" failed to provide the route handler for ${apiPath}`,
          plugin: routeMatch.plugin.manifest.name,
        },
        { status: 503 }
      );
    }

    // Get the handler function for this method
    const handler = handlerModule[method];
    if (!handler || typeof handler !== 'function') {
      logger.error('Plugin route handler missing expected method export', {
        plugin: routeMatch.plugin.manifest.name,
        routePath: routeMatch.route.path,
        expectedMethod: method,
        declaredMethods: routeMatch.route.methods,
        availableExports: Object.keys(handlerModule).filter(
          (key) => typeof handlerModule[key as keyof PluginRouteHandler] === 'function'
        ),
      });
      return NextResponse.json(
        {
          error: 'Service Unavailable',
          message: `Plugin "${routeMatch.plugin.manifest.name}" declares ${method} for ${apiPath} but handler does not export it`,
          plugin: routeMatch.plugin.manifest.name,
        },
        { status: 503 }
      );
    }

    // Invoke the handler
    const response = await invokeHandler(handler, request, routeMatch, method, apiPath, pathSegments, authResult.userId);

    const duration = Date.now() - startTime;
    logger.info('Plugin route request completed', {
      plugin: routeMatch.plugin.manifest.name,
      method,
      apiPath,
      statusCode: response.status,
      duration,
    });

    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorDetails = getErrorDetails(error);

    logger.error('Plugin route request failed', { method, error: errorDetails.message, duration });

    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while processing the plugin route',
        details: errorDetails.message,
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// HTTP METHOD HANDLERS
// ============================================================================

/**
 * GET handler - delegates to plugin handler
 */
export async function GET(request: NextRequest, params: RouteParams): Promise<NextResponse> {
  return handleRequest(request, params, 'GET');
}

/**
 * POST handler - delegates to plugin handler
 */
export async function POST(request: NextRequest, params: RouteParams): Promise<NextResponse> {
  return handleRequest(request, params, 'POST');
}

/**
 * PUT handler - delegates to plugin handler
 */
export async function PUT(request: NextRequest, params: RouteParams): Promise<NextResponse> {
  return handleRequest(request, params, 'PUT');
}

/**
 * PATCH handler - delegates to plugin handler
 */
export async function PATCH(request: NextRequest, params: RouteParams): Promise<NextResponse> {
  return handleRequest(request, params, 'PATCH');
}

/**
 * DELETE handler - delegates to plugin handler
 */
export async function DELETE(request: NextRequest, params: RouteParams): Promise<NextResponse> {
  return handleRequest(request, params, 'DELETE');
}

// ============================================================================
// OPTIONS HANDLER (for CORS support)
// ============================================================================

/**
 * OPTIONS handler - returns allowed methods for the route
 */
export async function OPTIONS(request: NextRequest, params: RouteParams): Promise<NextResponse> {
  try {
    const { path: pathSegments } = await params.params;
    const apiPath = `/api/${pathSegments.join('/')}`;

    logger.debug('OPTIONS request received', { apiPath });

    // Try to find the route to get allowed methods
    // We check for each method to build the allowed list
    const methods: string[] = [];

    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const routeMatch = findPluginRoute(apiPath, method as any);
      if (routeMatch && routeMatch.route.methods.includes(method as any)) {
        methods.push(method);
      }
    }

    if (methods.length === 0) {
      logger.debug('No plugin routes found for OPTIONS request', { apiPath });

      return NextResponse.json(
        {
          error: 'Not Found',
          message: `No plugin route found for ${apiPath}`,
        },
        { status: 404 }
      );
    }

    logger.debug('OPTIONS response prepared', { apiPath, allowedMethods: methods });

    return new NextResponse(null, {
      status: 200,
      headers: {
        Allow: [...methods, 'OPTIONS'].join(', '),
        'Access-Control-Allow-Methods': [...methods, 'OPTIONS'].join(', '),
      },
    });
  } catch (error) {
    logger.error('OPTIONS request failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to process OPTIONS request',
      },
      { status: 500 }
    );
  }
}
