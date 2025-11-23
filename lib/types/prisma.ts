/**
 * Prisma types export
 * Re-exports types from @prisma/client and defines enum types
 */

// Explicitly export Prisma-generated enums and types for Turbopack compatibility
// (avoids "unexpected export *" warning with CommonJS modules)
export type {
  ApiKey,
  ImageProfile,
  User,
  Message,
  Chat,
  Image,
} from '@prisma/client'
export { ImageProvider } from '@prisma/client'

// Define Provider and Role as string literal union types
// These match the Prisma schema enums and are compatible with Prisma's generated types
export type Provider = 'OPENAI' | 'ANTHROPIC' | 'OLLAMA' | 'OPENROUTER' | 'OPENAI_COMPATIBLE' | 'GROK' | 'GAB_AI';
export type Role = 'SYSTEM' | 'USER' | 'ASSISTANT';

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
