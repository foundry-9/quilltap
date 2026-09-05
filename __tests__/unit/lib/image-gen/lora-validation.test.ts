/**
 * The write-side guard on `parameters.loras`.
 *
 * `parameters` is an opaque JSON bag, so nothing downstream would notice a
 * malformed adapter list going in — the profile would save cleanly and then
 * fail at generation time, hours later, against a model the user has since
 * changed. This guard is the only thing that turns that into a 400 with
 * nothing stored, so the cases that must NOT slip past it are the point of
 * this suite.
 */

import { validateProfileLoras } from '@/lib/image-gen/lora-validation'

describe('validateProfileLoras — nothing to complain about', () => {
  it('passes when the parameters bag is not an object', () => {
    expect(validateProfileLoras(undefined)).toBeNull()
    expect(validateProfileLoras(null)).toBeNull()
    expect(validateProfileLoras('nonsense')).toBeNull()
    expect(validateProfileLoras(42)).toBeNull()
  })

  it('passes an array — the caller owns the "parameters must be an object" check', () => {
    expect(validateProfileLoras([{ source: 'owner/name' }])).toBeNull()
  })

  it('passes when the loras key is simply absent', () => {
    expect(validateProfileLoras({ steps: 30, guidance_scale: 3.5 })).toBeNull()
  })

  it('passes an empty list', () => {
    expect(validateProfileLoras({ loras: [] })).toBeNull()
  })

  it('passes a minimal entry — source alone is enough', () => {
    expect(validateProfileLoras({ loras: [{ source: 'owner/name' }] })).toBeNull()
  })

  it('passes a fully specified entry', () => {
    expect(
      validateProfileLoras({
        loras: [
          {
            source: 'https://huggingface.co/owner/name/resolve/main/w.safetensors',
            scale: 0.8,
            triggerPhrase: 'frstingln illustration',
            label: 'Frosting Lane',
          },
        ],
      })
    ).toBeNull()
  })

  it('passes the boundary scales', () => {
    expect(validateProfileLoras({ loras: [{ source: 'a/b', scale: 0 }] })).toBeNull()
    expect(validateProfileLoras({ loras: [{ source: 'a/b', scale: 10 }] })).toBeNull()
  })
})

describe('validateProfileLoras — refusals', () => {
  it('refuses a loras key that is not an array', () => {
    expect(validateProfileLoras({ loras: { source: 'a/b' } })).not.toBeNull()
    expect(validateProfileLoras({ loras: 'owner/name' })).not.toBeNull()
  })

  it('refuses an entry with no source', () => {
    expect(validateProfileLoras({ loras: [{ scale: 1 }] })).not.toBeNull()
  })

  it('refuses a blank or whitespace-only source', () => {
    expect(validateProfileLoras({ loras: [{ source: '' }] })).not.toBeNull()
    expect(validateProfileLoras({ loras: [{ source: '   ' }] })).not.toBeNull()
  })

  it('refuses a negative or over-range scale', () => {
    expect(validateProfileLoras({ loras: [{ source: 'a/b', scale: -0.1 }] })).not.toBeNull()
    expect(validateProfileLoras({ loras: [{ source: 'a/b', scale: 10.5 }] })).not.toBeNull()
  })

  it('refuses a non-finite scale', () => {
    expect(validateProfileLoras({ loras: [{ source: 'a/b', scale: NaN }] })).not.toBeNull()
    expect(validateProfileLoras({ loras: [{ source: 'a/b', scale: Infinity }] })).not.toBeNull()
  })

  it('refuses a scale that arrived as a string', () => {
    expect(validateProfileLoras({ loras: [{ source: 'a/b', scale: '0.8' }] })).not.toBeNull()
  })

  it('refuses the whole list when only one entry is bad', () => {
    const error = validateProfileLoras({
      loras: [{ source: 'good/one' }, { source: '' }, { source: 'good/two' }],
    })
    expect(error).not.toBeNull()
    expect(error!.issues[0].path).toEqual([1, 'source'])
  })

  it('returns a ZodError the caller can hand to validationError()', () => {
    const error = validateProfileLoras({ loras: [{ scale: 1 }] })
    expect(error).not.toBeNull()
    expect(Array.isArray(error!.issues)).toBe(true)
    expect(error!.issues.length).toBeGreaterThan(0)
  })
})
