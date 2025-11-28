/**
 * Unit Tests for MemoriesRepository
 *
 * Tests CRUD operations, filtering, searching, and sorting functionality
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MemoriesRepository } from '@/lib/json-store/repositories/memories.repository';
import { JsonStore } from '@/lib/json-store/core/json-store';
import { Memory, MemoriesFile } from '@/lib/json-store/schemas/types';

// Mock JsonStore
jest.mock('@/lib/json-store/core/json-store');

describe('MemoriesRepository', () => {
  let repo: MemoriesRepository;
  let mockJsonStore: jest.Mocked<JsonStore>;
  const characterId = '550e8400-e29b-41d4-a716-446655440001';
  const memoryId = '550e8400-e29b-41d4-a716-446655440002';

  const mockMemory: Memory = {
    id: memoryId,
    characterId,
    content: 'Test memory content',
    summary: 'Test summary',
    keywords: ['test', 'memory'],
    tags: [],
    importance: 0.7,
    source: 'MANUAL',
    personaId: null,
    chatId: null,
    sourceMessageId: null,
    lastAccessedAt: null,
    embedding: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockJsonStore = new JsonStore() as jest.Mocked<JsonStore>;
    repo = new MemoriesRepository(mockJsonStore);
  });

  describe('findByCharacterId', () => {
    it('should return all memories for a character', async () => {
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [mockMemory],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);

      const result = await repo.findByCharacterId(characterId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockMemory);
      expect(mockJsonStore.readJson).toHaveBeenCalledWith(
        `memories/by-character/${characterId}.json`
      );
    });

    it('should return empty array for character with no memories', async () => {
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);

      const result = await repo.findByCharacterId(characterId);

      expect(result).toHaveLength(0);
    });

    it('should return default structure when file does not exist', async () => {
      mockJsonStore.readJson = jest.fn().mockRejectedValue(new Error('File not found'));

      const result = await repo.findByCharacterId(characterId);

      expect(result).toHaveLength(0);
    });
  });

  describe('findByIdForCharacter', () => {
    it('should find a memory by ID for a specific character', async () => {
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [mockMemory],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);

      const result = await repo.findByIdForCharacter(characterId, memoryId);

      expect(result).toEqual(mockMemory);
    });

    it('should return null if memory not found', async () => {
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);

      const result = await repo.findByIdForCharacter(characterId, 'non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a new memory with generated ID and timestamps', async () => {
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);
      mockJsonStore.writeJson = jest.fn().mockResolvedValue(undefined);

      const result = await repo.create({
        characterId,
        content: 'Test memory content',
        summary: 'Test summary',
        keywords: ['test', 'memory'],
        tags: [],
        importance: 0.7,
        source: 'MANUAL',
        personaId: null,
        chatId: null,
        sourceMessageId: null,
        lastAccessedAt: null,
        embedding: null,
      });

      expect(result.id).toBeDefined();
      expect(result.characterId).toBe(characterId);
      expect(result.content).toBe('Test memory content');
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(mockJsonStore.writeJson).toHaveBeenCalled();
    });

    it('should validate memory data before saving', async () => {
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);
      mockJsonStore.writeJson = jest.fn().mockResolvedValue(undefined);

      // This should pass validation
      const result = await repo.create({
        characterId,
        content: 'Test',
        summary: 'Summary',
        keywords: [],
        tags: [],
        importance: 0.5,
        source: 'MANUAL',
        personaId: null,
        chatId: null,
        sourceMessageId: null,
        lastAccessedAt: null,
        embedding: null,
      });

      expect(result).toBeDefined();
    });
  });

  describe('update', () => {
    it('should update a memory', async () => {
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [mockMemory],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);
      mockJsonStore.writeJson = jest.fn().mockResolvedValue(undefined);

      const result = await repo.updateForCharacter(characterId, memoryId, {
        characterId,
        importance: 0.9,
      });

      expect(result).not.toBeNull();
      expect(result?.importance).toBe(0.9);
      expect(result?.id).toBe(memoryId); // ID should not change
      expect(result?.createdAt).toBe(mockMemory.createdAt); // Creation time should not change
    });

    it('should return null if memory not found during update', async () => {
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);

      const result = await repo.updateForCharacter(characterId, 'non-existent-id', {
        characterId,
        importance: 0.9,
      });

      expect(result).toBeNull();
    });

    it('should update timestamp on modification', async () => {
      const oldMemory = { ...mockMemory };
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [oldMemory],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);
      mockJsonStore.writeJson = jest.fn().mockResolvedValue(undefined);

      const result = await repo.updateForCharacter(characterId, memoryId, {
        characterId,
        content: 'Updated content',
      });

      expect(result?.updatedAt).not.toBe(oldMemory.updatedAt);
    });
  });

  describe('delete', () => {
    it('should delete a memory', async () => {
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [mockMemory],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);
      mockJsonStore.writeJson = jest.fn().mockResolvedValue(undefined);
      mockJsonStore.listDir = jest.fn().mockResolvedValue([`${characterId}.json`]);

      const result = await repo.deleteForCharacter(characterId, memoryId);

      expect(result).toBe(true);
      expect(mockJsonStore.writeJson).toHaveBeenCalled();
    });

    it('should return false if memory not found during delete', async () => {
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);

      const result = await repo.deleteForCharacter(characterId, 'non-existent-id');

      expect(result).toBe(false);
    });
  });

  describe('bulkDelete', () => {
    it('should delete multiple memories', async () => {
      const memory2 = { ...mockMemory, id: '550e8400-e29b-41d4-a716-446655440003' };
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [mockMemory, memory2],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);
      mockJsonStore.writeJson = jest.fn().mockResolvedValue(undefined);

      const result = await repo.bulkDelete(characterId, [memoryId, memory2.id]);

      expect(result).toBe(2);
      expect(mockJsonStore.writeJson).toHaveBeenCalled();
    });

    it('should return 0 if no memories match the IDs', async () => {
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [mockMemory],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);

      const result = await repo.bulkDelete(characterId, ['non-existent-1', 'non-existent-2']);

      expect(result).toBe(0);
    });
  });

  describe('searchByContent', () => {
    it('should find memories by content search', async () => {
      const memory2 = {
        ...mockMemory,
        id: '550e8400-e29b-41d4-a716-446655440003',
        content: 'Unrelated content',
        summary: 'Unrelated summary',
        keywords: ['unrelated'],
      };

      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [mockMemory, memory2],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);

      const result = await repo.searchByContent(characterId, 'Test');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockMemory);
    });

    it('should be case-insensitive', async () => {
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [mockMemory],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);

      const result = await repo.searchByContent(characterId, 'test MEMORY');

      expect(result).toHaveLength(1);
    });

    it('should search in summary and keywords', async () => {
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [mockMemory],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);

      const resultBySummary = await repo.searchByContent(characterId, 'Test summary');
      const resultByKeyword = await repo.searchByContent(characterId, 'memory');

      expect(resultBySummary).toHaveLength(1);
      expect(resultByKeyword).toHaveLength(1);
    });
  });

  describe('findByKeywords', () => {
    it('should find memories by keywords', async () => {
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [mockMemory],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);

      const result = await repo.findByKeywords(characterId, ['test']);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockMemory);
    });

    it('should be case-insensitive', async () => {
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [mockMemory],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);

      const result = await repo.findByKeywords(characterId, ['TEST']);

      expect(result).toHaveLength(1);
    });
  });

  describe('findByImportance', () => {
    it('should find memories above importance threshold', async () => {
      const lowImportance = { ...mockMemory, id: '550e8400-e29b-41d4-a716-446655440004', importance: 0.3 };
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [mockMemory, lowImportance],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);

      const result = await repo.findByImportance(characterId, 0.5);

      expect(result).toHaveLength(1);
      expect(result[0].importance).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('findBySource', () => {
    it('should find memories by source type', async () => {
      const autoMemory = { ...mockMemory, id: '550e8400-e29b-41d4-a716-446655440005', source: 'AUTO' as const };
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [mockMemory, autoMemory],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);

      const manualResult = await repo.findBySource(characterId, 'MANUAL');
      const autoResult = await repo.findBySource(characterId, 'AUTO');

      expect(manualResult).toHaveLength(1);
      expect(autoResult).toHaveLength(1);
    });
  });

  describe('findRecent', () => {
    it('should return recent memories sorted by creation date', async () => {
      const olderMemory = {
        ...mockMemory,
        id: '550e8400-e29b-41d4-a716-446655440006',
        createdAt: '2024-12-01T00:00:00Z',
      };
      const newerMemory = {
        ...mockMemory,
        id: '550e8400-e29b-41d4-a716-446655440007',
        createdAt: '2025-01-02T00:00:00Z',
      };

      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [olderMemory, mockMemory, newerMemory],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);

      const result = await repo.findRecent(characterId, 2);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(newerMemory.id);
    });
  });

  describe('findMostImportant', () => {
    it('should return most important memories sorted by importance', async () => {
      const lowImportance = { ...mockMemory, id: '550e8400-e29b-41d4-a716-446655440008', importance: 0.2 };
      const highImportance = { ...mockMemory, id: '550e8400-e29b-41d4-a716-446655440009', importance: 0.95 };

      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [lowImportance, mockMemory, highImportance],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);

      const result = await repo.findMostImportant(characterId, 2);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(highImportance.id);
    });
  });

  describe('updateAccessTime', () => {
    it('should update lastAccessedAt timestamp', async () => {
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [mockMemory],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);
      mockJsonStore.writeJson = jest.fn().mockResolvedValue(undefined);

      const result = await repo.updateAccessTime(characterId, memoryId);

      expect(result).toBe(true);
      expect(mockJsonStore.writeJson).toHaveBeenCalled();
    });
  });

  describe('countByCharacterId', () => {
    it('should return the count of memories for a character', async () => {
      const memory2 = { ...mockMemory, id: '550e8400-e29b-41d4-a716-446655440010' };
      const memoriesFile: MemoriesFile = {
        version: 1,
        memories: [mockMemory, memory2],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      mockJsonStore.readJson = jest.fn().mockResolvedValue(memoriesFile);

      const result = await repo.countByCharacterId(characterId);

      expect(result).toBe(2);
    });
  });
});
