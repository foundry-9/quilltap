/**
 * Chat Messages Operations
 *
 * Handles message CRUD for chats: get, add, add-many, update,
 * count, and clear. Also exports the ChatMessageRowSchema
 * used for SQLite collection initialization.
 */

import { z } from 'zod';
import {
  ChatMetadata,
  ChatEvent,
  ChatEventSchema,
  DangerFlagSchema,
} from '@/lib/schemas/types';
import { UUIDSchema, TimestampSchema, JsonSchema, RoleEnum } from '@/lib/schemas/common.types';
import { QueryFilter, SortSpec } from '../interfaces';
import { logger } from '@/lib/logger';
import { ChatOpsContext } from './chats-ops-context';
import { safeQuery } from './safe-query';
import { computeSpokenThisCycleAfterMessage } from '@/lib/chat/turn-manager';

/**
 * Schema for individual chat message rows in SQLite
 * This schema represents the flattened message format with chatId added
 * for the normalized SQLite storage pattern
 */
export const ChatMessageRowSchema = z.object({
  id: UUIDSchema,
  chatId: UUIDSchema,
  type: z.string(),  // 'message', 'context-summary', or 'system'
  role: RoleEnum.nullable().optional(),  // Only for type='message'
  content: z.string().nullable().optional(),  // For type='message'
  rawResponse: JsonSchema.nullable().optional(),  // JSON object
  tokenCount: z.number().nullable().optional(),
  promptTokens: z.number().nullable().optional(),
  completionTokens: z.number().nullable().optional(),
  swipeGroupId: z.string().nullable().optional(),
  swipeIndex: z.number().nullable().optional(),
  attachments: z.array(UUIDSchema).nullable().default([]),  // JSON array
  debugMemoryLogs: z.array(z.string()).nullable().optional(),  // JSON array
  thoughtSignature: z.string().nullable().optional(),
  // Reasoning / chain-of-thought from thinking models. DISPLAY ONLY — never re-fed to any model.
  reasoningContent: z.string().nullable().optional(),
  // Positioned reasoning blocks (JSON array) for splicing thinking into the prose. DISPLAY ONLY.
  reasoningSegments: z.array(z.object({
    anchorOffset: z.number(),
    content: z.string(),
    seq: z.number(),
  })).nullable().optional(),
  participantId: UUIDSchema.nullable().optional(),
  recoveryType: z.enum(['token_limit', 'token_limit_static', 'content_limit', 'content_limit_static']).nullable().optional(),
  // Server-side pre-rendered HTML for simple messages
  renderedHtml: z.string().nullable().optional(),
  // Danger content flags from gatekeeper classification
  dangerFlags: z.array(DangerFlagSchema).nullable().optional(),  // JSON array
  // Answer-confirmation results. Plain booleans so the schema translator
  // classifies them as boolean columns (INTEGER 0/1 in SQLite, hydrated back to
  // true/false on read — they don't start with 'is' so the naming fallback
  // wouldn't catch them).
  confirmed: z.boolean().nullable().optional(),
  confirmationChecked: z.boolean().nullable().optional(),
  confirmationRevised: z.boolean().nullable().optional(),
  confirmationNotes: z.string().nullable().optional(),
  confirmationOriginalContent: z.string().nullable().optional(),
  targetParticipantIds: z.array(UUIDSchema).nullable().optional(),  // JSON array — whisper targets
  isSilentMessage: z.union([z.boolean(), z.number().transform(v => v === 1)]).nullable().optional(),  // Whether message was generated while character was in silent mode (SQLite stores as 0/1)
  systemSender: z.enum(['lantern', 'aurora', 'librarian', 'concierge', 'prospero', 'host', 'commonplaceBook', 'ariel', 'carina', 'suparna', 'pascal']).nullable().optional(),  // Personified feature that authored this message in lieu of a participant
  systemKind: z.string().nullable().optional(),  // Sub-classification of a Staff-authored message (e.g. 'timestamp', 'project-context', 'memory-recap'). Always paired with systemSender.
  // Neutral, persona-free rewrite of `content` for Staff-authored messages.
  // Swapped into every character's LLM context when the chat has any non-user-
  // character participant with systemTransparency !== true. NULL on
  // participant-authored messages and on legacy Staff messages from before
  // the dual-body migration.
  opaqueContent: z.string().nullable().optional(),
  // Structured payload on Host announcements. Two shapes share this field:
  // (a) presence transitions — { participantId, toStatus } — for add/remove/
  // status-change. (b) off-scene character introductions — { introducedCharacterIds }
  // — stamped by the off-scene Host announcer so the context builder can
  // detect already-introduced characters. All fields optional; NULL on
  // announcements with no structured payload and on every non-Host message.
  hostEvent: z.object({
    participantId: UUIDSchema.optional(),
    toStatus: z.enum(['active', 'silent', 'absent', 'removed']).optional(),
    introducedCharacterIds: z.array(UUIDSchema).optional(),
  }).nullable().optional(),
  // Ad-hoc announcer metadata for user-authored announcement bubbles
  // (Insert Announcement composer button). Mutually exclusive with
  // systemSender. Shape: { kind: 'character', characterId } or
  // { kind: 'custom', displayName }.
  customAnnouncer: z.object({
    kind: z.enum(['character', 'custom']),
    characterId: UUIDSchema.nullable().optional(),
    displayName: z.string().nullable().optional(),
  }).nullable().optional(),
  // Carina (inline LLM queries) provenance, set on systemSender='carina'
  // messages. answererId = workspace character id of the answerer (drives
  // avatar resolution + prior-exchange continuity); question = the verbatim
  // text asked. NULL on every non-Carina message.
  carinaMeta: z.object({
    answererId: UUIDSchema,
    question: z.string(),
  }).nullable().optional(),
  // Pascal the Croupier (custom pseudo-tools) roll record, set on
  // systemSender='pascal' messages. The server rolled and the server picked the
  // outcome, so none of this is the model's account of its own luck.
  // This row schema describes what is STORED; the gate on the way in is
  // ChatEventSchema (lib/schemas/chat.types.ts), which addMessage parses
  // against — a field declared there but not here still persists, since this
  // shape only tells the backend that pascalMeta is a JSON column. Kept in
  // lockstep anyway: it is the account of the column a reader will consult.
  // toolTitle = display title at roll time (absent on older rows; readers fall
  // back to `tool`);
  // definitionTier/definitionMountId = the store the definition resolved from
  // (tiers shadow, so a name can differ per room); rollForm = 'range' or 'dice'
  // ('dice' carries notation + diceRolls); raw = untransformed roll, value =
  // what the outcome table tested; outcomeIndex/state = the winning entry and
  // its verdict; invokedBy = model reach vs. user Run-Tool. NULL on every
  // non-Pascal message.
  pascalMeta: z.object({
    tool: z.string(),
    toolTitle: z.string().optional(),
    // chipLabel = the definition's chipLabel template rendered at roll time —
    // the per-run label the Salon chip and the bubble heading share. Absent on
    // older rows; readers fall back to toolTitle, then tool.
    chipLabel: z.string().optional(),
    definitionTier: z.enum(['character', 'participant', 'group', 'project', 'global']),
    definitionMountId: z.string(),
    params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
    rollForm: z.enum(['range', 'dice']),
    notation: z.string().optional(),
    raw: z.number(),
    diceRolls: z.array(z.number()).optional(),
    value: z.number(),
    state: z.enum(['success', 'partial', 'failure', 'info']),
    outcomeIndex: z.number(),
    // The metadata keys the winning row tested, and what they held at roll time.
    metadataTested: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
    // The LLM consult, when the definition declared one: the rendered prompt,
    // whether it was answered, and the output the table tested (the model's
    // answer, or the author's errorMessage on failure — `reason` records the
    // technical cause for the operator).
    llm: z.object({
      ok: z.boolean(),
      output: z.string(),
      prompt: z.string(),
      reason: z.string().optional(),
      provider: z.string().optional(),
      model: z.string().optional(),
    }).optional(),
    // The side effects this run applied (the audit of the definition's
    // `effects` array): raw target, prior value (absent when none), what was
    // written, and — state targets only — the tier the write landed in.
    effects: z.array(z.object({
      target: z.string(),
      previous: z.unknown().optional(),
      next: z.unknown(),
      tier: z.enum(['chat', 'project', 'group', 'general']).optional(),
    })).optional(),
    invokedBy: z.enum(['llm', 'user']),
    callerParticipantId: UUIDSchema.optional(),
  }).nullable().optional(),
  // The Courier: when non-null, this row is a placeholder for a manual /
  // clipboard turn awaiting a pasted reply. Cleared on resolve.
  pendingExternalPrompt: z.string().nullable().optional(),
  // Full-context fallback alongside `pendingExternalPrompt` when delta mode
  // rendered a delta. Lets the bubble toggle to the full version.
  pendingExternalPromptFull: z.string().nullable().optional(),
  pendingExternalAttachments: z.array(z.object({
    fileId: UUIDSchema,
    filename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
    downloadUrl: z.string(),
  })).nullable().optional(),
  // Phase 3c: anchor tying a Staff-authored whisper to the compaction
  // generation under which it was produced. Set on per-character Librarian
  // summary whispers; null on every other message.
  summaryAnchor: z.object({
    compactionGeneration: z.number(),
  }).nullable().optional(),
  // For type='context-summary'
  context: z.string().nullable().optional(),
  // For type='system'
  systemEventType: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  totalTokens: z.number().nullable().optional(),
  provider: z.string().nullable().optional(),
  modelName: z.string().nullable().optional(),
  estimatedCostUSD: z.number().nullable().optional(),
  createdAt: TimestampSchema,
});

export class ChatMessagesOps {
  constructor(private readonly ctx: ChatOpsContext) {}

  /**
   * Count only messages that appear as visible bubbles in the UI
   * (type === 'message' with USER or ASSISTANT role, excluding SYSTEM and TOOL)
   */
  private countVisibleMessages(messages: ChatEvent[]): number {
    return messages.filter(m => m.type === 'message' && m.role !== 'SYSTEM' && m.role !== 'TOOL').length;
  }

  /**
   * Get all messages for a chat
   */
  async getMessages(chatId: string): Promise<ChatEvent[]> {
    return safeQuery(async () => {
      const messagesCollection = await this.ctx.getMessagesCollection();

      let rawMessages: any[];

      if (this.ctx.isSQLiteBackend()) {
        // SQLite: Query individual message rows, sorted by createdAt
        rawMessages = await messagesCollection.find(
          { chatId } as QueryFilter,
          { sort: { createdAt: 1 } as SortSpec }
        );
      } else {
        // Legacy data compatibility: Extract from embedded array
        const messagesDoc = await messagesCollection.findOne({ chatId } as QueryFilter);

        if (!messagesDoc) {
          return [];
        }

        rawMessages = (messagesDoc as any).messages || [];
      }

      // Validate each message individually - skip corrupted messages rather than
      // failing the entire chat load
      const validMessages: ChatEvent[] = [];
      for (const msg of rawMessages) {
        const result = ChatEventSchema.safeParse(msg);
        if (result.success) {
          validMessages.push(result.data);
        } else {
          logger.warn('Skipping corrupted chat message', {
            chatId,
            messageId: msg?.id || 'unknown',
            messageType: msg?.type || 'unknown',
            errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
          });
        }
      }

      return validMessages;
    }, 'Failed to get messages for chat', { chatId }, []);
  }

  /**
   * Resolve which chat a message belongs to via a direct indexed lookup on the
   * message id — without loading, scanning, or validating any other chat. Used
   * by the per-message API endpoints so locating a message is O(1) instead of
   * loading and Zod-validating every message in every chat in the account.
   *
   * SQLite backend only (the real runtime). On the legacy embedded-array
   * backend messages aren't individually queryable, so this returns null and
   * callers fall through to "not found".
   */
  async findChatIdForMessage(messageId: string): Promise<string | null> {
    return safeQuery(async () => {
      if (!this.ctx.isSQLiteBackend()) {
        return null;
      }
      const messagesCollection = await this.ctx.getMessagesCollection();
      const row = await messagesCollection.findOne({ id: messageId } as QueryFilter);
      return row ? ((row as { chatId?: string }).chatId ?? null) : null;
    }, 'Failed to resolve chat for message', { messageId }, null);
  }

  /**
   * Add a message to a chat
   */
  async addMessage(chatId: string, message: ChatEvent): Promise<ChatEvent> {
    return safeQuery(async () => {
      const validated = ChatEventSchema.parse(message);
      const messagesCollection = await this.ctx.getMessagesCollection();
      const now = this.ctx.getCurrentTimestamp();

      if (this.ctx.isSQLiteBackend()) {
        // SQLite: Insert as individual row with chatId
        await messagesCollection.insertOne({ ...validated, chatId } as any);
      } else {
        // Legacy data compatibility: Push to embedded array
        await messagesCollection.updateOne(
          { chatId } as QueryFilter,
          {
            $push: { messages: validated },
            $set: { updatedAt: now },
          } as any,
        );
      }

      // Update chat metadata — only update lastMessageAt and updatedAt for actual messages
      const chat = await this.ctx.findById(chatId);
      if (chat) {
        const allMessages = await this.getMessages(chatId);
        const isActualMessage = validated.type === 'message';
        const updateData: Record<string, unknown> = {
          messageCount: this.countVisibleMessages(allMessages),
        };
        if (isActualMessage) {
          updateData.lastMessageAt = now;
          updateData.updatedAt = now;
        }
        const cycleUpdate = computeSpokenThisCycleAfterMessage(
          validated,
          chat.participants,
          chat.spokenThisCycleParticipantIds,
        );
        if (cycleUpdate !== null) {
          updateData.spokenThisCycleParticipantIds = cycleUpdate;
        }
        await this.ctx.update(chatId, updateData as Partial<ChatMetadata>);
      }
      return validated;
    }, 'Failed to add message to chat', { chatId });
  }

  /**
   * Add multiple messages to a chat
   */
  async addMessages(chatId: string, messages: ChatEvent[]): Promise<ChatEvent[]> {
    return safeQuery(async () => {
      const validated = messages.map(msg => ChatEventSchema.parse(msg));
      const messagesCollection = await this.ctx.getMessagesCollection();
      const now = this.ctx.getCurrentTimestamp();

      if (this.ctx.isSQLiteBackend()) {
        // SQLite: Insert each message as individual row with chatId
        for (const msg of validated) {
          await messagesCollection.insertOne({ ...msg, chatId } as any);
        }
      } else {
        // Legacy data compatibility: Push all to embedded array
        await messagesCollection.updateOne(
          { chatId } as QueryFilter,
          {
            $push: { messages: { $each: validated } },
            $set: { updatedAt: now },
          } as any
        );
      }

      // Update chat metadata — only update lastMessageAt and updatedAt if batch contains actual messages
      const chat = await this.ctx.findById(chatId);
      if (chat) {
        const allMessages = await this.getMessages(chatId);
        const hasActualMessages = validated.some(m => m.type === 'message');
        const updateData: Record<string, unknown> = {
          messageCount: this.countVisibleMessages(allMessages),
        };
        if (hasActualMessages) {
          updateData.lastMessageAt = now;
          updateData.updatedAt = now;
        }
        // Fold each message through the cycle helper in order so a batch that
        // wraps the cycle mid-stream still lands on the right final state.
        let currentSpoken = chat.spokenThisCycleParticipantIds;
        let spokenChanged = false;
        for (const msg of validated) {
          const next = computeSpokenThisCycleAfterMessage(msg, chat.participants, currentSpoken);
          if (next !== null) {
            currentSpoken = next;
            spokenChanged = true;
          }
        }
        if (spokenChanged) {
          updateData.spokenThisCycleParticipantIds = currentSpoken;
        }
        await this.ctx.update(chatId, updateData as Partial<ChatMetadata>);
      }
      return validated;
    }, 'Failed to add messages to chat', { chatId });
  }

  /**
   * Update a specific message in a chat
   */
  async updateMessage(chatId: string, messageId: string, updates: Partial<ChatEvent>): Promise<ChatEvent | null> {
    return safeQuery(async () => {
      const messagesCollection = await this.ctx.getMessagesCollection();
      const now = this.ctx.getCurrentTimestamp();

      if (this.ctx.isSQLiteBackend()) {
        // SQLite: Find and update the specific message row
        const existingMessage = await messagesCollection.findOne({ id: messageId, chatId } as QueryFilter);
        if (!existingMessage) {
          return null;
        }

        const updatedMessage = { ...existingMessage, ...updates };
        const validated = ChatEventSchema.parse(updatedMessage);

        await messagesCollection.updateOne(
          { id: messageId } as QueryFilter,
          { $set: validated } as any
        );
        return validated;
      } else {
        // Legacy data compatibility: Update in embedded array
        const messages = await this.getMessages(chatId);
        const messageIndex = messages.findIndex(m => m.id === messageId);

        if (messageIndex === -1) {
          return null;
        }

        // Merge updates with existing message
        const updatedMessage = { ...messages[messageIndex], ...updates };
        const validated = ChatEventSchema.parse(updatedMessage);

        // Replace message in array
        messages[messageIndex] = validated;

        // Update entire messages array
        await messagesCollection.updateOne(
          { chatId } as QueryFilter,
          {
            $set: {
              messages: messages,
              updatedAt: now,
            },
          } as any
        );
        return validated;
      }
    }, 'Failed to update message in chat', { chatId, messageId }, null);
  }

  /**
   * Get message count for a chat
   */
  async getMessageCount(chatId: string): Promise<number> {
    return safeQuery(async () => {
      const messages = await this.getMessages(chatId);
      return messages.length;
    }, 'Failed to get message count for chat', { chatId }, 0);
  }

  /**
   * Timestamp of the most recent *played* message in a chat — one authored by a
   * participant character or the human user: `type === 'message'` with NO
   * `systemSender`. Personified-feature / Staff announcements (Lantern, Aurora,
   * Host, Prospero, Carina, Concierge, Commonplace Book, Ariel, Suparṇā,
   * Librarian) also persist as `type: 'message'` rows, but they carry a
   * `systemSender`, so they are excluded — a Staff whisper into an otherwise
   * quiet chat must not read as conversational activity.
   *
   * Returns the ISO `createdAt` of that message, or null when the chat has no
   * played messages at all. Used by the stale-chat maintenance sweep to decide
   * whether a chat has genuinely gone quiet.
   */
  async getLastPlayedMessageAt(chatId: string): Promise<string | null> {
    return safeQuery(async () => {
      const messagesCollection = await this.ctx.getMessagesCollection();

      if (this.ctx.isSQLiteBackend()) {
        // Indexed single-row lookup — avoids loading and Zod-validating the
        // whole transcript of every chat during the daily maintenance sweep.
        const rows = await messagesCollection.find(
          { chatId, type: 'message', systemSender: null } as QueryFilter,
          { sort: { createdAt: -1 } as SortSpec, limit: 1 },
        );
        const createdAt = (rows[0] as { createdAt?: unknown } | undefined)?.createdAt;
        return typeof createdAt === 'string' ? createdAt : null;
      }

      // Legacy embedded-array backend: scan the loaded messages for the newest
      // participant-authored one (ISO-8601 strings compare lexicographically).
      const messages = await this.getMessages(chatId);
      let latest: string | null = null;
      for (const m of messages) {
        if (m.type !== 'message' || m.systemSender) continue;
        if (latest === null || m.createdAt > latest) latest = m.createdAt;
      }
      return latest;
    }, 'Failed to get last played message timestamp', { chatId }, null);
  }

  /**
   * Delete a specific set of messages from a chat by ID. Returns the number
   * of messages actually removed. Used by the per-character Librarian
   * summary pipeline to sweep prior summary whispers when a fresh one is
   * about to be posted.
   */
  async deleteMessagesByIds(chatId: string, messageIds: string[]): Promise<number> {
    if (messageIds.length === 0) return 0;

    return safeQuery(async () => {
      const messagesCollection = await this.ctx.getMessagesCollection();
      const now = this.ctx.getCurrentTimestamp();
      let removed = 0;

      if (this.ctx.isSQLiteBackend()) {
        for (const messageId of messageIds) {
          const result = await messagesCollection.deleteOne({ id: messageId, chatId } as QueryFilter);
          // deleteOne may return either a count or a boolean depending on backend
          if (typeof result === 'number') {
            removed += result;
          } else if (result) {
            removed += 1;
          }
        }
      } else {
        // Legacy data compatibility: rewrite embedded messages array
        const existing = await this.getMessages(chatId);
        const idSet = new Set(messageIds);
        const remaining = existing.filter(m => !idSet.has(m.id));
        removed = existing.length - remaining.length;
        if (removed > 0) {
          await messagesCollection.updateOne(
            { chatId } as QueryFilter,
            {
              $set: {
                messages: remaining,
                updatedAt: now,
              },
            } as any,
          );
        }
      }

      if (removed > 0) {
        const chat = await this.ctx.findById(chatId);
        if (chat) {
          const allMessages = await this.getMessages(chatId);
          await this.ctx.update(chatId, {
            messageCount: this.countVisibleMessages(allMessages),
          } as Partial<ChatMetadata>);
        }
        logger.info('Messages deleted from chat', { chatId, removed, requested: messageIds.length });
      }

      return removed;
    }, 'Failed to delete messages from chat', { chatId, count: messageIds.length }, 0);
  }

  /**
   * Clear all messages from a chat
   */
  async clearMessages(chatId: string): Promise<boolean> {
    return safeQuery(async () => {
      const messagesCollection = await this.ctx.getMessagesCollection();
      const now = this.ctx.getCurrentTimestamp();

      if (this.ctx.isSQLiteBackend()) {
        // SQLite: Delete all message rows for this chat
        await messagesCollection.deleteMany({ chatId } as QueryFilter);
      } else {
        // Legacy data compatibility: Clear embedded messages array
        await messagesCollection.updateOne(
          { chatId } as QueryFilter,
          {
            $set: {
              messages: [],
              updatedAt: now,
            },
          } as any,
        );
      }

      // Reset metadata
      const chat = await this.ctx.findById(chatId);
      if (chat) {
        await this.ctx.update(chatId, {
          messageCount: 0,
          lastMessageAt: null,
        });
      }

      logger.info('Messages cleared for chat', { chatId });
      return true;
    }, 'Failed to clear messages for chat', { chatId }, false);
  }
}
