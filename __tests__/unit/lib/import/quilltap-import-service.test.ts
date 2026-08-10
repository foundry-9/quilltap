/**
 * Unit tests for Quilltap Import Service
 *
 * Tests the import functionality including:
 * - Export file parsing and validation
 * - Import preview generation
 * - Import execution with all three conflict strategies (skip, overwrite, duplicate)
 * - ID remapping and relationship reconciliation
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  createMockCharacter,
  createMockPersona,
  createMockChat,
  createMockChatParticipant,
  createMockTag,
  createMockMemory,
  createMockConnectionProfile,
  createMockImageProfile,
  createMockEmbeddingProfile,
  createMockRoleplayTemplate,
  createMockMessage,
  createMockExportedCharacter,
  createMockExportedPersona,
  createMockExportedChat,
  createMockQuilltapExport,
  createMockPersonasExport,
  createMockChatsExport,
  createMockTagsExport,
  createMockConnectionProfilesExport,
  createMockExportManifest,
  createMockSanitizedConnectionProfile,
  createMockSanitizedImageProfile,
  createMockSanitizedEmbeddingProfile,
  generateId,
} from '../fixtures/test-factories';
import {
  createMockUserRepositories,
  createMockGlobalRepositories,
  configureFindById,
  configureFindAll,
  configureCreate,
} from '../fixtures/mock-repositories';

// Mock the repository factory
jest.mock('@/lib/repositories/factory', () => ({
  getUserRepositories: jest.fn(),
  getRepositories: jest.fn(),
}));

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

// Import after mocking
import {
  parseExportFile,
  validateExportFormat,
  previewImport,
  executeImport,
} from '@/lib/import/quilltap-import-service';
import { PreserveIdsCollisionError } from '@/lib/import/quilltap-import/execute';
import { getUserRepositories, getRepositories } from '@/lib/repositories/factory';

describe('quilltap-import-service', () => {
  const mockUserRepos = createMockUserRepositories();
  const mockGlobalRepos = createMockGlobalRepositories();
  const testUserId = generateId();

  beforeEach(() => {
    jest.clearAllMocks();
    (getUserRepositories as jest.Mock).mockReturnValue(mockUserRepos);
    (getRepositories as jest.Mock).mockReturnValue(mockGlobalRepos);

    // Configure default create behavior to return input with generated ID
    configureCreate(mockUserRepos.characters.create);
    configureCreate(mockUserRepos.personas.create);
    configureCreate(mockUserRepos.chats.create);
    configureCreate(mockUserRepos.tags.create);
    configureCreate(mockUserRepos.memories.create);
    configureCreate(mockUserRepos.connections.create);
    configureCreate(mockUserRepos.imageProfiles.create);
    configureCreate(mockUserRepos.embeddingProfiles.create);
    configureCreate(mockUserRepos.projects.create);
    configureCreate(mockGlobalRepos.roleplayTemplates.create);
  });

  // ============================================================================
  // parseExportFile() Tests
  // ============================================================================

  describe('parseExportFile()', () => {
    it('should parse valid JSON export', () => {
      const exportData = createMockQuilltapExport();
      const jsonString = JSON.stringify(exportData);

      const result = parseExportFile(jsonString);

      expect(result.manifest.format).toBe('quilltap-export');
      expect(result.manifest.version).toBe('1.0');
    });

    it('should throw for invalid JSON', () => {
      const invalidJson = '{ invalid json }';

      expect(() => parseExportFile(invalidJson)).toThrow('Invalid export file');
    });

    it('should throw for non-object JSON', () => {
      const arrayJson = '["not", "an", "object"]';

      expect(() => parseExportFile(arrayJson)).toThrow('Invalid export file');
    });

    it('should throw for null JSON', () => {
      const nullJson = 'null';

      expect(() => parseExportFile(nullJson)).toThrow('Invalid export file');
    });
  });

  // ============================================================================
  // validateExportFormat() Tests
  // ============================================================================

  describe('validateExportFormat()', () => {
    it('should accept valid export format', () => {
      const exportData = createMockQuilltapExport();

      expect(() => validateExportFormat(exportData)).not.toThrow();
    });

    it('should reject missing manifest', () => {
      const data = { data: {} };

      expect(() => validateExportFormat(data)).toThrow('Missing or invalid manifest');
    });

    it('should reject wrong format identifier', () => {
      const data = {
        manifest: { format: 'wrong-format', version: '1.0' },
        data: {},
      };

      expect(() => validateExportFormat(data)).toThrow("Invalid format: expected 'quilltap-export'");
    });

    it('should reject unsupported version', () => {
      const data = {
        manifest: { format: 'quilltap-export', version: '2.0' },
        data: {},
      };

      expect(() => validateExportFormat(data)).toThrow('Unsupported version: 2.0');
    });

    it('should reject missing data section', () => {
      const data = {
        manifest: { format: 'quilltap-export', version: '1.0' },
      };

      expect(() => validateExportFormat(data)).toThrow('Missing or invalid data section');
    });

    it('should reject null input', () => {
      expect(() => validateExportFormat(null)).toThrow('Export data must be a JSON object');
    });

    it('should reject non-object input', () => {
      expect(() => validateExportFormat('string')).toThrow('Export data must be a JSON object');
    });
  });

  // ============================================================================
  // previewImport() Tests
  // ============================================================================

  describe('previewImport()', () => {
    it('should preview character import with conflict detection', async () => {
      const existingChar = createMockCharacter({ userId: testUserId, name: 'Existing' });
      const newChar = createMockExportedCharacter({ name: 'New Character' });
      const exportData = createMockQuilltapExport({
        characters: [
          createMockExportedCharacter({ id: existingChar.id, name: 'Existing' }),
          newChar,
        ],
      });

      configureFindById(mockUserRepos.characters.findById, [existingChar]);

      const preview = await previewImport(testUserId, exportData);

      expect(preview.manifest).toBeDefined();
      expect(preview.entities.characters).toHaveLength(2);
      expect(preview.entities.characters![0].exists).toBe(true);
      expect(preview.entities.characters![1].exists).toBe(false);
      expect(preview.conflictCounts.characters).toBe(1);
    });

    it('should preview chat import', async () => {
      const chat = createMockExportedChat({ title: 'Adventure Chat' });
      const exportData = createMockChatsExport({ chats: [chat] });

      const preview = await previewImport(testUserId, exportData);

      expect(preview.entities.chats).toHaveLength(1);
      expect(preview.entities.chats![0].name).toBe('Adventure Chat');
    });

    it('should preview tag import', async () => {
      const tag = createMockTag({ name: 'Important' });
      const exportData = createMockTagsExport({ tags: [tag] });

      const preview = await previewImport(testUserId, exportData);

      expect(preview.entities.tags).toHaveLength(1);
      expect(preview.entities.tags![0].name).toBe('Important');
    });

    it('should include memory count in preview', async () => {
      const character = createMockExportedCharacter();
      const memories = [createMockMemory(), createMockMemory()];
      const exportData = createMockQuilltapExport({
        characters: [character],
        memories,
      });

      const preview = await previewImport(testUserId, exportData);

      expect(preview.entities.memories).toBeDefined();
      expect(preview.entities.memories!.count).toBe(2);
    });

    it('should report no conflicts when all entities are new', async () => {
      const exportData = createMockQuilltapExport();

      const preview = await previewImport(testUserId, exportData);

      expect(preview.conflictCounts).toEqual({});
    });
  });

  // ============================================================================
  // executeImport() - Skip Strategy Tests
  // ============================================================================

  describe('executeImport() - skip strategy', () => {
    it('should skip existing entities', async () => {
      const existingChar = createMockCharacter({ userId: testUserId });
      const exportData = createMockQuilltapExport({
        characters: [createMockExportedCharacter({ id: existingChar.id })],
      });

      configureFindById(mockUserRepos.characters.findById, [existingChar]);

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.success).toBe(true);
      expect(result.skipped.characters).toBe(1);
      expect(result.imported.characters).toBe(0);
      expect(mockUserRepos.characters.create).not.toHaveBeenCalled();
    });

    it('should import new entities', async () => {
      const newChar = createMockExportedCharacter();
      const exportData = createMockQuilltapExport({ characters: [newChar] });

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.success).toBe(true);
      expect(result.imported.characters).toBe(1);
      expect(mockUserRepos.characters.create).toHaveBeenCalledTimes(1);
    });

    it('should handle mixed existing and new entities', async () => {
      const existingChar = createMockCharacter({ userId: testUserId });
      const newChar = createMockExportedCharacter();
      const exportData = createMockQuilltapExport({
        characters: [
          createMockExportedCharacter({ id: existingChar.id }),
          newChar,
        ],
      });

      configureFindById(mockUserRepos.characters.findById, [existingChar]);

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.imported.characters).toBe(1);
      expect(result.skipped.characters).toBe(1);
    });

    it('should preserve existing entity data', async () => {
      const existingChar = createMockCharacter({
        userId: testUserId,
        name: 'Original Name',
        description: 'Original Description',
      });
      const exportData = createMockQuilltapExport({
        characters: [
          createMockExportedCharacter({
            id: existingChar.id,
            name: 'New Name',
            description: 'New Description',
          }),
        ],
      });

      configureFindById(mockUserRepos.characters.findById, [existingChar]);

      await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      // Should not update existing character
      expect(mockUserRepos.characters.update).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // executeImport() - Overwrite Strategy Tests
  // ============================================================================

  describe('executeImport() - overwrite strategy', () => {
    it('should overwrite existing entities', async () => {
      const existingChar = createMockCharacter({ userId: testUserId, name: 'Old Name' });
      const exportData = createMockQuilltapExport({
        characters: [
          createMockExportedCharacter({ id: existingChar.id, name: 'New Name' }),
        ],
      });

      configureFindById(mockUserRepos.characters.findById, [existingChar]);

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'overwrite',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.success).toBe(true);
      expect(result.imported.characters).toBe(1);
      expect(mockUserRepos.characters.delete).toHaveBeenCalledWith(existingChar.id);
      expect(mockUserRepos.characters.create).toHaveBeenCalled();
    });

    it('should delete existing before creating new', async () => {
      const existingChar = createMockCharacter({ userId: testUserId });
      const exportData = createMockQuilltapExport({
        characters: [createMockExportedCharacter({ id: existingChar.id })],
      });

      configureFindById(mockUserRepos.characters.findById, [existingChar]);

      const deleteCall = jest.fn();
      const createCall = jest.fn();

      mockUserRepos.characters.delete.mockImplementation(async () => {
        deleteCall();
        return true;
      });
      mockUserRepos.characters.create.mockImplementation(async (data) => {
        createCall();
        return { ...data, id: existingChar.id } as any;
      });

      await executeImport(testUserId, exportData, {
        conflictStrategy: 'overwrite',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(deleteCall).toHaveBeenCalled();
      expect(createCall).toHaveBeenCalled();
    });

    it('should import new entities without deletion', async () => {
      const newChar = createMockExportedCharacter();
      const exportData = createMockQuilltapExport({ characters: [newChar] });

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'overwrite',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.imported.characters).toBe(1);
      expect(mockUserRepos.characters.delete).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // executeImport() - Duplicate Strategy Tests
  // ============================================================================

  describe('executeImport() - duplicate strategy', () => {
    it('should create new entities with new IDs', async () => {
      const existingChar = createMockCharacter({ userId: testUserId, name: 'Original' });
      const exportData = createMockQuilltapExport({
        characters: [
          createMockExportedCharacter({ id: existingChar.id, name: 'Original' }),
        ],
      });

      configureFindById(mockUserRepos.characters.findById, [existingChar]);

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'duplicate',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.success).toBe(true);
      expect(result.imported.characters).toBe(1);
      expect(mockUserRepos.characters.create).toHaveBeenCalled();

      // The created character's destination id is surfaced so callers (e.g. the
      // Salon "Summon from Lore" flow) can find what was just brought into being.
      expect(result.importedCharacterIds).toHaveLength(1);

      // Verify name was modified
      const createCall = mockUserRepos.characters.create.mock.calls[0][0];
      expect(createCall.name).toBe('Original (imported)');
    });

    it('should append (imported) suffix to duplicate names', async () => {
      const existingTag = createMockTag({ userId: testUserId, name: 'MyTag' });
      const exportData = createMockTagsExport({
        tags: [createMockTag({ id: existingTag.id, name: 'MyTag' })],
      });

      configureFindById(mockUserRepos.tags.findById, [existingTag]);

      await executeImport(testUserId, exportData, {
        conflictStrategy: 'duplicate',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      const createCall = mockUserRepos.tags.create.mock.calls[0][0];
      expect(createCall.name).toBe('MyTag (imported)');
    });

    it('should preserve original entity unchanged', async () => {
      const existingChar = createMockCharacter({ userId: testUserId });
      const exportData = createMockQuilltapExport({
        characters: [createMockExportedCharacter({ id: existingChar.id })],
      });

      configureFindById(mockUserRepos.characters.findById, [existingChar]);

      await executeImport(testUserId, exportData, {
        conflictStrategy: 'duplicate',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(mockUserRepos.characters.delete).not.toHaveBeenCalled();
      expect(mockUserRepos.characters.update).not.toHaveBeenCalled();
    });

    it('should import new entities normally', async () => {
      const newChar = createMockExportedCharacter({ name: 'Brand New' });
      const exportData = createMockQuilltapExport({ characters: [newChar] });

      await executeImport(testUserId, exportData, {
        conflictStrategy: 'duplicate',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      const createCall = mockUserRepos.characters.create.mock.calls[0][0];
      expect(createCall.name).toBe('Brand New');
    });
  });

  // ============================================================================
  // executeImport() - Connection Profile Tests
  // ============================================================================

  describe('executeImport() - connection profiles', () => {
    it('should import connection profiles without API keys', async () => {
      const profile = createMockSanitizedConnectionProfile({
        name: 'My Profile',
        _apiKeyLabel: 'Old API Key',
      });
      const exportData = createMockConnectionProfilesExport({
        connectionProfiles: [profile],
      });

      await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(mockUserRepos.connections.create).toHaveBeenCalled();

      const createCall = mockUserRepos.connections.create.mock.calls[0][0];
      expect(createCall.apiKeyId).toBeNull();
    });
  });

  // ============================================================================
  // executeImport() - Memory Import Tests
  // ============================================================================

  describe('executeImport() - memories', () => {
    it('should import memories when includeMemories is true', async () => {
      const character = createMockExportedCharacter();
      const memories = [
        createMockMemory({ characterId: character.id }),
        createMockMemory({ characterId: character.id }),
      ];
      const exportData = createMockQuilltapExport({
        characters: [character],
        memories,
      });

      // Make sure the character create returns something with the character id
      mockUserRepos.characters.create.mockImplementation(async (data) => ({
        ...data,
        id: character.id,
      }) as any);

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: true,
        includeRelatedEntities: false,
      });

      expect(result.imported.memories).toBe(2);
      expect(mockUserRepos.memories.create).toHaveBeenCalledTimes(2);
    });

    it('should not import memories when includeMemories is false', async () => {
      const character = createMockExportedCharacter();
      const memories = [createMockMemory({ characterId: character.id })];
      const exportData = createMockQuilltapExport({
        characters: [character],
        memories,
      });

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.imported.memories).toBe(0);
      expect(mockUserRepos.memories.create).not.toHaveBeenCalled();
    });

    it('should skip memories with missing character reference', async () => {
      const memory = createMockMemory({ characterId: 'non-existent-char' });
      const exportData = createMockQuilltapExport({
        characters: [],
        memories: [memory],
      });

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: true,
        includeRelatedEntities: false,
      });

      expect(result.skipped.memories).toBe(1);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('non-existent character')
      );
    });
  });

  // ============================================================================
  // executeImport() - Import Order Tests
  // ============================================================================

  describe('executeImport() - import order', () => {
    it('should import tags before characters (dependency order)', async () => {
      const tag = createMockTag({ name: 'TestTag' });
      const character = createMockExportedCharacter({ tags: [tag.id] });
      const exportData = {
        manifest: createMockExportManifest({ exportType: 'characters' }),
        data: {
          characters: [character],
          tags: [tag],
        },
      };

      const importOrder: string[] = [];
      mockUserRepos.tags.create.mockImplementation(async (data) => {
        importOrder.push('tag');
        return { ...data, id: tag.id } as any;
      });
      mockUserRepos.characters.create.mockImplementation(async (data) => {
        importOrder.push('character');
        return { ...data, id: character.id } as any;
      });

      await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(importOrder.indexOf('tag')).toBeLessThan(importOrder.indexOf('character'));
    });

    it('should import connection profiles before characters', async () => {
      const profile = createMockSanitizedConnectionProfile();
      const character = createMockExportedCharacter({
        defaultConnectionProfileId: profile.id,
      });
      const exportData = {
        manifest: createMockExportManifest({ exportType: 'characters' }),
        data: {
          characters: [character],
          connectionProfiles: [profile],
        },
      };

      const importOrder: string[] = [];
      mockUserRepos.connections.create.mockImplementation(async (data) => {
        importOrder.push('profile');
        return { ...data, id: profile.id } as any;
      });
      mockUserRepos.characters.create.mockImplementation(async (data) => {
        importOrder.push('character');
        return { ...data, id: character.id } as any;
      });

      await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(importOrder.indexOf('profile')).toBeLessThan(importOrder.indexOf('character'));
    });
  });

  // ============================================================================
  // executeImport() - Chat with Messages Tests
  // ============================================================================

  describe('executeImport() - chats with messages', () => {
    it('should import chat messages', async () => {
      const messages = [
        createMockMessage({ role: 'USER', content: 'Hello' }),
        createMockMessage({ role: 'ASSISTANT', content: 'Hi there!' }),
      ];
      const chat = createMockExportedChat({ title: 'Test Chat', messages });
      const exportData = createMockChatsExport({ chats: [chat] });

      mockUserRepos.chats.create.mockImplementation(async (data) => ({
        ...data,
        id: chat.id,
      }) as any);

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.imported.chats).toBe(1);
      expect(result.imported.messages).toBe(2);
      expect(mockUserRepos.chats.addMessage).toHaveBeenCalledTimes(2);
    });

    it('should handle message import errors gracefully', async () => {
      const chat = createMockExportedChat({
        messages: [createMockMessage()],
      });
      const exportData = createMockChatsExport({ chats: [chat] });

      mockUserRepos.chats.create.mockImplementation(async (data) => ({
        ...data,
        id: chat.id,
      }) as any);
      mockUserRepos.chats.addMessage.mockRejectedValue(new Error('Message error'));

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.warnings).toContainEqual(
        expect.stringContaining('Failed to import message')
      );
    });
  });

  // ============================================================================
  // executeImport() - Result Structure Tests
  // ============================================================================

  describe('executeImport() - result structure', () => {
    it('should return success status', async () => {
      const exportData = createMockQuilltapExport();

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('imported');
      expect(result).toHaveProperty('skipped');
      expect(result).toHaveProperty('warnings');
    });

    it('should return accurate imported counts', async () => {
      const exportData = createMockQuilltapExport({
        characters: [
          createMockExportedCharacter(),
          createMockExportedCharacter(),
          createMockExportedCharacter(),
        ],
      });

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.imported.characters).toBe(3);
    });

    it('should return accurate skipped counts', async () => {
      const existingChars = [
        createMockCharacter({ userId: testUserId }),
        createMockCharacter({ userId: testUserId }),
      ];
      const exportData = createMockQuilltapExport({
        characters: existingChars.map((c) =>
          createMockExportedCharacter({ id: c.id })
        ),
      });

      configureFindById(mockUserRepos.characters.findById, existingChars);

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.skipped.characters).toBe(2);
    });

    it('should return warnings array', async () => {
      const exportData = createMockQuilltapExport();

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });

  // ============================================================================
  // executeImport() - Preserve IDs Tests
  // ============================================================================

  describe('executeImport() - preserveIds', () => {
    it('preserves source IDs when preserveIds is enabled and no collisions exist', async () => {
      const exportedCharacter = createMockExportedCharacter({ id: 'char-preserve-1', name: 'Preserved' });
      const exportData = createMockQuilltapExport({
        characters: [exportedCharacter],
        memories: [createMockMemory({ id: 'memory-preserve-1', characterId: 'char-preserve-1' })],
      });

      mockUserRepos.characters.create.mockImplementation(async (data: any, options?: { id?: string }) => ({
        ...data,
        id: options?.id ?? data.id ?? 'generated-id',
      }));
      mockUserRepos.memories.create.mockImplementation(async (data: any, options?: { id?: string }) => ({
        ...data,
        id: options?.id ?? data.id ?? 'generated-memory-id',
      }));

      const result = await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: true,
        includeRelatedEntities: false,
        preserveIds: true,
      });

      expect(result.success).toBe(true);
      expect(result.imported.characters).toBe(1);
      expect(mockUserRepos.characters.create).toHaveBeenCalledWith(
        expect.objectContaining({ id: exportedCharacter.id }),
        expect.objectContaining({ id: exportedCharacter.id })
      );
      expect(mockUserRepos.memories.create).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'memory-preserve-1' }),
        expect.objectContaining({ id: 'memory-preserve-1' })
      );
    });

    it('refuses to import when preserveIds would collide with an existing entity', async () => {
      const exportedCharacter = createMockExportedCharacter({ id: 'char-collision-1', name: 'Colliding' });
      const exportData = createMockQuilltapExport({ characters: [exportedCharacter] });

      configureFindById(mockUserRepos.characters.findById, [createMockCharacter({ id: 'char-collision-1', userId: testUserId })]);

      const result = await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
        preserveIds: true,
      });

      expect(result.success).toBe(false);
      expect(result.warnings.some((warning) => warning.includes('Preserve IDs collision'))).toBe(true);
      expect(mockUserRepos.characters.create).not.toHaveBeenCalled();
    });

    // ==========================================================================
    // F4 — vault-internal id checks and the skip-if-present rehydrate mode
    // ==========================================================================

    /** A character bundle carrying its vault: mount, folder, document, blob. */
    function createVaultBundle() {
      const exportedCharacter = createMockExportedCharacter({ id: 'char-A', name: 'Archived Ada' });
      (exportedCharacter as any).characterDocumentMountPointId = 'vault-A';
      const exportData = createMockQuilltapExport({
        characters: [exportedCharacter],
        memories: [createMockMemory({ id: 'mem-1', characterId: 'char-A' })],
      });
      Object.assign(exportData.data as any, {
        mountPoints: [{
          id: 'vault-A', name: 'Ada Vault', basePath: '', mountType: 'database',
          storeType: 'character', includePatterns: [], excludePatterns: [], enabled: true,
        }],
        folders: [{ id: 'folder-1', mountPointId: 'vault-A', parentId: null, name: 'Mail', path: 'Mail' }],
        documents: [{
          mountPointId: 'vault-A', relativePath: 'identity.md', fileName: 'identity.md',
          fileType: 'markdown', content: 'x', contentSha256: 'sha-1', plainTextLength: 1,
          lastModified: '2026-08-10T00:00:00.000Z', folderId: null, fileId: 'file-1', linkId: 'link-1',
        }],
        blobs: [{
          mountPointId: 'vault-A', relativePath: 'photos/avatar.webp', originalFileName: 'avatar.webp',
          originalMimeType: 'image/webp', storedMimeType: 'image/webp', sizeBytes: 3, sha256: 'sha-2',
          description: '', fileId: 'file-2', linkId: 'link-2', blobId: 'blob-1',
          dataBase64: Buffer.from('abc').toString('base64'),
        }],
      });
      return exportData;
    }

    const skipIfPresentOptions = {
      conflictStrategy: 'skip' as const,
      includeMemories: true,
      includeRelatedEntities: false,
      preserveIds: true,
      preserveIdsMode: {
        mode: 'skip-if-present' as const,
        targetCharacterId: 'char-A',
        targetVaultMountPointId: 'vault-A',
      },
    };

    /** Make every id in the vault bundle collide inside vault-A. */
    function configureFullKeepSetCollision() {
      configureFindById(mockUserRepos.characters.findById, [
        createMockCharacter({ id: 'char-A', userId: testUserId }),
      ]);
      configureFindById(mockUserRepos.memories.findById as any, [
        { id: 'mem-1', characterId: 'char-A' },
      ]);
      configureFindById(mockGlobalRepos.docMountPoints.findById as any, [
        { id: 'vault-A', mountType: 'database' },
      ]);
      configureFindById(mockGlobalRepos.docMountFolders.findById as any, [
        { id: 'folder-1', mountPointId: 'vault-A' },
      ]);
      configureFindById(mockGlobalRepos.docMountFiles.findById as any, [
        { id: 'file-1' }, { id: 'file-2' },
      ]);
      configureFindById(mockGlobalRepos.docMountFileLinks.findById as any, [
        { id: 'link-1', mountPointId: 'vault-A' },
        { id: 'link-2', mountPointId: 'vault-A' },
      ]);
      configureFindById(mockGlobalRepos.docMountBlobs.findById as any, [
        { id: 'blob-1', fileId: 'file-2' },
      ]);
      mockGlobalRepos.docMountFileLinks.findByFileId.mockImplementation(async (fileId: string) =>
        fileId === 'file-1' || fileId === 'file-2' ? [{ mountPointId: 'vault-A' }] : []
      );
    }

    it('refuses the whole import on a single colliding vault-internal link id', async () => {
      const exportData = createVaultBundle();
      // Only the document's link id exists — in some *other* store.
      configureFindById(mockGlobalRepos.docMountFileLinks.findById as any, [
        { id: 'link-1', mountPointId: 'vault-OTHER' },
      ]);

      const result = await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: true,
        includeRelatedEntities: false,
        preserveIds: true,
      });

      expect(result.success).toBe(false);
      expect(result.warnings.some((w) => w.includes('document store link link-1'))).toBe(true);
      // Nothing was written: the refusal is atomic and pre-write.
      expect(mockUserRepos.characters.create).not.toHaveBeenCalled();
      expect(mockUserRepos.memories.create).not.toHaveBeenCalled();
      expect(mockGlobalRepos.docMountFolders.create).not.toHaveBeenCalled();
      expect(mockGlobalRepos.docMountFileLinks.linkDocumentContent).not.toHaveBeenCalled();
      expect(mockGlobalRepos.docMountBlobs.create).not.toHaveBeenCalled();
    });

    it('refuse-on-collision stays the default even when the collision is inside the target vault', async () => {
      const exportData = createVaultBundle();
      configureFullKeepSetCollision();

      const result = await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: true,
        includeRelatedEntities: false,
        preserveIds: true,
        // no preserveIdsMode — the wizard's path
      });

      expect(result.success).toBe(false);
      expect(result.warnings.some((w) => w.includes('Preserve IDs collision'))).toBe(true);
    });

    it('skip-if-present tolerates a full keep-set collision inside the target vault without re-creating anything', async () => {
      const exportData = createVaultBundle();
      configureFullKeepSetCollision();

      const result = await executeImport(testUserId, exportData as any, skipIfPresentOptions);

      expect(result.success).toBe(true);
      // Every colliding record was skipped — the surviving rows win.
      expect(mockUserRepos.characters.create).not.toHaveBeenCalled();
      expect(mockUserRepos.memories.create).not.toHaveBeenCalled();
      expect(mockGlobalRepos.docMountPoints.create).not.toHaveBeenCalled();
      expect(mockGlobalRepos.docMountFolders.create).not.toHaveBeenCalled();
      expect(mockGlobalRepos.docMountFileLinks.linkDocumentContent).not.toHaveBeenCalled();
      expect(mockGlobalRepos.docMountBlobs.create).not.toHaveBeenCalled();
      // The character resolves to itself for downstream consumers.
      expect(result.importedCharacterIds).toContain('char-A');
    });

    it('skip-if-present still refuses atomically when a claimed id lives outside the target', async () => {
      const exportData = createVaultBundle();
      configureFullKeepSetCollision();
      // The blob's link now lives in a different mount: hard refusal.
      configureFindById(mockGlobalRepos.docMountFileLinks.findById as any, [
        { id: 'link-1', mountPointId: 'vault-A' },
        { id: 'link-2', mountPointId: 'vault-OTHER' },
      ]);

      const result = await executeImport(testUserId, exportData as any, skipIfPresentOptions);

      expect(result.success).toBe(false);
      expect(result.warnings.some((w) => w.includes('document store link link-2'))).toBe(true);
      expect(mockUserRepos.characters.create).not.toHaveBeenCalled();
      expect(mockGlobalRepos.docMountFileLinks.linkDocumentContent).not.toHaveBeenCalled();
    });

    it('skip-if-present refuses another character\'s memory at a claimed id', async () => {
      const exportData = createVaultBundle();
      configureFullKeepSetCollision();
      configureFindById(mockUserRepos.memories.findById as any, [
        { id: 'mem-1', characterId: 'char-SOMEONE-ELSE' },
      ]);

      const result = await executeImport(testUserId, exportData as any, skipIfPresentOptions);

      expect(result.success).toBe(false);
      expect(result.warnings.some((w) => w.includes('memory mem-1'))).toBe(true);
    });

    it('does not treat a hard-link group\'s shared fileId as a duplicate claim', async () => {
      const exportData = createMockQuilltapExport({ characters: [createMockExportedCharacter({ id: 'char-B', name: 'Fresh' })] });
      Object.assign(exportData.data as any, {
        mountPoints: [{
          id: 'store-B', name: 'Lore', basePath: '', mountType: 'database',
          storeType: 'documents', includePatterns: [], excludePatterns: [], enabled: true,
        }],
        documents: [
          {
            mountPointId: 'store-B', relativePath: 'a.md', fileName: 'a.md', fileType: 'markdown',
            content: 'x', contentSha256: 'sha-s', plainTextLength: 1,
            lastModified: '2026-08-10T00:00:00.000Z', folderId: null,
            fileId: 'file-shared', linkId: 'link-a', linkGroupId: 'group-1',
          },
          {
            mountPointId: 'store-B', relativePath: 'b.md', fileName: 'b.md', fileType: 'markdown',
            content: 'x', contentSha256: 'sha-s', plainTextLength: 1,
            lastModified: '2026-08-10T00:00:00.000Z', folderId: null,
            fileId: 'file-shared', linkId: 'link-b', linkGroupId: 'group-1',
          },
        ],
      });

      mockUserRepos.characters.create.mockImplementation(async (data: any, options?: { id?: string }) => ({
        ...data,
        id: options?.id ?? data.id ?? 'generated-id',
      }));

      const result = await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
        preserveIds: true,
      });

      expect(result.success).toBe(true);
      expect(result.warnings.filter((w) => w.includes('Preserve IDs collision'))).toHaveLength(0);
      expect(mockGlobalRepos.docMountFileLinks.linkDocumentContent).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================================
  // executeImport() - Error Handling Tests
  // ============================================================================

  describe('executeImport() - error handling', () => {
    it('should continue after individual entity failures', async () => {
      const chars = [
        createMockExportedCharacter({ name: 'Good Character' }),
        createMockExportedCharacter({ name: 'Bad Character' }),
        createMockExportedCharacter({ name: 'Another Good' }),
      ];
      const exportData = createMockQuilltapExport({ characters: chars });

      let callCount = 0;
      mockUserRepos.characters.create.mockImplementation(async (data) => {
        callCount++;
        if ((data as any).name === 'Bad Character') {
          throw new Error('Database error');
        }
        return { ...data, id: generateId() } as any;
      });

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      // Should have attempted all three
      expect(callCount).toBe(3);
      expect(result.imported.characters).toBe(2);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('Bad Character')
      );
    });

    it('should handle and report import failures in warnings', async () => {
      // The import service is designed to be resilient - it catches individual
      // errors and continues. Test that individual failures are properly reported.
      const exportData = createMockQuilltapExport({
        characters: [createMockExportedCharacter({ name: 'Failing Character' })],
      });

      // All character creates fail
      mockUserRepos.characters.create.mockRejectedValue(
        new Error('Critical database failure')
      );

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      // Import still "succeeds" overall but with warnings
      expect(result.success).toBe(true);
      expect(result.imported.characters).toBe(0);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('Failing Character')
      );
    });
  });

  // ============================================================================
  // executeImport() - Empty Import Tests
  // ============================================================================

  describe('executeImport() - empty imports', () => {
    it('should handle empty character export', async () => {
      const exportData = createMockQuilltapExport({ characters: [] });

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(result.success).toBe(true);
      expect(result.imported.characters).toBe(0);
    });

    it('should handle export with characters and memories', async () => {
      const characterId = generateId();
      const character = createMockExportedCharacter({ id: characterId });
      const memories = [
        createMockMemory({ characterId: characterId }),
      ];
      const exportData = createMockQuilltapExport({
        characters: [character],
        memories,
      });

      // Important: the create mock must return the entity with an ID that matches
      // what we put in the idMaps, so the memory import can find its character
      mockUserRepos.characters.create.mockImplementation(async (data) => {
        // Return with a NEW id (which is what the import does)
        const newId = generateId();
        return { ...data, id: newId } as any;
      });

      const result = await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: true,
        includeRelatedEntities: false,
      });

      expect(result.success).toBe(true);
      // The memory should be imported because the character was imported
      // and its new ID was mapped
      expect(result.imported.memories).toBe(1);
    });
  });

  // ============================================================================
  // executeImport() - Character Relationship Reconciliation Tests
  // ============================================================================

  describe('executeImport() - character relationship reconciliation', () => {
    it('should remap defaultConnectionProfileId for characters', async () => {
      const oldProfileId = generateId();
      const newProfileId = generateId();
      const character = createMockExportedCharacter({
        defaultConnectionProfileId: oldProfileId,
      });
      const profile = createMockSanitizedConnectionProfile({ id: oldProfileId });
      const exportData = {
        manifest: createMockExportManifest({ exportType: 'characters' }),
        data: {
          characters: [character],
          connectionProfiles: [profile],
        },
      };

      // Mock creates to return new IDs
      mockUserRepos.connections.create.mockImplementation(async (data) => ({
        ...data,
        id: newProfileId,
      }) as any);
      mockUserRepos.characters.create.mockImplementation(async (data) => ({
        ...data,
        id: character.id,
      }) as any);
      mockUserRepos.characters.findById.mockResolvedValue({
        ...character,
        defaultConnectionProfileId: oldProfileId,
      } as any);

      await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      // Should update with remapped profile ID
      expect(mockUserRepos.characters.update).toHaveBeenCalledWith(
        character.id,
        expect.objectContaining({
          defaultConnectionProfileId: newProfileId,
        })
      );
    });

    it('should remap defaultImageProfileId for characters', async () => {
      const oldProfileId = generateId();
      const newProfileId = generateId();
      const character = createMockExportedCharacter({
        defaultImageProfileId: oldProfileId,
      });
      const profile = createMockSanitizedImageProfile({ id: oldProfileId });
      const exportData = {
        manifest: createMockExportManifest({ exportType: 'characters' }),
        data: {
          characters: [character],
          imageProfiles: [profile],
        },
      };

      mockUserRepos.imageProfiles.create.mockImplementation(async (data) => ({
        ...data,
        id: newProfileId,
      }) as any);
      mockUserRepos.characters.create.mockImplementation(async (data) => ({
        ...data,
        id: character.id,
      }) as any);
      mockUserRepos.characters.findById.mockResolvedValue({
        ...character,
        defaultImageProfileId: oldProfileId,
      } as any);

      await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(mockUserRepos.characters.update).toHaveBeenCalledWith(
        character.id,
        expect.objectContaining({
          defaultImageProfileId: newProfileId,
        })
      );
    });

    it('should remap defaultRoleplayTemplateId for characters', async () => {
      const oldTemplateId = generateId();
      const newTemplateId = generateId();
      const character = createMockExportedCharacter({
        defaultRoleplayTemplateId: oldTemplateId,
      });
      const template = createMockRoleplayTemplate({
        id: oldTemplateId,
        userId: testUserId,
        isBuiltIn: false,
        pluginName: null,
      });
      const exportData = {
        manifest: createMockExportManifest({ exportType: 'characters' }),
        data: {
          characters: [character],
          roleplayTemplates: [template],
        },
      };

      mockGlobalRepos.roleplayTemplates.create.mockImplementation(async (data) => ({
        ...data,
        id: newTemplateId,
      }) as any);
      mockUserRepos.characters.create.mockImplementation(async (data) => ({
        ...data,
        id: character.id,
      }) as any);
      mockUserRepos.characters.findById.mockResolvedValue({
        ...character,
        defaultRoleplayTemplateId: oldTemplateId,
      } as any);

      await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(mockUserRepos.characters.update).toHaveBeenCalledWith(
        character.id,
        expect.objectContaining({
          defaultRoleplayTemplateId: newTemplateId,
        })
      );
    });

    it('should not remap plugin template IDs for characters', async () => {
      const pluginTemplateId = 'plugin:my-plugin:template-name';
      const character = createMockExportedCharacter({
        defaultRoleplayTemplateId: pluginTemplateId,
      });
      const exportData = createMockQuilltapExport({ characters: [character] });

      mockUserRepos.characters.create.mockImplementation(async (data) => ({
        ...data,
        id: character.id,
      }) as any);
      mockUserRepos.characters.findById.mockResolvedValue({
        ...character,
        defaultRoleplayTemplateId: pluginTemplateId,
      } as any);

      await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      // Should NOT try to update the plugin template reference
      const updateCalls = mockUserRepos.characters.update.mock.calls;
      if (updateCalls.length > 0) {
        expect(updateCalls[0][1]).not.toHaveProperty('defaultRoleplayTemplateId');
      }
    });
  });

  // ============================================================================
  // executeImport() - Chat Participant Reconciliation Tests
  // ============================================================================

  describe('executeImport() - chat participant reconciliation', () => {
    it('should remap roleplayTemplateId in chat participants', async () => {
      const oldTemplateId = generateId();
      const newTemplateId = generateId();
      const chat = createMockExportedChat({
        participants: [
          createMockChatParticipant({
            roleplayTemplateId: oldTemplateId,
          }),
        ],
      });
      const template = createMockRoleplayTemplate({
        id: oldTemplateId,
        userId: testUserId,
        isBuiltIn: false,
        pluginName: null,
      });
      const exportData = {
        manifest: createMockExportManifest({ exportType: 'chats' }),
        data: {
          chats: [chat],
          roleplayTemplates: [template],
        },
      };

      mockGlobalRepos.roleplayTemplates.create.mockImplementation(async (data) => ({
        ...data,
        id: newTemplateId,
      }) as any);
      mockUserRepos.chats.create.mockImplementation(async (data) => ({
        ...data,
        id: chat.id,
      }) as any);
      mockUserRepos.chats.findById.mockResolvedValue({
        ...chat,
        participants: chat.participants,
      } as any);

      await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      // Check that participants were remapped
      expect(mockUserRepos.chats.update).toHaveBeenCalled();
      const updateCall = mockUserRepos.chats.update.mock.calls[0];
      expect(updateCall[1].participants[0].roleplayTemplateId).toBe(newTemplateId);
    });

    it('should not remap plugin template IDs in chat participants', async () => {
      const pluginTemplateId = 'plugin:my-plugin:template-name';
      const chat = createMockExportedChat({
        participants: [
          createMockChatParticipant({
            roleplayTemplateId: pluginTemplateId,
          }),
        ],
      });
      const exportData = createMockChatsExport({ chats: [chat] });

      mockUserRepos.chats.create.mockImplementation(async (data) => ({
        ...data,
        id: chat.id,
      }) as any);
      mockUserRepos.chats.findById.mockResolvedValue({
        ...chat,
        participants: chat.participants,
      } as any);

      await executeImport(testUserId, exportData, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      // Plugin template ID should be preserved unchanged
      const updateCall = mockUserRepos.chats.update.mock.calls[0];
      expect(updateCall[1].participants[0].roleplayTemplateId).toBe(pluginTemplateId);
    });
  });

  // ============================================================================
  // executeImport() - Profile Tags Reconciliation Tests
  // ============================================================================

  describe('executeImport() - profile tags reconciliation', () => {
    it('should remap tags in connection profiles', async () => {
      const oldTagId = generateId();
      const newTagId = generateId();
      const tag = createMockTag({ id: oldTagId, name: 'ProfileTag' });
      const profile = createMockSanitizedConnectionProfile({
        tags: [oldTagId],
      });
      const exportData = {
        manifest: createMockExportManifest({ exportType: 'connection-profiles' }),
        data: {
          connectionProfiles: [profile],
          tags: [tag],
        },
      };

      mockUserRepos.tags.create.mockImplementation(async (data) => ({
        ...data,
        id: newTagId,
      }) as any);
      mockUserRepos.connections.create.mockImplementation(async (data) => ({
        ...data,
        id: profile.id,
      }) as any);
      mockUserRepos.connections.findById.mockResolvedValue({
        ...profile,
        tags: [oldTagId],
      } as any);

      await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(mockUserRepos.connections.update).toHaveBeenCalledWith(
        profile.id,
        expect.objectContaining({
          tags: [newTagId],
        })
      );
    });

    it('should remap tags in image profiles', async () => {
      const oldTagId = generateId();
      const newTagId = generateId();
      const tag = createMockTag({ id: oldTagId, name: 'ImageTag' });
      const profile = createMockSanitizedImageProfile({
        tags: [oldTagId],
      });
      const exportData = {
        manifest: createMockExportManifest({ exportType: 'image-profiles' }),
        data: {
          imageProfiles: [profile],
          tags: [tag],
        },
      };

      mockUserRepos.tags.create.mockImplementation(async (data) => ({
        ...data,
        id: newTagId,
      }) as any);
      mockUserRepos.imageProfiles.create.mockImplementation(async (data) => ({
        ...data,
        id: profile.id,
      }) as any);
      mockUserRepos.imageProfiles.findById.mockResolvedValue({
        ...profile,
        tags: [oldTagId],
      } as any);

      await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(mockUserRepos.imageProfiles.update).toHaveBeenCalledWith(
        profile.id,
        expect.objectContaining({
          tags: [newTagId],
        })
      );
    });

    it('should remap tags in embedding profiles', async () => {
      const oldTagId = generateId();
      const newTagId = generateId();
      const tag = createMockTag({ id: oldTagId, name: 'EmbedTag' });
      const profile = createMockSanitizedEmbeddingProfile({
        tags: [oldTagId],
      });
      const exportData = {
        manifest: createMockExportManifest({ exportType: 'embedding-profiles' }),
        data: {
          embeddingProfiles: [profile],
          tags: [tag],
        },
      };

      mockUserRepos.tags.create.mockImplementation(async (data) => ({
        ...data,
        id: newTagId,
      }) as any);
      mockUserRepos.embeddingProfiles.create.mockImplementation(async (data) => ({
        ...data,
        id: profile.id,
      }) as any);
      mockUserRepos.embeddingProfiles.findById.mockResolvedValue({
        ...profile,
        tags: [oldTagId],
      } as any);

      await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(mockUserRepos.embeddingProfiles.update).toHaveBeenCalledWith(
        profile.id,
        expect.objectContaining({
          tags: [newTagId],
        })
      );
    });
  });

  // ============================================================================
  // executeImport() - Roleplay Template Tags Reconciliation Tests
  // ============================================================================

  describe('executeImport() - roleplay template tags reconciliation', () => {
    it('should remap tags in roleplay templates', async () => {
      const oldTagId = generateId();
      const newTagId = generateId();
      const tag = createMockTag({ id: oldTagId, name: 'TemplateTag' });
      const template = createMockRoleplayTemplate({
        userId: testUserId,
        isBuiltIn: false,
        pluginName: null,
        tags: [oldTagId],
      });
      const exportData = {
        manifest: createMockExportManifest({ exportType: 'roleplay-templates' }),
        data: {
          roleplayTemplates: [template],
          tags: [tag],
        },
      };

      mockUserRepos.tags.create.mockImplementation(async (data) => ({
        ...data,
        id: newTagId,
      }) as any);
      mockGlobalRepos.roleplayTemplates.create.mockImplementation(async (data) => ({
        ...data,
        id: template.id,
      }) as any);
      mockGlobalRepos.roleplayTemplates.findById.mockResolvedValue({
        ...template,
        tags: [oldTagId],
      } as any);

      await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(mockGlobalRepos.roleplayTemplates.update).toHaveBeenCalledWith(
        template.id,
        expect.objectContaining({
          tags: [newTagId],
        })
      );
    });
  });

  // ============================================================================
  // executeImport() - Project Field Reconciliation Tests
  // ============================================================================

  describe('executeImport() - project relationship reconciliation', () => {
    const makeProject = (overrides: Record<string, unknown>) => ({
      id: generateId(),
      userId: testUserId,
      name: 'Test Project',
      description: null,
      instructions: null,
      allowAnyCharacter: false,
      characterRoster: [],
      color: null,
      icon: null,
      defaultDisabledTools: [],
      defaultDisabledToolGroups: [],
      state: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    });

    // jest.clearAllMocks() in the outer beforeEach clears call data but NOT
    // implementations, so findById stubs set by earlier suites leak in. These
    // tests rely on the image profile / roleplay template being treated as NEW
    // (default null) so they're created and land in the id maps; force that
    // baseline before each case.
    beforeEach(() => {
      mockUserRepos.projects.findById.mockResolvedValue(null);
      mockUserRepos.imageProfiles.findById.mockResolvedValue(null);
      mockGlobalRepos.roleplayTemplates.findById.mockResolvedValue(null);
    });

    // `projects.findById` doubles as the import existence-check and the
    // reconcile lookup; a test that stubs it must not leak that into later
    // suites (e.g. the memory projectId test that needs the default null).
    afterEach(() => {
      mockUserRepos.projects.findById.mockReset();
      mockUserRepos.projects.findById.mockResolvedValue(null);
    });

    it('should remap defaultImageProfileId for projects', async () => {
      const oldProfileId = generateId();
      const newProfileId = generateId();
      const profile = createMockSanitizedImageProfile({ id: oldProfileId });
      const project = makeProject({ defaultImageProfileId: oldProfileId });
      const exportData = {
        manifest: createMockExportManifest({ exportType: 'characters' }),
        data: {
          imageProfiles: [profile],
          projects: [project],
        },
      };

      mockUserRepos.imageProfiles.create.mockImplementation(async (data) => ({
        ...data,
        id: newProfileId,
      }) as any);
      mockUserRepos.projects.findById.mockResolvedValue({
        ...project,
        defaultImageProfileId: oldProfileId,
      } as any);

      await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(mockUserRepos.projects.update).toHaveBeenCalledWith(
        project.id,
        expect.objectContaining({
          defaultImageProfileId: newProfileId,
        })
      );
    });

    it('should remap defaultRoleplayTemplateId for projects', async () => {
      const oldTemplateId = generateId();
      const newTemplateId = generateId();
      const template = createMockRoleplayTemplate({
        id: oldTemplateId,
        userId: testUserId,
        isBuiltIn: false,
        pluginName: null,
      });
      const project = makeProject({ defaultRoleplayTemplateId: oldTemplateId });
      const exportData = {
        manifest: createMockExportManifest({ exportType: 'characters' }),
        data: {
          roleplayTemplates: [template],
          projects: [project],
        },
      };

      mockGlobalRepos.roleplayTemplates.create.mockImplementation(async (data) => ({
        ...data,
        id: newTemplateId,
      }) as any);
      mockUserRepos.projects.findById.mockResolvedValue({
        ...project,
        defaultRoleplayTemplateId: oldTemplateId,
      } as any);

      await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: false,
        includeRelatedEntities: false,
      });

      expect(mockUserRepos.projects.update).toHaveBeenCalledWith(
        project.id,
        expect.objectContaining({
          defaultRoleplayTemplateId: newTemplateId,
        })
      );
    });
  });

  // ============================================================================
  // executeImport() - Memory Field Reconciliation Tests
  // ============================================================================

  describe('executeImport() - memory field reconciliation', () => {
    it('should remap projectId in memories', async () => {
      const oldProjectId = generateId();
      const newProjectId = generateId();
      const characterId = generateId();
      const character = createMockExportedCharacter({ id: characterId });
      const project = {
        id: oldProjectId,
        userId: testUserId,
        name: 'Test Project',
        description: null,
        instructions: null,
        allowAnyCharacter: false,
        characterRoster: [],
        color: null,
        icon: null,
        defaultDisabledTools: [],
        defaultDisabledToolGroups: [],
        state: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const memory = createMockMemory({
        characterId,
        projectId: oldProjectId,
      });
      const exportData = {
        manifest: createMockExportManifest({ exportType: 'characters' }),
        data: {
          characters: [character],
          projects: [project],
          memories: [memory],
        },
      };

      mockUserRepos.projects.create.mockImplementation(async (data) => ({
        ...data,
        id: newProjectId,
      }) as any);
      mockUserRepos.characters.create.mockImplementation(async (data) => ({
        ...data,
        id: characterId,
      }) as any);

      await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: true,
        includeRelatedEntities: false,
      });

      // Check that memory was created with remapped projectId
      expect(mockUserRepos.memories.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: newProjectId,
        })
      );
    });

    it('should remap tags in memories', async () => {
      const oldTagId = generateId();
      const newTagId = generateId();
      const characterId = generateId();
      const character = createMockExportedCharacter({ id: characterId });
      const tag = createMockTag({ id: oldTagId, name: 'MemoryTag' });
      const memory = createMockMemory({
        characterId,
        tags: [oldTagId],
      });
      const exportData = {
        manifest: createMockExportManifest({ exportType: 'characters' }),
        data: {
          characters: [character],
          tags: [tag],
          memories: [memory],
        },
      };

      mockUserRepos.tags.create.mockImplementation(async (data) => ({
        ...data,
        id: newTagId,
      }) as any);
      mockUserRepos.characters.create.mockImplementation(async (data) => ({
        ...data,
        id: characterId,
      }) as any);

      await executeImport(testUserId, exportData as any, {
        conflictStrategy: 'skip',
        includeMemories: true,
        includeRelatedEntities: false,
      });

      // Check that memory was created with remapped tags
      expect(mockUserRepos.memories.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: [newTagId],
        })
      );
    });
  });
});
