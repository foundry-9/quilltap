/**
 * Groups API v1 - Individual Group Endpoint
 *
 * GET /api/v1/groups/[id] - Get group details
 * PUT /api/v1/groups/[id] - Update group
 * DELETE /api/v1/groups/[id] - Delete group
 *
 * Actions:
 * GET /api/v1/groups/[id]?action=members - List member characters
 * GET /api/v1/groups/[id]?action=stores - List linked document stores
 * POST /api/v1/groups/[id]?action=addMember - Add character to group
 * DELETE /api/v1/groups/[id]?action=removeMember - Remove character from group
 * POST /api/v1/groups/[id]?action=linkStore - Link a document store to group
 * DELETE /api/v1/groups/[id]?action=unlinkStore - Unlink a document store from group
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
