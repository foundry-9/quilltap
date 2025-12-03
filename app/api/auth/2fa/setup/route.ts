import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth/session'
import { generateTOTPSecret } from '@/lib/auth/totp'
import { getRepositories } from '@/lib/json-store/repositories'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const session = await getServerSession()

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const repos = getRepositories()
    const user = await repos.users.findById(session.user.id)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (user.totp?.enabled) {
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
    logger.error('2FA setup error', { context: 'POST /api/auth/2fa/setup' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to generate 2FA secret' },
      { status: 500 }
    )
  }
}
