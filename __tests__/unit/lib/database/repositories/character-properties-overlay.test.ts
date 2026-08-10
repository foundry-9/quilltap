/**
 * Unit tests for lib/database/repositories/character-properties-overlay.ts
 *
 * Strategy: Mock getRepositories, readDatabaseDocument, and the logger.
 * No real database. Tests cover per-file overlay behavior across all eight
 * vault targets (properties.json, description.md, personality.md,
 * example-dialogues.md, physical-description.md, physical-prompts.json,
 * Prompts/*.md, Scenarios/*.md), per-file fallback semantics, and batching.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

jest.mock('@/lib/repositories/factory');

jest.mock('@/lib/mount-index/database-store', () => ({
  readDatabaseDocument: jest.fn(),
  writeDatabaseDocument: jest.fn().mockResolvedValue(undefined),
  deleteDatabaseDocument: jest.fn().mockResolvedValue(undefined),
  DatabaseStoreError: class DatabaseStoreError extends Error {
    constructor(message: string, public code: string) {
      super(message);
    }
  },
}));

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue(undefined),
}));

import {
  applyDocumentStoreOverlay,
  applyDocumentStoreOverlayOne,
  readCharacterVaultProperties,
  readCharacterVaultDescription,
  readCharacterVaultPersonality,
  readCharacterVaultExampleDialogues,
  readCharacterVaultPhysicalDescription,
  readCharacterVaultPhysicalPrompts,
  readCharacterVaultSystemPrompts,
  readCharacterVaultScenarios,
  writeCharacterVaultManagedFields,
  projectVaultWardrobe,
  readCharacterVaultWardrobe,
  readCharacterVaultMetadata,
  applyDocumentStoreWriteOverlay,
  CharacterVaultPropertiesSchema,
  CharacterVaultPhysicalPromptsSchema,
  CharacterVaultUnavailableError,
  CHARACTER_PROPERTIES_JSON_PATH,
  CHARACTER_METADATA_JSON_PATH,
  CHARACTER_DESCRIPTION_MD_PATH,
  CHARACTER_PERSONALITY_MD_PATH,
  CHARACTER_EXAMPLE_DIALOGUES_MD_PATH,
  CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH,
  CHARACTER_PHYSICAL_PROMPTS_JSON_PATH,
  CHARACTER_PROMPTS_FOLDER,
  CHARACTER_SCENARIOS_FOLDER,
} from '@/lib/database/repositories/character-properties-overlay';
import type { Character, PhysicalDescription } from '@/lib/schemas/types';
import {
  readDatabaseDocument,
  writeDatabaseDocument,
  deleteDatabaseDocument,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const readDatabaseDocumentMock = readDatabaseDocument as jest.MockedFunction<typeof readDatabaseDocument>;
const writeDatabaseDocumentMock = writeDatabaseDocument as jest.MockedFunction<typeof writeDatabaseDocument>;
const deleteDatabaseDocumentMock = deleteDatabaseDocument as jest.MockedFunction<typeof deleteDatabaseDocument>;

function makeCharacter(overrides: Partial<Character>): Character {
  return {
    id: 'char-default',
    userId: 'user-1',
    name: 'Default',
    title: 'db-title',
    description: 'db-description',
    personality: 'db-personality',
    exampleDialogues: 'db-dialogues',
    firstMessage: 'db-first',
    talkativeness: 0.5,
    aliases: ['db-alias'],
    pronouns: { subject: 'she', object: 'her', possessive: 'her' },
    controlledBy: 'llm',
    npc: false,
    isFavorite: false,
    scenarios: [],
    systemPrompts: [],
    partnerLinks: [],
    tags: [],
    avatarOverrides: [],
    physicalDescription: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Character;
}

function makePhysicalDescription(
  overrides: Partial<PhysicalDescription> = {},
): PhysicalDescription {
  return {
    id: 'pd-default',
    name: 'default',
    usageContext: null,
    shortPrompt: 'db-short',
    mediumPrompt: 'db-medium',
    longPrompt: 'db-long',
    completePrompt: 'db-complete',
    fullDescription: 'db-full',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const VALID_VAULT_PROPS = {
  pronouns: { subject: 'they', object: 'them', possessive: 'their' },
  aliases: ['vault-alias'],
  title: 'vault-title',
  firstMessage: 'vault-first',
  talkativeness: 0.8,
  canChooseOutfit: false,
};

const VALID_VAULT_PHYSICAL_PROMPTS = {
  short: 'vault-short',
  medium: 'vault-medium',
  long: 'vault-long',
  complete: 'vault-complete',
};

type SingleFileDoc = { mountPointId: string; content: string };
type FolderDoc = {
  mountPointId: string;
  relativePath: string;
  fileName: string;
  content: string;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * Mock repos with per-path documents plus per-folder documents. `docsByPath`
 * maps a single-file vault path (e.g. 'properties.json') to the docs that
 * findManyByMountPointsAndPath should return. `docsByFolder` maps a folder
 * name (e.g. 'Prompts') to the docs that findManyByMountPointsInFolder
 * should return. Unset keys resolve to [].
 */
function mockRepoPaths(
  docsByPath: Record<string, SingleFileDoc[]> = {},
  docsByFolder: Record<string, FolderDoc[]> = {},
) {
  const findManyByMountPointsAndPath = jest
    .fn()
    .mockImplementation((ids: string[], path: string) => {
      // A provisioned vault ALWAYS carries properties.json — it is the keystone
      // the read overlay checks before hydrating (its absence throws/drops).
      // So unless a test explicitly sets properties.json (to exercise the
      // missing/malformed cases), auto-supply a valid one for every requested
      // mount, mirroring reality and keeping the per-file overlay tests focused
      // on the file they actually exercise.
      if (path === CHARACTER_PROPERTIES_JSON_PATH && !(path in docsByPath)) {
        return Promise.resolve(
          ids.map((id) => ({ mountPointId: id, content: JSON.stringify(VALID_VAULT_PROPS) })),
        );
      }
      return Promise.resolve(docsByPath[path] ?? []);
    });
  const findManyByMountPointsInFolder = jest
    .fn()
    .mockImplementation((_ids: string[], folder: string) =>
      Promise.resolve(
        (docsByFolder[folder] ?? []).map((d) => ({
          id: 'doc-' + d.relativePath,
          fileType: 'markdown' as const,
          contentSha256: 'x'.repeat(64),
          plainTextLength: d.content.length,
          folderId: null,
          lastModified: 0,
          createdAt: d.createdAt ?? '2026-01-01T00:00:00.000Z',
          updatedAt: d.updatedAt ?? '2026-01-01T00:00:00.000Z',
          ...d,
        })),
      ),
    );
  getRepositoriesMock.mockReturnValue({
    docMountDocuments: {
      findManyByMountPointsAndPath,
      findManyByMountPointsInFolder,
    },
  });
  return { findManyByMountPointsAndPath, findManyByMountPointsInFolder };
}

describe('applyDocumentStoreOverlay — basic candidate filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the input unchanged when the list is empty', async () => {
    const result = await applyDocumentStoreOverlay([]);
    expect(result).toEqual([]);
    expect(getRepositoriesMock).not.toHaveBeenCalled();
  });

  // The per-character `readPropertiesFromDocumentStore` opt-in flag was
  // removed in the 4.6 vault cutover — the overlay now applies unconditionally
  // whenever the character has a linked vault. Only the
  // `characterDocumentMountPointId` predicate gates the overlay.

  it('passes through characters with no linked vault', async () => {
    const chars = [
      makeCharacter({ id: 'a', characterDocumentMountPointId: null }),
      makeCharacter({ id: 'b' }),
    ];
    const result = await applyDocumentStoreOverlay(chars);
    expect(result).toEqual(chars);
    expect(getRepositoriesMock).not.toHaveBeenCalled();
  });
});

describe('applyDocumentStoreOverlay — properties.json overlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('overrides the five properties.json fields when valid', async () => {
    mockRepoPaths({
      [CHARACTER_PROPERTIES_JSON_PATH]: [
        { mountPointId: 'mp-1', content: JSON.stringify(VALID_VAULT_PROPS) },
      ],
    });

    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
    });

    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.pronouns).toEqual(VALID_VAULT_PROPS.pronouns);
    expect(result.aliases).toEqual(VALID_VAULT_PROPS.aliases);
    expect(result.title).toBe(VALID_VAULT_PROPS.title);
    expect(result.firstMessage).toBe(VALID_VAULT_PROPS.firstMessage);
    expect(result.talkativeness).toBe(VALID_VAULT_PROPS.talkativeness);
  });

  it('preserves null pronouns in properties.json (null means null)', async () => {
    mockRepoPaths({
      [CHARACTER_PROPERTIES_JSON_PATH]: [
        {
          mountPointId: 'mp-1',
          content: JSON.stringify({ ...VALID_VAULT_PROPS, pronouns: null }),
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.pronouns).toBeNull();
  });

  it('drops the character (batched) when properties.json is missing — no DB fallback', async () => {
    // Explicitly no properties.json for mp-1 (overrides the helper's keystone
    // default). Post-cutover there is no DB to fall back to, so the overlay must
    // fail loudly: the batched path drops the row rather than return it hollow.
    mockRepoPaths({ [CHARACTER_PROPERTIES_JSON_PATH]: [] });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      title: 'db-title',
    });
    const result = await applyDocumentStoreOverlay([char]);
    expect(result).toEqual([]);
  });

  it('throws CharacterVaultUnavailableError (single) when properties.json is missing', async () => {
    mockRepoPaths({ [CHARACTER_PROPERTIES_JSON_PATH]: [] });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      title: 'db-title',
    });
    await expect(applyDocumentStoreOverlayOne(char)).rejects.toBeInstanceOf(
      CharacterVaultUnavailableError,
    );
  });

  it('falls back to DB for all five fields when properties.json is malformed', async () => {
    mockRepoPaths({
      [CHARACTER_PROPERTIES_JSON_PATH]: [
        { mountPointId: 'mp-1', content: '{ not valid json' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      title: 'db-title',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.title).toBe('db-title');
  });

  it('falls back to DB for all five fields on schema validation failure', async () => {
    mockRepoPaths({
      [CHARACTER_PROPERTIES_JSON_PATH]: [
        {
          mountPointId: 'mp-1',
          content: JSON.stringify({ ...VALID_VAULT_PROPS, talkativeness: 2.0 }),
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      title: 'db-title',
      talkativeness: 0.5,
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.title).toBe('db-title');
    expect(result.talkativeness).toBe(0.5);
  });
});

describe('applyDocumentStoreOverlay — metadata.json overlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const SHEET = {
    hasAnsibleAccess: true,
    clearanceLevel: 3,
    faction: 'Ordo Aurum',
    knownLanguages: ['Trade Cant', 'High Gothic'],
    dossier: { rank: 'adept' },
    lastSeen: null,
  };

  async function hydrate(metadataContent?: string) {
    mockRepoPaths(
      metadataContent === undefined
        ? {}
        : { [CHARACTER_METADATA_JSON_PATH]: [{ mountPointId: 'mp-1', content: metadataContent }] },
    );
    const [result] = await applyDocumentStoreOverlay([
      makeCharacter({ id: 'a', characterDocumentMountPointId: 'mp-1' }),
    ]);
    return result;
  }

  it('hydrates the sheet, preserving every JSON value type', async () => {
    const result = await hydrate(JSON.stringify(SHEET));
    expect(result.metadata).toEqual(SHEET);
  });

  /**
   * metadata.json is emphatically NOT a second keystone. Only properties.json
   * gets to declare a vault broken; every case below is either a vault that
   * predates the feature or a fat-fingered edit, and hollowing the character
   * over either would be wildly out of proportion.
   */
  it('hydrates {} when the file is absent, rather than throwing', async () => {
    // The normal state for every vault provisioned before this feature existed.
    const result = await hydrate();
    expect(result.metadata).toEqual({});
    // And the rest of the character still hydrates.
    expect(result.title).toBe('vault-title');
  });

  it.each([
    ['the JSON is invalid', '{ "faction": '],
    ['the top level is an array', '["Ordo Aurum"]'],
    ['the top level is a bare string', '"Ordo Aurum"'],
    ['the top level is null', 'null'],
    ['the file is empty', ''],
  ])('hydrates {} when %s', async (_label, content) => {
    const result = await hydrate(content);
    expect(result.metadata).toEqual({});
  });

  it('does not hollow the character over an unparseable sheet', async () => {
    mockRepoPaths({
      [CHARACTER_METADATA_JSON_PATH]: [{ mountPointId: 'mp-1', content: '{ broken' }],
      [CHARACTER_DESCRIPTION_MD_PATH]: [{ mountPointId: 'mp-1', content: 'vault-description' }],
    });
    const [result] = await applyDocumentStoreOverlay([
      makeCharacter({ id: 'a', characterDocumentMountPointId: 'mp-1' }),
    ]);
    expect(result.metadata).toEqual({});
    expect(result.description).toBe('vault-description');
    expect(result.title).toBe('vault-title');
  });

  it('hydrates the sheet through the single-character path too', async () => {
    mockRepoPaths({
      [CHARACTER_METADATA_JSON_PATH]: [{ mountPointId: 'mp-1', content: JSON.stringify(SHEET) }],
    });
    const result = await applyDocumentStoreOverlayOne(
      makeCharacter({ id: 'a', characterDocumentMountPointId: 'mp-1' }),
    );
    expect(result!.metadata).toEqual(SHEET);
  });

  it('leaves a character with no linked vault entirely alone', async () => {
    const char = makeCharacter({ id: 'a', characterDocumentMountPointId: null });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.metadata).toBeUndefined();
  });
});

describe('readCharacterVaultMetadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the parsed sheet', async () => {
    readDatabaseDocumentMock.mockResolvedValue({ content: '{"faction":"Ordo Aurum"}' } as any);
    expect(await readCharacterVaultMetadata('mp-1', 'char-1')).toEqual({ faction: 'Ordo Aurum' });
  });

  it('returns null when the file is missing', async () => {
    readDatabaseDocumentMock.mockRejectedValue(new DatabaseStoreError('nope', 'NOT_FOUND'));
    expect(await readCharacterVaultMetadata('mp-1', 'char-1')).toBeNull();
  });

  it('returns null when the file is not a JSON object', async () => {
    readDatabaseDocumentMock.mockResolvedValue({ content: '["nope"]' } as any);
    expect(await readCharacterVaultMetadata('mp-1', 'char-1')).toBeNull();
  });
});

describe('applyDocumentStoreOverlay — description.md and personality.md overlays', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('overrides description.md content', async () => {
    mockRepoPaths({
      [CHARACTER_DESCRIPTION_MD_PATH]: [
        { mountPointId: 'mp-1', content: 'vault-description' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      description: 'db-description',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.description).toBe('vault-description');
  });

  it('maps empty description.md to null (clearing the field)', async () => {
    mockRepoPaths({
      [CHARACTER_DESCRIPTION_MD_PATH]: [{ mountPointId: 'mp-1', content: '' }],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      description: 'db-description',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.description).toBeNull();
  });

  it('overrides personality.md content', async () => {
    mockRepoPaths({
      [CHARACTER_PERSONALITY_MD_PATH]: [
        { mountPointId: 'mp-1', content: 'vault-personality' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      personality: 'db-personality',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.personality).toBe('vault-personality');
  });

  it('does not touch description or personality when those files are missing', async () => {
    mockRepoPaths({});
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      description: 'db-description',
      personality: 'db-personality',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.description).toBe('db-description');
    expect(result.personality).toBe('db-personality');
  });
});

describe('applyDocumentStoreOverlay — example-dialogues.md overlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('overrides example-dialogues.md content', async () => {
    mockRepoPaths({
      [CHARACTER_EXAMPLE_DIALOGUES_MD_PATH]: [
        { mountPointId: 'mp-1', content: 'vault-dialogues' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      exampleDialogues: 'db-dialogues',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.exampleDialogues).toBe('vault-dialogues');
  });

  it('maps an empty example-dialogues.md to null (the valid "no examples" state)', async () => {
    mockRepoPaths({
      [CHARACTER_EXAMPLE_DIALOGUES_MD_PATH]: [
        { mountPointId: 'mp-1', content: '' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      exampleDialogues: 'db-dialogues',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.exampleDialogues).toBeNull();
  });

  it('falls back to DB when example-dialogues.md is missing', async () => {
    mockRepoPaths({});
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      exampleDialogues: 'db-dialogues',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.exampleDialogues).toBe('db-dialogues');
  });
});

describe('applyDocumentStoreOverlay — physical-description.md / physical-prompts.json', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // physicalDescriptions[] collapsed to physicalDescription (singular) in the
  // 4.6 vault cutover. The vault remains authoritative: when any physical-*
  // vault file exists, the overlay populates `physicalDescription`, synthesizing
  // a record if the DB had none.

  it('overrides physicalDescription.fullDescription from physical-description.md', async () => {
    mockRepoPaths({
      [CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH]: [
        { mountPointId: 'mp-1', content: 'vault-full-description' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      physicalDescription: makePhysicalDescription({ id: 'pd-1', fullDescription: 'db-full' }),
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.physicalDescription!.fullDescription).toBe('vault-full-description');
    expect(result.physicalDescription!.id).toBe('pd-1');
  });

  it('overrides the four prompt tiers from physical-prompts.json', async () => {
    mockRepoPaths({
      [CHARACTER_PHYSICAL_PROMPTS_JSON_PATH]: [
        { mountPointId: 'mp-1', content: JSON.stringify(VALID_VAULT_PHYSICAL_PROMPTS) },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      physicalDescription: makePhysicalDescription({ id: 'pd-1' }),
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.physicalDescription!.shortPrompt).toBe('vault-short');
    expect(result.physicalDescription!.mediumPrompt).toBe('vault-medium');
    expect(result.physicalDescription!.longPrompt).toBe('vault-long');
    expect(result.physicalDescription!.completePrompt).toBe('vault-complete');
  });

  it('hydrates headAndShouldersPrompt from physical-prompts.json', async () => {
    mockRepoPaths({
      [CHARACTER_PHYSICAL_PROMPTS_JSON_PATH]: [
        {
          mountPointId: 'mp-1',
          content: JSON.stringify({ ...VALID_VAULT_PHYSICAL_PROMPTS, headAndShoulders: 'vault-headshoulders' }),
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      physicalDescription: makePhysicalDescription({ id: 'pd-1' }),
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.physicalDescription!.headAndShouldersPrompt).toBe('vault-headshoulders');
  });

  it('back-compat: a legacy physical-prompts.json without headAndShoulders still parses (field null, other tiers survive)', async () => {
    mockRepoPaths({
      [CHARACTER_PHYSICAL_PROMPTS_JSON_PATH]: [
        // VALID_VAULT_PHYSICAL_PROMPTS has no headAndShoulders key — the shape
        // written before the field existed. The `.optional()` on the vault
        // schema is what keeps this parsing instead of wiping all tiers.
        { mountPointId: 'mp-1', content: JSON.stringify(VALID_VAULT_PHYSICAL_PROMPTS) },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      physicalDescription: makePhysicalDescription({ id: 'pd-1' }),
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.physicalDescription!.headAndShouldersPrompt).toBeNull();
    expect(result.physicalDescription!.shortPrompt).toBe('vault-short');
    expect(result.physicalDescription!.completePrompt).toBe('vault-complete');
  });

  it('accepts null prompt values from physical-prompts.json (null means null)', async () => {
    mockRepoPaths({
      [CHARACTER_PHYSICAL_PROMPTS_JSON_PATH]: [
        {
          mountPointId: 'mp-1',
          content: JSON.stringify({ short: null, medium: null, long: null, complete: null }),
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      physicalDescription: makePhysicalDescription({ id: 'pd-1' }),
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.physicalDescription!.shortPrompt).toBeNull();
    expect(result.physicalDescription!.completePrompt).toBeNull();
  });

  it('leaves prompts from DB when physical-prompts.json is malformed JSON', async () => {
    mockRepoPaths({
      [CHARACTER_PHYSICAL_PROMPTS_JSON_PATH]: [
        { mountPointId: 'mp-1', content: '{ not json' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      physicalDescription: makePhysicalDescription({ id: 'pd-1', shortPrompt: 'db-short' }),
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.physicalDescription!.shortPrompt).toBe('db-short');
  });

  it('leaves prompts from DB when physical-prompts.json fails schema validation', async () => {
    mockRepoPaths({
      [CHARACTER_PHYSICAL_PROMPTS_JSON_PATH]: [
        { mountPointId: 'mp-1', content: JSON.stringify({ short: 42 }) },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      physicalDescription: makePhysicalDescription({ id: 'pd-1', shortPrompt: 'db-short' }),
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.physicalDescription!.shortPrompt).toBe('db-short');
  });

  // The old "preserves subsequent physical descriptions" test asserted that
  // only index 0 of an array was patched. After the singular collapse the
  // array no longer exists, so the test was removed.

  it('synthesizes a physicalDescription when vault files exist but the DB had none', async () => {
    // Post-cutover the vault is authoritative: a present vault file creates
    // a synthetic record even when the character.physicalDescription is null.
    mockRepoPaths({
      [CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH]: [
        { mountPointId: 'mp-1', content: 'vault-full' },
      ],
      [CHARACTER_PHYSICAL_PROMPTS_JSON_PATH]: [
        { mountPointId: 'mp-1', content: JSON.stringify(VALID_VAULT_PHYSICAL_PROMPTS) },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      physicalDescription: null,
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.physicalDescription).not.toBeNull();
    expect(result.physicalDescription!.fullDescription).toBe('vault-full');
    expect(result.physicalDescription!.shortPrompt).toBe('vault-short');
  });
});

describe('applyDocumentStoreOverlay — Prompts/*.md overlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const promptFileContent = (name: string, body: string, isDefault = false) =>
    `---\nname: ${name}\n${isDefault ? 'isDefault: true\n' : ''}---\n\n${body}`;

  it('synthesizes systemPrompts from vault files with YAML frontmatter', async () => {
    mockRepoPaths({}, {
      [CHARACTER_PROMPTS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Alpha.md',
          fileName: 'Alpha.md',
          content: promptFileContent('Alpha', 'Alpha body prose.', true),
        },
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Beta.md',
          fileName: 'Beta.md',
          content: promptFileContent('Beta', 'Beta body prose.'),
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      systemPrompts: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'db-prompt',
          content: 'db content',
          isDefault: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.systemPrompts).toHaveLength(2);
    expect(result.systemPrompts.map(p => p.name)).toEqual(['Alpha', 'Beta']);
    expect(result.systemPrompts[0].content).toBe('Alpha body prose.');
    expect(result.systemPrompts[0].isDefault).toBe(true);
    expect(result.systemPrompts[1].isDefault).toBe(false);
  });

  it('promotes first alphabetically when no file is marked isDefault', async () => {
    mockRepoPaths({}, {
      [CHARACTER_PROMPTS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Beta.md',
          fileName: 'Beta.md',
          content: promptFileContent('Beta', 'Beta body.'),
        },
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Alpha.md',
          fileName: 'Alpha.md',
          content: promptFileContent('Alpha', 'Alpha body.'),
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    // Alphabetic sort puts Alpha first; Alpha is promoted to default
    expect(result.systemPrompts[0].name).toBe('Alpha');
    expect(result.systemPrompts[0].isDefault).toBe(true);
    expect(result.systemPrompts[1].isDefault).toBe(false);
  });

  it('keeps only the first isDefault when multiple are marked', async () => {
    mockRepoPaths({}, {
      [CHARACTER_PROMPTS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Alpha.md',
          fileName: 'Alpha.md',
          content: promptFileContent('Alpha', 'Alpha body.', true),
        },
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Beta.md',
          fileName: 'Beta.md',
          content: promptFileContent('Beta', 'Beta body.', true),
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.systemPrompts[0].isDefault).toBe(true);
    expect(result.systemPrompts[1].isDefault).toBe(false);
  });

  it('skips files without YAML frontmatter, keeps others', async () => {
    mockRepoPaths({}, {
      [CHARACTER_PROMPTS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/NoFrontmatter.md',
          fileName: 'NoFrontmatter.md',
          content: 'Just body, no frontmatter at all.',
        },
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Good.md',
          fileName: 'Good.md',
          content: promptFileContent('Good', 'Good body.', true),
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.systemPrompts).toHaveLength(1);
    expect(result.systemPrompts[0].name).toBe('Good');
  });

  it('skips files whose frontmatter lacks a name', async () => {
    mockRepoPaths({}, {
      [CHARACTER_PROMPTS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/NoName.md',
          fileName: 'NoName.md',
          content: `---\nisDefault: true\n---\n\nBody text here.`,
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      systemPrompts: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          name: 'db-prompt',
          content: 'db body',
          isDefault: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    // All vault files invalid; vault is authoritative, so the result is empty
    // — the DB row is a ghost and must not leak through.
    expect(result.systemPrompts).toEqual([]);
  });

  it('returns an empty array when Prompts/ is empty (vault authoritative — DB rows are ghosts)', async () => {
    mockRepoPaths({}, {});
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      systemPrompts: [
        {
          id: '00000000-0000-4000-8000-000000000003',
          name: 'db-only',
          content: 'db body',
          isDefault: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.systemPrompts).toEqual([]);
  });

  it('returns an empty array when every Prompts/ file fails to parse', async () => {
    mockRepoPaths({}, {
      [CHARACTER_PROMPTS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Bad.md',
          fileName: 'Bad.md',
          content: 'no frontmatter at all',
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      systemPrompts: [
        {
          id: '00000000-0000-4000-8000-000000000005',
          name: 'db-ghost',
          content: 'db body',
          isDefault: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.systemPrompts).toEqual([]);
  });

  it('synthesizes stable IDs across repeated reads', async () => {
    mockRepoPaths({}, {
      [CHARACTER_PROMPTS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Stable.md',
          fileName: 'Stable.md',
          content: promptFileContent('Stable', 'body', true),
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
    });
    const [first] = await applyDocumentStoreOverlay([char]);
    const [second] = await applyDocumentStoreOverlay([char]);
    expect(first.systemPrompts[0].id).toBe(second.systemPrompts[0].id);
    // Valid UUID format
    expect(first.systemPrompts[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('applyDocumentStoreOverlay — Scenarios/*.md overlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('synthesizes scenarios from vault files using # heading as title', async () => {
    mockRepoPaths({}, {
      [CHARACTER_SCENARIOS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Scenarios/Morning.md',
          fileName: 'Morning.md',
          content: '# Good Morning\n\nBody of the morning scenario.',
        },
        {
          mountPointId: 'mp-1',
          relativePath: 'Scenarios/Evening.md',
          fileName: 'Evening.md',
          content: '# Evening\n\nEvening scenario body.',
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    // Alphabetic sort by relativePath: Evening before Morning
    expect(result.scenarios).toHaveLength(2);
    expect(result.scenarios[0].title).toBe('Evening');
    expect(result.scenarios[0].content).toBe('Evening scenario body.');
    expect(result.scenarios[1].title).toBe('Good Morning');
  });

  it('falls back to filename when the file has no # heading', async () => {
    mockRepoPaths({}, {
      [CHARACTER_SCENARIOS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Scenarios/MissingHeading.md',
          fileName: 'MissingHeading.md',
          content: 'Body text without a heading line.',
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].title).toBe('MissingHeading');
    expect(result.scenarios[0].content).toBe('Body text without a heading line.');
  });

  it('returns an empty array when Scenarios/ is empty (vault authoritative — DB rows are ghosts)', async () => {
    mockRepoPaths({}, {});
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      scenarios: [
        {
          id: '00000000-0000-4000-8000-000000000004',
          title: 'db-scenario',
          content: 'db body',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.scenarios).toEqual([]);
  });

  it('skips files with no body content', async () => {
    mockRepoPaths({}, {
      [CHARACTER_SCENARIOS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Scenarios/Empty.md',
          fileName: 'Empty.md',
          content: '# Empty\n\n',
        },
        {
          mountPointId: 'mp-1',
          relativePath: 'Scenarios/Full.md',
          fileName: 'Full.md',
          content: '# Full\n\nHas body.',
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].title).toBe('Full');
  });

  it('synthesizes stable IDs across repeated reads', async () => {
    mockRepoPaths({}, {
      [CHARACTER_SCENARIOS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Scenarios/One.md',
          fileName: 'One.md',
          content: '# One\n\nBody.',
        },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
    });
    const [first] = await applyDocumentStoreOverlay([char]);
    const [second] = await applyDocumentStoreOverlay([char]);
    expect(first.scenarios[0].id).toBe(second.scenarios[0].id);
  });
});

describe('applyDocumentStoreOverlay — per-file independence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('applies description.md overlay independently of the other vault files', async () => {
    // Keystone properties.json is auto-supplied by mockRepoPaths; only
    // description.md is set here, proving per-file independence.
    mockRepoPaths({
      [CHARACTER_DESCRIPTION_MD_PATH]: [
        { mountPointId: 'mp-1', content: 'vault-description' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      description: 'db-description',
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.description).toBe('vault-description');
  });

  it('applies physical-description.md overlay even when physical-prompts.json is invalid', async () => {
    mockRepoPaths({
      [CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH]: [
        { mountPointId: 'mp-1', content: 'vault-full' },
      ],
      [CHARACTER_PHYSICAL_PROMPTS_JSON_PATH]: [
        { mountPointId: 'mp-1', content: '{ broken' },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      physicalDescription: makePhysicalDescription({
        id: 'pd-1',
        fullDescription: 'db-full',
        shortPrompt: 'db-short',
      }),
    });
    const [result] = await applyDocumentStoreOverlay([char]);
    expect(result.physicalDescription!.fullDescription).toBe('vault-full');
    expect(result.physicalDescription!.shortPrompt).toBe('db-short'); // not overridden
  });
});

describe('applyDocumentStoreOverlay — batching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('issues one query per single-file path and one per folder, regardless of candidate count', async () => {
    const { findManyByMountPointsAndPath, findManyByMountPointsInFolder } = mockRepoPaths({
      [CHARACTER_PROPERTIES_JSON_PATH]: [
        { mountPointId: 'mp-1', content: JSON.stringify({ ...VALID_VAULT_PROPS, title: 'vault-a' }) },
        { mountPointId: 'mp-2', content: JSON.stringify({ ...VALID_VAULT_PROPS, title: 'vault-b' }) },
      ],
    });

    const chars = [
      makeCharacter({ id: 'a', characterDocumentMountPointId: 'mp-1' }),
      makeCharacter({ id: 'b', characterDocumentMountPointId: 'mp-2' }),
      // Character 'c' has no linked vault — overlay should skip it.
      makeCharacter({ id: 'c', characterDocumentMountPointId: null }),
    ];

    const result = await applyDocumentStoreOverlay(chars);
    // 9 single-file overlay paths: properties.json, metadata.json, identity.md,
    // description.md, manifesto.md, personality.md, example-dialogues.md,
    // physical-description.md, physical-prompts.json
    expect(findManyByMountPointsAndPath).toHaveBeenCalledTimes(9);
    // 2 directory overlays: Prompts, Scenarios
    expect(findManyByMountPointsInFolder).toHaveBeenCalledTimes(2);
    expect(result[0].title).toBe('vault-a');
    expect(result[1].title).toBe('vault-b');
    expect(result[2].title).toBe('db-title');
  });

  it('deduplicates mount point ids in each query', async () => {
    const { findManyByMountPointsAndPath } = mockRepoPaths({
      [CHARACTER_PROPERTIES_JSON_PATH]: [
        { mountPointId: 'mp-shared', content: JSON.stringify(VALID_VAULT_PROPS) },
      ],
    });
    const chars = [
      makeCharacter({ id: 'a', characterDocumentMountPointId: 'mp-shared' }),
      makeCharacter({ id: 'b', characterDocumentMountPointId: 'mp-shared' }),
    ];
    await applyDocumentStoreOverlay(chars);
    const propsCall = findManyByMountPointsAndPath.mock.calls.find(
      ([, path]) => path === CHARACTER_PROPERTIES_JSON_PATH,
    );
    expect(propsCall).toBeDefined();
    expect(propsCall![0]).toEqual(['mp-shared']);
  });

  it('drops only the broken character — one bad vault cannot take down the roster', async () => {
    // mp-good has a properties.json keystone; mp-bad explicitly has none.
    mockRepoPaths({
      [CHARACTER_PROPERTIES_JSON_PATH]: [
        { mountPointId: 'mp-good', content: JSON.stringify({ ...VALID_VAULT_PROPS, title: 'vault-good' }) },
      ],
    });
    const chars = [
      makeCharacter({ id: 'good', characterDocumentMountPointId: 'mp-good' }),
      makeCharacter({ id: 'bad', characterDocumentMountPointId: 'mp-bad' }),
      makeCharacter({ id: 'no-vault', characterDocumentMountPointId: null, title: 'db-title' }),
    ];
    const result = await applyDocumentStoreOverlay(chars);
    // Broken 'bad' dropped; healthy 'good' hydrated; vault-less 'no-vault' passes through.
    expect(result.map((c) => c.id)).toEqual(['good', 'no-vault']);
    expect(result[0].title).toBe('vault-good');
    expect(result[1].title).toBe('db-title');
  });

  it('propagates a store-read failure instead of silently returning hollow characters', async () => {
    // Post-cutover there is no DB fallback, so a failed vault read must not be
    // swallowed — it propagates so the caller fails loudly (mapped to 503).
    const findManyByMountPointsAndPath = jest.fn().mockRejectedValue(new Error('db exploded'));
    const findManyByMountPointsInFolder = jest.fn().mockResolvedValue([]);
    getRepositoriesMock.mockReturnValue({
      docMountDocuments: { findManyByMountPointsAndPath, findManyByMountPointsInFolder },
    });
    const chars = [
      makeCharacter({
        id: 'a',
        characterDocumentMountPointId: 'mp-1',
        title: 'db-title',
      }),
    ];
    await expect(applyDocumentStoreOverlay(chars)).rejects.toThrow('db exploded');
  });
});

describe('applyDocumentStoreOverlayOne', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when the input is null', async () => {
    const result = await applyDocumentStoreOverlayOne(null);
    expect(result).toBeNull();
  });

  it('returns the overlaid character', async () => {
    mockRepoPaths({
      [CHARACTER_PROPERTIES_JSON_PATH]: [
        { mountPointId: 'mp-1', content: JSON.stringify(VALID_VAULT_PROPS) },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
    });
    const result = await applyDocumentStoreOverlayOne(char);
    expect(result?.title).toBe(VALID_VAULT_PROPS.title);
  });

  it('overlays archived characters from their kept vault (§4.2a — no hollow tombstones)', async () => {
    // Archiving prunes the vault but keeps every managed-field document, so an
    // archived character must hydrate exactly like a live one. The old
    // archived short-circuit here would hand back a hollow row — the very
    // outcome prune-in-place exists to avoid.
    mockRepoPaths({
      [CHARACTER_PROPERTIES_JSON_PATH]: [
        { mountPointId: 'mp-1', content: JSON.stringify(VALID_VAULT_PROPS) },
      ],
    });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      archivedAt: '2026-08-10T00:00:00.000Z',
    });
    const result = await applyDocumentStoreOverlayOne(char);
    expect(result?.title).toBe(VALID_VAULT_PROPS.title);
    expect(result?.archivedAt).toBe('2026-08-10T00:00:00.000Z');
  });

  it('still throws for an archived character whose vault is genuinely broken', async () => {
    // A broken archived vault is a real fault and surfaces as one — it is not
    // silently hollowed the way the old short-circuit did.
    mockRepoPaths({ [CHARACTER_PROPERTIES_JSON_PATH]: [] });
    const char = makeCharacter({
      id: 'a',
      characterDocumentMountPointId: 'mp-1',
      archivedAt: '2026-08-10T00:00:00.000Z',
    });
    await expect(applyDocumentStoreOverlayOne(char)).rejects.toThrow(
      CharacterVaultUnavailableError,
    );
  });
});

describe('readCharacterVaultProperties', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the parsed properties on a clean read', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: JSON.stringify(VALID_VAULT_PROPS),
      mtime: 0,
      size: 100,
    });
    const result = await readCharacterVaultProperties('mp-1', 'char-a');
    expect(result).toEqual(VALID_VAULT_PROPS);
  });

  it('returns null when the document is not found', async () => {
    readDatabaseDocumentMock.mockRejectedValue(
      new (DatabaseStoreError as any)('not found', 'NOT_FOUND'),
    );
    const result = await readCharacterVaultProperties('mp-1', 'char-a');
    expect(result).toBeNull();
  });

  it('returns null on malformed JSON', async () => {
    readDatabaseDocumentMock.mockResolvedValue({ content: 'not json', mtime: 0, size: 10 });
    const result = await readCharacterVaultProperties('mp-1', 'char-a');
    expect(result).toBeNull();
  });

  it('returns null on schema validation failure', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: JSON.stringify({ ...VALID_VAULT_PROPS, talkativeness: 5 }),
      mtime: 0,
      size: 100,
    });
    const result = await readCharacterVaultProperties('mp-1', 'char-a');
    expect(result).toBeNull();
  });

  it('returns null on generic read errors', async () => {
    readDatabaseDocumentMock.mockRejectedValue(new Error('io error'));
    const result = await readCharacterVaultProperties('mp-1', 'char-a');
    expect(result).toBeNull();
  });
});

describe('readCharacterVaultDescription / readCharacterVaultPersonality / readCharacterVaultExampleDialogues / readCharacterVaultPhysicalDescription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns raw text when the file exists', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: 'hello from the vault',
      mtime: 0,
      size: 10,
    });
    const result = await readCharacterVaultDescription('mp-1', 'char-a');
    expect(result).toBe('hello from the vault');
  });

  it('returns the empty string when the file exists but is empty', async () => {
    readDatabaseDocumentMock.mockResolvedValue({ content: '', mtime: 0, size: 0 });
    const result = await readCharacterVaultPersonality('mp-1', 'char-a');
    expect(result).toBe('');
  });

  it('returns null when the file is not found', async () => {
    readDatabaseDocumentMock.mockRejectedValue(
      new (DatabaseStoreError as any)('not found', 'NOT_FOUND'),
    );
    const result = await readCharacterVaultPhysicalDescription('mp-1', 'char-a');
    expect(result).toBeNull();
  });

  it('returns null on generic read errors', async () => {
    readDatabaseDocumentMock.mockRejectedValue(new Error('io error'));
    const result = await readCharacterVaultDescription('mp-1', 'char-a');
    expect(result).toBeNull();
  });

  it('readCharacterVaultExampleDialogues returns raw text when the file exists', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: '{{user}}: Hi\n{{char}}: Hello.',
      mtime: 0,
      size: 20,
    });
    const result = await readCharacterVaultExampleDialogues('mp-1', 'char-a');
    expect(result).toBe('{{user}}: Hi\n{{char}}: Hello.');
  });
});

describe('readCharacterVaultPhysicalPrompts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the parsed prompts on a clean read', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: JSON.stringify(VALID_VAULT_PHYSICAL_PROMPTS),
      mtime: 0,
      size: 100,
    });
    const result = await readCharacterVaultPhysicalPrompts('mp-1', 'char-a');
    expect(result).toEqual(VALID_VAULT_PHYSICAL_PROMPTS);
  });

  it('accepts null fields', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: JSON.stringify({ short: null, medium: null, long: null, complete: null }),
      mtime: 0,
      size: 100,
    });
    const result = await readCharacterVaultPhysicalPrompts('mp-1', 'char-a');
    expect(result).toEqual({ short: null, medium: null, long: null, complete: null });
  });

  it('returns null on malformed JSON', async () => {
    readDatabaseDocumentMock.mockResolvedValue({ content: 'not json', mtime: 0, size: 10 });
    const result = await readCharacterVaultPhysicalPrompts('mp-1', 'char-a');
    expect(result).toBeNull();
  });

  it('returns null on schema validation failure', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: JSON.stringify({ short: 42 }),
      mtime: 0,
      size: 10,
    });
    const result = await readCharacterVaultPhysicalPrompts('mp-1', 'char-a');
    expect(result).toBeNull();
  });

  it('returns null when the file is not found', async () => {
    readDatabaseDocumentMock.mockRejectedValue(
      new (DatabaseStoreError as any)('not found', 'NOT_FOUND'),
    );
    const result = await readCharacterVaultPhysicalPrompts('mp-1', 'char-a');
    expect(result).toBeNull();
  });
});

describe('readCharacterVaultSystemPrompts / readCharacterVaultScenarios', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enumerates Prompts/*.md and returns parsed entries', async () => {
    mockRepoPaths({}, {
      [CHARACTER_PROMPTS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Prompts/Alpha.md',
          fileName: 'Alpha.md',
          content: `---\nname: Alpha\nisDefault: true\n---\n\nAlpha body.`,
        },
      ],
    });
    const result = await readCharacterVaultSystemPrompts('mp-1', 'char-a');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Alpha');
    expect(result[0].isDefault).toBe(true);
  });

  it('returns [] when the Prompts/ folder is empty', async () => {
    mockRepoPaths({}, {});
    const result = await readCharacterVaultSystemPrompts('mp-1', 'char-a');
    expect(result).toEqual([]);
  });

  it('enumerates Scenarios/*.md and returns parsed entries', async () => {
    mockRepoPaths({}, {
      [CHARACTER_SCENARIOS_FOLDER]: [
        {
          mountPointId: 'mp-1',
          relativePath: 'Scenarios/Wakeup.md',
          fileName: 'Wakeup.md',
          content: '# Wakeup\n\nBody.',
        },
      ],
    });
    const result = await readCharacterVaultScenarios('mp-1', 'char-a');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Wakeup');
  });

  it('returns [] when the Scenarios/ folder is empty', async () => {
    mockRepoPaths({}, {});
    const result = await readCharacterVaultScenarios('mp-1', 'char-a');
    expect(result).toEqual([]);
  });
});

describe('CharacterVaultPropertiesSchema', () => {
  it('rejects out-of-bounds talkativeness', () => {
    const parsed = CharacterVaultPropertiesSchema.safeParse({
      ...VALID_VAULT_PROPS,
      talkativeness: 0.05,
    });
    expect(parsed.success).toBe(false);
  });

  it('requires all five fields', () => {
    const parsed = CharacterVaultPropertiesSchema.safeParse({ title: 'x' });
    expect(parsed.success).toBe(false);
  });

  it('accepts null pronouns', () => {
    const parsed = CharacterVaultPropertiesSchema.safeParse({
      ...VALID_VAULT_PROPS,
      pronouns: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts null title and firstMessage (mirrors Character schema)', () => {
    const parsed = CharacterVaultPropertiesSchema.safeParse({
      ...VALID_VAULT_PROPS,
      title: null,
      firstMessage: null,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('CharacterVaultPhysicalPromptsSchema', () => {
  it('accepts all-string values', () => {
    const parsed = CharacterVaultPhysicalPromptsSchema.safeParse(VALID_VAULT_PHYSICAL_PROMPTS);
    expect(parsed.success).toBe(true);
  });

  it('accepts an optional headAndShoulders key', () => {
    const parsed = CharacterVaultPhysicalPromptsSchema.safeParse({
      ...VALID_VAULT_PHYSICAL_PROMPTS,
      headAndShoulders: 'hs',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a legacy object missing headAndShoulders (back-compat — the field is optional)', () => {
    // VALID_VAULT_PHYSICAL_PROMPTS carries no headAndShoulders key.
    const parsed = CharacterVaultPhysicalPromptsSchema.safeParse(VALID_VAULT_PHYSICAL_PROMPTS);
    expect(parsed.success).toBe(true);
  });

  it('accepts all-null values', () => {
    const parsed = CharacterVaultPhysicalPromptsSchema.safeParse({
      short: null,
      medium: null,
      long: null,
      complete: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('requires all four fields', () => {
    const parsed = CharacterVaultPhysicalPromptsSchema.safeParse({ short: 'x' });
    expect(parsed.success).toBe(false);
  });

  it('rejects non-string non-null values', () => {
    const parsed = CharacterVaultPhysicalPromptsSchema.safeParse({
      short: 42,
      medium: null,
      long: null,
      complete: null,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('applyDocumentStoreWriteOverlay — corrupt properties.json (Bug 8)', () => {
  // The six fields properties.json owns (pronouns, aliases, title, firstMessage,
  // talkativeness, canChooseOutfit) live ONLY in that file post-4.6. A
  // read-modify-write save that treated a present-but-corrupt file as absent
  // would seed empty defaults over it and clobber all six, permanently and
  // silently. The write path must refuse instead — matching the vault's
  // established "no silent hollow" failure semantics.
  const CHAR_ID = 'char-corrupt';
  const MOUNT_ID = 'mount-corrupt';

  function wireVaultCharacter() {
    getRepositoriesMock.mockReturnValue({
      characters: {
        findByIdRaw: jest.fn().mockResolvedValue({
          id: CHAR_ID,
          name: 'Tess',
          characterDocumentMountPointId: MOUNT_ID, // → hasLinkedVault() === true
        }),
      },
    });
  }

  function propsWrites() {
    return writeDatabaseDocumentMock.mock.calls.filter(
      ([, relPath]) => relPath === CHARACTER_PROPERTIES_JSON_PATH,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    wireVaultCharacter();
  });

  it('refuses the write when properties.json is truncated mid-token — throws, file untouched', async () => {
    // A real iCloud-conflict / interrupted-write artifact: a valid JSON prefix,
    // then nothing.
    readDatabaseDocumentMock.mockResolvedValue({
      content: '{ "pronouns": { "subject": "she", "objec',
      mtime: 0,
      size: 40,
    });

    await expect(
      applyDocumentStoreWriteOverlay(CHAR_ID, { title: 'A New Title' }),
    ).rejects.toBeInstanceOf(CharacterVaultUnavailableError);

    // The six-field file was NOT overwritten with seeded defaults.
    expect(propsWrites()).toHaveLength(0);
  });

  it('names the file and calls it unparseable in the error', async () => {
    readDatabaseDocumentMock.mockResolvedValue({ content: '{ broken', mtime: 0, size: 8 });
    await expect(
      applyDocumentStoreWriteOverlay(CHAR_ID, { title: 'X' }),
    ).rejects.toThrow(/properties\.json unparseable/);
  });

  it('refuses when the body fails schema validation (talkativeness out of range)', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: JSON.stringify({ ...VALID_VAULT_PROPS, talkativeness: 5 }),
      mtime: 0,
      size: 80,
    });
    await expect(
      applyDocumentStoreWriteOverlay(CHAR_ID, { title: 'X' }),
    ).rejects.toBeInstanceOf(CharacterVaultUnavailableError);
    expect(propsWrites()).toHaveLength(0);
  });

  it('still seeds defaults when the file is genuinely absent (NOT_FOUND)', async () => {
    readDatabaseDocumentMock.mockRejectedValue(
      new (DatabaseStoreError as any)('not found', 'NOT_FOUND'),
    );
    const dbPatch = await applyDocumentStoreWriteOverlay(CHAR_ID, { title: 'Seeded Title' });
    // The patch was routed to the vault and stripped from the DB-bound patch.
    expect('title' in dbPatch).toBe(false);
    const [call] = propsWrites();
    expect(call).toBeDefined();
    const written = JSON.parse(call![2] as string);
    expect(written.title).toBe('Seeded Title');
    // Unspecified fields fall to their fresh-vault defaults.
    expect(written.talkativeness).toBe(0.5);
    expect(written.canChooseOutfit).toBe(false);
  });

  it('merges the patch over a healthy present file, preserving untouched fields', async () => {
    readDatabaseDocumentMock.mockResolvedValue({
      content: JSON.stringify(VALID_VAULT_PROPS),
      mtime: 0,
      size: 120,
    });
    await applyDocumentStoreWriteOverlay(CHAR_ID, { title: 'Merged Title' });
    const [call] = propsWrites();
    const written = JSON.parse(call![2] as string);
    expect(written.title).toBe('Merged Title');
    // Everything else survives from the file, not reset to defaults.
    expect(written.aliases).toEqual(VALID_VAULT_PROPS.aliases);
    expect(written.firstMessage).toBe(VALID_VAULT_PROPS.firstMessage);
    expect(written.talkativeness).toBe(VALID_VAULT_PROPS.talkativeness);
  });
});

describe('writeCharacterVaultManagedFields — sync DB → vault', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepoPaths({}, {});
  });

  function getWrite(path: string): string | undefined {
    const call = writeDatabaseDocumentMock.mock.calls.find(
      ([, relPath]) => relPath === path,
    );
    return call ? (call[2] as string) : undefined;
  }

  it('writes every single-file vault target for a character with a primary physical description', async () => {
    const character = makeCharacter({
      id: 'char-sync',
      pronouns: { subject: 'they', object: 'them', possessive: 'their' },
      aliases: ['Nick', 'Nicky'],
      title: 'Detective',
      firstMessage: 'Hello there.',
      talkativeness: 0.7,
      metadata: { faction: 'Ordo Aurum' },
      description: 'DB desc',
      personality: 'DB personality',
      exampleDialogues: 'DB dialogues',
      physicalDescription: {
        id: 'phys-1',
        name: 'primary',
        fullDescription: 'primary full',
        shortPrompt: 'short',
        mediumPrompt: 'medium',
        longPrompt: 'long',
        completePrompt: 'complete',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      systemPrompts: [],
      scenarios: [],
    });

    const result = await writeCharacterVaultManagedFields('mount-1', {
      character,
    });

    expect(result.physicalSkippedNoPrimary).toBe(false);
    // properties.json, metadata.json, the five markdown files, and the
    // physical-* pair.
    expect(result.singleFileWriteCount).toBe(9);
    expect(JSON.parse(getWrite(CHARACTER_METADATA_JSON_PATH)!)).toEqual({ faction: 'Ordo Aurum' });

    const props = JSON.parse(getWrite(CHARACTER_PROPERTIES_JSON_PATH)!);
    expect(props).toEqual({
      pronouns: { subject: 'they', object: 'them', possessive: 'their' },
      aliases: ['Nick', 'Nicky'],
      title: 'Detective',
      firstMessage: 'Hello there.',
      talkativeness: 0.7,
      canChooseOutfit: false,
    });

    expect(getWrite(CHARACTER_DESCRIPTION_MD_PATH)).toBe('DB desc');
    expect(getWrite(CHARACTER_PERSONALITY_MD_PATH)).toBe('DB personality');
    expect(getWrite(CHARACTER_EXAMPLE_DIALOGUES_MD_PATH)).toBe('DB dialogues');
    expect(getWrite(CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH)).toBe('primary full');

    const physPrompts = JSON.parse(getWrite(CHARACTER_PHYSICAL_PROMPTS_JSON_PATH)!);
    expect(physPrompts).toEqual({
      headAndShoulders: null,
      short: 'short',
      medium: 'medium',
      long: 'long',
      complete: 'complete',
    });

    // No items, no presets → no Wardrobe/*.md or Outfits/*.md writes, and the
    // legacy wardrobe.json must never be re-seeded.
    const writtenPaths = writeDatabaseDocumentMock.mock.calls.map(([, p]) => p);
    expect(writtenPaths).not.toContain('wardrobe.json');
    expect(writtenPaths.some((p) => p.startsWith('Wardrobe/'))).toBe(false);
    expect(writtenPaths.some((p) => p.startsWith('Outfits/'))).toBe(false);
  });

  it('projects a populated fact sheet into metadata.json', async () => {
    // The link import depends on: `create()` hands the validated character
    // (metadata and all) to ensureCharacterVault, which projects it here. If
    // this write ever stopped carrying `metadata`, an imported .qtap would
    // silently arrive with an empty sheet.
    const sheet = { hasAnsibleAccess: true, clearanceLevel: 3, knownLanguages: ['Trade Cant'] };
    const character = makeCharacter({ id: 'char-meta', physicalDescription: null, metadata: sheet });

    await writeCharacterVaultManagedFields('mount-meta', { character });

    expect(JSON.parse(getWrite(CHARACTER_METADATA_JSON_PATH)!)).toEqual(sheet);
  });

  it('projects an explicitly empty fact sheet', async () => {
    const character = makeCharacter({ id: 'char-empty-meta', physicalDescription: null, metadata: {} });
    await writeCharacterVaultManagedFields('mount-empty-meta', { character });
    expect(JSON.parse(getWrite(CHARACTER_METADATA_JSON_PATH)!)).toEqual({});
  });

  it.each([
    ['carries no metadata at all', undefined],
    ['carries a null metadata', null],
  ])('does not touch metadata.json when the character %s', async (_label, metadata) => {
    // `metadata` has no DB column, so a RAW character row can never carry one —
    // and the startup backfill's repopulate path projects exactly such rows.
    // Writing `{}` on absence would erase a fact sheet this caller never saw.
    // Absence means "no opinion", not "empty". The scaffold and the startup
    // backfill are what guarantee the file exists.
    const character = makeCharacter({ id: 'char-raw', physicalDescription: null, metadata });

    await writeCharacterVaultManagedFields('mount-raw', { character });

    expect(getWrite(CHARACTER_METADATA_JSON_PATH)).toBeUndefined();
  });

  it('writes empty strings / nulls through for characters with sparse fields', async () => {
    const character = makeCharacter({
      id: 'char-sparse',
      description: null,
      personality: null,
      exampleDialogues: null,
      title: null,
      firstMessage: null,
      aliases: [],
      pronouns: null,
      physicalDescription: null,
      systemPrompts: [],
      scenarios: [],
    });

    const result = await writeCharacterVaultManagedFields('mount-2', {
      character,
    });

    expect(result.physicalSkippedNoPrimary).toBe(true);
    // properties.json and the five markdown files; the physical-* pair is
    // skipped for want of a physical description, and metadata.json for want
    // of any metadata to project (see below).
    expect(result.singleFileWriteCount).toBe(6);

    const props = JSON.parse(getWrite(CHARACTER_PROPERTIES_JSON_PATH)!);
    expect(props).toEqual({
      pronouns: null,
      aliases: [],
      title: null,
      firstMessage: null,
      talkativeness: 0.5,
      canChooseOutfit: false,
    });
    expect(getWrite(CHARACTER_DESCRIPTION_MD_PATH)).toBe('');
    expect(getWrite(CHARACTER_PERSONALITY_MD_PATH)).toBe('');
    expect(getWrite(CHARACTER_EXAMPLE_DIALOGUES_MD_PATH)).toBe('');
    expect(getWrite(CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH)).toBeUndefined();
    expect(getWrite(CHARACTER_PHYSICAL_PROMPTS_JSON_PATH)).toBeUndefined();
  });

  it('projects systemPrompts into Prompts/*.md with YAML frontmatter and marks the default', async () => {
    const character = makeCharacter({
      id: 'char-prompts',
      physicalDescription: null,
      systemPrompts: [
        {
          id: 'p1',
          name: 'Courtly',
          content: 'Speak formally.',
          isDefault: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'p2',
          name: 'Casual',
          content: 'Speak casually.',
          isDefault: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      scenarios: [],
    });

    const result = await writeCharacterVaultManagedFields('mount-3', {
      character,
    });

    expect(result.systemPromptsWritten).toBe(2);

    const courtly = getWrite(`${CHARACTER_PROMPTS_FOLDER}/Courtly.md`);
    const casual = getWrite(`${CHARACTER_PROMPTS_FOLDER}/Casual.md`);
    expect(courtly).toBeDefined();
    expect(casual).toBeDefined();
    expect(courtly).toContain('name: Courtly');
    expect(courtly).toContain('isDefault: true');
    expect(courtly).toContain('Speak formally.');
    expect(casual).not.toContain('isDefault');
    expect(casual).toContain('Speak casually.');
  });

  it('projects scenarios into Scenarios/*.md with a # heading title', async () => {
    const character = makeCharacter({
      id: 'char-scenarios',
      physicalDescription: null,
      systemPrompts: [],
      scenarios: [
        {
          id: 's1',
          title: 'The Drawing Room',
          content: 'A quiet gathering on a Tuesday afternoon.',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await writeCharacterVaultManagedFields('mount-4', {
      character,
    });

    expect(result.scenariosWritten).toBe(1);
    const scenarioFile = getWrite(`${CHARACTER_SCENARIOS_FOLDER}/The Drawing Room.md`);
    expect(scenarioFile).toBe('# The Drawing Room\n\nA quiet gathering on a Tuesday afternoon.');
  });

  it('deletes stale files in Prompts/ and Scenarios/ that no longer correspond to a DB entry', async () => {
    mockRepoPaths({}, {
      [CHARACTER_PROMPTS_FOLDER]: [
        {
          mountPointId: 'mount-5',
          relativePath: `${CHARACTER_PROMPTS_FOLDER}/Old.md`,
          fileName: 'Old.md',
          content: 'stale',
        },
      ],
      [CHARACTER_SCENARIOS_FOLDER]: [
        {
          mountPointId: 'mount-5',
          relativePath: `${CHARACTER_SCENARIOS_FOLDER}/Old Scene.md`,
          fileName: 'Old Scene.md',
          content: 'stale',
        },
      ],
    });

    const character = makeCharacter({
      id: 'char-stale',
      physicalDescription: null,
      systemPrompts: [
        {
          id: 'p-new',
          name: 'New',
          content: 'Fresh.',
          isDefault: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      scenarios: [
        {
          id: 's-new',
          title: 'New Scene',
          content: 'Fresh scenario.',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    await writeCharacterVaultManagedFields('mount-5', {
      character,
    });

    const deletedPaths = deleteDatabaseDocumentMock.mock.calls.map(([, p]) => p);
    expect(deletedPaths).toContain(`${CHARACTER_PROMPTS_FOLDER}/Old.md`);
    expect(deletedPaths).toContain(`${CHARACTER_SCENARIOS_FOLDER}/Old Scene.md`);
  });

  it('projects leaf wardrobe items into Wardrobe/*.md with frontmatter and freeform body', async () => {
    const wardrobeItems = [
      {
        id: 'item-1',
        characterId: 'char-wardrobe',
        title: 'Linen Jacket',
        description: 'Cream linen with ivory buttons.',
        types: ['top' as const],
        componentItemIds: [],
        appropriateness: null,
        isDefault: true,
        migratedFromClothingRecordId: null,
        archivedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    await projectVaultWardrobe('mount-6', 'char-wardrobe', wardrobeItems);

    // The retired Outfits/ folder is no longer projected — composites fold
    // into Wardrobe/*.md. The legacy wardrobe.json must never be re-seeded.
    const writtenPaths = writeDatabaseDocumentMock.mock.calls.map(([, p]) => p);
    expect(writtenPaths).not.toContain('wardrobe.json');
    expect(writtenPaths.some((p) => p.startsWith('Outfits/'))).toBe(false);

    const itemFile = getWrite('Wardrobe/Linen Jacket.md');
    expect(itemFile).toBeDefined();
    expect(itemFile).toContain('id: item-1');
    expect(itemFile).toContain('title: Linen Jacket');
    expect(itemFile).toContain('- top');
    expect(itemFile).toContain('default: true');
    expect(itemFile).toContain('Cream linen with ivory buttons.');
    // Leaf items don't carry a `componentItems:` array.
    expect(itemFile).not.toContain('componentItems:');
  });

  it('projects composite wardrobe items with a componentItems: slug array in frontmatter', async () => {
    // A composite "Rain Outfit" references three leaf items by id; the writer
    // should translate those ids to slugs (kebab-case from the leaf titles)
    // when emitting the frontmatter, so vault hand-edits are friendlier.
    const raincoat = {
      id: 'raincoat-1',
      characterId: 'char-composite',
      title: 'Yellow Raincoat',
      description: null,
      types: ['top' as const],
      componentItemIds: [],
      appropriateness: null,
      isDefault: false,
      migratedFromClothingRecordId: null,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const jeans = { ...raincoat, id: 'jeans-1', title: 'Blue Jeans', types: ['bottom' as const] };
    const wellies = { ...raincoat, id: 'wellies-1', title: 'Wellies', types: ['footwear' as const] };
    const rainOutfit = {
      id: 'rain-outfit',
      characterId: 'char-composite',
      title: 'Rain Outfit',
      description: 'Bundle for a rainy day.',
      types: ['top' as const, 'bottom' as const, 'footwear' as const],
      componentItemIds: ['raincoat-1', 'jeans-1', 'wellies-1'],
      appropriateness: null,
      isDefault: false,
      migratedFromClothingRecordId: null,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    await projectVaultWardrobe('mount-7', 'char-composite', [
      raincoat,
      jeans,
      wellies,
      rainOutfit,
    ]);

    const compositeFile = getWrite('Wardrobe/Rain Outfit.md');
    expect(compositeFile).toBeDefined();
    expect(compositeFile).toContain('id: rain-outfit');
    expect(compositeFile).toContain('title: Rain Outfit');
    // componentItems is emitted as the slug array, in declared order.
    expect(compositeFile).toContain('componentItems:');
    expect(compositeFile).toContain('- yellow-raincoat');
    expect(compositeFile).toContain('- blue-jeans');
    expect(compositeFile).toContain('- wellies');
    expect(compositeFile).toContain('Bundle for a rainy day.');
  });
});

describe('readCharacterVaultWardrobe — componentItems frontmatter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /** Helper: build a vault doc shaped like docMountDocuments.findManyByMountPointsInFolder returns. */
  function vaultDoc(
    mountPointId: string,
    fileName: string,
    body: string,
    overrides: Partial<{
      createdAt: string;
      updatedAt: string;
    }> = {},
  ) {
    return {
      id: 'doc-' + fileName,
      mountPointId,
      relativePath: `Wardrobe/${fileName}`,
      fileName,
      fileType: 'markdown' as const,
      contentSha256: 'x'.repeat(64),
      plainTextLength: body.length,
      folderId: null,
      lastModified: 0,
      createdAt: overrides.createdAt ?? '2026-04-26T00:00:00.000Z',
      updatedAt: overrides.updatedAt ?? '2026-04-26T00:00:00.000Z',
      content: body,
    };
  }

  function setupVault(docs: ReturnType<typeof vaultDoc>[]) {
    const findManyByMountPointsInFolder = jest
      .fn()
      .mockImplementation((_ids: string[], folder: string) => {
        if (folder === 'Wardrobe') return Promise.resolve(docs);
        return Promise.resolve([]);
      });
    getRepositoriesMock.mockReturnValue({
      docMountDocuments: {
        findManyByMountPointsAndPath: jest.fn().mockResolvedValue([]),
        findManyByMountPointsInFolder,
      },
      wardrobe: {
        findArchetypes: jest.fn().mockResolvedValue([]),
      },
    });
    return { findManyByMountPointsInFolder };
  }

  it('resolves componentItems: slug refs to canonical UUIDs from sibling Wardrobe files', async () => {
    // Two leaf items + a composite that references them by slug. The reader
    // should resolve the slugs to the leaf items' UUIDs.
    const earringsId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const lockectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const compositeId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    setupVault([
      vaultDoc(
        'mount-a',
        'Pearl Earrings.md',
        ['---', `id: ${earringsId}`, 'title: Pearl Earrings', 'types:', '- accessories', '---', '', 'Lustrous.'].join(
          '\n',
        ),
      ),
      vaultDoc(
        'mount-a',
        'Gold Locket.md',
        ['---', `id: ${lockectId}`, 'title: Gold Locket', 'types:', '- accessories', '---', '', 'Heirloom.'].join(
          '\n',
        ),
      ),
      vaultDoc(
        'mount-a',
        'Nice Jewelry.md',
        [
          '---',
          `id: ${compositeId}`,
          'title: Nice Jewelry',
          'types:',
          '- accessories',
          'componentItems:',
          '- pearl-earrings',
          '- gold-locket',
          '---',
          '',
          'Set.',
        ].join('\n'),
      ),
    ]);

    const result = await readCharacterVaultWardrobe('mount-a', 'char-a');
    expect(result).not.toBeNull();
    const composite = result!.items.find((i) => i.id === compositeId);
    expect(composite).toBeDefined();
    expect(composite!.componentItemIds).toEqual([earringsId, lockectId]);
  });

  it('drops a self-cycle in componentItems: but keeps the item itself', async () => {
    // A composite that lists its own slug as a component must be tolerated —
    // the bad ref is dropped, the item stays.
    const itemId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    setupVault([
      vaultDoc(
        'mount-b',
        'Self Hugger.md',
        [
          '---',
          `id: ${itemId}`,
          'title: Self Hugger',
          'types:',
          '- top',
          'componentItems:',
          '- self-hugger',
          '---',
          '',
          'Curiously self-referential.',
        ].join('\n'),
      ),
    ]);

    const result = await readCharacterVaultWardrobe('mount-b', 'char-b');
    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(1);
    // The cycle was detected → componentItemIds wiped, item itself preserved.
    expect(result!.items[0].componentItemIds).toEqual([]);
    expect(result!.items[0].title).toBe('Self Hugger');
  });

  it('drops unknown componentItems: refs but keeps known ones', async () => {
    // Vault hand-edits often include typos; the reader resolves what it can
    // and drops the rest with a log.
    const knownId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const compositeId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    setupVault([
      vaultDoc(
        'mount-c',
        'Known Item.md',
        ['---', `id: ${knownId}`, 'title: Known Item', 'types:', '- top', '---', '', ''].join('\n'),
      ),
      vaultDoc(
        'mount-c',
        'Composite.md',
        [
          '---',
          `id: ${compositeId}`,
          'title: Composite',
          'types:',
          '- top',
          'componentItems:',
          '- known-item',
          '- some-typo-that-doesnt-exist',
          '---',
          '',
          '',
        ].join('\n'),
      ),
    ]);

    const result = await readCharacterVaultWardrobe('mount-c', 'char-c');
    const composite = result!.items.find((i) => i.id === compositeId);
    expect(composite!.componentItemIds).toEqual([knownId]);
  });

  it('parses leaf items with no componentItems: as componentItemIds: []', async () => {
    setupVault([
      vaultDoc(
        'mount-d',
        'Plain Jeans.md',
        ['---', 'title: Plain Jeans', 'types:', '- bottom', '---', '', 'Sturdy.'].join('\n'),
      ),
    ]);

    const result = await readCharacterVaultWardrobe('mount-d', 'char-d');
    expect(result!.items[0].componentItemIds).toEqual([]);
  });

  it('resolves componentItems: UUID refs that point at shared archetypes', async () => {
    // A character-owned bundle whose only component is a shared archetype
    // (characterId === null, lives in the DB but not in this character's
    // vault). Without archetype seeding the ref would be dropped and the
    // bundle silently emptied.
    const fitbitId = '4c18725d-70bb-4cd6-a9d3-1f20c4aa8c7d';
    const bundleId = '11111111-2222-4333-8444-555555555555';

    const findManyByMountPointsInFolder = jest
      .fn()
      .mockImplementation((_ids: string[], folder: string) => {
        if (folder === 'Wardrobe') {
          return Promise.resolve([
            vaultDoc(
              'mount-e',
              'Naked Social.md',
              [
                '---',
                `id: ${bundleId}`,
                'title: Naked Social',
                'types:',
                '- accessories',
                'componentItems:',
                `- ${fitbitId}`,
                '---',
                '',
                '',
              ].join('\n'),
            ),
          ]);
        }
        return Promise.resolve([]);
      });
    getRepositoriesMock.mockReturnValue({
      docMountDocuments: {
        findManyByMountPointsAndPath: jest.fn().mockResolvedValue([]),
        findManyByMountPointsInFolder,
      },
      wardrobe: {
        findArchetypes: jest.fn().mockResolvedValue([
          {
            id: fitbitId,
            characterId: null,
            title: 'Fitbit',
            description: null,
            types: ['accessories'],
            appropriateness: null,
            isDefault: false,
            componentItemIds: [],
            archivedAt: null,
            migratedFromClothingRecordId: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
      },
    });

    const result = await readCharacterVaultWardrobe('mount-e', 'char-e');
    const bundle = result!.items.find((i) => i.id === bundleId);
    expect(bundle).toBeDefined();
    expect(bundle!.componentItemIds).toEqual([fitbitId]);
  });
});
