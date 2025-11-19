/**
 * Prisma types export
 * Re-exports types from @prisma/client and defines enums that match the schema
 */

// Export the Provider enum to match the Prisma schema
export enum Provider {
  OPENAI = 'OPENAI',
  ANTHROPIC = 'ANTHROPIC',
  OLLAMA = 'OLLAMA',
  OPENROUTER = 'OPENROUTER',
  OPENAI_COMPATIBLE = 'OPENAI_COMPATIBLE',
}

// Export the Role enum to match the Prisma schema
export enum Role {
  SYSTEM = 'SYSTEM',
  USER = 'USER',
  ASSISTANT = 'ASSISTANT',
}

// Re-export all types from @prisma/client
export * from '@prisma/client';
