/**
 * System Jobs API v1 - Collection Endpoint
 *
 * GET /api/v1/system/jobs - Get queue statistics and recent jobs
 * POST /api/v1/system/jobs - Create a new background job
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler, type RequestContext } from '@/lib/api/middleware';
import { getQueueStats, getActiveCountsByType, enqueueJob, ensureProcessorRunning, getProcessorStatus } from '@/lib/background-jobs';
import { BackgroundJobTypeEnum } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { badRequest, serverError } from '@/lib/api/responses';

/**
 * GET /api/v1/system/jobs - Get queue statistics and optionally recent jobs
 *
 * Query params:
 * - includeJobs: 'true' to include recent jobs
 * - chatId: Filter pending jobs for a specific chat
 */
export const GET = createContextHandler(async (req: NextRequest, { user, repos }: RequestContext) => {
  try {
    const { searchParams } = req.nextUrl;
    const includeJobs = searchParams.get('includeJobs') === 'true';
    const chatId = searchParams.get('chatId');// Ensure processor is running
    ensureProcessorRunning();

    // Get stats
    const stats = await getQueueStats(user.id);
    const activeByType = await getActiveCountsByType(user.id);
    const processorStatus = getProcessorStatus();

    const response: Record<string, unknown> = {
      stats,
      activeByType,
      processor: processorStatus,
    };

    // Optionally include recent jobs
    if (includeJobs) {
      const jobs = await repos.backgroundJobs.findByUserId(user.id);
      response.jobs = jobs.slice(0, 50); // Limit to 50 most recent
    }

    // If chatId specified, get pending jobs for that chat
    if (chatId) {
      const pendingJobs = await repos.backgroundJobs.findPendingForChat(chatId);
      response.pendingForChat = pendingJobs;
    }

    return NextResponse.json(response);
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('[System Jobs v1] Error in GET', { error: errorMessage });
    return serverError(errorMessage);
  }
});

/**
 * POST /api/v1/system/jobs - Create a new background job
 *
 * Body: {
 *   type: BackgroundJobType,
 *   payload: object,
 *   priority?: number,
 *   maxAttempts?: number
 * }
 */
export const POST = createContextHandler(async (req: NextRequest, { user }: RequestContext) => {
  try {
    const body = await req.json();
    const { type, payload, priority, maxAttempts } = body;

    // Validate type
    const typeValidation = BackgroundJobTypeEnum.safeParse(type);
    if (!typeValidation.success) {
      return badRequest(`Invalid job type. Must be one of: ${BackgroundJobTypeEnum.options.join(', ')}`);
    }

    if (!payload || typeof payload !== 'object') {
      return badRequest('Payload is required and must be an object');
    }

    logger.info('[System Jobs v1] Creating job', {
      userId: user.id,
      type,
    });

    // Ensure processor is running
    ensureProcessorRunning();

    const jobId = await enqueueJob(user.id, type, payload, {
      priority: typeof priority === 'number' ? priority : undefined,
      maxAttempts: typeof maxAttempts === 'number' ? maxAttempts : undefined,
    });

    return NextResponse.json({ jobId, message: 'Job created successfully' }, { status: 201 });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error('[System Jobs v1] Error in POST', { error: errorMessage });
    return serverError(errorMessage);
  }
});
