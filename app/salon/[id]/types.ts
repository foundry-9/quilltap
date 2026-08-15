import type { TagVisualStyle } from '@/lib/schemas/types'

export interface MessageAttachment {
  id: string
  filename: string
  filepath: string
  mimeType: string
}

export interface Message {
  id: string
  role: string
  content: string
  createdAt: string
  swipeGroupId?: string | null
  swipeIndex?: number | null
  attachments?: MessageAttachment[]
  debugMemoryLogs?: string[]
  participantId?: string | null
  /** Input/prompt tokens for this message */
  promptTokens?: number | null
  /** Output/completion tokens for this message */
  completionTokens?: number | null
  /** Total tokens (promptTokens + completionTokens) */
  tokenCount?: number | null
  /** Server-side pre-rendered HTML for simple messages (no tools, no attachments) */
  renderedHtml?: string | null
  /** Provider that generated this message (e.g., 'openai', 'anthropic') */
  provider?: string | null
  /** Model name that generated this message (e.g., 'gpt-4o', 'claude-sonnet-4-20250514') */
  modelName?: string | null
  /** Target participant IDs for whisper messages (null = public, array = private) */
  targetParticipantIds?: string[] | null
  /** Whether this message was generated while the character was in silent mode */
  isSilentMessage?: boolean
  /** Personified feature that authored this message (e.g., 'lantern' for Lantern announcements, 'aurora' for character-avatar refreshes, 'librarian' for Document Mode open/save announcements, 'concierge' for dangerous-content classification announcements, 'host' for Salon participation announcements, 'commonplaceBook' for memory recall whispers, 'ariel' for terminal session announcements, 'suparna' for Post Office mail-delivery announcements, 'pascal' for Pascal the Croupier's custom-tool roll outcomes) */
  systemSender?: 'lantern' | 'aurora' | 'librarian' | 'concierge' | 'prospero' | 'host' | 'commonplaceBook' | 'ariel' | 'carina' | 'suparna' | 'pascal' | null
  /** Sub-classification of a Staff-authored message — used by the Salon UI to label collapsed system-message bars (e.g. 'timestamp', 'project-context', 'memory-recap'). Always paired with systemSender. */
  systemKind?: string | null
  /** Ad-hoc announcer metadata for user-authored announcement bubbles (Insert Announcement composer button). Mutually exclusive with systemSender. */
  customAnnouncer?: {
    kind: 'character' | 'custom'
    characterId?: string | null
    displayName?: string | null
  } | null
  /** Carina (inline LLM queries) provenance, set on systemSender='carina' messages. answererId drives avatar resolution (the answerer character's own avatar); question is the verbatim text asked. */
  carinaMeta?: {
    answererId: string
    question: string
  } | null
  /** Pascal the Croupier (custom pseudo-tools) roll record, set on systemSender='pascal' messages. The server rolled and picked the outcome; the client only renders it. `state` accents the result bubble; `rollForm`/`notation`/`diceRolls` describe how the number came about. */
  pascalMeta?: {
    tool: string
    /** Display title at the time of the roll. Absent on messages predating it — fall back to `tool`. */
    toolTitle?: string
    /** The definition's chipLabel template rendered at roll time — the per-run label the chip and the bubble heading share. Absent on older rows and unlabelled tools — fall back to `toolTitle`, then `tool`. */
    chipLabel?: string
    definitionTier: 'character' | 'participant' | 'group' | 'project' | 'global'
    definitionMountId: string
    params: Record<string, number | string | boolean>
    rollForm: 'range' | 'dice'
    notation?: string
    raw: number
    diceRolls?: number[]
    value: number
    state: 'success' | 'partial' | 'failure' | 'info'
    outcomeIndex: number
    /** Side effects the run applied (audit only — the Salon body shows nothing of these). */
    effects?: Array<{
      target: string
      previous?: unknown
      next: unknown
      tier?: 'chat' | 'project' | 'group' | 'general'
    }>
    invokedBy: 'llm' | 'user'
    callerParticipantId?: string
  } | null
  /** Host structured payload. On turn-pass records (systemKind='turn-pass'), participantId names the character/participant who passed — read by the client Skip-button guard. */
  hostEvent?: {
    participantId?: string | null
    toStatus?: string | null
    introducedCharacterIds?: string[] | null
  } | null
  /** Danger flags from content classification */
  dangerFlags?: Array<{
    category: string
    score: number
    userOverridden: boolean
    wasRerouted: boolean
    reroutedProvider?: string | null
    reroutedModel?: string | null
  }>
  /** The Courier: when non-null, this is a placeholder assistant message
   * awaiting a manually pasted reply. The string is the Markdown blob the
   * user must copy out, carry to an external LLM, and paste back. In delta
   * mode this is the *delta* bundle; otherwise it is the full bundle. */
  pendingExternalPrompt?: string | null
  /** Full-context fallback bundle, present alongside `pendingExternalPrompt`
   * when delta mode rendered a delta. Lets the bubble offer a "Use full
   * context" toggle for when the destination LLM has lost its conversation. */
  pendingExternalPromptFull?: string | null
  /** Attachments referenced by a pending Courier turn — surfaced as
   * download links so the user can re-upload them in their destination
   * client. Cleared when the paste resolves. */
  pendingExternalAttachments?: Array<{
    fileId: string
    filename: string
    mimeType: string
    sizeBytes: number
    downloadUrl: string
  }> | null
  /** Transient, UI-only: character-initiated TOOL result rows folded into this
   * assistant message for rendering (see group-tool-messages.ts). Never
   * persisted — populated client-side so tool calls render inside the
   * character's bubble instead of as standalone rows in the flow. */
  attachedToolMessages?: Message[]
  /** Reasoning models' full chain-of-thought ("thinking"), DISPLAY ONLY. Shown
   * collapsibly in the bubble when the chat's thinking-visibility is on; never
   * fed to any model. */
  reasoningContent?: string | null
  /** Positioned reasoning blocks (DISPLAY ONLY) for splicing thinking into the
   * prose at the point it fired, mirroring tool-call anchors. Each carries an
   * `anchorOffset`, `content`, and a `seq` shared with tool anchors so
   * same-offset items render in true emission order. */
  reasoningSegments?: Array<{ anchorOffset: number; content: string; seq: number }> | null
  /** Answer-confirmation verdict: true = consistent/revised, false = affirmed a
   *  flagged answer, null = could not verify / not applicable, undefined = the
   *  check did not run (feature off / nothing to check). */
  confirmed?: boolean | null
  /** True when a check actually ran — distinguishes a reloaded "unverified"
   *  (confirmed comes back undefined from SQL NULL) from "never checked". */
  confirmationChecked?: boolean | null
  /** Whether the shown content is a re-affirmation rewrite of the original. */
  confirmationRevised?: boolean | null
  /** The cheap-LLM discrepancy explanation, surfaced on the badge hover. */
  confirmationNotes?: string | null
  /** The pre-revision text, retained for the logs when confirmationRevised. */
  confirmationOriginalContent?: string | null
}

export interface CharacterData {
  id: string
  name: string
  title?: string | null
  avatarUrl?: string
  defaultImageId?: string
  defaultImage?: {
    id: string
    filepath: string
    url?: string
  } | null
  talkativeness?: number
  /** Set when the character is archived — the seat is a tombstone until
   *  rehydration, and the sidebar badges it. */
  archivedAt?: string | null
  systemPrompts?: Array<{
    id: string
    name: string
    isDefault?: boolean
  }>
}

export interface ConnectionProfileData {
  id: string
  name: string
  provider?: string
  modelName?: string
  allowToolUse?: boolean
  apiKey?: {
    id: string
    provider: string
    label?: string
  } | null
}

export interface Participant {
  id: string
  type: 'CHARACTER'
  controlledBy?: 'llm' | 'user'
  displayOrder: number
  isActive: boolean
  /** Four-state participation status */
  status?: 'active' | 'silent' | 'absent' | 'removed'
  characterId?: string | null
  character?: CharacterData | null
  connectionProfile?: ConnectionProfileData | null
  imageProfile?: {
    id: string
    name: string
    provider: string
    modelName: string
  } | null
  /** Selected named system prompt from the character's systemPrompts[] array */
  selectedSystemPromptId?: string | null
  removedAt?: string | null
  // Multi-character chat fields
  hasHistoryAccess?: boolean
  joinScenario?: string | null
  /** Per-chat talkativeness override (0.1–1.0). Null/undefined → inherit from character. */
  talkativeness?: number | null
  createdAt?: string
  updatedAt?: string
}

export interface Chat {
  id: string
  title: string
  /** Discriminates salon chats from autonomous rooms ("enclaves"). Gates the Edit Enclave control. */
  chatType?: 'salon' | 'autonomous' | 'help' | 'brahma'
  roleplayTemplateId?: string | null
  participants: Participant[]
  user: {
    id: string
    name?: string | null
    image?: string | null
  }
  messages: Message[]
  /** Last participant whose turn it was (null = user's turn). Used to restore turn state when returning to chat. */
  lastTurnParticipantId?: string | null
  /** Whether auto-responses are paused in multi-character chats */
  isPaused?: boolean
  /** Whether the user has manually renamed this chat (disables auto-renaming) */
  isManuallyRenamed?: boolean
  /** Array of participant IDs the user is currently impersonating */
  impersonatingParticipantIds?: string[]
  /** Which impersonated participant is currently "active" for typing */
  activeTypingParticipantId?: string | null
  /** Turns since last user input or pause (for all-LLM pause logic) */
  allLLMPauseTurnCount?: number
  /** JSON-encoded array of participantIds that have spoken in the current rotation cycle */
  spokenThisCycleParticipantIds?: string
  /** Whether composition mode is enabled (Enter = newline, Ctrl/Cmd+Enter = submit) */
  documentEditingMode?: boolean
  /** Document Mode layout state: normal (chat only), split (chat + document), focus (document only) */
  documentMode?: 'normal' | 'split' | 'focus'
  /** Divider position for split mode as percentage of main area width */
  dividerPosition?: number
  /** Terminal Mode layout state: normal (chat only), split (chat + terminal), focus (terminal only) */
  terminalMode?: 'normal' | 'split' | 'focus'
  /** Active terminal session shown in Terminal Mode pane (null = no session bound) */
  activeTerminalSessionId?: string | null
  /** Vertical divider position for the right-pane split when both Document and Terminal Modes are active (20-80) */
  rightPaneVerticalSplit?: number
  /** Whether agent mode is enabled for this chat */
  agentModeEnabled?: boolean | null
  /** Resolved agent mode enabled state (from cascade: global → character → project → chat) */
  resolvedAgentModeEnabled?: boolean
  /** Source of the resolved agent mode setting */
  agentModeSource?: string
  /** Project ID this chat belongs to (if any) */
  projectId?: string | null
  /** Project name for display purposes */
  projectName?: string | null
  /** List of tool IDs that are disabled for this chat */
  disabledTools?: string[]
  /** Groups of tools that are disabled for this chat */
  disabledToolGroups?: string[]
  /** When true, characters may read (read-only) other present participants' character vaults via doc_* tools */
  allowCrossCharacterVaultReads?: boolean
  /** Per-chat override for Aurora's Core whisper enabled state (null = inherit from character → global). */
  coreWhisperEnabled?: boolean | null
  /** Per-chat override for Aurora's Core whisper cadence (assistant turns between offerings). null = inherit. */
  coreWhisperInterval?: number | null
  /** "Nothing to add" turn-skipping toggle. null = enabled (default); false = disabled. */
  turnSkippingEnabled?: boolean | null
  /** Per-chat override for showing reasoning models' thinking (null = inherit global `thinkingDisplay.defaultVisible`; true = show; false = hide). DISPLAY ONLY. */
  showThinking?: boolean | null
  /** Per-chat answer-confirmation override (null = inherit project/global; 'ON'/'OFF' = explicit). */
  answerConfirmationOverride?: 'ON' | 'OFF' | null
  /** Which clock the chat's story keeps for episodic memory (null = realtime default). */
  timelineMode?: 'realtime' | 'narrative' | null
  /** Image profile ID for generating images in this chat (shared by all participants) */
  imageProfileId?: string | null
  /** Whether to auto-generate character avatars when outfits change */
  avatarGenerationEnabled?: boolean | null
  /** Whether to announce Lantern-generated images to characters (null = inherit from project/global) */
  alertCharactersOfLanternImages?: boolean | null
  /** Whether the Concierge has classified this chat as dangerous (null = not yet classified) */
  isDangerousChat?: boolean | null
  /** Categories of dangerous content detected (e.g. 'nsfw', 'violence') */
  dangerCategories?: string[]
  /** Per-chat Concierge tri-state override: NULL = follow global, 'OFF' = off-duty */
  conciergeOverride?: 'OFF' | null
  /** Off-scene character cards referenced by ad-hoc announcement bubbles (customAnnouncer.kind === 'character'). Populated server-side from message rows. */
  offSceneCharacters?: Array<{
    id: string
    name: string
    title: string | null
    avatarUrl: string | null
  }>
}

export type MemoryCascadeAction = 'DELETE_MEMORIES' | 'KEEP_MEMORIES' | 'REGENERATE_MEMORIES' | 'ASK_EVERY_TIME'

export interface MemoryCascadePreferences {
  onMessageDelete: MemoryCascadeAction
  onSwipeRegenerate: MemoryCascadeAction
}

export interface TokenDisplaySettings {
  showPerMessageTokens: boolean
  showPerMessageCost: boolean
  showChatTotals: boolean
  showSystemEvents: boolean
}

export interface StoryBackgroundsSettings {
  enabled: boolean
  defaultImageProfileId?: string | null
}

export interface DangerousContentSettings {
  mode: 'OFF' | 'DETECT_ONLY' | 'AUTO_ROUTE'
  threshold: number
  scanTextChat: boolean
  scanImagePrompts: boolean
  scanImageGeneration: boolean
  displayMode: 'SHOW' | 'BLUR' | 'COLLAPSE'
  showWarningBadges: boolean
}

export interface ChatSettings {
  id: string
  userId: string
  avatarDisplayMode: 'ALWAYS' | 'GROUP_ONLY' | 'NEVER'
  avatarDisplayStyle?: 'CIRCULAR' | 'RECTANGULAR'
  tagStyles?: Record<string, TagVisualStyle>
  memoryCascadePreferences?: MemoryCascadePreferences
  tokenDisplaySettings?: TokenDisplaySettings
  llmLoggingSettings?: { enabled?: boolean; verboseMode?: boolean; retentionDays?: number }
  storyBackgroundsSettings?: StoryBackgroundsSettings
  dangerousContentSettings?: DangerousContentSettings
  /** Global defaults for showing reasoning models' thinking. DISPLAY ONLY. */
  thinkingDisplay?: { defaultVisible: boolean; defaultCollapsed: boolean }
  /** Whether the Salon auto-scrolls to the newest message when a response completes (only when already near the bottom). DISPLAY ONLY. */
  autoScrollOnResponseComplete?: boolean
  createdAt: string
  updatedAt: string
}

export interface AttachedFile {
  id: string
  filename: string
  filepath: string
  mimeType: string
  url?: string
}

/**
 * Pending tool result - shown in composer before sending
 */
export interface PendingToolResult {
  /** Unique ID for this pending result */
  id: string
  /** Tool name (e.g., 'rng') */
  tool: string
  /** Tool display name (e.g., 'Random Number Generator') */
  displayName: string
  /** Icon for the tool (emoji) */
  icon: string
  /** Short summary for chip display (e.g., '🎲 d20: 17') */
  summary: string
  /** Full formatted result for tooltip */
  formattedResult: string
  /** Human-readable request description (e.g., 'Roll a d20') */
  requestPrompt: string
  /** Raw arguments for recreating the request */
  arguments: Record<string, unknown>
  /** Whether the tool execution was successful */
  success: boolean
  /** Timestamp when result was generated */
  createdAt: string
}

export interface ChatParticipantData {
  id: string
  type: 'CHARACTER'
  controlledBy?: 'llm' | 'user'
  displayOrder: number
  isActive: boolean
  /** Four-state participation status */
  status?: 'active' | 'silent' | 'absent' | 'removed'
  character: {
    id: string
    name: string
    title?: string | null
    avatarUrl?: string
    defaultImage?: {
      url?: string
      filepath?: string
    } | null
  } | null
  connectionProfile?: ConnectionProfileData | null
}

export type Character = CharacterData
