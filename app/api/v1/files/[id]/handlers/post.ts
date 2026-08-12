import { NextRequest, NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { badRequest, notFound } from '@/lib/api/responses';
import { handleMoveFile, handlePromoteFile } from '../actions';
import { FILE_ITEM_POST_ACTIONS, type FileItemPostAction } from '../shared';

export async function handlePost(
  request: NextRequest,
  ctx: RequestContext,
  fileId: string
): Promise<NextResponse> {
  const file = await ctx.repos.files.findById(fileId);
  if (!file || file.userId !== ctx.user.id) {
    return notFound('File');
  }

  const action = getActionParam(request);
  if (!isValidAction(action, FILE_ITEM_POST_ACTIONS)) {
    return badRequest(
      `Unknown action: ${action}. Available actions: ${FILE_ITEM_POST_ACTIONS.join(', ')}`
    );
  }

  const actionHandlers: Record<FileItemPostAction, () => Promise<NextResponse>> = {
    move: () => handleMoveFile(request, ctx, fileId, file),
    promote: () => handlePromoteFile(request, ctx, fileId, file),
  };

  return actionHandlers[action]();
}