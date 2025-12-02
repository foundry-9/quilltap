/**
 * OpenRouter Pricing Fetcher for Plugin
 * Fetches real-time pricing data from OpenRouter API
 *
 * This module queries OpenRouter for available models and pricing information,
 * enabling cost-aware model selection based on current market rates.
 */

import { OpenRouter } from '@openrouter/sdk';
import { logger } from '../../../lib/logger';

export interface ModelPricing {
  modelId: string;
  name: string;
  promptCostPer1M: number;
  completionCostPer1M: number;
  contextLength: number | null;
  supportsVision: boolean;
  supportsTools: boolean;
  fetchedAt: string;
}

/**
 * Fetch pricing from OpenRouter API
 * OpenRouter is unique in exposing pricing via API for 100+ models
 */
export async function fetchOpenRouterPricing(
  apiKey: string
): Promise<ModelPricing[]> {
  try {
    logger.debug('Fetching OpenRouter pricing data', {
      context: 'fetchOpenRouterPricing',
    });

    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.NEXTAUTH_URL || 'http://localhost:3000',
      xTitle: 'Quilltap',
    });

    const response = await client.models.list();
    const models: ModelPricing[] = [];

    for (const model of response.data || []) {
      // Parse pricing (OpenRouter returns costs per token as strings)
      const promptCost = parseFloat(String(model.pricing?.prompt || '0'));
      const completionCost = parseFloat(String(model.pricing?.completion || '0'));

      // Convert from per-token to per-1M tokens
      const promptCostPer1M = promptCost * 1_000_000;
      const completionCostPer1M = completionCost * 1_000_000;

      models.push({
        modelId: model.id,
        name: model.name,
        promptCostPer1M,
        completionCostPer1M,
        contextLength: model.contextLength,
        supportsVision: model.architecture?.modality?.includes('image') || false,
        supportsTools:
          model.supportedParameters?.some(
            (p) => p === 'tools' || p === 'tool_choice'
          ) || false,
        fetchedAt: new Date().toISOString(),
      });
    }

    logger.info('Successfully fetched OpenRouter pricing', {
      context: 'fetchOpenRouterPricing',
      modelCount: models.length,
    });

    return sortByCost(models);
  } catch (error) {
    logger.error(
      'Failed to fetch OpenRouter pricing',
      { context: 'fetchOpenRouterPricing' },
      error instanceof Error ? error : undefined
    );
    return [];
  }
}

/**
 * Sort models by cost (prompt cost + completion cost)
 */
export function sortByCost(models: ModelPricing[]): ModelPricing[] {
  return [...models].sort(
    (a, b) =>
      a.promptCostPer1M +
      a.completionCostPer1M -
      (b.promptCostPer1M + b.completionCostPer1M)
  );
}

/**
 * Find the cheapest available model
 */
export function findCheapestModel(
  models: ModelPricing[],
  options?: {
    requireVision?: boolean;
    requireTools?: boolean;
  }
): ModelPricing | null {
  const candidates = models.filter((model) => {
    if (options?.requireVision && !model.supportsVision) return false;
    if (options?.requireTools && !model.supportsTools) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  return sortByCost(candidates)[0];
}

/**
 * Get pricing for a specific model
 */
export function getModelPricing(
  models: ModelPricing[],
  modelId: string
): ModelPricing | null {
  return models.find((m) => m.modelId === modelId) || null;
}

/**
 * Format cost for display
 */
export function formatCost(costPer1M: number): string {
  if (costPer1M === 0) {
    return 'Free';
  }
  if (costPer1M < 0.001) {
    return `$${(costPer1M / 1000000).toFixed(8)}/token`;
  }
  if (costPer1M < 1) {
    return `$${costPer1M.toFixed(4)}/1M`;
  }
  return `$${costPer1M.toFixed(2)}/1M`;
}
