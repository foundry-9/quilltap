/**
 * Run Custom Tool Handler
 *
 * Executes one of Pascal's user-authored pseudo-tools on a model's behalf:
 * resolve the roster, look the tool up, roll it server-side, and let Pascal
 * announce the outcome.
 *
 * The model receives a compact result — it needs to know what happened in order
 * to narrate it — but the visible artifact is Pascal's own message, which the
 * model did not write. A failure therefore cannot be narrated into a success,
 * and regenerating the reply does not re-roll.
 *
 * Job-child safe: the roll and the outcome evaluation are pure computation, and
 * the single write goes through the buffered `getRepositories()` proxy. Nothing
 * here reads back what it just wrote.
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { getRepositories } from '@/lib/repositories/factory';
import {
  resolveCustomToolRoster,
  executeCustomTool,
  CustomToolRunError,
  type CustomToolRunResult,
  type DiscoveredCustomTool,
} from '@/lib/pascal/custom-tools';
import { displayTitle } from '@/lib/pascal/custom-tool.types';
import { applyCustomToolEffects } from '@/lib/pascal/side-effects';
import { resolveStateCascade, type StateCascadeResult } from '@/lib/state/state-cascade';
import { buildCustomToolLlmInvoker } from '@/lib/pascal/llm-consult';
import { buildPascalResultContent, postPascalResult } from '@/lib/services/pascal/writer';
import { postProsperoCustomToolError } from '@/lib/services/prospero-notifications/writer';
import type { MessageEvent } from '@/lib/schemas/chat.types';
import { validateRunCustomInput, type RunCustomToolInput, type RunCustomToolOutput } from '../run-custom-tool';

const CONTEXT = 'run-custom-handler';

/**
 * Context required for run_custom execution.
 */
export interface RunCustomToolContext {
  /** User ID for ownership and logging. */
  userId: string;
  /** Chat the roll belongs to. */
  chatId: string;
  /** The rolling character — their vault is the 'character' tier. */
  characterId?: string | null;
  /** Fast path for the character's vault; the group tier still needs characterId. */
  characterMountPointId?: string | null;
  /** Every character in the chat — their vaults form the 'participant' tier. */
  characterIds?: string[];
  /** Active project, for the 'project' tier. */
  projectId?: string | null;
  /** The caller's participant id — the whisper target for a private roll. */
  callerParticipantId?: string | null;
  /**
   * Optional sink for the posted Pascal message, so the caller can surface it
   * over SSE the instant it lands rather than waiting for the post-turn refetch.
   */
  onPosted?: (message: MessageEvent) => void;
}

/** Shape the failure the same way whether it was a bad input or a bad roll. */
function failure(error: string, tool?: string): RunCustomToolOutput {
  return { success: false, ...(tool ? { tool } : {}), error };
}

/**
 * Post the Prospero error bubble for a failed run and return the model's result.
 *
 * Pascal only ever announces genuine outcomes, so a failure is Prospero's to
 * report — there is no Pascal message for a roll that never happened.
 */
async function reportFailure(
  context: RunCustomToolContext,
  toolName: string,
  reason: string,
  whisper: boolean
): Promise<RunCustomToolOutput> {
  logger.warn('Custom tool run failed', {
    context: CONTEXT,
    userId: context.userId,
    chatId: context.chatId,
    tool: toolName,
    reason,
  });

  await postProsperoCustomToolError({
    chatId: context.chatId,
    toolName,
    reason,
    whisper,
    callerParticipantId: context.callerParticipantId ?? null,
  });

  return failure(reason, toolName);
}

/**
 * Execute the run_custom tool.
 */
export async function executeRunCustomTool(
  input: unknown,
  context: RunCustomToolContext
): Promise<RunCustomToolOutput> {
  const parsed = validateRunCustomInput(input);
  if (!parsed) {
    logger.warn('run_custom validation failed', { context: CONTEXT, userId: context.userId, input });
    return failure('Invalid input: `tool` must be the name of an available custom tool.');
  }

  const { tool: toolName, parameters, private: isPrivate } = parsed;


  // The rolling character's fact sheet, read BEFORE the roster: availability
  // gates are answered against it, so a tool the sheet disqualifies is never
  // even listed. `findById` hydrates the vault, and throws
  // CharacterVaultUnavailableError when that vault is broken — which lands on
  // the same Prospero error bubble as any other refused run, since neither a
  // gate nor a table that consults metadata can honestly be dealt without it.
  let metadata: Record<string, unknown> = {};
  if (context.characterId) {
    try {
      const character = await getRepositories().characters.findById(context.characterId);
      metadata = character?.metadata ?? {};
    } catch (error) {
      return reportFailure(
        context,
        toolName,
        `the rolling character's vault could not be read: ${getErrorMessage(error)}`,
        // No definition in hand yet, so its `defaultVisibility` is unknowable:
        // only an explicit `private: true` can whisper this one.
        isPrivate === true
      );
    }
  }

  // Resolved fresh: a definition added or edited mid-chat is live on this call.
  const roster = await resolveCustomToolRoster({
    userId: context.userId,
    chatId: context.chatId,
    characterId: context.characterId ?? null,
    characterMountPointId: context.characterMountPointId ?? null,
    characterIds: context.characterIds,
    projectId: context.projectId ?? null,
    metadata,
  });

  const entry: DiscoveredCustomTool | undefined = roster.tools.get(toolName);
  if (!entry) {
    const available = [...roster.tools.keys()];
    // A name the model invented, or a file the user just deleted. Either way
    // this is not worth an error bubble in the transcript — tell the model.
    logger.warn('run_custom named an unknown tool', {
      context: CONTEXT,
      chatId: context.chatId,
      tool: toolName,
      available,
    });
    return failure(
      available.length
        ? `No custom tool named "${toolName}". Available: ${available.join(', ')}.`
        : `No custom tool named "${toolName}". This scene has none.`,
      toolName
    );
  }

  // The state cascade (chat → project → group → general) the run's `$state`
  // references resolve against — retained WHOLE, not just `.merged`, because
  // the effect applier needs the per-tier objects to decide where a write
  // lives. Read once here; never re-read (the job-child contract). Scoped to
  // the rolling character's own groups (Knowledge's rule). Fail-soft: every
  // `$state` ref carries a required fallback, so a run is always dealable even
  // if state can't be read — state effects then skip.
  let cascade: StateCascadeResult | null = null;
  try {
    const chat = await getRepositories().chats.findById(context.chatId);
    if (chat) {
      cascade = await resolveStateCascade({
        chat,
        groupScope: context.characterId
          ? { kind: 'character', characterId: context.characterId }
          : { kind: 'none' },
      });
    }
  } catch (error) {
    logger.debug('run_custom: state cascade unavailable, defaulting to {}', {
      context: CONTEXT,
      chatId: context.chatId,
      error: getErrorMessage(error),
    });
    cascade = null;
  }
  const toolState = cascade?.merged ?? {};

  let result: CustomToolRunResult;
  try {
    result = await executeCustomTool(entry.definition, parameters ?? null, {
      private: isPrivate,
      metadata,
      state: toolState,
      // Only built when the definition wants one; the invoker resolves the
      // cheap-LLM selection fresh on each consult.
      ...(entry.definition.llm
        ? { llmInvoke: buildCustomToolLlmInvoker({ userId: context.userId, chatId: context.chatId }) }
        : {}),
    });
  } catch (error) {
    const reason = error instanceof CustomToolRunError ? error.message : getErrorMessage(error);
    const whisper = isPrivate ?? entry.definition.defaultVisibility === 'whisper';
    return reportFailure(context, toolName, reason, whisper);
  }

  // Effects apply BEFORE the Pascal post: if the post then fails, the effects
  // stand — they happened, and the existing "outcome could not be posted"
  // failure path still tells the model. (A throw inside executeCustomTool
  // means no effects were ever applied.) The applier never throws.
  const appliedEffects = result.effects?.length
    ? await applyCustomToolEffects({
        chatId: context.chatId,
        toolName: result.tool,
        effects: result.effects,
        cascade,
        characterId: context.characterId ?? null,
        metadataSnapshot: metadata,
      })
    : [];

  const whispered = result.visibility === 'whisper';

  // A private roll is whispered to the rolling character alone: every other
  // participant's context excludes it. The human operator sees it regardless —
  // Pascal is one of the operator-facing senders the Salon's whisper filter
  // exempts (see app/salon/[id]/whisper-visibility.ts).
  const targetParticipantIds =
    whispered && context.callerParticipantId ? [context.callerParticipantId] : null;

  const toolTitle = displayTitle(entry.definition);

  const { content, opaqueContent } = buildPascalResultContent({
    toolTitle,
    ...(result.chipLabel ? { chipLabel: result.chipLabel } : {}),
    message: result.message,
  });

  const posted = await postPascalResult({
    chatId: context.chatId,
    content,
    opaqueContent,
    targetParticipantIds,
    pascalMeta: {
      tool: result.tool,
      toolTitle,
      ...(result.chipLabel ? { chipLabel: result.chipLabel } : {}),
      definitionTier: entry.tier,
      definitionMountId: entry.mountPointId,
      params: result.params,
      rollForm: result.rollForm,
      ...(result.notation ? { notation: result.notation } : {}),
      raw: result.raw,
      ...(result.diceRolls ? { diceRolls: result.diceRolls } : {}),
      value: result.value,
      state: result.state,
      outcomeIndex: result.outcomeIndex,
      ...(result.metadataTested ? { metadataTested: result.metadataTested } : {}),
      ...(result.llm ? { llm: result.llm } : {}),
      ...(appliedEffects.length ? { effects: appliedEffects } : {}),
      invokedBy: 'llm',
      ...(context.callerParticipantId ? { callerParticipantId: context.callerParticipantId } : {}),
    },
  });

  if (posted) {
    context.onPosted?.(posted);
  } else {
    // The roll was real but the announcement did not land. Say so rather than
    // letting the model narrate an outcome the transcript has no record of.
    return reportFailure(
      context,
      toolName,
      'the outcome could not be posted to the chat',
      whispered
    );
  }

  logger.info('Custom tool run completed', {
    context: CONTEXT,
    userId: context.userId,
    chatId: context.chatId,
    tool: result.tool,
    tier: entry.tier,
    rollForm: result.rollForm,
    value: result.value,
    state: result.state,
    outcomeIndex: result.outcomeIndex,
    whispered,
  });

  return {
    success: true,
    tool: result.tool,
    value: result.value,
    state: result.state,
    message: result.message,
    whispered,
  };
}

/**
 * Format a run_custom result for the model's context.
 *
 * Deliberately terse: the model already has the outcome message, and Pascal's
 * bubble is what the scene reads.
 */
export function formatRunCustomResults(output: RunCustomToolOutput): string {
  if (!output.success) {
    return `Custom tool error: ${output.error || 'Unknown error'}`;
  }
  const whisper = output.whispered ? ' (whispered — only you saw this)' : '';
  return `${output.tool}: ${output.message} [${output.state}]${whisper}`;
}
