/**
 * System Jobs API v1 - Individual Job Endpoint
 *
 * GET /api/v1/system/jobs/[id] - Get job details
 * DELETE /api/v1/system/jobs/[id] - Delete a job
 * POST /api/v1/system/jobs/[id]?action=pause - Pause a job
 * POST /api/v1/system/jobs/[id]?action=resume - Resume a job
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, type RequestContext } from '@/lib/api/middleware';
import { getActionParam } from '@/lib/api/middleware/actions';
import { ensureProcessorRunning } from '@/lib/background-jobs';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { notFound, forbidden, badRequest, serverError } from '@/lib/api/responses';

/**
 * GET /api/v1/system/jobs/[id] - Get detailed information about a specific job
 */
export const GET = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {

      const job = await repos.backgroundJobs.findById(id);

      if (!job) {
        return notFound('Job');
      }

      return NextResponse.json({ job });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('[System Jobs v1] Error in GET', { error: errorMessage });
      return serverError(errorMessage);
    }
  }
);

/**
 * DELETE /api/v1/system/jobs/[id] - Delete a specific job
 */
export const DELETE = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    try {

      const job = await repos.backgroundJobs.findById(id);

      if (!job) {
        return notFound('Job');
      }

      // Don't allow deleting jobs that are currently processing
      if (job.status === 'PROCESSING') {
        return badRequest('Cannot delete a job that is currently processing');
      }

      const deleted = await repos.backgroundJobs.delete(id);
      if (!deleted) {
        return serverError('Failed to delete job');
      }

      logger.info('[System Jobs v1] Job deleted', { jobId: id, userId: user.id });
      return NextResponse.json({ success: true });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('[System Jobs v1] Error in DELETE', { error: errorMessage });
      return serverError(errorMessage);
    }
  }
);

/**
 * POST /api/v1/system/jobs/[id]?action=pause|resume
 */
export const POST = createContextParamsHandler<{ id: string }>(
  async (req: NextRequest, { user, repos }: RequestContext, { id }) => {
    const action = getActionParam(req);

    if (!action || !['pause', 'resume'].includes(action)) {
      return badRequest('Invalid action. Available actions: pause, resume');
    }

    try {const job = await repos.backgroundJobs.findById(id);

      if (!job) {
        return notFound('Job');
      }

      let updatedJob;
      if (action === 'pause') {
        if (!['PENDING', 'FAILED'].includes(job.status)) {
          return badRequest(
            `Cannot pause a job with status "${job.status}". Only PENDING or FAILED jobs can be paused.`
          );
        }
        updatedJob = await repos.backgroundJobs.pause(id);
      } else {
        if (job.status !== 'PAUSED') {
          return badRequest(
            `Cannot resume a job with status "${job.status}". Only PAUSED jobs can be resumed.`
          );
        }
        updatedJob = await repos.backgroundJobs.resume(id);
        // Auto-start processor when resuming a job
        ensureProcessorRunning();
      }

      if (!updatedJob) {
        return serverError(`Failed to ${action} job`);
      }

      logger.info('[System Jobs v1] Job action completed', {
        jobId: id,
        userId: user.id,
        action,
        newStatus: updatedJob.status,
      });

      return NextResponse.json({ job: updatedJob });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      logger.error('[System Jobs v1] Error in action', { error: errorMessage, action });
      return serverError(errorMessage);
    }
  }
);
