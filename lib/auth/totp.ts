/**
 * TOTP (Time-based One-Time Password) utilities for 2FA
 * Phase 2.1: TOTP Implementation
 */

import speakeasy from 'speakeasy'
import qrcode from 'qrcode'
import { encryptData, decryptData } from '@/lib/encryption'
import { UsersRepository } from '@/lib/json-store/repositories/users.repository'
import { getJsonStore } from '@/lib/json-store/core/json-store'
import { logger } from '@/lib/logger'
import crypto from 'crypto'

const usersRepo = new UsersRepository(getJsonStore())

/**
 * Generate a TOTP secret for a user
 */
export async function generateTOTPSecret(userId: string, userEmail: string) {
  const secret = speakeasy.generateSecret({
    name: `Quilltap (${userEmail})`,
    issuer: 'Quilltap',
    length: 32
  })

  // Encrypt the secret
  const encrypted = encryptData(secret.base32, userId)

  // Generate QR code
  const qrCodeDataUrl = await qrcode.toDataURL(secret.otpauth_url!)

  return {
    secret: secret.base32, // Return unencrypted for display during setup
    qrCode: qrCodeDataUrl,
    encrypted: {
      secret: encrypted.encrypted,
      iv: encrypted.iv,
      authTag: encrypted.authTag
    }
  }
}

/**
 * Verify a TOTP code
 */
export async function verifyTOTP(
  userId: string,
  token: string,
  checkBackupCode: boolean = true
): Promise<boolean> {
  const user = await usersRepo.findById(userId)

  if (!user || !user.totp?.enabled) {
    return false
  }

  // First try TOTP verification
  if (user.totp?.ciphertext && user.totp?.iv && user.totp?.authTag) {
    try {
      const decryptedSecret = decryptData(
        user.totp.ciphertext,
        user.totp.iv,
        user.totp.authTag,
        userId
      )

      const valid = speakeasy.totp.verify({
        secret: decryptedSecret,
        encoding: 'base32',
        token,
        window: 1 // Allow 1 time step before/after for clock drift
      })

      if (valid) {
        return true
      }
    } catch (error) {
      logger.error('TOTP verification error', { context: 'verifyTOTP', userId }, error instanceof Error ? error : undefined)
    }
  }

  // If TOTP fails and checkBackupCode is true, try backup codes
  if (checkBackupCode && user.backupCodes?.ciphertext) {
    try {
      const decryptedCodes = decryptData(
        user.backupCodes.ciphertext,
        user.backupCodes.iv,
        user.backupCodes.authTag,
        userId
      )

      const backupCodes = JSON.parse(decryptedCodes) as string[]

      // Check if provided token matches any backup code
      const codeIndex = backupCodes.findIndex(code => code === token)

      if (codeIndex !== -1) {
        // Remove used backup code
        backupCodes.splice(codeIndex, 1)

        // TODO: Update user with remaining backup codes
        // Note: Need to store encrypted backup codes in user object
        // This will be handled in a future update to the User schema

        return true
      }
    } catch (error) {
      logger.error('Backup code verification error', { context: 'verifyTOTP', userId }, error instanceof Error ? error : undefined)
    }
  }

  return false
}

/**
 * Generate backup codes
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = []

  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric codes
    const code = crypto.randomBytes(4).toString('hex').toUpperCase()
    codes.push(code)
  }

  return codes
}

/**
 * Enable TOTP for a user
 */
export async function enableTOTP(
  userId: string,
  encryptedSecret: string,
  encryptedIv: string,
  encryptedAuthTag: string,
  verificationCode: string
): Promise<{ success: boolean; backupCodes?: string[] }> {
  // First verify the code works
  const user = await usersRepo.findById(userId)

  if (!user) {
    return { success: false }
  }

  // Decrypt and verify the secret
  try {
    const decryptedSecret = decryptData(
      encryptedSecret,
      encryptedIv,
      encryptedAuthTag,
      userId
    )

    const valid = speakeasy.totp.verify({
      secret: decryptedSecret,
      encoding: 'base32',
      token: verificationCode,
      window: 1
    })

    if (!valid) {
      return { success: false }
    }

    // Generate backup codes
    const backupCodes = generateBackupCodes()

    // Save to JSON store
    await usersRepo.update(userId, {
      totp: {
        ciphertext: encryptedSecret,
        iv: encryptedIv,
        authTag: encryptedAuthTag,
        enabled: true,
      },
    })

    return { success: true, backupCodes }
  } catch (error) {
    logger.error('Enable TOTP error', { context: 'enableTOTP', userId }, error instanceof Error ? error : undefined)
    return { success: false }
  }
}

/**
 * Disable TOTP for a user
 */
export async function disableTOTP(userId: string): Promise<boolean> {
  try {
    await usersRepo.update(userId, {
      totp: undefined,
    })
    return true
  } catch (error) {
    logger.error('Disable TOTP error', { context: 'disableTOTP', userId }, error instanceof Error ? error : undefined)
    return false
  }
}
