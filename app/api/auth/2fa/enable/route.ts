import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { enableTOTP } from '@/lib/auth/totp'
import { z } from 'zod'
import { logger } from '@/lib/logger'

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

    logger.error('Enable 2FA error', { context: 'POST /api/auth/2fa/enable' }, error instanceof Error ? error : undefined)
    return NextResponse.json(
      { error: 'Failed to enable 2FA' },
      { status: 500 }
    )
  }
}
