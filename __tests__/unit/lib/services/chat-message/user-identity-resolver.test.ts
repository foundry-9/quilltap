import { resolveUserIdentity, ResolvedUserIdentity } from '@/lib/services/chat-message/user-identity-resolver.service';
import { createServiceLogger } from '@/lib/logging/create-logger';

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

describe('user-identity-resolver.service', () => {
  const createMockRepos = () => ({
    characters: {
      findById: jest.fn(),
      findByUserId: jest.fn().mockResolvedValue([]),
      findUserControlled: jest.fn().mockResolvedValue([]),
    },
    users: {
      findById: jest.fn().mockResolvedValue(null),
    },
  });

  const createMockChat = (participants: any[] = []) => ({
    id: 'chat-1',
    participants,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveUserIdentity', () => {
    describe('step 1: chat participant (user-controlled character)', () => {
      it('should return character from user-controlled chat participant', async () => {
        const repos = createMockRepos();
        const characterId = 'char-1';
        const chat = createMockChat([
          {
            id: 'participant-1',
            characterId,
            controlledBy: 'user',
            type: 'CHARACTER',
            isActive: true,
            status: 'active',
          },
        ]);

        repos.characters.findById.mockResolvedValue({
          id: characterId,
          name: 'Alice',
          description: 'A brave explorer',
        });

        const result = await resolveUserIdentity(repos as any, 'user-1', chat as any);

        expect(result).toEqual({
          name: 'Alice',
          description: 'A brave explorer',
          characterId,
          source: 'chat-participant',
        });
        expect(repos.characters.findById).toHaveBeenCalledWith(characterId);
      });

      it('should prefer the active "Speaking As" participant over the first user-controlled one', async () => {
        const repos = createMockRepos();
        const chat = createMockChat([
          { id: 'p-jackie', characterId: 'char-jackie', controlledBy: 'user', type: 'CHARACTER', isActive: true, status: 'active' },
          { id: 'p-revenant', characterId: 'char-revenant', controlledBy: 'user', type: 'CHARACTER', isActive: true, status: 'active' },
        ]);

        repos.characters.findById.mockImplementation((id: string) =>
          Promise.resolve(id === 'char-revenant'
            ? { id, name: 'Revenant', description: 'A formal presence' }
            : { id, name: 'Jackie', description: 'The first one' })
        );

        const result = await resolveUserIdentity(repos as any, 'user-1', chat as any, 'p-revenant');

        expect(result.name).toBe('Revenant');
        expect(result.characterId).toBe('char-revenant');
        expect(repos.characters.findById).toHaveBeenCalledWith('char-revenant');
      });

      it('should use character name and description from user-controlled participant', async () => {
        const repos = createMockRepos();
        const characterId = 'char-1';
        const chat = createMockChat([
          {
            id: 'participant-1',
            characterId,
            controlledBy: 'user',
            type: 'CHARACTER',
            isActive: true,
            status: 'active',
          },
        ]);

        repos.characters.findById.mockResolvedValue({
          id: characterId,
          name: 'Bob the Bard',
          description: 'A melodic wordsmith',
        });

        const result = await resolveUserIdentity(repos as any, 'user-1', chat as any);

        expect(result.name).toBe('Bob the Bard');
        expect(result.description).toBe('A melodic wordsmith');
      });

      it('should include characterId in response', async () => {
        const repos = createMockRepos();
        const characterId = 'char-special';
        const chat = createMockChat([
          {
            id: 'participant-1',
            characterId,
            controlledBy: 'user',
            type: 'CHARACTER',
            isActive: true,
            status: 'active',
          },
        ]);

        repos.characters.findById.mockResolvedValue({
          id: characterId,
          name: 'Test',
          description: 'Test desc',
        });

        const result = await resolveUserIdentity(repos as any, 'user-1', chat as any);

        expect(result.characterId).toBe(characterId);
      });

      it('should skip LLM-controlled participants', async () => {
        const repos = createMockRepos();
        const userCharacterId = 'char-user';
        const chat = createMockChat([
          {
            id: 'participant-1',
            characterId: 'char-llm',
            controlledBy: 'llm',
            type: 'CHARACTER',
            isActive: true,
            status: 'active',
          },
          {
            id: 'participant-2',
            characterId: userCharacterId,
            controlledBy: 'user',
            type: 'CHARACTER',
            isActive: true,
            status: 'active',
          },
        ]);

        repos.characters.findById.mockResolvedValue({
          id: userCharacterId,
          name: 'User Character',
          description: 'User controlled',
        });

        const result = await resolveUserIdentity(repos as any, 'user-1', chat as any);

        expect(result.characterId).toBe(userCharacterId);
        expect(result.name).toBe('User Character');
      });
    });

    describe('step 2: single user-controlled character system-wide', () => {
      it('should return single user-controlled character when no participant match', async () => {
        const repos = createMockRepos();
        const characterId = 'char-1';
        const chat = createMockChat([]);

        const userCharacter = {
          id: characterId,
          name: 'Solo Character',
          description: 'The only character',
        };

        repos.characters.findUserControlled.mockResolvedValue([userCharacter]);

        const result = await resolveUserIdentity(repos as any, 'user-1', chat as any);

        expect(result).toEqual({
          name: 'Solo Character',
          description: 'The only character',
          characterId,
          source: 'single-user-character',
        });
      });

      it('should skip resolution when multiple user-controlled characters exist', async () => {
        const repos = createMockRepos();
        const chat = createMockChat([]);

        repos.characters.findUserControlled.mockResolvedValue([
          { id: 'char-1', name: 'Character 1', description: 'First' },
          { id: 'char-2', name: 'Character 2', description: 'Second' },
        ]);

        repos.users.findById.mockResolvedValue({
          id: 'user-1',
          name: 'Profile Name',
        });

        const result = await resolveUserIdentity(repos as any, 'user-1', chat as any);

        expect(result.source).toBe('user-profile');
        expect(result.name).toBe('Profile Name');
      });
    });

    describe('step 3: user profile fallback', () => {
      it('should return user profile name when no character available', async () => {
        const repos = createMockRepos();
        const chat = createMockChat([]);

        repos.characters.findByUserId.mockResolvedValue([]);
        repos.users.findById.mockResolvedValue({
          id: 'user-1',
          name: 'John Doe',
        });

        const result = await resolveUserIdentity(repos as any, 'user-1', chat as any);

        expect(result).toEqual({
          name: 'John Doe',
          description: '',
          source: 'user-profile',
        });
        expect(result.characterId).toBeUndefined();
      });

      it('should use user profile name when no characters', async () => {
        const repos = createMockRepos();
        const chat = createMockChat([]);

        repos.characters.findByUserId.mockResolvedValue([]);
        repos.users.findById.mockResolvedValue({
          id: 'user-1',
          name: 'Jane Smith',
        });

        const result = await resolveUserIdentity(repos as any, 'user-1', chat as any);

        expect(result.name).toBe('Jane Smith');
        expect(result.source).toBe('user-profile');
      });
    });

    describe('step 4: default fallback', () => {
      it('should return default "User" when no profile exists', async () => {
        const repos = createMockRepos();
        const chat = createMockChat([]);

        repos.characters.findByUserId.mockResolvedValue([]);
        repos.users.findById.mockResolvedValue(null);

        const result = await resolveUserIdentity(repos as any, 'user-1', chat as any);

        expect(result).toEqual({
          name: 'User',
          description: '',
          source: 'default',
        });
        expect(result.characterId).toBeUndefined();
      });

      it('should have empty description in default response', async () => {
        const repos = createMockRepos();
        const chat = createMockChat([]);

        repos.characters.findByUserId.mockResolvedValue([]);
        repos.users.findById.mockResolvedValue(null);

        const result = await resolveUserIdentity(repos as any, 'user-1', chat as any);

        expect(result.description).toBe('');
      });
    });

    describe('edge cases', () => {
      it('should handle chat with no participants', async () => {
        const repos = createMockRepos();
        const chat = createMockChat([]);

        repos.characters.findByUserId.mockResolvedValue([]);
        repos.users.findById.mockResolvedValue({
          id: 'user-1',
          name: 'Test User',
        });

        const result = await resolveUserIdentity(repos as any, 'user-1', chat as any);

        expect(result.source).toBe('user-profile');
        expect(result.name).toBe('Test User');
      });

      it('should handle character not found by ID (deleted)', async () => {
        const repos = createMockRepos();
        const characterId = 'deleted-char';
        const chat = createMockChat([
          {
            id: 'participant-1',
            characterId,
            controlledBy: 'user',
            type: 'CHARACTER',
            isActive: true,
            status: 'active',
          },
        ]);

        repos.characters.findById.mockResolvedValue(null);
        repos.characters.findByUserId.mockResolvedValue([]);
        repos.users.findById.mockResolvedValue({
          id: 'user-1',
          name: 'Profile Fallback',
        });

        const result = await resolveUserIdentity(repos as any, 'user-1', chat as any);

        expect(result.source).toBe('user-profile');
        expect(result.name).toBe('Profile Fallback');
      });

      it('should prioritize step 1 over step 2', async () => {
        const repos = createMockRepos();
        const participantCharacterId = 'char-participant';
        const otherCharacterId = 'char-other';

        const chat = createMockChat([
          {
            id: 'participant-1',
            characterId: participantCharacterId,
            controlledBy: 'user',
            type: 'CHARACTER',
            isActive: true,
            status: 'active',
          },
        ]);

        repos.characters.findById.mockResolvedValue({
          id: participantCharacterId,
          name: 'Participant Character',
          description: 'From chat',
        });

        const result = await resolveUserIdentity(repos as any, 'user-1', chat as any);

        expect(result.source).toBe('chat-participant');
        expect(result.characterId).toBe(participantCharacterId);
        expect(result.name).toBe('Participant Character');
      });
    });
  });
});
