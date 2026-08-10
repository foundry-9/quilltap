/**
 * Files API v1 - Collection Endpoint
 *
 * GET /api/v1/files - List files (filter by projectId, folderPath, category, or filter=general)
 * POST /api/v1/files?action=upload - Upload a file (multipart/form-data)
 */

import { createContextHandler } from '@/lib/api/middleware';
import { handleGet, handlePost } from './handlers';

export const GET = createContextHandler(handleGet);
export const POST = createContextHandler(handlePost);
