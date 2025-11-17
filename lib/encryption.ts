/**
 * Encryption Service for API Keys
 * Phase 0.3: Core Infrastructure
 *
 * Uses AES-256-GCM with per-user encryption keys
 * Keys are derived from user ID + master pepper for security
 */

import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const MASTER_PEPPER = process.env.ENCRYPTION_MASTER_PEPPER!
const KEY_LENGTH = 32 // 256 bits
const IV_LENGTH = 16 // 128 bits
const PBKDF2_ITERATIONS = 100000
const PBKDF2_DIGEST = 'sha256'

// Validate that master pepper is configured
if (!MASTER_PEPPER) {
  throw new Error(
    'ENCRYPTION_MASTER_PEPPER environment variable is not set. ' +
    'Generate one with: openssl rand -base64 32'
  )
}

if (MASTER_PEPPER.length < 32) {
  console.warn(
    'WARNING: ENCRYPTION_MASTER_PEPPER should be at least 32 characters for security'
  )
}

/**
 * Derive a user-specific encryption key
 * Key is derived from user ID + master pepper using PBKDF2
 * This allows the user to access their keys via OAuth login
 *
 * @param userId - The user's unique ID
 * @returns Buffer containing the derived encryption key
 */
function deriveUserKey(userId: string): Buffer {
  return crypto.pbkdf2Sync(
    userId,
    MASTER_PEPPER,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    PBKDF2_DIGEST
  )
}

/**
 * Encrypt API key with user-specific key
 * Uses AES-256-GCM for authenticated encryption
 *
 * @param apiKey - The plaintext API key to encrypt
 * @param userId - The user's unique ID
 * @returns Object containing encrypted data, IV, and auth tag
 */
export function encryptApiKey(apiKey: string, userId: string) {
  if (!apiKey) {
    throw new Error('API key cannot be empty')
  }
  if (!userId) {
    throw new Error('User ID cannot be empty')
  }

  const key = deriveUserKey(userId)
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(apiKey, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  }
}

/**
 * Decrypt API key with user-specific key
 * Verifies authentication tag to ensure data integrity
 *
 * @param encrypted - The encrypted API key (hex string)
 * @param iv - The initialization vector (hex string)
 * @param authTag - The authentication tag (hex string)
 * @param userId - The user's unique ID
 * @returns The decrypted plaintext API key
 * @throws Error if decryption fails or auth tag is invalid
 */
export function decryptApiKey(
  encrypted: string,
  iv: string,
  authTag: string,
  userId: string
): string {
  if (!encrypted || !iv || !authTag || !userId) {
    throw new Error('All parameters are required for decryption')
  }

  try {
    const key = deriveUserKey(userId)
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, 'hex')
    )

    decipher.setAuthTag(Buffer.from(authTag, 'hex'))

    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } catch (error) {
    // Don't expose internal error details
    throw new Error('Failed to decrypt API key. Invalid key or corrupted data.')
  }
}

/**
 * Test if encryption/decryption is working correctly
 * Used for system health checks
 *
 * @returns true if encryption is working, false otherwise
 */
export function testEncryption(): boolean {
  try {
    const testUserId = 'test-user-id'
    const testApiKey = 'test-api-key-12345'

    const encrypted = encryptApiKey(testApiKey, testUserId)
    const decrypted = decryptApiKey(
      encrypted.encrypted,
      encrypted.iv,
      encrypted.authTag,
      testUserId
    )

    return decrypted === testApiKey
  } catch (error) {
    console.error('Encryption test failed:', error)
    return false
  }
}

/**
 * Mask an API key for display purposes
 * Shows only first 8 and last 4 characters
 *
 * @param apiKey - The API key to mask
 * @returns Masked API key string
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 12) {
    return '••••••••••••'
  }

  const prefix = apiKey.substring(0, 8)
  const suffix = apiKey.substring(apiKey.length - 4)
  const masked = '•'.repeat(Math.max(4, apiKey.length - 12))

  return `${prefix}${masked}${suffix}`
}
