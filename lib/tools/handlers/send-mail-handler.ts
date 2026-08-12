/**
 * Send Mail Tool Handler (The Post Office)
 *
 * Delivers a letter from the acting character into the recipient character's
 * vault `Mail/` folder. Calls the mailbox service helpers directly (no
 * `doc_*` tool dispatch). No "Sent" copy is written into the sender's vault —
 * by design, a character replies to letters it RECEIVED (which sit in its own
 * mailbox), not to letters it sent.
 *
 * All failure modes return an in-voice error string; the handler never throws
 * out to the tool executor for an expected condition.
 */

import { logger } from '@/lib/logger';
import { validateSendMailInput } from '../send-mail-tool';
import type { SendMailToolOutput } from '../send-mail-tool';
import { resolveCharacterByNameOrId } from '@/lib/services/character-resolver';
import { composeAndDeliverLetter } from '@/lib/post-office/deliver';
import { getRepositories } from '@/lib/repositories/factory';
import { docStoreUriFor } from '@/lib/doc-edit/uri-producers';

export type { SendMailToolOutput };

export interface SendMailToolContext {
  userId: string;
  chatId: string;
  /** The acting character (the sender). Required — only characters post mail. */
  characterId?: string | null;
  callingParticipantId?: string | null;
}

const moduleLogger = logger.child({ module: 'send-mail-handler' });

function fail(message: string): SendMailToolOutput {
  return { success: false, message, error: message };
}

export async function executeSendMailTool(
  input: unknown,
  context: SendMailToolContext,
): Promise<SendMailToolOutput> {
  try {
    const parsed = validateSendMailInput(input);
    if (!parsed) {
      return fail('A letter wants both a recipient and words; one or the other arrived missing.');
    }
    if (!context.characterId) {
      return fail('Only a character may post a letter, and no character holds this pen.');
    }

    const repos = getRepositories();
    const sender = await repos.characters.findByIdRaw(context.characterId);
    if (!sender) {
      return fail('The Post Office cannot find your own postbox; your character seems to have gone astray.');
    }
    if (sender.archivedAt) {
      return fail('That character is archived; rehydrate it to continue.');
    }

    const recipient = await resolveCharacterByNameOrId(context.userId, parsed.character);
    if (!recipient) {
      return fail('No soul by that name keeps a postbox here.');
    }
    if (recipient.archivedAt) {
      return fail('That recipient is archived; rehydrate them to continue.');
    }

    // Compose + deliver via the shared Post Office service (the same path the
    // Salon "Compose Mail" action uses), so the tool and the UI stay in lockstep.
    const result = await composeAndDeliverLetter({
      sender,
      recipient,
      message: parsed.message,
      inReplyTo: parsed.in_reply_to ?? null,
    });
    if (!result.ok) {
      return fail("That letter isn't in your own postbox, so there's nothing to reply to.");
    }

    // The confirmation describes the RECIPIENT's postbox, so address it with
    // the recipient store's qtap:// URI (its name, UUID fallback if ambiguous)
    // — never qtap://self/, which would name the sender's own vault. Falls back
    // to the raw path if the recipient's vault mount can't be resolved.
    let postboxRef = result.path;
    try {
      const recipientMountId = recipient.characterDocumentMountPointId;
      if (recipientMountId) {
        const mp = await getRepositories().docMountPoints.findById(recipientMountId);
        if (mp) {
          const uri = await docStoreUriFor({
            mountPointId: mp.id,
            mountPointName: mp.name,
            relativePath: result.path,
          });
          if (uri) postboxRef = uri;
        }
      }
    } catch {
      // Keep the raw path if anything goes sideways resolving the recipient vault.
    }

    return {
      success: true,
      message: `Suparṇā has the letter in hand and is already winging it to ${recipient.name}. It will rest in their postbox at ${postboxRef}.`,
      path: result.path,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unexpected error in send_mail handler';
    moduleLogger.error(
      'send_mail handler threw unexpectedly',
      { chatId: context.chatId },
      error instanceof Error ? error : undefined,
    );
    return fail(`The Post Office stumbled and the letter went unsent — ${msg}`);
  }
}

export function formatSendMailResults(output: SendMailToolOutput): string {
  return output.success ? output.message : output.error || output.message;
}
