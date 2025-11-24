/**
 * Type definitions for Quilltap
 * Defines enum types and interfaces used throughout the application
 * (Migrated from Prisma to JSON store)
 */

// Define Provider and Role as string literal union types
export type Provider = 'OPENAI' | 'ANTHROPIC' | 'OLLAMA' | 'OPENROUTER' | 'OPENAI_COMPATIBLE' | 'GROK' | 'GAB_AI';
export type Role = 'SYSTEM' | 'USER' | 'ASSISTANT';
export type ImageProvider = 'OPENAI' | 'ANTHROPIC';

// Export const objects with enum values for runtime validation
export const Provider = {
  OPENAI: 'OPENAI',
  ANTHROPIC: 'ANTHROPIC',
  OLLAMA: 'OLLAMA',
  OPENROUTER: 'OPENROUTER',
  OPENAI_COMPATIBLE: 'OPENAI_COMPATIBLE',
  GROK: 'GROK',
  GAB_AI: 'GAB_AI',
} as const;

export const Role = {
  SYSTEM: 'SYSTEM',
  USER: 'USER',
  ASSISTANT: 'ASSISTANT',
} as const;

export const ImageProvider = {
  OPENAI: 'OPENAI',
  ANTHROPIC: 'ANTHROPIC',
} as const;
