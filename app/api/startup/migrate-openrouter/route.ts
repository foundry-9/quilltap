/**
 * Startup Migration: Convert OpenAI-compatible OpenRouter profiles to native OpenRouter provider
 * This endpoint should be called on application startup to automatically migrate profiles
 */

import { NextRequest, NextResponse } from 'next/server'
import { convertOpenRouterProfiles } from '@/lib/llm/convert-openrouter-profiles'

// Flag to ensure migration only runs once per server restart
let migrationCompleted = false

export async function POST(request: NextRequest) {
  // Check if migration already completed in this session
  if (migrationCompleted) {
    return NextResponse.json({
      success: true,
      message: 'Migration already completed in this session',
      result: {
        checked: 0,
        converted: 0,
        errors: [],
      },
    })
  }

  try {
    console.log('Starting automatic OpenRouter profile migration...')

    // Run the conversion for all users
    const result = await convertOpenRouterProfiles()

    migrationCompleted = true

    console.log(`OpenRouter migration complete: ${result.converted} profiles converted, ${result.errors.length} errors`)

    return NextResponse.json({
      success: true,
      message: `Migration completed successfully`,
      result,
    })
  } catch (error) {
    console.error('OpenRouter profile migration failed:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during migration',
      },
      { status: 500 }
    )
  }
}

// Allow GET for health check / status
export async function GET() {
  return NextResponse.json({
    migrationCompleted,
    message: migrationCompleted
      ? 'Migration has been completed'
      : 'Migration has not been run yet',
  })
}
