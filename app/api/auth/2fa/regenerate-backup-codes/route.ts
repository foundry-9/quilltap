import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { regenerateBackupCodes } from '@/lib/auth/totp'
import { logger } from '@/lib/logger'

/**
 * POST /api/auth/2fa/regenerate-backup-codes
 * Regenerate backup codes for a user with 2FA enabled
 */
export async function POST() {
  const session = await getServerSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await regenerateBackupCodes(session.user.id)

    if (!result.success) {
      return NextResponse.json(
        { error: '2FA is not enabled or backup codes could not be regenerated' },
        { status: 400 }
      )
    }

    logger.debug('Backup codes regenerated via API', {
      context: 'POST /api/auth/2fa/regenerate-backup-codes',
      userId: session.user.id,
    })

    return NextResponse.json({
      message: 'Backup codes regenerated successfully',
      backupCodes: result.backupCodes
    })
  } catch (error) {
    logger.error(
      'Regenerate backup codes API error',
      { context: 'POST /api/auth/2fa/regenerate-backup-codes' },
      error instanceof Error ? error : undefined
    )
    return NextResponse.json(
      { error: 'Failed to regenerate backup codes' },
      { status: 500 }
    )
  }
}
