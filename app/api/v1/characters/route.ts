/**
 * Characters API v1 - Collection Endpoint
 *
 * GET /api/v1/characters - List all characters
 * POST /api/v1/characters - Create a new character
 * POST /api/v1/characters?action=ai-wizard - AI wizard generation
 * POST /api/v1/characters?action=ai-wizard-stream - AI wizard generation (streaming)
 * POST /api/v1/characters?action=import - Import SillyTavern character
 * POST /api/v1/characters?action=quick-create - Quick create minimal character
 * POST /api/v1/characters?action=reset-builtins - Reset built-in characters
 */

import { createContextHandler } from '@/lib/api/middleware';
import { handleGet, handlePost } from './handlers';

export const GET = createContextHandler((req, ctx) => handleGet(req, ctx));

export const POST = createContextHandler((req, ctx) => handlePost(req, ctx));
