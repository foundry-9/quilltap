import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { hashPassword, verifyPassword, validatePasswordStrength } from '@/lib/auth/password'
import { getRepositories } from '@/lib/repositories/factory'
import { z } from 'zod'
import { logger } from '@/lib/logger'

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
})

/**
 * POST /api/auth/change-password
 * Change the current user's password
 *
 * Requires:
 * - Valid session
 * - User has a password set (not OAuth-only)
 * - Current password matches
 * - New password meets strength requirements
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const { currentPassword, newPassword } = ChangePasswordSchema.parse(body)

    // Get the user's current password hash
    const repos = getRepositories()
    const user = await repos.users.findById(session.user.id)

    if (!user) {
      logger.warn('User not found for password change', {
        context: 'POST /api/auth/change-password',
        userId: session.user.id,
      })
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Check if user has a password set
    if (!user.passwordHash) {
      logger.warn('User attempted password change without existing password', {
        context: 'POST /api/auth/change-password',
        userId: session.user.id,
      })
      return NextResponse.json(
        { error: 'Cannot change password - no password set. This account uses OAuth login.' },
        { status: 400 }
      )
    }

    // Verify current password
    const isCurrentPasswordValid = await verifyPassword(currentPassword, user.passwordHash)

    if (!isCurrentPasswordValid) {
      logger.info('Password change failed - incorrect current password', {
        context: 'POST /api/auth/change-password',
        userId: session.user.id,
      })
      return NextResponse.json(
        { error: 'Current password is incorrect' },
        { status: 400 }
      )
    }

    // Validate new password strength
    const passwordStrength = validatePasswordStrength(newPassword)
    if (!passwordStrength.valid) {
      return NextResponse.json(
        {
          error: 'New password does not meet requirements',
          requirements: passwordStrength.errors,
        },
        { status: 400 }
      )
    }

    // Check that new password is different from current
    const isSamePassword = await verifyPassword(newPassword, user.passwordHash)
    if (isSamePassword) {
      return NextResponse.json(
        { error: 'New password must be different from current password' },
        { status: 400 }
      )
    }

    // Hash new password and update user
    const newPasswordHash = await hashPassword(newPassword)

    await repos.users.update(session.user.id, {
      passwordHash: newPasswordHash,
    })

    logger.info('Password changed successfully', {
      context: 'POST /api/auth/change-password',
      userId: session.user.id,
    })

    return NextResponse.json({
      message: 'Password changed successfully',
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(
      'Password change error',
      { context: 'POST /api/auth/change-password' },
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Failed to change password' },
      { status: 500 }
    )
  }
}
