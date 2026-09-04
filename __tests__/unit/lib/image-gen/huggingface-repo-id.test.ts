/**
 * Reading a HuggingFace repo id out of a LoRA source.
 *
 * The LoRA editor offers its Query button on the strength of this predicate
 * alone, and the button is the only place a user finds out whether an adapter
 * they pasted is even the right *kind* of thing. Two failure directions matter
 * and both are silent: accepting a non-HuggingFace weights URL sends a lookup
 * that can only 404, and rejecting a legitimate `/resolve/main/...` URL — the
 * form the fal-hosted models actually want — hides the button on the sources
 * most likely to need it.
 */

import {
  extractHuggingFaceRepoId,
  huggingFaceCardUrl,
} from '@/lib/image-gen/huggingface-repo-id'

describe('extractHuggingFaceRepoId — bare repo ids', () => {
  it('takes a plain owner/name', () => {
    expect(extractHuggingFaceRepoId('alvdansen/frosting_lane_flux')).toBe(
      'alvdansen/frosting_lane_flux'
    )
  })

  it('trims surrounding whitespace before judging', () => {
    expect(extractHuggingFaceRepoId('  owner/name \n')).toBe('owner/name')
  })

  it('accepts dots, hyphens and underscores in both segments', () => {
    expect(extractHuggingFaceRepoId('some-owner_1/lora.v2-final')).toBe(
      'some-owner_1/lora.v2-final'
    )
  })

  it('refuses an empty or blank source', () => {
    expect(extractHuggingFaceRepoId('')).toBeNull()
    expect(extractHuggingFaceRepoId('   ')).toBeNull()
  })

  it('refuses a single segment', () => {
    expect(extractHuggingFaceRepoId('justaname')).toBeNull()
  })

  it('refuses three segments — a repo id is exactly two', () => {
    expect(extractHuggingFaceRepoId('owner/name/extra')).toBeNull()
  })

  it('refuses a segment that does not start alphanumerically', () => {
    expect(extractHuggingFaceRepoId('-owner/name')).toBeNull()
    expect(extractHuggingFaceRepoId('owner/.name')).toBeNull()
  })
})

describe('extractHuggingFaceRepoId — URLs', () => {
  it('reads the id out of a model-card URL', () => {
    expect(extractHuggingFaceRepoId('https://huggingface.co/owner/name')).toBe('owner/name')
  })

  it('reads the id out of a weights URL — the fal-hosted form', () => {
    expect(
      extractHuggingFaceRepoId(
        'https://huggingface.co/owner/name/resolve/main/weights.safetensors'
      )
    ).toBe('owner/name')
  })

  it('ignores a query string and fragment', () => {
    expect(extractHuggingFaceRepoId('https://huggingface.co/owner/name?foo=1#bar')).toBe(
      'owner/name'
    )
  })

  it('accepts a huggingface.co subdomain', () => {
    expect(extractHuggingFaceRepoId('https://www.huggingface.co/owner/name')).toBe('owner/name')
  })

  it('accepts http as well as https', () => {
    expect(extractHuggingFaceRepoId('http://huggingface.co/owner/name')).toBe('owner/name')
  })

  it('refuses a weights URL on some other host — there is no repo behind it', () => {
    expect(
      extractHuggingFaceRepoId('https://civitai.com/api/download/models/12345')
    ).toBeNull()
  })

  it('refuses a look-alike host that merely ends in the string', () => {
    expect(extractHuggingFaceRepoId('https://nothuggingface.co/owner/name')).toBeNull()
    expect(extractHuggingFaceRepoId('https://huggingface.co.evil.test/owner/name')).toBeNull()
  })

  it('refuses a huggingface.co URL with fewer than two path segments', () => {
    expect(extractHuggingFaceRepoId('https://huggingface.co/owner')).toBeNull()
    expect(extractHuggingFaceRepoId('https://huggingface.co/')).toBeNull()
  })

  it('refuses an unparseable URL rather than throwing', () => {
    expect(extractHuggingFaceRepoId('https://')).toBeNull()
  })
})

describe('huggingFaceCardUrl', () => {
  it('builds the public model-card URL', () => {
    expect(huggingFaceCardUrl('owner/name')).toBe('https://huggingface.co/owner/name')
  })

  it('round-trips with the extractor', () => {
    const id = 'alvdansen/frosting_lane_flux'
    expect(extractHuggingFaceRepoId(huggingFaceCardUrl(id))).toBe(id)
  })
})
