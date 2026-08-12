/**
 * `run_custom` — the seam where the rolling character's fact sheet is fetched
 * and handed to the execution core.
 *
 * The runner itself is pure and covered elsewhere; what is tested here is the
 * wiring that decides WHOSE metadata a roll is dealt against. A handler that
 * quietly passed no sheet would look perfectly healthy — every gated table
 * would simply land on its catch-all forever, which is indistinguishable from a
 * character legitimately lacking the key. That is precisely the bug this file
 * exists to catch.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

jest.mock('@/lib/repositories/factory');

jest.mock('@/lib/pascal/custom-tools', () => {
  const actual = jest.requireActual('@/lib/pascal/custom-tools');
  // The execution core stays REAL — the outcome table is the assertion.
  return { ...actual, resolveCustomToolRoster: jest.fn() };
});

jest.mock('@/lib/services/pascal/writer', () => ({
  buildPascalResultContent: jest.fn(({ toolTitle, message }: any) => ({
    content: `${toolTitle} — ${message}`,
    opaqueContent: `${toolTitle} — ${message}`,
  })),
  postPascalResult: jest.fn(),
}));

jest.mock('@/lib/services/prospero-notifications/writer', () => ({
  postProsperoCustomToolError: jest.fn().mockResolvedValue(undefined),
}));

import { executeRunCustomTool } from '@/lib/tools/handlers/run-custom-handler';
import { resolveCustomToolRoster } from '@/lib/pascal/custom-tools';
import { QtapCustomToolSchema } from '@/lib/pascal/custom-tool.types';
import { postPascalResult } from '@/lib/services/pascal/writer';
import { postProsperoCustomToolError } from '@/lib/services/prospero-notifications/writer';
import { CharacterVaultUnavailableError } from '@/lib/database/repositories/vault-overlay/schema';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const resolveRosterMock = resolveCustomToolRoster as jest.Mock;
const postPascalResultMock = postPascalResult as jest.Mock;
const postProsperoCustomToolErrorMock = postProsperoCustomToolError as jest.Mock;

const CHARACTER_ID = '11111111-1111-4111-8111-111111111111';

/** A table gated on the roller's fact sheet, with the mandatory catch-all. */
const DEFINITION = QtapCustomToolSchema.parse({
  name: 'ansible',
  description: 'Reach for the ansible.',
  roll: { min: 0.7, max: 0.7 },
  outcomes: [
    {
      when: { gt: 0.6, metadata: { hasAnsibleAccess: { eq: true } } },
      message: 'The ansible flickers to life.',
      state: 'success',
    },
    { when: true, message: 'The panel stays dark.', state: 'failure' },
  ],
});

function wireRoster() {
  resolveRosterMock.mockResolvedValue({
    tools: new Map([
      ['ansible', { definition: DEFINITION, tier: 'character', mountPointId: 'mp-1', mountName: 'Vault', definitionPath: 'Tools/ansible.tool.json' }],
    ]),
    errors: [],
    droppedForCap: [],
  });
}

/** Wire `findById` to return a character carrying `metadata` (or to throw). */
function wireCharacter(result: { metadata?: Record<string, unknown> } | Error) {
  getRepositoriesMock.mockReturnValue({
    characters: {
      findById: jest.fn(() =>
        result instanceof Error ? Promise.reject(result) : Promise.resolve({ id: CHARACTER_ID, name: 'Bertie', ...result }),
      ),
    },
  });
}

const context = { userId: 'user-1', chatId: 'chat-1', characterId: CHARACTER_ID };

beforeEach(() => {
  jest.clearAllMocks();
  wireRoster();
  postPascalResultMock.mockResolvedValue({ id: 'msg-1' });
});

describe('run_custom — dealing against the roller\'s fact sheet', () => {
  it('matches the gated outcome for a character carrying the key', async () => {
    wireCharacter({ metadata: { hasAnsibleAccess: true } });

    const result = await executeRunCustomTool({ tool: 'ansible' }, context);

    expect(result.success).toBe(true);
    expect(result.state).toBe('success');
    expect(result.message).toBe('The ansible flickers to life.');
  });

  it('falls to the catch-all for a character without the key', async () => {
    wireCharacter({ metadata: { faction: 'Ordo Ferrum' } });

    const result = await executeRunCustomTool({ tool: 'ansible' }, context);

    expect(result.success).toBe(true);
    expect(result.state).toBe('failure');
    // A missing key is a fact about the character, not an error: no bubble.
    expect(postProsperoCustomToolErrorMock).not.toHaveBeenCalled();
  });

  it('falls to the catch-all for a character with no sheet at all', async () => {
    wireCharacter({ metadata: null as any });
    expect((await executeRunCustomTool({ tool: 'ansible' }, context)).state).toBe('failure');
  });

  it('falls to the catch-all when no character is rolling', async () => {
    getRepositoriesMock.mockReturnValue({ characters: { findById: jest.fn() } });
    const result = await executeRunCustomTool({ tool: 'ansible' }, { ...context, characterId: null });
    expect(result.state).toBe('failure');
  });

  it('records what the winning row saw in pascalMeta', async () => {
    wireCharacter({ metadata: { hasAnsibleAccess: true, clearanceLevel: 3 } });

    await executeRunCustomTool({ tool: 'ansible' }, context);

    // Only the key the row tested — clearanceLevel is the character's business.
    expect(postPascalResultMock.mock.calls[0][0].pascalMeta.metadataTested).toEqual({ hasAnsibleAccess: true });
  });

  it('omits metadataTested when the catch-all won', async () => {
    wireCharacter({ metadata: {} });

    await executeRunCustomTool({ tool: 'ansible' }, context);

    expect(postPascalResultMock.mock.calls[0][0].pascalMeta.metadataTested).toBeUndefined();
  });

  it('reports a broken vault rather than dealing the table an empty sheet', async () => {
    // Silently rolling with {} would land on the catch-all and read as a
    // legitimate failure — the roll would be a lie about the character.
    wireCharacter(new CharacterVaultUnavailableError(CHARACTER_ID, 'mp-1', 'properties.json missing'));

    const result = await executeRunCustomTool({ tool: 'ansible' }, context);

    expect(result.success).toBe(false);
    expect(postPascalResultMock).not.toHaveBeenCalled();
    expect(postProsperoCustomToolErrorMock).toHaveBeenCalled();
    expect(postProsperoCustomToolErrorMock.mock.calls[0][0].reason).toMatch(/vault could not be read/);
  });
});
