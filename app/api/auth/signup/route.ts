import { NextRequest, NextResponse } from 'next/server'
import { getRepositories } from '@/lib/json-store/repositories'
import { hashPassword, validatePasswordStrength } from '@/lib/auth/password'
import { z } from 'zod'
import { logger } from '@/lib/logger'

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

    const repos = getRepositories()

    // Check if user already exists
    const existing = await repos.users.findByEmail(email)

    if (existing) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 409 }
      )
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Create user
    const user = await repos.users.create({
      email,
      name: name || null,
      passwordHash,
      emailVerified: new Date().toISOString(), // Auto-verify for now (can add email verification later)
    })

    return NextResponse.json({
      message: 'Account created successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      }
    }, { status: 201 })

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Signup error', { context: 'POST /api/auth/signup' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to create account' },
      { status: 500 }
    )
  }
}
