/**
 * Chat Type Definitions
 *
 * Contains schemas for chat messages, events, participants,
 * and chat metadata.
 *
 * @module schemas/chat.types
 */

import { z } from 'zod';
import {
  UUIDSchema,
  TimestampSchema,
  JsonSchema,
  RoleEnum,
} from './common.types';
import { TimestampConfigSchema } from './settings.types';
import { ControlledByEnum } from './character.types';

// ============================================================================
// DANGER FLAGS
// ============================================================================

export const DangerFlagSchema = z.object({
  /** Category of dangerous content detected (e.g., 'nsfw', 'violence', 'hate_speech') */
  category: z.string(),
  /** Confidence score from 0 to 1 */
  score: z.number().min(0).max(1),
  /** Whether the user has manually overridden this flag (marked as not dangerous) */
  userOverridden: z.boolean().default(false),
  /** Whether the message was rerouted to an uncensored provider */
  wasRerouted: z.boolean().default(false),
  /** Provider name if rerouted */
  reroutedProvider: z.string().nullable().optional(),
  /** Model name if rerouted */
  reroutedModel: z.string().nullable().optional(),
});

export type DangerFlag = z.infer<typeof DangerFlagSchema>;

// ============================================================================
// SCENE STATE
// ============================================================================

export const SceneStateCharacterSchema = z.object({
  characterId: z.string(),
  characterName: z.string(),
  action: z.string(),
  appearance: z.string().nullable(),
  clothing: z.string().nullable(),
  /**
   * Short hash of the equipped-outfit slots the concise `clothing` summary was
   * derived from. The scene-state tracker reuses the cached summary instead of
   * re-summarizing while this hash is unchanged (the outfit only changes on a
   * wardrobe edit), and the context manager compares it against the live
   * wardrobe to decide whether a mid-turn change warrants a fresh override.
   * Null when the character has no equipped wardrobe (clothing is
   * narrative-driven and re-derived every turn). Optional for backward
   * compatibility with scene states written before this field existed — a
   * missing hash simply forces a re-summarize on the next tracking run.
   */
  clothingHash: z.string().nullable().optional(),
});

export type SceneStateCharacter = z.infer<typeof SceneStateCharacterSchema>;

export const SceneStateSchema = z.object({
  location: z.string(),
  characters: z.array(SceneStateCharacterSchema),
  updatedAt: TimestampSchema,
  updatedAtMessageCount: z.number(),
});

export type SceneState = z.infer<typeof SceneStateSchema>;

// ============================================================================
// CHAT TYPE
// ============================================================================

export const ChatTypeEnum = z.enum(['salon', 'help', 'autonomous', 'brahma']);
export type ChatType = z.infer<typeof ChatTypeEnum>;

/**
 * Chat types that are "help-like" for titling and summarization: they get
 * lightweight auto-retitling at the earliest interchange, skip story-background
 * generation, and never run the autonomous-room machinery. The Brahma Console
 * (`'brahma'`) joins the Help Chat (`'help'`) here — both are floating,
 * stripped-down chat surfaces, distinct from the Salon and from autonomous
 * rooms. (Memory extraction is governed separately: 'help' opts in, 'brahma'
 * never does. This predicate is ONLY about titling/summary routing.)
 */
export function isHelpLikeChatType(chatType: string | null | undefined): boolean {
  return chatType === 'help' || chatType === 'brahma';
}

/**
 * Chat types that are exempt from dangerous-content moderation entirely: the
 * Concierge never classifies, flags, reroutes, or announces on them. These are
 * utility surfaces rather than roleplay — the Help Chat (`'help'`) and the
 * Brahma Console (`'brahma'`). Moderation applies only to the Salon
 * (`'salon'`) and autonomous rooms (`'autonomous'`).
 *
 * Deliberately separate from `isHelpLikeChatType`: that predicate governs
 * titling/summary routing, and moderation policy must be free to diverge from
 * it. The two covering the same set today is a coincidence, not a contract.
 */
export function isModerationExemptChatType(chatType: string | null | undefined): boolean {
  return chatType === 'help' || chatType === 'brahma';
}

// ============================================================================
// AUTONOMOUS-ROOM RUN STATE
// ============================================================================

export const AutonomousRunStateEnum = z.enum([
  'idle',
  'running',
  'paused',
  'stopped',
  'budgetExhausted',
  'error',
]);
export type AutonomousRunState = z.infer<typeof AutonomousRunStateEnum>;

export const AutonomousRunVisibilityEnum = z.enum(['owner_only', 'household', 'open']);
export type AutonomousRunVisibility = z.infer<typeof AutonomousRunVisibilityEnum>;

// ============================================================================
// MESSAGE EVENTS
// ============================================================================

/**
 * One positioned reasoning / chain-of-thought block on an assistant message.
 * DISPLAY ONLY — see `reasoningSegments` on the message schema. Mirrors how
 * tool calls carry an `anchorOffset`; `seq` is shared with tool anchors so
 * same-offset items render in true emission order.
 */
export const ReasoningSegmentSchema = z.object({
  anchorOffset: z.number(),
  content: z.string(),
  seq: z.number(),
});
export type ReasoningSegment = z.infer<typeof ReasoningSegmentSchema>;

/**
 * The personified features ("the Staff") that may author a message in lieu of a
 * participant. THE authoritative list — adding a member means extending this
 * enum, the matching `chat_messages` column, the `getMessageAvatar` branch, the
 * display-name table in `lib/chat/staff-display-names.ts`, and the value list in
 * `public/schemas/qtap-export.schema.json`. Per-member responsibilities are
 * documented on `MessageEventSchema.systemSender` below.
 */
export const SystemSenderEnum = z.enum([
  'lantern',
  'aurora',
  'librarian',
  'concierge',
  'prospero',
  'host',
  'commonplaceBook',
  'ariel',
  'carina',
  'suparna',
  'pascal',
]);
export type SystemSender = z.infer<typeof SystemSenderEnum>;

export const MessageEventSchema = z.object({
  type: z.literal('message'),
  id: UUIDSchema,
  role: RoleEnum,
  content: z.string(),
  rawResponse: JsonSchema.nullable().optional(),
  tokenCount: z.number().nullable().optional(),
  /** Input/prompt tokens for this message */
  promptTokens: z.number().nullable().optional(),
  /** Output/completion tokens for this message */
  completionTokens: z.number().nullable().optional(),
  swipeGroupId: z.string().nullable().optional(),
  swipeIndex: z.number().nullable().optional(),
  attachments: z.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
  // Debug: Memory extraction logs (Sprint 6)
  debugMemoryLogs: z.array(z.string()).nullable().optional(),
  // Google Gemini thought signature for thinking models (e.g., gemini-3-pro)
  // Must be preserved and passed back for multi-turn conversations with function calling
  thoughtSignature: z.string().nullable().optional(),
  /**
   * Reasoning / chain-of-thought text from thinking models, captured for
   * DISPLAY ONLY. The full concatenated reasoning for the turn. Never re-fed to
   * any model as history/summary/memory — the only in-request reuse is the
   * in-turn tool round-trip, which uses an in-memory value, not this column.
   */
  reasoningContent: z.string().nullable().optional(),
  /**
   * Positioned reasoning blocks (DISPLAY ONLY) used by the Salon to splice
   * thinking into the prose at the point it fired, the same way tool calls are
   * anchored. `anchorOffset` is the prose offset; `seq` is the turn-monotonic
   * counter shared with tool anchors for stable same-offset ordering.
   */
  reasoningSegments: ReasoningSegmentSchema.array().nullable().optional(),
  // Multi-character chat: which participant sent this message
  participantId: UUIDSchema.nullable().optional(),
  // Recovery type: indicates this message was generated as an error recovery response
  // 'token_limit' = LLM-generated recovery response for token limit errors
  // 'token_limit_static' = Static fallback message when LLM recovery also failed
  // 'content_limit' = LLM-generated recovery response for content limit errors (PDF pages, etc.)
  // 'content_limit_static' = Static fallback message when LLM recovery for content limit also failed
  recoveryType: z.enum(['token_limit', 'token_limit_static', 'content_limit', 'content_limit_static']).nullable().optional(),
  // Server-side pre-rendered HTML for simple messages (no tools, no attachments)
  // Used to avoid client-side markdown processing overhead on chat load
  renderedHtml: z.string().nullable().optional(),
  // Danger content flags from gatekeeper classification
  dangerFlags: z.array(DangerFlagSchema).nullable().optional(),
  /** Provider that generated this message (e.g., 'openai', 'anthropic') */
  provider: z.string().nullable().optional(),
  /** Model name that generated this message (e.g., 'gpt-4o', 'claude-sonnet-4-20250514') */
  modelName: z.string().nullable().optional(),
  /**
   * Answer-confirmation result. true = consistent (or successfully revised),
   * false = character affirmed a flagged answer unchanged, null = the check
   * could not run (error/timeout) or was not applicable (e.g. a user-driven
   * turn, where the system cannot vouch for out-of-band sourcing). undefined =
   * the feature was off / there was nothing to check (no field written).
   */
  confirmed: z.boolean().nullable().optional(),
  /** Whether a confirmation check actually ran for this message. Distinguishes a
   *  persisted "unverified" (`confirmed:null`, but checked) from "never checked"
   *  (no fields) — both of which store as SQL NULL for `confirmed`, so the
   *  boolean here is what survives a reload to keep the "Unvetted" badge. */
  confirmationChecked: z.boolean().nullable().optional(),
  /** Whether the shown `content` is a re-affirmation rewrite of the original. */
  confirmationRevised: z.boolean().nullable().optional(),
  /** The cheap-LLM discrepancy explanation (what looked inconsistent). Surfaced
   *  on the badge hover; null when confirmed:true on the first pass or not applicable. */
  confirmationNotes: z.string().nullable().optional(),
  /** The character's original pre-revision text, retained for the logs when
   *  `confirmationRevised` is true. Null otherwise. */
  confirmationOriginalContent: z.string().nullable().optional(),
  /** Target participant IDs for whisper messages (null = public message, array = private to sender and targets) */
  targetParticipantIds: z.array(UUIDSchema).nullable().optional(),
  /** Whether this message was generated while the character was in silent mode */
  isSilentMessage: z.boolean().nullable().optional(),
  /** Identifies a personified feature ("the Staff") that authored this message in lieu of a participant. 'lantern' = Lantern image announcements; 'aurora' = character-avatar refreshes; 'librarian' = Document Mode open/save announcements; 'concierge' = dangerous-content classification announcements; 'prospero' = agent / connection-profile change announcements; 'host' = Salon participation announcements; 'commonplaceBook' = memory recall whispers (recap, relevant memories, inter-character memories); 'ariel' = terminal session announcements (PTY open/close); 'carina' = inline-query reference answers (Carina); 'suparna' = Suparṇā's Post Office mail-delivery announcements (new letters arrived in the character's vault Mail/ folder); 'pascal' = Pascal the Croupier's custom-tool (pseudo-tool) roll outcomes, posted server-side so a model cannot fudge a failure into a success. Note: a 'carina' message renders with the ANSWERER character's own avatar (resolved via `carinaMeta.answererId`), not a dedicated Staff avatar — the tag exists for memory suppression and the compact reference-card UI hook. */
  systemSender: SystemSenderEnum.nullable().optional(),
  /**
   * Neutral, persona-free rewrite of `content` for Staff-authored messages
   * (systemSender != null). When the chat has any non-user-character
   * participant whose `systemTransparency !== true`, the context-builder swaps
   * `content` → `opaqueContent ?? content` in every character's LLM context so
   * the Staff names ("The Host", "Aurora", "Prospero", …) never reach an
   * opaque character. The user character does NOT count toward the test —
   * they stay "transparent by default". The human user's transcript / UI is
   * unaffected; it always reads `content` with its full persona voicing.
   *
   * Writers populate this in lockstep with `content`. NULL on
   * participant-authored messages and on legacy Staff messages written before
   * the dual-body migration (in which case the swap falls through to
   * `content`).
   */
  opaqueContent: z.string().nullable().optional(),
  /**
   * Sub-classification of a Staff-authored message — used by the Salon UI to
   * label collapsed system-message bars (e.g. `timestamp`, `project-context`,
   * `memory-recap`). Always paired with `systemSender`; null on
   * participant-authored messages. Each writer chooses a stable kebab-case
   * label per emission path.
   */
  systemKind: z.string().nullable().optional(),
  /**
   * Structured payload on Host announcements (`systemSender = 'host'`).
   *
   * Two shapes share this field today; both are optional and any combination
   * is permitted, but in practice each announcement uses exactly one:
   *
   * - **Presence transitions** (`systemKind` = add / remove / status-change):
   *   `participantId` + `toStatus` carry the affected participant and the
   *   status they were transitioning to. Consumed by the per-character
   *   Librarian summary pipeline to compute presence windows.
   * - **Off-scene character introductions** (`systemKind` =
   *   `off-scene-characters`): `introducedCharacterIds` carries the workspace
   *   character IDs the Host introduced in this announcement. Consumed by the
   *   context builder to skip re-introducing the same characters on later
   *   turns.
   *
   * NULL on Host announcements with no structured payload (scenario, roster,
   * timestamp, silent-mode, join-scenario, no-user-character) and on every
   * non-Host message.
   */
  hostEvent: z.object({
    participantId: UUIDSchema.optional(),
    toStatus: z.enum(['active', 'silent', 'absent', 'removed']).optional(),
    introducedCharacterIds: z.array(UUIDSchema).optional(),
  }).nullable().optional(),
  /**
   * Phase 3c: anchor tying a Staff-authored whisper to the compaction
   * generation under which it was produced. Today this is set on Librarian
   * per-character summary whispers so the summarization pipeline can sweep
   * stale anchors deterministically when `compactionGeneration` bumps —
   * instead of the prior content-prefix sweep, which couldn't distinguish
   * whispers that legitimately span generation boundaries.
   *
   * NULL on whispers from before the anchoring change (and on every
   * non-anchorable message). The sweep treats null as "older than current
   * generation" so legacy whispers continue to be removed on regen.
   */
  summaryAnchor: z.object({
    compactionGeneration: z.number(),
  }).nullable().optional(),
  /**
   * Ad-hoc announcer metadata for user-authored announcement bubbles
   * (Insert Announcement composer button). Mutually exclusive with
   * `systemSender`: when this is set, the message renders with the named
   * character or custom display name in lieu of any Staff member.
   *
   * - `kind: 'character'` → `characterId` references a workspace character
   *   who is not a participant in this chat. The renderer resolves the
   *   character's avatar/name via the off-scene character lookup attached
   *   to the chat payload.
   * - `kind: 'custom'` → `displayName` is the free-text label shown next
   *   to a placeholder avatar.
   *
   * NULL on every other message.
   */
  customAnnouncer: z.object({
    kind: z.enum(['character', 'custom']),
    characterId: UUIDSchema.nullable().optional(),
    displayName: z.string().nullable().optional(),
  }).nullable().optional(),
  /**
   * Carina (inline LLM queries) provenance, set on `systemSender = 'carina'`
   * messages. `answererId` is the workspace character id of the answerer — it
   * drives (1) avatar resolution (the Salon renders the Carina reply with the
   * answerer's own avatar, looking them up among participants or the chat's
   * off-scene character cards), and (2) "prior Carina exchanges" continuity (the
   * service replays earlier `answererId`-matched exchanges as Q/A pairs so
   * follow-up questions have context, WITHOUT pulling in the full chat history).
   * `question` is the verbatim text that was asked, stored so those Q/A pairs
   * can be reconstructed. NULL on every non-Carina message.
   */
  carinaMeta: z.object({
    answererId: UUIDSchema,
    question: z.string(),
  }).nullable().optional(),
  /**
   * Pascal the Croupier (custom pseudo-tools) roll record, set on
   * `systemSender = 'pascal'` messages. The whole point of the column is that
   * the *server* rolled and the *server* chose the outcome: the model asked for
   * `tool` with `params` and got back whatever the table dealt, so nothing here
   * is a model's account of its own luck.
   *
   * `definitionTier` / `definitionMountId` record which store the definition was
   * resolved from (tiers shadow one another, so the same tool name can mean
   * different things in different rooms). `rollForm` says which roll shape ran:
   * 'range' (uniform, optionally transformed) or 'dice' (`notation` + the
   * individual `diceRolls`). `raw` is the untransformed roll; `value` is what
   * the outcome table was tested against; `outcomeIndex` names the winning
   * entry and `state` its semantic verdict. `metadataTested` records the
   * invoking character's metadata as the winning row read it. `invokedBy`
   * distinguishes a model's reach for the tool from a user's own Run-Tool, and
   * `callerParticipantId` names the participant who rolled, when there was one.
   *
   * NULL on every non-Pascal message.
   */
  pascalMeta: z.object({
    tool: z.string(),
    /**
     * The tool's display title at the moment it ran (`displayTitle()`), so the
     * Salon can label the outcome with the tool rather than a generic "roll
     * outcome". Optional: messages posted before this field existed have none,
     * and the UI falls back to `tool` — the declaration name, which is the
     * identity and always present.
     */
    toolTitle: z.string().optional(),
    definitionTier: z.enum(['character', 'participant', 'group', 'project', 'global']),
    definitionMountId: z.string(),
    params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
    rollForm: z.enum(['range', 'dice']),
    notation: z.string().optional(),
    raw: z.number(),
    diceRolls: z.array(z.number()).optional(),
    value: z.number(),
    state: z.enum(['success', 'partial', 'failure', 'info']),
    outcomeIndex: z.number(),
    /**
     * The metadata keys the winning outcome consulted, and what the invoking
     * character's `metadata.json` held for them at the moment of the roll — so
     * the transcript records what the table actually saw rather than requiring
     * a reader to guess at a fact sheet that has since been edited. Only the
     * keys that row tested, primitives only; absent when it tested none.
     */
    metadataTested: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
    /**
     * The LLM consult, when the definition declared one: what was asked
     * (`prompt`, fully rendered), whether it was answered (`ok`), and the
     * `output` the table tested — the model's trimmed answer, or the author's
     * `errorMessage` when the consult failed. `reason` is the technical
     * failure cause, recorded here for the operator and never spoken in the
     * fiction. Absent on tools with no `llm` block.
     */
    llm: z.object({
      ok: z.boolean(),
      output: z.string(),
      prompt: z.string(),
      reason: z.string().optional(),
      provider: z.string().optional(),
      model: z.string().optional(),
    }).optional(),
    invokedBy: z.enum(['llm', 'user']),
    callerParticipantId: UUIDSchema.optional(),
  }).nullable().optional(),
  /**
   * The Courier: when non-null, this message is a placeholder for a manual /
   * clipboard turn awaiting a pasted reply. The string is the Markdown blob
   * the user must copy out, carry to an external LLM, and paste the reply
   * back in. When delta mode is active, this is the *delta* bundle; the full
   * fallback lives in `pendingExternalPromptFull`. `content` is empty until
   * the paste resolves; on resolve, all pending fields are cleared and
   * `content` carries the reply.
   */
  pendingExternalPrompt: z.string().nullable().optional(),
  /**
   * The Courier — full-context fallback bundle. Populated alongside
   * `pendingExternalPrompt` when delta mode rendered a delta, so the Salon
   * bubble can offer a "Use full context" toggle (e.g. if the user switched
   * LLM clients or cleared their desktop conversation and needs to
   * re-establish). Null when delta mode wasn't applicable.
   */
  pendingExternalPromptFull: z.string().nullable().optional(),
  /**
   * Attachments referenced by a pending Courier turn — surfaced as download
   * links in the Salon bubble so the user can re-upload them in their
   * destination client. Cleared when the paste resolves. When both delta
   * and full bundles are present, this is the union (so the user has access
   * to every file regardless of which bundle they paste).
   */
  pendingExternalAttachments: z.array(z.object({
    fileId: UUIDSchema,
    filename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
    downloadUrl: z.string(),
  })).nullable().optional(),
});

export type MessageEvent = z.infer<typeof MessageEventSchema>;

export const ContextSummaryEventSchema = z.object({
  type: z.literal('context-summary'),
  id: UUIDSchema,
  context: z.string(),
  createdAt: TimestampSchema,
});

export type ContextSummaryEvent = z.infer<typeof ContextSummaryEventSchema>;

// ============================================================================
// SYSTEM EVENTS (Cheap LLM Operations)
// ============================================================================

export const SystemEventTypeEnum = z.enum([
  'MEMORY_EXTRACTION',
  'SUMMARIZATION',
  'TITLE_GENERATION',
  'CONTEXT_SUMMARY',
  'IMAGE_PROMPT_CRAFTING',
  'CONTEXT_COMPRESSION',
  'DANGER_CLASSIFICATION',
  'SCENE_STATE_TRACKING',
  'STATUS_CHANGE',
]);

export type SystemEventType = z.infer<typeof SystemEventTypeEnum>;

export const SystemEventSchema = z.object({
  type: z.literal('system'),
  id: UUIDSchema,
  /** Type of system operation */
  systemEventType: SystemEventTypeEnum,
  /** Human-readable description of what the system did */
  description: z.string(),
  /** Input/prompt tokens used for this operation */
  promptTokens: z.number().nullable().optional(),
  /** Output/completion tokens used for this operation */
  completionTokens: z.number().nullable().optional(),
  /** Total tokens used (promptTokens + completionTokens) */
  totalTokens: z.number().nullable().optional(),
  /** Provider used for this operation */
  provider: z.string().nullable().optional(),
  /** Model name used for this operation */
  modelName: z.string().nullable().optional(),
  /** Estimated cost in USD for this operation */
  estimatedCostUSD: z.number().nullable().optional(),
  createdAt: TimestampSchema,
});

export type SystemEvent = z.infer<typeof SystemEventSchema>;

export const ChatEventSchema = z.union([
  MessageEventSchema,
  ContextSummaryEventSchema,
  SystemEventSchema,
]);

export type ChatEvent = z.infer<typeof ChatEventSchema>;

// ============================================================================
// CHAT PARTICIPANTS
// ============================================================================

export const ParticipantTypeEnum = z.enum(['CHARACTER']);
export type ParticipantType = z.infer<typeof ParticipantTypeEnum>;

// ============================================================================
// PARTICIPANT STATUS
// ============================================================================

/**
 * Four-state participation model for characters in a chat:
 * - active: Present and participating normally (speaks and roleplays)
 * - silent: Gets turns, but must not speak aloud. May have inner thoughts,
 *           physical reactions, and actions — but no audible dialogue.
 * - absent: Turn manager skips them. Still "in" the chat but away from the scene.
 * - removed: No longer part of the chat. Cannot be whispered to, unaware of
 *            events after leaving.
 */
export const ParticipantStatusEnum = z.enum(['active', 'silent', 'absent', 'removed']);
export type ParticipantStatus = z.infer<typeof ParticipantStatusEnum>;

/**
 * Check if a participant is present in the scene (active or silent).
 * Both states participate in turns and can perceive what happens.
 */
export function isParticipantPresent(status: ParticipantStatus): boolean {
  return status === 'active' || status === 'silent';
}

/**
 * Check if a participant can receive whispers (must be present).
 */
export function canReceiveWhisper(status: ParticipantStatus): boolean {
  return status === 'active' || status === 'silent';
}

/**
 * Convert legacy isActive/removedAt to the new status enum.
 * Used during migration and for backward compatibility.
 */
export function migrateIsActiveToStatus(isActive: boolean, removedAt?: string | null): ParticipantStatus {
  if (isActive) return 'active';
  if (removedAt) return 'removed';
  return 'absent';
}

export const ChatParticipantSchema = z.object({
  id: UUIDSchema,

  // Participant type and identity
  type: ParticipantTypeEnum,
  characterId: UUIDSchema,  // Required for all participants

  // Control mode - who controls this participant in this chat
  // 'llm' = AI-controlled, 'user' = player-controlled (impersonating)
  // Optional for backwards compatibility - defaults to 'llm' for existing participants
  controlledBy: ControlledByEnum.optional().default('llm'),

  // LLM configuration (for AI characters only, ignored when controlledBy is 'user')
  connectionProfileId: UUIDSchema.nullable().optional(),  // Required for LLM control, null for user control
  imageProfileId: UUIDSchema.nullable().optional(),       // Image generation profile
  roleplayTemplateId: z.string().nullable().optional(),   // Roleplay template override

  // Per-chat customization
  selectedSystemPromptId: UUIDSchema.nullable().optional(),  // Selected system prompt from character's prompts array

  // Display and state
  displayOrder: z.number().default(0),   // For ordering in UI
  /** @deprecated Use `status` field instead. Kept as computed compat field (true when status is active or silent). */
  isActive: z.boolean().default(true),
  /** Participation status: active, silent, absent, or removed */
  status: ParticipantStatusEnum.default('active'),
  removedAt: TimestampSchema.nullable().optional(),  // Soft-delete timestamp — set when participant is removed from chat

  // Multi-character chat fields
  hasHistoryAccess: z.boolean().default(false),  // Whether this participant can see messages from before they joined
  joinScenario: z.string().nullable().optional(), // Custom scenario text for how they joined the chat

  // Per-chat talkativeness override. When null/undefined, the turn manager
  // falls back to the underlying character's talkativeness. Lets a chat
  // boost a normally-quiet character (or vice versa) without editing the
  // character record.
  talkativeness: z.number().min(0.1).max(1.0).nullable().optional(),

  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).refine(
  (data) => data.characterId != null,
  {
      error: 'Participants must have characterId'
}
);

export type ChatParticipant = z.infer<typeof ChatParticipantSchema>;

// Schema without refinements for internal use (e.g., parsing before validation)
export const ChatParticipantBaseSchema = z.object({
  id: UUIDSchema,
  type: ParticipantTypeEnum,
  characterId: UUIDSchema,
  controlledBy: ControlledByEnum.optional().default('llm'),  // Who controls: 'llm' or 'user'
  connectionProfileId: UUIDSchema.nullable().optional(),
  imageProfileId: UUIDSchema.nullable().optional(),
  roleplayTemplateId: z.string().nullable().optional(),  // Roleplay template override
  selectedSystemPromptId: UUIDSchema.nullable().optional(),  // Selected system prompt from character's prompts array
  displayOrder: z.number().default(0),
  /** @deprecated Use `status` field instead. Kept as computed compat field (true when status is active or silent). */
  isActive: z.boolean().default(true),
  /** Participation status: active, silent, absent, or removed */
  status: ParticipantStatusEnum.default('active'),
  removedAt: TimestampSchema.nullable().optional(),  // Soft-delete timestamp
  hasHistoryAccess: z.boolean().default(false),
  joinScenario: z.string().nullable().optional(),
  // Per-chat talkativeness override. Null/undefined → inherit from character.
  talkativeness: z.number().min(0.1).max(1.0).nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ChatParticipantBase = z.infer<typeof ChatParticipantBaseSchema>;

// Input type for creating chat participants - makes fields with defaults optional
export type ChatParticipantBaseInput = z.input<typeof ChatParticipantBaseSchema>;

// ============================================================================
// CHAT METADATA
// ============================================================================

export const ChatMetadataSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,

  // Participants array (replaces characterId, personaId, connectionProfileId, imageProfileId)
  participants: z.array(ChatParticipantBaseSchema).default([]),

  title: z.string(),
  contextSummary: z.string().nullable().optional(),
  sillyTavernMetadata: JsonSchema.nullable().optional(),
  tags: z.array(UUIDSchema).default([]),
  /** Roleplay template for this chat - can be UUID or 'plugin:*' format */
  roleplayTemplateId: z.string().nullable().optional(),
  /** Timestamp configuration for this chat (overrides user default) */
  timestampConfig: TimestampConfigSchema.nullable().optional(),
  /** Last participant whose turn it was (null = user's turn). Used to restore turn state when returning to chat. */
  lastTurnParticipantId: UUIDSchema.nullable().optional(),
  messageCount: z.number().default(0),
  lastMessageAt: TimestampSchema.nullable().optional(),
  lastRenameCheckInterchange: z.number().default(0),
  /**
   * Monotonic counter bumped on every summarization fire (T_soft or T_hard).
   * Used by Phase 3 to anchor memory pools and per-character whispers — when
   * this number changes, downstream caches know to invalidate.
   */
  compactionGeneration: z.number().default(0),
  /** Interchange count when the last summarization fire happened. Drives T_soft. */
  lastSummaryTurn: z.number().default(0),
  /** Rolling-buffer token count when the last summarization fire happened. Drives T_soft. */
  lastSummaryTokens: z.number().default(0),
  /** Interchange count when the last full-from-scratch rebuild happened. Drives T_hard. */
  lastFullRebuildTurn: z.number().default(0),
  /**
   * Phase 4: list of conversation message IDs (USER + ASSISTANT) that fed
   * the current `contextSummary`. Used by the edit/delete invalidation hook
   * to clear the summary only when a covered message changes — typo fixes
   * on a message that arrived after the last summary leave the summary
   * intact.
   */
  summaryAnchorMessageIds: z.array(UUIDSchema).default([]),
  /** Whether auto-responses are paused in multi-character chats */
  isPaused: z.boolean().default(false),
  /** Whether the user has manually renamed this chat (disables auto-renaming) */
  isManuallyRenamed: z.boolean().default(false),

  // Impersonation state - for when user temporarily takes control of characters
  /** Array of participant IDs the user is currently impersonating (can be multiple) */
  impersonatingParticipantIds: z.array(UUIDSchema).default([]),
  /** Which impersonated participant is currently "active" for typing (user switches between controlled characters) */
  activeTypingParticipantId: UUIDSchema.nullable().optional(),
  /** Turns since last user input or pause (for all-LLM pause logic) */
  allLLMPauseTurnCount: z.number().default(0),
  /** Server-side turn queue for chained responses (JSON array of participant IDs) */
  turnQueue: z.string().default('[]'),
  /**
   * Participants (LLM + user) who have spoken in the current rotation cycle.
   * Stored as a JSON array of participant IDs. The turn manager refuses to
   * pick anyone in this list again until the cycle wraps (i.e. everyone has
   * spoken at least once). Cleared automatically when the cycle completes.
   */
  spokenThisCycleParticipantIds: z.string().default('[]'),

  /** Whether composition mode is enabled (Enter = newline, Ctrl/Cmd+Enter = submit) */
  documentEditingMode: z.boolean().default(false),

  /** Document Mode layout state: normal (chat only), split (chat + document), focus (document only) */
  documentMode: z.enum(['normal', 'split', 'focus']).default('normal'),

  /** Divider position for split mode as percentage of main area width (20-80) */
  dividerPosition: z.number().min(20).max(80).default(45),

  /** Terminal Mode layout state: normal (chat only), split (chat + terminal), focus (terminal only) */
  terminalMode: z.enum(['normal', 'split', 'focus']).default('normal'),

  /** Active terminal session shown in Terminal Mode pane (null = no session bound) */
  activeTerminalSessionId: UUIDSchema.nullable().optional(),

  /** Vertical divider position (%) for the right-pane split when both Document and Terminal Modes are active (20-80) */
  rightPaneVerticalSplit: z.number().min(20).max(80).default(50),

  /** Project this chat belongs to (optional) */
  projectId: UUIDSchema.nullable().optional(),

  /** Resolved scenario text selected at chat creation (preset or custom) */
  scenarioText: z.string().nullable().optional(),

  // Token usage tracking (aggregate totals for this chat)
  /** Total prompt/input tokens used in this chat */
  totalPromptTokens: z.number().default(0),
  /** Total completion/output tokens used in this chat */
  totalCompletionTokens: z.number().default(0),
  /** Estimated total cost in USD for this chat */
  estimatedCostUSD: z.number().nullable().optional(),
  /** Source of pricing data for cost estimate */
  priceSource: z.enum(['openrouter', 'registry', 'fallback', 'openrouter-estimate', 'unavailable']).nullable().optional(),
  /** Per-chat override for showing system events (null = use global setting) */
  showSystemEventsOverride: z.boolean().nullable().optional(),

  /** Flag set when AI calls request_full_context tool - bypasses compression on next message */
  requestFullContextOnNextMessage: z.boolean().default(false),

  /** List of tool IDs that are disabled for this chat (empty = all enabled) */
  disabledTools: z.array(z.string()).default([]),

  /** Groups of tools that are disabled (e.g., "plugin:mcp", "plugin:mcp:subgroup:filesystem") */
  disabledToolGroups: z.array(z.string()).default([]),

  /** Flag to trigger tool change notification on next message (set when tool settings change) */
  forceToolsOnNextMessage: z.boolean().default(false),

  /**
   * When true, characters in this chat may read (read-only) the character vaults
   * belonging to other present participants via the `doc_*` tools. Writes remain
   * scoped to the acting character's own vault. Defaults to false.
   */
  allowCrossCharacterVaultReads: z.boolean().default(false),

  /** Pending outfit change notifications keyed by characterId, cleared after delivery */
  pendingOutfitNotifications: JsonSchema.nullable().optional(),

  /** Persistent JSON state for games, inventory, session data, etc. */
  state: JsonSchema.default({}),

  /** Cached compression result for context compression (persisted across restarts) */
  compressionCache: JsonSchema.nullable().optional(),

  /** Whether agent mode is enabled for this chat (null = inherit from project/character/global) */
  agentModeEnabled: z.boolean().nullable().optional(),

  /** Current agent turn count within the current message processing (resets on new user message) */
  agentTurnCount: z.number().default(0),

  /** Story background image file ID (from file system) */
  storyBackgroundImageId: UUIDSchema.nullable().optional(),
  /** When the story background was last generated */
  lastBackgroundGeneratedAt: TimestampSchema.nullable().optional(),

  /** Image generation profile for this chat (shared by all participants) */
  imageProfileId: UUIDSchema.nullable().optional(),

  /** When an image is generated in this chat, inject an assistant message announcing it (null = inherit from project/global) */
  alertCharactersOfLanternImages: z.boolean().nullable().optional(),

  /** Whether this chat has been classified as dangerous (null = not yet classified) */
  isDangerousChat: z.boolean().nullable().optional(),
  /** Overall danger score for this chat (0-1), null = not yet classified */
  dangerScore: z.number().min(0).max(1).nullable().optional(),
  /** Categories of dangerous content detected at chat level (JSON array of strings) */
  dangerCategories: z.array(z.string()).default([]),
  /** When the chat danger classification last ran */
  dangerClassifiedAt: TimestampSchema.nullable().optional(),
  /** Message count at which danger was last classified (to detect changes for re-check) */
  dangerClassifiedAtMessageCount: z.number().nullable().optional(),
  /**
   * Per-chat Concierge mode override. NULL means follow the global Concierge
   * setting and let `isDangerousChat` decide Safe vs Flagged. 'OFF' disables
   * every Concierge effect for this chat: no classification, no scanning, no
   * uncensored-provider reroute, no synthetic Concierge messages. Operators
   * who flip this on accept the risk of provider refusals.
   */
  conciergeOverride: z.enum(['OFF']).nullable().optional(),

  /**
   * Per-chat answer-confirmation override. NULL means inherit (from the chat's
   * project override, then the global setting). 'ON' forces the consistency
   * check on for this chat; 'OFF' forces it off. See
   * `isAnswerConfirmationActive`.
   */
  answerConfirmationOverride: z.enum(['ON', 'OFF']).nullable().optional(),

  /** Scene state tracker: structured summary of current scene (location, character actions, appearance, clothing) */
  sceneState: JsonSchema.nullable().optional(),

  /** Scriptorium: deterministic Markdown rendering of the full conversation */
  renderedMarkdown: z.string().nullable().optional(),

  /** Equipped outfit state per character: { [characterId]: { top, bottom, footwear, accessories } } */
  equippedOutfit: JsonSchema.nullable().optional(),

  /** Per-character generated avatars reflecting current outfit: { [characterId]: { imageId, generatedAt, afterMessageCount } } */
  characterAvatars: JsonSchema.nullable().optional(),

  /** Whether to auto-generate character avatars when outfits change (null = disabled) */
  avatarGenerationEnabled: z.boolean().nullable().optional(),

  /** Chat type discriminator: 'salon' for regular chats, 'help' for help assistant chats, 'autonomous' for character-to-character private rooms, 'brahma' for Brahma Console (character-less generic-LLM) chats */
  chatType: ChatTypeEnum.default('salon'),
  /** For help chats: the current page URL being viewed (for context resolution) */
  helpPageUrl: z.string().nullable().optional(),
  /**
   * For Brahma Console chats (`chatType === 'brahma'`): the connection profile
   * (model) the console is currently talking to. A Brahma chat has exactly one
   * model at a time; switching the model PATCHes this column and the same chat
   * continues with the new engine from that point forward. Seeded from the
   * user's default connection profile at creation. NULL on every other chat
   * type.
   */
  consoleConnectionProfileId: UUIDSchema.nullable().optional(),

  /**
   * Phase H: precompiled per-participant identity stack — the character-static
   * portion of the system prompt (identity preamble, base prompt, manifesto,
   * personality, aliases, pronouns, physical descriptions, example dialogues), with
   * templates ({{user}}, {{scenario}}, {{persona}}) resolved at compile time.
   * Keyed by participantId. Recompiled at chat creation, on participant add,
   * on selectedSystemPromptId change, and on chat.scenarioText change. Edits
   * to the underlying character record do NOT auto-invalidate this field —
   * users will need to manually rehydrate (or restart the chat) to pick them
   * up. When missing for a participant, context-manager builds the stack
   * fresh and uses it without persisting (read-through fallback).
   */
  compiledIdentityStacks: JsonSchema.nullable().optional(),

  /**
   * The Courier — per-character delta-mode checkpoints. JSON shape:
   *   { [characterId]: { lastResolvedMessageId: UUID, resolvedAt: ISOString } }
   * Set on every successful `resolve-external-turn`. The orchestrator consults
   * this when the responding character's profile has `courierDeltaMode` on:
   * a checkpoint present for the character means the next Courier turn for
   * that character renders only messages newer than `resolvedAt`, on the
   * assumption that the external LLM client still remembers everything up
   * through the last paste. Null on chats that have never used a Courier
   * profile.
   */
  courierCheckpoints: JsonSchema.nullable().optional(),

  /**
   * The Commonplace Book — per-target scene-state emission cache. JSON shape:
   *   { [targetKey]: { [characterId]: { actionHash, clothingHash, emittedAt } } }
   * where `targetKey` is the recipient participant ID (or the sentinel
   * `"__public__"` for untargeted whispers in single-character chats).
   * `formatCurrentSceneState` consults this map per target before emitting
   * the `Current State` block; when a character's action+clothing hash
   * matches what was last sent to the same target, the character's section
   * collapses to a single `### Name — _unchanged_` line so the LLM (or the
   * Courier delta) doesn't carry the same several-hundred-token wardrobe
   * prose every turn. The cache is updated only after the new whisper has
   * been durably posted. Null on chats that have not yet emitted a
   * Commonplace Book whisper. Ephemeral, instance-local, regenerable per-chat
   * UX state — NOT part of the .qtap export.
   */
  commonplaceSceneCache: JsonSchema.nullable().optional(),

  /**
   * The Commonplace Book — recall anti-repetition ring buffer. JSON shape:
   *   string[][]  — one inner array of whispered memory IDs per recent turn,
   *   most recent last, capped to the last few turns. The recall path unions
   *   these IDs into a "recently whispered" set and applies a bounded
   *   penalty (see lib/memory/recall-tags.ts `recentlyWhispered`) so the same
   *   memory doesn't get whispered turn after turn. Ephemeral per-chat UX
   *   state — NOT part of .qtap export. Null until the first whisper.
   */
  commonplaceRecallHistory: JsonSchema.nullable().optional(),

  /**
   * Which clock this chat's story runs on (episodic recall overhaul):
   *  - 'realtime' (the default; NULL reads as realtime): events happen at
   *    wall-clock time, and retrospective queries ("last week") resolve
   *    against real dates.
   *  - 'narrative': the chat runs a fictional timeline; memory extraction
   *    fills `narrativeTime` on episodic memories and retrospective
   *    time-range resolution prefers in-story phrasing over wall-clock dates.
   */
  timelineMode: z.enum(['realtime', 'narrative']).nullable().optional(),

  // ==========================================================================
  // 4.6 Private Character Rooms — autonomous-room runtime + scheduling
  // Populated only when chatType === 'autonomous'; null/zero on other chats.
  // ==========================================================================

  /** Hard cap on character turns per run. NULL = unlimited (use other caps). */
  budgetMaxTurns: z.number().int().positive().nullable().optional(),
  /**
   * Cap on cumulative `promptTokens + completionTokens` per run. Cache-read
   * (prompt-cache hit) tokens are excluded by the provider plugins before they
   * reach token accounting, so cached input never counts toward this cap.
   */
  budgetMaxTokens: z.number().int().positive().nullable().optional(),
  /** Cap on wall-clock duration per run, in milliseconds. */
  budgetMaxWallClockMs: z.number().int().positive().nullable().optional(),
  /** Optional spend cap in USD, evaluated against running spend from llm_logs. */
  budgetEstimatedSpendCapUSD: z.number().positive().nullable().optional(),

  /** Cron expression. NULL = manual-only room. */
  scheduleCron: z.string().nullable().optional(),
  /** Catch-up window in ms; NULL = use user-default (12h). */
  scheduleFreshnessWindowMs: z.number().int().positive().nullable().optional(),
  /** ISO timestamp of the next scheduled run. */
  scheduleNextRunAt: TimestampSchema.nullable().optional(),
  /** ISO timestamp of the most recent run start (manual or scheduled). */
  scheduleLastRunAt: TimestampSchema.nullable().optional(),

  /** Current run-state lifecycle. NULL on non-autonomous chats. */
  runState: AutonomousRunStateEnum.nullable().optional(),
  /** UUID of the run currently authoritative for this room (stale-run guard). */
  currentRunId: UUIDSchema.nullable().optional(),
  /** Human-readable detail for paused/error states. */
  runStateMessage: z.string().nullable().optional(),
  /** ISO timestamp of the current/most-recent run start. */
  runStartedAt: TimestampSchema.nullable().optional(),
  /** ISO timestamp of the current/most-recent run end. */
  runEndedAt: TimestampSchema.nullable().optional(),
  /** ISO timestamp the current run was paused; cleared on resume. Marks the start of the current paused interval. */
  runPausedAt: TimestampSchema.nullable().optional(),
  /** Cumulative milliseconds the current run has spent paused, across all pause/resume cycles. The wall-clock budget subtracts this from elapsed time so paused intervals are excluded without disturbing runStartedAt (the token-accounting window start). */
  runPausedAccumMs: z.number().int().nonnegative().nullable().optional(),
  /** Turns consumed in the current/most-recent run. */
  runTurnsConsumed: z.number().int().nonnegative().nullable().optional(),
  /** Tokens consumed in the current/most-recent run (cache-read tokens excluded — see `budgetMaxTokens`). */
  runTokensConsumed: z.number().int().nonnegative().nullable().optional(),
  /**
   * Bitmask of the per-run pacing milestones the Host has already announced
   * (bit 0 = halfway, bit 1 = near-end / 10% remaining). Reset to 0 at each
   * run start so a fresh run announces its milestones anew. The milestones
   * track the *binding* room budget — the turns / tokens / wall-clock cap
   * closest to exhaustion (whichever ends the run first). Only meaningful on
   * autonomous chats.
   */
  runMilestonesAnnounced: z.number().int().nonnegative().default(0),

  /** 1 = owner pre-authorized destructive tools (DESTRUCTIVE_TOOL_NAMES); 0 = disabled. */
  runDestructiveToolsAllowed: z.number().int().min(0).max(1).default(0),
  /**
   * Per-run token-budget counting mode. 1 (default) = exclude prompt-cache
   * hit (cache-read) tokens from `budgetMaxTokens` / `runTokensConsumed`, so
   * only the billable cache-miss input + output tokens count (the expensive
   * ones). 0 = count every token, including cache reads, the way budgets
   * behaved before cache-read normalization; the cache-read tokens that the
   * provider plugins strip from `usage.totalTokens` are added back from
   * `cacheUsage.cacheReadInputTokens` at accounting time. Only meaningful on
   * autonomous chats.
   */
  budgetExcludeCacheHits: z.number().int().min(0).max(1).default(1),
  /** Per-room override of user-default visibility; NULL = inherit user default. */
  runVisibility: AutonomousRunVisibilityEnum.nullable().optional(),

  /**
   * Aurora Core whisper — per-chat override of the global `coreWhisper.enabled`
   * setting. NULL = inherit from character override → global default. The Core
   * whisper periodically re-offers each character's own `Core/` vault folder
   * before their next turn.
   */
  coreWhisperEnabled: z.boolean().nullable().optional(),
  /**
   * Aurora Core whisper — per-chat override of the global `coreWhisper.interval`
   * setting (assistant turns between periodic whispers). NULL = inherit from
   * global default.
   */
  coreWhisperInterval: z.number().int().min(1).nullable().optional(),

  /**
   * "Nothing to add" turn-skipping — per-chat toggle for the multi-character
   * pass option. NULL = enabled (the default); false = disabled. When enabled,
   * every LLM character is offered a per-turn option to pass by replying with
   * a sentinel, and the human Skip button feeds the same stall guard.
   */
  turnSkippingEnabled: z.boolean().nullable().optional(),

  /**
   * Per-chat override for showing reasoning models' thinking in the Salon.
   * Tri-state: NULL = inherit the global `chat.thinkingDisplay.defaultVisible`
   * default; true = always show; false = always hide. DISPLAY ONLY — this only
   * affects whether captured reasoning is rendered, never whether it is stored
   * or fed to any model.
   */
  showThinking: z.boolean().nullable().optional(),

  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).refine(
  (data) => data.participants.length > 0,
  {
      error: 'Chat must have at least one participant'
}
);

export type ChatMetadata = z.infer<typeof ChatMetadataSchema>;

// Schema without participant validation for migration/backwards compatibility
export const ChatMetadataBaseSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  participants: z.array(ChatParticipantBaseSchema).default([]),
  title: z.string(),
  contextSummary: z.string().nullable().optional(),
  sillyTavernMetadata: JsonSchema.nullable().optional(),
  tags: z.array(UUIDSchema).default([]),
  /** Roleplay template for this chat - can be UUID or 'plugin:*' format */
  roleplayTemplateId: z.string().nullable().optional(),
  /** Timestamp configuration for this chat (overrides user default) */
  timestampConfig: TimestampConfigSchema.nullable().optional(),
  /** Last participant whose turn it was (null = user's turn). Used to restore turn state when returning to chat. */
  lastTurnParticipantId: UUIDSchema.nullable().optional(),
  messageCount: z.number().default(0),
  lastMessageAt: TimestampSchema.nullable().optional(),
  lastRenameCheckInterchange: z.number().default(0),
  /** Triple-gate summarization tracking. See ChatMetadataSchema for details. */
  compactionGeneration: z.number().default(0),
  lastSummaryTurn: z.number().default(0),
  lastSummaryTokens: z.number().default(0),
  lastFullRebuildTurn: z.number().default(0),
  /** Phase 4: message IDs covered by the current summary. See ChatMetadataSchema. */
  summaryAnchorMessageIds: z.array(UUIDSchema).default([]),
  /** Whether auto-responses are paused in multi-character chats */
  isPaused: z.boolean().default(false),
  /** Whether the user has manually renamed this chat (disables auto-renaming) */
  isManuallyRenamed: z.boolean().default(false),
  // Impersonation state
  impersonatingParticipantIds: z.array(UUIDSchema).default([]),
  activeTypingParticipantId: UUIDSchema.nullable().optional(),
  allLLMPauseTurnCount: z.number().default(0),
  /** Server-side turn queue for chained responses (JSON array of participant IDs) */
  turnQueue: z.string().default('[]'),
  /**
   * Participants (LLM + user) who have spoken in the current rotation cycle.
   * Stored as a JSON array of participant IDs. The turn manager refuses to
   * pick anyone in this list again until the cycle wraps (i.e. everyone has
   * spoken at least once). Cleared automatically when the cycle completes.
   */
  spokenThisCycleParticipantIds: z.string().default('[]'),
  /** Whether composition mode is enabled (Enter = newline, Ctrl/Cmd+Enter = submit) */
  documentEditingMode: z.boolean().default(false),

  /** Document Mode layout state: normal (chat only), split (chat + document), focus (document only) */
  documentMode: z.enum(['normal', 'split', 'focus']).default('normal'),

  /** Divider position for split mode as percentage of main area width (20-80) */
  dividerPosition: z.number().min(20).max(80).default(45),

  /** Terminal Mode layout state: normal (chat only), split (chat + terminal), focus (terminal only) */
  terminalMode: z.enum(['normal', 'split', 'focus']).default('normal'),

  /** Active terminal session shown in Terminal Mode pane (null = no session bound) */
  activeTerminalSessionId: UUIDSchema.nullable().optional(),

  /** Vertical divider position (%) for the right-pane split when both Document and Terminal Modes are active (20-80) */
  rightPaneVerticalSplit: z.number().min(20).max(80).default(50),

  /** Project this chat belongs to (optional) */
  projectId: UUIDSchema.nullable().optional(),

  /** Resolved scenario text selected at chat creation (preset or custom) */
  scenarioText: z.string().nullable().optional(),

  // Token usage tracking (aggregate totals for this chat)
  /** Total prompt/input tokens used in this chat */
  totalPromptTokens: z.number().default(0),
  /** Total completion/output tokens used in this chat */
  totalCompletionTokens: z.number().default(0),
  /** Estimated total cost in USD for this chat */
  estimatedCostUSD: z.number().nullable().optional(),
  /** Source of pricing data for cost estimate */
  priceSource: z.enum(['openrouter', 'registry', 'fallback', 'openrouter-estimate', 'unavailable']).nullable().optional(),
  /** Per-chat override for showing system events (null = use global setting) */
  showSystemEventsOverride: z.boolean().nullable().optional(),

  /** Flag set when AI calls request_full_context tool - bypasses compression on next message */
  requestFullContextOnNextMessage: z.boolean().default(false),

  /** List of tool IDs that are disabled for this chat (empty = all enabled) */
  disabledTools: z.array(z.string()).default([]),

  /** Groups of tools that are disabled (e.g., "plugin:mcp", "plugin:mcp:subgroup:filesystem") */
  disabledToolGroups: z.array(z.string()).default([]),

  /** Flag to trigger tool change notification on next message (set when tool settings change) */
  forceToolsOnNextMessage: z.boolean().default(false),

  /** When true, characters may read (read-only) the vaults of other present participants via doc_* tools */
  allowCrossCharacterVaultReads: z.boolean().default(false),

  /** Pending outfit change notifications keyed by characterId, cleared after delivery */
  pendingOutfitNotifications: JsonSchema.nullable().optional(),

  /** Persistent JSON state for games, inventory, session data, etc. */
  state: JsonSchema.default({}),

  /** Cached compression result for context compression (persisted across restarts) */
  compressionCache: JsonSchema.nullable().optional(),

  /** Whether agent mode is enabled for this chat (null = inherit from project/character/global) */
  agentModeEnabled: z.boolean().nullable().optional(),

  /** Current agent turn count within the current message processing (resets on new user message) */
  agentTurnCount: z.number().default(0),

  /** Story background image file ID (from file system) */
  storyBackgroundImageId: UUIDSchema.nullable().optional(),
  /** When the story background was last generated */
  lastBackgroundGeneratedAt: TimestampSchema.nullable().optional(),

  /** Image generation profile for this chat (shared by all participants) */
  imageProfileId: UUIDSchema.nullable().optional(),

  /** When an image is generated in this chat, inject an assistant message announcing it (null = inherit from project/global) */
  alertCharactersOfLanternImages: z.boolean().nullable().optional(),

  /** Whether this chat has been classified as dangerous (null = not yet classified) */
  isDangerousChat: z.boolean().nullable().optional(),
  /** Overall danger score for this chat (0-1), null = not yet classified */
  dangerScore: z.number().min(0).max(1).nullable().optional(),
  /** Categories of dangerous content detected at chat level (JSON array of strings) */
  dangerCategories: z.array(z.string()).default([]),
  /** When the chat danger classification last ran */
  dangerClassifiedAt: TimestampSchema.nullable().optional(),
  /** Message count at which danger was last classified (to detect changes for re-check) */
  dangerClassifiedAtMessageCount: z.number().nullable().optional(),
  /**
   * Per-chat Concierge mode override. NULL means follow the global Concierge
   * setting and let `isDangerousChat` decide Safe vs Flagged. 'OFF' disables
   * every Concierge effect for this chat: no classification, no scanning, no
   * uncensored-provider reroute, no synthetic Concierge messages. Operators
   * who flip this on accept the risk of provider refusals.
   */
  conciergeOverride: z.enum(['OFF']).nullable().optional(),

  /**
   * Per-chat answer-confirmation override. NULL means inherit (from the chat's
   * project override, then the global setting). 'ON' forces the consistency
   * check on for this chat; 'OFF' forces it off. See
   * `isAnswerConfirmationActive`.
   */
  answerConfirmationOverride: z.enum(['ON', 'OFF']).nullable().optional(),

  /** Scene state tracker: structured summary of current scene (location, character actions, appearance, clothing) */
  sceneState: JsonSchema.nullable().optional(),

  /** Scriptorium: deterministic Markdown rendering of the full conversation */
  renderedMarkdown: z.string().nullable().optional(),

  /** Equipped outfit state per character: { [characterId]: { top, bottom, footwear, accessories } } */
  equippedOutfit: JsonSchema.nullable().optional(),

  /** Per-character generated avatars reflecting current outfit: { [characterId]: { imageId, generatedAt, afterMessageCount } } */
  characterAvatars: JsonSchema.nullable().optional(),

  /** Whether to auto-generate character avatars when outfits change (null = disabled) */
  avatarGenerationEnabled: z.boolean().nullable().optional(),

  /** Chat type discriminator: 'salon' for regular chats, 'help' for help assistant chats, 'autonomous' for character-to-character private rooms, 'brahma' for Brahma Console (character-less generic-LLM) chats */
  chatType: ChatTypeEnum.default('salon'),
  /** For help chats: the current page URL being viewed (for context resolution) */
  helpPageUrl: z.string().nullable().optional(),
  /**
   * For Brahma Console chats (`chatType === 'brahma'`): the connection profile
   * (model) the console is currently talking to. A Brahma chat has exactly one
   * model at a time; switching the model PATCHes this column and the same chat
   * continues with the new engine from that point forward. Seeded from the
   * user's default connection profile at creation. NULL on every other chat
   * type.
   */
  consoleConnectionProfileId: UUIDSchema.nullable().optional(),

  /**
   * Phase H: precompiled per-participant identity stack — the character-static
   * portion of the system prompt (identity preamble, base prompt, manifesto,
   * personality, aliases, pronouns, physical descriptions, example dialogues), with
   * templates ({{user}}, {{scenario}}, {{persona}}) resolved at compile time.
   * Keyed by participantId. Recompiled at chat creation, on participant add,
   * on selectedSystemPromptId change, and on chat.scenarioText change. Edits
   * to the underlying character record do NOT auto-invalidate this field —
   * users will need to manually rehydrate (or restart the chat) to pick them
   * up. When missing for a participant, context-manager builds the stack
   * fresh and uses it without persisting (read-through fallback).
   */
  compiledIdentityStacks: JsonSchema.nullable().optional(),

  /** The Courier — per-character delta-mode checkpoints. See ChatMetadataSchema for the contract. */
  courierCheckpoints: JsonSchema.nullable().optional(),

  /** The Commonplace Book — per-target scene-state emission cache. See ChatMetadataSchema for the contract. */
  commonplaceSceneCache: JsonSchema.nullable().optional(),

  /** The Commonplace Book — recall anti-repetition ring buffer (string[][]). See ChatMetadataSchema for the contract. */
  commonplaceRecallHistory: JsonSchema.nullable().optional(),

  /** Timeline clock ('realtime' | 'narrative'; NULL = realtime). See ChatMetadataSchema for the contract. */
  timelineMode: z.enum(['realtime', 'narrative']).nullable().optional(),

  // ==========================================================================
  // 4.6 Private Character Rooms — autonomous-room runtime + scheduling.
  // See ChatMetadataSchema for the per-field contract.
  // ==========================================================================
  budgetMaxTurns: z.number().int().positive().nullable().optional(),
  budgetMaxTokens: z.number().int().positive().nullable().optional(),
  budgetMaxWallClockMs: z.number().int().positive().nullable().optional(),
  budgetEstimatedSpendCapUSD: z.number().positive().nullable().optional(),
  scheduleCron: z.string().nullable().optional(),
  scheduleFreshnessWindowMs: z.number().int().positive().nullable().optional(),
  scheduleNextRunAt: TimestampSchema.nullable().optional(),
  scheduleLastRunAt: TimestampSchema.nullable().optional(),
  runState: AutonomousRunStateEnum.nullable().optional(),
  currentRunId: UUIDSchema.nullable().optional(),
  runStateMessage: z.string().nullable().optional(),
  runStartedAt: TimestampSchema.nullable().optional(),
  runEndedAt: TimestampSchema.nullable().optional(),
  runPausedAt: TimestampSchema.nullable().optional(),
  runPausedAccumMs: z.number().int().nonnegative().nullable().optional(),
  runTurnsConsumed: z.number().int().nonnegative().nullable().optional(),
  runTokensConsumed: z.number().int().nonnegative().nullable().optional(),
  /** Per-run pacing-milestone bitmask (bit 0 = halfway, bit 1 = near-end). Reset to 0 at run start. See ChatMetadataSchema. */
  runMilestonesAnnounced: z.number().int().nonnegative().default(0),
  runDestructiveToolsAllowed: z.number().int().min(0).max(1).default(0),
  budgetExcludeCacheHits: z.number().int().min(0).max(1).default(1),
  runVisibility: AutonomousRunVisibilityEnum.nullable().optional(),

  /** Aurora Core whisper — per-chat override of the global `coreWhisper.enabled` setting. NULL = inherit. */
  coreWhisperEnabled: z.boolean().nullable().optional(),
  /** Aurora Core whisper — per-chat override of the global `coreWhisper.interval` setting (assistant turns between periodic whispers). NULL = inherit. */
  coreWhisperInterval: z.number().int().min(1).nullable().optional(),

  /** "Nothing to add" turn-skipping — per-chat toggle. NULL = enabled (default); false = disabled. */
  turnSkippingEnabled: z.boolean().nullable().optional(),

  /** Per-chat override for showing reasoning models' thinking. NULL = inherit global `chat.thinkingDisplay.defaultVisible`; true = show; false = hide. DISPLAY ONLY. */
  showThinking: z.boolean().nullable().optional(),

  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ChatMetadataBase = z.infer<typeof ChatMetadataBaseSchema>;

// Input type for creating chats - makes fields with defaults optional
export type ChatMetadataInput = z.input<typeof ChatMetadataBaseSchema>;

// ============================================================================
// LEGACY CHAT METADATA (for migration)
// ============================================================================

// Legacy schema for migration (matches old format)
export const ChatMetadataLegacySchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  characterId: UUIDSchema,
  personaId: UUIDSchema.nullable().optional(),
  connectionProfileId: UUIDSchema,
  imageProfileId: UUIDSchema.nullable().optional(),
  title: z.string(),
  contextSummary: z.string().nullable().optional(),
  sillyTavernMetadata: JsonSchema.nullable().optional(),
  tags: z.array(UUIDSchema).default([]),
  messageCount: z.number().default(0),
  lastMessageAt: TimestampSchema.nullable().optional(),
  lastRenameCheckInterchange: z.number().default(0),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ChatMetadataLegacy = z.infer<typeof ChatMetadataLegacySchema>;
