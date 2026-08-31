/**
 * Custom-tool LLM consults — the real invoker behind `executeCustomTool`'s
 * `llmInvoke` seam.
 *
 * A definition with an `llm` block wants a generated answer folded into its
 * outcome table. This module is the one place that turns that want into an
 * actual provider call: it resolves the instance's cheap-LLM selection (the
 * same machinery titling and memory extraction ride), reroutes to the
 * uncensored profile when the chat is flagged dangerous, poses the rendered
 * prompt as a single user message with no framing of ours — the author's
 * prompt is the whole conversation — and hands back the raw answer.
 *
 * Failure semantics live one level up, in `resolveLlmConsult`
 * (`./custom-tools`): whatever goes wrong here becomes `{ ok: false, reason }`,
 * and the execution core swaps in the author's `errorMessage`. Nothing thrown
 * here ever reaches the fiction.
 *
 * Job-child safe: profile and settings reads pass through the buffered
 * repository proxy, and the provider call itself is plain outbound HTTP — the
 * same shape as every cheap-LLM task the child already runs.
 */

import { getErrorMessage } from '@/lib/error-utils';
import { withTimeout } from '@/lib/promise-timeout';
import { getRepositories } from '@/lib/repositories/factory';
import { getCheapLLMProvider, resolveUncensoredCheapLLMSelection } from '@/lib/llm/cheap-llm';
import { buildCheapLLMConfig } from '@/lib/wardrobe/apply-outfit-selections';
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution';
import { resolveDangerousContentSettings } from '@/lib/services/dangerous-content/resolver.service';
import { shouldUseUncensoredRoute } from '@/lib/services/dangerous-content/chat-override';
import { MAX_LLM_OUTPUT_LENGTH } from './custom-tool.types';
import type { LlmInvokeOptions, LlmInvoker, LlmInvokeResult } from './custom-tools';

const CONTEXT = 'pascal.llm-consult';

/**
 * Hard ceiling on one consult. The cheap-LLM pipeline carries no timeout of
 * its own (provider HTTP clients govern), but a consult blocks a tool call in
 * a live turn — a hung provider must become the author's error message, not a
 * wedged chat.
 */
export const CONSULT_TIMEOUT_MS = 60_000;

/** Who is consulting, and from where. */
export interface CustomToolConsultContext {
  userId: string;
  /**
   * The chat the run belongs to — drives Concierge rerouting and log
   * attribution. Null for Pascal's Workbench, whose bench runs belong to no
   * room and are never rerouted.
   */
  chatId?: string | null;
}

/**
 * Token budget for one consult, scaled from the effective output cap so a
 * long-form consult is not starved at the provider. ~3 characters per token is
 * a safe under-estimate for English-with-markdown, and the floor matches the
 * cheap-LLM pipeline's own (it clamps anything lower up to 2048 anyway). The
 * ceiling keeps a runaway `maxOutput` from requesting an absurd budget —
 * providers clamp to their models' real limits beyond it regardless.
 */
export function consultMaxTokens(maxOutputChars: number): number {
  return Math.min(Math.max(Math.ceil(maxOutputChars / 3), 2048), 32_768);
}


async function consult(
  context: CustomToolConsultContext,
  prompt: string,
  options: LlmInvokeOptions | undefined
): Promise<LlmInvokeResult> {
  const { userId, chatId } = context;
  const repos = getRepositories();

  const [chatSettings, profiles] = await Promise.all([
    repos.chatSettings.findByUserId(userId),
    repos.connections.findByUserId(userId),
  ]);

  if (profiles.length === 0) {
    return { ok: false, reason: 'no connection profiles are configured' };
  }

  const chat = chatId ? await repos.chats.findById(chatId) : null;

  // Selection priority is the standard cheap-LLM ladder; `profiles[0]` is only
  // the last-resort "current profile" the ladder falls back to when nothing is
  // marked cheap — a consult has no chat-turn profile of its own to offer.
  const config = buildCheapLLMConfig(chatSettings);
  let selection = getCheapLLMProvider(profiles[0], config, profiles);

  const resolvedDanger = resolveDangerousContentSettings(chatSettings, chat ?? undefined);
  const dangerous = shouldUseUncensoredRoute(chat);
  if (dangerous) {
    selection = resolveUncensoredCheapLLMSelection(selection, true, resolvedDanger.settings, profiles);
  }

  const maxTokens = consultMaxTokens(options?.maxOutputChars ?? MAX_LLM_OUTPUT_LENGTH);


  const task = await executeCheapLLMTask<string>(
    selection,
    // The author's rendered prompt is the entire conversation. No system
    // framing of ours: what the oracle is asked is the author's to write.
    [{ role: 'user', content: prompt }],
    userId,
    (content) => content,
    'custom-tool-consult',
    chatId ?? undefined,
    undefined,
    { dangerSettings: resolvedDanger.settings, availableProfiles: profiles, isDangerousChat: dangerous },
    maxTokens
  );

  if (!task.success || typeof task.result !== 'string') {
    return { ok: false, reason: task.error ?? 'the model returned nothing' };
  }

  return { ok: true, output: task.result, provider: selection.provider, model: selection.modelName };
}

/**
 * Build the invoker an entrance hands to `executeCustomTool`. One invoker per
 * run context; each invocation resolves settings and profiles fresh, so a
 * cheap-model change is live on the very next roll.
 */
export function buildCustomToolLlmInvoker(context: CustomToolConsultContext): LlmInvoker {
  return async (prompt: string, options?: LlmInvokeOptions): Promise<LlmInvokeResult> => {
    try {
      // The reason reaches the author's `errorMessage` path, so it is phrased
      // for a person reading a failed roll — seconds, not milliseconds.
      return await withTimeout(
        consult(context, prompt, options),
        CONSULT_TIMEOUT_MS,
        `the consult timed out after ${Math.round(CONSULT_TIMEOUT_MS / 1000)}s`
      );
    } catch (error) {
      return { ok: false, reason: getErrorMessage(error) };
    }
  };
}
