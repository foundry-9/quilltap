/**
 * Unit tests for lib/services/dangerous-content/provider-routing.service.ts
 * Tests provider routing logic for dangerous content detection and rerouting
 */

import {
  resolveProviderForDangerousContent,
  resolveImageProviderForDangerousContent,
} from '@/lib/services/dangerous-content/provider-routing.service'
import { getRepositories } from '@/lib/repositories/factory'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'
import type { ConnectionProfile, ImageProfile } from '@/lib/schemas/types'

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}))

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}))

const userId = 'user-1'

const originalProfile: ConnectionProfile = {
  id: 'orig-1',
  provider: 'OPENAI',
  modelName: 'gpt-4',
  apiKeyId: 'key-1',
  userId,
  name: 'My OpenAI',
  createdAt: new Date(),
  updatedAt: new Date(),
  isDangerousCompatible: false,
}

const uncensoredProfile: ConnectionProfile = {
  id: 'uncensored-1',
  provider: 'LOCAL',
  modelName: 'llama-uncensored',
  apiKeyId: 'key-2',
  userId,
  name: 'Uncensored Local',
  createdAt: new Date(),
  updatedAt: new Date(),
  isDangerousCompatible: true,
}

const offSettings: DangerousContentSettings = {
  mode: 'OFF',
  threshold: 0.7,
  scanTextChat: true,
  scanImagePrompts: true,
  scanImageGeneration: false,
  displayMode: 'SHOW',
  showWarningBadges: true,
}

const detectOnlySettings: DangerousContentSettings = {
  mode: 'DETECT_ONLY',
  threshold: 0.7,
  scanTextChat: true,
  scanImagePrompts: true,
  scanImageGeneration: false,
  displayMode: 'SHOW',
  showWarningBadges: true,
}

const autoRouteSettings: DangerousContentSettings = {
  mode: 'AUTO_ROUTE',
  threshold: 0.7,
  scanTextChat: true,
  scanImagePrompts: true,
  scanImageGeneration: false,
  displayMode: 'SHOW',
  showWarningBadges: true,
}

const explicitRouteSettings: DangerousContentSettings = {
  mode: 'AUTO_ROUTE',
  threshold: 0.7,
  scanTextChat: true,
  scanImagePrompts: true,
  scanImageGeneration: false,
  displayMode: 'SHOW',
  showWarningBadges: true,
  uncensoredTextProfileId: 'uncensored-1',
}

describe('resolveProviderForDangerousContent', () => {
  const originalApiKey = 'sk-orig-key'

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('mode-based routing', () => {
    it('returns original profile when mode is OFF', async () => {
      const mockRepos = {
        connections: {
          findById: jest.fn(),
          findAll: jest.fn(),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveProviderForDangerousContent(
        originalProfile,
        originalApiKey,
        offSettings,
        userId
      )

      expect(result.rerouted).toBe(false)
      expect(result.connectionProfile).toEqual(originalProfile)
      expect(result.apiKey).toBe(originalApiKey)
      expect(result.reason).toContain('Mode is OFF')
    })

    it('returns original profile when mode is DETECT_ONLY', async () => {
      const mockRepos = {
        connections: {
          findById: jest.fn(),
          findAll: jest.fn(),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveProviderForDangerousContent(
        originalProfile,
        originalApiKey,
        detectOnlySettings,
        userId
      )

      expect(result.rerouted).toBe(false)
      expect(result.connectionProfile).toEqual(originalProfile)
      expect(result.apiKey).toBe(originalApiKey)
      expect(result.reason).toContain('Mode is DETECT_ONLY')
    })
  })

  describe('explicit uncensored profile', () => {
    it('reroutes to explicitly configured uncensored profile', async () => {
      const mockRepos = {
        connections: {
          findById: jest.fn().mockResolvedValue(uncensoredProfile),
          findAll: jest.fn().mockResolvedValue([originalProfile, uncensoredProfile]),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({
            key_value: 'sk-uncensored-key',
          }),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveProviderForDangerousContent(
        originalProfile,
        originalApiKey,
        explicitRouteSettings,
        userId
      )

      expect(result.rerouted).toBe(true)
      expect(result.connectionProfile).toEqual(uncensoredProfile)
      expect(result.apiKey).toBe('sk-uncensored-key')
      expect(result.reason).toContain('Uncensored Local')
    })

    it('falls back to scanning when explicit profile not found', async () => {
      const mockRepos = {
        connections: {
          findById: jest.fn().mockResolvedValue(null),
          findAll: jest.fn().mockResolvedValue([originalProfile, uncensoredProfile]),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({
            key_value: 'sk-uncensored-key',
          }),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveProviderForDangerousContent(
        originalProfile,
        originalApiKey,
        explicitRouteSettings,
        userId
      )

      expect(result.rerouted).toBe(true)
      expect(result.connectionProfile.isDangerousCompatible).toBe(true)
    })

    it('falls back to scanning when explicit profile has no API key', async () => {
      const profileNoKey = { ...uncensoredProfile, apiKeyId: null }

      const mockRepos = {
        connections: {
          findById: jest.fn().mockResolvedValue(profileNoKey),
          findAll: jest.fn().mockResolvedValue([originalProfile, uncensoredProfile]),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({
            key_value: 'sk-uncensored-key',
          }),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveProviderForDangerousContent(
        originalProfile,
        originalApiKey,
        explicitRouteSettings,
        userId
      )

      expect(result.rerouted).toBe(true)
      expect(result.connectionProfile.isDangerousCompatible).toBe(true)
    })

    it('falls back to original when explicit profile not owned by user', async () => {
      const otherUserProfile = { ...uncensoredProfile, userId: 'other-user' }

      const mockRepos = {
        connections: {
          findById: jest.fn().mockResolvedValue(otherUserProfile),
          findAll: jest.fn().mockResolvedValue([originalProfile]),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveProviderForDangerousContent(
        originalProfile,
        originalApiKey,
        explicitRouteSettings,
        userId
      )

      expect(result.rerouted).toBe(false)
      expect(result.connectionProfile).toEqual(originalProfile)
    })
  })

  describe('profile scanning', () => {
    it('scans all profiles for isDangerousCompatible when no explicit profile', async () => {
      const mockRepos = {
        connections: {
          findById: jest.fn(),
          findAll: jest.fn().mockResolvedValue([originalProfile, uncensoredProfile]),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({
            key_value: 'sk-uncensored-key',
          }),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveProviderForDangerousContent(
        originalProfile,
        originalApiKey,
        autoRouteSettings,
        userId
      )

      expect(result.rerouted).toBe(true)
      expect(result.connectionProfile.isDangerousCompatible).toBe(true)
      expect(mockRepos.connections.findAll).toHaveBeenCalled()
    })

    it('returns first isDangerousCompatible profile found', async () => {
      const uncensored2 = {
        ...uncensoredProfile,
        id: 'uncensored-2',
        name: 'Second Uncensored',
      }

      const mockRepos = {
        connections: {
          findById: jest.fn(),
          findAll: jest.fn().mockResolvedValue([originalProfile, uncensoredProfile, uncensored2]),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({
            key_value: 'sk-uncensored-key',
          }),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveProviderForDangerousContent(
        originalProfile,
        originalApiKey,
        autoRouteSettings,
        userId
      )

      expect(result.rerouted).toBe(true)
      expect(result.connectionProfile.id).toBe('uncensored-1')
    })

    it('skips profiles not owned by user during scan', async () => {
      const otherUserUncensored = {
        ...uncensoredProfile,
        userId: 'other-user',
      }

      const mockRepos = {
        connections: {
          findById: jest.fn(),
          findAll: jest.fn().mockResolvedValue([originalProfile, otherUserUncensored]),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveProviderForDangerousContent(
        originalProfile,
        originalApiKey,
        autoRouteSettings,
        userId
      )

      expect(result.rerouted).toBe(false)
      expect(result.connectionProfile).toEqual(originalProfile)
    })

    it('skips profiles without API keys during scan', async () => {
      const noKeyProfile = { ...uncensoredProfile, apiKeyId: null }

      const mockRepos = {
        connections: {
          findById: jest.fn(),
          findAll: jest.fn().mockResolvedValue([originalProfile, noKeyProfile]),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveProviderForDangerousContent(
        originalProfile,
        originalApiKey,
        autoRouteSettings,
        userId
      )

      expect(result.rerouted).toBe(false)
      expect(result.connectionProfile).toEqual(originalProfile)
    })
  })

  describe('fallback behavior', () => {
    it('falls back to original when no uncensored profiles available', async () => {
      const mockRepos = {
        connections: {
          findById: jest.fn(),
          findAll: jest.fn().mockResolvedValue([originalProfile]),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveProviderForDangerousContent(
        originalProfile,
        originalApiKey,
        autoRouteSettings,
        userId
      )

      expect(result.rerouted).toBe(false)
      expect(result.connectionProfile).toEqual(originalProfile)
      expect(result.reason).toContain('No uncensored provider available')
    })

    it('includes reason in result when falling back', async () => {
      const mockRepos = {
        connections: {
          findById: jest.fn(),
          findAll: jest.fn().mockResolvedValue([originalProfile]),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveProviderForDangerousContent(
        originalProfile,
        originalApiKey,
        autoRouteSettings,
        userId
      )

      expect(result.reason).toBeDefined()
      expect(result.reason.length).toBeGreaterThan(0)
    })
  })

  describe('error handling', () => {
    it('gracefully handles repository errors and returns original profile', async () => {
      const mockRepos = {
        connections: {
          findById: jest.fn().mockRejectedValue(new Error('DB error')),
          findAll: jest.fn(),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveProviderForDangerousContent(
        originalProfile,
        originalApiKey,
        explicitRouteSettings,
        userId
      )

      expect(result.rerouted).toBe(false)
      expect(result.connectionProfile).toEqual(originalProfile)
      expect(result.apiKey).toBe(originalApiKey)
      expect(result.reason).toContain('Routing failed')
    })

    it('gracefully handles findAll errors during profile scan', async () => {
      const mockRepos = {
        connections: {
          findById: jest.fn(),
          findAll: jest.fn().mockRejectedValue(new Error('Query failed')),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveProviderForDangerousContent(
        originalProfile,
        originalApiKey,
        autoRouteSettings,
        userId
      )

      expect(result.rerouted).toBe(false)
      expect(result.connectionProfile).toEqual(originalProfile)
    })
  })

  describe('this turn\'s attachments (bug 106)', () => {
    // The scan used to answer on `isDangerousCompatible` alone, so a text-only
    // model was a fully eligible substitute for a vision model mid-turn — and
    // the reroute hands it the vision model's own message array.
    const textOnlyUncensored: ConnectionProfile = {
      ...uncensoredProfile,
      id: 'uncensored-text',
      name: 'Uncensored Text Only',
      provider: 'DEEPSEEK',
      modelName: 'deepseek-v4-flash-latest',
      supportsImageUpload: false,
    }

    const visionUncensored: ConnectionProfile = {
      ...uncensoredProfile,
      id: 'uncensored-vision',
      name: 'Uncensored Vision',
      provider: 'ANTHROPIC',
      modelName: 'claude-opus-5',
      supportsImageUpload: true,
    }

    const scanOnlySettings: DangerousContentSettings = {
      ...autoRouteSettings,
    }

    function reposWith(profiles: ConnectionProfile[]) {
      return {
        connections: {
          findById: jest.fn().mockResolvedValue(null),
          findAll: jest.fn().mockResolvedValue(profiles),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({ key_value: 'sk-scan' }),
        },
      }
    }

    it('prefers a candidate that can carry the turn\'s images over one that cannot', async () => {
      // Text-only comes first in the list, so order alone would pick it.
      ;(getRepositories as jest.Mock).mockReturnValue(
        reposWith([originalProfile, textOnlyUncensored, visionUncensored])
      )

      const result = await resolveProviderForDangerousContent(
        originalProfile,
        originalApiKey,
        scanOnlySettings,
        userId,
        ['image/jpeg']
      )

      expect(result.rerouted).toBe(true)
      expect(result.connectionProfile.id).toBe('uncensored-vision')
    })

    it('still reroutes to a text-only candidate when no vision one is cleared', async () => {
      // A degraded-but-delivered turn beats no reroute: the caller re-decides
      // the attachment question and the describer stands in for the bytes.
      ;(getRepositories as jest.Mock).mockReturnValue(
        reposWith([originalProfile, textOnlyUncensored])
      )

      const result = await resolveProviderForDangerousContent(
        originalProfile,
        originalApiKey,
        scanOnlySettings,
        userId,
        ['image/jpeg']
      )

      expect(result.rerouted).toBe(true)
      expect(result.connectionProfile.id).toBe('uncensored-text')
    })

    it('leaves the scan order alone when the turn carries nothing', async () => {
      ;(getRepositories as jest.Mock).mockReturnValue(
        reposWith([originalProfile, textOnlyUncensored, visionUncensored])
      )

      const result = await resolveProviderForDangerousContent(
        originalProfile,
        originalApiKey,
        scanOnlySettings,
        userId
      )

      expect(result.rerouted).toBe(true)
      expect(result.connectionProfile.id).toBe('uncensored-text')
    })
  })

})

describe('resolveImageProviderForDangerousContent', () => {
  const originalImageProfile: ImageProfile = {
    id: 'img-1',
    provider: 'DALL_E',
    userId,
    name: 'My DALL-E',
    createdAt: new Date(),
    updatedAt: new Date(),
    apiKeyId: 'key-1',
    isDangerousCompatible: false,
  }

  const uncensoredImageProfile: ImageProfile = {
    id: 'img-uncensored-1',
    provider: 'STABILITY',
    userId,
    name: 'Uncensored Stability',
    createdAt: new Date(),
    updatedAt: new Date(),
    apiKeyId: 'key-2',
    isDangerousCompatible: true,
  }

  const originalApiKey = 'sk-image-key'

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('mode-based routing', () => {
    it('returns original profile when mode is OFF', async () => {
      const mockRepos = {
        imageProfiles: {
          findById: jest.fn(),
          findAll: jest.fn(),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveImageProviderForDangerousContent(
        originalImageProfile,
        originalApiKey,
        offSettings,
        userId
      )

      expect(result.rerouted).toBe(false)
      expect(result.imageProfile).toEqual(originalImageProfile)
      expect(result.reason).toContain('Mode is OFF')
    })

    it('returns original profile when mode is DETECT_ONLY', async () => {
      const mockRepos = {
        imageProfiles: {
          findById: jest.fn(),
          findAll: jest.fn(),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveImageProviderForDangerousContent(
        originalImageProfile,
        originalApiKey,
        detectOnlySettings,
        userId
      )

      expect(result.rerouted).toBe(false)
      expect(result.imageProfile).toEqual(originalImageProfile)
    })
  })

  describe('explicit uncensored image profile', () => {
    it('reroutes to explicitly configured uncensored image profile', async () => {
      const explicitImageSettings: DangerousContentSettings = {
        ...autoRouteSettings,
        uncensoredImageProfileId: 'img-uncensored-1',
      }

      const mockRepos = {
        imageProfiles: {
          findById: jest.fn().mockResolvedValue(uncensoredImageProfile),
          findAll: jest.fn().mockResolvedValue([originalImageProfile, uncensoredImageProfile]),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({
            key_value: 'sk-uncensored-image-key',
          }),
        },
        connections: {
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({
            key_value: 'sk-uncensored-image-key',
          }),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveImageProviderForDangerousContent(
        originalImageProfile,
        originalApiKey,
        explicitImageSettings,
        userId
      )

      expect(result.rerouted).toBe(true)
      expect(result.imageProfile).toEqual(uncensoredImageProfile)
      expect(result.apiKey).toBe('sk-uncensored-image-key')
    })

    it('falls back to scanning when explicit image profile not found', async () => {
      const explicitImageSettings: DangerousContentSettings = {
        ...autoRouteSettings,
        uncensoredImageProfileId: 'nonexistent',
      }

      const mockRepos = {
        imageProfiles: {
          findById: jest.fn().mockResolvedValue(null),
          findAll: jest.fn().mockResolvedValue([originalImageProfile, uncensoredImageProfile]),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({
            key_value: 'sk-uncensored-image-key',
          }),
        },
        connections: {
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({
            key_value: 'sk-uncensored-image-key',
          }),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveImageProviderForDangerousContent(
        originalImageProfile,
        originalApiKey,
        explicitImageSettings,
        userId
      )

      expect(result.rerouted).toBe(true)
      expect(result.imageProfile.isDangerousCompatible).toBe(true)
    })
  })

  describe('image profile scanning', () => {
    it('scans image profiles for isDangerousCompatible', async () => {
      const mockRepos = {
        imageProfiles: {
          findById: jest.fn(),
          findAll: jest.fn().mockResolvedValue([originalImageProfile, uncensoredImageProfile]),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({
            key_value: 'sk-uncensored-image-key',
          }),
        },
        connections: {
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({
            key_value: 'sk-uncensored-image-key',
          }),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveImageProviderForDangerousContent(
        originalImageProfile,
        originalApiKey,
        autoRouteSettings,
        userId
      )

      expect(result.rerouted).toBe(true)
      expect(result.imageProfile.isDangerousCompatible).toBe(true)
      expect(mockRepos.imageProfiles.findAll).toHaveBeenCalled()
    })

    it('returns first isDangerousCompatible image profile found', async () => {
      const uncensored2 = {
        ...uncensoredImageProfile,
        id: 'img-uncensored-2',
        name: 'Second Uncensored Image',
      }

      const mockRepos = {
        imageProfiles: {
          findById: jest.fn(),
          findAll: jest.fn().mockResolvedValue([
            originalImageProfile,
            uncensoredImageProfile,
            uncensored2,
          ]),
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({
            key_value: 'sk-uncensored-image-key',
          }),
        },
        connections: {
          findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({
            key_value: 'sk-uncensored-image-key',
          }),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveImageProviderForDangerousContent(
        originalImageProfile,
        originalApiKey,
        autoRouteSettings,
        userId
      )

      expect(result.imageProfile.id).toBe('img-uncensored-1')
    })

    it('skips image profiles not owned by user', async () => {
      const otherUserProfile = {
        ...uncensoredImageProfile,
        userId: 'other-user',
      }

      const mockRepos = {
        imageProfiles: {
          findById: jest.fn(),
          findAll: jest.fn().mockResolvedValue([originalImageProfile, otherUserProfile]),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveImageProviderForDangerousContent(
        originalImageProfile,
        originalApiKey,
        autoRouteSettings,
        userId
      )

      expect(result.rerouted).toBe(false)
      expect(result.imageProfile).toEqual(originalImageProfile)
    })
  })

  describe('image provider fallback', () => {
    it('falls back to original when no uncensored image providers available', async () => {
      const mockRepos = {
        imageProfiles: {
          findById: jest.fn(),
          findAll: jest.fn().mockResolvedValue([originalImageProfile]),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveImageProviderForDangerousContent(
        originalImageProfile,
        originalApiKey,
        autoRouteSettings,
        userId
      )

      expect(result.rerouted).toBe(false)
      expect(result.imageProfile).toEqual(originalImageProfile)
      expect(result.reason).toContain('No uncensored image provider available')
    })

    it('includes reason when falling back', async () => {
      const mockRepos = {
        imageProfiles: {
          findById: jest.fn(),
          findAll: jest.fn().mockResolvedValue([originalImageProfile]),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveImageProviderForDangerousContent(
        originalImageProfile,
        originalApiKey,
        autoRouteSettings,
        userId
      )

      expect(result.reason).toBeDefined()
      expect(result.reason.length).toBeGreaterThan(0)
    })
  })

  describe('image provider error handling', () => {
    it('gracefully handles repository errors for image profiles', async () => {
      const mockRepos = {
        imageProfiles: {
          findById: jest.fn().mockRejectedValue(new Error('DB error')),
          findAll: jest.fn(),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const explicitImageSettings: DangerousContentSettings = {
        ...autoRouteSettings,
        uncensoredImageProfileId: 'img-uncensored-1',
      }

      const result = await resolveImageProviderForDangerousContent(
        originalImageProfile,
        originalApiKey,
        explicitImageSettings,
        userId
      )

      expect(result.rerouted).toBe(false)
      expect(result.imageProfile).toEqual(originalImageProfile)
    })

    it('gracefully handles findAll errors during image profile scan', async () => {
      const mockRepos = {
        imageProfiles: {
          findById: jest.fn(),
          findAll: jest.fn().mockRejectedValue(new Error('Query failed')),
        },
      }
      ;(getRepositories as jest.Mock).mockReturnValue(mockRepos)

      const result = await resolveImageProviderForDangerousContent(
        originalImageProfile,
        originalApiKey,
        autoRouteSettings,
        userId
      )

      expect(result.rerouted).toBe(false)
      expect(result.imageProfile).toEqual(originalImageProfile)
      expect(result.reason).toContain('Routing failed')
    })
  })
})
