/**
 * Self-Inventory Tool Handler
 *
 * Assembles the eight-section introspection report. Each section is wrapped
 * in a try/catch so a single failing lookup yields an "unavailable" marker
 * rather than throwing the whole report away.
 *
 * The report is split across this directory by responsibility:
 *   - `self-inventory/helpers.ts`    — shared context type + low-level helpers,
 *   - `self-inventory/builders.ts`   — the GATHER half (`build*`/`resolve*`),
 *   - `self-inventory/formatters.ts` — the RENDER half (`format*`).
 * This file is the orchestrator: it resolves the requested sections, drives the
 * builders, and re-exports the public surface (`formatSelfInventoryResults`,
 * `SelfInventoryToolContext`) so callers keep importing from one place.
 */

import packageJson from '@/package.json';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import {
  SELF_INVENTORY_SECTIONS,
  SelfInventoryToolOutput,
  validateSelfInventoryInput,
  type SelfInventorySection,
} from '../self-inventory-tool';
import {
  getErrorMessage,
  HIGH_IMPORTANCE_THRESHOLD,
  type SelfInventoryToolContext,
} from './self-inventory/helpers';
import {
  buildVaultWrapper,
  buildVaultAccessWrapper,
  buildMemorySection,
  buildLoadedMemoriesSection,
  buildChatsSection,
  buildPromptSection,
  buildLastTurnSection,
  buildCarinaSection,
  buildQuilltapSection,
  buildContextSection,
  resolveVaultIncludedParts,
  resolveVaultAccessIncludedParts,
  resolveQuilltapIncludedParts,
  resolveContextIncludedParts,
} from './self-inventory/builders';

export { formatSelfInventoryResults } from './self-inventory/formatters';
export type { SelfInventoryToolContext } from './self-inventory/helpers';

function resolveRequestedSections(input: unknown): Set<SelfInventorySection> {
  const parsed = input as { sections?: SelfInventorySection[] } | null | undefined;
  const requested = parsed?.sections;
  if (!requested || requested.length === 0) {
    return new Set(SELF_INVENTORY_SECTIONS);
  }
  return new Set(requested);
}

export async function executeSelfInventoryTool(
  input: unknown,
  context: SelfInventoryToolContext
): Promise<SelfInventoryToolOutput> {
  const parsed = validateSelfInventoryInput(input);
  if (!parsed) {
    logger.warn('self_inventory: invalid input', {
      context: 'self-inventory-handler',
      userId: context.userId,
    });
  }

  const requested = resolveRequestedSections(parsed ?? input);

  if (!context.characterId) {
    return {
      success: false,
      quilltapVersion: packageJson.version,
      characterId: '',
      characterName: '',
      error: 'self_inventory requires a character context',
    };
  }

  const repos = getRepositories();
  const character = await repos.characters.findById(context.characterId);
  if (!character) {
    return {
      success: false,
      quilltapVersion: packageJson.version,
      characterId: context.characterId,
      characterName: '',
      error: `Character ${context.characterId} not found`,
    };
  }

  const result: SelfInventoryToolOutput = {
    success: true,
    quilltapVersion: packageJson.version,
    characterId: character.id,
    characterName: character.name,
  };

  const includeAutomaticImages = Boolean(
    (parsed ?? (input as { includeAutomaticImages?: boolean } | null | undefined))?.includeAutomaticImages
  );

  const vaultParts = resolveVaultIncludedParts(requested);
  if (vaultParts) {
    result.vault = await buildVaultWrapper(character, vaultParts, includeAutomaticImages);
  }

  const vaultAccessParts = resolveVaultAccessIncludedParts(requested);
  if (vaultAccessParts) {
    result.vaultAccess = await buildVaultAccessWrapper(character, context, vaultAccessParts);
  }

  if (requested.has('memory')) {
    result.memory = await buildMemorySection(
      context.characterId
    ).catch((err) => ({
      available: false,
      totalCount: 0,
      highImportanceCount: 0,
      highImportancePercent: 0,
      threshold: HIGH_IMPORTANCE_THRESHOLD,
      message: getErrorMessage(err),
    }));
  }

  if (requested.has('loadedMemories')) {
    result.loadedMemories = buildLoadedMemoriesSection(
      context.loadedMemories
    );
  }

  if (requested.has('chats')) {
    result.chats = await buildChatsSection(
      context.characterId
    ).catch((err) => ({
      available: false,
      chatCount: 0,
      earliestCreatedAt: null,
      latestActivityAt: null,
      message: getErrorMessage(err),
    }));
  }

  if (requested.has('prompt')) {
    result.prompt = await buildPromptSection(
      character,
      context
    ).catch((err) => ({
      available: false,
      systemPrompt: null,
      characterCount: 0,
      approxTokens: null,
      message: getErrorMessage(err),
    }));
  }

  if (requested.has('lastTurn')) {
    result.lastTurn = await buildLastTurnSection(
      character,
      context
    ).catch((err) => ({
      available: false,
      source: null,
      provider: null,
      modelName: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      contextWindow: null,
      utilizationPercent: null,
      loggedAt: null,
      message: getErrorMessage(err),
    }));
  }

  if (requested.has('carina')) {
    result.carina = await buildCarinaSection(
      context.characterId
    ).catch((err) => ({
      available: false as const,
      message: getErrorMessage(err),
    }));
  }

  const includedQuilltapParts = resolveQuilltapIncludedParts(requested);
  if (includedQuilltapParts) {
    try {
      result.quilltap = buildQuilltapSection(includedQuilltapParts);
    } catch (err) {
      result.quilltap = {
        available: false,
        includedParts: includedQuilltapParts,
        version: packageJson.version,
        runtimeMode: 'local-dev',
        clientShell: { type: 'unknown' },
        releaseNotes: null,
        releaseNotesVersion: null,
        changelog: null,
        message: getErrorMessage(err),
      };
    }
  }

  const contextParts = resolveContextIncludedParts(requested);
  if (contextParts) {
    result.context = await buildContextSection(character, context, contextParts).catch(() => ({
      includedParts: contextParts,
    }));
  }

  return result;
}
