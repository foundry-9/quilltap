import { NextRequest, NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware';
import { handleDeleteFile } from '../actions';

export async function handleDelete(
  request: NextRequest,
  ctx: RequestContext,
  fileId: string
): Promise<NextResponse> {
  return handleDeleteFile(request, ctx, fileId);
}