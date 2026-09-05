/**
 * Re-deciding the attachment question after the model changes underneath a
 * message array.
 *
 * A formatted message array is built once, against one connection profile.
 * `processFileAttachmentFallback` runs at that moment and answers, for that
 * profile: send the raw bytes, or replace them with a description? Whichever
 * it answers is baked into the array — raw `attachments` on the anchor
 * message, or description text prepended to its content.
 *
 * Every mid-turn model swap inherits that array. The uncensored reroute is the
 * one that bit us: a vision profile's array, bytes and all, handed to a
 * text-only substitute, which the gateway refuses with a 400 before the
 * remedy has a chance to run (bug 106). The failure is structural rather than
 * unlucky — the answer in the array was computed for a model that is no longer
 * the one being called.
 *
 * `adaptMessagesForProfile` asks the question again, for the profile actually
 * about to be called. An image a text-only stand-in cannot read becomes its
 * description, exactly as it would have if that profile had been the primary,
 * and the retry proceeds instead of dying at the gateway. A profile that *can*
 * take the bytes gets the array back untouched — same reference, no copy, no
 * describer spent.
 *
 * @module chat/message-attachment-adapter
 */

import {
  needsFallbackProcessing,
  processFileAttachmentFallback,
  formatFallbackAsMessagePrefix,
} from '@/lib/chat/file-attachment-fallback'
import { getErrorMessage } from '@/lib/error-utils'
import { logger } from '@/lib/logger'

import type { ConnectionProfile } from '@/lib/schemas/types'

/**
 * The subset of a formatted message this module reads. Deliberately loose:
 * callers hold richer shapes (thought signatures, tool calls, names) and every
 * extra field is carried through untouched.
 */
export interface AttachmentBearingMessage {
  role: string
  content: string
  attachments?: unknown[]
}

/** One attachment as `loadChatFilesForLLM` produces it. */
interface LoadedAttachment {
  id: string
  filepath?: string
  filename: string
  mimeType: string
  size: number
  data?: string
}

function isLoadedAttachment(value: unknown): value is LoadedAttachment {
  if (!value || typeof value !== 'object') return false
  const a = value as Partial<LoadedAttachment>
  return typeof a.id === 'string' && typeof a.mimeType === 'string'
}

/**
 * Every MIME type riding in a message array's `attachments`, de-duplicated.
 *
 * The routing question — "which substitute should we even offer?" — is asked
 * before a profile is in hand, so it needs the payload's shape rather than a
 * per-profile verdict. Feed this to `resolveProviderForDangerousContent`.
 */
export function collectAttachmentMimeTypes(
  messages: readonly AttachmentBearingMessage[]
): string[] {
  const seen = new Set<string>()
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (isLoadedAttachment(attachment)) seen.add(attachment.mimeType)
    }
  }
  return Array.from(seen)
}

/**
 * Re-run the attachment decision for `profile` and return an array it can
 * actually accept.
 *
 * Returns the **same array reference** when nothing needs changing, which is
 * the overwhelmingly common case: no attachments at all, or a substitute that
 * reads the same things the original did. Only a genuine mismatch costs a
 * describer call.
 *
 * Never throws. A describer that fails leaves the bytes dropped and a
 * `⚠️ Attachment Processing Failed` note in their place — a degraded turn the
 * model can still answer, which is strictly better than the 400 that dropping
 * this step guarantees.
 */
export async function adaptMessagesForProfile<T extends AttachmentBearingMessage>(
  messages: T[],
  profile: ConnectionProfile,
  repos: unknown,
  userId: string,
  logContext: Record<string, unknown> = {}
): Promise<T[]> {
  const needsWork = messages.some(m =>
    (m.attachments ?? []).some(
      a => isLoadedAttachment(a) && needsFallbackProcessing(profile, a.mimeType)
    )
  )
  if (!needsWork) return messages

  logger.info('[Attachment] Re-deciding attachments for a substituted profile', {
    ...logContext,
    profileId: profile.id,
    profileName: profile.name,
    provider: profile.provider,
    modelName: profile.modelName,
  })

  const adapted: T[] = []
  for (const message of messages) {
    const attachments = message.attachments ?? []
    if (attachments.length === 0) {
      adapted.push(message)
      continue
    }

    const keep: unknown[] = []
    let prefix = ''

    for (const attachment of attachments) {
      if (!isLoadedAttachment(attachment)) {
        // Not ours to reason about — a caller's own shape. Leave it alone.
        keep.push(attachment)
        continue
      }
      if (!needsFallbackProcessing(profile, attachment.mimeType)) {
        keep.push(attachment)
        continue
      }

      try {
        const result = await processFileAttachmentFallback(
          {
            id: attachment.id,
            filepath: attachment.filepath ?? `/api/v1/files/${attachment.id}`,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            size: attachment.size,
          },
          attachment as never,
          profile,
          repos as never,
          userId,
        )
        prefix += formatFallbackAsMessagePrefix(result)
        // Mirror `loadAndProcessFiles`: the bytes ride along only when the
        // profile natively supports them, which `needsFallbackProcessing`
        // has already said it does not. Anything else here — a description,
        // inlined text, or a failed describe — replaces them.
      } catch (error) {
        prefix += `⚠️ Attachment Processing Failed: ${attachment.filename}\n${getErrorMessage(error)}\n\n`
        logger.warn('[Attachment] Re-decide failed for a substituted profile; dropping the attachment', {
          ...logContext,
          profileId: profile.id,
          attachmentId: attachment.id,
          mimeType: attachment.mimeType,
          error: getErrorMessage(error),
        })
      }
    }

    const next: T = { ...message, content: prefix + message.content }
    if (keep.length > 0) {
      next.attachments = keep
    } else {
      delete next.attachments
    }
    adapted.push(next)
  }

  return adapted
}
