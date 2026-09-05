/**
 * Tests for lib/services/dangerous-content/resolver.service.ts
 */

import {
  DEFAULT_DANGEROUS_CONTENT_SETTINGS,
  VOUCHED_SAFE_DANGEROUS_CONTENT_SETTINGS,
  resolveDangerousContentSettings,
} from '@/lib/services/dangerous-content/resolver.service'
import type { ChatSettings } from '@/lib/schemas/types'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'

describe('DEFAULT_DANGEROUS_CONTENT_SETTINGS', () => {
  it('has mode OFF', () => {
    expect(DEFAULT_DANGEROUS_CONTENT_SETTINGS.mode).toBe('OFF')
  })

  it('has threshold 0.7', () => {
    expect(DEFAULT_DANGEROUS_CONTENT_SETTINGS.threshold).toBe(0.7)
  })

  it('has scanTextChat true', () => {
    expect(DEFAULT_DANGEROUS_CONTENT_SETTINGS.scanTextChat).toBe(true)
  })

  it('has scanImagePrompts true', () => {
    expect(DEFAULT_DANGEROUS_CONTENT_SETTINGS.scanImagePrompts).toBe(true)
  })

  it('has scanImageGeneration false', () => {
    expect(DEFAULT_DANGEROUS_CONTENT_SETTINGS.scanImageGeneration).toBe(false)
  })

  it('has displayMode SHOW', () => {
    expect(DEFAULT_DANGEROUS_CONTENT_SETTINGS.displayMode).toBe('SHOW')
  })

  it('has showWarningBadges true', () => {
    expect(DEFAULT_DANGEROUS_CONTENT_SETTINGS.showWarningBadges).toBe(true)
  })
})

describe('resolveDangerousContentSettings', () => {
  describe('null globalSettings', () => {
    it('returns defaults when globalSettings is null', () => {
      const result = resolveDangerousContentSettings(null)
      expect(result.settings).toEqual(DEFAULT_DANGEROUS_CONTENT_SETTINGS)
      expect(result.source).toBe('default')
    })
  })

  describe('missing dangerousContentSettings', () => {
    it('returns defaults when globalSettings has no dangerousContentSettings', () => {
      const globalSettings: ChatSettings = {
        id: 'test',
        tokenDisplay: 'minimal',
        contextCompression: false,
        memoryCascade: false,
        showTimestamps: false,
        agentMode: false,
      }
      const result = resolveDangerousContentSettings(globalSettings)
      expect(result.settings).toEqual(DEFAULT_DANGEROUS_CONTENT_SETTINGS)
      expect(result.source).toBe('default')
    })

    it('returns defaults when globalSettings is empty object (cast)', () => {
      const globalSettings = {} as ChatSettings
      const result = resolveDangerousContentSettings(globalSettings)
      expect(result.settings).toEqual(DEFAULT_DANGEROUS_CONTENT_SETTINGS)
      expect(result.source).toBe('default')
    })
  })

  describe('global settings present', () => {
    it('returns global settings when present, source is "global"', () => {
      const customSettings: DangerousContentSettings = {
        mode: 'BLOCK',
        threshold: 0.5,
        scanTextChat: false,
        scanImagePrompts: false,
        scanImageGeneration: true,
        displayMode: 'HIDE',
        showWarningBadges: false,
      }
      const globalSettings: ChatSettings = {
        id: 'test',
        tokenDisplay: 'minimal',
        contextCompression: false,
        memoryCascade: false,
        showTimestamps: false,
        agentMode: false,
        dangerousContentSettings: customSettings,
      }
      const result = resolveDangerousContentSettings(globalSettings)
      expect(result.settings).toEqual(customSettings)
      expect(result.source).toBe('global')
    })

    it('returns global settings with different values', () => {
      const customSettings: DangerousContentSettings = {
        mode: 'WARN',
        threshold: 0.9,
        scanTextChat: true,
        scanImagePrompts: false,
        scanImageGeneration: true,
        displayMode: 'BLUR',
        showWarningBadges: false,
      }
      const globalSettings: ChatSettings = {
        id: 'test',
        tokenDisplay: 'full',
        contextCompression: true,
        memoryCascade: true,
        showTimestamps: true,
        agentMode: true,
        dangerousContentSettings: customSettings,
      }
      const result = resolveDangerousContentSettings(globalSettings)
      expect(result.settings).toEqual(customSettings)
      expect(result.source).toBe('global')
    })
  })

  describe('return structure', () => {
    it('always returns object with settings and source properties', () => {
      const result = resolveDangerousContentSettings(null)
      expect(result).toHaveProperty('settings')
      expect(result).toHaveProperty('source')
      expect(Object.keys(result).length).toBe(2)
    })
  })

  describe('per-chat vouched-safe override', () => {
    const customSettings: DangerousContentSettings = {
      mode: 'AUTO_ROUTE',
      threshold: 0.7,
      scanTextChat: true,
      scanImagePrompts: true,
      scanImageGeneration: true,
      displayMode: 'SHOW',
      showWarningBadges: true,
    }
    const globalSettings: ChatSettings = {
      id: 'test',
      tokenDisplay: 'minimal',
      contextCompression: false,
      memoryCascade: false,
      showTimestamps: false,
      agentMode: false,
      dangerousContentSettings: customSettings,
    }

    it('returns VOUCHED_SAFE settings and source="chat-vouched" when the operator vouched', () => {
      const result = resolveDangerousContentSettings(globalSettings, { conciergeOverride: 'OFF' })
      expect(result.settings).toEqual(VOUCHED_SAFE_DANGEROUS_CONTENT_SETTINGS)
      expect(result.source).toBe('chat-vouched')
    })

    it('respects global settings when chat override is null', () => {
      const result = resolveDangerousContentSettings(globalSettings, { conciergeOverride: null })
      expect(result.settings).toEqual(customSettings)
      expect(result.source).toBe('global')
    })

    it('respects global settings when chat is undefined', () => {
      const result = resolveDangerousContentSettings(globalSettings, undefined)
      expect(result.settings).toEqual(customSettings)
      expect(result.source).toBe('global')
    })

    it('still returns Vouched Safe even if no global settings were configured', () => {
      const result = resolveDangerousContentSettings(null, { conciergeOverride: 'OFF' })
      expect(result.settings).toEqual(VOUCHED_SAFE_DANGEROUS_CONTENT_SETTINGS)
      expect(result.source).toBe('chat-vouched')
    })

    it('VOUCHED_SAFE settings have mode OFF and all scans disabled', () => {
      expect(VOUCHED_SAFE_DANGEROUS_CONTENT_SETTINGS.mode).toBe('OFF')
      expect(VOUCHED_SAFE_DANGEROUS_CONTENT_SETTINGS.scanTextChat).toBe(false)
      expect(VOUCHED_SAFE_DANGEROUS_CONTENT_SETTINGS.scanImagePrompts).toBe(false)
      expect(VOUCHED_SAFE_DANGEROUS_CONTENT_SETTINGS.scanImageGeneration).toBe(false)
    })
  })

  describe('per-chat uncensored override', () => {
    const customSettings: DangerousContentSettings = {
      mode: 'OFF',
      threshold: 0.7,
      scanTextChat: true,
      scanImagePrompts: true,
      scanImageGeneration: true,
      displayMode: 'SHOW',
      showWarningBadges: true,
      uncensoredTextProfileId: '11111111-1111-4111-8111-111111111111',
      uncensoredImageProfileId: '22222222-2222-4222-8222-222222222222',
    }
    const globalSettings: ChatSettings = {
      id: 'test',
      tokenDisplay: 'minimal',
      contextCompression: false,
      memoryCascade: false,
      showTimestamps: false,
      agentMode: false,
      dangerousContentSettings: customSettings,
    }

    it('carries the uncensored profile IDs through from global', () => {
      const result = resolveDangerousContentSettings(globalSettings, { conciergeOverride: 'UNCENSORED' })
      expect(result.source).toBe('chat-uncensored')
      expect(result.settings.uncensoredTextProfileId).toBe('11111111-1111-4111-8111-111111111111')
      expect(result.settings.uncensoredImageProfileId).toBe('22222222-2222-4222-8222-222222222222')
    })

    it('forces AUTO_ROUTE even under a global OFF', () => {
      const result = resolveDangerousContentSettings(globalSettings, { conciergeOverride: 'UNCENSORED' })
      expect(result.settings.mode).toBe('AUTO_ROUTE')
    })

    it('leaves all scans false with nothing left to classify', () => {
      const result = resolveDangerousContentSettings(globalSettings, { conciergeOverride: 'UNCENSORED' })
      expect(result.settings.threshold).toBe(1.0)
      expect(result.settings.scanTextChat).toBe(false)
      expect(result.settings.scanImagePrompts).toBe(false)
      expect(result.settings.scanImageGeneration).toBe(false)
      expect(result.settings.showWarningBadges).toBe(false)
    })

    it('spreads the defaults when no global settings were configured', () => {
      const result = resolveDangerousContentSettings(null, { conciergeOverride: 'UNCENSORED' })
      expect(result.source).toBe('chat-uncensored')
      expect(result.settings.mode).toBe('AUTO_ROUTE')
      expect(result.settings.scanTextChat).toBe(false)
    })

    it('moderation-exempt chat types win over the uncensored override', () => {
      const result = resolveDangerousContentSettings(globalSettings, {
        chatType: 'brahma',
        conciergeOverride: 'UNCENSORED',
      })
      expect(result.source).toBe('chat-type-exempt')
      expect(result.settings).toEqual(VOUCHED_SAFE_DANGEROUS_CONTENT_SETTINGS)
    })
  })

  describe('moderation-exempt chat types (Help Chat, Brahma Console)', () => {
    const customSettings: DangerousContentSettings = {
      mode: 'AUTO_ROUTE',
      threshold: 0.7,
      scanTextChat: true,
      scanImagePrompts: true,
      scanImageGeneration: true,
      displayMode: 'SHOW',
      showWarningBadges: true,
    }
    const globalSettings: ChatSettings = {
      id: 'test',
      tokenDisplay: 'minimal',
      contextCompression: false,
      memoryCascade: false,
      showTimestamps: false,
      agentMode: false,
      dangerousContentSettings: customSettings,
    }

    it('forces OFF for help chats regardless of global AUTO_ROUTE', () => {
      const result = resolveDangerousContentSettings(globalSettings, { chatType: 'help' })
      expect(result.settings).toEqual(VOUCHED_SAFE_DANGEROUS_CONTENT_SETTINGS)
      expect(result.source).toBe('chat-type-exempt')
    })

    it('forces OFF for brahma chats regardless of global AUTO_ROUTE', () => {
      const result = resolveDangerousContentSettings(globalSettings, { chatType: 'brahma' })
      expect(result.settings).toEqual(VOUCHED_SAFE_DANGEROUS_CONTENT_SETTINGS)
      expect(result.source).toBe('chat-type-exempt')
    })

    it('exemption wins even when the chat is not off-duty', () => {
      const result = resolveDangerousContentSettings(globalSettings, {
        chatType: 'brahma',
        conciergeOverride: null,
      })
      expect(result.source).toBe('chat-type-exempt')
    })

    it('does NOT exempt salon chats', () => {
      const result = resolveDangerousContentSettings(globalSettings, { chatType: 'salon' })
      expect(result.settings).toEqual(customSettings)
      expect(result.source).toBe('global')
    })

    it('does NOT exempt autonomous rooms', () => {
      const result = resolveDangerousContentSettings(globalSettings, { chatType: 'autonomous' })
      expect(result.settings).toEqual(customSettings)
      expect(result.source).toBe('global')
    })
  })
})
