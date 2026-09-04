/**
 * Per-writer dual-voicing checks for the Staff opaque-anywhere feature.
 *
 * For every Staff writer (Host, Aurora, Prospero, Librarian, Lantern,
 * Concierge, Ariel) the persona-voiced `buildXxxContent` body should name the
 * persona ("The Host", "Aurora", "Prospero", …) while the sibling
 * `buildXxxOpaqueContent` body must NOT — and both should still surface the
 * underlying fact (character name, file path, time, etc.) so the LLM context
 * is functionally equivalent.
 *
 * See `lib/services/chat-message/context-builder.service.ts` for the swap
 * site that consumes these bodies.
 */

import { describe, it, expect, jest } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

jest.mock('@/lib/database/manager', () => ({
  rawQuery: jest.fn(),
  registerBlobColumns: jest.fn(),
  getDatabase: jest.fn(),
  getCollection: jest.fn(),
  getDatabaseAsync: jest.fn(),
  ensureCollection: jest.fn(),
}))

jest.mock('@/lib/mount-index/database-store', () => ({
  readDatabaseDocument: jest.fn().mockRejectedValue(new Error('no vault')),
}))

import {
  buildAddContent,
  buildAddOpaqueContent,
  buildRemoveContent,
  buildRemoveOpaqueContent,
  buildStatusChangeContent,
  buildStatusChangeOpaqueContent,
  buildScenarioContent,
  buildScenarioOpaqueContent,
  buildUserCharacterContent,
  buildUserCharacterOpaqueContent,
  buildSilentModeEntryContent,
  buildSilentModeEntryOpaqueContent,
  buildSilentModeExitContent,
  buildSilentModeExitOpaqueContent,
  buildJoinScenarioContent,
  buildJoinScenarioOpaqueContent,
  buildOffSceneCharactersContent,
  buildOffSceneCharactersOpaqueContent,
  buildTimestampContent,
  buildTimestampOpaqueContent,
} from '@/lib/services/host-notifications/writer'
import {
  buildOpeningOutfitContent,
  buildOpeningOutfitOpaqueContent,
  buildOutfitChangeContent,
  buildOutfitChangeOpaqueContent,
} from '@/lib/services/aurora-notifications/writer'
import {
  buildConnectionProfileChangeContent,
  buildConnectionProfileChangeOpaqueContent,
  buildGeneralContextContent,
  buildGeneralContextOpaqueContent,
  buildCombinedContextContent,
  buildCombinedContextOpaqueContent,
} from '@/lib/services/prospero-notifications/writer'
import {
  buildOpenContent,
  buildOpenOpaqueContent,
  buildRenameContent,
  buildRenameOpaqueContent,
  buildSaveContent,
  buildSaveOpaqueContent,
  buildDeleteContent,
  buildDeleteOpaqueContent,
  buildFolderCreatedContent,
  buildFolderCreatedOpaqueContent,
  buildFolderDeletedContent,
  buildFolderDeletedOpaqueContent,
  buildAttachContent,
  buildAttachOpaqueContent,
  buildUploadContent,
  buildUploadOpaqueContent,
  buildSummaryContent,
  buildSummaryOpaqueContent,
  buildWriteContent,
  buildWriteOpaqueContent,
  buildMoveContent,
  buildMoveOpaqueContent,
  buildCopyContent,
  buildCopyOpaqueContent,
  buildBlobWriteContent,
  buildBlobWriteOpaqueContent,
} from '@/lib/services/librarian-notifications/writer'
import { buildDangerContent, buildDangerOpaqueContent } from '@/lib/services/concierge-notifications/writer'
import type { Character } from '@/lib/schemas/character.types'

const PERSONA_NAMES = [
  'The Host',
  'the Host',
  'Aurora',
  'Prospero',
  'The Librarian',
  'the Librarian',
  'The Lantern',
  'the Lantern',
  'The Concierge',
  'the Concierge',
  'Ariel',
] as const

function expectNoPersonaNames(body: string, allowAriel = false): void {
  for (const name of PERSONA_NAMES) {
    if (allowAriel && name === 'Ariel') continue
    expect(body).not.toContain(name)
  }
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

describe('Host opaque builders', () => {
  const character = {
    id: 'char-1',
    name: 'Beatrice',
    avatarUrl: null,
    description: 'A skeptical librarian.',
    characterDocumentMountPointId: null,
  } as unknown as Character

  it('add: persona names the Host; opaque does not, but keeps the character name', async () => {
    const persona = await buildAddContent(character)
    const opaque = await buildAddOpaqueContent(character)
    expect(persona).toContain('The Host welcomes Beatrice')
    expect(opaque).toContain('Beatrice has joined the scene')
    expectNoPersonaNames(opaque)
  })

  it('remove', () => {
    expect(buildRemoveContent('Beatrice')).toContain('The Host bids Beatrice adieu')
    const opaque = buildRemoveOpaqueContent('Beatrice')
    expect(opaque).toContain('Beatrice has left the scene')
    expectNoPersonaNames(opaque)
  })

  it('status change', () => {
    expect(buildStatusChangeContent('Beatrice', 'active', 'silent')).toContain('The Host notes')
    const opaque = buildStatusChangeOpaqueContent('Beatrice', 'active', 'silent')
    expect(opaque).toContain('Beatrice is now')
    expectNoPersonaNames(opaque)
  })

  it('scenario', () => {
    expect(buildScenarioContent('A foggy harbour.')).toContain('The Host sets the scene')
    const opaque = buildScenarioOpaqueContent('A foggy harbour.')
    expect(opaque).toContain('A foggy harbour.')
    expectNoPersonaNames(opaque)
  })

  it('user character', () => {
    expect(buildUserCharacterContent('Charles', 'a writer')).toContain('The Host introduces')
    const opaque = buildUserCharacterOpaqueContent('Charles', 'a writer')
    expect(opaque).toContain("Charles is the user's voice")
    expect(opaque).toContain('a writer')
    expectNoPersonaNames(opaque)
  })

  it('silent mode entry/exit', () => {
    expect(buildSilentModeEntryContent('Beatrice')).toContain('The Host whispers')
    const enter = buildSilentModeEntryOpaqueContent('Beatrice')
    expect(enter).toContain('SILENT mode')
    expectNoPersonaNames(enter)

    expect(buildSilentModeExitContent('Beatrice')).toContain('The Host whispers')
    const exit = buildSilentModeExitOpaqueContent('Beatrice')
    expect(exit).toContain('Silence is lifted')
    expectNoPersonaNames(exit)
  })

  it('join scenario', () => {
    expect(buildJoinScenarioContent('Beatrice', 'arrived by carriage')).toContain('The Host whispers')
    const opaque = buildJoinScenarioOpaqueContent('Beatrice', 'arrived by carriage')
    expect(opaque).toContain('arrived by carriage')
    expectNoPersonaNames(opaque)
  })

  it('off-scene characters', () => {
    const cards = [{ id: 'a', name: 'Reginald', description: 'A retired colonel.' }]
    expect(buildOffSceneCharactersContent(cards)).toContain('The Host begs leave to introduce')
    const opaque = buildOffSceneCharactersOpaqueContent(cards)
    expect(opaque).toContain('Reginald')
    expect(opaque).toContain('A retired colonel.')
    expectNoPersonaNames(opaque)
  })

  it('timestamp', () => {
    expect(buildTimestampContent('3:42 PM')).toContain('The Host marks the time')
    const opaque = buildTimestampOpaqueContent('3:42 PM')
    expect(opaque).toContain('3:42 PM')
    expectNoPersonaNames(opaque)
  })
})

// ---------------------------------------------------------------------------
// Aurora
// ---------------------------------------------------------------------------

describe('Aurora opaque builders', () => {
  const outfit = {
    top: ['a linen blouse'],
    bottom: ['a wool skirt'],
    footwear: ['low boots'],
    accessories: [],
    hair: [],
  }
  const params = { characterName: 'Beatrice', outfit }

  it('opening outfit', () => {
    expect(buildOpeningOutfitContent(params)).toContain('Aurora regards Beatrice')
    const opaque = buildOpeningOutfitOpaqueContent(params)
    expect(opaque).toContain("Beatrice's current attire")
    expectNoPersonaNames(opaque)
  })

  it('outfit change', () => {
    expect(buildOutfitChangeContent(params)).toContain('Aurora marks an alteration')
    const opaque = buildOutfitChangeOpaqueContent(params)
    expect(opaque).toContain('Beatrice is now wearing')
    expectNoPersonaNames(opaque)
  })
})

// ---------------------------------------------------------------------------
// Prospero
// ---------------------------------------------------------------------------

describe('Prospero opaque builders', () => {
  it('connection-profile change', () => {
    const visible = buildConnectionProfileChangeContent('Beatrice', 'old', 'new')
    expect(visible).toContain("Beatrice's current response model is now new")
    expect(visible).toContain('previous model was old')
    const opaque = buildConnectionProfileChangeOpaqueContent('Beatrice', 'old', 'new')
    expect(opaque).toContain("Beatrice's current response model is now new")
    expect(opaque).toContain('previous model was old')
    expectNoPersonaNames(opaque)
  })

  it('connection-profile change — null fallback reads as "unassigned"', () => {
    expect(buildConnectionProfileChangeContent('Beatrice', null, 'new'))
      .toBe("Beatrice's current response model is now new; previous model was unassigned.")
    expect(buildConnectionProfileChangeContent('Beatrice', 'old', null))
      .toBe("Beatrice's current response model is now unassigned; previous model was old.")
  })

  it('project context (combined builder, project only)', () => {
    const project = { name: 'Foggy Tale', description: 'A novel.', instructions: null, documentStores: [] }
    expect(buildCombinedContextContent(project, null)).toContain('Prospero opens his ledger')
    const opaque = buildCombinedContextOpaqueContent(project, null)
    expect(opaque).toContain('Foggy Tale')
    expect(opaque).toContain('A novel.')
    expectNoPersonaNames(opaque)
  })

  it('general context', () => {
    const general = { mountPointId: 'm-1', name: 'Quilltap General', mountType: 'database' as const }
    expect(buildGeneralContextContent(general)).toContain('Prospero would have you remember')
    const opaque = buildGeneralContextOpaqueContent(general)
    expect(opaque).toContain('Quilltap General')
    expectNoPersonaNames(opaque)
  })

  it('combined context — project and general together', () => {
    const project = { name: 'Foggy Tale', description: 'A novel.', instructions: null, documentStores: [] }
    const general = { mountPointId: 'm-1', name: 'Quilltap General', mountType: 'database' as const }
    const content = buildCombinedContextContent(project, general)
    expect(content).toContain('Prospero opens his ledger')
    expect(content).toContain('Foggy Tale')
    expect(content).toContain('A novel.')
    expect(content).toContain('Quilltap General')
    expect(content).toContain("household's shared shelf alongside")
    const opaque = buildCombinedContextOpaqueContent(project, general)
    expect(opaque).toContain('Foggy Tale')
    expect(opaque).toContain('Quilltap General')
    expectNoPersonaNames(opaque)
  })

  it('combined context — project only', () => {
    const project = { name: 'Foggy Tale', description: 'A novel.', instructions: null, documentStores: [] }
    const content = buildCombinedContextContent(project, null)
    expect(content).toContain('Prospero opens his ledger')
    expect(content).toContain('Foggy Tale')
    expect(content).not.toContain('Quilltap General')
  })

  it('combined context — general only falls back to general builder', () => {
    const general = { mountPointId: 'm-1', name: 'Quilltap General', mountType: 'database' as const }
    expect(buildCombinedContextContent(null, general)).toBe(buildGeneralContextContent(general))
    expect(buildCombinedContextOpaqueContent(null, general)).toBe(buildGeneralContextOpaqueContent(general))
  })

  it('combined context — nothing to say returns empty string', () => {
    const project = { name: 'Foggy Tale', description: null, instructions: null, documentStores: [] }
    expect(buildCombinedContextContent(project, null)).toBe('')
    expect(buildCombinedContextOpaqueContent(project, null)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Librarian
// ---------------------------------------------------------------------------

describe('Librarian opaque builders', () => {
  const openParams = {
    chatId: 'c-1',
    displayTitle: 'Notes',
    filePath: 'Notes.md',
    scope: 'project' as const,
    mountPoint: null,
    isNew: false,
    origin: { kind: 'opened-by-user' as const },
  }
  const renameParams = {
    chatId: 'c-1',
    oldDisplayTitle: 'Old',
    newDisplayTitle: 'New',
    oldFilePath: 'old.md',
    newFilePath: 'new.md',
    scope: 'project' as const,
    mountPoint: null,
  }
  const deleteParams = {
    chatId: 'c-1',
    displayTitle: 'Notes',
    filePath: 'Notes.md',
    scope: 'project' as const,
    mountPoint: null,
    origin: { kind: 'by-user' as const },
  }
  const folderCreatedParams = {
    chatId: 'c-1',
    folderPath: 'drafts/',
    scope: 'project' as const,
    mountPoint: null,
    origin: { kind: 'by-user' as const },
  }
  const folderDeletedParams = {
    ...folderCreatedParams,
  }
  const attachParams = {
    chatId: 'c-1',
    displayTitle: 'Photo',
    filePath: 'photo.png',
    mountPoint: null,
    mountFileId: 'mf-1',
    mimeType: 'image/png',
    description: 'A sepia portrait.',
  }
  const uploadParams = {
    chatId: 'c-1',
    uploads: [{ fileId: 'f-1', filename: 'pic.png' }],
  }

  it('open', () => {
    expect(buildOpenContent(openParams)).toContain('The Librarian has set out')
    const opaque = buildOpenOpaqueContent(openParams)
    expect(opaque).toContain('Document opened: "Notes"')
    expectNoPersonaNames(opaque)
  })

  it('rename', () => {
    expect(buildRenameContent(renameParams)).toContain('The Librarian has rechristened')
    const opaque = buildRenameOpaqueContent(renameParams)
    expect(opaque).toContain('Document renamed')
    expect(opaque).toContain('Old')
    expect(opaque).toContain('New')
    expectNoPersonaNames(opaque)
  })

  it('save', () => {
    const diff = 'I\'ve made changes to "Notes":\n\n```diff\n+ line\n```'
    expect(buildSaveContent(diff)).toContain('The Librarian has filed')
    const opaque = buildSaveOpaqueContent(diff)
    expect(opaque).toContain('The following changes were filed')
    expect(opaque).toContain('+ line')
    expectNoPersonaNames(opaque)
  })

  it('delete', () => {
    expect(buildDeleteContent(deleteParams)).toContain('The Librarian has removed')
    const opaque = buildDeleteOpaqueContent(deleteParams)
    expect(opaque).toContain('Document removed: "Notes"')
    expectNoPersonaNames(opaque)
  })

  it('folder created/deleted', () => {
    expect(buildFolderCreatedContent(folderCreatedParams)).toContain('The Librarian has set aside')
    const created = buildFolderCreatedOpaqueContent(folderCreatedParams)
    expect(created).toContain('Folder created: "drafts/"')
    expectNoPersonaNames(created)

    expect(buildFolderDeletedContent(folderDeletedParams)).toContain('The Librarian has dismantled')
    const deleted = buildFolderDeletedOpaqueContent(folderDeletedParams)
    expect(deleted).toContain('Folder removed: "drafts/"')
    expectNoPersonaNames(deleted)
  })

  it('attach', () => {
    expect(buildAttachContent(attachParams)).toContain('The user has bid the Librarian')
    const opaque = buildAttachOpaqueContent(attachParams)
    expect(opaque).toContain('Image attached: "Photo"')
    expect(opaque).toContain('A sepia portrait.')
    expectNoPersonaNames(opaque)
  })

  it('upload', () => {
    expect(buildUploadContent(uploadParams)).toContain('The Librarian has catalogued')
    const opaque = buildUploadOpaqueContent(uploadParams)
    expect(opaque).toContain('The user has uploaded')
    expect(opaque).toContain('pic.png')
    expectNoPersonaNames(opaque)
  })

  it('summary', () => {
    expect(buildSummaryContent('It was a foggy night.')).toContain('The Librarian deposits')
    const opaque = buildSummaryOpaqueContent('It was a foggy night.')
    expect(opaque).toContain('Précis of the conversation')
    expect(opaque).toContain('It was a foggy night.')
    expectNoPersonaNames(opaque)
  })

  const writeBase = {
    chatId: 'c-1',
    displayTitle: 'Notes.md',
    uri: 'qtap://self/Notes.md',
    scope: 'document_store' as const,
    mountPoint: 'self',
    origin: { kind: 'by-character' as const, characterName: 'Beatrice' },
  }

  it('write — created reports the new contents and the qtap URI', () => {
    const params = { ...writeBase, change: { kind: 'created' as const, body: '# Title\n\nFresh prose.' } }
    const persona = buildWriteContent(params)
    expect(persona).toContain('The Librarian has set down a new volume')
    expect(persona).toContain('qtap://self/Notes.md')
    expect(persona).toContain('Fresh prose.')
    const opaque = buildWriteOpaqueContent(params)
    expect(opaque).toContain('Document created: "Notes.md"')
    expect(opaque).toContain('Fresh prose.')
    expect(opaque).toContain('qtap://self/Notes.md')
    expectNoPersonaNames(opaque)
  })

  it('write — edited embeds the diff and the qtap URI', () => {
    const diff = '--- a/Notes.md\n+++ b/Notes.md\n@@ -1 +1 @@\n-old\n+new'
    const params = { ...writeBase, change: { kind: 'edited' as const, diff } }
    const persona = buildWriteContent(params)
    expect(persona).toContain('The Librarian has filed fresh alterations')
    expect(persona).toContain('+new')
    const opaque = buildWriteOpaqueContent(params)
    expect(opaque).toContain('Document edited: "Notes.md"')
    expect(opaque).toContain('+new')
    expect(opaque).toContain('qtap://self/Notes.md')
    expectNoPersonaNames(opaque)
  })

  it('move — names old/new addresses for files and folders', () => {
    const params = {
      chatId: 'c-1',
      oldDisplayTitle: 'old.md',
      newDisplayTitle: 'new.md',
      oldUri: 'qtap://self/old.md',
      newUri: 'qtap://self/sub/new.md',
      scope: 'document_store' as const,
      mountPoint: 'self',
      origin: { kind: 'by-character' as const, characterName: 'Beatrice' },
      isFolder: false,
    }
    expect(buildMoveContent(params)).toContain('The Librarian has relocated')
    const opaque = buildMoveOpaqueContent(params)
    expect(opaque).toContain('File moved')
    expect(opaque).toContain('qtap://self/old.md')
    expect(opaque).toContain('qtap://self/sub/new.md')
    expectNoPersonaNames(opaque)
    expect(buildMoveOpaqueContent({ ...params, isFolder: true })).toContain('Folder moved')
  })

  it('copy — names source/dest stores and URIs', () => {
    const params = {
      chatId: 'c-1',
      sourceDisplayTitle: 'a.md',
      destDisplayTitle: 'a.md',
      sourceMountPoint: 'Library',
      destMountPoint: 'Archive',
      sourceUri: 'qtap://Library/a.md',
      destUri: 'qtap://Archive/a.md',
      origin: { kind: 'by-character' as const, characterName: 'Beatrice' },
    }
    expect(buildCopyContent(params)).toContain('The Librarian has transcribed a copy')
    const opaque = buildCopyOpaqueContent(params)
    expect(opaque).toContain('File copied')
    expect(opaque).toContain('qtap://Library/a.md')
    expect(opaque).toContain('qtap://Archive/a.md')
    expectNoPersonaNames(opaque)
  })

  it('blob write — describes the asset with mime, size, and URI', () => {
    const params = {
      chatId: 'c-1',
      displayTitle: 'sketch.webp',
      uri: 'qtap://self/photos/sketch.webp',
      mountPoint: 'self',
      mimeType: 'image/webp',
      sizeBytes: 4096,
      description: 'A pencil sketch.',
      origin: { kind: 'by-character' as const, characterName: 'Beatrice' },
    }
    expect(buildBlobWriteContent(params)).toContain('The Librarian has affixed the illustration')
    const opaque = buildBlobWriteOpaqueContent(params)
    expect(opaque).toContain('Image added: "sketch.webp"')
    expect(opaque).toContain('qtap://self/photos/sketch.webp')
    expect(opaque).toContain('A pencil sketch.')
    expectNoPersonaNames(opaque)
  })
})

// ---------------------------------------------------------------------------
// Concierge
// ---------------------------------------------------------------------------

describe('Concierge opaque builder', () => {
  it('danger advisory', () => {
    expect(buildDangerContent()).toContain('The Concierge')
    const opaque = buildDangerOpaqueContent()
    expect(opaque).toContain('Content advisory')
    expectNoPersonaNames(opaque)
  })

  it('danger advisory with specifics names categories, scores, and threshold', () => {
    const details = {
      score: 0.83,
      threshold: 0.7,
      categories: [
        { category: 'nsfw', score: 0.83, label: 'whatever the LLM said' },
        { category: 'violence', score: 0.72, label: 'free-text label' },
        { category: 'disturbing', score: 0.10, label: 'low' },
      ],
      source: 'moderation' as const,
      providerName: 'OPENAI',
    }

    const narrative = buildDangerContent(details)
    expect(narrative).toContain('The Concierge')
    expect(narrative).toContain('Sexual/NSFW content')
    expect(narrative).toContain('Violence or graphic content')
    expect(narrative).toContain('0.83')
    expect(narrative).toContain('0.72')
    expect(narrative).toContain('0.70')
    expect(narrative).toContain('OPENAI')
    // Below-threshold category should be filtered out
    expect(narrative).not.toContain('Disturbing content')

    const opaque = buildDangerOpaqueContent(details)
    expect(opaque).toContain('Content advisory')
    expect(opaque).toContain('Triggers:')
    expect(opaque).toContain('Sexual/NSFW content')
    expect(opaque).toContain('0.83')
    expect(opaque).toContain('0.70')
    expect(opaque).toContain('OPENAI')
    expectNoPersonaNames(opaque)
  })

  it('danger advisory falls back to top scores when nothing crosses threshold', () => {
    const details = {
      score: 0.65,
      threshold: 0.7,
      categories: [
        { category: 'nsfw', score: 0.65, label: '' },
        { category: 'violence', score: 0.40, label: '' },
      ],
      source: 'llm' as const,
      providerName: 'OLLAMA',
    }

    const narrative = buildDangerContent(details)
    expect(narrative).toContain('Sexual/NSFW content')
    expect(narrative).toContain('0.65')
    expect(narrative).toContain('cheap-LLM')
    // Below threshold: the classifier flagged it directly, not the arithmetic.
    expect(narrative).toContain('direct verdict')
    expect(narrative).toContain('shy of the present threshold')
    expect(narrative).not.toContain('registering 0.65 against')

    const opaque = buildDangerOpaqueContent(details)
    expect(opaque).toContain('cheap-LLM fallback')
    expect(opaque).toContain('Flagged directly by')
    expect(opaque).toContain('(not reached)')
    expectNoPersonaNames(opaque)
  })

  it('crossing the threshold keeps the arithmetic phrasing, not the direct-verdict phrasing', () => {
    const details = {
      score: 0.92,
      threshold: 0.7,
      categories: [{ category: 'violence', score: 0.92, label: '' }],
      source: 'moderation' as const,
      providerName: 'OPENAI',
    }

    const narrative = buildDangerContent(details)
    expect(narrative).toContain('registering 0.92 against the present threshold of 0.70')
    expect(narrative).not.toContain('direct verdict')

    const opaque = buildDangerOpaqueContent(details)
    expect(opaque).toContain('Overall score 0.92 against threshold 0.70')
    expect(opaque).not.toContain('Flagged directly by')
    expectNoPersonaNames(opaque)
  })
})
