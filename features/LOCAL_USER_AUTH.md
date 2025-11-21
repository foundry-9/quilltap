# Local User Authentication with TOTP 2FA

> **Feature Status**: Planned
> **Priority**: Medium
> **Estimated Effort**: 7-10 development days
> **Target Phase**: Post-1.0 (v1.1 or v1.2)

## Overview

This document outlines the implementation plan for adding email/password authentication with TOTP (Time-based One-Time Password) two-factor authentication to Quilltap. This feature will complement the existing OAuth authentication system, allowing users to create accounts with just an email and password, secured by optional TOTP 2FA compatible with any authenticator app (1Password, Google Authenticator, Authy, etc.).

## Current Authentication System

Quilltap currently uses:

- **NextAuth.js v4.24.7** for authentication
- **Google OAuth** as the sole authentication provider
- **PostgreSQL + Prisma ORM** for user storage
- **Database sessions** (not JWT) for session management
- **AES-256-GCM encryption** infrastructure for secure data storage

### Existing Security Infrastructure

We already have:

- ✅ Encryption service with AES-256-GCM (`lib/encryption.ts`)
- ✅ Per-user encryption keys derived using PBKDF2 (100,000 iterations)
- ✅ Master pepper approach for key derivation
- ✅ Rate limiting middleware
- ✅ Security headers and input validation
- ✅ Session management infrastructure

## Motivation

### Why Add Email/Password Auth?

1. **User Choice**: Some users prefer not to use OAuth or don't have Google accounts
2. **Self-Hosting**: Self-hosted instances may want local-only authentication
3. **Enterprise Use**: Corporate environments often require internal authentication
4. **Privacy**: Users who want to minimize OAuth provider tracking
5. **Flexibility**: Provides authentication redundancy

### Why TOTP 2FA?

1. **Security**: Adds significant protection against password compromise
2. **Standards-Based**: TOTP (RFC 6238) works with all major authenticator apps
3. **No SMS Required**: More secure than SMS-based 2FA
4. **User Control**: Users can use their preferred authenticator app
5. **Offline Support**: TOTP works without internet connectivity

## Technical Architecture

### Database Schema Changes

#### User Model Extensions

```prisma
model User {
  id                String    @id @default(uuid())
  email             String    @unique
  name              String?
  image             String?
  emailVerified     DateTime?

  // New fields for password authentication
  passwordHash      String?   // bcrypt hash (nullable for OAuth-only users)

  // New fields for TOTP 2FA
  totpSecret        String?   // Encrypted TOTP secret
  totpSecretIv      String?   // IV for TOTP secret encryption
  totpSecretAuthTag String?   // Auth tag for TOTP secret encryption
  totpEnabled       Boolean   @default(false)
  totpVerifiedAt    DateTime? // When 2FA was set up
  backupCodes       String?   // Encrypted JSON array of backup codes
  backupCodesIv     String?
  backupCodesAuthTag String?

  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  // Existing relations
  accounts          Account[]
  sessions          Session[]
  apiKeys           ApiKey[]
  profiles          ConnectionProfile[]
  characters        Character[]
  personas          Persona[]
  chats             Chat[]
  images            Image[]
  tags              Tag[]
  chatSettings      ChatSetting[]
}
```

**Design Decisions:**

1. **Nullable passwordHash**: Allows users to have OAuth-only accounts or password accounts (or both)
2. **Encrypted TOTP Secret**: Uses existing encryption infrastructure for secure storage
3. **Backup Codes**: Encrypted array of one-time-use codes for account recovery
4. **totpVerifiedAt**: Tracks when 2FA was set up for auditing

### New Dependencies

```json
{
  "dependencies": {
    "bcrypt": "^5.1.1",       // Password hashing with salt
    "speakeasy": "^2.0.0",    // TOTP generation and verification
    "qrcode": "^1.5.3"        // QR code generation for 2FA setup
  },
  "devDependencies": {
    "@types/bcrypt": "^5.0.2",
    "@types/speakeasy": "^2.0.10",
    "@types/qrcode": "^1.5.5"
  }
}
```

**Why These Libraries?**

- **bcrypt**: Industry standard, slow by design (prevents brute force), automatic salt generation
- **speakeasy**: Well-maintained TOTP library, compatible with all authenticators
- **qrcode**: Simple QR code generation for easy 2FA setup

## Implementation Plan

### Phase 1: Password Authentication (2-3 days) ✅ COMPLETED

#### 1.1: Database Migration ✅

**Status**: COMPLETED

Create Prisma migration for new User fields:

```bash
npx prisma migrate dev --name add_password_and_totp_fields
```

#### 1.2: Password Utilities ✅

**Status**: COMPLETED

Create `lib/auth/password.ts`:

```typescript
import bcrypt from 'bcrypt'

const SALT_ROUNDS = 12 // Industry standard

/**
 * Hash a password with bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/**
 * Validate password strength
 * Requirements:
 * - At least 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
export function validatePasswordStrength(password: string): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters')
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter')
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter')
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number')
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character')
  }

  return {
    valid: errors.length === 0,
    errors
  }
}
```

#### 1.3: NextAuth Credentials Provider ✅

**Status**: COMPLETED

Update `lib/auth.ts` to add CredentialsProvider:

```typescript
import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials'
import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/auth/password'

export const authOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      id: 'credentials',
      name: 'Email and Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totpCode: { label: '2FA Code (if enabled)', type: 'text' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Email and password required')
        }

        // Find user
        const user = await prisma.user.findUnique({
          where: { email: credentials.email }
        })

        if (!user || !user.passwordHash) {
          throw new Error('Invalid email or password')
        }

        // Verify password
        const valid = await verifyPassword(
          credentials.password,
          user.passwordHash
        )

        if (!valid) {
          throw new Error('Invalid email or password')
        }

        // Check if 2FA is enabled
        if (user.totpEnabled) {
          if (!credentials.totpCode) {
            throw new Error('2FA code required')
          }

          // Verify TOTP (implemented in Phase 2)
          const totpValid = await verifyTOTP(user.id, credentials.totpCode)

          if (!totpValid) {
            throw new Error('Invalid 2FA code')
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        }
      },
    }),
  ],
  session: {
    strategy: 'database', // Use existing database sessions
  },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id
      return session
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  debug: process.env.NODE_ENV === 'development',
}
```

#### 1.4: Signup API Endpoint ✅

**Status**: COMPLETED

Create `app/api/auth/signup/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, validatePasswordStrength } from '@/lib/auth/password'
import { z } from 'zod'

const SignupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password, name } = SignupSchema.parse(body)

    // Validate password strength
    const validation = validatePasswordStrength(password)
    if (!validation.valid) {
      return NextResponse.json(
        { error: 'Password does not meet requirements', details: validation.errors },
        { status: 400 }
      )
    }

    // Check if user already exists
    const existing = await prisma.user.findUnique({
      where: { email }
    })

    if (existing) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 409 }
      )
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        emailVerified: new Date(), // Auto-verify for now (can add email verification later)
      },
      select: {
        id: true,
        email: true,
        name: true,
      }
    })

    return NextResponse.json({
      message: 'Account created successfully',
      user
    }, { status: 201 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Signup error:', error)
    return NextResponse.json(
      { error: 'Failed to create account' },
      { status: 500 }
    )
  }
}
```

#### 1.5: Signup UI ✅

**Status**: COMPLETED

Create `app/auth/signup/page.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Signup failed')
      }

      // Redirect to signin
      router.push('/auth/signin?message=Account created. Please sign in.')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
        <h2 className="text-3xl font-bold text-center">Create Account</h2>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSignup} className="space-y-6">
          <div>
            <label htmlFor="name" className="block text-sm font-medium">
              Name (optional)
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full rounded border-gray-300 shadow-sm"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded border-gray-300 shadow-sm"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded border-gray-300 shadow-sm"
            />
            <p className="mt-1 text-sm text-gray-500">
              Must be at least 8 characters with uppercase, lowercase, number, and special character
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Sign Up'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-600">
          Already have an account?{' '}
          <Link href="/auth/signin" className="text-blue-600 hover:text-blue-700">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
```

#### 1.6: Update Signin Page ✅

**Status**: COMPLETED

Update `app/auth/signin/page.tsx` to support both OAuth and credentials:

```typescript
'use client'

import { signIn } from 'next-auth/react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SignInPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCredentialsSignIn(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await signIn('credentials', {
        email,
        password,
        totpCode: needsTotp ? totpCode : undefined,
        redirect: false
      })

      if (result?.error) {
        if (result.error === '2FA code required') {
          setNeedsTotp(true)
          setError('Please enter your 2FA code')
        } else {
          setError(result.error)
        }
      } else {
        router.push('/dashboard')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogleSignIn() {
    await signIn('google', { callbackUrl: '/dashboard' })
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
        <h2 className="text-3xl font-bold text-center">Sign In</h2>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {/* OAuth Sign In */}
        <div>
          <button
            onClick={handleGoogleSignIn}
            className="w-full flex items-center justify-center gap-2 bg-white border border-gray-300 py-2 px-4 rounded hover:bg-gray-50"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              {/* Google icon SVG */}
            </svg>
            Continue with Google
          </button>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-gray-500">Or</span>
          </div>
        </div>

        {/* Email/Password Sign In */}
        <form onSubmit={handleCredentialsSignIn} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded border-gray-300 shadow-sm"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded border-gray-300 shadow-sm"
            />
          </div>

          {needsTotp && (
            <div>
              <label htmlFor="totpCode" className="block text-sm font-medium">
                2FA Code
              </label>
              <input
                id="totpCode"
                type="text"
                required
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="000000"
                maxLength={6}
                className="mt-1 block w-full rounded border-gray-300 shadow-sm"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-600">
          Don't have an account?{' '}
          <Link href="/auth/signup" className="text-blue-600 hover:text-blue-700">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
```

### Phase 2: TOTP 2FA Implementation (3-4 days)

#### 2.1: TOTP Utilities ✅

**Status**: COMPLETED

Create `lib/auth/totp.ts`:

```typescript
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
```

#### 2.2: Update Encryption Library ✅

**Status**: COMPLETED

Update `lib/encryption.ts` to add helper functions:

```typescript
/**
 * Generic encrypt function that wraps encryptApiKey
 */
export function encryptData(data: string, userId: string) {
  return encryptApiKey(data, userId)
}

/**
 * Generic decrypt function that wraps decryptApiKey
 */
export function decryptData(
  encrypted: string,
  iv: string,
  authTag: string,
  userId: string
): string {
  return decryptApiKey(encrypted, iv, authTag, userId)
}
```

#### 2.3: 2FA Setup API

Create `app/api/auth/2fa/setup/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { generateTOTPSecret } from '@/lib/auth/totp'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, totpEnabled: true }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (user.totpEnabled) {
      return NextResponse.json(
        { error: '2FA is already enabled' },
        { status: 400 }
      )
    }

    const { secret, qrCode, encrypted } = await generateTOTPSecret(
      session.user.id,
      user.email
    )

    return NextResponse.json({
      secret, // Show to user for manual entry
      qrCode, // Show QR code for scanning
      encrypted // Store temporarily in client for verification
    })
  } catch (error) {
    console.error('2FA setup error:', error)
    return NextResponse.json(
      { error: 'Failed to generate 2FA secret' },
      { status: 500 }
    )
  }
}
```

Create `app/api/auth/2fa/enable/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { enableTOTP } from '@/lib/auth/totp'
import { z } from 'zod'

const EnableTOTPSchema = z.object({
  encryptedSecret: z.string(),
  encryptedIv: z.string(),
  encryptedAuthTag: z.string(),
  verificationCode: z.string().length(6)
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { encryptedSecret, encryptedIv, encryptedAuthTag, verificationCode } =
      EnableTOTPSchema.parse(body)

    const result = await enableTOTP(
      session.user.id,
      encryptedSecret,
      encryptedIv,
      encryptedAuthTag,
      verificationCode
    )

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid verification code' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      message: '2FA enabled successfully',
      backupCodes: result.backupCodes
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Enable 2FA error:', error)
    return NextResponse.json(
      { error: 'Failed to enable 2FA' },
      { status: 500 }
    )
  }
}
```

Create `app/api/auth/2fa/disable/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { disableTOTP } from '@/lib/auth/totp'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const success = await disableTOTP(session.user.id)

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to disable 2FA' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: '2FA disabled successfully'
    })
  } catch (error) {
    console.error('Disable 2FA error:', error)
    return NextResponse.json(
      { error: 'Failed to disable 2FA' },
      { status: 500 }
    )
  }
}
```

#### 2.4: 2FA Setup UI

Create `app/(authenticated)/settings/security/page.tsx`:

```typescript
'use client'

import { useState } from 'react'
import Image from 'next/image'

export default function SecuritySettingsPage() {
  const [setupStep, setSetupStep] = useState<'idle' | 'qr' | 'verify' | 'complete'>('idle')
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [encryptedData, setEncryptedData] = useState<any>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSetup2FA() {
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/2fa/setup', {
        method: 'POST'
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to setup 2FA')
      }

      const data = await res.json()
      setQrCode(data.qrCode)
      setSecret(data.secret)
      setEncryptedData(data.encrypted)
      setSetupStep('qr')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify() {
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encryptedSecret: encryptedData.secret,
          encryptedIv: encryptedData.iv,
          encryptedAuthTag: encryptedData.authTag,
          verificationCode
        })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to enable 2FA')
      }

      const data = await res.json()
      setBackupCodes(data.backupCodes)
      setSetupStep('complete')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDisable2FA() {
    if (!confirm('Are you sure you want to disable 2FA? This will make your account less secure.')) {
      return
    }

    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/2fa/disable', {
        method: 'POST'
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to disable 2FA')
      }

      setSetupStep('idle')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Security Settings</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Two-Factor Authentication</h2>

        {setupStep === 'idle' && (
          <div>
            <p className="text-gray-600 mb-4">
              Add an extra layer of security to your account by requiring a code from your
              authenticator app when signing in.
            </p>
            <button
              onClick={handleSetup2FA}
              disabled={loading}
              className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Setting up...' : 'Enable 2FA'}
            </button>
          </div>
        )}

        {setupStep === 'qr' && (
          <div className="space-y-4">
            <p className="text-gray-600">
              Scan this QR code with your authenticator app (1Password, Google Authenticator, Authy, etc.)
            </p>

            {qrCode && (
              <div className="flex justify-center">
                <Image src={qrCode} alt="2FA QR Code" width={200} height={200} />
              </div>
            )}

            <div>
              <p className="text-sm text-gray-600 mb-2">
                Or enter this code manually:
              </p>
              <code className="block bg-gray-100 p-2 rounded font-mono text-sm">
                {secret}
              </code>
            </div>

            <div>
              <label htmlFor="verificationCode" className="block text-sm font-medium mb-2">
                Enter the 6-digit code from your app:
              </label>
              <input
                id="verificationCode"
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                placeholder="000000"
                maxLength={6}
                className="block w-full rounded border-gray-300 shadow-sm"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleVerify}
                disabled={loading || verificationCode.length !== 6}
                className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify and Enable'}
              </button>
              <button
                onClick={() => setSetupStep('idle')}
                disabled={loading}
                className="bg-gray-300 text-gray-700 py-2 px-4 rounded hover:bg-gray-400 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {setupStep === 'complete' && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded">
              2FA has been enabled successfully!
            </div>

            <div>
              <p className="font-semibold mb-2">Save these backup codes</p>
              <p className="text-sm text-gray-600 mb-4">
                If you lose access to your authenticator app, you can use these codes to sign in.
                Each code can only be used once. Store them in a safe place.
              </p>

              <div className="bg-gray-100 p-4 rounded">
                <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                  {backupCodes.map((code, index) => (
                    <div key={index}>{code}</div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => {
                  const text = backupCodes.join('\n')
                  navigator.clipboard.writeText(text)
                  alert('Backup codes copied to clipboard')
                }}
                className="mt-4 text-sm text-blue-600 hover:text-blue-700"
              >
                Copy backup codes
              </button>
            </div>

            <button
              onClick={() => window.location.reload()}
              className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700"
            >
              Done
            </button>
          </div>
        )}
      </div>

      {/* Disable 2FA section (show if already enabled) */}
      <div className="bg-white rounded-lg shadow p-6 mt-6">
        <h2 className="text-xl font-semibold mb-4">Disable 2FA</h2>
        <p className="text-gray-600 mb-4">
          This will remove two-factor authentication from your account.
        </p>
        <button
          onClick={handleDisable2FA}
          disabled={loading}
          className="bg-red-600 text-white py-2 px-4 rounded hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? 'Disabling...' : 'Disable 2FA'}
        </button>
      </div>
    </div>
  )
}
```

### Phase 3: Additional Features (2-3 days)

#### 3.1: Password Reset Flow

Create `app/api/auth/reset-password/route.ts`:

```typescript
// Implementation for password reset email flow
// - Send reset token via email
// - Verify token and allow password change
// - Invalidate old sessions
```

#### 3.2: Email Verification (Optional)

Currently auto-verifying emails. Can add:

- Email verification tokens
- Send verification email on signup
- Require verification before allowing signin

#### 3.3: Account Linking

Allow users to link both OAuth and password authentication:

- OAuth user can add a password
- Password user can link OAuth providers
- Manage linked accounts in settings

## Security Considerations

### Password Security

1. **Hashing**: bcrypt with 12 rounds (industry standard)
2. **Validation**: Strong password requirements enforced
3. **Rate Limiting**: Limit login attempts to prevent brute force
4. **No Password Storage**: Only store bcrypt hashes

### TOTP Security

1. **Encryption**: TOTP secrets encrypted at rest with AES-256-GCM
2. **Per-User Keys**: Each user has unique encryption key
3. **Backup Codes**: Encrypted recovery codes for account recovery
4. **Clock Drift**: Allow 1 time step window for TOTP verification
5. **One-Time Use**: Backup codes invalidated after use

### Session Security

1. **Database Sessions**: Use existing database session strategy
2. **Session Rotation**: Rotate session on authentication
3. **Logout**: Properly invalidate sessions on logout

### Best Practices

1. **2FA Enforcement**: Allow admins to require 2FA for all users (future)
2. **Audit Logging**: Log authentication events
3. **Rate Limiting**: Prevent brute force attacks
4. **Account Lockout**: Temporary lockout after failed attempts (future)

## Testing Strategy

### Unit Tests

- [ ] Password hashing and verification
- [ ] Password strength validation
- [ ] TOTP secret generation
- [ ] TOTP code verification
- [ ] Backup code generation and verification
- [ ] Encryption of TOTP secrets

### Integration Tests

- [ ] User signup flow
- [ ] User signin with credentials
- [ ] User signin with 2FA
- [ ] 2FA setup flow
- [ ] 2FA disable flow
- [ ] Backup code usage
- [ ] Password reset flow

### E2E Tests

- [ ] Complete signup and signin
- [ ] Enable 2FA and sign in with 2FA
- [ ] Use backup code to sign in
- [ ] Disable 2FA

## API Endpoints Summary

### Authentication

- `POST /api/auth/signup` - Create new account
- `POST /api/auth/signin` - Sign in (handled by NextAuth)
- `POST /api/auth/signout` - Sign out (handled by NextAuth)

### 2FA Management

- `POST /api/auth/2fa/setup` - Generate TOTP secret and QR code
- `POST /api/auth/2fa/enable` - Enable 2FA with verification
- `POST /api/auth/2fa/disable` - Disable 2FA

### Password Management (Future)

- `POST /api/auth/reset-password` - Request password reset
- `POST /api/auth/reset-password/confirm` - Confirm password reset
- `POST /api/auth/change-password` - Change password (authenticated)

## User Experience Flow

### Signup Flow

1. User visits `/auth/signup`
2. Enters email, password, optional name
3. Password strength validated in real-time
4. Account created, redirected to signin

### Signin Flow

1. User visits `/auth/signin`
2. Option 1: Click "Continue with Google" (OAuth)
3. Option 2: Enter email and password
4. If 2FA enabled: Enter 6-digit code
5. Successful auth: Redirect to `/dashboard`

### 2FA Setup Flow

1. User goes to Settings → Security
2. Clicks "Enable 2FA"
3. Scans QR code with authenticator app
4. Enters verification code from app
5. Receives backup codes (must save!)
6. 2FA now required for signin

## Migration Path

### For Existing Users

1. Existing OAuth users: Unaffected, continue using OAuth
2. Optional: OAuth users can add password in settings
3. Optional: OAuth users can enable 2FA

### For New Users

1. Choice at signup: OAuth or Email/Password
2. Email/Password users: Encouraged to enable 2FA

## Environment Variables

Add to `.env.example`:

```env
# Authentication
# Existing OAuth variables unchanged...

# No additional environment variables needed!
# Uses existing encryption infrastructure
```

## Documentation Updates

### README.md Updates

- Add "Email/Password authentication" to features list
- Update "Authentication" section to mention both OAuth and credentials
- Add note about TOTP 2FA support

### ROADMAP.md Updates

- Add Phase 1.1 or 1.2 for local authentication
- List as "Planned" or "In Progress" as appropriate

## Future Enhancements

### v1.2+

- [ ] Email verification flow
- [ ] Password reset via email
- [ ] Account linking (OAuth + password)
- [ ] Admin: Enforce 2FA for all users
- [ ] Admin: View authentication methods
- [ ] Session management (view/revoke active sessions)
- [ ] Login history and audit log
- [ ] Account lockout after failed attempts
- [ ] Passwordless authentication (magic links)

### v2.0+

- [ ] WebAuthn/Passkey support
- [ ] Hardware security key support (YubiKey, etc.)
- [ ] Social login (GitHub, Apple, Microsoft)
- [ ] SSO support (SAML, LDAP)
- [ ] Multi-organization support with separate auth

## FAQ

### Q: Why not just use OAuth?

**A**: OAuth is great, but some users prefer email/password for:

- Privacy (no Google dependency)
- Self-hosting requirements
- Corporate/enterprise environments
- Personal preference

### Q: Is TOTP secure?

**A**: Yes, TOTP (RFC 6238) is an industry standard:

- Used by Google, GitHub, AWS, etc.
- More secure than SMS 2FA
- Works offline
- Compatible with all major authenticator apps

### Q: What if I lose my authenticator app?

**A**: Use backup codes! Each user gets 10 one-time-use codes during 2FA setup. Store them securely.

### Q: Can I use both OAuth and password?

**A**: Yes! Account linking will allow users to have multiple authentication methods (future enhancement).

### Q: What about password complexity?

**A**: Requirements:

- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character

These are enforced on both client and server.

### Q: How are TOTP secrets stored?

**A**: Encrypted using the same AES-256-GCM encryption infrastructure that protects API keys. Each user has a unique encryption key derived from their user ID and a master pepper.

## Dependencies

### Production Dependencies

```json
{
  "bcrypt": "^5.1.1",
  "speakeasy": "^2.0.0",
  "qrcode": "^1.5.3"
}
```

### Dev Dependencies

```json
{
  "@types/bcrypt": "^5.0.2",
  "@types/speakeasy": "^2.0.10",
  "@types/qrcode": "^1.5.5"
}
```

### No Breaking Changes

- All new dependencies are additive
- Existing OAuth flow unchanged
- Backward compatible with existing users

## Success Criteria

### Phase 1 Complete When

- [ ] Users can create accounts with email/password
- [ ] Users can sign in with email/password
- [ ] Password strength validation works
- [ ] NextAuth CredentialsProvider integrated
- [ ] Unit tests passing

### Phase 2 Complete When

- [ ] Users can enable TOTP 2FA
- [ ] QR code generation works
- [ ] TOTP verification works during signin
- [ ] Backup codes generation and usage works
- [ ] Users can disable 2FA
- [ ] Integration tests passing

### Phase 3 Complete When

- [ ] Password reset flow works (if implemented)
- [ ] Email verification works (if implemented)
- [ ] E2E tests passing
- [ ] Documentation updated

## Rollout Plan

### Development

1. Create feature branch: `feature/local-auth`
2. Implement Phase 1 (password auth)
3. Test thoroughly in development
4. Implement Phase 2 (TOTP 2FA)
5. Test 2FA flow
6. Code review

### Staging

1. Deploy to staging environment
2. Test all flows manually
3. Test with multiple authenticator apps
4. Security review

### Production

1. Merge to main
2. Deploy to production
3. Monitor logs for errors
4. Gradual rollout (feature flag if needed)
5. Announce to users

## Estimated Timeline

- **Phase 1 (Password Auth)**: 2-3 days
- **Phase 2 (TOTP 2FA)**: 3-4 days
- **Testing & Polish**: 2-3 days
- **Total**: 7-10 days

## Resources

### Documentation

- [NextAuth Credentials Provider](https://next-auth.js.org/providers/credentials)
- [bcrypt Documentation](https://github.com/kelektiv/node.bcrypt.js)
- [Speakeasy Documentation](https://github.com/speakeasyjs/speakeasy)
- [RFC 6238 - TOTP](https://datatracker.ietf.org/doc/html/rfc6238)

### Security Best Practices

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [NIST Digital Identity Guidelines](https://pages.nist.gov/800-63-3/)

---

**Document Version**: 1.0
**Last Updated**: 2025-11-21
**Author**: Foundry-9
**Status**: Awaiting Approval
