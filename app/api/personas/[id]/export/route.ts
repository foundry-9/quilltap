/**
 * Persona Export API
 * GET /api/personas/:id/export - Export a persona in SillyTavern format
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { exportSTPersona } from '@/lib/sillytavern/persona'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Get persona
    const persona = await prisma.persona.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
    })

    if (!persona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    // Export to SillyTavern format
    const stPersona = exportSTPersona(persona)

    // Return as JSON with download headers
    return new NextResponse(JSON.stringify(stPersona, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${persona.name}_persona.json"`,
      },
    })
  } catch (error) {
    console.error('Error exporting persona:', error)
    return NextResponse.json(
      { error: 'Failed to export persona' },
      { status: 500 }
    )
  }
}
