/**
 * OpenRouter Pricing Fetcher for Plugin
 * Fetches real-time pricing data from OpenRouter API
 *
 * This module queries OpenRouter for available models and pricing information,
 * enabling cost-aware model selection based on current market rates.
 */

import { OpenRouter } from '@openrouter/sdk';
import { Parameter } from '@openrouter/sdk/models';
import { createPluginLogger, getQuilltapUserAgent } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-openrouter');

export interface ModelPricing {
  modelId: string;
  name: string;
  promptCostPer1M: number;
  completionCostPer1M: number;
  contextLength: number | null;
  supportsVision: boolean;
  supportsImageGeneration: boolean;
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
    const client = new OpenRouter({
      apiKey,
      httpReferer: process.env.BASE_URL || 'http://localhost:3000',
      appTitle: getQuilltapUserAgent(),
    });

    // models.list() returns a paginated async-iterable and the model array
    // lives at page.result.data. This read was left on the pre-0.13
    // `response.data`, which is undefined on a PageIterator — so it silently
    // produced zero prices.
    const pages = await client.models.list();
    const models: ModelPricing[] = [];

    for await (const page of pages) {
      for (const model of page.result?.data ?? []) {
        // Parse pricing (OpenRouter returns costs per token as strings)
        const promptCost = parseFloat(String(model.pricing?.prompt || '0'));
        const completionCost = parseFloat(String(model.pricing?.completion || '0'));

        // Convert from per-token to per-1M tokens
        const promptCostPer1M = promptCost * 1_000_000;
        const completionCostPer1M = completionCost * 1_000_000;

        // Check input modality for vision support (can receive images)
        const inputModality = model.architecture?.modality;
        const supportsVision = inputModality?.includes('image') || false;

        // Check output modality for image generation support (can produce images)
        // OpenRouter exposes this via output_modalities array, architecture.outputModality,
        // or supported_generation_methods
        const modelAny = model as any;
        const outputModalities = modelAny.output_modalities || modelAny.outputModalities;
        const outputModality = modelAny.architecture?.outputModality;
        const supportsImageGeneration =
          (Array.isArray(outputModalities) && outputModalities.includes('image')) ||
          (typeof outputModality === 'string' && outputModality.includes('image')) ||
          modelAny.supported_generation_methods?.includes('image') ||
          false;

        models.push({
          modelId: model.id,
          name: model.name,
          promptCostPer1M,
          completionCostPer1M,
          contextLength: model.contextLength,
          supportsVision,
          supportsImageGeneration,
          supportsTools:
            model.supportedParameters?.some(
              (p) => p === Parameter.Tools || p === Parameter.ToolChoice
            ) ?? false,
          fetchedAt: new Date().toISOString(),
        });
      }
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
    requireImageGeneration?: boolean;
    requireTools?: boolean;
  }
): ModelPricing | null {
  const candidates = models.filter((model) => {
    if (options?.requireVision && !model.supportsVision) return false;
    if (options?.requireImageGeneration && !model.supportsImageGeneration)
      return false;
    if (options?.requireTools && !model.supportsTools) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  return sortByCost(candidates)[0];
}

/**
 * Get all models that support image generation
 */
export function getImageGenerationModels(
  models: ModelPricing[]
): ModelPricing[] {
  return models.filter((model) => model.supportsImageGeneration);
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
