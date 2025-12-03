/**
 * NextAuth API Route Handler
 *
 * Uses lazy initialization to ensure plugins are loaded before
 * auth providers are configured. The handler is created asynchronously
 * on the first request, waiting for plugin initialization if needed.
 */

import NextAuth from "next-auth";
import { buildAuthOptionsAsync } from "@/lib/auth";

// Cache the handler after first successful creation
let cachedHandler: ReturnType<typeof NextAuth> | null = null;
let handlerPromise: Promise<ReturnType<typeof NextAuth>> | null = null;

/**
 * Get or create the NextAuth handler asynchronously
 * Ensures plugins are initialized before building auth options
 */
async function getHandler(): Promise<ReturnType<typeof NextAuth>> {
  // Return cached handler if available
  if (cachedHandler) {
    return cachedHandler;
  }

  // If already building, wait for that promise
  if (handlerPromise) {
    return handlerPromise;
  }

  // Build handler asynchronously
  handlerPromise = (async () => {
    const authOptions = await buildAuthOptionsAsync();
    cachedHandler = NextAuth(authOptions);
    return cachedHandler;
  })();

  return handlerPromise;
}

/**
 * GET handler for NextAuth
 * Handles OAuth callbacks, CSRF tokens, session queries, etc.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ nextauth: string[] }> }
) {
  const handler = await getHandler();
  return handler(request, context);
}

/**
 * POST handler for NextAuth
 * Handles sign-in, sign-out, and other auth operations
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ nextauth: string[] }> }
) {
  const handler = await getHandler();
  return handler(request, context);
}
