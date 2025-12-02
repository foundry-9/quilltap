/**
 * Example API Route Handler
 *
 * This is an example handler for the Quilltap plugin API routes.
 * It demonstrates how to create a simple API endpoint that can be
 * loaded and invoked by the Quilltap plugin system.
 *
 * @module exampleHandler
 */

/**
 * GET handler for the example API route
 *
 * @param {Request} request - The incoming request object
 * @param {Object} context - Additional context (session, plugin config, etc.)
 * @returns {Promise<Response>} The response object
 */
export async function GET(request, context) {
  // Example: Access plugin configuration
  const pluginConfig = context?.pluginConfig || {};

  // Example: Check authentication
  if (!context?.session) {
    return new Response(
      JSON.stringify({ error: 'Authentication required' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  // Return example response
  return new Response(
    JSON.stringify({
      success: true,
      message: 'Hello from qtap-plugin-template!',
      config: pluginConfig,
      timestamp: new Date().toISOString()
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

/**
 * POST handler for the example API route
 *
 * @param {Request} request - The incoming request object
 * @param {Object} context - Additional context (session, plugin config, etc.)
 * @returns {Promise<Response>} The response object
 */
export async function POST(request, context) {
  try {
    const body = await request.json();

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Data received',
        receivedData: body,
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Invalid JSON in request body'
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
