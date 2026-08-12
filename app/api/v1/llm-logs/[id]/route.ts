/**
 * LLM Logs API v1 - Item Endpoint
 *
 * GET /api/v1/llm-logs/[id] - Get a single log entry
 * DELETE /api/v1/llm-logs/[id] - Delete a log entry
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler } from '@/lib/api/middleware';
import { successResponse, serverError, notFound, forbidden } from '@/lib/api/responses';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/llm-logs/[id] - Get a single log entry
 */
export const GET = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: logId }) => {
    try {

      const log = await repos.llmLogs.findById(logId);
      if (!log) {
        return notFound('LLM Log');
      }

      return successResponse(log);
    } catch (error) {
      logger.error(
        '[LLM Logs API] Error fetching log',
        { userId: user.id, logId },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to fetch LLM log');
    }
  }
);

/**
 * DELETE /api/v1/llm-logs/[id] - Delete a log entry
 */
export const DELETE = createContextParamsHandler<{ id: string }>(
  async (req, { user, repos }, { id: logId }) => {
    try {

      const log = await repos.llmLogs.findById(logId);
      if (!log) {
        return notFound('LLM Log');
      }

      const deleted = await repos.llmLogs.delete(logId);
      if (!deleted) {
        logger.error('[LLM Logs API] Failed to delete log from repository', { userId: user.id, logId });
        return serverError('Failed to delete log');
      }

      logger.info('[LLM Logs API] Log deleted', { userId: user.id, logId });

      return successResponse({ success: true, deletedId: logId });
    } catch (error) {
      logger.error(
        '[LLM Logs API] Error deleting log',
        { userId: user.id, logId },
        error instanceof Error ? error : undefined
      );
      return serverError('Failed to delete LLM log');
    }
  }
);
