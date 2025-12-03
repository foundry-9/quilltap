import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { disableTOTP } from '@/lib/auth/totp'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const session = await getServerSession()

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
    logger.error('Disable 2FA error', { context: 'POST /api/auth/2fa/disable' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to disable 2FA' },
      { status: 500 }
    )
  }
}
