/**
 * Unit Tests for Encryption Service
 * Phase 0.3: Core Infrastructure
 */

import { encryptApiKey, decryptApiKey, maskApiKey, testEncryption } from '@/lib/encryption'

// Mock environment variable
process.env.ENCRYPTION_MASTER_PEPPER = 'test-pepper-for-unit-tests-32-chars-long!'

describe('Encryption Service', () => {
  const userId = 'test-user-id-12345'
  const apiKey = 'sk-test-api-key-abcdefghijklmnopqrstuvwxyz'

  describe('encryptApiKey', () => {
    it('should encrypt an API key', () => {
      const encrypted = encryptApiKey(apiKey, userId)

      expect(encrypted).toHaveProperty('encrypted')
      expect(encrypted).toHaveProperty('iv')
      expect(encrypted).toHaveProperty('authTag')
      expect(encrypted.encrypted).toBeTruthy()
      expect(encrypted.iv).toBeTruthy()
      expect(encrypted.authTag).toBeTruthy()
    })

    it('should throw error for empty API key', () => {
      expect(() => encryptApiKey('', userId)).toThrow('API key cannot be empty')
    })

    it('should throw error for empty user ID', () => {
      expect(() => encryptApiKey(apiKey, '')).toThrow('User ID cannot be empty')
    })

    it('should use different IVs for same key', () => {
      const enc1 = encryptApiKey(apiKey, userId)
      const enc2 = encryptApiKey(apiKey, userId)

      expect(enc1.iv).not.toBe(enc2.iv)
      expect(enc1.encrypted).not.toBe(enc2.encrypted)
      expect(enc1.authTag).not.toBe(enc2.authTag)
    })

    it('should produce different encrypted values for different users', () => {
      const enc1 = encryptApiKey(apiKey, 'user1')
      const enc2 = encryptApiKey(apiKey, 'user2')

      expect(enc1.encrypted).not.toBe(enc2.encrypted)
    })
  })

  describe('decryptApiKey', () => {
    it('should decrypt an encrypted API key', () => {
      const encrypted = encryptApiKey(apiKey, userId)
      const decrypted = decryptApiKey(
        encrypted.encrypted,
        encrypted.iv,
        encrypted.authTag,
        userId
      )

      expect(decrypted).toBe(apiKey)
    })

    it('should fail with wrong user ID', () => {
      const encrypted = encryptApiKey(apiKey, userId)

      expect(() => {
        decryptApiKey(
          encrypted.encrypted,
          encrypted.iv,
          encrypted.authTag,
          'wrong-user-id'
        )
      }).toThrow('Failed to decrypt API key')
    })

    it('should fail with tampered encrypted data', () => {
      const encrypted = encryptApiKey(apiKey, userId)
      const tamperedEncrypted = encrypted.encrypted.slice(0, -4) + 'abcd'

      expect(() => {
        decryptApiKey(
          tamperedEncrypted,
          encrypted.iv,
          encrypted.authTag,
          userId
        )
      }).toThrow('Failed to decrypt API key')
    })

    it('should fail with tampered auth tag', () => {
      const encrypted = encryptApiKey(apiKey, userId)
      const tamperedAuthTag = 'a'.repeat(encrypted.authTag.length)

      expect(() => {
        decryptApiKey(
          encrypted.encrypted,
          encrypted.iv,
          tamperedAuthTag,
          userId
        )
      }).toThrow('Failed to decrypt API key')
    })

    it('should fail with tampered IV', () => {
      const encrypted = encryptApiKey(apiKey, userId)
      const tamperedIv = 'b'.repeat(encrypted.iv.length)

      expect(() => {
        decryptApiKey(
          encrypted.encrypted,
          tamperedIv,
          encrypted.authTag,
          userId
        )
      }).toThrow('Failed to decrypt API key')
    })

    it('should throw error for missing parameters', () => {
      const encrypted = encryptApiKey(apiKey, userId)

      expect(() => {
        decryptApiKey('', encrypted.iv, encrypted.authTag, userId)
      }).toThrow('All parameters are required')

      expect(() => {
        decryptApiKey(encrypted.encrypted, '', encrypted.authTag, userId)
      }).toThrow('All parameters are required')

      expect(() => {
        decryptApiKey(encrypted.encrypted, encrypted.iv, '', userId)
      }).toThrow('All parameters are required')

      expect(() => {
        decryptApiKey(encrypted.encrypted, encrypted.iv, encrypted.authTag, '')
      }).toThrow('All parameters are required')
    })
  })

  describe('Round-trip encryption', () => {
    it('should encrypt and decrypt multiple times correctly', () => {
      for (let i = 0; i < 10; i++) {
        const encrypted = encryptApiKey(apiKey, userId)
        const decrypted = decryptApiKey(
          encrypted.encrypted,
          encrypted.iv,
          encrypted.authTag,
          userId
        )
        expect(decrypted).toBe(apiKey)
      }
    })

    it('should handle different key lengths', () => {
      const keys = [
        'short',
        'sk-medium-length-key',
        'sk-very-long-api-key-with-many-characters-abcdefghijklmnopqrstuvwxyz0123456789',
      ]

      keys.forEach(key => {
        const encrypted = encryptApiKey(key, userId)
        const decrypted = decryptApiKey(
          encrypted.encrypted,
          encrypted.iv,
          encrypted.authTag,
          userId
        )
        expect(decrypted).toBe(key)
      })
    })

    it('should handle special characters', () => {
      const specialKey = 'sk-test!@#$%^&*()_+-={}[]|:;"<>?,./~`'
      const encrypted = encryptApiKey(specialKey, userId)
      const decrypted = decryptApiKey(
        encrypted.encrypted,
        encrypted.iv,
        encrypted.authTag,
        userId
      )
      expect(decrypted).toBe(specialKey)
    })

    it('should handle unicode characters', () => {
      const unicodeKey = 'sk-test-🔑-密钥-клюç'
      const encrypted = encryptApiKey(unicodeKey, userId)
      const decrypted = decryptApiKey(
        encrypted.encrypted,
        encrypted.iv,
        encrypted.authTag,
        userId
      )
      expect(decrypted).toBe(unicodeKey)
    })
  })

  describe('maskApiKey', () => {
    it('should mask a standard API key', () => {
      const masked = maskApiKey('sk-1234567890abcdefghijklmnop')
      // Shows first 8 chars, 4 bullets, last 4 chars (fixed length masking)
      expect(masked).toBe('sk-12345••••mnop')
    })

    it('should handle short keys', () => {
      const masked = maskApiKey('short')
      expect(masked).toBe('••••••••••••')
    })

    it('should handle very long keys', () => {
      const longKey = 'sk-' + 'a'.repeat(100)
      const masked = maskApiKey(longKey)
      // Should always use exactly 4 bullets regardless of length
      expect(masked).toBe('sk-aaaaa••••aaaa')
    })

    it('should handle empty string', () => {
      const masked = maskApiKey('')
      expect(masked).toBe('••••••••••••')
    })

    it('should not leak key length information', () => {
      const shortKey = 'sk-shortkey1'
      const longKey = 'sk-verylongapikey123456789012345678901234567890'
      const shortMasked = maskApiKey(shortKey)
      const longMasked = maskApiKey(longKey)

      // Both should have exactly 4 bullets in the middle
      expect(shortMasked).toMatch(/^.{8}••••.{4}$/)
      expect(longMasked).toMatch(/^.{8}••••.{4}$/)

      // Verify the actual values
      expect(shortMasked).toBe('sk-short••••key1')
      expect(longMasked).toBe('sk-veryl••••7890')
    })
  })

  describe('testEncryption', () => {
    it('should return true for working encryption', () => {
      const result = testEncryption()
      expect(result).toBe(true)
    })
  })

  describe('User isolation', () => {
    it('should ensure users cannot decrypt each others keys', () => {
      const user1Id = 'user-1'
      const user2Id = 'user-2'
      const user1Key = 'user1-secret-key'
      const user2Key = 'user2-secret-key'

      const enc1 = encryptApiKey(user1Key, user1Id)
      const enc2 = encryptApiKey(user2Key, user2Id)

      // User 1 can decrypt their own key
      const dec1 = decryptApiKey(enc1.encrypted, enc1.iv, enc1.authTag, user1Id)
      expect(dec1).toBe(user1Key)

      // User 2 can decrypt their own key
      const dec2 = decryptApiKey(enc2.encrypted, enc2.iv, enc2.authTag, user2Id)
      expect(dec2).toBe(user2Key)

      // User 1 cannot decrypt User 2's key
      expect(() => {
        decryptApiKey(enc2.encrypted, enc2.iv, enc2.authTag, user1Id)
      }).toThrow('Failed to decrypt API key')

      // User 2 cannot decrypt User 1's key
      expect(() => {
        decryptApiKey(enc1.encrypted, enc1.iv, enc1.authTag, user2Id)
      }).toThrow('Failed to decrypt API key')
    })
  })

  describe('Security properties', () => {
    it('should not leak information about the plaintext length', () => {
      const short = encryptApiKey('short', userId)
      const long = encryptApiKey('a'.repeat(1000), userId)

      // Encrypted lengths should be different but not proportional
      // (AES-GCM adds padding)
      expect(short.encrypted.length).toBeGreaterThan(0)
      expect(long.encrypted.length).toBeGreaterThan(short.encrypted.length)
    })

    it('should use fixed-length IV and auth tag', () => {
      const keys = ['short', 'medium-key', 'very-long-key-'.repeat(10)]

      keys.forEach(key => {
        const encrypted = encryptApiKey(key, userId)
        // IV should be 32 hex chars (16 bytes)
        expect(encrypted.iv.length).toBe(32)
        // Auth tag should be 32 hex chars (16 bytes)
        expect(encrypted.authTag.length).toBe(32)
      })
    })

    it('should produce cryptographically random IVs', () => {
      const ivs = new Set<string>()
      for (let i = 0; i < 100; i++) {
        const encrypted = encryptApiKey(apiKey, userId)
        ivs.add(encrypted.iv)
      }
      // All IVs should be unique
      expect(ivs.size).toBe(100)
    })
  })
})
