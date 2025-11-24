/**
 * Health check endpoint for monitoring
 * Returns 200 OK if the application is running
 */

import { NextResponse } from 'next/server';
import { getRepositories } from '@/lib/json-store/repositories';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Check JSON store connectivity by attempting to read user data
    const repos = getRepositories();
    await repos.users.getCurrentUser();

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      database: 'connected', // JSON store is file-based but we keep the same API
    };

    return NextResponse.json(health, { status: 200 });
  } catch (error) {
    const health = {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
    };

    return NextResponse.json(health, { status: 503 });
  }
}
