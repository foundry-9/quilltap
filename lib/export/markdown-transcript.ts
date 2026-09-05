/**
 * Markdown transcript export.
 *
 * Renders a chat as a single, deterministic Markdown document — the readable
 * record of what was said, not a data interchange format (that's the .qtap /
 * SillyTavern exports) and not the pre-rendered HTML cache. Given the same
 * chat state it always produces byte-identical output: nothing here reads the
 * wall clock.
 *
 * What's included:
 * - The opening scenario (`chat.scenarioText`), when present.
 * - Every participant- and user-authored message (the active swipe of each
 *   swipe group — the same variant the Salon displays).
 * - Pascal roll announcements, Carina answers (including Brahma Console
 *   answers), user-authored announcements (Insert Announcement, whether
 *   voiced by a Staff member, a character, or a custom name), and the Host's
 *   continuation / merge notices that link a chat to the conversation it
 *   continues or absorbs.
 *
 * Everything else — SYSTEM/TOOL roles, Staff housekeeping chatter (memory
 * whispers, image announcements, time marks, …) — is left out. Prompts sent
 * to LLMs never appear.
 *
 * Each message renders under a `## Speaker — timestamp` heading. Timestamps
 * are the chat's own clock: fictional time when the chat runs one, otherwise
 * real time, both rendered in the chat's resolved timezone and configured
 * format. DATE_ONLY / TIME_ONLY formats are promoted to FRIENDLY — a
 * transcript needs both halves of the timestamp to stay readable.
 */

import {
  calculateTimestampAt,
  resolveTimezone,
  DEFAULT_TIMESTAMP_CONFIG,
} from '@/lib/chat/timestamp-utils';
import { staffDisplayName } from '@/lib/chat/staff-display-names';
import { processTemplate } from '@/lib/templates/processor';
import { BRAHMA_CARINA_ANSWERER_ID } from '@/lib/services/carina/brahma-answerer';
import type { ChatMetadata, ChatEvent, MessageEvent, ChatParticipant } from '@/lib/schemas/chat.types';
import type { TimestampConfig } from '@/lib/schemas/types';

/**
 * Host notices a reader needs: where the conversation came from or moved to,
 * and any mid-transcript revision of the scene. The header prints whatever
 * scene is in force at export time, so without the revision notices a reader
 * would see the story relocate with nothing to mark the move.
 */
const HOST_LINK_KINDS = new Set([
  'continuation-from',
  'continuation-to',
  'merge-from',
  'merge-to',
  'scenario-change',
]);

export interface MarkdownTranscriptInput {
  chat: ChatMetadata;
  /** Full event list from repos.chats.getMessages, already createdAt-ascending. */
  events: ChatEvent[];
  /** Character display names keyed by character id (participants, announcers, Carina answerers). */
  characterNamesById: Map<string, string>;
  /** The human operator's display name. */
  userName: string;
  /** Salon-level defaultTimestampConfig, used when the chat has no timestampConfig. */
  defaultTimestampConfig?: TimestampConfig | null;
  /** Salon-level timezone (chatSettings.timezone), second link of the resolveTimezone chain. */
  chatSettingsTimezone?: string | null;
}

/** True when the message belongs in the readable transcript. */
function isTranscriptMessage(msg: MessageEvent): boolean {
  if (msg.role === 'SYSTEM' || msg.role === 'TOOL') return false;
  if (msg.systemSender) {
    if (msg.systemSender === 'pascal' || msg.systemSender === 'carina') return true;
    if (msg.systemSender === 'host') return HOST_LINK_KINDS.has(msg.systemKind ?? '');
    // Other Staff messages only when the user authored them via Insert Announcement.
    return msg.systemKind === 'announcement';
  }
  return true;
}

/** Headings must stay on one line; names occasionally carry stray whitespace. */
function headingSafe(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

function resolveSpeakerName(
  msg: MessageEvent,
  participantsById: Map<string, ChatParticipant>,
  characterNamesById: Map<string, string>,
  userName: string,
  primaryCharacterName: string | undefined
): string {
  // Mirrors the Salon's getMessageAvatar precedence: customAnnouncer wins
  // over systemSender by construction (they are mutually exclusive).
  if (msg.customAnnouncer) {
    if (msg.customAnnouncer.kind === 'character' && msg.customAnnouncer.characterId) {
      return characterNamesById.get(msg.customAnnouncer.characterId) ?? 'Off-scene character';
    }
    return msg.customAnnouncer.displayName || 'Announcement';
  }

  if (msg.systemSender === 'carina') {
    const answererId = msg.carinaMeta?.answererId;
    if (answererId === BRAHMA_CARINA_ANSWERER_ID) return 'Brahma';
    if (answererId) {
      const name = characterNamesById.get(answererId);
      if (name) return name;
    }
    return 'Carina';
  }

  if (msg.systemSender) {
    return staffDisplayName(msg.systemSender);
  }

  if (msg.participantId) {
    const participant = participantsById.get(msg.participantId);
    if (participant) {
      const name = characterNamesById.get(participant.characterId);
      if (name) return name;
    }
  }

  if (msg.role === 'USER') return userName;
  return primaryCharacterName ?? 'Assistant';
}

/**
 * Collapse swipe groups to the variant the Salon displays: the highest
 * swipeIndex of each group, emitted at the group's chronological position.
 */
function collapseSwipes(messages: MessageEvent[]): MessageEvent[] {
  const bestByGroup = new Map<string, MessageEvent>();
  for (const msg of messages) {
    if (!msg.swipeGroupId) continue;
    const best = bestByGroup.get(msg.swipeGroupId);
    if (!best || (msg.swipeIndex ?? 0) > (best.swipeIndex ?? 0)) {
      bestByGroup.set(msg.swipeGroupId, msg);
    }
  }

  const emittedGroups = new Set<string>();
  const result: MessageEvent[] = [];
  for (const msg of messages) {
    if (!msg.swipeGroupId) {
      result.push(msg);
      continue;
    }
    if (emittedGroups.has(msg.swipeGroupId)) continue;
    emittedGroups.add(msg.swipeGroupId);
    result.push(bestByGroup.get(msg.swipeGroupId) ?? msg);
  }
  return result;
}

/** Build the whole transcript document. Pure and deterministic. */
export function buildMarkdownTranscript(input: MarkdownTranscriptInput): string {
  const { chat, events, characterNamesById, userName } = input;

  const config = chat.timestampConfig ?? input.defaultTimestampConfig ?? DEFAULT_TIMESTAMP_CONFIG;
  // DATE_ONLY / TIME_ONLY drop half the information a transcript needs.
  const effectiveConfig: TimestampConfig =
    config.format === 'DATE_ONLY' || config.format === 'TIME_ONLY'
      ? { ...config, format: 'FRIENDLY' }
      : config;
  const timezone = resolveTimezone(config.timezone, input.chatSettingsTimezone);
  const fallbackAnchor = new Date(chat.createdAt);

  const participantsById = new Map<string, ChatParticipant>(
    chat.participants.map((p) => [p.id, p])
  );
  const primaryParticipant = chat.participants.find((p) => p.type === 'CHARACTER');
  const primaryCharacterName = primaryParticipant
    ? characterNamesById.get(primaryParticipant.characterId)
    : undefined;

  const messages = collapseSwipes(
    events.filter((e): e is MessageEvent => e.type === 'message').filter(isTranscriptMessage)
  );

  const lines: string[] = [];
  lines.push(`# ${headingSafe(chat.title || 'Untitled Chat')}`);
  lines.push('');

  // Scenario text is stored with its template variables; render the names in.
  const scenario = chat.scenarioText
    ? processTemplate(chat.scenarioText, { char: primaryCharacterName, user: userName }).trim()
    : '';
  if (scenario) {
    lines.push('## Scenario');
    lines.push('');
    lines.push(scenario);
    lines.push('');
  }

  for (const msg of messages) {
    const speaker = headingSafe(
      resolveSpeakerName(msg, participantsById, characterNamesById, userName, primaryCharacterName)
    );
    const whisper =
      msg.targetParticipantIds && msg.targetParticipantIds.length > 0 ? ' (whisper)' : '';
    const { formatted } = calculateTimestampAt(
      new Date(msg.createdAt),
      effectiveConfig,
      timezone,
      fallbackAnchor
    );

    lines.push(`## ${speaker}${whisper} — ${formatted}`);
    lines.push('');
    const body = msg.content.trim();
    if (body) {
      lines.push(body);
      lines.push('');
    }
  }

  // Single trailing newline.
  return lines.join('\n').replace(/\n*$/, '\n');
}

/** Filesystem-safe download filename for a chat's transcript. */
export function transcriptFilename(chat: ChatMetadata): string {
  const base = (chat.title || 'chat').replace(/[<>:"|?*\x00-\x1f/\\]/g, '_').trim() || 'chat';
  return `${base}_transcript.md`;
}
