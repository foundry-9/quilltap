/**
 * JSON Store Integration Tests
 *
 * Comprehensive tests for all JSON store repositories and operations.
 * Tests data consistency, file I/O, and edge cases.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { JsonStore } from '@/lib/json-store/core/json-store';
import { CharactersRepository } from '@/lib/json-store/repositories/characters.repository';
import { PersonasRepository } from '@/lib/json-store/repositories/personas.repository';
import { TagsRepository } from '@/lib/json-store/repositories/tags.repository';
import { ChatsRepository } from '@/lib/json-store/repositories/chats.repository';
import { UsersRepository } from '@/lib/json-store/repositories/users.repository';
import { ImagesRepository } from '@/lib/json-store/repositories/images.repository';
import { ConnectionProfilesRepository } from '@/lib/json-store/repositories/connection-profiles.repository';

// Test UUIDs - using valid UUID format
const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_CHARACTER_ID = '22222222-2222-2222-2222-222222222222';
const TEST_CONNECTION_PROFILE_ID = '33333333-3333-3333-3333-333333333333';
const TEST_TAG_ID_1 = '44444444-4444-4444-4444-444444444444';
const TEST_TAG_ID_2 = '55555555-5555-5555-5555-555555555555';
const TEST_MESSAGE_ID_1 = '66666666-6666-6666-6666-666666666666';
const TEST_MESSAGE_ID_2 = '77777777-7777-7777-7777-777777777777';
const TEST_CHAR_LINK_ID = '88888888-8888-8888-8888-888888888888';

// Helper function to create minimal character data
function createCharacterData(overrides: any = {}) {
  return {
    userId: TEST_USER_ID,
    name: 'Test Character',
    description: 'A test character',
    personality: 'Test personality',
    scenario: 'Test scenario',
    firstMessage: 'Hello',
    tags: [],
    isFavorite: false,
    personaLinks: [],
    avatarOverrides: [],
    ...overrides,
  };
}

// Helper function to create minimal chat data
function createChatData(overrides: any = {}) {
  return {
    userId: TEST_USER_ID,
    characterId: TEST_CHARACTER_ID,
    connectionProfileId: TEST_CONNECTION_PROFILE_ID,
    title: 'Test Chat',
    tags: [],
    messageCount: 0,
    ...overrides,
  };
}

// Helper function to create minimal persona data
function createPersonaData(overrides: any = {}) {
  return {
    userId: TEST_USER_ID,
    name: 'Test Persona',
    description: 'A test persona',
    tags: [],
    characterLinks: [],
    ...overrides,
  };
}

// Helper function to create minimal connection profile data
function createConnectionData(overrides: any = {}) {
  return {
    userId: TEST_USER_ID,
    name: 'Test Profile',
    provider: 'OPENAI' as const,
    modelName: 'gpt-4',
    parameters: {},
    isDefault: false,
    tags: [],
    ...overrides,
  };
}

describe('JSON Store Integration Tests', () => {
  let tempDir: string;
  let jsonStore: JsonStore;

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = path.join('/tmp', `quilltap-test-${Date.now()}-${Math.random().toString(36)}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Initialize directory structure
    fs.mkdirSync(path.join(tempDir, 'settings'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'characters'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'personas'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'chats'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'tags'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'auth'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'binaries'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'image-profiles'), { recursive: true });

    // Initialize JsonStore
    jsonStore = new JsonStore({
      dataDir: tempDir,
      enableCache: false,
    });
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // CHARACTER TESTS
  // ============================================================================

  describe('CharactersRepository', () => {
    let charactersRepo: CharactersRepository;

    beforeEach(() => {
      charactersRepo = new CharactersRepository(jsonStore);
    });

    it('should create and retrieve a character', async () => {
      const character = await charactersRepo.create(
        createCharacterData({ name: 'Alice' })
      );

      expect(character.id).toBeDefined();
      expect(character.name).toBe('Alice');
      expect(character.userId).toBe(TEST_USER_ID);

      const retrieved = await charactersRepo.findById(character.id);
      expect(retrieved).toEqual(character);
    });

    it('should find characters by user ID', async () => {
      await charactersRepo.create(createCharacterData({ name: 'Alice' }));
      await charactersRepo.create(createCharacterData({ name: 'Bob' }));

      const characters = await charactersRepo.findByUserId(TEST_USER_ID);
      expect(characters).toHaveLength(2);
      expect(characters.map(c => c.name)).toContain('Alice');
      expect(characters.map(c => c.name)).toContain('Bob');
    });

    it('should update a character', async () => {
      const original = await charactersRepo.create(
        createCharacterData({ name: 'Alice' })
      );

      const updated = await charactersRepo.update(original.id, {
        name: 'Alice Updated',
        description: 'Updated description',
      });

      expect(updated?.name).toBe('Alice Updated');
      expect(updated?.description).toBe('Updated description');
      expect(updated?.id).toBe(original.id);
      expect(updated?.createdAt).toBe(original.createdAt);
    });

    it('should delete a character', async () => {
      const character = await charactersRepo.create(
        createCharacterData({ name: 'Alice' })
      );

      const deleted = await charactersRepo.delete(character.id);
      expect(deleted).toBe(true);

      const retrieved = await charactersRepo.findById(character.id);
      expect(retrieved).toBeNull();
    });

    it('should manage character tags', async () => {
      const character = await charactersRepo.create(
        createCharacterData({ name: 'Alice' })
      );

      let updated = await charactersRepo.addTag(character.id, TEST_TAG_ID_1);
      expect(updated?.tags).toContain(TEST_TAG_ID_1);

      updated = await charactersRepo.addTag(character.id, TEST_TAG_ID_2);
      expect(updated?.tags).toHaveLength(2);

      updated = await charactersRepo.removeTag(character.id, TEST_TAG_ID_1);
      expect(updated?.tags).toEqual([TEST_TAG_ID_2]);
    });
  });

  // ============================================================================
  // TAG TESTS
  // ============================================================================

  describe('TagsRepository', () => {
    let tagsRepo: TagsRepository;

    beforeEach(() => {
      tagsRepo = new TagsRepository(jsonStore);
    });

    it('should create and retrieve a tag', async () => {
      const tag = await tagsRepo.create({
        userId: TEST_USER_ID,
        name: 'Fantasy',
        nameLower: 'fantasy',
        quickHide: false,
      });

      expect(tag.id).toBeDefined();
      expect(tag.name).toBe('Fantasy');

      const retrieved = await tagsRepo.findById(tag.id);
      expect(retrieved).toEqual(tag);
    });

    it('should find tags by user ID', async () => {
      await tagsRepo.create({
        userId: TEST_USER_ID,
        name: 'Fantasy',
        nameLower: 'fantasy',
        quickHide: false,
      });

      await tagsRepo.create({
        userId: TEST_USER_ID,
        name: 'Sci-Fi',
        nameLower: 'sci-fi',
        quickHide: false,
      });

      const tags = await tagsRepo.findByUserId(TEST_USER_ID);
      expect(tags).toHaveLength(2);
    });

    it('should find tag by name (case-insensitive)', async () => {
      await tagsRepo.create({
        userId: TEST_USER_ID,
        name: 'Fantasy',
        nameLower: 'fantasy',
        quickHide: false,
      });

      const found = await tagsRepo.findByName(TEST_USER_ID, 'fantasy');
      expect(found?.name).toBe('Fantasy');

      const notFound = await tagsRepo.findByName(TEST_USER_ID, 'NonExistent');
      expect(notFound).toBeNull();
    });

    it('should update a tag', async () => {
      const tag = await tagsRepo.create({
        userId: TEST_USER_ID,
        name: 'Fantasy',
        nameLower: 'fantasy',
        quickHide: false,
      });

      const updated = await tagsRepo.update(tag.id, {
        name: 'Fantasy Updated',
        nameLower: 'fantasy updated',
      });

      expect(updated?.name).toBe('Fantasy Updated');
      expect(updated?.id).toBe(tag.id);
    });

    it('should delete a tag', async () => {
      const tag = await tagsRepo.create({
        userId: TEST_USER_ID,
        name: 'Fantasy',
        nameLower: 'fantasy',
        quickHide: false,
      });

      const deleted = await tagsRepo.delete(tag.id);
      expect(deleted).toBe(true);

      const retrieved = await tagsRepo.findById(tag.id);
      expect(retrieved).toBeNull();
    });
  });

  // ============================================================================
  // CHAT TESTS
  // ============================================================================

  describe('ChatsRepository', () => {
    let chatsRepo: ChatsRepository;

    beforeEach(() => {
      chatsRepo = new ChatsRepository(jsonStore);
    });

    it('should create and retrieve a chat', async () => {
      const chat = await chatsRepo.create(createChatData({ title: 'Test Chat' }));

      expect(chat.id).toBeDefined();
      expect(chat.title).toBe('Test Chat');

      const retrieved = await chatsRepo.findById(chat.id);
      expect(retrieved).toEqual(chat);
    });

    it('should add messages to a chat', async () => {
      const chat = await chatsRepo.create(createChatData({ title: 'Test Chat' }));

      const message = await chatsRepo.addMessage(chat.id, {
        type: 'message',
        id: TEST_MESSAGE_ID_1,
        role: 'USER',
        content: 'Hello',
        createdAt: new Date().toISOString(),
        attachments: [],
      });

      expect(message.id).toBe(TEST_MESSAGE_ID_1);

      const messages = await chatsRepo.getMessages(chat.id);
      expect(messages).toHaveLength(1);
      expect(messages[0].type === 'message' && messages[0].content).toBe('Hello');
    });

    it('should get message count', async () => {
      const chat = await chatsRepo.create(createChatData({ title: 'Test Chat' }));

      await chatsRepo.addMessage(chat.id, {
        type: 'message',
        id: TEST_MESSAGE_ID_1,
        role: 'USER',
        content: 'Hi',
        createdAt: new Date().toISOString(),
        attachments: [],
      });

      await chatsRepo.addMessage(chat.id, {
        type: 'message',
        id: TEST_MESSAGE_ID_2,
        role: 'ASSISTANT',
        content: 'Hello',
        createdAt: new Date().toISOString(),
        attachments: [],
      });

      const count = await chatsRepo.getMessageCount(chat.id);
      expect(count).toBe(2);
    });

    it('should find chats by user ID', async () => {
      await chatsRepo.create(createChatData({ title: 'Chat 1' }));
      await chatsRepo.create(createChatData({ title: 'Chat 2' }));

      const chats = await chatsRepo.findByUserId(TEST_USER_ID);
      expect(chats).toHaveLength(2);
    });
  });

  // ============================================================================
  // PERSONA TESTS
  // ============================================================================

  describe('PersonasRepository', () => {
    let personasRepo: PersonasRepository;

    beforeEach(() => {
      personasRepo = new PersonasRepository(jsonStore);
    });

    it('should create and retrieve a persona', async () => {
      const persona = await personasRepo.create(
        createPersonaData({ name: 'Cool Persona', description: 'A cool character' })
      );

      expect(persona.id).toBeDefined();
      expect(persona.name).toBe('Cool Persona');

      const retrieved = await personasRepo.findById(persona.id);
      expect(retrieved).toEqual(persona);
    });

    it('should manage character links', async () => {
      const persona = await personasRepo.create(
        createPersonaData({ name: 'Persona', description: 'Description' })
      );

      let updated = await personasRepo.addCharacterLink(persona.id, TEST_CHAR_LINK_ID);
      expect(updated?.characterLinks).toContain(TEST_CHAR_LINK_ID);

      updated = await personasRepo.removeCharacterLink(persona.id, TEST_CHAR_LINK_ID);
      expect(updated?.characterLinks).not.toContain(TEST_CHAR_LINK_ID);
    });
  });

  // ============================================================================
  // IMAGE TESTS
  // ============================================================================

  describe('ImagesRepository', () => {
    let imagesRepo: ImagesRepository;

    beforeEach(() => {
      imagesRepo = new ImagesRepository(jsonStore);
    });

    it('should create and retrieve an image entry', async () => {
      const entry = await imagesRepo.create({
        sha256: 'a'.repeat(64),
        type: 'image',
        userId: TEST_USER_ID,
        filename: 'test.png',
        relativePath: 'binaries/aaa.../raw',
        mimeType: 'image/png',
        size: 1024,
        width: 512,
        height: 512,
        source: 'upload',
        tags: [],
      });

      expect(entry.id).toBeDefined();
      expect(entry.filename).toBe('test.png');

      const retrieved = await imagesRepo.findById(entry.id);
      expect(retrieved).toEqual(entry);
    });

    it('should find images by user ID', async () => {
      await imagesRepo.create({
        sha256: 'a'.repeat(64),
        type: 'image',
        userId: TEST_USER_ID,
        filename: 'image1.png',
        relativePath: 'binaries/aaa.../raw',
        mimeType: 'image/png',
        size: 1024,
        width: 512,
        height: 512,
        source: 'upload',
        tags: [],
      });

      const images = await imagesRepo.findByUserId(TEST_USER_ID);
      expect(images).toHaveLength(1);
      expect(images[0].filename).toBe('image1.png');
    });
  });

  // ============================================================================
  // CONNECTION PROFILES TESTS
  // ============================================================================

  describe('ConnectionProfilesRepository', () => {
    let connectionRepo: ConnectionProfilesRepository;

    beforeEach(() => {
      connectionRepo = new ConnectionProfilesRepository(jsonStore);
    });

    it('should create and retrieve a connection profile', async () => {
      const profile = await connectionRepo.create(
        createConnectionData({
          name: 'OpenAI Default',
          modelName: 'gpt-4-turbo',
          parameters: { temperature: 0.7 },
        })
      );

      expect(profile.id).toBeDefined();
      expect(profile.name).toBe('OpenAI Default');

      const retrieved = await connectionRepo.findById(profile.id);
      expect(retrieved).toEqual(profile);
    });

    it('should create and manage API keys', async () => {
      const apiKey = await connectionRepo.createApiKey({
        label: 'My API Key',
        provider: 'OPENAI',
        ciphertext: 'encrypted-key',
        iv: 'init-vector',
        authTag: 'auth-tag',
        isActive: true,
      });

      expect(apiKey.id).toBeDefined();
      expect(apiKey.label).toBe('My API Key');

      const retrieved = await connectionRepo.findApiKeyById(apiKey.id);
      expect(retrieved).toEqual(apiKey);
    });

    it('should find default connection profile', async () => {
      await connectionRepo.create(
        createConnectionData({ name: 'Not Default', isDefault: false })
      );

      const profile = await connectionRepo.create(
        createConnectionData({ name: 'Default Profile', isDefault: true })
      );

      const found = await connectionRepo.findDefault(TEST_USER_ID);
      expect(found?.id).toBe(profile.id);
    });
  });

  // ============================================================================
  // USERS TESTS
  // ============================================================================

  describe('UsersRepository', () => {
    let usersRepo: UsersRepository;

    beforeEach(() => {
      usersRepo = new UsersRepository(jsonStore);
    });

    it('should create and retrieve a user', async () => {
      const user = await usersRepo.create({
        email: 'test@example.com',
        name: 'Test User',
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe('test@example.com');

      const retrieved = await usersRepo.findById(user.id);
      expect(retrieved?.email).toBe('test@example.com');
    });

    it('should find user by email', async () => {
      await usersRepo.create({
        email: 'test@example.com',
        name: 'Test User',
      });

      const found = await usersRepo.findByEmail('test@example.com');
      expect(found?.email).toBe('test@example.com');
    });

    it('should manage chat settings', async () => {
      const user = await usersRepo.create({
        email: 'test@example.com',
        name: 'Test User',
      });

      const settings = await usersRepo.getChatSettings(user.id);
      expect(settings).toBeDefined();
      expect(settings?.avatarDisplayMode).toBe('ALWAYS');
      expect(settings?.tagStyles).toEqual({});

      const updated = await usersRepo.updateChatSettings(user.id, {
        avatarDisplayMode: 'NEVER',
        tagStyles: {
          '123e4567-e89b-12d3-a456-426614174000': {
            emoji: '🔥',
            foregroundColor: '#ffffff',
            backgroundColor: '#ff0000',
          },
        },
      });

      expect(updated?.avatarDisplayMode).toBe('NEVER');
      expect(updated?.tagStyles).toMatchObject({
        '123e4567-e89b-12d3-a456-426614174000': {
          emoji: '🔥',
          foregroundColor: '#ffffff',
          backgroundColor: '#ff0000',
        },
      });
    });
  });
});
