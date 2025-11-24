/**
 * Schema Version Tracking
 *
 * This file locks the current Prisma schema version for the JSON migration.
 * Do NOT modify this without documenting the change.
 *
 * Inventory Phase: 2025-11-22
 * Schema State: Phase 0.7 (Complete)
 */

export const SCHEMA_VERSION = {
  // Semantic versioning for schema state at start of migration
  major: 0,
  minor: 7,
  patch: 0,

  // When this inventory was taken
  inventoryDate: '2025-11-22',

  // Description of schema phase
  phase: 'Phase 0.7: Tag System Complete',

  // Short summary of what's included
  description: 'Complete Quilltap schema including User, Auth, Profiles, Characters, Personas, Chats, Messages, Images, and Tag system',
} as const;

/**
 * List of all Prisma models at time of inventory
 * Used to validate migration completeness
 */
export const PRISMA_MODELS = [
  // Authentication & User Management
  'User',
  'ChatSettings',
  'Account',
  'Session',
  'VerificationToken',

  // Connection & API Key Management
  'ApiKey',
  'ConnectionProfile',
  'ConnectionProfileTag',

  // Character & Persona System
  'Character',
  'Persona',
  'CharacterPersona',
  'CharacterTag',
  'PersonaTag',

  // Chat System
  'Chat',
  'Message',
  'ChatFile',
  'ChatTag',

  // Image & Asset Management
  'Image',
  'ImageTag',
  'ChatAvatarOverride',

  // Image Generation Profiles
  'ImageProfile',
  'ImageProfileTag',

  // General Tags
  'Tag',
] as const;

/**
 * Enum values from Prisma schema
 */
export const SCHEMA_ENUMS = {
  Provider: ['OPENAI', 'ANTHROPIC', 'OLLAMA', 'OPENROUTER', 'OPENAI_COMPATIBLE', 'GROK', 'GAB_AI'],
  ImageProvider: ['OPENAI', 'GROK', 'GOOGLE_IMAGEN'],
  Role: ['SYSTEM', 'USER', 'ASSISTANT', 'TOOL'],
  ImageTagType: ['CHARACTER', 'PERSONA', 'CHAT', 'THEME'],
  AvatarDisplayMode: ['ALWAYS', 'GROUP_ONLY', 'NEVER'],
} as const;

/**
 * Key relationships to maintain during migration
 * Helps validate data integrity
 */
export const KEY_RELATIONSHIPS = {
  'User -> Account': 'one-to-many (OnDelete: Cascade)',
  'User -> Session': 'one-to-many (OnDelete: Cascade)',
  'User -> ApiKey': 'one-to-many (OnDelete: Cascade)',
  'User -> ConnectionProfile': 'one-to-many (OnDelete: Cascade)',
  'User -> Character': 'one-to-many (OnDelete: Cascade)',
  'User -> Persona': 'one-to-many (OnDelete: Cascade)',
  'User -> Chat': 'one-to-many (OnDelete: Cascade)',
  'User -> Image': 'one-to-many (OnDelete: Cascade)',
  'User -> Tag': 'one-to-many (OnDelete: Cascade)',
  'User -> ImageProfile': 'one-to-many (OnDelete: Cascade)',
  'User -> ChatSettings': 'one-to-one (OnDelete: Cascade)',

  'Character -> Persona': 'many-to-many via CharacterPersona',
  'Character -> Chat': 'one-to-many (OnDelete: Cascade)',
  'Character -> Tag': 'many-to-many via CharacterTag',
  'Character -> Image': 'one-to-one for default avatar',

  'Persona -> Chat': 'one-to-many (OnDelete: SetNull)',
  'Persona -> Tag': 'many-to-many via PersonaTag',
  'Persona -> Image': 'one-to-one for default avatar',

  'Chat -> Message': 'one-to-many (OnDelete: Cascade)',
  'Chat -> ChatFile': 'one-to-many (OnDelete: Cascade)',
  'Chat -> ImageProfile': 'one-to-many (OnDelete: SetNull)',
  'Chat -> ConnectionProfile': 'many-to-one',
  'Chat -> Character': 'many-to-one',
  'Chat -> Tag': 'many-to-many via ChatTag',

  'Message -> ChatFile': 'one-to-many (OnDelete: SetNull)',

  'Image -> ImageTag': 'one-to-many (OnDelete: Cascade)',
  'Image -> ChatAvatarOverride': 'one-to-many (OnDelete: Cascade)',

  'ApiKey -> ConnectionProfile': 'one-to-many (OnDelete: SetNull)',
  'ApiKey -> ImageProfile': 'one-to-many (OnDelete: SetNull)',

  'ConnectionProfile -> Tag': 'many-to-many via ConnectionProfileTag',
  'ImageProfile -> Tag': 'many-to-many via ImageProfileTag',
  'ImageProfile -> Chat': 'one-to-many',
} as const;

/**
 * Fields requiring encryption during migration
 */
export const ENCRYPTED_FIELDS = {
  'User.passwordHash': 'bcrypt',
  'User.totpSecret': 'AES-256-GCM',
  'User.backupCodes': 'AES-256-GCM',
  'ApiKey.keyEncrypted': 'AES-256-GCM',
} as const;

/**
 * Notable fields with JSON type (flexible storage)
 */
export const JSON_FIELDS = {
  'ConnectionProfile.parameters': 'LLM parameters (temperature, max_tokens, etc)',
  'Message.rawResponse': 'Full LLM API response',
  'Chat.sillyTavernMetadata': 'Silly Tavern format metadata',
  'Character.sillyTavernData': 'Full ST character spec',
  'Persona.sillyTavernData': 'Full ST persona spec',
  'ImageProfile.parameters': 'Provider-specific params (quality, style, etc)',
} as const;
