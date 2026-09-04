/**
 * Character Head-and-Shoulders Backfill Handler
 *
 * Generates the `headAndShouldersPrompt` physical-description variant for a
 * single character that lacks one. The avatar generator prefers this variant
 * (avatars are a head-and-shoulders crop), so backfilling it stops full-body
 * anatomy from leaking into avatar prompts and tripping image-provider
 * moderation. Enqueued once per existing character by the startup backfill
 * (lib/startup/enqueue-headshoulders-backfill.ts); new characters get the field
 * at creation via the wizard / AI-import.
 *
 * Runs in the forked job child. Writing physicalDescription routes through the
 * vault write overlay → writeDatabaseDocument → docMountFileLinks.linkDocumentContent,
 * a child-safe buffered 'write' (no host-RPC needed, unlike avatar image bytes).
 * We read the existing physicalDescription ONCE, merge, and write the COMPLETE
 * object — renderPhysicalPromptsJson re-renders every key, so a partial write
 * would null the other prompt tiers.
 */
import type { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { buildCheapLLMConfig } from '@/lib/llm/cheap-llm';
import {
  selectCheapLLMFromProfiles,
  type UserCheapLLMSelection,
} from '@/lib/llm/cheap-llm-user-selection';
import { getApiKeyForCheapLLMSelection } from '@/lib/services/api-key.service';
import { createLLMProvider } from '@/lib/llm/plugin-factory';
import {
  buildContextPrompt,
  generateField,
  HEAD_AND_SHOULDERS_PHYSICAL_PROMPT,
} from '@/lib/services/character-wizard.service';
import type { CharacterHeadShouldersBackfillPayload } from '../queue-service';

const CONTEXT = 'background-jobs.headshoulders-backfill';

export async function handleCharacterHeadShouldersBackfill(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as CharacterHeadShouldersBackfillPayload;
  const repos = getRepositories();

  const character = await repos.characters.findById(payload.characterId);
  if (!character) {
    logger.info('[HeadShouldersBackfill] Character not found, skipping', {
      context: CONTEXT,
      jobId: job.id,
      characterId: payload.characterId,
    });
    return;
  }

  const pd = character.physicalDescription;
  if (!pd) {
    return;
  }

  // Idempotent: another path (or a prior attempt) may have filled it.
  if (pd.headAndShouldersPrompt && pd.headAndShouldersPrompt.trim()) {
    return;
  }

  // Seed text the generator grounds the head-and-shoulders prompt in. Prefer
  // the most portrait-relevant existing variant; fall through to any appearance
  // text. (Same ordering the avatar builder falls through, minus the new field.)
  const seedText = (
    pd.mediumPrompt ||
    pd.shortPrompt ||
    pd.longPrompt ||
    pd.completePrompt ||
    pd.fullDescription ||
    ''
  ).trim();
  if (!seedText) {
    return;
  }

  // Resolve a cheap-LLM provider — mirrors the character-avatar handler's
  // danger-classification selection.
  const chatSettings = await repos.chatSettings.findByUserId(job.userId) ?? undefined;
  const allProfiles = await repos.connections.findByUserId(job.userId);

  // The profile read stays outside the guard on purpose: a failing read is the
  // job's failure to report, only a failing selection is worth skipping over.
  let resolved: UserCheapLLMSelection | null;
  try {
    resolved = selectCheapLLMFromProfiles(allProfiles, buildCheapLLMConfig(chatSettings));
  } catch (error) {
    logger.warn('[HeadShouldersBackfill] Failed to select cheap LLM, skipping', {
      context: CONTEXT,
      jobId: job.id,
      error: getErrorMessage(error),
    });
    return;
  }

  if (!resolved) {
    logger.warn('[HeadShouldersBackfill] No connection profile configured, skipping', {
      context: CONTEXT,
      jobId: job.id,
      characterId: payload.characterId,
    });
    return;
  }
  const { selection } = resolved;

  const apiKey = await getApiKeyForCheapLLMSelection(selection, job.userId);
  if (apiKey === null) {
    logger.warn('[HeadShouldersBackfill] No API key for cheap LLM selection, skipping', {
      context: CONTEXT,
      jobId: job.id,
    });
    return;
  }

  const provider = await createLLMProvider(selection.provider, selection.baseUrl);

  // Pass the seed appearance text as the "visual reference" — buildContextPrompt
  // frames imageDescription as physical-appearance-only grounding.
  const contextPrompt = buildContextPrompt(character.name, '', undefined, seedText);

  const content = await generateField(
    provider,
    apiKey,
    selection.modelName,
    contextPrompt,
    HEAD_AND_SHOULDERS_PHYSICAL_PROMPT,
    350,
    job.userId,
    payload.characterId,
    selection.provider,
  );

  const headAndShouldersPrompt = content.substring(0, 500).trim();
  if (!headAndShouldersPrompt) {
    logger.warn('[HeadShouldersBackfill] Model returned empty text, skipping write', {
      context: CONTEXT,
      jobId: job.id,
      characterId: payload.characterId,
    });
    return;
  }

  // Write the COMPLETE merged object so the JSON re-render keeps the other tiers.
  await repos.characters.update(payload.characterId, {
    physicalDescription: {
      ...pd,
      headAndShouldersPrompt,
      updatedAt: new Date().toISOString(),
    },
  });

  logger.info('[HeadShouldersBackfill] Populated head-and-shoulders prompt', {
    context: CONTEXT,
    jobId: job.id,
    characterId: payload.characterId,
    length: headAndShouldersPrompt.length,
  });
}
