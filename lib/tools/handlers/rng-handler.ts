/**
 * RNG (Random Number Generator) Tool Handler
 *
 * Executes random number generation for dice rolls, coin flips,
 * and spin the bottle (random participant selection).
 *
 * Uses crypto.randomBytes() for cryptographically secure random numbers.
 */

import {
  RngToolInput,
  RngToolOutput,
  RngResult,
  RngType,
  validateRngInput,
} from '../rng-tool';
import { secureRandomInt, rollDice, flipCoin } from '@/lib/pascal/dice';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';

/**
 * Context required for RNG tool execution
 */
export interface RngToolContext {
  /** User ID for authentication and logging */
  userId: string;
  /** Chat ID for spin_the_bottle participant lookup */
  chatId: string;
}

/**
 * Error thrown during RNG execution
 */
export class RngError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'EXECUTION_ERROR' | 'NO_PARTICIPANTS'
  ) {
    super(message);
    this.name = 'RngError';
  }
}

/**
 * Get all active participants from a chat for spin the bottle
 * Includes both AI-controlled and user-controlled characters
 */
async function getChatParticipants(chatId: string, userId: string): Promise<string[]> {
  const repos = getRepositories();
  const chat = await repos.chats.findById(chatId);

  if (!chat || chat.userId !== userId) {
    return [];
  }

  const participants: string[] = [];

  for (const p of chat.participants) {
    if (!p.isActive) continue;

    // All participants are type 'CHARACTER' - look up character name
    if (p.characterId) {
      const character = await repos.characters.findById(p.characterId);
      if (character) {
        participants.push(character.name);
      }
    }
  }

  return participants;
}

/**
 * Execute spin the bottle - randomly select a participant
 */
async function spinTheBottle(
  count: number,
  chatId: string,
  userId: string
): Promise<{ results: string[]; error?: string }> {
  const participants = await getChatParticipants(chatId, userId);

  if (participants.length === 0) {
    return { results: [], error: 'No active participants found in chat' };
  }

  if (participants.length === 1) {
    // Only one participant - just return them for each spin
    return { results: Array(count).fill(participants[0]) };
  }

  const results: string[] = [];
  for (let i = 0; i < count; i++) {
    const index = secureRandomInt(participants.length) - 1;
    results.push(participants[index]);
  }

  return { results };
}

/**
 * Execute the RNG tool
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID and chat ID
 * @returns Tool output with random results
 */
export async function executeRngTool(
  input: unknown,
  context: RngToolContext
): Promise<RngToolOutput> {
  try {
    // Validate input
    const parsed = validateRngInput(input);
    if (!parsed) {
      logger.warn('RNG validation failed', { userId: context.userId, input });
      return {
        success: false,
        type: typeof input === 'object' && input !== null && 'type' in input
          ? (input as Record<string, unknown>).type as RngType
          : 6,
        rollCount: 0,
        results: [],
        error: 'Invalid input: type must be a number (2-1000 for dice sides) or "flip_coin" or "spin_the_bottle"',
      };
    }

    const { type, rolls = 1, modifier = 0 } = parsed;

    // Handle dice roll
    if (typeof type === 'number') {
      const { results, sum } = rollDice(type, rolls);
      const total = sum + modifier;

      logger.info('RNG dice roll completed', {
        userId: context.userId,
        chatId: context.chatId,
        sides: type,
        rolls,
        results,
        sum,
        modifier,
        total,
      });

      return {
        success: true,
        type,
        rollCount: rolls,
        results,
        sum,
        modifier,
        total,
      };
    }

    // Handle coin flip
    if (type === 'flip_coin') {
      const results = flipCoin(rolls);

      logger.info('RNG coin flip completed', {
        userId: context.userId,
        chatId: context.chatId,
        rolls,
        results,
      });

      return {
        success: true,
        type,
        rollCount: rolls,
        results,
      };
    }

    // Handle spin the bottle
    if (type === 'spin_the_bottle') {
      const { results, error } = await spinTheBottle(rolls, context.chatId, context.userId);

      if (error) {
        logger.warn('RNG spin the bottle failed', {
          userId: context.userId,
          chatId: context.chatId,
          error,
        });

        return {
          success: false,
          type,
          rollCount: 0,
          results: [],
          error,
        };
      }

      logger.info('RNG spin the bottle completed', {
        userId: context.userId,
        chatId: context.chatId,
        rolls,
        results,
      });

      return {
        success: true,
        type,
        rollCount: rolls,
        results,
      };
    }

    // Should not reach here due to validation
    return {
      success: false,
      type,
      rollCount: 0,
      results: [],
      error: 'Unknown RNG type',
    };
  } catch (error) {
    logger.error('RNG tool execution failed', { userId: context.userId, chatId: context.chatId }, error instanceof Error ? error : undefined);
    return {
      success: false,
      type: typeof input === 'object' && input !== null && 'type' in input
        ? (input as Record<string, unknown>).type as RngType
        : 6,
      rollCount: 0,
      results: [],
      error: error instanceof Error ? error.message : 'Unknown error during RNG execution',
    };
  }
}

/**
 * Format RNG results for inclusion in conversation context
 *
 * @param output - RNG tool output to format
 * @returns Formatted string suitable for LLM context and display
 */
export function formatRngResults(output: RngToolOutput): string {
  if (!output.success) {
    return `RNG Error: ${output.error || 'Unknown error'}`;
  }

  const { type, results, rollCount, sum, modifier = 0, total } = output;

  // Format dice roll. The no-modifier wording is long-standing and deliberately
  // untouched; a modifier only ever adds the "+ n" arithmetic to the line.
  if (typeof type === 'number') {
    const sign = modifier > 0 ? '+' : '-';
    const magnitude = Math.abs(modifier);
    if (rollCount === 1) {
      if (modifier === 0) {
        return `Rolled a d${type}: **${results[0]}**`;
      }
      return `Rolled a d${type}${sign}${magnitude}: ${results[0]} ${sign} ${magnitude} = **${total}**`;
    }
    if (modifier === 0) {
      return `Rolled ${rollCount}d${type}: [${results.join(', ')}] = **${sum}** total`;
    }
    return `Rolled ${rollCount}d${type}${sign}${magnitude}: [${results.join(', ')}] ${sign} ${magnitude} = **${total}** total`;
  }

  // Format coin flip
  if (type === 'flip_coin') {
    if (rollCount === 1) {
      return `Coin flip result: **${results[0]}**`;
    }
    const headsCount = results.filter(r => r === 'heads').length;
    const tailsCount = results.filter(r => r === 'tails').length;
    return `Flipped ${rollCount} coins: [${results.join(', ')}] (${headsCount} heads, ${tailsCount} tails)`;
  }

  // Format spin the bottle
  if (type === 'spin_the_bottle') {
    if (rollCount === 1) {
      return `The bottle points to: **${results[0]}**`;
    }
    return `Spun the bottle ${rollCount} times: [${results.join(', ')}]`;
  }

  return `RNG result: ${results.join(', ')}`;
}
