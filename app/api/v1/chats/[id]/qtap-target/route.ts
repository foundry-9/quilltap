/**
 * Chat-scoped qtap:// target streaming.
 *
 * GET /api/v1/chats/:id/qtap-target?scope=...&filePath=...&mountPoint=...
 *
 * Resolves a qtap-addressed target through the same chat access rules as the
 * Salon's Document Mode, then streams the raw bytes. Used by global qtap image
 * links so non-Salon surfaces can reuse the existing fullscreen image viewer.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { promises as fs } from 'fs'
import { createContextParamsHandler, type RequestContext } from '@/lib/api/middleware'
import { badRequest, notFound, serverError } from '@/lib/api/responses'
import { logger } from '@/lib/logger'
import { resolveDocEditPath, type DocEditScope } from '@/lib/doc-edit'
import { readMountFileBytes } from '@/lib/mount-index/read-file'
import { mimeForExtension } from '@/lib/mount-index/path-utils'

type Params = { id: string }

const querySchema = z.object({
  filePath: z.string().min(1),
  scope: z.enum(['project', 'document_store', 'general']).default('project'),
  mountPoint: z.string().optional(),
})

function getProjectId(chat: unknown): string | undefined {
  return (chat as Record<string, unknown>).projectId as string | undefined
}

function getParticipantCharacterIds(chat: unknown): string[] {
  const participants = (chat as { participants?: Array<{ characterId?: string | null }> }).participants
  if (!Array.isArray(participants)) return []
  const ids = new Set<string>()
  for (const participant of participants) {
    if (participant?.characterId) ids.add(participant.characterId)
  }
  return Array.from(ids)
}

export const GET = createContextParamsHandler<Params>(
  async (req: NextRequest, ctx: RequestContext, { id: chatId }) => {
    const parsed = querySchema.safeParse({
      filePath: req.nextUrl.searchParams.get('filePath') ?? undefined,
      scope: req.nextUrl.searchParams.get('scope') ?? undefined,
      mountPoint: req.nextUrl.searchParams.get('mountPoint') ?? undefined,
    })
    if (!parsed.success) {
      return badRequest(`Invalid query: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`)
    }

    const chat = await ctx.repos.chats.findById(chatId)
    if (!chat) {
      return badRequest('Chat not found')
    }

    try {
      const resolved = await resolveDocEditPath(parsed.data.scope as DocEditScope, parsed.data.filePath, {
        projectId: getProjectId(chat),
        characterIds: getParticipantCharacterIds(chat),
        mountPoint: parsed.data.mountPoint,
        operatorOverride: true,
      })

      let bytes: Buffer
      let mimeType: string

      if (resolved.mountPointId) {
        const raw = await readMountFileBytes(resolved.mountPointId, resolved.relativePath)
        bytes = raw.bytes
        mimeType = raw.mimeType
      } else {
        bytes = await fs.readFile(resolved.absolutePath)
        mimeType = mimeForExtension(resolved.relativePath)
      }

      const body = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      return new NextResponse(body as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(bytes.byteLength),
          'Cache-Control': 'private, max-age=3600',
        },
      })
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined
      if (code === 'ENOENT' || code === 'SOURCE_NOT_FOUND') {
        return notFound('File')
      }
      logger.error('[Chats v1] Failed to stream qtap target', {
        chatId,
        filePath: parsed.data.filePath,
        scope: parsed.data.scope,
        mountPoint: parsed.data.mountPoint,
        error: error instanceof Error ? error.message : String(error),
      })
      return serverError('Failed to stream qtap target')
    }
  }
)