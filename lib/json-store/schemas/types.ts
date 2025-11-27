/**
 * JSON Store Type Definitions
 *
 * Central types used across all JSON storage schemas.
 * These correspond to Prisma models mapped to JSON files.
 */

import { z } from 'zod';

// ============================================================================
// ENUMS
// ============================================================================

export const ProviderEnum = z.enum(['OPENAI', 'ANTHROPIC', 'OLLAMA', 'OPENROUTER', 'OPENAI_COMPATIBLE', 'GROK', 'GAB_AI', 'GOOGLE']);
export type Provider = z.infer<typeof ProviderEnum>;

export const ImageProviderEnum = z.enum(['OPENAI', 'GROK', 'GOOGLE_IMAGEN']);
export type ImageProvider = z.infer<typeof ImageProviderEnum>;

export const RoleEnum = z.enum(['SYSTEM', 'USER', 'ASSISTANT', 'TOOL']);
export type Role = z.infer<typeof RoleEnum>;

export const ImageTagTypeEnum = z.enum(['CHARACTER', 'PERSONA', 'CHAT', 'THEME']);
export type ImageTagType = z.infer<typeof ImageTagTypeEnum>;

export const AvatarDisplayModeEnum = z.enum(['ALWAYS', 'GROUP_ONLY', 'NEVER']);
export type AvatarDisplayMode = z.infer<typeof AvatarDisplayModeEnum>;

// ============================================================================
// COMMON FIELDS
// ============================================================================

// UUID identifier
export const UUIDSchema = z.string().uuid();

// ISO-8601 timestamp
export const TimestampSchema = z.string().datetime().or(z.date()).transform(d => {
  if (d instanceof Date) return d.toISOString();
  return d;
});

// JSON field (flexible structure)
export const JsonSchema = z.record(z.unknown());

// Encryption fields (AES-256-GCM)
export const EncryptedFieldSchema = z.object({
  ciphertext: z.string(),
  iv: z.string(),
  authTag: z.string(),
});

export type EncryptedField = z.infer<typeof EncryptedFieldSchema>;

// ============================================================================
// AUTHENTICATION & USER
// ============================================================================

export const TOTPSecretSchema = EncryptedFieldSchema.extend({
  enabled: z.boolean().default(false),
  verifiedAt: TimestampSchema.nullable().optional(),
});

export type TOTPSecret = z.infer<typeof TOTPSecretSchema>;

export const BackupCodesSchema = z.object({
  ciphertext: z.string(),
  iv: z.string(),
  authTag: z.string(),
  createdAt: TimestampSchema,
});

export type BackupCodes = z.infer<typeof BackupCodesSchema>;

export const UserSchema = z.object({
  id: UUIDSchema,
  email: z.string().email(),
  name: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  emailVerified: TimestampSchema.nullable().optional(),

  // Password authentication
  passwordHash: z.string().nullable().optional(),

  // TOTP 2FA
  totp: TOTPSecretSchema.optional(),
  backupCodes: BackupCodesSchema.optional(),

  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type User = z.infer<typeof UserSchema>;

export const HexColorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/);

export const TagVisualStyleSchema = z.object({
  emoji: z.string().max(8).optional().nullable(),
  foregroundColor: HexColorSchema.default('#1f2937'),
  backgroundColor: HexColorSchema.default('#e5e7eb'),
  emojiOnly: z.boolean().default(false),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  strikethrough: z.boolean().default(false),
});

export type TagVisualStyle = z.infer<typeof TagVisualStyleSchema>;

export const TagStyleMapSchema = z.record(TagVisualStyleSchema).default({});

export type TagStyleMap = z.infer<typeof TagStyleMapSchema>;

export const ChatSettingsSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  avatarDisplayMode: AvatarDisplayModeEnum.default('ALWAYS'),
  avatarDisplayStyle: z.string().default('CIRCULAR'),
  tagStyles: TagStyleMapSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ChatSettings = z.infer<typeof ChatSettingsSchema>;

export const AccountSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  type: z.string(),
  provider: z.string(),
  providerAccountId: z.string(),
  refresh_token: z.string().nullable().optional(),
  access_token: z.string().nullable().optional(),
  expires_at: z.number().nullable().optional(),
  token_type: z.string().nullable().optional(),
  scope: z.string().nullable().optional(),
  id_token: z.string().nullable().optional(),
  session_state: z.string().nullable().optional(),
});

export type Account = z.infer<typeof AccountSchema>;

export const SessionSchema = z.object({
  id: UUIDSchema,
  sessionToken: z.string(),
  userId: UUIDSchema,
  expires: TimestampSchema,
});

export type Session = z.infer<typeof SessionSchema>;

export const VerificationTokenSchema = z.object({
  identifier: z.string(),
  token: z.string(),
  expires: TimestampSchema,
});

export type VerificationToken = z.infer<typeof VerificationTokenSchema>;

// ============================================================================
// API KEYS & PROFILES
// ============================================================================

export const ApiKeySchema = z.object({
  id: UUIDSchema,
  label: z.string(),
  provider: ProviderEnum,
  ciphertext: z.string(),
  iv: z.string(),
  authTag: z.string(),
  isActive: z.boolean().default(true),
  lastUsed: TimestampSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ApiKey = z.infer<typeof ApiKeySchema>;

export const ConnectionProfileSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: z.string(),
  provider: ProviderEnum,
  apiKeyId: UUIDSchema.nullable().optional(),
  baseUrl: z.string().nullable().optional(),
  modelName: z.string(),
  parameters: JsonSchema.default({}),
  isDefault: z.boolean().default(false),
  tags: z.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ConnectionProfile = z.infer<typeof ConnectionProfileSchema>;

// ============================================================================
// CHARACTER & PERSONA
// ============================================================================

export const CharacterSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  personality: z.string().nullable().optional(),
  scenario: z.string().nullable().optional(),
  firstMessage: z.string().nullable().optional(),
  exampleDialogues: z.string().nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  defaultImageId: UUIDSchema.nullable().optional(),
  defaultConnectionProfileId: UUIDSchema.nullable().optional(),
  sillyTavernData: JsonSchema.nullable().optional(),
  isFavorite: z.boolean().default(false),

  // Relationships
  personaLinks: z.array(z.object({
    personaId: UUIDSchema,
    isDefault: z.boolean(),
  })).default([]),
  tags: z.array(UUIDSchema).default([]),
  avatarOverrides: z.array(z.object({
    chatId: UUIDSchema,
    imageId: UUIDSchema,
  })).default([]),

  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Character = z.infer<typeof CharacterSchema>;

export const PersonaSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: z.string(),
  title: z.string().nullable().optional(),
  description: z.string(),
  personalityTraits: z.string().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  defaultImageId: UUIDSchema.nullable().optional(),
  sillyTavernData: JsonSchema.nullable().optional(),

  // Relationships
  characterLinks: z.array(UUIDSchema).default([]),
  tags: z.array(UUIDSchema).default([]),

  // Timestamps
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Persona = z.infer<typeof PersonaSchema>;

// ============================================================================
// CHAT & MESSAGES
// ============================================================================

export const MessageEventSchema = z.object({
  type: z.literal('message'),
  id: UUIDSchema,
  role: RoleEnum,
  content: z.string(),
  rawResponse: JsonSchema.nullable().optional(),
  tokenCount: z.number().nullable().optional(),
  swipeGroupId: z.string().nullable().optional(),
  swipeIndex: z.number().nullable().optional(),
  attachments: z.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
});

export type MessageEvent = z.infer<typeof MessageEventSchema>;

export const ContextSummaryEventSchema = z.object({
  type: z.literal('context-summary'),
  id: UUIDSchema,
  context: z.string(),
  createdAt: TimestampSchema,
});

export type ContextSummaryEvent = z.infer<typeof ContextSummaryEventSchema>;

export const ChatEventSchema = z.union([
  MessageEventSchema,
  ContextSummaryEventSchema,
]);

export type ChatEvent = z.infer<typeof ChatEventSchema>;

// ============================================================================
// CHAT PARTICIPANTS
// ============================================================================

export const ParticipantTypeEnum = z.enum(['CHARACTER', 'PERSONA']);
export type ParticipantType = z.infer<typeof ParticipantTypeEnum>;

export const ChatParticipantSchema = z.object({
  id: UUIDSchema,

  // Participant type and identity
  type: ParticipantTypeEnum,
  characterId: UUIDSchema.nullable().optional(),  // Set when type is CHARACTER
  personaId: UUIDSchema.nullable().optional(),    // Set when type is PERSONA

  // LLM configuration (for AI characters only)
  connectionProfileId: UUIDSchema.nullable().optional(),  // Required for CHARACTER, null for PERSONA
  imageProfileId: UUIDSchema.nullable().optional(),       // Image generation profile

  // Per-chat customization
  systemPromptOverride: z.string().nullable().optional(),  // Custom scenario/context for this chat

  // Display and state
  displayOrder: z.number().default(0),   // For ordering in UI
  isActive: z.boolean().default(true),   // Temporarily disable without removing

  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).refine(
  (data) => {
    // Must have characterId if type is CHARACTER
    if (data.type === 'CHARACTER') {
      return data.characterId != null;
    }
    // Must have personaId if type is PERSONA
    if (data.type === 'PERSONA') {
      return data.personaId != null;
    }
    return false;
  },
  { message: 'CHARACTER participants must have characterId, PERSONA participants must have personaId' }
).refine(
  (data) => {
    // CHARACTER participants must have a connectionProfileId
    if (data.type === 'CHARACTER') {
      return data.connectionProfileId != null;
    }
    return true;
  },
  { message: 'CHARACTER participants must have a connectionProfileId' }
);

export type ChatParticipant = z.infer<typeof ChatParticipantSchema>;

// Schema without refinements for internal use (e.g., parsing before validation)
export const ChatParticipantBaseSchema = z.object({
  id: UUIDSchema,
  type: ParticipantTypeEnum,
  characterId: UUIDSchema.nullable().optional(),
  personaId: UUIDSchema.nullable().optional(),
  connectionProfileId: UUIDSchema.nullable().optional(),
  imageProfileId: UUIDSchema.nullable().optional(),
  systemPromptOverride: z.string().nullable().optional(),
  displayOrder: z.number().default(0),
  isActive: z.boolean().default(true),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ChatParticipantBase = z.infer<typeof ChatParticipantBaseSchema>;

export const ChatMetadataSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,

  // Participants array (replaces characterId, personaId, connectionProfileId, imageProfileId)
  participants: z.array(ChatParticipantBaseSchema).default([]),

  title: z.string(),
  contextSummary: z.string().nullable().optional(),
  sillyTavernMetadata: JsonSchema.nullable().optional(),
  tags: z.array(UUIDSchema).default([]),
  messageCount: z.number().default(0),
  lastMessageAt: TimestampSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).refine(
  (data) => data.participants.length > 0,
  { message: 'Chat must have at least one participant' }
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
  messageCount: z.number().default(0),
  lastMessageAt: TimestampSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ChatMetadataBase = z.infer<typeof ChatMetadataBaseSchema>;

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
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ChatMetadataLegacy = z.infer<typeof ChatMetadataLegacySchema>;

// ============================================================================
// IMAGES & BINARIES
// ============================================================================

export const BinaryIndexEntrySchema = z.object({
  id: UUIDSchema,
  sha256: z.string().length(64),
  type: z.enum(['image', 'chat_file', 'avatar']),
  userId: UUIDSchema,
  filename: z.string(),
  relativePath: z.string(),
  mimeType: z.string(),
  size: z.number(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  source: z.enum(['upload', 'import', 'generated']).default('upload'),
  generationPrompt: z.string().nullable().optional(),
  generationModel: z.string().nullable().optional(),
  chatId: UUIDSchema.nullable().optional(),
  characterId: UUIDSchema.nullable().optional(),  // For avatar overrides
  messageId: UUIDSchema.nullable().optional(),
  tags: z.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type BinaryIndexEntry = z.infer<typeof BinaryIndexEntrySchema>;

// ============================================================================
// TAGS
// ============================================================================

export const TagSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: z.string(),
  nameLower: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Tag = z.infer<typeof TagSchema>;

// ============================================================================
// IMAGE PROFILES
// ============================================================================

export const ImageProfileSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema,
  name: z.string(),
  provider: ImageProviderEnum,
  apiKeyId: UUIDSchema.nullable().optional(),
  baseUrl: z.string().nullable().optional(),
  modelName: z.string(),
  parameters: JsonSchema.default({}),
  isDefault: z.boolean().default(false),
  tags: z.array(UUIDSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ImageProfile = z.infer<typeof ImageProfileSchema>;

// ============================================================================
// COMPOUND OBJECTS
// ============================================================================

export const GeneralSettingsSchema = z.object({
  version: z.number().default(1),
  user: UserSchema,
  chatSettings: ChatSettingsSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;

export const ConnectionProfilesFileSchema = z.object({
  version: z.number().default(1),
  apiKeys: z.array(ApiKeySchema).default([]),
  llmProfiles: z.array(ConnectionProfileSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ConnectionProfilesFile = z.infer<typeof ConnectionProfilesFileSchema>;

export const AuthAccountsSchema = z.object({
  version: z.number().default(1),
  accounts: z.array(AccountSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type AuthAccounts = z.infer<typeof AuthAccountsSchema>;

export const TagsFileSchema = z.object({
  version: z.number().default(1),
  tags: z.array(TagSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type TagsFile = z.infer<typeof TagsFileSchema>;

export const ImageProfilesFileSchema = z.object({
  version: z.number().default(1),
  profiles: z.array(ImageProfileSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type ImageProfilesFile = z.infer<typeof ImageProfilesFileSchema>;

// ============================================================================
// MEMORY
// ============================================================================

export const MemorySourceEnum = z.enum(['AUTO', 'MANUAL']);
export type MemorySource = z.infer<typeof MemorySourceEnum>;

export const MemorySchema = z.object({
  id: UUIDSchema,
  characterId: UUIDSchema,
  personaId: UUIDSchema.nullable().optional(),      // Optional: specific persona interaction
  chatId: UUIDSchema.nullable().optional(),         // Optional: source chat reference
  content: z.string(),                              // The actual memory content
  summary: z.string(),                              // Distilled version for context injection
  keywords: z.array(z.string()).default([]),        // For text-based search
  tags: z.array(UUIDSchema).default([]),            // Derived from character/persona/chat tags
  importance: z.number().min(0).max(1).default(0.5), // 0-1 scale for prioritization
  embedding: z.array(z.number()).nullable().optional(), // Vector embedding for semantic search
  source: MemorySourceEnum.default('MANUAL'),       // How it was created
  sourceMessageId: UUIDSchema.nullable().optional(), // If auto-created, which message triggered it
  lastAccessedAt: TimestampSchema.nullable().optional(), // For housekeeping decisions
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type Memory = z.infer<typeof MemorySchema>;

export const MemoriesFileSchema = z.object({
  version: z.number().default(1),
  memories: z.array(MemorySchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export type MemoriesFile = z.infer<typeof MemoriesFileSchema>;
