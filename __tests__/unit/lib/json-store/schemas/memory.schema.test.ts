/**
 * Unit Tests for Memory Zod Schemas
 *
 * Tests validation of Memory and MemoriesFile schemas
 */

import { describe, it, expect } from '@jest/globals';
import { MemorySchema, MemoriesFileSchema, MemorySourceEnum } from '@/lib/json-store/schemas/types';
import { z } from 'zod';

describe('MemorySchema', () => {
  const validMemory = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    characterId: '550e8400-e29b-41d4-a716-446655440002',
    content: 'Test memory content',
    summary: 'Test summary',
    keywords: ['test', 'memory'],
    tags: [],
    importance: 0.7,
    source: 'MANUAL' as const,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };

  describe('valid memory', () => {
    it('should accept valid memory with all required fields', () => {
      const result = MemorySchema.safeParse(validMemory);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validMemory);
      }
    });

    it('should accept memory with optional fields', () => {
      const memory = {
        ...validMemory,
        personaId: '550e8400-e29b-41d4-a716-446655440003',
        chatId: '550e8400-e29b-41d4-a716-446655440004',
        sourceMessageId: '550e8400-e29b-41d4-a716-446655440005',
        lastAccessedAt: '2025-01-02T00:00:00Z',
        embedding: [0.1, 0.2, 0.3],
      };

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(true);
    });

    it('should accept null optional fields', () => {
      const memory = {
        ...validMemory,
        personaId: null,
        chatId: null,
        sourceMessageId: null,
        lastAccessedAt: null,
        embedding: null,
      };

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(true);
    });

    it('should default importance to 0.5', () => {
      const memory = {
        id: '550e8400-e29b-41d4-a716-446655440001',
        characterId: '550e8400-e29b-41d4-a716-446655440002',
        content: 'Test',
        summary: 'Test',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.importance).toBe(0.5);
      }
    });

    it('should default source to MANUAL', () => {
      const memory = {
        ...validMemory,
        source: undefined,
      };

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.source).toBe('MANUAL');
      }
    });

    it('should default keywords and tags to empty arrays', () => {
      const memory = {
        id: '550e8400-e29b-41d4-a716-446655440001',
        characterId: '550e8400-e29b-41d4-a716-446655440002',
        content: 'Test',
        summary: 'Test',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.keywords).toEqual([]);
        expect(result.data.tags).toEqual([]);
      }
    });
  });

  describe('invalid memory', () => {
    it('should reject memory without required content field', () => {
      const memory = { ...validMemory };
      delete (memory as any).content;

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(false);
    });

    it('should reject memory without required summary field', () => {
      const memory = { ...validMemory };
      delete (memory as any).summary;

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(false);
    });

    it('should reject memory without required characterId', () => {
      const memory = { ...validMemory };
      delete (memory as any).characterId;

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(false);
    });

    it('should reject memory with invalid UUID for id', () => {
      const memory = { ...validMemory, id: 'not-a-uuid' };

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(false);
    });

    it('should reject memory with invalid UUID for characterId', () => {
      const memory = { ...validMemory, characterId: 'invalid-uuid' };

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(false);
    });

    it('should reject memory with importance below 0', () => {
      const memory = { ...validMemory, importance: -0.1 };

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(false);
    });

    it('should reject memory with importance above 1', () => {
      const memory = { ...validMemory, importance: 1.1 };

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(false);
    });

    it('should reject memory with invalid source', () => {
      const memory = { ...validMemory, source: 'INVALID' };

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(false);
    });

    it('should reject memory with invalid timestamp format', () => {
      const memory = { ...validMemory, createdAt: 'not-a-timestamp' };

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(false);
    });

    it('should reject memory with non-array keywords', () => {
      const memory = { ...validMemory, keywords: 'not-an-array' };

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(false);
    });

    it('should reject memory with non-array tags', () => {
      const memory = { ...validMemory, tags: 'not-an-array' };

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(false);
    });

    it('should reject memory with invalid UUID in tags', () => {
      const memory = { ...validMemory, tags: ['not-a-uuid'] };

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(false);
    });

    it('should reject memory with non-numeric importance', () => {
      const memory = { ...validMemory, importance: 'high' };

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(false);
    });

    it('should reject memory with non-numeric embedding array', () => {
      const memory = { ...validMemory, embedding: ['a', 'b', 'c'] };

      const result = MemorySchema.safeParse(memory);

      expect(result.success).toBe(false);
    });
  });

  describe('MemorySourceEnum', () => {
    it('should accept AUTO source', () => {
      const result = MemorySourceEnum.safeParse('AUTO');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('AUTO');
      }
    });

    it('should accept MANUAL source', () => {
      const result = MemorySourceEnum.safeParse('MANUAL');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('MANUAL');
      }
    });

    it('should reject invalid source', () => {
      const result = MemorySourceEnum.safeParse('INVALID');

      expect(result.success).toBe(false);
    });
  });
});

describe('MemoriesFileSchema', () => {
  const validMemoriesFile = {
    version: 1,
    memories: [
      {
        id: '550e8400-e29b-41d4-a716-446655440001',
        characterId: '550e8400-e29b-41d4-a716-446655440002',
        content: 'Test memory',
        summary: 'Test',
        keywords: [],
        tags: [],
        importance: 0.5,
        source: 'MANUAL' as const,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };

  describe('valid memories file', () => {
    it('should accept valid memories file', () => {
      const result = MemoriesFileSchema.safeParse(validMemoriesFile);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe(1);
        expect(result.data.memories).toHaveLength(1);
      }
    });

    it('should accept empty memories array', () => {
      const file = { ...validMemoriesFile, memories: [] };

      const result = MemoriesFileSchema.safeParse(file);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.memories).toHaveLength(0);
      }
    });

    it('should default version to 1', () => {
      const file = { ...validMemoriesFile };
      delete (file as any).version;

      const result = MemoriesFileSchema.safeParse(file);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe(1);
      }
    });

    it('should default memories to empty array', () => {
      const file = {
        version: 1,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      const result = MemoriesFileSchema.safeParse(file);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.memories).toEqual([]);
      }
    });
  });

  describe('invalid memories file', () => {
    it('should reject file without createdAt', () => {
      const file = { ...validMemoriesFile };
      delete (file as any).createdAt;

      const result = MemoriesFileSchema.safeParse(file);

      expect(result.success).toBe(false);
    });

    it('should reject file without updatedAt', () => {
      const file = { ...validMemoriesFile };
      delete (file as any).updatedAt;

      const result = MemoriesFileSchema.safeParse(file);

      expect(result.success).toBe(false);
    });

    it('should reject file with invalid memory in array', () => {
      const file = {
        ...validMemoriesFile,
        memories: [
          {
            id: '550e8400-e29b-41d4-a716-446655440001',
            characterId: '550e8400-e29b-41d4-a716-446655440002',
            content: 'Test',
            // Missing summary - required field
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
        ],
      };

      const result = MemoriesFileSchema.safeParse(file);

      expect(result.success).toBe(false);
    });

    it('should reject file with non-number version', () => {
      const file = { ...validMemoriesFile, version: 'v1' };

      const result = MemoriesFileSchema.safeParse(file);

      expect(result.success).toBe(false);
    });

    it('should reject file with non-array memories', () => {
      const file = { ...validMemoriesFile, memories: 'not-an-array' };

      const result = MemoriesFileSchema.safeParse(file);

      expect(result.success).toBe(false);
    });
  });

  describe('timestamp handling', () => {
    it('should accept ISO 8601 string timestamps', () => {
      const result = MemoriesFileSchema.safeParse(validMemoriesFile);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.createdAt).toBe('string');
      }
    });

    it('should convert Date objects to ISO string', () => {
      const file = {
        version: 1,
        memories: [],
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
      };

      const result = MemoriesFileSchema.safeParse(file);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.createdAt).toBe('string');
        expect(typeof result.data.updatedAt).toBe('string');
      }
    });
  });
});
