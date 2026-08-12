/**
 * Projects API v1 - Individual Project Endpoint
 *
 * GET /api/v1/projects/[id] - Get project details
 * PUT /api/v1/projects/[id] - Update project
 * DELETE /api/v1/projects/[id] - Delete project
 *
 * Actions:
 * GET /api/v1/projects/[id]?action=list-characters - List character roster
 * POST /api/v1/projects/[id]?action=add-character - Add character to roster
 * DELETE /api/v1/projects/[id]?action=remove-character - Remove character from roster
 *
 * GET /api/v1/projects/[id]?action=list-chats - List project chats
 * POST /api/v1/projects/[id]?action=add-chat - Associate chat with project
 * DELETE /api/v1/projects/[id]?action=remove-chat - Remove chat from project
 *
 * GET /api/v1/projects/[id]?action=list-files - List project files
 * POST /api/v1/projects/[id]?action=add-file - Associate file with project
 * DELETE /api/v1/projects/[id]?action=remove-file - Remove file from project
 *
 * GET /api/v1/projects/[id]?action=get-mount-point - Get project mount point config
 * PUT /api/v1/projects/[id]?action=set-mount-point - Set project mount point
 * DELETE /api/v1/projects/[id]?action=clear-mount-point - Clear project mount point (use system default)
 *
 * GET /api/v1/projects/[id]?action=get-state - Get project state
 * GET /api/v1/projects/[id]?action=get-background - Get project story background URL
 * PUT /api/v1/projects/[id]?action=set-state - Set project state
 * DELETE /api/v1/projects/[id]?action=reset-state - Reset project state to empty
 *
 * POST /api/v1/projects/[id]?action=update-tool-settings - Update default tool settings
 */

import { createContextParamsHandler } from '@/lib/api/middleware';
import { handleGet, handlePut, handleDelete, handlePost } from './handlers';

export const GET = createContextParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handleGet(req, ctx, id)
);

export const PUT = createContextParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handlePut(req, ctx, id)
);

export const DELETE = createContextParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handleDelete(req, ctx, id)
);

export const POST = createContextParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handlePost(req, ctx, id)
);
