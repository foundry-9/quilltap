/**
 * Tool definition parameters — snapshot test
 *
 * Captures the OpenAI-shape `parameters` JSON Schema derived from each tool's
 * Zod input schema. Any drift between the Zod source of truth and the JSON
 * output (intended or accidental) will fail this snapshot and force a
 * deliberate review of what changed before it ships to providers.
 *
 * If a snapshot diff is intentional (e.g., a new tool parameter, a tightened
 * constraint), update with `npx jest -u lib/tools/__tests__/tool-definitions-snapshot.test.ts`
 * and review the diff in the PR.
 */

import { askCarinaToolDefinition } from '../ask-carina-tool'
import { attachImageToolDefinition } from '../attach-image-tool'
import { deleteAnnotationToolDefinition } from '../delete-annotation-tool'
import { docCloseDocumentToolDefinition } from '../doc-close-document-tool'
import { docCopyFileToolDefinition } from '../doc-copy-file-tool'
import { docCreateFolderToolDefinition } from '../doc-create-folder-tool'
import { docDeleteBlobToolDefinition } from '../doc-delete-blob-tool'
import { docDeleteFileToolDefinition } from '../doc-delete-file-tool'
import { docDeleteFolderToolDefinition } from '../doc-delete-folder-tool'
import { docFocusToolDefinition } from '../doc-focus-tool'
import { docGrepToolDefinition } from '../doc-grep-tool'
import { docInsertTextToolDefinition } from '../doc-insert-text-tool'
import { docListBlobsToolDefinition } from '../doc-list-blobs-tool'
import { docListFilesToolDefinition } from '../doc-list-files-tool'
import { docMoveFileToolDefinition } from '../doc-move-file-tool'
import { docMoveFolderToolDefinition } from '../doc-move-folder-tool'
import { docOpenDocumentToolDefinition } from '../doc-open-document-tool'
import { docReadBlobToolDefinition } from '../doc-read-blob-tool'
import { docReadFileToolDefinition } from '../doc-read-file-tool'
import { docReadFrontmatterToolDefinition } from '../doc-read-frontmatter-tool'
import { docReadHeadingToolDefinition } from '../doc-read-heading-tool'
import { docStrReplaceToolDefinition } from '../doc-str-replace-tool'
import { docUpdateFrontmatterToolDefinition } from '../doc-update-frontmatter-tool'
import { docUpdateHeadingToolDefinition } from '../doc-update-heading-tool'
import { docWriteBlobToolDefinition } from '../doc-write-blob-tool'
import { docWriteFileToolDefinition } from '../doc-write-file-tool'
import { helpNavigateToolDefinition } from '../help-navigate-tool'
import { helpSearchToolDefinition } from '../help-search-tool'
import { helpSettingsToolDefinition } from '../help-settings-tool'
import { imageGenerationToolDefinition } from '../image-generation-tool'
import { keepImageToolDefinition } from '../keep-image-tool'
import { listEmailToolDefinition } from '../list-email-tool'
import { listImagesToolDefinition } from '../list-images-tool'
import { sendMailToolDefinition } from '../send-mail-tool'
import { projectInfoToolDefinition } from '../project-info-tool'
import { readConversationToolDefinition } from '../read-conversation-tool'
import { requestFullContextToolDefinition } from '../request-full-context-tool'
import { rngToolDefinition } from '../rng-tool'
import { runCustomToolDefinition } from '../run-custom-tool'
import { runSqlToolDefinition } from '../run-sql-tool'
import { searchScriptoriumToolDefinition, searchScriptoriumBrahmaToolDefinition } from '../search-scriptorium-tool'
import { selfInventoryToolDefinition } from '../self-inventory-tool'
import { stateToolDefinition } from '../state-tool'
import { submitFinalResponseToolDefinition } from '../submit-final-response-tool'
import { terminalListToolDefinition } from '../terminal-list-tool'
import { terminalReadToolDefinition } from '../terminal-read-tool'
import { upsertAnnotationToolDefinition } from '../upsert-annotation-tool'
import { wardrobeListToolDefinition } from '../wardrobe-list-tool'
import { wardrobeReadToolDefinition } from '../wardrobe-read-tool'
import { wardrobeCreateToolDefinition } from '../wardrobe-create-tool'
import { wardrobeUpdateToolDefinition } from '../wardrobe-update-tool'
import { wardrobeArchiveToolDefinition } from '../wardrobe-archive-tool'
import { wardrobeWearToolDefinition } from '../wardrobe-wear-tool'
import { wardrobeTakeOffToolDefinition } from '../wardrobe-take-off-tool'
import { webSearchToolDefinition } from '../web-search-tool'
import { whisperToolDefinition } from '../whisper-tool'

const ALL_TOOLS = {
  askCarina: askCarinaToolDefinition,
  attachImage: attachImageToolDefinition,
  deleteAnnotation: deleteAnnotationToolDefinition,
  docCloseDocument: docCloseDocumentToolDefinition,
  docCopyFile: docCopyFileToolDefinition,
  docCreateFolder: docCreateFolderToolDefinition,
  docDeleteBlob: docDeleteBlobToolDefinition,
  docDeleteFile: docDeleteFileToolDefinition,
  docDeleteFolder: docDeleteFolderToolDefinition,
  docFocus: docFocusToolDefinition,
  docGrep: docGrepToolDefinition,
  docInsertText: docInsertTextToolDefinition,
  docListBlobs: docListBlobsToolDefinition,
  docListFiles: docListFilesToolDefinition,
  docMoveFile: docMoveFileToolDefinition,
  docMoveFolder: docMoveFolderToolDefinition,
  docOpenDocument: docOpenDocumentToolDefinition,
  docReadBlob: docReadBlobToolDefinition,
  docReadFile: docReadFileToolDefinition,
  docReadFrontmatter: docReadFrontmatterToolDefinition,
  docReadHeading: docReadHeadingToolDefinition,
  docStrReplace: docStrReplaceToolDefinition,
  docUpdateFrontmatter: docUpdateFrontmatterToolDefinition,
  docUpdateHeading: docUpdateHeadingToolDefinition,
  docWriteBlob: docWriteBlobToolDefinition,
  docWriteFile: docWriteFileToolDefinition,
  helpNavigate: helpNavigateToolDefinition,
  helpSearch: helpSearchToolDefinition,
  helpSettings: helpSettingsToolDefinition,
  imageGeneration: imageGenerationToolDefinition,
  keepImage: keepImageToolDefinition,
  listEmail: listEmailToolDefinition,
  listImages: listImagesToolDefinition,
  sendMail: sendMailToolDefinition,
  projectInfo: projectInfoToolDefinition,
  readConversation: readConversationToolDefinition,
  requestFullContext: requestFullContextToolDefinition,
  rng: rngToolDefinition,
  runCustom: runCustomToolDefinition,
  runSql: runSqlToolDefinition,
  searchScriptorium: searchScriptoriumToolDefinition,
  searchScriptoriumBrahma: searchScriptoriumBrahmaToolDefinition,
  selfInventory: selfInventoryToolDefinition,
  state: stateToolDefinition,
  submitFinalResponse: submitFinalResponseToolDefinition,
  terminalList: terminalListToolDefinition,
  terminalRead: terminalReadToolDefinition,
  upsertAnnotation: upsertAnnotationToolDefinition,
  wardrobeList: wardrobeListToolDefinition,
  wardrobeRead: wardrobeReadToolDefinition,
  wardrobeCreate: wardrobeCreateToolDefinition,
  wardrobeUpdate: wardrobeUpdateToolDefinition,
  wardrobeArchive: wardrobeArchiveToolDefinition,
  wardrobeWear: wardrobeWearToolDefinition,
  wardrobeTakeOff: wardrobeTakeOffToolDefinition,
  webSearch: webSearchToolDefinition,
  whisper: whisperToolDefinition,
}

describe('tool definitions: derived OpenAI parameters', () => {
  for (const [key, tool] of Object.entries(ALL_TOOLS)) {
    it(`${key}: parameters snapshot`, () => {
      expect(tool.function.parameters).toMatchSnapshot()
    })
  }

  it('every tool exposes name + description + parameters', () => {
    for (const [key, tool] of Object.entries(ALL_TOOLS)) {
      expect(tool.function.name).toBeTruthy()
      expect(tool.function.description).toBeTruthy()
      expect(tool.function.parameters).toBeTruthy()
      expect((tool.function.parameters as Record<string, unknown>).type).toBe('object')
    }
    expect.assertions(Object.entries(ALL_TOOLS).length * 4)
  })
})
