/**
 * `resolveEditorTags` — the one projection every `?action=get-tags` route hands
 * to `components/tags/tag-editor.tsx` (Bug 74).
 *
 * It is a flattening of `enrichWithTags`, so these also pin the two properties
 * the editor depends on and the envelope shape hides: the entity's own tag
 * order survives, and a dangling id leaves no hole.
 */

import { resolveEditorTags } from '@/lib/api/middleware/enrichment'

const TAG_A = { id: 'aaa', name: 'alpha', visualStyle: null }
const TAG_B = { id: 'bbb', name: 'beta', visualStyle: { emoji: '🔥' } }
const TAG_C = { id: 'ccc', name: 'gamma', visualStyle: undefined }

/** A repos container whose tags repository answers in storage order. */
function reposWith(tags: any[]) {
  const findByIds = jest.fn(async (ids: string[]) => tags.filter((t) => ids.includes(t.id)))
  return { repos: { tags: { findByIds } } as any, findByIds }
}

describe('resolveEditorTags', () => {
  it('returns the flat editor shape, not the { tagId, tag } envelope', async () => {
    const { repos } = reposWith([TAG_B])
    expect(await resolveEditorTags(['bbb'], repos)).toEqual([
      { id: 'bbb', name: 'beta', visualStyle: { emoji: '🔥' } },
    ])
  })

  it("preserves the entity's own tag order, not the store's", async () => {
    // findByIds answers alpha, beta, gamma; the entity ordered them gamma-first.
    const { repos } = reposWith([TAG_A, TAG_B, TAG_C])
    const result = await resolveEditorTags(['ccc', 'aaa', 'bbb'], repos)
    expect(result.map((t) => t.id)).toEqual(['ccc', 'aaa', 'bbb'])
  })

  it('drops an id whose tag row no longer exists, leaving no hole', async () => {
    const { repos } = reposWith([TAG_A])
    expect(await resolveEditorTags(['aaa', 'deleted-id'], repos)).toEqual([
      { id: 'aaa', name: 'alpha', visualStyle: null },
    ])
  })

  it('short-circuits on empty, null and undefined without querying', async () => {
    const { repos, findByIds } = reposWith([TAG_A])
    expect(await resolveEditorTags([], repos)).toEqual([])
    expect(await resolveEditorTags(null, repos)).toEqual([])
    expect(await resolveEditorTags(undefined, repos)).toEqual([])
    expect(findByIds).not.toHaveBeenCalled()
  })

  it('resolves the whole set in one query rather than one per tag', async () => {
    const { repos, findByIds } = reposWith([TAG_A, TAG_B, TAG_C])
    await resolveEditorTags(['aaa', 'bbb', 'ccc'], repos)
    expect(findByIds).toHaveBeenCalledTimes(1)
    expect(findByIds).toHaveBeenCalledWith(['aaa', 'bbb', 'ccc'])
  })
})
