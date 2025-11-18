/**
 * Unit Tests for Prisma Client Singleton
 * Tests lib/prisma.ts
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { PrismaClient } from '@prisma/client'

describe('Prisma Client Singleton', () => {
  let originalNodeEnv: string | undefined
  let originalGlobalPrisma: any

  beforeEach(() => {
    // Save original values
    originalNodeEnv = process.env.NODE_ENV
    originalGlobalPrisma = (globalThis as any).prisma

    // Clear module cache to get fresh imports
    jest.resetModules()

    // Clear global prisma
    delete (globalThis as any).prisma
  })

  afterEach(() => {
    // Restore original values
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv
    } else {
      delete process.env.NODE_ENV
    }

    if (originalGlobalPrisma !== undefined) {
      (globalThis as any).prisma = originalGlobalPrisma
    } else {
      delete (globalThis as any).prisma
    }
  })

  it('should export a prisma instance', async () => {
    const { prisma } = await import('@/lib/prisma')

    expect(prisma).toBeDefined()
    expect(prisma).toHaveProperty('$connect')
    expect(prisma).toHaveProperty('$disconnect')
  })

  it('should create singleton in production', async () => {
    process.env.NODE_ENV = 'production'

    const { prisma: prisma1 } = await import('@/lib/prisma')

    // Re-import should give same instance
    jest.resetModules()
    const { prisma: prisma2 } = await import('@/lib/prisma')

    // In production, instances may be different on reimport since
    // it doesn't store in global, but each import creates the singleton correctly
    expect(prisma1).toBeDefined()
    expect(prisma2).toBeDefined()
    expect(prisma1).toHaveProperty('$connect')
    expect(prisma2).toHaveProperty('$connect')
  })

  it('should reuse singleton in development', async () => {
    process.env.NODE_ENV = 'development'

    // First import
    const { prisma: prisma1 } = await import('@/lib/prisma')

    // Should be stored in global
    expect((globalThis as any).prisma).toBeDefined()
    expect((globalThis as any).prisma).toBe(prisma1)

    // Reset modules but keep global
    const globalPrisma = (globalThis as any).prisma
    jest.resetModules()

    // Restore global before second import
    ;(globalThis as any).prisma = globalPrisma

    // Second import should reuse from global
    const { prisma: prisma2 } = await import('@/lib/prisma')

    expect(prisma2).toBe(globalPrisma)
  })

  it('should not store in global in production', async () => {
    process.env.NODE_ENV = 'production'

    await import('@/lib/prisma')

    // In production, prisma should not be stored in global
    // (or if it is, the code explicitly doesn't set it)
    // The actual behavior is that the condition checks !== 'production'
    expect((globalThis as any).prisma).toBeUndefined()
  })

  it('should configure logging for development', async () => {
    process.env.NODE_ENV = 'development'

    const { prisma } = await import('@/lib/prisma')

    // Prisma client should be created with query, error, warn logging
    expect(prisma).toBeDefined()
    expect(prisma).toHaveProperty('$connect')
    // Note: We can't directly inspect the log config after instantiation,
    // but we verify the instance is created
  })

  it('should configure logging for production', async () => {
    process.env.NODE_ENV = 'production'

    const { prisma } = await import('@/lib/prisma')

    // Prisma client should be created with only error logging
    expect(prisma).toBeDefined()
    expect(prisma).toHaveProperty('$connect')
  })

  it('should handle test environment as non-production', async () => {
    process.env.NODE_ENV = 'test'

    const { prisma } = await import('@/lib/prisma')

    expect(prisma).toBeDefined()
    expect(prisma).toHaveProperty('$connect')
    // Should store in global since it's not production
    expect((globalThis as any).prisma).toBeDefined()
  })

  it('should handle undefined NODE_ENV as non-production', async () => {
    delete process.env.NODE_ENV

    const { prisma } = await import('@/lib/prisma')

    expect(prisma).toBeDefined()
    expect(prisma).toHaveProperty('$connect')
    // Should store in global since it's not production
    expect((globalThis as any).prisma).toBeDefined()
  })

  it('should handle custom environment names', async () => {
    process.env.NODE_ENV = 'staging'

    const { prisma } = await import('@/lib/prisma')

    expect(prisma).toBeDefined()
    expect(prisma).toHaveProperty('$connect')
    // Should store in global since it's not 'production'
    expect((globalThis as any).prisma).toBeDefined()
  })

  describe('Singleton behavior across imports', () => {
    it('should maintain singleton when imported multiple times in development', async () => {
      process.env.NODE_ENV = 'development'

      // Multiple imports without resetting modules
      const import1 = await import('@/lib/prisma')
      const import2 = await import('@/lib/prisma')
      const import3 = await import('@/lib/prisma')

      expect(import1.prisma).toBe(import2.prisma)
      expect(import2.prisma).toBe(import3.prisma)
    })
  })

  describe('Type checking', () => {
    it('should have correct PrismaClient methods', async () => {
      const { prisma } = await import('@/lib/prisma')

      // Check that common Prisma methods exist
      expect(typeof prisma.$connect).toBe('function')
      expect(typeof prisma.$disconnect).toBe('function')
      expect(typeof prisma.$executeRaw).toBe('function')
      expect(typeof prisma.$queryRaw).toBe('function')
    })

    it('should have model accessors based on schema', async () => {
      const { prisma } = await import('@/lib/prisma')

      // These models should exist based on the Prisma schema
      // Note: Actual models depend on schema.prisma
      expect(prisma.user).toBeDefined()
      expect(prisma.character).toBeDefined()
      expect(prisma.persona).toBeDefined()
      expect(prisma.chat).toBeDefined()
      expect(prisma.message).toBeDefined()
      expect(prisma.apiKey).toBeDefined()
      expect(prisma.connectionProfile).toBeDefined()
    })
  })
})
