/**
 * Custom Tools API v1 (Pascal the Croupier)
 *
 * The operator's side of the felt. Characters reach for custom tools through
 * `run_custom`; the human reaches for them through the composer popup, and this
 * is the endpoint behind it.
 *
 * GET  /api/v1/chats/[id]/custom-tools
 *   - The roster the popup lists, resolved FRESH on every request. No caching:
 *     a `.tool.json` the user just edited must be live on the next popup open,
 *     and an index-invalidated cache would miss exactly those edits (see the
 *     freshness note atop `lib/pascal/custom-tools.ts`).
 *
 * POST /api/v1/chats/[id]/custom-tools?action=run
 *   - Run one tool at the operator's behest. Posts Pascal's outcome, and
 *     nothing else — see the note in `handleRun` on why the operator's own
 *     invocation line is not written to the transcript.
 *
 * ## Perspective
 *
 * A roster is resolved *for an invoker*, because a character-tier store shadows
 * the farther tiers — two characters in one room can hold different definitions
 * of the same tool name. The popup is the human's, and the human has no vault,
 * so GET resolves once per character participant and merges: a tool that
 * resolves identically for everyone is listed once, unlabelled; a tool that
 * differs is listed once per variant, each tagged with the character whose
 * perspective produced it. `asCharacterId` carries that choice back to POST.
 *
 * ## What is withheld
 *
 * The roll spec and the outcome table are never in the payload. The house does
 * not show the odds — the popup offers `definitionPath` and `mountName` instead,
 * so a user curious about their own tool can go read the file they wrote.
 *
 * What IS in the payload, since v4.9, is each tool's `references`: the metadata
 * keys and state paths it quotes, and whether it rolls dice or consults an
 * oracle. That is vocabulary, not odds — "this tool reads `hasAnsibleAccess`",
 * never "it succeeds when `hasAnsibleAccess` is true". See
 * `lib/pascal/tool-vocabulary.ts` for where that line is drawn.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createContextParamsHandler, type RequestContext } from '@/lib/api/middleware';
import { withActionDispatch } from '@/lib/api/middleware/actions';
import { badRequest, notFound, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import {
  resolveCustomToolRoster,
  executeCustomTool,
  CustomToolRunError,
  type CustomToolRoster,
  type DiscoveredCustomTool,
} from '@/lib/pascal/custom-tools';
import { displayTitle } from '@/lib/pascal/custom-tool.types';
import { collectToolVocabulary, type ToolVocabulary } from '@/lib/pascal/tool-vocabulary';
import { resolveStateCascade } from '@/lib/state/state-cascade';
import { buildCustomToolLlmInvoker } from '@/lib/pascal/llm-consult';
import { buildPascalResultContent, postPascalResult } from '@/lib/services/pascal/writer';
import { postProsperoCustomToolError } from '@/lib/services/prospero-notifications/writer';

const HANDLER = 'api.v1.chats.custom-tools';

/** One entry in the popup's list. Deliberately odds-free — see the file header. */
interface CustomToolListing {
  /** Identity — what `?action=run` names, and what shadowing resolved on. */
  name: string;
  /** What the popup shows. Resolved here so the client never re-derives it. */
  title: string;
  description: string;
  parameters: NonNullable<DiscoveredCustomTool['definition']['parameters']> | Record<string, never>;
  /** What this tool quotes beyond its parameters — vocabulary, never odds. */
  references: ToolVocabulary;
  defaultVisibility: 'public' | 'whisper';
  sourceTier: DiscoveredCustomTool['tier'];
  /** Set only when this tool resolves differently per character. */
  characterLabel?: string;
  /** Whose perspective produced this variant — POST replays it. */
  asCharacterId: string;
  definitionPath: string;
  /** Which store holds the file — Pascal's Workbench edits it by this pair. */
  mountPointId: string;
  mountName: string;
}

/** A character participant, paired with the vault that forms its 'character' tier. */
interface Perspective {
  characterId: string;
  characterName: string;
  characterMountPointId: string | null;
  /** The character's hydrated fact sheet, for `when.metadata` tests on a run. */
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Shared resolution
// ---------------------------------------------------------------------------

/**
 * The chat's character participants, each with its vault mount.
 *
 * A character whose vault is unreachable is dropped rather than fatal: one
 * broken vault must not take the whole popup down, matching how `findAll`
 * treats the same failure.
 */
async function loadPerspectives(
  ctx: RequestContext,
  chatId: string,
  participants: Array<{ type: string; characterId: string; isActive?: boolean }>,
): Promise<Perspective[]> {
  const perspectives: Perspective[] = [];

  for (const participant of participants) {
    if (participant.type !== 'CHARACTER') continue;

    try {
      const character = await ctx.repos.characters.findById(participant.characterId);
      if (!character) continue;
      perspectives.push({
        characterId: character.id,
        characterName: character.name,
        characterMountPointId:
          (character as unknown as Record<string, unknown>).characterDocumentMountPointId as string | null ?? null,
        // findById hydrates the vault, so the fact sheet is already in hand —
        // no second read when a run turns out to need it.
        metadata: character.metadata ?? {},
      });
    } catch (error) {
      logger.warn('Custom-tool perspective dropped — character unreadable', {
        context: HANDLER,
        chatId,
        characterId: participant.characterId,
        error: getErrorMessage(error),
      });
    }
  }

  return perspectives;
}

/** Resolve the roster as one character sees it. */
async function resolveForPerspective(
  ctx: RequestContext,
  chatId: string,
  projectId: string | null,
  perspective: Perspective,
  allCharacterIds: string[],
): Promise<CustomToolRoster> {
  return resolveCustomToolRoster({
    userId: ctx.user.id,
    chatId,
    characterId: perspective.characterId,
    characterMountPointId: perspective.characterMountPointId,
    characterIds: allCharacterIds,
    projectId,
  });
}

/** Two variants are the same deal when they came from the same file in the same store. */
function variantKey(entry: DiscoveredCustomTool): string {
  return `${entry.mountPointId}::${entry.definitionPath}`;
}


// ---------------------------------------------------------------------------
// GET — the roster
// ---------------------------------------------------------------------------

async function handleList(
  _req: NextRequest,
  ctx: RequestContext,
  { id }: { id: string },
): Promise<NextResponse> {
  const chat = await ctx.repos.chats.findById(id);
  if (!chat) return notFound('Chat');

  const perspectives = await loadPerspectives(ctx, id, chat.participants);
  if (perspectives.length === 0) {
    logger.debug('Custom-tool roster empty — chat has no readable character participants', {
      context: HANDLER,
      chatId: id,
    });
    return successResponse({ tools: [], errors: [] });
  }

  const allCharacterIds = perspectives.map((p) => p.characterId);
  const projectId = chat.projectId ?? null;

  // One roster per character. Errors are unioned by (mount, path) so the same
  // broken file seen from four perspectives earns one badge, not four.
  const byName = new Map<string, Array<{ perspective: Perspective; entry: DiscoveredCustomTool }>>();
  const errorsByKey = new Map<string, CustomToolRoster['errors'][number]>();
  const droppedForCap = new Set<string>();

  for (const perspective of perspectives) {
    const roster = await resolveForPerspective(ctx, id, projectId, perspective, allCharacterIds);

    for (const [name, entry] of roster.tools) {
      const bucket = byName.get(name) ?? [];
      bucket.push({ perspective, entry });
      byName.set(name, bucket);
    }
    for (const error of roster.errors) {
      errorsByKey.set(`${error.mountPointId}::${error.definitionPath}`, error);
    }
    for (const name of roster.droppedForCap) droppedForCap.add(name);
  }

  const tools: CustomToolListing[] = [];

  for (const [name, sightings] of byName) {
    const distinct = new Set(sightings.map((s) => variantKey(s.entry)));

    if (distinct.size === 1) {
      // Everyone resolves the same file: one unlabelled row. The perspective is
      // arbitrary but must still be recorded — POST needs someone to run as.
      const { perspective, entry } = sightings[0];
      tools.push(buildListing(entry, perspective, undefined));
      continue;
    }

    // The name means different things to different characters. Each distinct
    // file earns its own row, labelled — collapsing them would show the user a
    // tool that is not the one their character would actually reach for.
    const seen = new Set<string>();
    for (const { perspective, entry } of sightings) {
      const key = `${variantKey(entry)}::${perspective.characterId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tools.push(buildListing(entry, perspective, perspective.characterName));
    }
  }

  // Sorted by what the popup shows, not by the identity behind it — a list
  // ordered on a key the reader cannot see reads as unordered.
  tools.sort((a, b) => a.title.localeCompare(b.title) || (a.characterLabel ?? '').localeCompare(b.characterLabel ?? ''));

  const errors = [...errorsByKey.values()];

  logger.debug('Custom-tool roster resolved for the operator', {
    context: HANDLER,
    chatId: id,
    perspectives: perspectives.length,
    tools: tools.length,
    errors: errors.length,
    droppedForCap: droppedForCap.size,
  });

  return successResponse({
    tools,
    errors,
    ...(droppedForCap.size > 0 ? { droppedForCap: [...droppedForCap] } : {}),
  });
}

function buildListing(
  entry: DiscoveredCustomTool,
  perspective: Perspective,
  characterLabel: string | undefined,
): CustomToolListing {
  return {
    name: entry.definition.name,
    title: displayTitle(entry.definition),
    description: entry.definition.description,
    parameters: entry.definition.parameters ?? {},
    references: collectToolVocabulary(entry.definition),
    defaultVisibility: entry.definition.defaultVisibility ?? 'public',
    sourceTier: entry.tier,
    ...(characterLabel ? { characterLabel } : {}),
    asCharacterId: perspective.characterId,
    definitionPath: entry.definitionPath,
    mountPointId: entry.mountPointId,
    mountName: entry.mountName,
  };
}

// ---------------------------------------------------------------------------
// POST ?action=run — the deal
// ---------------------------------------------------------------------------

const runSchema = z.object({
  tool: z.string().min(1, 'A tool name is required'),
  parameters: z.record(z.string(), z.unknown()).nullish(),
  /** Whisper the run: the operator alone sees it, no character does. */
  private: z.boolean().optional(),
  /** Whose perspective to resolve from — required only when a tool has variants. */
  asCharacterId: z.string().nullish(),
});

async function handleRun(
  req: NextRequest,
  ctx: RequestContext,
  { id }: { id: string },
): Promise<NextResponse> {
  const body = runSchema.parse(await req.json());

  const chat = await ctx.repos.chats.findById(id);
  if (!chat) return notFound('Chat');

  const perspectives = await loadPerspectives(ctx, id, chat.participants);
  if (perspectives.length === 0) {
    return badRequest('This chat has no character whose perspective a custom tool could be run from');
  }

  const perspective = body.asCharacterId
    ? perspectives.find((p) => p.characterId === body.asCharacterId)
    : perspectives[0];
  if (!perspective) {
    return badRequest(`No character participant with id ${body.asCharacterId} is in this chat`);
  }

  const roster = await resolveForPerspective(
    ctx,
    id,
    chat.projectId ?? null,
    perspective,
    perspectives.map((p) => p.characterId),
  );

  const entry = roster.tools.get(body.tool);
  if (!entry) {
    const available = [...roster.tools.keys()];
    logger.debug('Manual custom-tool run named an unknown tool', {
      context: HANDLER,
      chatId: id,
      tool: body.tool,
      available,
    });
    return badRequest(
      available.length > 0
        ? `Unknown custom tool "${body.tool}". Available: ${available.join(', ')}`
        : `Unknown custom tool "${body.tool}". This chat has no custom tools available.`,
    );
  }

  // A private run is whispered to the OPERATOR's userId — a UUID that is not a
  // participant id, so every character's context filter excludes it while the
  // "show all whispers" toggle still reveals it to the human. This mirrors how
  // a user-initiated private Prospero run targets itself
  // (app/api/v1/chats/[id]/actions/run-tool.ts).
  const whispered = body.private === true;
  const targetParticipantIds = whispered ? [ctx.user.id] : null;

  // Metadata comes from the character the run is made AS. The popup always
  // names one (every listing carries an `asCharacterId`, labelled or not), so
  // in practice a popup run consults that character's sheet — consistent with
  // the roster itself, which already resolved through that character's vault
  // tier. A run that names nobody is one nobody made: it rolls against an empty
  // sheet, every metadata test declines, and the catch-all answers, rather than
  // borrowing some arbitrary participant's secrets to decide it.
  const metadata = body.asCharacterId ? perspective.metadata : {};

  // The merged state cascade the run's `$state` references resolve against. The
  // group tier follows the same asymmetry as metadata above: it is scoped to
  // the named character's own groups, or skipped entirely for a run nobody made
  // (no `asCharacterId`), rather than borrowing an arbitrary participant's
  // groups. Fail-soft — required fallbacks keep every run dealable.
  let toolState: Record<string, unknown> = {};
  try {
    const cascade = await resolveStateCascade({
      chat,
      groupScope: body.asCharacterId
        ? { kind: 'character', characterId: body.asCharacterId }
        : { kind: 'none' },
    });
    toolState = cascade.merged;
  } catch (error) {
    logger.debug('Manual custom-tool run: state cascade unavailable, defaulting to {}', {
      context: HANDLER,
      chatId: id,
      error: getErrorMessage(error),
    });
    toolState = {};
  }

  let result;
  try {
    result = await executeCustomTool(entry.definition, body.parameters ?? undefined, {
      private: body.private,
      metadata,
      state: toolState,
      ...(entry.definition.llm
        ? { llmInvoke: buildCustomToolLlmInvoker({ userId: ctx.user.id, chatId: id }) }
        : {}),
    });
  } catch (error) {
    if (error instanceof CustomToolRunError) {
      // Pascal never announces a run that did not happen — the failure is
      // Prospero's to report.
      logger.debug('Manual custom-tool run refused', {
        context: HANDLER,
        chatId: id,
        tool: body.tool,
        reason: error.message,
      });
      await postProsperoCustomToolError({
        chatId: id,
        toolName: body.tool,
        reason: error.message,
        whisper: whispered,
        callerParticipantId: whispered ? ctx.user.id : null,
      });
      return badRequest(error.message);
    }
    throw error;
  }

  // Pascal's announcement is the ONLY thing posted for a manual run, and it is
  // identical to the one a character's roll produces — the transcript does not
  // record that the operator was the one who reached for the tool, nor what
  // they set. A companion USER message ("*I ran unlock (scale: 1)*") used to
  // publish exactly that: the human's hand on the scale, from which a character
  // could infer the roll was arranged.
  const toolTitle = displayTitle(entry.definition);

  const { content, opaqueContent } = buildPascalResultContent({
    toolTitle,
    message: result.message,
  });

  const pascalMessage = await postPascalResult({
    chatId: id,
    content,
    opaqueContent,
    targetParticipantIds,
    pascalMeta: {
      tool: result.tool,
      toolTitle,
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
      invokedBy: 'user',
    },
  });

  logger.info('[Pascal] Manual custom-tool run completed', {
    context: HANDLER,
    chatId: id,
    tool: result.tool,
    state: result.state,
    whispered,
  });

  return successResponse({
    messages: pascalMessage ? [pascalMessage] : [],
    result: {
      tool: result.tool,
      value: result.value,
      state: result.state,
      message: result.message,
      whispered,
    },
  });
}

export const GET = createContextParamsHandler<{ id: string }>(withActionDispatch({}, handleList));

export const POST = createContextParamsHandler<{ id: string }>(withActionDispatch({ run: handleRun }));
