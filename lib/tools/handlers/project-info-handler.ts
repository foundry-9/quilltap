/**
 * Project Info Tool Handler
 *
 * Executes project info tool calls during chat.
 * Provides access to project overview and instructions.
 *
 * @module tools/handlers/project-info-handler
 */

import { logger } from '@/lib/logger'
import { getRepositories } from '@/lib/repositories/factory'
import { pickPrimaryProjectStore } from '@/lib/mount-index/project-store-naming'
import type { DocMountPoint } from '@/lib/schemas/mount-index.types'
import {
  ProjectInfoToolOutput,
  ProjectInfoResult,
  ProjectInstructionsResult,
  ProjectCharacterInfo,
  ProjectDocumentStoreInfo,
  validateProjectInfoInput,
} from '../project-info-tool'

/**
 * Context required for project info execution
 */
export interface ProjectInfoToolContext {
  /** User ID for authentication */
  userId: string
  /** Project ID to query */
  projectId: string
  /** Optional embedding profile ID (kept for future use) */
  embeddingProfileId?: string
}

/**
 * Error thrown during project info execution
 */
export class ProjectInfoError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'ACCESS_DENIED' | 'EXECUTION_ERROR'
  ) {
    super(message)
    this.name = 'ProjectInfoError'
  }
}

/**
 * Execute get_info action
 */
async function executeGetInfo(
  context: ProjectInfoToolContext
): Promise<ProjectInfoResult | null> {
  const repos = getRepositories()

  // Get project
  const project = await repos.projects.findById(context.projectId)
  if (!project) {
    return null
  }

  // Get character roster details
  const characterRoster: ProjectCharacterInfo[] = []
  for (const charId of project.characterRoster) {
    const char = await repos.characters.findById(charId)
    if (char) {
      characterRoster.push({
        id: char.id,
        name: char.name,
      })
    }
  }

  // Count associated items
  const allChats = await repos.chats.findAll()
  const chatCount = allChats.filter(c => c.projectId === context.projectId).length

  const allFiles = await repos.files.findAll()
  const fileCount = allFiles.filter(f => f.projectId === context.projectId).length

  const allMemories = await repos.memories.findAll()
  const memoryCount = allMemories.filter(m => m.projectId === context.projectId).length

  const documentStore = await resolveProjectDocumentStore(context.projectId)

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    allowAnyCharacter: project.allowAnyCharacter,
    characterRoster,
    fileCount,
    chatCount,
    memoryCount,
    documentStore,
  }
}

/**
 * Resolve the database-backed Scriptorium store linked to a project.
 * Returns null if the project has no link or the mount index DB is
 * unavailable — the rest of the project info stays usable either way.
 */
async function resolveProjectDocumentStore(
  projectId: string
): Promise<ProjectDocumentStoreInfo | null> {
  const repos = getRepositories()
  try {
    const links = await repos.projectDocMountLinks.findByProjectId(projectId)
    if (!links.length) return null

    const mountPoints: DocMountPoint[] = []
    for (const link of links) {
      const mp = await repos.docMountPoints.findById(link.mountPointId)
      if (mp) mountPoints.push(mp)
    }

    const chosen = pickPrimaryProjectStore(mountPoints)
    if (!chosen) return null

    const [files, blobs] = await Promise.all([
      repos.docMountFiles.findByMountPointId(chosen.id),
      repos.docMountBlobs.listByMountPoint(chosen.id),
    ])
    return {
      mountPointId: chosen.id,
      name: chosen.name,
      storeType: chosen.storeType,
      fileCount: files.length,
      blobCount: blobs.length,
    }
  } catch {
    return null
  }
}

/**
 * Execute get_instructions action
 */
async function executeGetInstructions(
  context: ProjectInfoToolContext
): Promise<ProjectInstructionsResult | null> {
  const repos = getRepositories()

  const project = await repos.projects.findById(context.projectId)
  if (!project) {
    return null
  }

  return {
    instructions: project.instructions || null,
    hasInstructions: !!project.instructions,
  }
}

/**
 * Execute a project info tool call
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user and project IDs
 * @returns Tool output with results
 */
export async function executeProjectInfoTool(
  input: unknown,
  context: ProjectInfoToolContext
): Promise<ProjectInfoToolOutput> {
  const log = logger.child({
    module: 'project-info-handler',
    projectId: context.projectId,
    userId: context.userId,
  })

  try {
    // Validate input
    const parsed = validateProjectInfoInput(input)
    if (!parsed) {

      return {
        success: false,
        action: 'get_info',
        error: 'Invalid input: action is required and must be a valid action type',
      }
    }

    const { action } = parsed

    switch (action) {
      case 'get_info': {
        const result = await executeGetInfo(context)
        if (!result) {
          return {
            success: false,
            action,
            error: 'Project not found',
          }
        }
        return {
          success: true,
          action,
          data: result,
        }
      }

      case 'get_instructions': {
        const result = await executeGetInstructions(context)
        if (!result) {
          return {
            success: false,
            action,
            error: 'Project not found',
          }
        }
        return {
          success: true,
          action,
          data: result,
        }
      }

      default:
        return {
          success: false,
          action: action as any,
          error: `Unknown action: ${action}`,
        }
    }
  } catch (error) {
    log.error('Project info tool execution error', {}, error instanceof Error ? error : undefined)

    const action = typeof input === 'object' && input !== null && 'action' in input
      ? String((input as Record<string, unknown>).action) as any
      : 'get_info'

    return {
      success: false,
      action,
      error: error instanceof Error ? error.message : 'Unknown error during project info lookup',
    }
  }
}

/**
 * Format project info results for inclusion in conversation context
 *
 * @param output - Tool output to format
 * @returns Formatted string suitable for LLM context
 */
export function formatProjectInfoResults(output: ProjectInfoToolOutput): string {
  if (!output.success) {
    return `Project Info Error: ${output.error || 'Unknown error'}`
  }

  switch (output.action) {
    case 'get_info': {
      const info = output.data as ProjectInfoResult
      const parts = [
        `Project: ${info.name}`,
        info.description ? `Description: ${info.description}` : null,
        `Files: ${info.fileCount}, Chats: ${info.chatCount}, Memories: ${info.memoryCount}`,
        info.characterRoster.length > 0
          ? `Characters: ${info.characterRoster.map(c => c.name).join(', ')}`
          : 'No characters in roster',
        info.allowAnyCharacter ? '(Any character can participate)' : null,
        info.documentStore
          ? `Document Store: ${info.documentStore.name} (${info.documentStore.fileCount} files, ${info.documentStore.blobCount} blobs, storeType=${info.documentStore.storeType})`
          : 'Document Store: (none linked)',
      ].filter(Boolean)
      return parts.join('\n')
    }

    case 'get_instructions': {
      const inst = output.data as ProjectInstructionsResult
      if (!inst.hasInstructions) {
        return 'No project instructions defined.'
      }
      return `Project Instructions:\n${inst.instructions}`
    }

    default:
      return 'Unknown action result'
  }
}
