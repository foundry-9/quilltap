/**
 * Common Type Definitions
 *
 * Contains version constants, enums, and common schemas used across
 * all domain-specific type files.
 *
 * @module schemas/common.types
 */

import { z } from 'zod';

// Re-export theme types for convenience
export { ThemePreferenceSchema, type ThemePreference } from '@/lib/themes/types';

// ============================================================================
// VERSION CONSTANTS
// ============================================================================

/**
 * Current schema version for data compatibility checks.
 */
export const SCHEMA_VERSION = '2.5.0';

// ============================================================================
// ENUMS
// ============================================================================

// Providers are now dynamic from plugins, so we use string validation
export const ProviderEnum = z.string().min(1, 'Provider is required');
export type Provider = z.infer<typeof ProviderEnum>;

export const ImageProviderEnum = z.string().min(1, 'Image provider is required');
export type ImageProvider = z.infer<typeof ImageProviderEnum>;

export const EmbeddingProfileProviderEnum = z.enum(['OPENAI', 'OLLAMA', 'OPENROUTER', 'NANOGPT', 'BUILTIN']);
export type EmbeddingProfileProvider = z.infer<typeof EmbeddingProfileProviderEnum>;

export const RoleEnum = z.enum(['SYSTEM', 'USER', 'ASSISTANT', 'TOOL']);
export type Role = z.infer<typeof RoleEnum>;

export const ImageTagTypeEnum = z.enum(['CHARACTER', 'CHAT', 'THEME']);
export type ImageTagType = z.infer<typeof ImageTagTypeEnum>;

export const AvatarDisplayModeEnum = z.enum(['ALWAYS', 'GROUP_ONLY', 'NEVER']);
export type AvatarDisplayMode = z.infer<typeof AvatarDisplayModeEnum>;

// ============================================================================
// COMMON SCHEMAS
// ============================================================================

// UUID identifier
export const UUIDSchema = z.uuid();

// ISO-8601 timestamp
export const TimestampSchema = z.iso.datetime().or(z.date()).transform(d => {
  if (d instanceof Date) return d.toISOString();
  return d;
});

// JSON field (flexible structure)
export const JsonSchema = z.record(z.string(), z.unknown());

/**
 * @deprecated Field-level encryption has been replaced by database-level encryption (SQLCipher).
 * API keys now use the `key_value` field directly. This schema is retained only for migration compatibility.
 */
export const EncryptedFieldSchema = z.object({
  ciphertext: z.string(),
  iv: z.string(),
  authTag: z.string(),
});

/** @deprecated See EncryptedFieldSchema */
export type EncryptedField = z.infer<typeof EncryptedFieldSchema>;

// Hex color validation
export const HexColorSchema = z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/);

// Tag visual style for customization
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

export const TagStyleMapSchema = z.record(z.string(), TagVisualStyleSchema).default({});

export type TagStyleMap = z.infer<typeof TagStyleMapSchema>;
