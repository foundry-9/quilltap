/**
 * TOTP (Time-based One-Time Password) utilities for 2FA
 * Phase 2.1: TOTP Implementation
 */

import speakeasy from 'speakeasy'
import qrcode from 'qrcode'
import { encryptData, decryptData } from '@/lib/encryption'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

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
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      totpSecret: true,
      totpSecretIv: true,
      totpSecretAuthTag: true,
      totpEnabled: true,
      backupCodes: true,
      backupCodesIv: true,
      backupCodesAuthTag: true
    }
  })

  if (!user || !user.totpEnabled) {
    return false
  }

  // First try TOTP verification
  if (user.totpSecret && user.totpSecretIv && user.totpSecretAuthTag) {
    try {
      const decryptedSecret = decryptData(
        user.totpSecret,
        user.totpSecretIv,
        user.totpSecretAuthTag,
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
      console.error('TOTP verification error:', error)
    }
  }

  // If TOTP fails and checkBackupCode is true, try backup codes
  if (checkBackupCode && user.backupCodes && user.backupCodesIv && user.backupCodesAuthTag) {
    try {
      const decryptedCodes = decryptData(
        user.backupCodes,
        user.backupCodesIv,
        user.backupCodesAuthTag,
        userId
      )

      const backupCodes = JSON.parse(decryptedCodes) as string[]

      // Check if provided token matches any backup code
      const codeIndex = backupCodes.findIndex(code => code === token)

      if (codeIndex !== -1) {
        // Remove used backup code
        backupCodes.splice(codeIndex, 1)

        // Re-encrypt remaining codes
        const encrypted = encryptData(JSON.stringify(backupCodes), userId)

        await prisma.user.update({
          where: { id: userId },
          data: {
            backupCodes: encrypted.encrypted,
            backupCodesIv: encrypted.iv,
            backupCodesAuthTag: encrypted.authTag
          }
        })

        return true
      }
    } catch (error) {
      console.error('Backup code verification error:', error)
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
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true }
  })

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
    const encryptedBackupCodes = encryptData(
      JSON.stringify(backupCodes),
      userId
    )

    // Save to database
    await prisma.user.update({
      where: { id: userId },
      data: {
        totpSecret: encryptedSecret,
        totpSecretIv: encryptedIv,
        totpSecretAuthTag: encryptedAuthTag,
        totpEnabled: true,
        totpVerifiedAt: new Date(),
        backupCodes: encryptedBackupCodes.encrypted,
        backupCodesIv: encryptedBackupCodes.iv,
        backupCodesAuthTag: encryptedBackupCodes.authTag
      }
    })

    return { success: true, backupCodes }
  } catch (error) {
    console.error('Enable TOTP error:', error)
    return { success: false }
  }
}

/**
 * Disable TOTP for a user
 */
export async function disableTOTP(userId: string): Promise<boolean> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        totpSecret: null,
        totpSecretIv: null,
        totpSecretAuthTag: null,
        totpEnabled: false,
        totpVerifiedAt: null,
        backupCodes: null,
        backupCodesIv: null,
        backupCodesAuthTag: null
      }
    })
    return true
  } catch (error) {
    console.error('Disable TOTP error:', error)
    return false
  }
}
