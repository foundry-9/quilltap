/**
 * List Email Tool Handler (The Post Office)
 *
 * Lists the CALLER's own mailbox (and only its own — requirement: it never
 * reaches another character's postbox) and spells out the exact tool calls to
 * read, answer, or discard each letter. A missing/empty `Mail/` folder is not an
 * error — it reads as an empty postbox.
 */

import { logger } from '@/lib/logger';
import { validateListEmailInput } from '../list-email-tool';
import type { ListEmailToolOutput } from '../list-email-tool';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import { listMailbox } from '@/lib/post-office/mailbox';
import { formatLetterActions, formatLetterHeading } from '@/lib/post-office/instructions';
import { getRepositories } from '@/lib/repositories/factory';

export type { ListEmailToolOutput };

export interface ListEmailToolContext {
  userId: string;
  chatId: string;
  /** The acting character whose own mailbox is listed. */
  characterId?: string | null;
}

const moduleLogger = logger.child({ module: 'list-email-handler' });

const EMPTY_POSTBOX = 'Your postbox stands empty.';

function fail(message: string): ListEmailToolOutput {
  return { success: false, listing: message, count: 0, error: message };
}

export async function executeListEmailTool(
  input: unknown,
  context: ListEmailToolContext,
): Promise<ListEmailToolOutput> {
  try {
    const parsed = validateListEmailInput(input);
    if (!parsed) {
      return fail('That request to the Post Office made no sense.');
    }
    if (!context.characterId) {
      return fail('Only a character keeps a postbox, and no character holds this one.');
    }

    const repos = getRepositories();
    const me = await repos.characters.findByIdRaw(context.characterId);
    if (!me) {
      return fail('The Post Office cannot find your postbox; your character seems to have gone astray.');
    }
    if (me.archivedAt) {
      return fail('That character is archived; rehydrate it to continue.');
    }

    const { mountPointId: myVaultId } = await ensureCharacterVault(me);
    const letters = await listMailbox(myVaultId);

    if (letters.length === 0) {
      return { success: true, listing: EMPTY_POSTBOX, count: 0 };
    }

    const header =
      `Your postbox holds ${letters.length} letter${letters.length === 1 ? '' : 's'}, newest first. ` +
      `(Each letter shows its qtap://self/… URI; the "self" authority always addresses your own vault.)`;

    const blocks = letters.map(
      (letter, i) => `${formatLetterHeading(letter, i + 1)}\n${formatLetterActions(letter)}`,
    );

    return {
      success: true,
      listing: `${header}\n\n${blocks.join('\n\n')}`,
      count: letters.length,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unexpected error in list_email handler';
    moduleLogger.error(
      'list_email handler threw unexpectedly',
      { chatId: context.chatId },
      error instanceof Error ? error : undefined,
    );
    return fail(`The Post Office stumbled and couldn't sort your post — ${msg}`);
  }
}

export function formatListEmailResults(output: ListEmailToolOutput): string {
  return output.success ? output.listing : output.error || output.listing;
}
