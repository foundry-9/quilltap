/**
 * Unit Tests for API Enrichment Utilities
 * Tests lib/api/middleware/enrichment.ts
 * v2.7-dev: Data enrichment for API responses
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { Tag, ApiKey } from '@/lib/schemas/types';

const {
  enrichWithApiKey,
  enrichWithTags,
  enrichProfile,
} = require('@/lib/api/middleware/enrichment');

describe('API Enrichment Utilities', () => {
  let mockRepos: any;

  beforeEach(() => {
    mockRepos = {
      connections: {
        findApiKeyById: jest.fn(),
      },
      tags: {
        findByIds: jest.fn(),
      },
    };
  });

  describe('enrichWithApiKey', () => {
    it('should enrich with API key info when key exists', async () => {
      const apiKey: ApiKey = {
        id: 'key-1',
        label: 'OpenAI Key',
        provider: 'openai',
        key: 'sk-secret-key',
        isActive: true,
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepos.connections.findApiKeyById.mockResolvedValue(apiKey);

      const result = await enrichWithApiKey('key-1', mockRepos);

      expect(mockRepos.connections.findApiKeyById).toHaveBeenCalledWith('key-1');
      expect(result).toEqual({
        id: 'key-1',
        label: 'OpenAI Key',
        provider: 'openai',
        isActive: true,
      });
      // Should NOT include the actual key value
      expect(result).not.toHaveProperty('key');
    });

    it('should return null when apiKeyId is null', async () => {
      const result = await enrichWithApiKey(null, mockRepos);

      expect(result).toBeNull();
      expect(mockRepos.connections.findApiKeyById).not.toHaveBeenCalled();
    });

    it('should return null when apiKeyId is undefined', async () => {
      const result = await enrichWithApiKey(undefined, mockRepos);

      expect(result).toBeNull();
      expect(mockRepos.connections.findApiKeyById).not.toHaveBeenCalled();
    });

    it('should return null when API key not found', async () => {
      mockRepos.connections.findApiKeyById.mockResolvedValue(null);

      const result = await enrichWithApiKey('key-missing', mockRepos);

      expect(result).toBeNull();
    });

    it('should handle inactive API keys', async () => {
      const apiKey: ApiKey = {
        id: 'key-2',
        label: 'Disabled Key',
        provider: 'anthropic',
        key: 'sk-ant-key',
        isActive: false,
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepos.connections.findApiKeyById.mockResolvedValue(apiKey);

      const result = await enrichWithApiKey('key-2', mockRepos);

      expect(result).toEqual({
        id: 'key-2',
        label: 'Disabled Key',
        provider: 'anthropic',
        isActive: false,
      });
    });
  });

  describe('enrichWithTags', () => {
    it('should enrich with tag details in batched query', async () => {
      const tags: Tag[] = [
        {
          id: 'tag-1',
          name: 'Fantasy',
          color: '#ff0000',
          userId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'tag-2',
          name: 'Adventure',
          color: '#00ff00',
          userId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockRepos.tags.findByIds.mockResolvedValue(tags);

      const result = await enrichWithTags(['tag-1', 'tag-2'], mockRepos);

      expect(mockRepos.tags.findByIds).toHaveBeenCalledWith(['tag-1', 'tag-2']);
      expect(result).toEqual([
        { tagId: 'tag-1', tag: tags[0] },
        { tagId: 'tag-2', tag: tags[1] },
      ]);
    });

    it('should return empty array when tagIds is undefined', async () => {
      const result = await enrichWithTags(undefined, mockRepos);

      expect(result).toEqual([]);
      expect(mockRepos.tags.findByIds).not.toHaveBeenCalled();
    });

    it('should return empty array when tagIds is empty', async () => {
      const result = await enrichWithTags([], mockRepos);

      expect(result).toEqual([]);
      expect(mockRepos.tags.findByIds).not.toHaveBeenCalled();
    });

    it('should filter out tags not found in database', async () => {
      const tags: Tag[] = [
        {
          id: 'tag-1',
          name: 'Fantasy',
          color: '#ff0000',
          userId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockRepos.tags.findByIds.mockResolvedValue(tags);

      const result = await enrichWithTags(['tag-1', 'tag-missing', 'tag-3'], mockRepos);

      // Only tag-1 should be in result since others weren't found
      expect(result).toEqual([
        { tagId: 'tag-1', tag: tags[0] },
      ]);
    });

    it('should preserve order from input tagIds', async () => {
      const tags: Tag[] = [
        {
          id: 'tag-2',
          name: 'Second',
          color: '#00ff00',
          userId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'tag-1',
          name: 'First',
          color: '#ff0000',
          userId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockRepos.tags.findByIds.mockResolvedValue(tags);

      const result = await enrichWithTags(['tag-1', 'tag-2'], mockRepos);

      // Should preserve input order (tag-1 then tag-2) not DB order
      expect(result[0].tagId).toBe('tag-1');
      expect(result[1].tagId).toBe('tag-2');
    });

    it('should handle duplicate tag IDs', async () => {
      const tags: Tag[] = [
        {
          id: 'tag-1',
          name: 'Fantasy',
          color: '#ff0000',
          userId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockRepos.tags.findByIds.mockResolvedValue(tags);

      const result = await enrichWithTags(['tag-1', 'tag-1'], mockRepos);

      // Should have two entries for duplicate ID
      expect(result.length).toBe(2);
      expect(result[0].tagId).toBe('tag-1');
      expect(result[1].tagId).toBe('tag-1');
    });
  });

  describe('enrichProfile', () => {
    it('should enrich profile with both API key and tags', async () => {
      const profile = {
        id: 'profile-1',
        apiKeyId: 'key-1',
        tags: ['tag-1', 'tag-2'],
      };

      const apiKey: ApiKey = {
        id: 'key-1',
        label: 'Test Key',
        provider: 'openai',
        key: 'secret',
        isActive: true,
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const tags: Tag[] = [
        {
          id: 'tag-1',
          name: 'Tag1',
          color: '#ff0000',
          userId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockRepos.connections.findApiKeyById.mockResolvedValue(apiKey);
      mockRepos.tags.findByIds.mockResolvedValue(tags);

      const result = await enrichProfile(profile, mockRepos);

      expect(result.apiKey).toEqual({
        id: 'key-1',
        label: 'Test Key',
        provider: 'openai',
        isActive: true,
      });
      expect(result.tags).toHaveLength(1);
      expect(result.tags[0].tagId).toBe('tag-1');
    });

    it('should handle profile with no API key', async () => {
      const profile = {
        id: 'profile-1',
        apiKeyId: null,
        tags: ['tag-1'],
      };

      const tags: Tag[] = [
        {
          id: 'tag-1',
          name: 'Tag1',
          color: '#ff0000',
          userId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockRepos.tags.findByIds.mockResolvedValue(tags);

      const result = await enrichProfile(profile, mockRepos);

      expect(result.apiKey).toBeNull();
      expect(result.tags).toHaveLength(1);
    });

    it('should handle profile with no tags', async () => {
      const profile = {
        id: 'profile-1',
        apiKeyId: 'key-1',
        tags: undefined,
      };

      const apiKey: ApiKey = {
        id: 'key-1',
        label: 'Test Key',
        provider: 'openai',
        key: 'secret',
        isActive: true,
        userId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepos.connections.findApiKeyById.mockResolvedValue(apiKey);

      const result = await enrichProfile(profile, mockRepos);

      expect(result.apiKey).toBeTruthy();
      expect(result.tags).toEqual([]);
    });

    it('should enrich both in parallel', async () => {
      const profile = {
        id: 'profile-1',
        apiKeyId: 'key-1',
        tags: ['tag-1'],
      };

      let apiKeyResolved = false;
      let tagsResolved = false;

      mockRepos.connections.findApiKeyById.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        apiKeyResolved = true;
        return {
          id: 'key-1',
          label: 'Test',
          provider: 'openai',
          key: 'secret',
          isActive: true,
          userId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });

      mockRepos.tags.findByIds.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        tagsResolved = true;
        return [{
          id: 'tag-1',
          name: 'Tag1',
          color: '#ff0000',
          userId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        }];
      });

      await enrichProfile(profile, mockRepos);

      // Both should be resolved (parallel execution)
      expect(apiKeyResolved).toBe(true);
      expect(tagsResolved).toBe(true);
    });
  });

});
