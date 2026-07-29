/**
 * Chats API v1 - Individual Chat Endpoint
 *
 * GET /api/v1/chats/[id] - Get a specific chat
 * PUT /api/v1/chats/[id] - Update a chat
 * DELETE /api/v1/chats/[id] - Delete a chat
 * GET /api/v1/chats/[id]?action=export - Export chat (SillyTavern JSONL)
 * GET /api/v1/chats/[id]?action=export-markdown - Export chat as a Markdown transcript
 * GET /api/v1/chats/[id]?action=cost - Get cost breakdown
 * GET /api/v1/chats/[id]?action=get-avatars - Get avatar overrides for chat
 * GET /api/v1/chats/[id]?action=get-state - Get chat state (merged with project)
 * GET /api/v1/chats/[id]?action=get-background - Get story background URL
 * GET /api/v1/chats/[id]?action=outfit - Get equipped outfit state
 * PUT /api/v1/chats/[id]?action=set-state - Set chat state
 * DELETE /api/v1/chats/[id]?action=reset-state - Reset chat state to empty
 * POST /api/v1/chats/[id]?action=regenerate-title - Regenerate chat title
 * POST /api/v1/chats/[id]?action=add-tag - Add tag
 * POST /api/v1/chats/[id]?action=remove-tag - Remove tag
 * POST /api/v1/chats/[id]?action=impersonate - Start impersonating
 * POST /api/v1/chats/[id]?action=stop-impersonate - Stop impersonating
 * POST /api/v1/chats/[id]?action=set-active-speaker - Set active typing participant
 * POST /api/v1/chats/[id]?action=turn - Turn action (nudge/queue/dequeue)
 * POST /api/v1/chats/[id]?action=add-participant - Add participant
 * POST /api/v1/chats/[id]?action=update-participant - Update participant
 * POST /api/v1/chats/[id]?action=remove-participant - Remove participant
 * POST /api/v1/chats/[id]?action=bulk-reattribute - Re-attribute multiple messages
 * POST /api/v1/chats/[id]?action=set-avatar - Set avatar override for character
 * POST /api/v1/chats/[id]?action=remove-avatar - Remove avatar override
 * POST /api/v1/chats/[id]?action=add-tool-result - Add tool result message
 * POST /api/v1/chats/[id]?action=queue-memories - Queue memory extraction jobs
 * POST /api/v1/chats/[id]?action=extract-memories-dry-run - Stream NDJSON dry-run of per-turn memory extraction (no persistence)
 * POST /api/v1/chats/[id]?action=recall-replay - Replay per-turn memory recall old-path vs new-path (episodic tuning harness)
 * POST /api/v1/chats/[id]?action=rng - Execute random number generator (dice, coin, bottle)
 * POST /api/v1/chats/[id]?action=toggle-agent-mode - Toggle agent mode for this chat
 * POST /api/v1/chats/[id]?action=reclassify-danger - Reset and re-queue danger classification
 * POST /api/v1/chats/[id]?action=equip - Equip/unequip wardrobe item in a slot
 * POST /api/v1/chats/[id]?action=toggle-avatar-generation - Toggle avatar generation
 * POST /api/v1/chats/[id]?action=regenerate-avatar - Regenerate character avatar
 * POST /api/v1/chats/[id]?action=render-conversation - Queue Scriptorium render with full re-embed
 * POST /api/v1/chats/[id]?action=announcement - Post an ad-hoc announcement bubble
 * POST /api/v1/chats/[id]?action=send-mail - Post a letter as a player-character (The Post Office)
 * GET /api/v1/chats/[id]?action=mailbox&characterId=… - List a player-character's mailbox letters
 * PATCH /api/v1/chats/[id]?action=turn - Persist turn state (lastTurnParticipantId)
 */

import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { handleGet, handlePut, handleDelete, handlePost, handlePatch } from './handlers';

export const GET = createAuthenticatedParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handleGet(req, ctx, id)
);

export const PUT = createAuthenticatedParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handlePut(req, ctx, id)
);

export const DELETE = createAuthenticatedParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handleDelete(req, ctx, id)
);

export const POST = createAuthenticatedParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handlePost(req, ctx, id)
);

export const PATCH = createAuthenticatedParamsHandler<{ id: string }>(
  (req, ctx, { id }) => handlePatch(req, ctx, id)
);
