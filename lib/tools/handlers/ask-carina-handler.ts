/**
 * Ask Carina Tool Handler
 *
 * Executes the ask_carina tool by routing the question to the Carina service,
 * which runs a minimal isolated LLM call against the named answerer character.
 * On success the service already posts the answer as a chat message; this
 * handler simply surfaces the answer text to the calling LLM. On failure it
 * posts a Prospero error announcement and returns a short human-readable error.
 */

import { logger } from '@/lib/logger';
import { validateAskCarinaInput } from '../ask-carina-tool';
import type { AskCarinaToolOutput } from '../ask-carina-tool';
import type { MessageEvent } from '@/lib/schemas/types';

export type { AskCarinaToolOutput };

/**
 * Context required for ask_carina tool execution
 */
export interface AskCarinaToolContext {
  userId: string;
  chatId: string;
  /** Participant ID of the character invoking the tool (for whisper targeting). */
  callingParticipantId?: string | null;
  /**
   * Surface the answer to the Salon the instant it posts, via the turn's live
   * SSE stream. Forwarded to `runCarinaQuery` as `onPosted`. Absent in the
   * autonomous-room/forked-child path (no client stream).
   */
  emitCarinaAnswer?: (message: MessageEvent) => void;
}

const moduleLogger = logger.child({ module: 'ask-carina-handler' });

/**
 * Derive a short human-readable error string from a CarinaErrorKind.
 */
function errorMessage(
  kind: 'not-found' | 'no-profile' | 'llm-failed',
  detail?: string | null,
): string {
  switch (kind) {
    case 'not-found':
      return 'No answerer by that name is on duty.';
    case 'no-profile':
      return 'The answerer has no connection to an LLM provider.';
    case 'llm-failed':
      return `The answerer was unable to respond${detail ? ` — ${detail}` : ''}.`;
  }
}

/**
 * Execute the ask_carina tool.
 *
 * @param input - Raw tool input (validated internally).
 * @param context - Execution context with userId, chatId, and optional caller participant.
 * @returns Tool output with the answer text, or an error description.
 */
export async function executeAskCarinaTool(
  input: unknown,
  context: AskCarinaToolContext,
): Promise<AskCarinaToolOutput> {
  try {
    const parsed = validateAskCarinaInput(input);
    if (!parsed) {
      moduleLogger.warn('ask_carina validation failed', {
        chatId: context.chatId,
        userId: context.userId,
        input,
      });
      return { success: false, answer: '', error: 'Invalid input: character and question are required' };
    }

    // Dynamic import to break the static import cycle:
    //   tool-executor → ask-carina-handler → carina.service
    //                 → tool-execution.service → tool-executor
    const { runCarinaQuery } = await import('@/lib/services/carina/carina.service');
    const result = await runCarinaQuery({
      userId: context.userId,
      chatId: context.chatId,
      characterName: parsed.character,
      question: parsed.question,
      whisper: parsed.whisper,
      askerParticipantId: context.callingParticipantId ?? null,
      onPosted: context.emitCarinaAnswer,
    });

    if (result.ok) {
      return { success: true, answer: result.answer };
    }

    // Post a Prospero error announcement so the operator can see what went wrong.
    const { postProsperoCarinaError } = await import('@/lib/services/prospero-notifications/writer');
    await postProsperoCarinaError({
      chatId: context.chatId,
      kind: result.error.kind,
      characterName: result.error.characterName,
      detail: result.error.detail,
      whisper: parsed.whisper,
      askerParticipantId: context.callingParticipantId ?? null,
    });

    const errMsg = errorMessage(result.error.kind, result.error.detail);
    moduleLogger.info('ask_carina failed', {
      chatId: context.chatId,
      kind: result.error.kind,
      characterName: result.error.characterName,
      detail: result.error.detail,
    });
    return { success: false, answer: '', error: errMsg };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unexpected error in ask_carina handler';
    moduleLogger.error('ask_carina handler threw unexpectedly', { chatId: context.chatId }, error instanceof Error ? error : undefined);
    return { success: false, answer: '', error: msg };
  }
}

/**
 * Format the ask_carina output for inclusion in the calling LLM's context.
 */
export function formatAskCarinaResults(output: AskCarinaToolOutput): string {
  return output.success ? output.answer : (output.error || 'Carina was unable to answer.');
}
