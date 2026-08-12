/**
 * Conversation Summaries System API v1
 *
 * - POST /api/v1/system/conversation-summaries?action=regenerate
 *     Enqueue a background backfill that re-mirrors every summarized chat's
 *     context summary into its participant character vaults (the files the
 *     Commonplace Book's relevant-conversations retrieval reads). Returns
 *     immediately; the work runs in the background.
 * - GET /api/v1/system/conversation-summaries?action=regenerate
 *     Report whether a regeneration is in flight.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler, getActionParam } from '@/lib/api/middleware';
import { badRequest, serverError } from '@/lib/api/responses';
import { enqueueRegenerateConversationSummaries } from '@/lib/background-jobs/queue-service';
import { logger } from '@/lib/logger';

export const GET = createContextHandler(async (req, { user, repos }) => {
  const action = getActionParam(req);
  if (action === 'regenerate') {
    return handleRegenerateStatus(req, { user, repos });
  }
  return badRequest('Unknown or missing action.');
});

export const POST = createContextHandler(async (req, { user, repos }) => {
  const action = getActionParam(req);
  if (action === 'regenerate') {
    return handleRegenerate(req, { user, repos });
  }
  return badRequest('Unknown or missing action.');
});

async function handleRegenerate(
  _req: NextRequest,
  { user }: { user: { id: string }; repos: unknown },
) {
  try {
    const { jobId, isNew } = await enqueueRegenerateConversationSummaries(user.id);
    logger.info('[ConversationSummaries API] Enqueued summary regeneration', {
      userId: user.id,
      jobId,
      isNew,
    });
    return NextResponse.json({
      success: true,
      jobId,
      message: isNew
        ? 'Conversation summaries are being re-mirrored into the character vaults in the background.'
        : 'A summary regeneration is already in flight; the existing one will complete.',
    });
  } catch (error) {
    logger.error('[ConversationSummaries API] Failed to enqueue summary regeneration', {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError('Failed to enqueue summary regeneration');
  }
}

async function handleRegenerateStatus(
  _req: NextRequest,
  { user, repos }: { user: { id: string }; repos: any },
) {
  const [pending, processing] = await Promise.all([
    repos.backgroundJobs.findByUserId(user.id, 'PENDING'),
    repos.backgroundJobs.findByUserId(user.id, 'PROCESSING'),
  ]);
  const inFlight = [...pending, ...processing].filter(
    (j: { type: string }) => j.type === 'REGENERATE_CONVERSATION_SUMMARIES',
  ).length;
  return NextResponse.json({ success: true, inFlight });
}
