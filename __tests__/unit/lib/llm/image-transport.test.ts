/**
 * @jest-environment node
 *
 * `providerCanTransportImages` reads two sources: the live plugin registry
 * when it is up, and the client-safe static mirror in
 * `lib/llm/attachment-support.ts` when it is not. Bug 91 made that predicate
 * load-bearing — it gates the describe-fallback, the image-description-profile
 * guard, and the describer auto-pick — and bug 97 was what happens when the
 * two sources disagree: OpenRouter's plugin still declared the pre-vision
 * `supportsAttachments: false` long after its provider learned to serialise
 * `image_url` parts, so *production* (registry up) routed every OpenRouter
 * image to the describe-fallback while *jest* (registry down, static mirror
 * wins) reported the feature working. The suite was green over behaviour
 * production never exhibited.
 *
 * So this file does three things the old coverage did not:
 *   1. exercises the registry-initialised branch explicitly,
 *   2. feeds the **real, built** plugin declarations through it and holds them
 *      against the static mirror, so the next stale declaration fails here
 *      instead of silently degrading a user's vision profile, and
 *   3. holds each plugin's `manifest.json` against its own build (bug 118).
 *
 * On (3): the build stays authoritative — a manifest/build disagreement is a
 * *manifest* bug, and that is the direction the assertions read. But leaving
 * the manifest out of the comparison entirely, as this file originally did,
 * made it the one copy of the declaration with nothing gating it, and so the
 * only copy free to rot. NanoGPT's said `supported: false` for eleven plugin
 * versions after bug 91 taught it to forward images.
 *
 * The node environment is deliberate: the plugin bundles are Node artefacts.
 */

import fs from 'fs'
import path from 'path'

import { providerCanTransportImages } from '@/lib/llm/image-transport'
import {
  PROVIDER_ATTACHMENT_CAPABILITIES,
  staticProviderCanTransportImages,
} from '@/lib/llm/attachment-support'
import {
  getAttachmentSupport,
  isProviderRegistryInitialized,
} from '@/lib/plugins/provider-registry'
import type { AttachmentSupport } from '@quilltap/plugin-types'

jest.mock('@/lib/plugins/provider-registry', () => ({
  getAttachmentSupport: jest.fn(),
  isProviderRegistryInitialized: jest.fn(),
}))

const mockGetAttachmentSupport = jest.mocked(getAttachmentSupport)
const mockIsInitialized = jest.mocked(isProviderRegistryInitialized)

/** Stand the registry up with a fixed set of plugin declarations. */
function registryUp(declarations: Record<string, AttachmentSupport>): void {
  mockIsInitialized.mockReturnValue(true)
  mockGetAttachmentSupport.mockImplementation(
    name => declarations[name.toUpperCase()] ?? null
  )
}

function registryDown(): void {
  mockIsInitialized.mockReturnValue(false)
  mockGetAttachmentSupport.mockImplementation(() => {
    throw new Error('registry must not be consulted while it is down')
  })
}

// ---- The real, built plugin declarations --------------------------------

const PLUGIN_DIST = path.join(process.cwd(), 'plugins', 'dist')

/**
 * Load every bundled provider plugin's `attachmentSupport` from its built
 * `index.js` — the very object `provider-registry` hands to the predicate in
 * production. Reading the build (not the source, and not `manifest.json`)
 * matters: bug 97's `manifest.json` was already correct, and it was the
 * compiled declaration that was wrong.
 */
function loadBuiltPluginDeclarations(): Record<string, AttachmentSupport> {
  const declarations: Record<string, AttachmentSupport> = {}
  for (const dir of fs.readdirSync(PLUGIN_DIST)) {
    const entry = path.join(PLUGIN_DIST, dir, 'index.js')
    if (!fs.existsSync(entry)) continue
    const loaded = jest.requireActual(entry) as Record<string, unknown>
    const plugin = ((loaded as { default?: unknown }).default ?? loaded) as {
      metadata?: { providerName?: string }
      attachmentSupport?: AttachmentSupport
    }
    const name = plugin.metadata?.providerName
    if (!name || !plugin.attachmentSupport) continue
    declarations[name.toUpperCase()] = plugin.attachmentSupport
  }
  return declarations
}

/** A plugin manifest's `providerConfig.attachmentSupport`, as authored. */
interface ManifestAttachmentSupport {
  supported: boolean
  mimeTypes: string[]
  description?: string
}

/**
 * Load every bundled provider plugin's *manifest* declaration of the same
 * capability. Nothing in `app/` or `lib/` reads this field, which is exactly
 * why it needs a test: a declaration with no reader produces no symptom when
 * it goes stale (bug 118). Keyed by `providerConfig.providerName` so it lines
 * up with the built declarations above.
 */
function loadManifestDeclarations(): Record<string, ManifestAttachmentSupport> {
  const declarations: Record<string, ManifestAttachmentSupport> = {}
  for (const dir of fs.readdirSync(PLUGIN_DIST)) {
    const manifestPath = path.join(PLUGIN_DIST, dir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) continue
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
      providerConfig?: {
        providerName?: string
        attachmentSupport?: ManifestAttachmentSupport
      }
    }
    const name = manifest.providerConfig?.providerName
    const support = manifest.providerConfig?.attachmentSupport
    if (!name || !support) continue
    declarations[name.toUpperCase()] = support
  }
  return declarations
}

describe('providerCanTransportImages', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('with the registry initialised (the production branch)', () => {
    it('trusts a plugin that declares image MIME types', () => {
      registryUp({
        OPENROUTER: {
          supportsAttachments: true,
          supportedMimeTypes: ['image/jpeg', 'image/png'],
        } as AttachmentSupport,
      })
      expect(providerCanTransportImages('OPENROUTER')).toBe(true)
      expect(providerCanTransportImages('openrouter')).toBe(true)
    })

    it('refuses a plugin that declares no attachment support', () => {
      registryUp({
        OLLAMA: {
          supportsAttachments: false,
          supportedMimeTypes: [],
        } as unknown as AttachmentSupport,
      })
      expect(providerCanTransportImages('OLLAMA')).toBe(false)
    })

    it('refuses a plugin that takes attachments but no images', () => {
      registryUp({
        PAPERONLY: {
          supportsAttachments: true,
          supportedMimeTypes: ['application/pdf', 'text/plain'],
        } as AttachmentSupport,
      })
      expect(providerCanTransportImages('PAPERONLY')).toBe(false)
    })

    it('falls through to the static mirror for a provider the registry has never heard of', () => {
      registryUp({})
      // OPENAI is in the static mirror with image types.
      expect(providerCanTransportImages('OPENAI')).toBe(true)
      // Nothing knows this one; we assume capability rather than cripple it.
      expect(providerCanTransportImages('SOME_THIRD_PARTY')).toBe(true)
    })
  })

  describe('with the registry down (startup, the job child, jest)', () => {
    it('answers from the static mirror without consulting the registry', () => {
      registryDown()
      expect(providerCanTransportImages('OPENROUTER')).toBe(true)
      expect(providerCanTransportImages('OLLAMA')).toBe(false)
      expect(mockGetAttachmentSupport).not.toHaveBeenCalled()
    })
  })

  /**
   * Bug 97's actual regression guard. Every bundled plugin's built declaration
   * has to give the same answer as the static mirror, or the feature behaves
   * one way in production and another in the tests that are supposed to prove
   * it.
   */
  describe('built plugin declarations agree with the static mirror', () => {
    const declarations = loadBuiltPluginDeclarations()
    const shared = Object.keys(declarations).filter(
      name => name in PROVIDER_ATTACHMENT_CAPABILITIES
    )

    it('found the built plugins to compare', () => {
      expect(shared).toContain('OPENROUTER')
      expect(shared.length).toBeGreaterThan(5)
    })

    it.each(shared)('%s answers the same either side of registry init', name => {
      registryUp(declarations)
      const fromRegistry = providerCanTransportImages(name)
      registryDown()
      const fromStaticMirror = providerCanTransportImages(name)
      expect(fromRegistry).toBe(fromStaticMirror)
    })

    it.each(shared)('%s declares the same image MIME types in both sources', name => {
      const pluginImages = (declarations[name].supportedMimeTypes ?? [])
        .filter(t => t.startsWith('image/'))
        .sort()
      const mirrorImages = [
        ...PROVIDER_ATTACHMENT_CAPABILITIES[
          name as keyof typeof PROVIDER_ATTACHMENT_CAPABILITIES
        ].types,
      ]
        .filter(t => t.startsWith('image/'))
        .sort()
      expect(pluginImages).toEqual(mirrorImages)
    })

    it('OpenRouter transports images — the bug 97 case, read the way production reads it', () => {
      registryUp(declarations)
      expect(declarations.OPENROUTER.supportsAttachments).toBe(true)
      expect(declarations.OPENROUTER.supportedMimeTypes).toEqual([
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
      ])
      expect(providerCanTransportImages('OPENROUTER')).toBe(true)
      expect(staticProviderCanTransportImages('OPENROUTER')).toBe(true)
    })
  })

  /**
   * Bug 118's regression guard: the third copy of the same declaration. The
   * build wins on disagreement — the manifest is the copy that must be
   * corrected — but the disagreement has to fail here rather than wait for
   * someone to notice it a year later while chasing something else.
   */
  describe('plugin manifests agree with their own builds', () => {
    const built = loadBuiltPluginDeclarations()
    const manifests = loadManifestDeclarations()
    const shared = Object.keys(built)
      .filter(name => name in manifests)
      .sort()

    it('found the manifests to compare', () => {
      // Without this the whole block passes vacuously if the plugin layout
      // moves — which is the failure mode that let bug 118 sit unnoticed.
      expect(shared).toContain('NANOGPT')
      expect(shared).toContain('OPENROUTER')
      expect(shared.length).toBeGreaterThan(5)
    })

    it.each(shared)('%s manifest and build agree on whether attachments are supported', name => {
      expect({ provider: name, supported: manifests[name].supported }).toEqual({
        provider: name,
        supported: built[name].supportsAttachments === true,
      })
    })

    it.each(shared)('%s manifest and build declare the same image MIME types', name => {
      const manifestImages = (manifests[name].mimeTypes ?? [])
        .filter(t => t.startsWith('image/'))
        .sort()
      const builtImages = (built[name].supportedMimeTypes ?? [])
        .filter(t => t.startsWith('image/'))
        .sort()
      expect(manifestImages).toEqual(builtImages)
    })

    it('NanoGPT forwards images in all three declarations — the bug 118 case', () => {
      expect(manifests.NANOGPT.supported).toBe(true)
      expect(manifests.NANOGPT.mimeTypes.slice().sort()).toEqual([
        'image/gif',
        'image/jpeg',
        'image/png',
        'image/webp',
      ])
      expect(built.NANOGPT.supportsAttachments).toBe(true)
      expect(staticProviderCanTransportImages('NANOGPT')).toBe(true)
    })
  })
})
