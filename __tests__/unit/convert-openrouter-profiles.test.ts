/**
 * Tests for the OpenRouter profile conversion helpers introduced after 1.3.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { ConnectionProfilesRepository } from '@/lib/json-store/repositories/connection-profiles.repository'

import {
  convertOpenRouterProfiles,
  checkOpenRouterProfiles,
  isOpenRouterEndpoint,
} from '@/lib/llm/convert-openrouter-profiles'

describe('isOpenRouterEndpoint', () => {
  it('returns true for openrouter.ai hostnames', () => {
    expect(isOpenRouterEndpoint('https://openrouter.ai/api/v1')).toBe(true)
    expect(isOpenRouterEndpoint('https://edge.openrouter.ai/v1')).toBe(true)
  })

  it('returns false for other hosts or invalid inputs', () => {
    expect(isOpenRouterEndpoint('https://example.com')).toBe(false)
    expect(isOpenRouterEndpoint('ftp://openrouter.ai')).toBe(false)
    expect(isOpenRouterEndpoint('')).toBe(false)
    expect(isOpenRouterEndpoint(undefined)).toBe(false)
  })
})

describe('convertOpenRouterProfiles', () => {
  let findAllSpy: jest.SpiedFunction<ConnectionProfilesRepository['findAll']>
  let findByUserIdSpy: jest.SpiedFunction<ConnectionProfilesRepository['findByUserId']>
  let updateSpy: jest.SpiedFunction<ConnectionProfilesRepository['update']>
  let logSpy: jest.SpiedFunction<typeof console.log>
  let errorSpy: jest.SpiedFunction<typeof console.error>

  beforeEach(() => {
    findAllSpy = jest.spyOn(ConnectionProfilesRepository.prototype, 'findAll').mockResolvedValue([] as any)
    findByUserIdSpy = jest.spyOn(ConnectionProfilesRepository.prototype, 'findByUserId').mockResolvedValue([] as any)
    updateSpy = jest.spyOn(ConnectionProfilesRepository.prototype, 'update').mockResolvedValue(null as any)
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    findAllSpy?.mockRestore()
    findByUserIdSpy?.mockRestore()
    updateSpy?.mockRestore()
    logSpy?.mockRestore()
    errorSpy?.mockRestore()
  })

  it('converts only OPENAI_COMPATIBLE profiles that target OpenRouter', async () => {
    const profiles = [
      { id: 'p1', name: 'Router', provider: 'OPENAI_COMPATIBLE', baseUrl: 'https://openrouter.ai/api/v1', userId: 'u1' },
      { id: 'p2', name: 'Custom', provider: 'OPENAI_COMPATIBLE', baseUrl: 'https://example.com/v1', userId: 'u1' },
      { id: 'p3', name: 'Native', provider: 'OPENROUTER', baseUrl: null, userId: 'u1' },
    ]
    findAllSpy.mockResolvedValueOnce(profiles as any)

    const result = await convertOpenRouterProfiles()

    expect(findAllSpy).toHaveBeenCalled()
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy).toHaveBeenCalledWith('p1', expect.objectContaining({ provider: 'OPENROUTER', baseUrl: null }))
    expect(result).toMatchObject({ checked: 3, converted: 1, errors: [] })
  })

  it('limits conversion to a specific user when userId is provided', async () => {
    const profiles = [{ id: 'user-profile', name: 'Router', provider: 'OPENAI_COMPATIBLE', baseUrl: 'https://openrouter.ai', userId: 'user-42' }]
    findByUserIdSpy.mockResolvedValueOnce(profiles as any)

    const result = await convertOpenRouterProfiles('user-42')

    expect(findByUserIdSpy).toHaveBeenCalledWith('user-42')
    expect(findAllSpy).not.toHaveBeenCalled()
    expect(result.converted).toBe(1)
  })

  it('collects errors when a conversion fails and continues processing', async () => {
    const profiles = [{ id: 'bad', name: 'Router', provider: 'OPENAI_COMPATIBLE', baseUrl: 'https://openrouter.ai', userId: 'u1' }]
    findAllSpy.mockResolvedValueOnce(profiles as any)
    updateSpy.mockRejectedValueOnce(new Error('boom'))

    const result = await convertOpenRouterProfiles()

    expect(result.converted).toBe(0)
    expect(result.errors).toEqual([{ profileId: 'bad', error: 'boom' }])
  })

  it('rethrows when the repository read fails', async () => {
    findAllSpy.mockRejectedValueOnce(new Error('db down'))

    await expect(convertOpenRouterProfiles()).rejects.toThrow('db down')
  })
})

describe('checkOpenRouterProfiles', () => {
  let findAllSpy: jest.SpiedFunction<ConnectionProfilesRepository['findAll']>
  let findByUserIdSpy: jest.SpiedFunction<ConnectionProfilesRepository['findByUserId']>

  beforeEach(() => {
    findAllSpy = jest.spyOn(ConnectionProfilesRepository.prototype, 'findAll').mockResolvedValue([] as any)
    findByUserIdSpy = jest.spyOn(ConnectionProfilesRepository.prototype, 'findByUserId').mockResolvedValue([] as any)
  })

  afterEach(() => {
    findAllSpy?.mockRestore()
    findByUserIdSpy?.mockRestore()
  })

  it('returns a list of profiles that would be converted', async () => {
    const profiles = [
      { id: 'p1', name: 'Router', provider: 'OPENAI_COMPATIBLE', baseUrl: 'https://openrouter.ai', userId: 'u1' },
      { id: 'p2', name: 'Skip', provider: 'OPENAI_COMPATIBLE', baseUrl: 'https://example.com', userId: 'u1' },
    ]
    findAllSpy.mockResolvedValueOnce(profiles as any)

    const result = await checkOpenRouterProfiles()

    expect(result).toEqual([
      { id: 'p1', name: 'Router', baseUrl: 'https://openrouter.ai', userId: 'u1' },
    ])
  })

  it('respects the optional user filter', async () => {
    const profiles = [
      { id: 'p1', name: 'Router', provider: 'OPENAI_COMPATIBLE', baseUrl: 'https://openrouter.ai', userId: 'specific-user' },
    ]
    findByUserIdSpy.mockResolvedValueOnce(profiles as any)

    const result = await checkOpenRouterProfiles('specific-user')

    expect(findByUserIdSpy).toHaveBeenCalledWith('specific-user')
    expect(result).toHaveLength(1)
    expect(result[0].userId).toBe('specific-user')
  })
})
